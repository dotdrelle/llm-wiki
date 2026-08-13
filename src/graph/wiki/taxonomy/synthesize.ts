import { z } from 'zod';
import type { TaxonomyInventory } from './inventory.ts';
import { isValidLabel, normalizeLabel } from './schema.ts';

/*
 Synthèse sémantique de la taxonomie.

 Donna propose, le moteur valide. Aucun produit, synonyme ni domaine n'est codé
 en dur — nulle part. Les règles transmises au modèle sont STRUCTURELLES : un
 mot, la langue configurée, pas de chemin, un domaine commun plutôt qu'une
 communauté par produit. C'est cette dernière règle, et elle seule, qui doit
 amener plusieurs produits voisins sous un même domaine conceptuel : l'écrire
 en dur produirait une taxonomie qui ne survivrait pas au prochain corpus.
*/

/*
 La proposition est un ARBRE, en un seul appel.

 Une proposition plate n'avait aucun moyen d'exprimer « ces cinq produits sont
 cinq sujets distincts qui relèvent du même domaine ». Réduire le nombre de
 bulles ne pouvait donc qu'agglomérer — et une bulle de 142 pages détruit la
 navigation qu'elle prétendait simplifier.
*/
export const taxonomyProposalSchema = z.object({
  /** Niveau visible sur la carte. Ne porte jamais de page directement. */
  domains: z.array(z.object({
    id: z.string(),
    label: z.string(),
    /** Portée du domaine, pour les diagnostics et la désambiguïsation. */
    scopeNote: z.string().optional(),
  })).min(1),
  /** Niveau feuille : c'est lui qui porte les pages. */
  communities: z.array(z.object({
    id: z.string(),
    label: z.string(),
    domain: z.string(),
    scopeNote: z.string().optional(),
  })).min(1),
  /** Une clé par famille, vers une FEUILLE. Un objet interdit la double affectation. */
  assignments: z.record(z.string(), z.string()),
});

export type TaxonomyProposal = z.infer<typeof taxonomyProposalSchema>;

export const SYNTHESIS_SYSTEM = [
  'You group the pages of a knowledge wiki into conceptual domains.',
  '',
  'Return JSON only, matching: {"domains":[{"id":"d1","label":"…","scopeNote":"…"}],'
  + '"communities":[{"id":"c1","label":"…","domain":"d1","scopeNote":"…"}],'
  + '"assignments":{"family-id":"c1"}}.',
  '',
  'The answer is a TWO-LEVEL TREE, produced in one pass:',
  '- domains are the few broad subjects shown on the map; they never hold pages;',
  '- communities are the subjects inside a domain; they hold the families;',
  '- a named product, tool or vendor is a COMMUNITY inside the domain naming the',
  '  concept it implements, never a domain of its own and never merged with its',
  '  peers into a single undifferentiated group;',
  '- every domain needs at least two communities, otherwise it adds a level',
  '  without separating anything;',
  '- never put every family under one community: a community that holds most of',
  '  the corpus is not a subject, it is the corpus with a name on it.',
  '',
  'Rules about each label:',
  '- exactly one word, no space, no slash, no underscore, no path;',
  '- written in the requested language;',
  '- a meaningful common noun that names the DOMAIN, not one of its items;',
  '- name what the pages are ABOUT or the purpose their subjects serve; never',
  '  name the document form or editorial activity (study, analysis, comparison,',
  '  report, synthesis, documentation);',
  '- unique among SIBLINGS, compared case- and accent-insensitively: two domains',
  '  never share a label, and two communities of the same domain never do; the',
  '  same label under two different domains is fine.',
  '',
  'Rules about grouping:',
  '- assign FAMILIES, never individual pages; a family is an indivisible structural unit;',
  '- create a small set of broad, useful domains rather than many narrow ones;',
  '- families from one comparative collection share a DOMAIN, but each subject',
  '  they compare keeps its own community: comparing things is a relation between',
  '  them, not a reason to merge them;',
  '- when a family carries identity=…, its community label MUST be one of those',
  '  terms: they are what distinguishes this subject from the ones it is compared',
  '  with. Naming that community after what the subject DOES instead erases the',
  '  subject itself, and the reader can no longer navigate to it;',
  '- two families of the same comparative collection never share a community;',
  '- prefer one common domain over one community per product, tool or vendor:',
  '  named products that serve the same purpose belong together under the',
  '  concept they implement, named after that concept rather than after the',
  '  fact that the corpus studies or compares them;',
  '- keep a proper noun as its own domain only when the corpus shows it is',
  '  genuinely an autonomous subject, with its own pages and its own vocabulary,',
  '  rather than one instance among several of a broader idea;',
  '- merge variants that designate the same domain;',
  '- every family given to you must occur exactly once as a key in assignments;',
  '- every assignment value must reference one declared COMMUNITY id, never a domain;',
  '- infer domains from the supplied families themselves; previous automatic',
  '  communities are continuity metadata, never semantic evidence.',
  '',
  'scopeNote is one short sentence saying what the domain covers and excludes.',
].join('\n');

/** Ce que le modèle reçoit : jamais une page entière, jamais un nom d'outil. */
export function buildSynthesisPrompt(inventory: TaxonomyInventory): string {
  const lines: string[] = [
    `Language for every label: ${inventory.language}.`,
    `Corpus: ${inventory.pageCount} pages${inventory.truncated ? ' (only the most connected ones are listed)' : ''}.`,
    '',
  ];

  lines.push(`Families (${inventory.families.length}; assign every id exactly once):`);
  for (const family of inventory.families) {
    const facts = [
      `pages=${family.members.length}`,
      family.signals.length ? `signals=${family.signals.join(',')}` : null,
      // Ce qui identifie ce sujet parmi ceux que sa collection compare. Le
      // libellé de sa communauté doit le conserver.
      family.distinctiveTerms.length ? `identity=${family.distinctiveTerms.join(',')}` : null,
      family.collections.length ? `collections=${family.collections.join(',')}` : null,
      family.neighbours.length ? `links=${family.neighbours.join(',')}` : null,
    ].filter(Boolean).join(' | ');
    lines.push(`- ${family.id} :: ${family.titles.join(' ; ')} [${facts}]`);
  }

  return lines.join('\n');
}

/**
 * Retire ce qui ne porte rien, avant toute validation.
 *
 * Une communauté à laquelle aucune famille n'est affectée ne contient aucune
 * page : la supprimer ne déplace rien, ne perd rien et ne tranche aucune
 * question de sens. Un domaine vidé de ses communautés disparaît de même.
 *
 * La frontière est là, et elle est nette : **le moteur peut retirer ce qui ne
 * porte rien ; il ne doit jamais inventer ni déplacer ce qui porte quelque
 * chose.** Une page inventée, une page affectée deux fois, une couverture
 * incomplète ou une collision de libellés restent des rejets en bloc, parce
 * que les « réparer » reviendrait à décider à la place du modèle.
 *
 * Rejeter une proposition entière — et payer trois appels — pour une coquille
 * que le moteur sait corriger sans risque est disproportionné : c'était la
 * cause de trois refus successifs sur un corpus par ailleurs correct.
 */
export function normalizeProposal(proposal: TaxonomyProposal): {
  proposal: TaxonomyProposal;
  dropped: string[];
} {
  const used = new Set(Object.values(proposal.assignments));
  const communities = proposal.communities.filter((community) => used.has(community.id));
  const keptDomains = new Set(communities.map((community) => community.domain));
  const domains = proposal.domains.filter((domain) => keptDomains.has(domain.id));

  const dropped = [
    ...proposal.communities.filter((item) => !used.has(item.id)).map((item) => `community:${item.id}`),
    ...proposal.domains.filter((item) => !keptDomains.has(item.id)).map((item) => `domain:${item.id}`),
  ];

  // `domains` doit rester non vide pour le schéma : si tout a disparu, on rend
  // la proposition telle quelle et la validation dira ce qui ne va pas.
  if (!domains.length || !communities.length) return { proposal, dropped: [] };
  return { proposal: { ...proposal, domains, communities }, dropped };
}

export type ProposalIssue = { path: string; reason: string };
/*
 Bloquant contre consultatif.

 Toute règle de qualité avait été écrite comme un rejet. Résultat : cinq
 synthèses successives refusées, chacune sur un critère différent, sans qu'une
 seule taxonomie ait pu être regardée. Une règle qui empêche de voir le
 résultat empêche aussi de juger si elle avait raison.

 Ne bloque désormais que ce qui rend le registre FAUX — une page inventée,
 affectée deux fois, oubliée, un libellé illisible ou en collision. Ce qui
 relève du jugement — une identité de sujet effacée, deux sujets comparés
 fondus — est publié ET signalé : l'utilisateur voit la carte, lit ce qui
 cloche, et décide.
*/
export type ProposalCheck =
  | { ok: true; proposal: TaxonomyProposal; warnings: ProposalIssue[] }
  | { ok: false; issues: ProposalIssue[] };

/**
 * Valide une proposition **en bloc**, avant toute application.
 *
 * Le schéma Zod garantit la forme ; ce contrôle garantit le contrat : libellés
 * conformes et uniques, couverture exacte du corpus soumis, aucune page
 * inventée. Une proposition non conforme est rejetée entière — jamais réparée
 * en silence, jamais appliquée partiellement.
 */
export function checkProposal(
  proposal: TaxonomyProposal,
  inventory: TaxonomyInventory,
): ProposalCheck {
  const issues: ProposalIssue[] = [];
  const warnings: ProposalIssue[] = [];
  const known = new Set(inventory.families.map((family) => family.id));
  // Unicité par fratrie : les domaines entre eux, puis les communautés au sein
  // d'un même domaine. La carte n'affiche jamais deux fratries à la fois.
  const seenLabels = new Map<string, number>();
  const domainIds = new Set<string>();
  const communityIds = new Set<string>();
  const communityDomain = new Map<string, string>();
  const childCount = new Map<string, number>();
  const communityUsage = new Map<string, number>();

  // Borne relative, pas une vérité métier codée en dur : une taxonomie qui
  // approche une communauté par famille n'est plus une synthèse.
  const maxDomains = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, inventory.families.length)) * 1.5));
  if (proposal.domains.length > maxDomains) {
    issues.push({ path: 'domains', reason: `taxonomie trop fragmentée : ${proposal.domains.length} domaines, maximum ${maxDomains}` });
  }

  proposal.domains.forEach((domain, index) => {
    const at = `domains[${index}]`;
    if (!domain.id.trim()) issues.push({ path: `${at}.id`, reason: 'identifiant vide' });
    if (domainIds.has(domain.id)) issues.push({ path: `${at}.id`, reason: `identifiant en double : ${domain.id}` });
    domainIds.add(domain.id);
    if (!isValidLabel(domain.label)) {
      issues.push({ path: `${at}.label`, reason: `libellé invalide : « ${domain.label} »` });
    }
    const key = normalizeLabel(domain.label);
    const owner = seenLabels.get(key);
    if (owner !== undefined) {
      // Le moteur n'invente jamais de suffixe : il renvoie le conflit pour une
      // re-synthèse bornée.
      issues.push({ path: `${at}.label`, reason: `libellé en double avec domains[${owner}] : « ${domain.label} »` });
    } else {
      seenLabels.set(key, index);
    }

  });

  const siblingLabels = new Map<string, string>();
  proposal.communities.forEach((community, index) => {
    const at = `communities[${index}]`;
    if (!community.id.trim()) issues.push({ path: `${at}.id`, reason: 'identifiant vide' });
    if (communityIds.has(community.id) || domainIds.has(community.id)) {
      issues.push({ path: `${at}.id`, reason: `identifiant en double : ${community.id}` });
    }
    communityIds.add(community.id);
    if (!domainIds.has(community.domain)) {
      issues.push({ path: `${at}.domain`, reason: `domaine inconnu : ${community.domain}` });
    } else {
      communityDomain.set(community.id, community.domain);
      childCount.set(community.domain, (childCount.get(community.domain) ?? 0) + 1);
    }
    if (!isValidLabel(community.label)) {
      issues.push({ path: `${at}.label`, reason: `libellé invalide : « ${community.label} »` });
    }
    const key = `${community.domain}|${normalizeLabel(community.label)}`;
    const owner = siblingLabels.get(key);
    if (owner) {
      issues.push({ path: `${at}.label`, reason: `libellé en double avec ${owner} dans le même domaine : « ${community.label} »` });
    } else {
      siblingLabels.set(key, community.id);
    }
  });

  for (const [family, target] of Object.entries(proposal.assignments)) {
    if (!known.has(family)) issues.push({ path: `assignments.${family}`, reason: `famille inconnue : ${family}` });
    if (domainIds.has(target)) {
      // C'est exactement la porte par laquelle un domaine devient un fourre-tout.
      issues.push({ path: `assignments.${family}`, reason: `affectation à un domaine, pas à une communauté : ${target}` });
    } else if (!communityIds.has(target)) {
      issues.push({ path: `assignments.${family}`, reason: `communauté inconnue : ${target}` });
    } else {
      communityUsage.set(target, (communityUsage.get(target) ?? 0) + 1);
    }
  }
  for (const family of inventory.families) {
    if (!(family.id in proposal.assignments)) issues.push({ path: 'assignments', reason: `famille non affectée : ${family.id}` });
  }
  for (const community of communityIds) {
    if (!communityUsage.has(community)) issues.push({ path: 'assignments', reason: `communauté sans famille : ${community}` });
  }
  /*
   Conservation de l'identité des sujets comparés.

   C'est le contrôle sémantique qui manquait : les tailles passaient, la
   hiérarchie passait, et pourtant chaque produit avait été renommé d'après sa
   fonction — « planification », « visualisation » — donc effacé comme identité
   navigable. Le terme distinctif est déduit du corpus par différence ; exiger
   qu'il survive dans le libellé n'introduit aucun vocabulaire métier.
  */
  const labelOfCommunity = new Map(proposal.communities.map((item) => [item.id, item.label]));
  const collectionMembers = new Map<string, Map<string, string[]>>();
  for (const family of inventory.families) {
    const target = proposal.assignments[family.id];
    if (!target) continue;
    for (const collection of family.collections) {
      if (!collectionMembers.has(collection)) collectionMembers.set(collection, new Map());
      const byCommunity = collectionMembers.get(collection)!;
      byCommunity.set(target, [...(byCommunity.get(target) ?? []), family.id]);
    }
    if (!family.distinctiveTerms.length) continue;
    const label = labelOfCommunity.get(target);
    if (label === undefined) continue;
    const normalized = normalizeLabel(label);
    const keeps = family.distinctiveTerms.some(
      (term) => normalized === term || normalized.includes(term) || term.includes(normalized),
    );
    if (!keeps) {
      // Jugement, pas correction : la carte reste utilisable, mais le sujet
      // comparé y perd son nom. On publie et on le dit.
      warnings.push({
        path: `assignments.${family.id}`,
        reason: `identité perdue : « ${label} » ne conserve aucun de ${family.distinctiveTerms.join(', ')}`,
      });
    }
  }
  for (const [collection, byCommunity] of collectionMembers) {
    for (const [community, members] of byCommunity) {
      // Deux sujets comparés fondus dans une même feuille : la comparaison
      // devient invisible et l'un des deux disparaît.
      if (members.length > 1) {
        warnings.push({
          path: 'assignments',
          reason: `collection ${collection} : ${members.join(', ')} partagent la communauté ${community}`,
        });
      }
    }
  }

  /*
   Un domaine à une seule communauté n'est plus un rejet.

   Il ajoute un clic sans rien séparer — mais c'est un défaut de FORME, pas de
   sens, et il a une correction déterministe : promouvoir l'enfant unique au
   rang de racine. Aucune page ne bouge, aucune décision n'est prise à la place
   du modèle. Le rejeter faisait payer trois appels pour une structure que le
   moteur sait aplatir seul (cf. `collapseThinDomains`).

   Reste ici la seule variante irréparable : un domaine sans aucune communauté,
   que la normalisation aurait dû retirer.
  */
  for (const domain of domainIds) {
    if ((childCount.get(domain) ?? 0) === 0) {
      issues.push({ path: 'communities', reason: `domaine ${domain} sans aucune communauté` });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, proposal, warnings };
}

/** Rappel du conflit pour une nouvelle tentative, sans souffler de réponse. */
export function retryHint(issues: ProposalIssue[]): string {
  const emptyCommunities = issues
    .map((issue) => issue.reason.match(/^communauté sans famille : (.+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
  return [
    'The previous answer was rejected. Fix exactly these problems and answer again:',
    ...issues.slice(0, 40).map((issue) => `- ${issue.path}: ${issue.reason}`),
    ...(emptyCommunities.length ? [
      '',
      `Unused communities: ${emptyCommunities.join(', ')}.`,
      'For every unused community, choose exactly one of these corrections:',
      '- assign at least one appropriate family to it; or',
      '- remove it from the communities array entirely.',
      'Return the COMPLETE JSON object and verify that every declared community',
      'is referenced by at least one assignments value. Do not leave placeholders.',
    ] : []),
  ].join('\n');
}

export function semanticReviewPrompt(
  inventory: TaxonomyInventory,
  proposal: TaxonomyProposal,
): string {
  return [
    buildSynthesisPrompt(inventory),
    '',
    'MANDATORY SEMANTIC REVIEW OF THIS STRUCTURALLY VALID DRAFT:',
    JSON.stringify(proposal),
    '',
    'Return the complete corrected JSON object.',
    'Audit every label by asking: “what subject, category, or purpose are these pages about?”',
    'A label that answers “what did the authors do?” or names a document form is invalid,',
    'even when it is one word. Replace it with the shared category or purpose of the subjects.',
    'Keep assignments exhaustive and keep comparative products together.',
  ].join('\n');
}
