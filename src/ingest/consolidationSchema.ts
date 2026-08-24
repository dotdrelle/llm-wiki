import { z } from 'zod';
import { wikiOperationSchema } from '../config/schema.ts';
import { EXTRACTION_KINDS, EXTRACTION_SCOPES, normalizeKind, normalizeScope } from './extractionSchema.ts';

/*
 Consolidation contract: one source, one plan.

 It is here — and only here — that facts become files. The plan is produced in
 a single call that sees the WHOLE source, which is the condition for two
 fragments not to create two pages of the same concept, and for the number of
 pages to stop following the number of batches.
*/

export const CONSOLIDATION_SCHEMA_VERSION = 1;

const nonEmpty = z.string().trim().min(1);
const optionalValue = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  nonEmpty.nullish().transform((value) => value ?? null),
);

/**
 * Declared provenance for a page of the plan.
 *
 * Separated from the operations: the engine injects it itself into the
 * frontmatter. Asking the model to write these fields inside the content would
 * amount to accepting that they will be missing on one page in ten.
 */
export const consolidatedPageSchema = z.object({
  path: nonEmpty,
  subject: optionalValue,
  collection: optionalValue,
  scope: z.preprocess(
    (value) => (value == null || (typeof value === 'string' && value.trim() === '')
      ? null
      : normalizeScope(value)),
    z.enum(EXTRACTION_SCOPES).nullish().transform((value) => value ?? null),
  ),
  /** Nature of the subject: `vendor`, `product`, `requirement`, `regulation`, `dimension`, `scenario`. */
  kind: z.preprocess(
    (value) => (value == null || (typeof value === 'string' && value.trim() === '')
      ? null
      : normalizeKind(value)),
    z.enum(EXTRACTION_KINDS).nullish().transform((value) => value ?? null),
  ),
  /*
   Primary ranking class, from the workspace grid (`wiki/concepts-grid.md`).

   The FORM is tolerant — a stray capital or a French synonym key is normalized
   rather than lost, because a full re-consolidation is an expensive way to
   punish a value the model actually supplied. The VALUE is not: an unknown
   class is an error, checked against the closed set by `validateConsolidation`.
   Coercing it to a fallback would put a page in a class nobody chose, which is
   the one outcome the grid exists to prevent.
  */
  class: optionalValue,
  /** Other classes the page also speaks to. Same closed vocabulary as `class`. */
  classSecondary: z.preprocess(
    (value) => {
      if (value == null) return [];
      const list = Array.isArray(value) ? value : [value];
      return list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    },
    z.array(nonEmpty).default([]),
  ),
  /** Why this page exists: what the log must be able to restitute. */
  rationale: optionalValue,
});

export const consolidationPlanSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const candidate = value as Record<string, unknown>;
    const operations = candidate.operations ?? candidate.changes ?? candidate.files ?? [];
    const operationPaths = Array.isArray(operations)
      ? operations
          .filter((operation): operation is Record<string, unknown> =>
            Boolean(operation && typeof operation === 'object' && !Array.isArray(operation)))
          .map((operation) => operation.path)
      : [];
    const rawPages = candidate.pages ?? candidate.provenance ?? [];
    const pages = Array.isArray(rawPages)
      ? rawPages.map((page, index) => {
          if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
          const item = page as Record<string, unknown>;
          // Albert respects the order but sometimes omits the path. This join
          // invents no page: it attaches the provenance to the non-index
          // operations already declared in the same response.
          return {
            ...item,
            path: item.path ?? operationPaths[index],
            // Key synonyms only: the prompt asks for `class` in a French
            // vocabulary, so `classe`/`concept` come back often enough that
            // dropping them would lose a value the model did supply. No VALUE
            // is invented here — an unknown class is still an error downstream.
            class: item.class ?? item.classe ?? item.conceptClass ?? item.concept_class ?? item.concept,
            classSecondary: item.classSecondary
              ?? item.class_secondary
              ?? item.classesSecondaires
              ?? item.secondaryClasses,
          };
        }).filter((page) => {
          if (!page || typeof page !== 'object' || Array.isArray(page)) return true;
          return (page as Record<string, unknown>).path !== 'wiki/index.md';
        })
      : rawPages;
    return {
      ...candidate,
      summary: candidate.summary ?? candidate.log_message ?? candidate.message,
      operations,
      pages,
    };
  },
  z.object({
    summary: z.string().default('Ingest completed.'),
    operations: z.array(wikiOperationSchema).default([]),
    pages: z.array(consolidatedPageSchema).default([]),
  }),
);

export type ConsolidatedPage = z.infer<typeof consolidatedPageSchema>;
export type ConsolidationPlan = z.infer<typeof consolidationPlanSchema>;
