import { consolidate } from './consolidation.ts';
import { checkDistribution } from './distribution.ts';
import { anchorCommunities, deprecateMissing, membersByCommunity, type AnchoredCommunity } from './identity.ts';
import { buildTaxonomyInventory, type TaxonomyInventory } from './inventory.ts';
import {
  clearDirtyFlag,
  publishGeneration,
  readActiveRegistry,
  readMarker,
  writeDirtyFlag,
  writeGeneration,
} from './store.ts';
import {
  REGISTRY_SCHEMA_VERSION,
  validateRegistry,
  type RegistryCommunity,
  type TaxonomyRegistry,
} from './schema.ts';
import {
  buildSynthesisPrompt,
  checkProposal,
  normalizeProposal,
  retryHint,
  semanticReviewPrompt,
  SYNTHESIS_SYSTEM,
  taxonomyProposalSchema,
  type TaxonomyProposal,
} from './synthesize.ts';
import { loadWikiGraphSnapshot } from '../overview.ts';

/** Tentatives de re-synthèse avant abandon. D7 exige que le rejet soit borné. */
export const MAX_SYNTHESIS_ATTEMPTS = 3;

export type SynthesizeDeps = {
  /** Complétion structurée du LLM configuré. Absente ⇒ rien n'est tenté. */
  propose?: (request: { system: string; user: string }) => Promise<unknown>;
  excerpts?: Map<string, string>;
  maxPages?: number;
  now?: number;
};

export type SynthesizeOutcome =
  | {
      status: 'published';
      revision: number;
      /** Domaines racines : ce que la carte affiche. */
      communities: number;
      /** Communautés feuilles : ce qu'un domaine ouvre. */
      leaves: number;
      /** Réserves de qualité : publiées, jamais bloquantes. */
      warnings: string[];
      inventory: TaxonomyInventory;
    }
  | { status: 'unchanged'; revision: number }
  | { status: 'skipped'; reason: 'no_llm' | 'empty_corpus' }
  | { status: 'rejected'; issues: string[] }
  | { status: 'stale' }
  /** `reason` n'est renseigné que pour un échec inattendu, jamais pour un verrou. */
  | { status: 'deferred'; reason?: string };

/**
 * Synthèse complète : inventaire → proposition → validation → registre publié.
 *
 * L'appel LLM se fait **hors verrou**, comme l'écriture de la génération : seul
 * le compare-and-swap du marqueur est sérialisé. Une synthèse calculée sur une
 * empreinte devenue obsolète est abandonnée au commit plutôt que publiée
 * par-dessus une ingestion plus récente.
 *
 * Ne lève jamais. Un échec laisse le registre précédent actif et pose
 * `pendingSynthesis` : Serve publiera le déterministe, et la reprise revient à
 * la prochaine exécution de la capacité.
 */
export async function synthesizeTaxonomy(
  rootDir: string,
  options: { language: string; workspace?: string; force?: boolean },
  deps: SynthesizeDeps = {},
): Promise<SynthesizeOutcome> {
  /*
   La promesse ci-dessus n'était tenue que dans la partie basse de la fonction.

   Le chargement du snapshot, la lecture du registre actif et la construction de
   l'inventaire précèdent toute la mécanique de repli et n'étaient couverts par
   rien : un fichier illisible ou un registre tronqué remontait donc jusqu'à
   l'appelant. Or ces appelants — la commande CLI, le watcher, la capacité de
   production — ont été écrits en croyant la docstring, et aucun n'a de
   rattrapage. Une seule lecture ratée arrêtait ce que la synthèse est censée
   dégrader sans bruit.

   Le registre précédent reste actif dans tous les cas ; l'échec pose le drapeau
   et se dit.
  */
  try {
    return await runSynthesis(rootDir, options, deps);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Le drapeau porte l'empreinte du corpus : sans snapshot lisible, on ne
    // l'a pas, et il n'y a rien d'utile à écrire. L'échec reste rapporté.
    await noteFailure(rootDir, '', [`synthesis: ${reason}`]).catch(() => {});
    return { status: 'deferred', reason };
  }
}

async function runSynthesis(
  rootDir: string,
  options: { language: string; workspace?: string; force?: boolean },
  deps: SynthesizeDeps,
): Promise<SynthesizeOutcome> {
  const snapshot = await loadWikiGraphSnapshot({
    rootDir,
    workspace: options.workspace,
    language: options.language,
  });
  if (!snapshot.nodes.length) return { status: 'skipped', reason: 'empty_corpus' };
  if (!deps.propose) {
    // Dégradation gracieuse : sans LLM configuré, la projection déterministe
    // reste en place et le dit. Jamais une erreur, jamais une page vide.
    return { status: 'skipped', reason: 'no_llm' };
  }

  const active = await readActiveRegistry(rootDir);
  const validated = active?.registry ? validateRegistry(active.registry) : null;
  const previous: TaxonomyRegistry | null = validated?.ok ? validated.registry : null;

  const inventory = buildTaxonomyInventory(snapshot, {
    language: options.language,
    registry: previous,
    excerpts: deps.excerpts,
    maxPages: deps.maxPages,
  });

  let proposal: TaxonomyProposal | null = null;
  let warnings: Array<{ path: string; reason: string }> = [];
  let reviewed = false;
  let lastIssues: string[] = [];
  let user = buildSynthesisPrompt(inventory);

  for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt += 1) {
    let raw: unknown;
    try {
      raw = await deps.propose({ system: SYNTHESIS_SYSTEM, user });
    } catch (error) {
      lastIssues = [`llm: ${error instanceof Error ? error.message : String(error)}`];
      break;
    }
    const parsed = taxonomyProposalSchema.safeParse(raw);
    if (!parsed.success) {
      lastIssues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      user = `${buildSynthesisPrompt(inventory)}\n\n${retryHint(lastIssues.map((reason) => ({ path: '', reason })))}`;
      continue;
    }
    // Les coquilles sans conséquence sont retirées avant d'être jugées : une
    // communauté vide n'est pas une erreur de sens, c'est une ligne en trop.
    const checked = checkProposal(normalizeProposal(parsed.data).proposal, inventory);
    if (checked.ok) {
      if (reviewed) {
        proposal = checked.proposal;
        // Ce qui relève du jugement ne bloque pas, mais doit être vu : c'est la
        // seule façon pour l'utilisateur de savoir ce que la carte a perdu.
        warnings = checked.warnings;
        break;
      }
      // Une réponse structurellement valide peut encore nommer le travail
      // éditorial (« analyse », « étude ») au lieu du sujet. Une seconde passe
      // globale relit la proposition entière : deux appels pour le corpus,
      // jamais un appel par page ou par famille.
      reviewed = true;
      user = semanticReviewPrompt(inventory, checked.proposal);
      continue;
    }
    lastIssues = checked.issues.map((issue) => `${issue.path}: ${issue.reason}`);
    user = `${buildSynthesisPrompt(inventory)}\n\n${retryHint(checked.issues)}`;
  }

  if (!proposal) {
    await noteFailure(rootDir, inventory.corpus, lastIssues);
    return { status: 'rejected', issues: lastIssues };
  }

  /*
   Membres réels de chaque niveau.

   Une feuille porte les pages de ses familles ; un domaine porte l'union de
   ses feuilles. Le domaine ne reçoit AUCUNE page dans le registre — c'est
   l'invariant qui interdit le fourre-tout — mais il lui faut ces membres pour
   être ré-ancré : une bulle se reconnaît à son contenu, pas à son nom.
  */
  // Non nul seulement quand le corpus a été tronqué : sans troncature, la
  // comparaison porte déjà sur le corpus entier des deux côtés.
  const sampledPages = inventory.truncated
    ? new Set(inventory.pages.map((page) => page.id))
    : null;
  const familyById = new Map(inventory.families.map((family) => [family.id, family]));
  const membersByLeaf = new Map<string, string[]>();
  for (const [familyId, leafId] of Object.entries(proposal.assignments)) {
    const members = familyById.get(familyId)?.members ?? [];
    if (!membersByLeaf.has(leafId)) membersByLeaf.set(leafId, []);
    membersByLeaf.get(leafId)!.push(...members);
  }
  const leafDomain = new Map(proposal.communities.map((community) => [community.id, community.domain]));
  const membersByDomain = new Map<string, string[]>();
  for (const [leafId, members] of membersByLeaf) {
    const domainId = leafDomain.get(leafId);
    if (!domainId) continue;
    if (!membersByDomain.has(domainId)) membersByDomain.set(domainId, []);
    membersByDomain.get(domainId)!.push(...members);
  }

  const marker = await readMarker(rootDir);
  const revision = (marker?.revision ?? 0) + 1;

  /*
   Ancrage et consolidation PAR NIVEAU.

   Les deux fonctions supposent une liste plate de pairs. Les appeler sur
   l'arbre entier laisserait un domaine s'emparer de l'identifiant d'une
   feuille — leurs membres se recouvrent par construction, un domaine contenant
   exactement l'union de ses feuilles — et un domaine renommé emporterait alors
   ses enfants. On isole donc chaque niveau, et pour les feuilles chaque
   fratrie, ce qui donne au passage la bonne portée d'unicité.
  */
  const anchoredDomains = anchorCommunities(
    proposal.domains.map((domain) => ({ members: membersByDomain.get(domain.id) ?? [], label: domain.label })),
    registryAtLevel(previous, 'root', undefined, sampledPages),
    { now: deps.now },
  );
  const domainIdByProposal = new Map(
    proposal.domains.map((domain, index) => [domain.id, anchoredDomains[index]!.id]),
  );

  const consolidatedDomains = consolidate(anchoredDomains, registryAtLevel(previous, 'root', undefined, sampledPages), {
    language: options.language,
    revision,
    force: options.force,
  });
  if (!consolidatedDomains.ok) {
    return rejectConflicts(rootDir, inventory.corpus, consolidatedDomains.conflicts);
  }

  const leafCommunities: RegistryCommunity[] = [];
  const anchoredLeaves: AnchoredCommunity[] = [];
  /** Identifiant proposé par le modèle → identifiant stable du registre. */
  const leafById = new Map<string, string>();
  /** Domaines aplatis : leur unique enfant est devenu racine. */
  const collapsedDomains = new Set<string>();
  for (const domain of proposal.domains) {
    const siblings = proposal.communities.filter((community) => community.domain === domain.id);
    const parentId = domainIdByProposal.get(domain.id)!;
    const scope = registryAtLevel(previous, 'leaf', parentId, sampledPages);
    const anchored = anchorCommunities(
      siblings.map((community) => ({ members: membersByLeaf.get(community.id) ?? [], label: community.label })),
      scope,
      { now: deps.now },
    );
    const consolidated = consolidate(anchored, scope, {
      language: options.language,
      revision,
      force: options.force,
    });
    if (!consolidated.ok) return rejectConflicts(rootDir, inventory.corpus, consolidated.conflicts);

    /*
     Un domaine qui ne sépare rien est aplati, pas rejeté.

     Avec une seule communauté fille, le domaine impose deux clics là où un
     suffit : on promeut donc l'enfant en racine. Le schéma l'accepte — une
     racine sans enfant est une feuille — et la carte l'affiche comme une bulle
     ordinaire. Aucune page ne change de communauté.
    */
    const collapse = siblings.length === 1;
    siblings.forEach((community, index) => {
      const id = anchored[index]!.id;
      leafById.set(community.id, id);
      leafCommunities.push({
        ...consolidated.communities[index]!,
        id,
        parentCommunity: collapse ? null : parentId,
      });
    });
    if (collapse) collapsedDomains.add(parentId);
    anchoredLeaves.push(...anchored);
  }

  const collectionLeaves = new Map<string, Set<string>>();
  for (const family of inventory.families) {
    const proposedLeaf = proposal.assignments[family.id];
    const stableLeaf = proposedLeaf ? leafById.get(proposedLeaf) : undefined;
    if (!stableLeaf) continue;
    for (const collection of family.collections) {
      const leaves = collectionLeaves.get(collection) ?? new Set<string>();
      leaves.add(stableLeaf);
      collectionLeaves.set(collection, leaves);
    }
  }

  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const family of inventory.families) {
    const proposedLeaf = proposal.assignments[family.id];
    const primaryCommunity = proposedLeaf ? leafById.get(proposedLeaf) : undefined;
    if (!primaryCommunity) continue;
    const relatedCommunities = [...new Set(family.collections.flatMap((collection) =>
      [...(collectionLeaves.get(collection) ?? [])]))]
      .filter((id) => id !== primaryCommunity)
      .sort();
    // Les pages ne sont rattachées qu'aux feuilles : la collection ajoute des
    // relations vers ses autres sujets, sans changer leur placement.
    for (const page of family.members) {
      assignments[page] = {
        primaryCommunity,
        ...(relatedCommunities.length ? { relatedCommunities } : {}),
      };
    }
  }

  /*
   Une communauté que le modèle n'a jamais vue n'a pas été supprimée par lui.

   Sur un corpus tronqué, la proposition ne parle que de l'échantillon. Les
   communautés dont aucune page n'y figurait n'apparaissaient donc dans aucun
   brouillon, étaient traitées comme disparues, et se faisaient déprécier — avec
   leurs pages, qui n'avaient plus de cible où être reconduites. Déduire une
   suppression d'une absence d'information, c'est précisément inventer une
   décision que personne n'a prise.

   Elles traversent donc la révision intactes. Celles dont une partie des pages
   était visible, en revanche, ont bien été jugées : si le modèle les a
   écartées, c'est une décision, et la dépréciation ordinaire s'applique.
  */
  const corpusPages = new Set(inventory.corpusPageIds);
  const untouched: RegistryCommunity[] = [];
  if (sampledPages && previous) {
    const previousMembers = membersByCommunity(previous);
    for (const community of previous.communities) {
      if (community.deprecated) continue;
      const members = previousMembers.get(community.id) ?? [];
      const stillLive = members.filter((page) => corpusPages.has(page));
      if (!stillLive.length) continue;
      if (stillLive.some((page) => sampledPages.has(page))) continue;
      untouched.push(community);
    }
  }
  const untouchedSurvivors: AnchoredCommunity[] = untouched.map((community) => ({
    id: community.id,
    members: [],
    label: '',
    reanchored: true,
  }));

  // Les disparues ne sont jamais supprimées : elles gardent leur identifiant
  // et pointent leur remplaçante, sans quoi une fusion serait indistinguable
  // d'une destruction pour un client qui revient.
  const communities: RegistryCommunity[] = [
    ...untouched,
      // Un domaine aplati disparaît : son enfant unique le remplace en racine.
      ...consolidatedDomains.communities
        .filter((community) => !collapsedDomains.has(community.id))
        .map((community) => ({ ...community, parentCommunity: null })),
      ...leafCommunities,
      /*
       Un domaine aplati n'est pas un survivant.

       Il était retiré de `communities` par le filtre ci-dessus tout en restant
       dans la liste passée ici : `deprecateMissing` le voyait donc « vivant » et
       ne lui écrivait aucune souche. Son identifiant disparaissait purement et
       simplement du registre — le seul cas où une communauté s'évanouit sans
       laisser de trace, ce que tout le reste du modèle s'interdit précisément
       pour qu'une sélection ancienne reste résoluble.

       Écarté d'ici, il redevient une disparition ordinaire, et le recouvrement
       de membres le fait pointer vers son enfant unique promu — qui porte
       exactement les mêmes pages, donc un recouvrement de 1.
      */
      ...deprecateMissing(
        previous,
        [
          ...anchoredDomains.filter((domain) => !collapsedDomains.has(domain.id)),
          ...anchoredLeaves,
          // Intouchées faute d'avoir été soumises : vivantes, donc jamais
          // dépréciées.
          ...untouchedSurvivors,
        ],
        revision,
      ),
  ];

  reattachOrphanedChildren(communities);

  /*
   L'échantillon décide ; le corpus entier reçoit la décision.

   `maxPages` borne ce qu'on SOUMET au modèle — au-delà, on garde les pages les
   plus connectées, qui portent la structure. Mais les affectations étaient
   ensuite reconstruites à partir de ce seul échantillon : au-delà de 400 pages,
   ou sous `--max-pages`, toutes les autres disparaissaient du registre publié.
   Elles retombaient alors sur la projection déterministe pendant que le
   snapshot annonçait une taxonomie synthétisée — et la synthèse suivante
   effaçait au passage leur affectation précédente.

   Une page non échantillonnée n'est pas une page sans décision : celle de la
   révision précédente reste la meilleure information disponible, et rien dans
   ce run ne la contredit. On la reconduit donc, en la suivant à travers les
   fusions, exactement comme on résoudrait une sélection ancienne.
  */
  const liveCommunities = new Map(communities.map((community) => [community.id, community]));
  const survivingTarget = (id: string): string | null => {
    let current = liveCommunities.get(id) ?? null;
    for (let hops = 0; current?.deprecated && current.replacedBy && hops < 16; hops += 1) {
      current = liveCommunities.get(current.replacedBy) ?? null;
    }
    // Une cible dépréciée sans remplaçante est un concept réellement disparu :
    // reconduire vers elle rendrait la page invisible sur la carte.
    return current && !current.deprecated ? current.id : null;
  };
  let carriedOver = 0;
  for (const [page, assignment] of Object.entries(previous?.assignments ?? {})) {
    // Une page sortie du corpus ne se reconduit pas : elle n'existe plus.
    if (assignments[page] || !corpusPages.has(page)) continue;
    const primaryCommunity = survivingTarget(assignment.primaryCommunity);
    if (!primaryCommunity) continue;
    const relatedCommunities = [...new Set(
      (assignment.relatedCommunities ?? [])
        .map((id) => survivingTarget(id))
        .filter((id): id is string => Boolean(id) && id !== primaryCommunity),
    )].sort();
    assignments[page] = {
      primaryCommunity,
      ...(relatedCommunities.length ? { relatedCommunities } : {}),
    };
    carriedOver += 1;
  }

  /*
   Ce qui reste sans affectation doit se dire.

   Une page ni échantillonnée ni déjà classée n'a aucune décision la concernant.
   Publier sans le signaler laisserait croire que la carte couvre tout le
   corpus. C'est une réserve, pas une erreur : la carte reste juste sur ce
   qu'elle montre, et refuser de publier priverait de tout.
  */
  const uncovered = inventory.corpusPageIds.filter((page) => !assignments[page]).length;
  if (uncovered > 0) {
    warnings = [...warnings, {
      path: 'assignments',
      reason: `${uncovered} page(s) sans affectation sur ${inventory.pageCount}`
        + ` : corpus soumis tronqué à ${inventory.pages.length} page(s)`
        + `${carriedOver ? `, ${carriedOver} affectation(s) reconduite(s) de la révision précédente` : ''}`,
    }];
  }

  const registry: TaxonomyRegistry = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision,
    corpus: inventory.corpus,
    languages: [...new Set([...(previous?.languages ?? []), options.language])],
    communities,
    assignments,
  };

  /*
   Contrôle de distribution avant publication.

   La révision qui a fusionné 142 pages dans une bulle était structurellement
   valide : identifiants cohérents, libellés conformes, couverture complète.
   La validation répond « ce registre est-il cohérent ? » ; ce contrôle répond
   « cette carte est-elle navigable ? ». Les deux doivent passer.
  */
  const distribution = checkDistribution(registry);
  if (!distribution.ok) {
    const issues = distribution.issues.map((issue) => `${issue.code}: ${issue.reason}`);
    await noteFailure(rootDir, inventory.corpus, issues);
    return { status: 'rejected', issues };
  }

  const guard = validateRegistry(registry);
  if (!guard.ok) {
    // Filet de sécurité : un registre construit par nos soins doit passer le
    // même contrôle que celui qu'on relit du disque, sinon la validation ne
    // vaut rien.
    const issues = guard.issues.map((issue) => `${issue.path}: ${issue.reason}`);
    await noteFailure(rootDir, inventory.corpus, issues);
    return { status: 'rejected', issues };
  }

  const generation = await writeGeneration(rootDir, registry);
  const outcome = await publishGeneration(rootDir, {
    corpus: inventory.corpus,
    registryRef: generation.ref,
    registryHash: generation.hash,
    expectedCorpus: inventory.corpus,
  });

  if (outcome.status === 'stale') return { status: 'stale' };
  if (outcome.status !== 'published') {
    await noteFailure(rootDir, inventory.corpus, ['publication indisponible']);
    return { status: 'deferred' };
  }
  // Une publication valide satisfait aussi bien un repli déterministe qu'une
  // reprise de synthèse. Laisser le drapeau ferait croire au redémarrage
  // suivant qu'un travail reste en attente alors que le commit est actif.
  await clearDirtyFlag(rootDir).catch(() => {});
  return {
    status: 'published',
    revision: outcome.marker.revision,
    // Ce que l'utilisateur voit sur la carte, ce sont les domaines ; le compte
    // des feuilles ne dit rien de la lisibilité du premier écran.
    //
    // On compte APRÈS l'aplatissement : un domaine à enfant unique a disparu du
    // registre, et l'annoncer quand même ferait chercher sur la carte une bulle
    // qui n'existe pas — le même défaut que « 33 communities » sur une carte
    // qui en repliait 3.
    communities: consolidatedDomains.communities.filter(
      (community) => !collapsedDomains.has(community.id),
    ).length,
    leaves: leafCommunities.length,
    warnings: warnings.map((issue) => `${issue.path}: ${issue.reason}`),
    inventory,
  };
}

/**
 * Vue du registre précédent restreinte à un niveau, pour le ré-ancrage.
 *
 * Un domaine et ses feuilles partagent leurs membres par construction : sans
 * cette restriction, l'appariement par recouvrement laisserait un domaine
 * revendiquer l'identifiant d'une de ses feuilles, ou l'inverse. On compare
 * donc des pairs à des pairs — et pour les feuilles, une fratrie à sa fratrie.
 */
/**
 * Rend une racine à toute communauté active dont le parent ne l'est plus.
 *
 * Une feuille préservée parce qu'elle n'a pas été soumise garde son
 * `parentCommunity` — mais rien ne garantit que ce domaine ait survécu à la même
 * révision : une AUTRE feuille du même domaine, elle échantillonnée, peut
 * l'avoir fait remplacer ou déprécier. La feuille restait alors active en
 * pointant vers un parent mort.
 *
 * Le registre passait la validation, et pourtant `communityHierarchy` ne
 * construit l'arbre qu'à partir des communautés actives : le parent était
 * introuvable, la feuille sortait de la hiérarchie et réapparaissait comme
 * bulle racine sur la carte, en contradiction avec ce que le registre déclarait.
 *
 * On suit donc la redirection du parent tant qu'elle mène à une racine vivante,
 * et à défaut on promeut l'enfant en racine — ce que le schéma autorise, et qui
 * le laisse navigable au lieu de le suspendre dans le vide.
 */
export function reattachOrphanedChildren(communities: RegistryCommunity[]): void {
  const byId = new Map(communities.map((community) => [community.id, community]));
  const isLiveRoot = (community: RegistryCommunity | undefined): boolean =>
    Boolean(community && !community.deprecated && !community.parentCommunity);

  for (const community of communities) {
    if (community.deprecated || !community.parentCommunity) continue;
    let parent = byId.get(community.parentCommunity);
    if (isLiveRoot(parent)) continue;
    // La cible de remplacement doit être une RACINE vivante : s'accrocher à une
    // feuille creuserait un troisième niveau que le schéma interdit.
    for (let hops = 0; parent?.deprecated && parent.replacedBy && hops < 16; hops += 1) {
      parent = byId.get(parent.replacedBy);
    }
    community.parentCommunity = isLiveRoot(parent) ? parent!.id : null;
  }
}

function registryAtLevel(
  previous: TaxonomyRegistry | null,
  level: 'root' | 'leaf',
  parentId?: string,
  /*
   Pages réellement soumises au modèle, quand le corpus a été tronqué.

   Le ré-ancrage reconnaît une communauté au recouvrement de ses membres. Sur un
   corpus tronqué, la proposition ne parle que de l'échantillon : comparée aux
   membres COMPLETS de la révision précédente, une communauté intacte tombait
   sous le seuil et perdait son identité — puis se faisait déprécier, et les
   pages hors échantillon n'avaient même plus de cible où être reconduites.

   Ce n'est pas la communauté qui a changé, c'est ce qu'on en montre. On compare
   donc les deux côtés sur le même échantillon : comparer ce qui est comparable
   est la condition pour que le recouvrement veuille dire quelque chose.
  */
  sampled?: Set<string> | null,
): TaxonomyRegistry | null {
  if (!previous) return null;
  const children = new Set(
    previous.communities.filter((item) => item.parentCommunity).map((item) => item.parentCommunity as string),
  );
  const kept = previous.communities.filter((community) => {
    if (community.deprecated) return false;
    if (level === 'root') return !community.parentCommunity;
    return parentId ? community.parentCommunity === parentId : Boolean(community.parentCommunity);
  });
  const keptIds = new Set(kept.map((community) => community.id));

  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const [page, assignment] of Object.entries(previous.assignments)) {
    if (sampled && !sampled.has(page)) continue;
    if (level === 'leaf') {
      if (keptIds.has(assignment.primaryCommunity)) assignments[page] = assignment;
      continue;
    }
    // Au niveau racine, les membres d'un domaine sont ceux de ses feuilles :
    // c'est ce qui permet de le reconnaître après un renommage.
    const leaf = previous.communities.find((item) => item.id === assignment.primaryCommunity);
    const root = leaf?.parentCommunity ?? (children.has(assignment.primaryCommunity) ? null : assignment.primaryCommunity);
    if (root && keptIds.has(root)) assignments[page] = { primaryCommunity: root };
  }
  return { ...previous, communities: kept, assignments };
}

async function rejectConflicts(
  rootDir: string,
  corpus: string,
  conflicts: Array<{ label: string; ids: string[] }>,
): Promise<SynthesizeOutcome> {
  const issues = conflicts.map((conflict) => `label: « ${conflict.label} » partagé par ${conflict.ids.join(', ')}`);
  await noteFailure(rootDir, corpus, issues);
  return { status: 'rejected', issues };
}

async function noteFailure(rootDir: string, corpus: string, issues: string[]): Promise<void> {
  const marker = await readMarker(rootDir);
  await writeDirtyFlag(rootDir, {
    kind: 'pendingSynthesis',
    corpus,
    baseRevision: marker?.revision ?? 0,
    at: Date.now(),
  }).catch(() => {});
  void issues;
}
