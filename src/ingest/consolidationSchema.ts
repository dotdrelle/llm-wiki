import { z } from 'zod';
import { wikiOperationSchema } from '../config/schema.ts';
import { EXTRACTION_SCOPES } from './extractionSchema.ts';

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
  scope: z.enum(EXTRACTION_SCOPES).nullish().transform((value) => value ?? null),
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
          return { ...item, path: item.path ?? operationPaths[index] };
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
