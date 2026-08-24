import { z } from 'zod';
import type { ConceptGrid } from '../../../ingest/conceptGrid.ts';
import { labelTerms } from '../../../utils/labelTerms.ts';
import {
  forbiddenLabelReason,
  labelShapeIssue,
  MAX_LABEL_CHARS,
  MAX_LABEL_WORDS,
  normalizeLabel,
  REGISTRY_SCHEMA_VERSION,
  type TaxonomyRegistry,
} from './schema.ts';
import { KNOWLEDGE_ETAG_ALGORITHM } from './knowledge.ts';

/*
 Taxonomy DERIVED from the concept grid.

 The synthesis used to be asked one question — "group these pages" — and it
 answered it by clustering identities: one community per product, one per
 vendor, a four-page ceiling to keep them small. On a comparative corpus that
 produced nineteen communities for twenty-four pages, fourteen of them holding
 a single page, and an arrangement that changed between two runs because
 nothing anchored a group anywhere.

 With a grid, that question is already answered. The sub-domains ARE the
 classes, and a page's sub-domain is written in its own frontmatter, so the
 lower level of the tree needs no model at all: it is a join. What is left for
 the model is the one thing the grid does not say — how the classes gather into
 communities, and what those communities are called. That is a prompt over at
 most fifteen entries instead of the whole corpus, which is both cheaper and
 far more reliable on a local engine.

 The stability follows for free: the grid is a closed, versioned set, so two
 runs over an unchanged grid produce the same tree.
*/

/** A page as the derived synthesis needs it: two axes and a path. */
export type ClassedPage = {
  path: string;
  class: string | null;
  subject: string | null;
};

/** What the model is asked for: domains, and which class belongs to which. */
export const domainProposalSchema = z.object({
  domains: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
  classDomains: z.record(z.string(), z.string()),
});

export type DomainProposal = z.infer<typeof domainProposalSchema>;

/**
 * Where classless pages go.
 *
 * `unclassified` is in `FORBIDDEN_TAXONOMY_LABELS` — the model is not allowed
 * to invent it, because a model reaching for a catch-all is hiding a decision
 * it did not make. The ENGINE placing pages there is the opposite: it is
 * stating, in the tree itself, that these pages carry no class yet. The gap is
 * counted and reported rather than dissolved into a neighbouring community,
 * which is the same discipline `coverage.ts` applies to `Ungrouped`.
 */
export const UNCLASSIFIED_ID = 'unclassified';

const UNCLASSIFIED_LABELS: Record<string, string> = { fr: 'Non classé', en: 'Unclassified' };

/**
 * Domain-count bounds.
 *
 * A community is a collective that produces and consumes knowledge, so there
 * are only ever a handful. Below four classes there is nothing to gather and a
 * single domain is honest; above that, two is the floor — one domain holding
 * every class is a tree with no middle.
 */
export function domainBoundsForClasses(classCount: number): { min: number; max: number } {
  return { min: classCount >= 4 ? 2 : 1, max: 7 };
}

export function buildDomainSystemPrompt(language: string): string {
  return [
    'You gather the FILING CLASSES of a knowledge base into a few COMMUNITIES,',
    'and you name those communities.',
    '',
    'A community is a collective that produces and consumes knowledge, defined by',
    'what it HOLDS and what it DECIDES — not by a theme. Two classes belong to the',
    'same community when the same people answer for both.',
    '',
    'You do NOT reassign any document, and you do NOT rename any class. The',
    'classes are given; only their grouping and the community labels are yours.',
    '',
    'RULES:',
    `R1. Every class listed below appears exactly once in "classDomains".`,
    `R2. Each community gathers AT LEAST TWO classes, unless there are fewer than`,
    '    four classes in total.',
    `R3. Labels: a common noun phrase in ${language}, at most ${MAX_LABEL_WORDS} words and`,
    `    ${MAX_LABEL_CHARS} characters. FORBIDDEN: a catch-all (other, misc, various), a`,
    '    page scope (product, transverse, source, workspace), a vague abstraction.',
    'R4. NO TERM may be reused from one community label to another, and no two',
    '    labels may cover the same ground. If two communities need the same word,',
    '    they are one community.',
    'R5. A label names the collective, never one of the classes it gathers: do not',
    '    copy a class label into a community label.',
    '',
    'Return ONLY this JSON, nothing else:',
    '{"domains":[{"id":"d1","label":"…"}],"classDomains":{"<class id>":"d1"}}',
  ].join('\n');
}

export function buildDomainUserPrompt(
  grid: ConceptGrid,
  pageCountByClass: ReadonlyMap<string, number>,
  language: string,
): string {
  const lines = [`Language for every label: ${language}.`, '', 'Classes to gather:'];
  for (const id of grid.classes) {
    const info = grid.info?.get(id);
    const count = pageCountByClass.get(id) ?? 0;
    lines.push(`- ${id} :: ${info?.label ?? id} (${count} page(s))`);
    if (info?.criterion) lines.push(`  criterion: ${info.criterion}`);
  }
  const { min, max } = domainBoundsForClasses(grid.classes.length);
  lines.push('', `Produce ${min} to ${max} communities.`);
  return lines.join('\n');
}

export function buildDomainRetryPrompt(
  grid: ConceptGrid,
  issues: string[],
): string {
  return [
    'Your previous answer was rejected.',
    '',
    'Class ids — copy EXACTLY, all of them, none invented:',
    ...grid.classes.map((id) => `- ${id}`),
    '',
    'Fix EXACTLY these problems and return the complete JSON only:',
    ...issues.map((issue) => `- ${issue}`),
  ].join('\n');
}

/**
 * Everything wrong with a grouping proposal.
 *
 * R4 — no term shared between two community labels — is the one rule here that
 * a model cannot be trusted to self-check and that a machine checks perfectly.
 * It is also the rule that does the most work: two labels sharing a word are
 * almost always one community that was split for symmetry, and the resulting
 * pair reads as a distinction the corpus never made.
 */
export function validateDomainProposal(proposal: DomainProposal, grid: ConceptGrid): string[] {
  const issues: string[] = [];
  const domainIds = new Set(proposal.domains.map((domain) => domain.id));

  for (const [classId, domainId] of Object.entries(proposal.classDomains)) {
    if (!grid.set.has(classId)) issues.push(`unknown class "${classId}"`);
    if (!domainIds.has(domainId)) {
      issues.push(`class "${classId}" points at unknown community "${domainId}"`);
    }
  }
  for (const classId of grid.classes) {
    if (!(classId in proposal.classDomains)) issues.push(`class not gathered: "${classId}"`);
  }

  const { min, max } = domainBoundsForClasses(grid.classes.length);
  if (proposal.domains.length < min) {
    issues.push(`too few communities: ${proposal.domains.length} < ${min}`);
  }
  if (proposal.domains.length > max) {
    issues.push(`too many communities: ${proposal.domains.length} > ${max}`);
  }

  const classesByDomain = new Map<string, number>();
  for (const domainId of Object.values(proposal.classDomains)) {
    classesByDomain.set(domainId, (classesByDomain.get(domainId) ?? 0) + 1);
  }
  const minClasses = grid.classes.length >= 4 ? 2 : 1;
  for (const domain of proposal.domains) {
    const count = classesByDomain.get(domain.id) ?? 0;
    if (count === 0) issues.push(`community "${domain.label}" gathers no class`);
    else if (count < minClasses) {
      issues.push(
        `community "${domain.label}" gathers a single class — merge it into another community`,
      );
    }
  }

  const seenLabels = new Map<string, string>();
  const termOwner = new Map<string, string>();
  for (const domain of proposal.domains) {
    const shape = labelShapeIssue(domain.label);
    if (shape) {
      issues.push(`invalid community label "${domain.label}": ${shape}`);
      continue;
    }
    const forbidden = forbiddenLabelReason(domain.label);
    if (forbidden) issues.push(forbidden);

    const key = normalizeLabel(domain.label);
    const owner = seenLabels.get(key);
    if (owner) issues.push(`duplicate community label "${domain.label}" with "${owner}"`);
    else seenLabels.set(key, domain.label);

    for (const term of labelTerms(domain.label)) {
      const holder = termOwner.get(term);
      if (holder && holder !== domain.label) {
        issues.push(
          `communities "${holder}" and "${domain.label}" share the term "${term}" — labels must not overlap`,
        );
      } else {
        termOwner.set(term, domain.label);
      }
    }
  }

  return issues;
}

export type DerivedRegistry = { registry: TaxonomyRegistry; warnings: string[] };

/**
 * Builds the registry from the grid, the pages and the grouping.
 *
 * Everything below the community level is a join, never a decision:
 * - a class holding at least one page becomes a sub-domain;
 * - a page's sub-domain is the `class` in its own frontmatter;
 * - two pages sharing a `subject` under different classes are siblings, and
 *   each names the other's class in `relatedCommunities`.
 *
 * That last one is the transverse edge of the graph. It used to be inferred by
 * a model reading excerpts; here it falls out of the file names, so it is exact
 * and it costs nothing.
 */
export function buildDerivedRegistry(args: {
  grid: ConceptGrid;
  pages: ClassedPage[];
  proposal: DomainProposal;
  language: string;
  corpus: string;
  revision: number;
}): DerivedRegistry {
  const { grid, pages, proposal, language, corpus, revision } = args;
  const warnings: string[] = [];
  const domainId = (id: string) => `domain-${id}`;
  const communityId = (id: string) => `community-${id}`;

  const pagesByClass = new Map<string, ClassedPage[]>();
  const classless: ClassedPage[] = [];
  for (const page of pages) {
    if (page.class && grid.set.has(page.class)) {
      const bucket = pagesByClass.get(page.class);
      if (bucket) bucket.push(page);
      else pagesByClass.set(page.class, [page]);
    } else {
      classless.push(page);
    }
  }
  if (classless.length) {
    warnings.push(
      `${classless.length} page(s) carry no class of the grid and are gathered under "${UNCLASSIFIED_ID}"`,
    );
  }

  // Sibling classes of a subject: the transverse edge, computed.
  const classesBySubject = new Map<string, Set<string>>();
  for (const page of pages) {
    if (!page.subject || !page.class || !grid.set.has(page.class)) continue;
    const bucket = classesBySubject.get(page.subject);
    if (bucket) bucket.add(page.class);
    else classesBySubject.set(page.subject, new Set([page.class]));
  }

  const usedClasses = grid.classes.filter((id) => (pagesByClass.get(id)?.length ?? 0) > 0);
  const usedDomains = new Set(
    usedClasses.map((id) => proposal.classDomains[id]).filter((id): id is string => Boolean(id)),
  );

  const communities: TaxonomyRegistry['communities'] = [
    // A class the corpus does not populate is not published: an empty
    // community in the graph is a promise the wiki does not keep.
    ...proposal.domains
      .filter((domain) => usedDomains.has(domain.id))
      .map((domain) => ({
        id: domainId(domain.id),
        parentCommunity: null,
        prefLabel: { [language]: domain.label },
        firstSeenRevision: revision,
      })),
    ...usedClasses.map((id) => ({
      id: communityId(id),
      parentCommunity: domainId(proposal.classDomains[id]!),
      prefLabel: { [language]: grid.info?.get(id)?.label ?? id },
      firstSeenRevision: revision,
    })),
  ];

  if (classless.length) {
    communities.push(
      {
        id: domainId(UNCLASSIFIED_ID),
        parentCommunity: null,
        prefLabel: { [language]: UNCLASSIFIED_LABELS[language] ?? UNCLASSIFIED_LABELS.en! },
        firstSeenRevision: revision,
      },
      {
        id: communityId(UNCLASSIFIED_ID),
        parentCommunity: domainId(UNCLASSIFIED_ID),
        prefLabel: { [language]: UNCLASSIFIED_LABELS[language] ?? UNCLASSIFIED_LABELS.en! },
        firstSeenRevision: revision,
      },
    );
  }

  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const page of pages) {
    const own = page.class && grid.set.has(page.class) ? page.class : null;
    const siblings = own && page.subject
      ? [...(classesBySubject.get(page.subject) ?? [])].filter((id) => id !== own)
      : [];
    assignments[page.path] = {
      primaryCommunity: communityId(own ?? UNCLASSIFIED_ID),
      ...(siblings.length ? { relatedCommunities: siblings.map(communityId) } : {}),
    };
  }

  const pagePaths = pages.map((page) => page.path);
  return {
    warnings,
    registry: {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      revision,
      corpus,
      corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
      languages: [language],
      communities,
      assignments,
      corpusPageIds: pagePaths,
      sampledPageIds: pagePaths,
    },
  };
}
