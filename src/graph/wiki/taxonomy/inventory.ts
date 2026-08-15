import type { WikiGraphSnapshot } from '../snapshot.ts';
import { orderPagesForSampling } from './coverage.ts';
import { KNOWLEDGE_NODE_TYPES } from './knowledge.ts';
import type { TaxonomyRegistry } from './schema.ts';
import { communityLabel } from './schema.ts';

/*
 Inventaire soumis à la synthèse.

 Il sert à DÉCIDER, pas à restituer les pages. C'est la même discipline que
 `summarizeWikiGraph` : injecter du contenu ferait exploser la fenêtre du tour
 censé planifier à bas coût, et le modèle n'a pas besoin de lire pour
 reconnaître un domaine — il a besoin de voir des titres, des voisinages et des
 étiquettes.
*/

/** Au-delà, un titre n'apporte plus d'information, il consomme du budget. */
const MAX_TITLE = 90;
/** Un extrait sert à lever une ambiguïté de titre, pas à résumer la page. */
const MAX_EXCERPT = 160;
/** Voisins cités par page : au-delà, le signal se noie dans le bruit. */
const MAX_NEIGHBOURS = 6;

export type InventoryPage = {
  id: string;
  title: string;
  /** Indice d'ingestion, jamais une décision. */
  group?: string;
  /** Dossier de concepts, quand il y en a un. */
  folder?: string;
  excerpt?: string;
  neighbours: string[];
};

export type InventoryCommunity = {
  id: string;
  label: string;
  size: number;
  /** Pages les plus connectées : de quoi reconnaître le domaine sans le lire. */
  topPages: string[];
};

export type InventoryFamily = {
  /** Identifiant court et déterministe utilisé dans la réponse du modèle. */
  id: string;
  /** Pages développées localement après la décision ; jamais répétées par le LLM. */
  members: string[];
  titles: string[];
  signals: string[];
  /** Collections comparatives partagées : relation, jamais fusion. */
  collections: string[];
  /**
   * Ce qui distingue cette étude de ses sœurs dans la même collection.
   *
   * Déduit par différence de vocabulaire, jamais d'une liste de produits. Quand
   * il existe, le libellé de la feuille doit le conserver : c'est l'identité du
   * sujet comparé, et la perdre revient à ne plus pouvoir naviguer vers lui.
   */
  distinctiveTerms: string[];
  neighbours: string[];
};

export type TaxonomyInventory = {
  language: string;
  corpus: string;
  pageCount: number;
  pages: InventoryPage[];
  /**
   * Toutes les pages de connaissance du corpus, échantillon compris.
   *
   * `pages` est l'échantillon soumis au modèle ; ce champ est le corpus réel.
   * Les confondre faisait disparaître du registre publié toute page non
   * échantillonnée : l'appelant a besoin de savoir sur quoi la décision doit
   * s'appliquer, pas seulement sur quoi elle a été prise.
   */
  corpusPageIds: string[];
  /**
   * Pages réellement soumises au modèle dans cette passe.
   *
   * Miroir de `pages`, sous la forme que le registre publie. Une page du corpus
   * qui n'y figure pas n'a été jugée par personne : c'est ce qui distingue
   * `outside-sample` d'un échec de classement.
   */
  sampledPageIds: string[];
  families: InventoryFamily[];
  communities: InventoryCommunity[];
  /** Vrai quand le corpus a dû être tronqué pour tenir dans le budget. */
  truncated: boolean;
};

const KNOWLEDGE_TYPES = KNOWLEDGE_NODE_TYPES;

function shorten(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function conceptFolder(id: string): string | undefined {
  const parts = id.split('/');
  return parts[0] === 'wiki' && parts[1] === 'concepts' && parts.length >= 4 ? parts[2] : undefined;
}

function parentPath(id: string): string {
  const at = id.lastIndexOf('/');
  return at < 0 ? '' : id.slice(0, at);
}

function familyKey(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Construit l'inventaire depuis le snapshot et le registre courant.
 *
 * Le snapshot public ne transporte déjà ni `raw`, ni `html`, ni `preview` :
 * l'inventaire n'a donc aucun moyen d'y prendre du contenu, ce qui est la
 * garantie qu'on cherche. Les extraits éventuels sont fournis par l'appelant,
 * qui seul sait les lire à un coût acceptable.
 *
 * `maxPages` borne le corpus soumis. Au-delà, on garde les pages les plus
 * connectées : ce sont elles qui portent la structure, et un domaine se
 * reconnaît à ses pages centrales bien avant ses feuilles.
 */
export function buildTaxonomyInventory(
  snapshot: WikiGraphSnapshot,
  options: {
    language: string;
    registry?: TaxonomyRegistry | null;
    excerpts?: Map<string, string>;
    maxPages?: number;
    /**
     * Empreinte du corpus de connaissance.
     *
     * Le `structureEtag` du snapshot décrit le graphe complet — templates et
     * deliverables compris — et sert de repli tant qu'un appelant ne fournit
     * rien. La synthèse, elle, publie toujours l'empreinte de connaissance :
     * c'est elle qui décide de la péremption.
     */
    corpus?: string;
    /** Pages déjà affectées par le registre frais. */
    covered?: Set<string>;
    /** Pages restées hors échantillon aux passes précédentes. */
    previouslyOutsideSample?: Set<string>;
  },
): TaxonomyInventory {
  const maxPages = options.maxPages ?? 400;
  const excerpts = options.excerpts ?? new Map<string, string>();

  const knowledge = snapshot.nodes.filter((node) => KNOWLEDGE_TYPES.has(node.type));
  const degree = new Map<string, number>();
  const neighbours = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    if (!neighbours.has(edge.from)) neighbours.set(edge.from, []);
    if (!neighbours.has(edge.to)) neighbours.set(edge.to, []);
    neighbours.get(edge.from)!.push(edge.to);
    neighbours.get(edge.to)!.push(edge.from);
  }

  /*
   Ordre de soumission : ce qui n'a jamais été jugé passe devant.

   Le tri par degré seul écartait toujours les mêmes pages — les plus récentes
   sont les moins connectées — et les laissait indéfiniment hors échantillon.
   `orderPagesForSampling` porte la règle ; le degré ne sert plus qu'à départager
   à priorité égale.
  */
  const nodeIndex = new Map(knowledge.map((node) => [node.id, node]));
  const ranked = orderPagesForSampling(knowledge.map((node) => node.id), {
    covered: options.covered ?? new Set<string>(),
    previouslyOutsideSample: options.previouslyOutsideSample,
    degree,
  }).map((id) => nodeIndex.get(id)!);
  const kept = ranked.slice(0, maxPages);
  const keptIds = new Set(kept.map((node) => node.id));

  const pages: InventoryPage[] = kept.map((node) => {
    const excerpt = excerpts.get(node.id);
    const folder = conceptFolder(node.id);
    return {
      id: node.id,
      title: shorten(node.title, MAX_TITLE),
      ...(node.group ? { group: shorten(node.group, MAX_TITLE) } : {}),
      ...(folder ? { folder } : {}),
      ...(excerpt ? { excerpt: shorten(excerpt, MAX_EXCERPT) } : {}),
      // Le voisinage est ce qui distingue un domaine d'une étiquette : deux
      // pages qui se citent appartiennent probablement au même sujet, quel que
      // soit leur dossier.
      neighbours: [...new Set(neighbours.get(node.id) ?? [])]
        .filter((id) => keptIds.has(id))
        .slice(0, MAX_NEIGHBOURS),
    };
  });

  /*
   Les familles sont déterministes : Donna décide de leur DOMAINE, jamais de
   leur composition. Cela préserve les structures que le classement plat
   détruisait sur ACPI : documents frères d'une même étude, miroir archivé / 
   page source, et concepts partageant explicitement le même groupe ou dossier.
  */
  const parent = new Map(pages.map((page) => [page.id, page.id]));
  const find = (id: string): string => {
    const owner = parent.get(id) ?? id;
    if (owner === id) return id;
    const root = find(owner);
    parent.set(id, root);
    return root;
  };
  const unite = (left: string, right: string) => {
    const a = find(left), b = find(right);
    if (a === b) return;
    parent.set(a.localeCompare(b) <= 0 ? b : a, a.localeCompare(b) <= 0 ? a : b);
  };
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const nodeById = new Map(kept.map((node) => [node.id, node]));

  // Le parent commun décrit une COLLECTION, pas une identité. Les sources
  // sœurs doivent rester séparées pour pouvoir devenir des communautés
  // distinctes sous un même domaine.
  const rawByParent = new Map<string, string[]>();
  for (const node of kept) {
    if (node.type !== 'raw-source') continue;
    const key = parentPath(node.id);
    if (!rawByParent.has(key)) rawByParent.set(key, []);
    rawByParent.get(key)!.push(node.id);
  }
  const collectionByRaw = new Map<string, string>();
  [...rawByParent.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, ids], index) => {
      const collection = `c${String(index + 1).padStart(4, '0')}`;
      ids.forEach((id) => collectionByRaw.set(id, collection));
    });

  // Le miroir wiki/sources n'est pas un second sujet.
  for (const edge of snapshot.edges) {
    if (!pageById.has(edge.from) || !pageById.has(edge.to)) continue;
    const from = nodeById.get(edge.from)?.type;
    const to = nodeById.get(edge.to)?.type;
    if ((from === 'raw-source' && to === 'wiki-source')
      || (from === 'wiki-source' && to === 'raw-source')) unite(edge.from, edge.to);
  }

  /*
   `group:` ne prouve plus une identité — il ne fait que la suggérer.

   Le commentaire d'origine disait déjà qu'un groupe est un signal ; le code, lui,
   unissait toutes les pages partageant exactement la même valeur. Sur ACPI cela
   fusionnait cinq produits différents sous `security` ou `integration`, tout en
   dispersant les pages d'un même produit dont les groupes divergeaient. C'est la
   perte de provenance du § 0.4.

   Retirer l'union globale sans rien mettre à la place atomiserait l'inventaire
   jusqu'à l'arrivée de `subject`/`collection` : une union TRANSITOIRE subsiste
   donc, mais elle ne franchit jamais une frontière de provenance.

   Et elle refuse l'ambiguïté au lieu de l'arbitrer. L'union-find est transitive :
   une seule page rattachée à deux sources suffirait à rechaîner leurs deux
   collections, de proche en proche, jusqu'à reconstituer la fusion massive qu'on
   vient de supprimer. Une page à provenance multiple — ou sans provenance — reste
   donc seule. Il n'y a ni provenance dominante, ni premier lien gagnant.
  */
  const provenanceOf = new Map<string, string | null>();
  for (const page of pages) {
    const sources = [...new Set((neighbours.get(page.id) ?? []).filter((id) => {
      const type = nodeById.get(id)?.type;
      return type === 'wiki-source' || type === 'raw-source';
    }))];
    if (nodeById.get(page.id)?.type === 'raw-source'
      || nodeById.get(page.id)?.type === 'wiki-source') {
      provenanceOf.set(page.id, page.id);
      continue;
    }
    provenanceOf.set(page.id, sources.length === 1 ? sources[0]! : null);
  }
  const seeded = new Map<string, string[]>();
  for (const page of pages) {
    const signal = page.group;
    const provenance = provenanceOf.get(page.id);
    if (!signal || !provenance) continue;
    const key = `${provenance}${familyKey(signal)}`;
    if (!seeded.has(key)) seeded.set(key, []);
    seeded.get(key)!.push(page.id);
  }
  for (const ids of seeded.values()) ids.slice(1).forEach((id) => unite(ids[0]!, id));

  const buckets = new Map<string, InventoryPage[]>();
  for (const page of pages) {
    const key = find(page.id);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(page);
  }
  const ordered = [...buckets.values()].map((members) => members.sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => a[0]!.id.localeCompare(b[0]!.id));
  const familyByPage = new Map<string, string>();
  ordered.forEach((members, index) => members.forEach((page) => familyByPage.set(page.id, `f${String(index + 1).padStart(4, '0')}`)));
  const familyLinks = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    const from = familyByPage.get(edge.from), to = familyByPage.get(edge.to);
    if (!from || !to || from === to) continue;
    if (!familyLinks.has(from)) familyLinks.set(from, new Set());
    if (!familyLinks.has(to)) familyLinks.set(to, new Set());
    familyLinks.get(from)!.add(to);
    familyLinks.get(to)!.add(from);
  }
  const families: InventoryFamily[] = ordered.map((members, index) => {
    const id = `f${String(index + 1).padStart(4, '0')}`;
    return {
      id,
      members: members.map((page) => page.id),
      titles: [...new Set(members.map((page) => page.title))].slice(0, 8),
      signals: [...new Set(members.flatMap((page) => [page.group, page.folder].filter((value): value is string => Boolean(value))))].slice(0, 6),
      collections: [...new Set(members.flatMap((page) => {
        const collection = collectionByRaw.get(page.id);
        return collection ? [collection] : [];
      }))].sort(),
      neighbours: [...(familyLinks.get(id) ?? [])].sort().slice(0, MAX_NEIGHBOURS),
      distinctiveTerms: [],
    };
  });

  /*
   Terme distinctif d'une étude au sein de sa collection comparative.

   Une collection compare N sujets ; ce qui identifie chacun est précisément ce
   que ses sœurs n'ont pas. Le terme se déduit donc du corpus par différence,
   sans qu'aucun produit soit connu du code : il apparaît dans les titres et
   chemins d'une famille, et dans aucune autre famille de la même collection.

   C'est le garde-fou qui manquait. Sans lui, le modèle nomme chaque feuille
   d'après la FONCTION du sujet — « planification », « visualisation » — et les
   sujets comparés disparaissent comme identités navigables : la carte devient
   une liste de fonctions dont on ne peut plus retrouver de qui elles parlent.
  */
  const familyById = new Map(families.map((family) => [family.id, family]));
  const termsOf = (family: InventoryFamily): Set<string> => new Set(
    [...family.titles, ...family.members.map((member) => member.replace(/\.md$/, '').split('/').pop() ?? '')]
      .flatMap((value) => familyKey(value).split(/[^a-z0-9]+/))
      .filter((token) => token.length >= 3 && !/^\d+$/.test(token)),
  );
  /*
   Fréquence d'un terme à l'échelle du corpus.

   Un token unique DANS sa collection n'est pas forcément une identité : deux
   documents rangés dans le même dossier diffèrent par mille accidents de
   nommage — « version », « source », « open », « etude ». Ces mots reviennent
   partout ailleurs dans le corpus, alors qu'un sujet nommé n'apparaît que chez
   lui. C'est cette rareté globale qui sépare une identité d'un accident, et
   elle se mesure sans connaître aucun produit.
  */
  const familyFrequency = new Map<string, number>();
  const allTerms = new Map<string, Set<string>>();
  for (const family of families) {
    const terms = termsOf(family);
    allTerms.set(family.id, terms);
    for (const token of terms) familyFrequency.set(token, (familyFrequency.get(token) ?? 0) + 1);
  }

  const byCollection = new Map<string, InventoryFamily[]>();
  for (const family of families) {
    for (const collection of family.collections) {
      if (!byCollection.has(collection)) byCollection.set(collection, []);
      byCollection.get(collection)!.push(family);
    }
  }
  for (const siblings of byCollection.values()) {
    // Une collection d'un seul membre ne compare rien : il n'y a pas de
    // différence à extraire, et tout terme paraîtrait distinctif.
    if (siblings.length < 2) continue;
    for (const family of siblings) {
      const own = allTerms.get(family.id)!;
      const shared = new Set<string>();
      for (const sibling of siblings) {
        if (sibling.id === family.id) continue;
        for (const token of allTerms.get(sibling.id)!) if (own.has(token)) shared.add(token);
      }
      familyById.get(family.id)!.distinctiveTerms = [...own]
        .filter((token) => !shared.has(token))
        // Le terme ne doit exister QUE chez cette famille dans tout le corpus.
        // Sinon il décrit un état, un format ou une activité partagés, et
        // l'imposer comme nom de communauté serait pire que de laisser choisir.
        .filter((token) => (familyFrequency.get(token) ?? 0) === 1)
        .sort()
        .slice(0, 4);
    }
  }

  const registry = options.registry ?? null;
  const communities: InventoryCommunity[] = registry
    ? registry.communities
        .filter((community) => !community.deprecated)
        .map((community) => {
          const members = Object.entries(registry.assignments)
            .filter(([, assignment]) => assignment.primaryCommunity === community.id)
            .map(([page]) => page);
          return {
            id: community.id,
            label: communityLabel(community, options.language),
            size: members.length,
            topPages: members
              .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))
              .slice(0, 5),
          };
        })
    : snapshot.communities.map((community) => ({
        id: community.id,
        label: community.label,
        size: community.documentCount,
        topPages: community.nodeIds.filter((id) => keptIds.has(id)).slice(0, 5),
      }));

  return {
    language: options.language,
    corpus: options.corpus ?? snapshot.structureEtag,
    pageCount: knowledge.length,
    pages,
    corpusPageIds: knowledge.map((node) => node.id).sort(),
    sampledPageIds: pages.map((page) => page.id).sort(),
    families,
    communities,
    truncated: ranked.length > kept.length,
  };
}
