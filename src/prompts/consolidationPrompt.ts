import type { SourceDocument } from '../types.ts';
import type { SourceExtraction } from '../ingest/extractionSchema.ts';
import { UNCLASSIFIED_CLASS } from '../ingest/conceptGrid.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/** Prompt version, carried by the consolidation cache key. */
export const CONSOLIDATION_PROMPT_VERSION = 24;

export type ConsolidationInventoryPage = {
  path: string;
  title: string;
  subject: string | null;
  conceptId?: string | null;
  subjectId?: string | null;
  scope: string | null;
  /** The concept folder the leaf lives in (its path's first segment under wiki/concepts/). */
  folder: string | null;
  excerpt: string;
  /** True when this page was produced by THIS source in a previous ingest. */
  previousForSource?: boolean;
  /**
   * True when this page's subject plausibly matches a subject candidate of
   * THIS extraction, even though a different source produced the page.
   */
  subjectMatch?: boolean;
  /**
   * Provenance mode (§3.4): the page's FULL existing body, so an update
   * preserves every earlier statement instead of reconstructing it from a
   * truncated, whitespace-collapsed excerpt.
   */
  existingBody?: string;
  /** Provenance mode: bounded excerpts of the archives the page already cites. */
  sourceExcerpts?: Array<{ path: string; excerpt: string }>;
};

/*
 Consolidation prompt: one call, one source, one plan.

 The folder is a readable storage label and `concept_id` carries concept
 identity. `subject` is a display label and `subject_id` carries subject
 identity; tags are descriptive links. There is no closed vocabulary: the model
 reuses a relevant existing concept or proposes a distinct new grouping.
*/

/**
 * The filing policy: folders are the concepts.
 */
function folderPolicy(existingFolders: string[]): string[] {
  return [
    'Filing policy — a concept is a reusable knowledge grouping. Its folder name is a display label; the engine stores a separate opaque concept identity.',
    `Existing concept labels: ${existingFolders.join(', ') || '(none yet)'}.`,
    '',
    '- Reuse an existing concept when its meaning matches; compare the supplied page inventory and labels, not label spelling alone.',
    '- Labels may be written in any language and may be revised or translated. A label is not an identity and must not be used as a permanent key.',
    '- Propose a concise folder label only for a genuinely distinct grouping. Do not create a new grouping merely to restate a subject kind or a source-document structure.',
    '- A concept page describes the intersection of one subject and one concept. The same subject may have pages under multiple concepts when the source supports each relationship.',
    '- Create a leaf only when the source provides durable information worth retrieving later; keep incidental mentions in the source note.',
    `- If no suitable grouping exists, use the reserved folder \`${UNCLASSIFIED_CLASS}\` until a suitable concept is established.`,
    '- Reuse an existing page when it describes the same subject and concept, even if its display label differs. Preserve all existing supported content and citations.',
    '',
    'Leaf content: the page is the THEME, and it ACCUMULATES every source that speaks to it.'
      + ' Write the COMPLETE final content: keep what the page already states (its excerpt is in'
      + ' the inventory) and add what THIS source establishes — never drop an earlier statement or'
      + ' its citation when adding this source.',
    '- every claim carries its own citation [src: ...], copied from the user message. A citation'
      + ' MAY name a section of the source, as [src: <path>#<Section>], when only that section backs'
      + ' the claim; without a # it is the whole source',
    '- STRUCTURE it: short `##` headings grouping the claims by theme as soon as there are'
      + ' more than three, and a one-line summary before them',
    '- cover what the extracted facts actually contain for this pair. Being brief is not a'
      + ' goal: a page that drops half of what was extracted is a worse page, not a'
      + ' tighter one. Say each thing once, in the section where it belongs',
    '',
    'Also applies:',
    '- exactly one source note per document, at the given source note path',
    '- a characteristic that only makes sense for this one document stays in the source note',
    '- never create one page per heading of the source document',
  ];
}

export function buildConsolidationPrompt(args: {
  source: SourceDocument;
  extraction: SourceExtraction;
  sourcePagePath: string;
  existingSourceNote: string | null;
  inventory: ConsolidationInventoryPage[];
  indexContent: string;
  existingFolders: string[];
  existingTags: string[];
  /** Rendered locator catalogue the model copies tokens from. */
  locatorSection?: string;
  /** Add the harmonized source-page contract. */
  sourcePageContract?: boolean;
  /** Add the multi-source composition contract. */
  compositionContract?: boolean;
  ctx: PromptContext;
}): { system: string; user: string } {
  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You maintain a local-first markdown wiki.',
      'You receive structured findings extracted from ONE source document, already merged across its fragments.',
      'You decide, once, what the wiki should contain for this document.',
      '',
      'You ALWAYS produce exactly one source note for this document, at the given',
      'source note path — a create when it does not exist yet, an update when it',
      'does. Even when every concept page is already present and unchanged, the',
      'source note is part of the plan. An empty plan is never a correct answer.',
      '',
      ...folderPolicy(args.existingFolders),
      '',
      ...operationContract(),
      ...(args.sourcePageContract ? ['', ...sourcePageContract()] : []),
      ...(args.compositionContract ? ['', ...compositionContract()] : []),
    ].join('\n'),
    user: buildConsolidationUser(args),
  };
}

/**
 * The operation contract.
 */
function operationContract(): string[] {
  return [
      'Allowed operation paths: wiki/concepts/**/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Never propose an operation on wiki/index.md: it is regenerated automatically from wiki/concepts/** and wiki/sources/* after this plan is applied, and any content proposed for it is discarded.',
      'Every operation must include an explicit "type" and a full path starting with "wiki/".',
      'For create and update operations, "content" is REQUIRED and must be the COMPLETE final file content.',
      'Delete operations must omit "content".',
      'Cite each distinct source ONCE per section, on its own line at the end of that section, using the exact [src: ...] path from the user message copied verbatim. NOT on every claim: the export deduplicates a section\'s citations, so repeating the same path line after line changes nothing downstream while consuming the page — pages have been measured at 86% citation boilerplate and 14% knowledge. One occurrence per section is what provenance needs; the rest is padding.',
      'Never write a raw/ingested/ or raw/untracked/ path as bare text anywhere in the content — not even a header line naming the originating document ("Source: raw/...", "Origin: raw/..."). Every mention of that path, wherever it appears, MUST use the exact [src: <path>] form. A bare path is invisible to the citation machinery and never becomes a link.',
      'Never use placeholders such as "...", "(existing content)", or omission markers.',
      '',
      'For every created or updated page, also return an entry in "pages" with its provenance:',
      '- subject: a concise display label. The engine stores a separate opaque identity; choose wording that is natural for the workspace readers.',
      '- concept_id and subject_id: copy the corresponding UUID from the best matching inventory page when it represents the same concept or subject; otherwise return null. Never invent an identity. The engine assigns identities to new concepts and subjects.',
      '- scope and kind are optional descriptive metadata. Do not treat these labels as concept identity or as a fixed vocabulary.',
      '- tags: a small set of useful retrieval labels linking this leaf to related knowledge. Reuse an existing tag when its meaning matches; tags are descriptive metadata, not identity.',
      '- subject MUST match the page path: wiki/concepts/<concept>/<subject>.md',
      'Do NOT write these fields inside the page content; the engine writes them.',
      'Return concise display labels. Do not treat labels as identities; copy only UUIDs already present in the inventory.',
      '',
      'Return a strict JSON object with { "summary": string, "operations": WikiOperation[], "pages": [] } and no extra text.',
  ];
}

/**
 * Provenance-mode source-page contract (§2.2): one document, a common
 * template, and only what the document itself states — the weakly
 * interpretive reading sheet the resolver can trust.
 */
function sourcePageContract(): string[] {
  return [
    'SOURCE PAGE — provenance mode. The source note represents exactly ONE document:',
    '- report what THIS document says, and nothing else: no cross-document comparison,',
    '  recommendation or conclusion absent from the document;',
    '- keep numbers, dates, qualifications, reservations and contradictions verbatim;',
    '- open on the DOCUMENT TITLE as the page H1 (`# <title>`, the `Title:` value above),',
    '  never a generic `# Résumé` or `# Source note`; then a short `## Résumé`, then',
    '  `## <thème réellement présent>` sections, each ending with an ANCHORED citation to',
    '  its archive (`[src: <archive path>#<locator>]`);',
    '- its `subject` identifies the DOCUMENT rather than a concept-page subject;',
    '- announce any part of the document you could not address.',
  ];
}

/**
 * Provenance-mode composition contract. A leaf is the THEME for a subject:
 * when an existing leaf already cites other sources, this source's statements
 * are FOLDED into the relevant existing sections, not appended as a parallel
 * section, and no section repeats a source it draws nothing from.
 */
function compositionContract(): string[] {
  return [
    'LEAF COMPOSITION — provenance mode:',
    '- a leaf is the THEME for its subject across ALL sources: when the inventory shows',
    '  an existing page for this subject, extend its sections with what THIS source adds;',
    '  do not append a parallel section for the same theme, and do not create a second',
    '  leaf for a subject an existing page already covers;',
    '- TWO LEVELS: the source note cites its archive; a concept LEAF cites the SOURCE NOTE',
    '  (`[src: <source note path>]`, or `#<one of its section headings>` when only that',
    '  section backs the claim). A leaf NEVER cites raw/ingested/… directly — the archive',
    '  proof is reached through the source note. A bare source-note citation is accepted',
    '  and the engine anchors it to the source note section that backs the claim;',
    '- a section ends with EVERY source that backs it (one citation each), and with no',
    '  source it does not draw from;',
    '- a diff that adds a section repeating an already-covered theme for the same subject',
    '  is a worse page, not a richer one.',
  ];
}


// Bounded on purpose: the whole document would drown the facts it is meant to
// illustrate, and consolidation is called once per source. The tail is dropped
// rather than the head — a source document states its subject first.
const SOURCE_EXCERPT_MAX_CHARS = 4000;

function sourceExcerpt(body: string): string {
  const text = String(body ?? '').trim();
  if (!text) return '(empty document)';
  return text.length > SOURCE_EXCERPT_MAX_CHARS
    ? `${text.slice(0, SOURCE_EXCERPT_MAX_CHARS)}\n…[excerpt truncated]`
    : text;
}

export function buildConsolidationUser(args: {
  source: SourceDocument;
  extraction: SourceExtraction;
  sourcePagePath: string;
  existingSourceNote: string | null;
  inventory: ConsolidationInventoryPage[];
  indexContent: string;
  existingFolders: string[];
  existingTags: string[];
  locatorSection?: string;
}): string {
  return [
      '# Source document',
      `[src: ...] archive citation path (the SOURCE NOTE cites this exact archive path): ${args.source.archiveCitationPath}`,
      `[src: ...] leaf citation path (a concept LEAF cites the source note, never the archive directly): ${args.sourcePagePath}`,
      `Title: ${args.source.title}`,
      `Source note path: ${args.sourcePagePath}`,
      '',
      // Consolidation used to see ONLY the extracted facts, never the document.
      // Fidelity was therefore capped by the extraction pass with no way to
      // recover: a nuance it missed was lost for good, and measured end to end
      // the chain kept about 9% of the source material. The excerpt is bounded
      // and explicitly subordinate — the facts remain what must be covered; this
      // is here so a leaf can be written with the document's own wording and
      // detail rather than from a list of bare statements.
      '## Source excerpt (context only — the extracted facts below are what must be covered)',
      sourceExcerpt(args.source.body),
      '',
      '## Extracted facts',
      args.extraction.facts.length
        ? args.extraction.facts
            .map((fact) => `- ${fact.statement}${fact.subject ? ` [${fact.subject}]` : ''} [src: ${fact.citation}]`)
            .join('\n')
        : '(none)',
      '',
      '## Candidate subjects',
      args.extraction.subjects.length
        ? args.extraction.subjects
            .map((subject) =>
              `- ${subject.id} :: ${subject.label}`
              + (subject.rationale ? `\n  source rationale: ${subject.rationale}` : '')
              + (subject.relatedExistingPages?.length
                ? `\n  may extend: ${subject.relatedExistingPages.join(', ')}`
                : ''))
            .join('\n')
        : '(none)',
      args.extraction.mainSubject ? `\nMain subject candidate: ${args.extraction.mainSubject}` : '',
      '',
      '## Candidate relations',
      args.extraction.relations.length
        ? args.extraction.relations.map((relation) => `- ${relation.from} --${relation.kind}--> ${relation.to}`).join('\n')
        : '(none)',
      '',
      '## Existing source note',
      args.existingSourceNote ?? '(none yet)',
      '',
      '## Existing wiki pages that may already cover these subjects',
      args.inventory.length
        ? args.inventory
            .map((page) =>
              `- ${page.path} :: ${page.title}`
              + `${page.subject ? ` [subject=${page.subject}]` : ''}`
              + `${page.folder ? ` [concept=${page.folder}]` : ''}`
              + `${page.conceptId ? ` [concept_id=${page.conceptId}]` : ''}`
              + `${page.subjectId ? ` [subject_id=${page.subjectId}]` : ''}`
              + `${page.scope ? ` [scope=${page.scope}]` : ''}`
              + `${page.previousForSource ? ' [previously produced by THIS source]' : ''}`
              + `${page.subjectMatch ? ' [existing page for a closely related subject]' : ''}`
              + `\n  ${page.excerpt}`
              + (page.sourceExcerpts && page.sourceExcerpts.length
                ? '\n  already-cited sources — preserve the statements they back, with their citations:'
                  + page.sourceExcerpts.map((entry) => `\n  - ${entry.path}\n    ${entry.excerpt}`).join('')
                : '')
              + (page.existingBody
                ? `\n  FULL existing body to keep and extend:\n${page.existingBody.split('\n').map((line) => `    ${line}`).join('\n')}`
                : ''))
            .join('\n')
        : '(none)',
      '',
      '## Existing concept folders',
      args.existingFolders.length
        ? `File a subject into one of these folders when it is close, rather than opening a near-duplicate: ${args.existingFolders.join(', ')}.`
        : '(none yet)',
      '',
      '## Existing tags',
      args.existingTags.length
        ? `Reuse one of these when it matches, rather than inventing a near-synonym: ${args.existingTags.join(', ')}.`
        : '(none yet)',
      '',
      ...(args.locatorSection ? [args.locatorSection, ''] : []),
      '# Current wiki index',
      args.indexContent,
    ]
      .filter((line) => line !== '')
      .join('\n');
}

/**
 * The correction instruction appended to the user message on a consolidation
 * retry.
 */
export function buildConsolidationRetryUser(
  user: string,
  corrections: {
    splits?: Array<{ subject: string; duplicateOfSubject: string }>;
    overflow?: { newConcepts: number; budget: number };
    duplicatePaths?: string[];
    folders?: string[];
  },
): string {
  const lines: string[] = [
    'Your previous plan was rejected for its concept granularity.',
  ];

  if (corrections.splits?.length) {
    lines.push(
      '',
      'Merge each split back into ONE concept page:',
      ...corrections.splits.map((split) =>
        `- subject "${split.subject}" is the SAME thing as "${split.duplicateOfSubject}": update the "${split.duplicateOfSubject}" page with this content and DELETE the extra page`),
    );
  }

  if (corrections.overflow) {
    lines.push(
      '',
      `You created ${corrections.overflow.newConcepts} new concept pages for a budget of ${corrections.overflow.budget}. Reuse matching established concepts and merge only pages with the same stable subject and concept identities. Keep distinct supported knowledge separate.`,
    );
  }

  if (corrections.duplicatePaths?.length) {
    lines.push(
      '',
      'The plan targets these paths more than once:',
      ...corrections.duplicatePaths.map((path) => `- ${path}`),
      'Merge each into a single operation (a single create per concept, a single update per source note).',
    );
  }

  if (corrections.folders?.length) {
    lines.push(
      '',
      'When re-filing, reuse an existing concept folder rather than opening a near-duplicate. Existing folders:',
      ...corrections.folders.map((folder) => `- ${folder}`),
    );
  }

  lines.push(
    '',
    'Keep exactly one source note at its path. Only the concept pages change.',
    'Return the complete corrected plan (operations + pages), nothing else.',
    '',
    '--- previous instructions ---',
    user,
  );
  return lines.join('\n');
}
