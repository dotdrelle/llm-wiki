import type { WikiOperation } from '../types.ts';
import type { ConsolidationPlan } from './consolidationSchema.ts';
import {
  applyProvenance,
  isValidProvenanceValue,
  normalizeProvenanceValue,
  type PageProvenance,
} from './provenance.ts';

/*
 Deterministic check of the consolidated plan.

 Validation answers "is this plan applicable?"; the budget answers "is this
 granularity defensible?". The two are separated on purpose: a structural error
 must block, a semantic reservation must be visible without preventing
 publication — that is already the taxonomy's discipline, and applying it here
 avoids a perfectly useful plan being rejected for one concept too many.
*/

/** Default budget: one source note, plus zero to three concepts of its own. */
export const DEFAULT_CONCEPT_BUDGET = 3;

export type ConsolidationIssue = { path: string; reason: string };

export type ValidatedConsolidation = {
  operations: WikiOperation[];
  /** Blocking: the plan is not applicable as-is. */
  errors: ConsolidationIssue[];
  /** Observable: published, never blocking. */
  warnings: ConsolidationIssue[];
  provenanceByPath: Map<string, PageProvenance>;
};

const CONCEPT_PREFIX = 'wiki/concepts/';

function isSourceNote(path: string, sourcePagePath: string): boolean {
  return path === sourcePagePath;
}

/**
 * Validates, annotates and makes the plan applicable.
 *
 * The operations are not rewritten beyond the provenance injection: silently
 * repairing a dubious plan would produce a page that nobody decided, and would
 * hide precisely what the log must be able to explain.
 */
export function validateConsolidation(
  plan: ConsolidationPlan,
  context: {
    sourcePagePath: string;
    citationPath: string;
    existingPaths: Set<string>;
    collection: string | null;
    conceptBudget?: number;
  },
): ValidatedConsolidation {
  const errors: ConsolidationIssue[] = [];
  const warnings: ConsolidationIssue[] = [];
  const budget = context.conceptBudget ?? DEFAULT_CONCEPT_BUDGET;

  /*
   `pages` may be missing: a plan re-read from cache, a stingy model answer, an
   earlier format. The absence of provenance is a reservation — it is reported
   page by page further down — never a reason to lose an entire source.
  */
  const declaredPages = plan.pages ?? [];
  const provenanceInput = new Map(declaredPages.map((page) => [page.path, page]));
  const provenanceByPath = new Map<string, PageProvenance>();

  /*
   A source produces ONE source note.

   Without this check, the original flaw returns in another form: the
   consolidation can propose one note per fragment if the prompt invites it to,
   and the document's coverage scatters again.
  */
  const sourceNotes = plan.operations.filter(
    (operation) => isSourceNote(operation.path, context.sourcePagePath) && operation.type !== 'delete',
  );
  if (sourceNotes.length === 0) {
    errors.push({ path: context.sourcePagePath, reason: 'no source note in the plan' });
  } else if (sourceNotes.length > 1) {
    errors.push({
      path: context.sourcePagePath,
      reason: `${sourceNotes.length} source notes for a single document`,
    });
  }
  for (const operation of plan.operations) {
    if (operation.path.startsWith('wiki/sources/')
      && operation.path !== context.sourcePagePath
      && operation.type !== 'delete') {
      errors.push({
        path: operation.path,
        reason: `secondary source note not allowed; expected canonical path: ${context.sourcePagePath}`,
      });
    }
  }

  const seen = new Map<string, WikiOperation>();
  const operations: WikiOperation[] = [];
  let newConcepts = 0;

  for (const operation of plan.operations) {
    const at = operation.path;

    /*
     Two contradictory operations on the same path.

     The previous path concatenated the operations of each batch: two creations
     of the same file silently overwrote each other, and the last one won
     without anything saying which. A collision is now an error, not an
     implicit arbitration.
    */
    const previous = seen.get(at);
    if (previous) {
      errors.push({ path: at, reason: `duplicate path in the plan (${previous.type} then ${operation.type})` });
      continue;
    }
    seen.set(at, operation);

    if (operation.type !== 'delete' && !operation.content?.trim()) {
      errors.push({ path: at, reason: 'empty content for a create or an update' });
      continue;
    }

    /*
     Every claim must cite the ingested source.

     Checked on the source note and the concepts, not on the index: the index is
     a table of contents, not a carrier of facts.
    */
    if (operation.type !== 'delete' && at !== 'wiki/index.md') {
      if (!operation.content?.includes(context.citationPath)) {
        warnings.push({ path: at, reason: 'no citation of the ingested source' });
      }
    }

    const isNewConcept = at.startsWith(CONCEPT_PREFIX)
      && operation.type === 'create'
      && !context.existingPaths.has(at);
    if (isNewConcept) newConcepts += 1;

    const declared = provenanceInput.get(at);
    if (operation.type !== 'delete' && at !== 'wiki/index.md') {
      if (!declared) {
        warnings.push({ path: at, reason: 'undeclared provenance' });
      }
      const subject = declared?.subject ? normalizeProvenanceValue(declared.subject) : null;
      const collection = declared?.collection
        ? normalizeProvenanceValue(declared.collection)
        : context.collection;
      const provenance: PageProvenance = {
        subject: subject && isValidProvenanceValue(subject) ? subject : null,
        collection: collection && isValidProvenanceValue(collection) ? collection : null,
        scope: declared?.scope ?? null,
      };
      if (declared?.subject && !provenance.subject) {
        warnings.push({ path: at, reason: `non-normalizable subject: « ${declared.subject} »` });
      }
      provenanceByPath.set(at, provenance);
      operations.push({
        ...operation,
        content: applyProvenance(operation.content ?? '', provenance),
      });
      continue;
    }

    operations.push(operation);
  }

  /*
   Conceptual budget: a reservation, not a guillotine.

   Refusing the plan would lose an entire source for one concept too many. The
   gap is therefore published, with its count, and remains explainable in the
   log.
  */
  if (newConcepts > budget) {
    const justified = declaredPages.filter(
      (page) => page.path.startsWith(CONCEPT_PREFIX) && page.rationale,
    ).length;
    warnings.push({
      path: 'plan',
      reason: `${newConcepts} new concepts for a budget of ${budget}`
        + ` (${justified} justified)`,
    });
  }

  return { operations, errors, warnings, provenanceByPath };
}
