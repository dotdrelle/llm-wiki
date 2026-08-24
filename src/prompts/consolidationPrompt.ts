import type { SourceDocument } from '../types.ts';
import type { SourceExtraction } from '../ingest/extractionSchema.ts';
import { EXTRACTION_KINDS } from '../ingest/extractionSchema.ts';
import { UNCLASSIFIED_CLASS, type ConceptGrid } from '../ingest/conceptGrid.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/** Prompt version, carried by the consolidation cache key. */
export const CONSOLIDATION_PROMPT_VERSION = 11;

export type ConsolidationInventoryPage = {
  path: string;
  title: string;
  subject: string | null;
  scope: string | null;
  /** Declared filing class, when this page has a grid — the axis a model must not merge across. */
  class: string | null;
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

 The conceptual budget stated here is a QUALITY control, not a blind cut. The
 defect it corrects is precise: on five comparative studies, the old path
 produced 4 concepts for one and 51 for another, with nothing in the content
 justifying the gap — only the heading split separated them. Asking for a
 justification per additional concept costs one sentence and makes the gap
 explainable.
*/
/**
 * The filing policy, which replaces the granularity policy once a grid exists.
 *
 * The granularity policy below asks the model to DECIDE which concepts the wiki
 * needs, one document at a time. No model answers that well from inside a
 * single document — it can only ever name what that document names — and that
 * is why the corpus filled with entity pages. With a grid the question becomes
 * one a small model answers reliably: given these classes and their membership
 * questions, where does this document's knowledge go.
 */
function filingPolicy(grid: ConceptGrid): string[] {
  const describe = (id: string): string => {
    const info = grid.info?.get(id);
    if (!info) return `- \`${id}\``;
    return `- \`${id}\` — ${info.label}${info.criterion ? ` · ${info.criterion}` : ''}`;
  };
  return [
    'Filing policy — the wiki has a CLOSED set of ranking classes:',
    ...grid.classes.map(describe),
    '',
    'You do NOT create classes. You FILE into the ones above.',
    '- ask the membership questions IN ORDER; the first positive answer is the primary class',
    '- the following positive answers are the secondary classes',
    '- a concept page is a LEAF: one subject seen under ONE class. Its path is exactly'
      + ' wiki/concepts/<class>/<subject>.md, and its "class" and "subject" fields must match that path',
    '- the same subject may hold a leaf under several classes: that is the model, not a duplicate.'
      + ' Each leaf carries only what belongs to ITS class — the market leaf does not restate the'
      + ' security leaf',
    '- create a leaf only when this source gives that (class, subject) pair at least two distinct'
      + ' things to say. A single passing mention stays in the source note',
    '- if a subject fits NO class, file its leaf under the reserved class `unclassified`'
      + ` (path wiki/concepts/${UNCLASSIFIED_CLASS}/<subject>.md). Never force it into the nearest`
      + ' class, and never invent a class for it',
    '- a leaf that already exists is UPDATED at its existing path, never recreated under another name',
    '',
    'Leaf content: a few lines saying what this source establishes about this subject under this'
      + ' class, then the citations. Not a copy of the source note.',
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
  collection: string | null;
  /** The workspace's closed set of classes; absent until the concepts pass has run. */
  grid?: ConceptGrid;
  ctx: PromptContext;
}): { system: string; user: string } {
  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You maintain a local-first markdown wiki.',
      'You receive structured findings extracted from ONE source document, already merged across its fragments.',
      'You decide, once, what the wiki should contain for this document.',
      '',
      ...(args.grid ? filingPolicy(args.grid) : legacyGranularityPolicy()),
      '',
      ...operationContract(args.grid),
    ].join('\n'),
    user: buildConsolidationUser(args),
  };
}

/**
 * The pre-grid policy: no closed set of classes exists yet, so every concept
 * page is a leaf under the reserved `unclassified` class. Nothing is invented,
 * and nothing is lost: the leaf waits there until a grid exists (or a human
 * files it into a real class).
 */
function legacyGranularityPolicy(): string[] {
  return [
    'Filing policy — the workspace has NO conceptual grid yet.',
    'Every concept page is a LEAF under the reserved class `unclassified`:',
    `- its path is exactly wiki/concepts/${UNCLASSIFIED_CLASS}/<subject>.md`,
    `- its "class" field is ${UNCLASSIFIED_CLASS}; its "subject" field is the canonical identity`,
    '- one leaf per subject, no matter how many angles this document treats it under',
    '- exactly one source note per document, at the given source note path',
    '- reuse or update an existing leaf before creating a near-duplicate',
    '- a leaf that already exists is UPDATED at its existing path, never recreated under another name',
    '- a characteristic that only makes sense for this one document stays in the source note',
    '- never create one page per heading of the source document',
  ];
}

/**
 * The operation contract, shared by both policies.
 *
 * `class` is added to the declared provenance only when a grid exists: asking
 * for a field against a vocabulary the workspace has not defined would invite
 * the model to invent one, which is the exact failure the grid removes.
 */
function operationContract(grid: ConceptGrid | undefined): string[] {
  return [
      'Allowed operation paths: wiki/index.md, wiki/concepts/**/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Every operation must include an explicit "type" and a full path starting with "wiki/".',
      'For create and update operations, "content" is REQUIRED and must be the COMPLETE final file content.',
      'Delete operations must omit "content".',
      'Every factual claim must carry the exact [src: ...] citation path from the user message, copied verbatim.',
      'Never use placeholders such as "...", "(existing content)", or omission markers.',
      'Always update wiki/index.md when creating or renaming pages.',
      '',
      'For every created or updated page, also return an entry in "pages" with its provenance:',
      '- subject: the canonical identity the page belongs to, lowercase, words separated by dashes — NEVER glue the words together ("twowordidentity" instead of "two-word-identity" is wrong), never use spaces',
      '- collection: the comparative set this document belongs to, when there is one',
      '- scope: source | product | transverse | workspace',
      `- kind: ${EXTRACTION_KINDS.join(' | ')} — the NATURE of the subject (a vendor is not its product, a dimension is not a product)`,
      ...(grid
        ? [
          `- class: the primary ranking class, one of: ${grid.classes.join(' | ')} | ${UNCLASSIFIED_CLASS}`,
          '- classSecondary: the other classes this page also speaks to, from the same list',
          '- class and subject MUST match the page path: wiki/concepts/<class>/<subject>.md',
        ]
        : []),
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
  collection: string | null;
}): string {
  return [
      '# Source document',
      `[src: ...] citation path (exact — copy verbatim into every citation): ${args.source.archiveCitationPath}`,
      `Title: ${args.source.title}`,
      `Source note path: ${args.sourcePagePath}`,
      args.collection ? `Detected collection: ${args.collection}` : 'Detected collection: (none)',
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
              // The field is optional on the schema side: the prompt must not
              // assume a model filled it.
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
              + `${page.class ? ` [class=${page.class}]` : ''}`
              + `${page.scope ? ` [scope=${page.scope}]` : ''}`
              + `${page.previousForSource ? ' [previously produced by THIS source]' : ''}`
              + `${page.subjectMatch ? ' [existing page for a closely related subject]' : ''}`
              + `\n  ${page.excerpt}`)
            .join('\n')
        : '(none)',
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
 *
 * The consolidation is a single stateless call per source. When the engine
 * detects that the plan split ONE identity into several concept pages, or that
 * it exceeded the concept budget, it re-asks with this instruction: the model
 * is told exactly which subjects to merge, and it re-answers on the same source.
 * The `system` prompt is reused verbatim — only the user message gains the
 * correction.
 */
export function buildConsolidationRetryUser(
  user: string,
  corrections: {
    splits?: Array<{ subject: string; duplicateOfSubject: string }>;
    overflow?: { newConcepts: number; budget: number };
    duplicatePaths?: string[];
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
      'Merge each into a single operation (a single update of the index, a single create per concept).',
    );
  }

  lines.push(
    '',
    'Keep exactly one source note at its path, and keep the wiki/index.md update. Only the concept pages change.',
    'Return the complete corrected plan (operations + pages), nothing else.',
    '',
    '--- previous instructions ---',
    user,
  );
  return lines.join('\n');
}
