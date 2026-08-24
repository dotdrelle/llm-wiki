/*
 * Simple, prompt-driven taxonomy synthesis.
 *
 * The full synthesis engine (inventory → collections → distinctive terms →
 * clustering → hysteresis) was over-engineered for a single-user, local-first
 * wiki: it accumulated machinery to fix past defects and ended up producing a
 * worse tree than a single, well-written prompt. This module replaces the core
 * with exactly that: read the pages, ask the model once for the tree, validate
 * coverage and labels, then write and publish. Persistence, the registry schema
 * and the graph UI are unchanged.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { mapWithConcurrency } from '../../../utils/concurrency.ts';
import { KNOWLEDGE_ETAG_ALGORITHM, knowledgeEtag, listKnowledgeFiles } from './knowledge.ts';
import { readConceptGrid, type ConceptGrid } from '../../../ingest/conceptGrid.ts';
import { readProvenance } from '../../../ingest/provenance.ts';
import {
  buildDerivedRegistry,
  buildDomainRetryPrompt,
  buildDomainSystemPrompt,
  buildDomainUserPrompt,
  domainProposalSchema,
  validateDomainProposal,
  type DomainProposal,
} from './derived.ts';
import {
  clearDirtyFlag,
  publishGeneration,
  readMarker,
  writeDirtyFlag,
  writeGeneration,
} from './store.ts';
import {
  forbiddenLabelReason,
  labelShapeIssue,
  MAX_LABEL_CHARS,
  MAX_LABEL_WORDS,
  normalizeLabel,
  REGISTRY_SCHEMA_VERSION,
  type TaxonomyRegistry,
} from './schema.ts';

export { extractTrailingJson } from '../../../utils/json.ts';

export type SimpleSynthesizeDeps = {
  /** Structured JSON completion of the configured LLM (jsonMode). Absent ⇒ nothing is attempted. */
  propose?: (request: { system: string; user: string }) => Promise<SimpleProposal>;
  expectedCorpus?: string;
  /**
   * Completion used by the DERIVED path, which asks a different question
   * (gather classes into communities) and therefore a different shape. Kept
   * separate from `propose` so a caller wiring one is never silently given the
   * other's schema. The derived path cannot reuse `propose`: that function
   * returns a `SimpleProposal` (`{domains, communities, assignments}`), and
   * feeding it the derived answer (`{domains, classDomains}`) fails inside
   * `propose` before `synthesizeDerived` ever sees the value. A workspace with
   * a grid therefore needs `proposeJson` wired to reach the derived path.
   */
  proposeJson?: (request: { system: string; user: string }) => Promise<unknown>;
};

export type SimpleSynthesizeOutcome =
  | { status: 'published'; revision: number; domains: number; leaves: number; pageCount: number; warnings: string[] }
  | { status: 'skipped'; reason: 'no_llm' | 'empty_corpus' }
  | { status: 'stale' }
  | { status: 'rejected'; issues: string[] };

const MAX_ATTEMPTS = 3;

/*
 * Single-pass synthesis prompt, defensively parsed.
 *
 * The prompt asks for JSON only, but nothing upstream guarantees a compliant
 * answer: `response_format: json_object` is not sent to every engine (see
 * `supportsJsonResponseFormat` in `config/engineCapabilities.ts`), and a
 * reasoning/agentic model can narrate — a preamble, a thinking trace, a
 * markdown fence — regardless of the instruction. The caller therefore parses
 * with `extractTrailingJson` (`jsonExtraction: 'trailing'`, re-exported from
 * `utils/json.ts` above): it reads the LAST balanced JSON object in the text,
 * tolerating anything before it. Coverage and every numeric/label rule below
 * are re-checked after the fact by `validateProposal`, which rejects and
 * retries with the exact list of problems — that loop, not the prompt
 * wording, is what actually guarantees a conformant proposal.
 */
const SYSTEM_TEMPLATE = [
  'You build a conceptual taxonomy of a knowledge wiki as a two-level tree:',
  'DOMAINS (broad) each containing COMMUNITIES, and communities hold the pages.',
  '',
  'CORPUS: {{N_PAGES}} pages. Output language for labels: {{LANGUAGE}}.',
  '',
  'Read the TITLE and CONTENT of every page in the user message.',
  '',
  'Each page carries a "kind", validated by the engine and authoritative:',
  'vendor | product | requirement | regulation | dimension | scenario.',
  'It names the NATURE of the page — trust it, do not re-derive it from prose.',
  '',
  'RULES:',
  'R1. A community = ONE IDENTITY (a concept, product, vendor, dimension), never a',
  '    file. Several pages naming the same thing = ONE community listing all of them.',
  'R2. Group by concept, not by file. ONE community: the same notion via several',
  '    vendors, a FR/EN duplicate, a strict subset, or a vendor and its product.',
  'R3. GUARD — a page APPLYING a transverse notion to one product stays in the',
  '    TRANSVERSE community, never the product community.',
  'R4. GUARD — every distinct vendor or product gets ITS OWN community. A label',
  '    like "solutions", "products", "tools" is FORBIDDEN.',
  'R5. SIZE LIMITS: {{MIN_DOMAINS}} to {{MAX_DOMAINS}} domains (aim for about',
  '    {{TARGET_COMMUNITIES}} communities total — fewer is fine on a small corpus);',
  '    each community 1 to 4 pages (a community with 5+ pages is a catch-all — split',
  '    it by identity); no domain over 35% of pages.',
  'R6. LABELS: meaningful common noun or short phrase, in {{LANGUAGE}}. HARD LIMIT:',
  '    at most {{MAX_LABEL_WORDS}} words and {{MAX_LABEL_CHARS}} characters — a phrase',
  '    with articles overflows this fast, prefer a terser noun phrase. FORBIDDEN: scope (product/transverse/',
  '    source/workspace), catch-all (divers/other/misc), vague abstraction',
  '    (indexation/discretion/elements/aspects).',
  'R7. PATHS: an "assignments" key is a page path copied VERBATIM, character for',
  '    character, from the "Pages" list below. Never invent, shorten, translate or',
  '    restructure a path — it is an opaque identifier, not something to redesign.',
  '    "assignments" must contain EXACTLY {{N_PAGES}} keys, one per page.',
  '',
  'Return ONLY this JSON, nothing else:',
  '{"domains":[{"id":"d1","label":"…"}],"communities":[{"id":"c1","label":"…","domain":"d1"}],"assignments":{"<page path>":"c1"}}',
].join('\n');

/**
 * Domain count bounds, shared by the prompt (as guidance) and
 * `validateProposal` (as the enforced rule) so the two can never diverge —
 * the prompt used to hardcode "4 to 7" while the validator allowed 2 on a
 * small corpus, silently contradicting what the model had just been told.
 */
export function domainBounds(pageCount: number): { min: number; max: number } {
  return { min: pageCount >= 20 ? 4 : 2, max: 7 };
}

export function buildSystemPrompt(nPages: number, language: string): string {
  const targetCommunities = Math.max(2, Math.round(nPages * 0.7));
  const { min: minDomains, max: maxDomains } = domainBounds(nPages);
  return SYSTEM_TEMPLATE
    .replaceAll('{{N_PAGES}}', String(nPages))
    .replaceAll('{{LANGUAGE}}', language)
    .replaceAll('{{MAX_LABEL_WORDS}}', String(MAX_LABEL_WORDS))
    .replaceAll('{{MAX_LABEL_CHARS}}', String(MAX_LABEL_CHARS))
    .replaceAll('{{MIN_DOMAINS}}', String(minDomains))
    .replaceAll('{{MAX_DOMAINS}}', String(maxDomains))
    .replaceAll('{{TARGET_COMMUNITIES}}', String(targetCommunities));
}

export const simpleSynthesisSchema = z.object({
  domains: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
  communities: z.array(z.object({ id: z.string(), label: z.string(), domain: z.string() })).min(1),
  assignments: z.record(z.string(), z.string()),
});

type SimpleProposal = z.infer<typeof simpleSynthesisSchema>;

interface PageBrief {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  excerpt: string;
  kind: string | null;
  scope: string | null;
  /** Filing class and identity, when the page carries them (see `conceptGrid.ts`). */
  class: string | null;
  subject: string | null;
}

function pageTitle(parsed: matter.GrayMatterFile<string>): string {
  if (typeof parsed.data?.title === 'string' && parsed.data.title.trim()) {
    return parsed.data.title.trim();
  }
  const heading = parsed.content.match(/^#\s+(.+)$/m);
  return heading ? heading[1]!.trim() : '';
}

/**
 * Enough to name a subject, not to summarize it — the corpus is read in full
 * on every `--apply` (attempt 0 only; retries reuse `buildRetryPrompt`, which
 * carries no excerpt), so this is paid once per page per run and dominates
 * the prompt: on a real corpus (54 pages) the previous 1200-char cap alone
 * put ~16k input tokens on the wire, which is minutes of prefill on a local
 * engine. A few sentences are enough for R1's "name what the page is about";
 * a whole page is not needed for that.
 */
const EXCERPT_CHARS = 400;

/** Bounded pool: an unbounded `Promise.all` would open one `readFile` per page at once. */
const PAGE_READ_CONCURRENCY = 8;

export async function readPageBriefs(rootDir: string, files: string[]): Promise<PageBrief[]> {
  return mapWithConcurrency(files, PAGE_READ_CONCURRENCY, (file) => readPageBrief(rootDir, file));
}

export async function readPageBrief(rootDir: string, file: string): Promise<PageBrief> {
  const raw = await readFile(path.join(rootDir, file), 'utf8');
  const parsed = matter(raw);
  const title = pageTitle(parsed);
  const excerpt = parsed.content.trim().slice(0, EXCERPT_CHARS);
  // Provenance is read through the validated reader, never from raw frontmatter:
  // an invalid `class`/`subject`/`kind`/`scope` must count as absent here, for
  // the same reason it does at ingest — otherwise the derived synthesis would
  // file a page under a class that was never validated.
  const provenance = readProvenance(raw);
  return {
    path: file,
    title: title || path.basename(file).replace(/\.md$/, ''),
    frontmatter: parsed.data as Record<string, unknown>,
    excerpt,
    kind: provenance.kind,
    scope: provenance.scope,
    class: provenance.class,
    subject: provenance.subject,
  };
}

export function buildSimplePrompt(pages: PageBrief[], language: string): string {
  const lines = [
    `Language for every label: ${language}.`,
    '',
    `Pages (${pages.length}):`,
    ...pages.map((page) =>
      `- ${page.path} :: ${page.title}` + (page.kind ? ` [kind=${page.kind}]` : '')),
    '',
    'kind is authoritative (validated by the engine): vendor | product | requirement | regulation | dimension | scenario. Group by kind FIRST, then by identity within a kind.',
    '',
    'Frontmatter (informative, not authoritative):',
    ...pages.map((page) => `- ${page.path}: ${JSON.stringify(page.frontmatter)}`),
    '',
    'Content preview of each page (first lines):',
    ...pages.map((page) => `- ${page.path}: ${page.excerpt || '(empty)'}`),
  ];
  return lines.join('\n');
}

/**
 * The retry prompt used to drop the page list entirely, replacing `user` with
 * only the issue list. Each call to `propose` is a fresh, stateless
 * completion (no conversation history) — so on retry the model no longer had
 * the ground-truth paths in front of it, and "fix these problems" became an
 * instruction to correct identity errors while blind to the correct
 * identities. Re-list the paths every retry, not the full excerpts/
 * frontmatter (already served their purpose in the first pass).
 */
export function buildRetryPrompt(pages: PageBrief[], issues: string[]): string {
  const { min: minDomains, max: maxDomains } = domainBounds(pages.length);
  return [
    'Your previous answer was rejected.',
    '',
    'Valid page paths — copy EXACTLY, do not invent, shorten or restructure any of them:',
    ...pages.map((page) => `- ${page.path}`),
    '',
    `Labels (domains and communities): at most ${MAX_LABEL_WORDS} words, ${MAX_LABEL_CHARS}`,
    `characters. Condense — drop articles and qualifiers — never copy a page title.`,
    '',
    `Structure: ${minDomains} to ${maxDomains} domains, EACH WITH AT LEAST 2 communities`,
    '(a domain with only one community must be merged into another domain, or split',
    'by moving one of its pages out to form a second community); each community',
    '1 to 4 pages; no domain over 35% of pages.',
    '',
    'Fix EXACTLY these problems and return the complete JSON only:',
    ...issues.map((issue) => `- ${issue}`),
  ].join('\n');
}

export function validateProposal(proposal: SimpleProposal, pages: PageBrief[], language: string): string[] {
  const issues: string[] = [];
  const pagePaths = new Set(pages.map((page) => page.path));
  const domainIds = new Set(proposal.domains.map((domain) => domain.id));
  const communityIds = new Set(proposal.communities.map((community) => community.id));

  for (const community of proposal.communities) {
    if (!domainIds.has(community.domain)) {
      issues.push(`community "${community.id}" references unknown domain "${community.domain}"`);
    }
  }

  // Coverage: exact, in both directions.
  const assigned = new Map<string, string>();
  for (const [page, community] of Object.entries(proposal.assignments)) {
    if (!pagePaths.has(page)) issues.push(`unknown page assigned: ${page}`);
    if (!communityIds.has(community)) issues.push(`page "${page}" assigned to unknown community "${community}"`);
    const previous = assigned.get(page);
    if (previous) issues.push(`page "${page}" assigned twice (${previous} and ${community})`);
    assigned.set(page, community);
  }
  for (const page of pages) {
    if (!assigned.has(page.path)) issues.push(`unassigned page: ${page.path}`);
  }
  for (const community of proposal.communities) {
    if (![...assigned.values()].some((id) => id === community.id)) {
      issues.push(`community without a page: "${community.id}"`);
    }
  }

  // Numerical bounds: a weak model cannot judge a catch-all, but it can count.
  const pagesByCommunity = new Map<string, number>();
  for (const community of Object.values(proposal.assignments)) {
    pagesByCommunity.set(community, (pagesByCommunity.get(community) ?? 0) + 1);
  }
  for (const [community, count] of pagesByCommunity) {
    if (count > 4) {
      issues.push(`community "${community}" holds ${count} pages, limit is 4 — split it by identity`);
    }
  }
  const { min: minDomains, max: maxDomains } = domainBounds(pages.length);
  if (proposal.domains.length < minDomains) {
    issues.push(`too few domains: ${proposal.domains.length} < ${minDomains}`);
  }
  if (proposal.domains.length > maxDomains) {
    issues.push(`too many domains: ${proposal.domains.length} > ${maxDomains}`);
  }
  const pagesByDomain = new Map<string, number>();
  for (const community of proposal.communities) {
    const count = pagesByCommunity.get(community.id) ?? 0;
    pagesByDomain.set(community.domain, (pagesByDomain.get(community.domain) ?? 0) + count);
  }
  const maxDomainPages = Math.max(2, Math.ceil(pages.length * 0.35));
  for (const domain of proposal.domains) {
    const children = proposal.communities.filter((community) => community.domain === domain.id);
    if (children.length < 2) issues.push(`domain "${domain.label}" has fewer than two communities`);
    const count = pagesByDomain.get(domain.id) ?? 0;
    if (count > maxDomainPages) {
      issues.push(`domain "${domain.label}" holds ${count} pages (${Math.round((count / pages.length) * 100)}%), limit is 35%`);
    }
  }

  // Labels: shape, uniqueness, no scope/catch-all.
  const seenDomainLabels = new Map<string, string>();
  for (const domain of proposal.domains) {
    const shapeIssue = labelShapeIssue(domain.label);
    if (shapeIssue) issues.push(`invalid domain label "${domain.label}": ${shapeIssue}`);
    else {
      const forbidden = forbiddenLabelReason(domain.label);
      if (forbidden) issues.push(forbidden);
    }
    const key = normalizeLabel(domain.label);
    const owner = seenDomainLabels.get(key);
    if (owner) issues.push(`duplicate domain label "${domain.label}" with "${owner}"`);
    else seenDomainLabels.set(key, domain.label);
  }
  const seenCommunityLabels = new Map<string, string>();
  for (const community of proposal.communities) {
    const shapeIssue = labelShapeIssue(community.label);
    if (shapeIssue) issues.push(`invalid community label "${community.label}": ${shapeIssue}`);
    else {
      const forbidden = forbiddenLabelReason(community.label);
      if (forbidden) issues.push(forbidden);
    }
    const key = `${community.domain}|${normalizeLabel(community.label)}`;
    const owner = seenCommunityLabels.get(key);
    if (owner) issues.push(`duplicate community label "${community.label}" in domain "${community.domain}"`);
    else seenCommunityLabels.set(key, community.label);
  }

  void language;
  return issues;
}

export function toRegistry(proposal: SimpleProposal, language: string, corpus: string, pagePaths: string[], revision: number): TaxonomyRegistry {
  const domainId = (id: string) => `domain-${id}`;
  const communityId = (id: string) => `community-${id}`;
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision,
    corpus,
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    languages: [language],
    communities: [
      ...proposal.domains.map((domain) => ({
        id: domainId(domain.id),
        parentCommunity: null,
        prefLabel: { [language]: domain.label },
        firstSeenRevision: revision,
      })),
      ...proposal.communities.map((community) => ({
        id: communityId(community.id),
        parentCommunity: domainId(community.domain),
        prefLabel: { [language]: community.label },
        firstSeenRevision: revision,
      })),
    ],
    assignments: Object.fromEntries(
      Object.entries(proposal.assignments).map(([page, community]) => [
        page,
        { primaryCommunity: communityId(community) },
      ]),
    ),
    corpusPageIds: pagePaths,
    sampledPageIds: pagePaths,
  };
}

/**
 * Marks a synthesis attempt as unresolved so `recovery.ts`/`coverage.ts` keep
 * signalling "a synthesis is owed" until a later run publishes or a
 * deterministic fallback takes over — mirrors the deleted engine's
 * `noteFailure`. Never called on a lost compare-and-swap race (`stale`):
 * there, a newer registry is already live, so nothing is actually pending.
 */
async function notePendingSynthesis(rootDir: string, corpus: string): Promise<void> {
  await writeDirtyFlag(rootDir, {
    kind: 'pendingSynthesis',
    corpus,
    baseRevision: (await readMarker(rootDir))?.revision ?? 0,
    at: Date.now(),
  }).catch(() => {});
}

/**
 * The derived path: the grid decides the sub-domains, the model only gathers.
 *
 * Everything below the community level is a join on the frontmatter, so the
 * retry loop guards a proposal about at most fifteen entries instead of the
 * whole corpus. Publication, the compare-and-swap and the pending-synthesis
 * signal are deliberately identical to the legacy path: the difference between
 * the two is where the tree comes from, never what happens to it afterwards.
 */
async function synthesizeDerived(
  rootDir: string,
  grid: ConceptGrid,
  pages: PageBrief[],
  corpus: string,
  options: { language: string },
  deps: SimpleSynthesizeDeps,
): Promise<SimpleSynthesizeOutcome> {
  const pageCountByClass = new Map<string, number>();
  for (const page of pages) {
    if (page.class && grid.set.has(page.class)) {
      pageCountByClass.set(page.class, (pageCountByClass.get(page.class) ?? 0) + 1);
    }
  }

  const system = buildDomainSystemPrompt(options.language);
  const user = buildDomainUserPrompt(grid, pageCountByClass, options.language);
  // The derived path needs the DOMAIN shape, which only `proposeJson` carries.
  // Falling back to `propose` here would hand a `SimpleProposal` to
  // `domainProposalSchema.parse` and burn all three retries on a shape that can
  // never pass — so there is no fallback: a derived synthesis without its own
  // completion is reported, never attempted with the wrong schema.
  const ask = deps.proposeJson;
  if (typeof ask !== 'function') return { status: 'skipped', reason: 'no_llm' };

  let proposal: DomainProposal | null = null;
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let parsed: DomainProposal;
    try {
      const answer = await ask({
        system,
        user: attempt === 0 ? user : buildDomainRetryPrompt(grid, lastIssues),
      });
      parsed = domainProposalSchema.parse(answer);
    } catch (error) {
      lastIssues = [`llm: ${error instanceof Error ? error.message : String(error)}`];
      continue;
    }
    const issues = validateDomainProposal(parsed, grid);
    if (issues.length === 0) {
      proposal = parsed;
      break;
    }
    lastIssues = issues;
  }

  if (!proposal) {
    await notePendingSynthesis(rootDir, corpus);
    return { status: 'rejected', issues: lastIssues };
  }

  const revision = ((await readMarker(rootDir))?.revision ?? 0) + 1;
  const { registry, warnings } = buildDerivedRegistry({
    grid,
    pages: pages.map((page) => ({ path: page.path, class: page.class, subject: page.subject })),
    proposal,
    language: options.language,
    corpus,
    revision,
  });
  const generation = await writeGeneration(rootDir, registry);
  const publish = await publishGeneration(rootDir, {
    corpus,
    registryRef: generation.ref,
    registryHash: generation.hash,
    expectedCorpus: corpus,
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
  });
  if (publish.status === 'stale') return { status: 'stale' };
  if (publish.status !== 'published') {
    await notePendingSynthesis(rootDir, corpus);
    return { status: 'stale' };
  }
  await clearDirtyFlag(rootDir).catch(() => {});

  return {
    status: 'published',
    revision,
    domains: new Set(registry.communities.filter((c) => !c.parentCommunity).map((c) => c.id)).size,
    leaves: registry.communities.filter((c) => c.parentCommunity).length,
    pageCount: pages.length,
    warnings,
  };
}

export async function synthesizeSimpleTaxonomy(
  rootDir: string,
  options: { language: string },
  deps: SimpleSynthesizeDeps = {},
): Promise<SimpleSynthesizeOutcome> {
  // Best-effort corpus for the catch block below: a failure before
  // `knowledgeEtag` resolves leaves this at '', matching the old engine's
  // `noteFailure(rootDir, '', ...)` on the same unreadable-corpus case.
  let corpus = '';
  try {
    const files = await listKnowledgeFiles(rootDir);
    if (!files.length) return { status: 'skipped', reason: 'empty_corpus' };
    if (typeof deps.propose !== 'function' && typeof deps.proposeJson !== 'function') {
      return { status: 'skipped', reason: 'no_llm' };
    }

    corpus = await knowledgeEtag(rootDir);
    if (deps.expectedCorpus !== undefined && deps.expectedCorpus !== corpus) {
      return { status: 'stale' };
    }

    const pages = await readPageBriefs(rootDir, files);

    /*
     With a grid, the sub-domains are already decided and the model is asked a
     much smaller question. Without one, the legacy clustering path stays — a
     workspace must keep a usable graph before its grid exists, and that is
     also the state in which the concepts pass itself runs.
    */
    const gridRead = await readConceptGrid(rootDir);
    if (gridRead.status === 'malformed') {
      await notePendingSynthesis(rootDir, corpus);
      return { status: 'rejected', issues: gridRead.issues };
    }
    if (gridRead.status === 'ok') {
      return await synthesizeDerived(rootDir, gridRead.grid, pages, corpus, options, deps);
    }

    // The legacy clustering path needs `propose` specifically; a caller wiring
    // only the derived `proposeJson` reaches this point on a grid-less
    // workspace and must be told, not given a half-wired synthesis.
    if (typeof deps.propose !== 'function') return { status: 'skipped', reason: 'no_llm' };

    const system = buildSystemPrompt(pages.length, options.language);
    const user = buildSimplePrompt(pages, options.language);

    let proposal: SimpleProposal | null = null;
    let lastIssues: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let parsed: SimpleProposal;
      try {
        parsed = await deps.propose({
          system,
          user: attempt === 0 ? user : buildRetryPrompt(pages, lastIssues),
        });
      } catch (error) {
        lastIssues = [`llm: ${error instanceof Error ? error.message : String(error)}`];
        continue;
      }
      const issues = validateProposal(parsed, pages, options.language);
      if (issues.length === 0) {
        proposal = parsed;
        break;
      }
      lastIssues = issues;
    }

    if (!proposal) {
      await notePendingSynthesis(rootDir, corpus);
      return { status: 'rejected', issues: lastIssues };
    }

    const revision = ((await readMarker(rootDir))?.revision ?? 0) + 1;
    const registry = toRegistry(proposal, options.language, corpus, files, revision);
    const generation = await writeGeneration(rootDir, registry);
    const publish = await publishGeneration(rootDir, {
      corpus,
      registryRef: generation.ref,
      registryHash: generation.hash,
      // The compare-and-swap must always guard against a corpus change during
      // the LLM round trip, using the value read at the START of this run —
      // `deps.expectedCorpus` is a different, optional precondition (checked
      // above, before any LLM call) for whether to even start; reusing it here
      // silently disabled the swap whenever a caller (e.g. the graph UI's
      // "Rebuild" button) omits it.
      expectedCorpus: corpus,
      corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    });
    if (publish.status === 'stale') {
      // Lost the race to a newer, already-published corpus: nothing is
      // actually pending, the live registry is already ahead of us.
      return { status: 'stale' };
    }
    if (publish.status !== 'published') {
      // A genuine publish failure (lock timeout, I/O) — unlike 'stale', this
      // one really did lose work, so the resumption signal must survive it.
      await notePendingSynthesis(rootDir, corpus);
      return { status: 'stale' };
    }
    await clearDirtyFlag(rootDir).catch(() => {});

    return {
      status: 'published',
      revision,
      domains: proposal.domains.length,
      leaves: proposal.communities.length,
      pageCount: pages.length,
      warnings: [],
    };
  } catch (error) {
    await notePendingSynthesis(rootDir, corpus);
    return { status: 'rejected', issues: [error instanceof Error ? error.message : String(error)] };
  }
}
