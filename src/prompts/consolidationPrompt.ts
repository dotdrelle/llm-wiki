import type { SourceDocument } from '../types.ts';
import type { SourceExtraction } from '../ingest/extractionSchema.ts';
import { UNCLASSIFIED_CLASS } from '../ingest/conceptGrid.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/** Prompt version, carried by the consolidation cache key. */
export const CONSOLIDATION_PROMPT_VERSION = 18;

export type ConsolidationInventoryPage = {
  path: string;
  title: string;
  subject: string | null;
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
};

/*
 Consolidation prompt: one call, one source, one plan.

 The concept is the FOLDER the leaf lives in; `subject` is its canonical
 identity; `tags` are its multivalued links. There is no closed grid: the model
 files into an existing folder when the concept already exists (reuse before
 create), or proposes a new folder when the document genuinely introduces one.
*/

/**
 * The filing policy: folders are the concepts.
 */
function folderPolicy(existingFolders: string[]): string[] {
  return [
    'Filing policy — the concept is the FOLDER a page lives in.',
    `Existing concept folders: ${existingFolders.join(', ') || '(none yet)'}.`,
    '',
    '- a concept page is a LEAF: one subject seen under one concept. Its path is exactly'
      + ' wiki/concepts/<concept>/<subject>.md',
    '- the same subject may hold a leaf under several concepts: that is the model, not a'
      + ' duplicate. Each leaf carries only what belongs to ITS concept',
    '- an existing concept is ALWAYS an existing folder: REUSE one of the folders listed'
      + ' above whenever a subject plausibly belongs to it. "offre-marche" and'
      + ' "solutions-marche" are ONE concept — pick one and file the leaf there, never open'
      + ' a near-duplicate folder',
    '- open a NEW folder only when a subject fits NONE of the existing folders; name it a'
      + ' short kebab-case common noun phrase',
    '- create a leaf only when this source gives that (concept, subject) pair at least two'
      + ' distinct things to say. A single passing mention stays in the source note',
    '- if a subject fits NO concept, file its leaf under the reserved folder'
      + ` \`${UNCLASSIFIED_CLASS}\` (path wiki/concepts/${UNCLASSIFIED_CLASS}/<subject>.md).`
      + ' Never force it into the nearest folder',
    '- a leaf that already exists is UPDATED at its existing path, never recreated under'
      + ' another name',
    '',
    'Leaf content: a few lines saying what this source establishes about this subject under'
      + ' this concept, then the citations. Not a copy of the source note.',
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
      'Every factual claim must carry the exact [src: ...] citation path from the user message, copied verbatim.',
      'Never write a raw/ingested/ or raw/untracked/ path as bare text anywhere in the content — not even a header line naming the originating document ("Source: raw/...", "Origin: raw/..."). Every mention of that path, wherever it appears, MUST use the exact [src: <path>] form. A bare path is invisible to the citation machinery and never becomes a link.',
      'Never use placeholders such as "...", "(existing content)", or omission markers.',
      '',
      'For every created or updated page, also return an entry in "pages" with its provenance:',
      '- subject: the canonical identity the page belongs to, lowercase, words separated by dashes — NEVER glue the words together ("twowordidentity" instead of "two-word-identity" is wrong), never use spaces',
      '- scope: source | product | transverse | workspace',
      `- kind: vendor | product | requirement | regulation | dimension | scenario — the NATURE of the subject (a vendor is not its product, a dimension is not a product)`,
      '- tags: 2 to 4 words linking this leaf — its entity AND the cross-cutting themes it speaks to (security, sovereignty, cost, integration…). Each tag is a SINGLE word, in the SINGULAR, in the output language — never a plural (write "exigence", not "exigences"; "solution", not "solutions"). REUSE an existing tag from the "Existing tags" list in the user message when one is close, rather than inventing a near-synonym. At most 4 tags.',
      '- subject MUST match the page path: wiki/concepts/<concept>/<subject>.md',
      'Do NOT write these fields inside the page content; the engine writes them.',
      'Do not copy the free-form "group" field into "subject": a group is a shelf, a subject is an identity.',
      'A vendor and its product are DIFFERENT pages only when each carries durable, distinct knowledge; otherwise keep the vendor inside the product page. Never create a second product page for a product\'s sub-modules.',
      '',
      'Return a strict JSON object with { "summary": string, "operations": WikiOperation[], "pages": [] } and no extra text.',
  ];
}

function buildConsolidationUser(args: {
  source: SourceDocument;
  extraction: SourceExtraction;
  sourcePagePath: string;
  existingSourceNote: string | null;
  inventory: ConsolidationInventoryPage[];
  indexContent: string;
  existingFolders: string[];
  existingTags: string[];
}): string {
  return [
      '# Source document',
      `[src: ...] citation path (exact — copy verbatim into every citation): ${args.source.archiveCitationPath}`,
      `Title: ${args.source.title}`,
      `Source note path: ${args.sourcePagePath}`,
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
              `- ${subject.id} :: ${subject.label} [scope=${subject.scope} | kind=${subject.kind} | importance=${subject.importance}]`
              + `\n  why: ${subject.rationale}`
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
              + `${page.scope ? ` [scope=${page.scope}]` : ''}`
              + `${page.previousForSource ? ' [previously produced by THIS source]' : ''}`
              + `${page.subjectMatch ? ' [existing page for a closely related subject]' : ''}`
              + `\n  ${page.excerpt}`)
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
      `You created ${corrections.overflow.newConcepts} new concept pages for a budget of ${corrections.overflow.budget}. Merge related concepts so that at most ${corrections.overflow.budget} remain — several requirements of the same product belong in ONE page about that product, several sub-accounts belong in ONE page about the structure.`,
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
