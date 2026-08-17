import { z } from 'zod';
import type { TaxonomyInventory } from './inventory.ts';
import { isValidLabel, normalizeLabel } from './schema.ts';

/*
 Semantic synthesis of the taxonomy.

 Donna proposes, the engine validates. No product, synonym or domain is
 hard-coded — anywhere. The rules passed to the model are STRUCTURAL: one
 word, the configured language, no path, one common domain rather than one
 community per product. It is this last rule, and it alone, that must
 bring several neighboring products under a single conceptual domain: hard-coding it
 would produce a taxonomy that would not survive the next corpus.
*/

/*
 The proposal is a TREE, in a single call.

 A flat proposal had no way to express "these five products are
 five distinct subjects that fall under the same domain". Reducing the number of
 bubbles could therefore only aggregate — and a 142-page bubble destroys the
 navigation it pretended to simplify.
*/
export const taxonomyProposalSchema = z.object({
  /** Level visible on the map. Never carries a page directly. */
  domains: z.array(z.object({
    id: z.string(),
    label: z.string(),
    /** Scope of the domain, for diagnostics and disambiguation. */
    scopeNote: z.string().optional(),
  })).min(1),
  /** Leaf level: this one carries the pages. */
  communities: z.array(z.object({
    id: z.string(),
    label: z.string(),
    domain: z.string(),
    scopeNote: z.string().optional(),
  })).min(1),
  /** One key per family, towards a LEAF. An object forbids double assignment. */
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
  '- never name a community after the SCOPE of its pages (transverse, product,',
  '  source, workspace) nor after a catch-all label (divers, various, misc,',
  '  other, unclassified): those say how pages were produced or sorted, not',
  '  what they are about;',
  '- a SHARED dimension (a concern that several products implement, such as',
  '  security, integration, pricing, hosting or compliance) is ITS OWN subject:',
  '  give each dimension its own community, never gather several dimensions',
  '  under a single cross-cutting label;',
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
  '- infer domains from the supplied families themselves;',
  '- the previous communities listed in the prompt are continuity, not grouping',
  '  evidence: when a subject already named there is still present and unchanged,',
  '  reuse its existing label instead of inventing a new one, so a page keeps its',
  '  name from one run to the next.',
  '',
  'scopeNote is one short sentence saying what the domain covers and excludes.',
].join('\n');

/** What the model receives: never a whole page, never a tool name. */
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
      // What identifies this subject among the ones its collection compares. The
      // label of its community must preserve it.
      family.distinctiveTerms.length ? `identity=${family.distinctiveTerms.join(',')}` : null,
      family.collections.length ? `collections=${family.collections.join(',')}` : null,
      family.neighbours.length ? `links=${family.neighbours.join(',')}` : null,
    ].filter(Boolean).join(' | ');
    lines.push(`- ${family.id} :: ${family.titles.join(' ; ')} [${facts}]`);
    if (family.excerpt) lines.push(`    excerpt: ${family.excerpt}`);
  }

  // Only a published registry is a previous taxonomy the model may reuse. The
  // deterministic projection (a fresh corpus, no registry yet) is a fallback,
  // not continuity: reusing its group-derived labels would reintroduce exactly
  // the identity the engine removed, and its "Ungrouped" bucket contradicts the
  // catch-all rule above.
  if (inventory.communitiesFromRegistry && inventory.communities.length) {
    lines.push('');
    lines.push('Previous communities (continuity; reuse a matching label when the subject is unchanged):');
    for (const community of inventory.communities) {
      const facts = [
        `pages=${community.size}`,
        community.scopeNote ? `scope=${community.scopeNote}` : null,
        community.topPages.length ? `top=${community.topPages.join(', ')}` : null,
      ].filter(Boolean).join(' | ');
      lines.push(`- ${community.id} :: ${community.label} [${facts}]`);
    }
  }

  return lines.join('\n');
}

/**
 * Removes what carries nothing, before any validation.
 *
 * A community to which no family is assigned contains no
 * page: deleting it moves nothing, loses nothing and settles no
 * question of meaning. A domain emptied of its communities disappears likewise.
 *
 * The boundary is there, and it is clear: **the engine can remove what
 * carries nothing; it must never invent or move what carries something.**
 * An invented page, a page assigned twice, an incomplete coverage
 * or a label collision remain whole rejections, because
 * "repairing" them would mean deciding in the model's place.
 *
 * Rejecting an entire proposal — and paying three calls — for a typo
 * that the engine knows how to fix without risk is disproportionate: that was the
 * cause of three successive refusals on an otherwise correct corpus.
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

  // `domains` must stay non-empty for the schema: if everything disappeared, we return
  // the proposal as is and validation will say what is wrong.
  if (!domains.length || !communities.length) return { proposal, dropped: [] };
  return { proposal: { ...proposal, domains, communities }, dropped };
}

export type ProposalIssue = { path: string; reason: string };
/*
 Blocking versus advisory.

 Every quality rule had been written as a rejection. Result: five
 successive syntheses refused, each on a different criterion, without a
 single taxonomy being looked at. A rule that prevents seeing the
 result also prevents judging whether it was right.

 Only what makes the registry WRONG now blocks — an invented page,
 assigned twice, forgotten, an unreadable or colliding label. What
 falls under judgment — an erased subject identity, two compared subjects
 melted together — is published AND signalled: the user sees the map, reads what
 is wrong, and decides.
*/
export type ProposalCheck =
  | { ok: true; proposal: TaxonomyProposal; warnings: ProposalIssue[] }
  | { ok: false; issues: ProposalIssue[] };

/**
 * Validates a proposal **as a whole**, before any application.
 *
 * The Zod schema guarantees the shape; this check guarantees the contract:
 * conforming and unique labels, exact coverage of the submitted corpus, no
 * invented page. A non-conforming proposal is rejected entirely — never repaired
 * silently, never applied partially.
 */
export function checkProposal(
  proposal: TaxonomyProposal,
  inventory: TaxonomyInventory,
): ProposalCheck {
  const issues: ProposalIssue[] = [];
  const warnings: ProposalIssue[] = [];
  const known = new Set(inventory.families.map((family) => family.id));
  // Uniqueness per sibling group: the domains among themselves, then the communities within
  // a single domain. The map never displays two sibling groups at once.
  const seenLabels = new Map<string, number>();
  const domainIds = new Set<string>();
  const communityIds = new Set<string>();
  const communityDomain = new Map<string, string>();
  const childCount = new Map<string, number>();
  const communityUsage = new Map<string, number>();

  // Relative bound, not a hard-coded business truth: a taxonomy that
  // approaches one community per family is no longer a synthesis.
  const maxDomains = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, inventory.families.length)) * 1.5));
  if (proposal.domains.length > maxDomains) {
    issues.push({ path: 'domains', reason: `taxonomy too fragmented: ${proposal.domains.length} domains, maximum ${maxDomains}` });
  }

  proposal.domains.forEach((domain, index) => {
    const at = `domains[${index}]`;
    if (!domain.id.trim()) issues.push({ path: `${at}.id`, reason: 'empty identifier' });
    if (domainIds.has(domain.id)) issues.push({ path: `${at}.id`, reason: `duplicate identifier: ${domain.id}` });
    domainIds.add(domain.id);
    if (!isValidLabel(domain.label)) {
      issues.push({ path: `${at}.label`, reason: `invalid label: "${domain.label}"` });
    }
    const key = normalizeLabel(domain.label);
    const owner = seenLabels.get(key);
    if (owner !== undefined) {
      // The engine never invents a suffix: it returns the conflict for a
      // bounded re-synthesis.
      issues.push({ path: `${at}.label`, reason: `duplicate label with domains[${owner}]: "${domain.label}"` });
    } else {
      seenLabels.set(key, index);
    }

  });

  const siblingLabels = new Map<string, string>();
  proposal.communities.forEach((community, index) => {
    const at = `communities[${index}]`;
    if (!community.id.trim()) issues.push({ path: `${at}.id`, reason: 'empty identifier' });
    if (communityIds.has(community.id) || domainIds.has(community.id)) {
      issues.push({ path: `${at}.id`, reason: `duplicate identifier: ${community.id}` });
    }
    communityIds.add(community.id);
    if (!domainIds.has(community.domain)) {
      issues.push({ path: `${at}.domain`, reason: `unknown domain: ${community.domain}` });
    } else {
      communityDomain.set(community.id, community.domain);
      childCount.set(community.domain, (childCount.get(community.domain) ?? 0) + 1);
    }
    if (!isValidLabel(community.label)) {
      issues.push({ path: `${at}.label`, reason: `invalid label: "${community.label}"` });
    }
    const key = `${community.domain}|${normalizeLabel(community.label)}`;
    const owner = siblingLabels.get(key);
    if (owner) {
      issues.push({ path: `${at}.label`, reason: `duplicate label with ${owner} in the same domain: "${community.label}"` });
    } else {
      siblingLabels.set(key, community.id);
    }
  });

  for (const [family, target] of Object.entries(proposal.assignments)) {
    if (!known.has(family)) issues.push({ path: `assignments.${family}`, reason: `unknown family: ${family}` });
    if (domainIds.has(target)) {
      // This is exactly the door through which a domain becomes a catch-all.
      issues.push({ path: `assignments.${family}`, reason: `assignment to a domain, not to a community: ${target}` });
    } else if (!communityIds.has(target)) {
      issues.push({ path: `assignments.${family}`, reason: `unknown community: ${target}` });
    } else {
      communityUsage.set(target, (communityUsage.get(target) ?? 0) + 1);
    }
  }
  for (const family of inventory.families) {
    if (!(family.id in proposal.assignments)) issues.push({ path: 'assignments', reason: `unassigned family: ${family.id}` });
  }
  for (const community of communityIds) {
    if (!communityUsage.has(community)) issues.push({ path: 'assignments', reason: `community without a family: ${community}` });
  }
  /*
   Preservation of the identity of compared subjects.

   This is the semantic check that was missing: the sizes passed, the
   hierarchy passed, and yet each product had been renamed after its
   function — "planning", "visualization" — hence erased as a navigable
   identity. The distinctive term is derived from the corpus by difference; requiring
   that it survive in the label introduces no business vocabulary.
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
      // Judgment, not correction: the map stays usable, but the compared
      // subject loses its name there. We publish and we say it.
      warnings.push({
        path: `assignments.${family.id}`,
        reason: `identity lost: "${label}" preserves none of ${family.distinctiveTerms.join(', ')}`,
      });
    }
  }
  for (const [collection, byCommunity] of collectionMembers) {
    for (const [community, members] of byCommunity) {
      // Two compared subjects melted into the same leaf: the comparison
      // becomes invisible and one of the two disappears.
      if (members.length > 1) {
        warnings.push({
          path: 'assignments',
          reason: `collection ${collection}: ${members.join(', ')} share the community ${community}`,
        });
      }
    }
  }

  /*
   A domain with a single community is no longer a rejection.

   It adds a click without separating anything — but that is a FORM defect, not a
   meaning defect, and it has a deterministic correction: promote the single child to
   root rank. No page moves, no decision is taken in the model's
   place. Rejecting it made us pay three calls for a structure the
   engine knows how to flatten alone (cf. `collapseThinDomains`).

   Only the single irreparable variant remains here: a domain with no community
   at all, which normalization should have removed.
  */
  for (const domain of domainIds) {
    if ((childCount.get(domain) ?? 0) === 0) {
      issues.push({ path: 'communities', reason: `domain ${domain} without any community` });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, proposal, warnings };
}

/** Reminder of the conflict for a new attempt, without leaking an answer. */
export function retryHint(issues: ProposalIssue[]): string {
  const emptyCommunities = issues
    .map((issue) => issue.reason.match(/^community without a family: (.+)$/)?.[1])
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
