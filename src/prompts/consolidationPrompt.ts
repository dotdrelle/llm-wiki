import type { SourceDocument } from '../types.ts';
import type { SourceExtraction } from '../ingest/extractionSchema.ts';
import { EXTRACTION_KINDS } from '../ingest/extractionSchema.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/** Prompt version, carried by the consolidation cache key. */
export const CONSOLIDATION_PROMPT_VERSION = 10;

export type ConsolidationInventoryPage = {
  path: string;
  title: string;
  subject: string | null;
  scope: string | null;
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
export function buildConsolidationPrompt(args: {
  source: SourceDocument;
  extraction: SourceExtraction;
  sourcePagePath: string;
  existingSourceNote: string | null;
  inventory: ConsolidationInventoryPage[];
  indexContent: string;
  collection: string | null;
  ctx: PromptContext;
}): { system: string; user: string } {
  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You maintain a local-first markdown wiki.',
      'You receive structured findings extracted from ONE source document, already merged across its fragments.',
      'You decide, once, what the wiki should contain for this document.',
      '',
      'Granularity policy:',
      '- exactly one source note per document, at the given source note path',
      '- product concepts: at most three NEW ones per source, each justified by content; zero is common',
      '- create a NEW product concept only for knowledge that is durable, specific to this product, and genuinely distinct from any existing page',
      '- transverse dimensions are SHARED concepts: create or UPDATE one shared concept per TOP-LEVEL dimension with scope=transverse — never one per product, and never one per sub-element of a single product (a list entry, a referential entry, a sub-account, a section are parts of the product, not dimensions)',
      '- several sub-elements of the same product (several sub-accounts, referential entries, or sections of one structure) belong in ONE concept page about that product\'s structure, not in several pages',
      '- reuse or update an existing concept page (product or transverse) before creating a near-duplicate',
      '- when a candidate subject matches a page this source PREVIOUSLY produced, UPDATE that page and KEEP its existing subject: never create a new page with a different name for the same product',
      '- a page marked "existing page for a closely related subject" below was produced by a DIFFERENT source but plausibly names the same real-world thing: verify against its excerpt, and if it is the same subject, UPDATE it and keep its existing subject rather than creating a new page — this is exactly how the same product ends up split into several near-duplicate pages across sources',
      '- the NUMBER of new pages must be justified by the content, not uniform: unrelated documents should yield different counts',
      '- a characteristic that only makes sense for this one document stays in the source note',
      '- never create a page for a one-off datum or for a documentary rubric of the source',
      '- never create one page per heading of the source document',
      '',
      'Allowed operation paths: wiki/index.md, wiki/concepts/**/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Every operation must include an explicit "type" and a full path starting with "wiki/".',
      'For create and update operations, "content" is REQUIRED and must be the COMPLETE final file content.',
      'Delete operations must omit "content".',
      'Every factual claim must carry the exact [src: ...] citation path from the user message, copied verbatim.',
      'Never use placeholders such as "...", "(existing content)", or omission markers.',
      'Always update wiki/index.md when creating or renaming pages.',
      '',
      'For every created or updated page, also return an entry in "pages" with its provenance:',
      '- subject: the canonical identity the page belongs to, lowercase, words separated by dashes (e.g. "board-ai-module", "prophix-fpa-module") — NEVER glue the words together ("boardaimodule" is wrong), never use spaces',
      '- collection: the comparative set this document belongs to, when there is one',
      '- scope: source | product | transverse | workspace',
      `- kind: ${EXTRACTION_KINDS.join(' | ')} — the NATURE of the subject (a vendor is not its product, a dimension is not a product)`,
      'Do NOT write these fields inside the page content; the engine writes them.',
      'Do not copy the free-form "group" field into "subject": a group is a shelf, a subject is an identity.',
      'A vendor and its product are DIFFERENT pages only when each carries durable, distinct knowledge; otherwise keep the vendor inside the product page. Never create a second product page for a product\'s sub-modules.',
      '',
      'Return a strict JSON object with { "summary": string, "operations": WikiOperation[], "pages": [] } and no extra text.',
    ].join('\n'),
    user: [
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
      .join('\n'),
  };
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
