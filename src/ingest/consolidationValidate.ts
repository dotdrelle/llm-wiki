import type { WikiOperation } from '../types.ts';
import type { ConsolidationPlan } from './consolidationSchema.ts';
import {
  applyProvenance,
  isValidProvenanceValue,
  normalizeProvenanceValue,
  subjectsAreRelated,
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

export const CONCEPT_PREFIX = 'wiki/concepts/';

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
    /**
     * Reuse a split scan already run against this plan's `subject`/`kind`
     * data (e.g. `ingestService.ts`'s granularity-fix retry loop, which
     * already recomputes `detectConceptSplits` until clean or exhausted).
     * Path normalization/citation rewriting between that loop and this call
     * never touch `subject`/`kind`, so the last scan stays valid — recomputing
     * it here would repeat the same O(n²) pairwise comparison for nothing new.
     * Omit to have this function compute it itself (e.g. a plan read from
     * cache, which skips the retry loop entirely).
     */
    precomputedSplits?: ConceptSplit[];
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
        kind: declared?.kind ?? null,
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

  /*
   Atomicity: a product must not be split into several concept pages.

   The budget above counts pages, it does not see that `board.md` +
   `board-international.md` are ONE product seen from two angles, or that
   `prophix.md` + `prophix-fpa.md` + `prophix-etl.md` + `prophix-ia.md` is one
   product plus its own sub-modules. A page split this way is exactly what makes
   the taxonomy later invent a "Solutions" catch-all: the corpus itself is no
   longer atomic, so no grouping can restore a stable identity.

   `subjectsAreRelated` is the same lenient leading-token signal used for the
   reuse inventory: it flags "same real-world thing, worth a second look".
   */
  for (const split of context.precomputedSplits ?? detectConceptSplits(plan)) {
    warnings.push({
      path: split.path,
      reason: `concept split: subject "${split.subject}" shares an identity with "${split.duplicateOfSubject}" (${split.duplicateOfPath}) — one product should be one concept`,
    });
  }

  return { operations, errors, warnings, provenanceByPath };
}

export type ConceptSplit = {
  /** Path of the split-off page (the near-duplicate). */
  path: string;
  /** Its normalized subject. */
  subject: string;
  /** Path of the page it duplicates. */
  duplicateOfPath: string;
  /** Subject of the page it duplicates. */
  duplicateOfSubject: string;
};

/**
 * Concept pages of a plan that split ONE identity into several.
 *
 * The same lenient leading-token/raw-prefix signal as the reuse inventory:
 * two product/vendor concepts of the same source whose subjects share an
 * identity ("board" / "board-international", "prophix" / "prophix-fpa",
 * glued "boardaimodule"). A page split this way makes the taxonomy invent
 * catch-all domains later, so the consolidation retry asks the model to
 * merge them before the plan is applied.
 */
export function detectConceptSplits(plan: ConsolidationPlan): ConceptSplit[] {
  const declaredPages = plan.pages ?? [];
  const declaredProductSubjects = declaredPages.filter(
    (page) => page.path.startsWith(CONCEPT_PREFIX)
      && (page.kind === 'product' || page.kind === 'vendor'),
  );
  const splits: ConceptSplit[] = [];
  for (let i = 0; i < declaredProductSubjects.length; i++) {
    const page = declaredProductSubjects[i]!;
    const subject = page.subject ? normalizeProvenanceValue(page.subject) : null;
    if (!subject) continue;
    for (let j = i + 1; j < declaredProductSubjects.length; j++) {
      const other = declaredProductSubjects[j]!;
      const otherSubject = other.subject ? normalizeProvenanceValue(other.subject) : null;
      if (!otherSubject) continue;
      if (subjectsAreRelated(subject, otherSubject) || sharesRawPrefix(subject, otherSubject)) {
        splits.push({
          path: other.path,
          subject: otherSubject,
          duplicateOfPath: page.path,
          duplicateOfSubject: subject,
        });
      }
    }
  }
  return splits;
}

/**
 * A subject that is a raw string prefix of another.
 *
 * `subjectsAreRelated` splits on the dash, so it sees `board` and
 * `board-ai-module` but misses `board` and `boardaimodule` — the glued form a
 * model produces when told "no spaces" without being told to keep the dashes.
 * This is the safety net for that form: one subject being a strict prefix of
 * the other is a strong same-identity signal within a single consolidation
 * plan (two product/vendor concepts of the same source). The 4-character floor
 * keeps a very short subject ("s1", "gpc") from matching noise.
 */
function sharesRawPrefix(a: string, b: string): boolean {
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length >= 4 && long.startsWith(short) && long !== short;
}

export type ConceptOverflow = {
  /** Number of NEW concept pages the plan creates. */
  newConcepts: number;
  /** The budget it exceeded. */
  budget: number;
  /** The paths of the new concept pages, for the retry to merge from. */
  newConceptPaths: string[];
};

/**
 * Whether a plan creates more NEW concepts than the budget allows.
 *
 * `null` when within budget. Unlike `detectConceptSplits`, which compares
 * subjects pairwise, this is a pure count — the same count `validateConsolidation`
 * reports as a warning. Extracted so the consolidation retry can act on it
 * (ask the model to merge concepts down) instead of only logging it.
 */
export function detectConceptOverflow(
  plan: ConsolidationPlan,
  existingPaths: Set<string>,
  budget: number,
): ConceptOverflow | null {
  const newConceptPaths = plan.operations
    .filter((operation) =>
      operation.path.startsWith(CONCEPT_PREFIX)
      && operation.type === 'create'
      && !existingPaths.has(operation.path))
    .map((operation) => operation.path);
  if (newConceptPaths.length <= budget) return null;
  return { newConcepts: newConceptPaths.length, budget, newConceptPaths };
}

/**
 * Paths the plan targets more than once.
 *
 * `validateConsolidation` treats a duplicate as a structural error (an implicit
 * arbitration, not a decision). The model sometimes emits two `update`
 * operations on `wiki/index.md` in one plan — once for the source note, once for
 * the concepts. Detected here on the raw operations so the consolidation retry
 * can ask the model to merge them, instead of the whole source failing.
 */
export function detectDuplicatePaths(plan: ConsolidationPlan): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const operation of plan.operations) {
    if (seen.has(operation.path)) duplicates.add(operation.path);
    seen.add(operation.path);
  }
  return [...duplicates].sort();
}

/**
 * Re-anchors a freshly consolidated plan onto the concept pages this source
 * produced in a previous ingest (§6.3, §12.2).
 *
 * The consolidation model names products in an unstable way: on an unchanged
 * body it produced `prophix-one` on one run and `prophix` on the next, so the
 * concept page identities drifted even though the content was stable. This pass
 * is the deterministic part of the fix: when the model CREATES a concept that
 * matches a page this source previously produced, the create is rewritten as an
 * UPDATE of the previous page — same path, same subject — so the identity
 * survives a re-ingest.
 *
 * Matching is two-tiered:
 * - an EXACT normalized subject match is always trusted;
 * - otherwise, a CONTENT match (Jaccard overlap of the tokenized body, citations
 *   excluded) reconciles a renamed subject (`prophix` vs `prophix-one`).
 *
 * A previous page is never used when the plan already targets it, and a
 * previous page is claimed at most once.
 */
export function reanchorToPreviousConcepts(
  plan: ConsolidationPlan,
  previousConcepts: Array<{ path: string; subject: string | null; content: string | null }>,
): ConsolidationPlan {
  const previousBySubject = new Map<string, { path: string; subject: string | null; content: string | null }>();
  for (const concept of previousConcepts) {
    if (!concept.subject || previousBySubject.has(concept.subject)) continue;
    previousBySubject.set(concept.subject, concept);
  }

  const planPaths = new Set(plan.operations.map((operation) => operation.path));
  const rewrite = new Map<string, { path: string; subject: string | null; content: string | null }>();
  const claimed = new Set<string>();

  for (const operation of plan.operations) {
    if (operation.type !== 'create' || !operation.path.startsWith(CONCEPT_PREFIX)) continue;
    const declared = (plan.pages ?? []).find((page) => page.path === operation.path);
    const subject = declared?.subject ? normalizeProvenanceValue(declared.subject) : null;
    const content = operation.content ?? '';

    const available = (candidate: { path: string; subject: string | null; content: string | null } | undefined): candidate is { path: string; subject: string | null; content: string | null } =>
      candidate !== undefined
      && candidate.path !== operation.path
      && !planPaths.has(candidate.path)
      && !claimed.has(candidate.path);

    // 1. Exact normalized subject match — always trusted.
    let previous: { path: string; subject: string | null; content: string | null } | undefined;
    if (subject) {
      const exact = previousBySubject.get(subject);
      if (available(exact)) previous = exact;
    }

    // 2. Content match (Jaccard) — reconciles a renamed subject.
    if (!previous && content) {
      const newTokens = contentTokens(content);
      if (newTokens.size > 0) {
        let bestScore = REANCHOR_MIN_OVERLAP;
        for (const candidate of previousConcepts) {
          if (!candidate.content || !available(candidate)) continue;
          const score = tokenOverlap(newTokens, contentTokens(candidate.content));
          if (score >= bestScore) {
            previous = candidate;
            bestScore = score;
          }
        }
      }
    }

    if (!previous) continue;
    rewrite.set(operation.path, previous);
    claimed.add(previous.path);
  }

  if (rewrite.size === 0) return plan;

  const operations = plan.operations.map((operation) => {
    const previous = rewrite.get(operation.path);
    if (!previous) return operation;
    return { ...operation, type: 'update' as const, path: previous.path };
  });

  const pages = (plan.pages ?? []).map((page) => {
    const previous = rewrite.get(page.path);
    if (!previous) return page;
    return { ...page, path: previous.path, subject: previous.subject ?? page.subject };
  });

  return { ...plan, operations, pages };
}

/** Jaccard threshold for the content fallback: same as §6.3 taxonomy re-anchoring. */
export const REANCHOR_MIN_OVERLAP = 0.5;

/** Tokenized content signature: citations are excluded, they are common to a source. */
function contentTokens(content: string): Set<string> {
  const normalized = content
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\[src: [^\]]+\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ');
  return new Set(normalized.split(' ').filter((token) => token.length >= 3));
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}
