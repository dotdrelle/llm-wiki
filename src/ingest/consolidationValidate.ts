import type { WikiOperation } from '../types.ts';
import type { ConsolidationPlan } from './consolidationSchema.ts';
import { conceptPathMismatch, parseConceptPagePath, CONCEPT_PATH_PREFIX, UNCLASSIFIED_CLASS, type ConceptGrid } from './conceptGrid.ts';
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
  /**
   * How many leaves took an axis from their path because the plan omitted it.
   *
   * Deriving is silent per page — the path IS the declaration, so there is
   * nothing to warn about. But a run where every leaf is derived and a run
   * where none is are two very different states of the model, and only a
   * counter tells them apart. Same reason the rename-hysteresis verdicts are
   * published: a threshold nobody measures is a threshold nobody can tune.
   */
  derivedAxes: number;
};

/**
 * Concept page path prefix, shared with `conceptGrid.ts` rather than redeclared
 * here: the leaf path convention (`wiki/concepts/<class>/<subject>.md`) is one
 * thing, and `conceptPathMismatch` enforces it against exactly this prefix.
 * Two divergent literals would let a path pass one check and fail the other.
 */
export const CONCEPT_PREFIX = CONCEPT_PATH_PREFIX;

function isSourceNote(path: string, sourcePagePath: string): boolean {
  return path === sourcePagePath;
}

/** How many valid classes to name back when rejecting an unknown one. */
const CLASS_HINT_LIMIT = 15;

/**
 * Makes a leaf's declared axes agree with its path, before judging them.
 *
 * The path `wiki/concepts/<class>/<subject>.md` already carries both axes —
 * that is the whole point of the convention. Asking the model to restate them
 * in `pages[]` asks for the same information twice, and a real run showed what
 * that costs: of thirteen sources, five were rejected, all of them for the
 * copy rather than for the decision. Either the axes were simply absent, or
 * `subject` had fallen back to the SOURCE DOCUMENT'S file name while the path
 * named the identity correctly.
 *
 * So the path is read as the declaration it is:
 * - axes absent  ⇒ derived, silently. Deriving here invents nothing; the model
 *   chose that path.
 * - axes present and diverging ⇒ the PATH wins, with a warning naming both.
 *   The path is structurally validated against the grid and the declaration is
 *   not, so the path can never file into a class that does not exist; and
 *   letting the declaration win would mean moving the file, which is the
 *   larger action for the weaker evidence.
 * - path malformed ⇒ nothing is derived, and the checks below reject it.
 *
 * The defect this whole axis machinery exists to catch is untouched: it lived
 * on a FLAT concept path, which the convention no longer allows.
 */
function reconcileConceptAxes(
  at: string,
  declared: PageProvenance,
  grid: ConceptGrid | undefined,
): {
  provenance: PageProvenance;
  issues: ConsolidationIssue[];
  warnings: ConsolidationIssue[];
  derived: boolean;
} {
  const warnings: ConsolidationIssue[] = [];
  const fromPath = parseConceptPagePath(at);
  // The path's class is authoritative when it belongs to the closed set — or
  // when it is the reserved `unclassified`, which is always a valid leaf class.
  if (!fromPath || (grid && !grid.set.has(fromPath.class) && fromPath.class !== UNCLASSIFIED_CLASS)) {
    return {
      provenance: declared,
      issues: conceptAxisIssues(at, declared, grid),
      warnings,
      derived: false,
    };
  }

  const derived = !declared.class || !declared.subject;
  let classChanged = false;
  const provenance: PageProvenance = { ...declared };
  if (!provenance.class) provenance.class = fromPath.class;
  else if (provenance.class !== fromPath.class) {
    warnings.push({
      path: at,
      reason: `declared class « ${provenance.class} » contradicts the path; keeping « ${fromPath.class} »`,
    });
    provenance.class = fromPath.class;
    classChanged = true;
  }
  if (!provenance.subject) provenance.subject = fromPath.subject;
  else if (provenance.subject !== fromPath.subject) {
    warnings.push({
      path: at,
      reason: `declared subject « ${provenance.subject} » contradicts the path; keeping « ${fromPath.subject} »`,
    });
    provenance.subject = fromPath.subject;
  }

  /*
   A secondary class equal to the primary is a self-contradiction, and
   `conceptAxisIssues` rejects it. It must stay rejected — but only when the
   MODEL wrote it. When the primary was just moved onto the path's class, a
   secondary that now collides with it is an artefact of this reconciliation,
   not of the plan, and dropping it is the honest repair.
  */
  if (classChanged) {
    provenance.classSecondary = provenance.classSecondary.filter(
      (value) => value !== provenance.class,
    );
  }

  return { provenance, issues: conceptAxisIssues(at, provenance, grid), warnings, derived };
}

/**
 * Everything wrong with a leaf's two axes.
 *
 * These are the checks that used to not exist at all, and their absence is
 * visible on a real corpus: a page named after one product declaring the
 * `subject` of another page entirely, and eight pages out of twenty-three
 * carrying no axis whatsoever — while the taxonomy prompt
 * states that this same frontmatter is "authoritative, do not re-derive it
 * from prose". A field declared authoritative and never verified is worse than
 * an absent one: it makes the classification confidently wrong.
 *
 * The rules are deliberately mechanical. None of them asks whether a filing
 * decision is GOOD — that judgement belongs to the model and to the grid. They
 * only refuse a page whose declared axes contradict themselves or the closed
 * set, which is checkable without reading a word of the content.
 */
function conceptAxisIssues(
  at: string,
  provenance: PageProvenance,
  grid: ConceptGrid | undefined,
): ConsolidationIssue[] {
  const issues: ConsolidationIssue[] = [];
  if (!provenance.subject) {
    issues.push({ path: at, reason: 'concept page without a usable subject' });
  }
  if (!provenance.class) {
    issues.push({ path: at, reason: 'concept page without a ranking class' });
  }
  if (!grid) return issues;

  const known = (value: string): boolean => value === UNCLASSIFIED_CLASS || grid.set.has(value);
  const valid = grid.classes.slice(0, CLASS_HINT_LIMIT).join(', ');
  if (provenance.class && !known(provenance.class)) {
    issues.push({
      path: at,
      reason: `unknown class « ${provenance.class} »; the grid declares: ${valid}`,
    });
  }
  for (const secondary of provenance.classSecondary) {
    if (!known(secondary)) {
      issues.push({
        path: at,
        reason: `unknown secondary class « ${secondary} »; the grid declares: ${valid}`,
      });
    }
    if (secondary === provenance.class) {
      issues.push({
        path: at,
        reason: `class « ${secondary} » declared both as primary and secondary`,
      });
    }
  }
  if (provenance.class && provenance.subject && known(provenance.class)) {
    const mismatch = conceptPathMismatch(at, {
      class: provenance.class,
      subject: provenance.subject,
    });
    if (mismatch) issues.push({ path: at, reason: mismatch });
  }
  return issues;
}

/**
 * Validates, annotates and makes the plan applicable.
 *
 * The operations are not rewritten beyond the provenance injection: silently
 * repairing a dubious plan would produce a page that nobody decided, and would
 * hide precisely what the log must be able to explain.
 *
 * `reconcileConceptAxes` is not an exception to that rule, it is the rule read
 * correctly. A leaf's path CARRIES its two axes, so taking them from there is
 * reading what the plan said, not inventing what it left out — and where the
 * path and the frontmatter disagree, the disagreement itself is published as a
 * warning rather than resolved out of sight.
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
    /**
     * The workspace's closed set of ranking classes.
     *
     * Its presence is what turns the leaf-axis checks from warnings into
     * errors. A workspace whose grid has not been built yet must still be
     * ingestable — otherwise the grid pass could never run on a corpus — so
     * before there is a grid the same problems are reported and published,
     * and after there is one they block. Nothing in between: an absent grid
     * is a state, never a reason to skip a rule silently.
     */
    grid?: ConceptGrid;
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
  let derivedAxes = 0;

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
      const primaryClass = declared?.class ? normalizeProvenanceValue(declared.class) : null;
      const secondaryClasses = (declared?.classSecondary ?? [])
        .map((value) => normalizeProvenanceValue(value))
        .filter((value) => value && isValidProvenanceValue(value));
      const provenance: PageProvenance = {
        subject: subject && isValidProvenanceValue(subject) ? subject : null,
        collection: collection && isValidProvenanceValue(collection) ? collection : null,
        scope: declared?.scope ?? null,
        kind: declared?.kind ?? null,
        class: primaryClass && isValidProvenanceValue(primaryClass) ? primaryClass : null,
        classSecondary: [...new Set(secondaryClasses)],
      };
      if (declared?.subject && !provenance.subject) {
        warnings.push({ path: at, reason: `non-normalizable subject: « ${declared.subject} »` });
      }
      if (declared?.class && !provenance.class) {
        warnings.push({ path: at, reason: `non-normalizable class: « ${declared.class} »` });
      }
      // A secondary class that cannot be normalized is dropped — but never
      // silently, for the same reason as the subject above: the model supplied
      // a value and the operator must be able to see it was not kept.
      for (const raw of declared?.classSecondary ?? []) {
        const normalized = normalizeProvenanceValue(raw);
        if (normalized && isValidProvenanceValue(normalized)) continue;
        warnings.push({ path: at, reason: `non-normalizable classSecondary: « ${raw} »` });
      }
      let finalProvenance = provenance;
      if (at.startsWith(CONCEPT_PREFIX)) {
        const reconciled = reconcileConceptAxes(at, provenance, context.grid);
        finalProvenance = reconciled.provenance;
        if (reconciled.derived) derivedAxes += 1;
        warnings.push(...reconciled.warnings);
        for (const issue of reconciled.issues) {
          (context.grid ? errors : warnings).push(issue);
        }
      }
      provenanceByPath.set(at, finalProvenance);
      operations.push({
        ...operation,
        content: applyProvenance(operation.content ?? '', finalProvenance),
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

   The budget above counts pages, it does not see that `x.md` +
   `x-international.md` are ONE product seen from two angles, or that
   `x.md` + `x-planning.md` + `x-etl.md` + `x-ai.md` is one
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

  return { operations, errors, warnings, provenanceByPath, derivedAxes };
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
 * identity ("x" / "x-international", "x" / "x-planning",
 * glued "xaimodule"). A page split this way makes the taxonomy invent
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
    // Both axes fall back to the path, for the same reason: the model often
    // names the identity correctly in the path and omits the declaration, and
    // the split scan must still see it — a leaf whose subject is only in its
    // path would otherwise be skipped, and two sister leaves would otherwise be
    // merged. The declaration still wins when present.
    const subject = (page.subject ? normalizeProvenanceValue(page.subject) : null)
      ?? (parseConceptPagePath(page.path)?.subject ?? null);
    if (!subject) continue;
    // The class is read from the declaration when present, and from the path
    // otherwise: the model often names the identity correctly in the path and
    // omits the `class` declaration, and that must still count as two distinct
    // classes when the paths differ — otherwise two legitimate sister leaves
    // would be asked to merge.
    const pageClass = (page.class ? normalizeProvenanceValue(page.class) : null)
      ?? (parseConceptPagePath(page.path)?.class ?? null);
    for (let j = i + 1; j < declaredProductSubjects.length; j++) {
      const other = declaredProductSubjects[j]!;
      const otherSubject = (other.subject ? normalizeProvenanceValue(other.subject) : null)
        ?? (parseConceptPagePath(other.path)?.subject ?? null);
      if (!otherSubject) continue;
      const otherClass = (other.class ? normalizeProvenanceValue(other.class) : null)
        ?? (parseConceptPagePath(other.path)?.class ?? null);
      /*
       Two leaves of the same subject under DIFFERENT classes are the model,
       not a split: one subject seen from two different classes is one
       identity projected twice, and that
       projection is what makes the transverse edge of the graph computable.
       Only a repeat WITHIN one class duplicates anything.
      */
      if (pageClass && otherClass && pageClass !== otherClass) {
        continue;
      }
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
 * `subjectsAreRelated` splits on the dash, so it sees `x` and
 * `x-ai-module` but misses `x` and `xaimodule` — the glued form a
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
 * body it produced `x-one` on one run and `x` on the next, so the
 * concept page identities drifted even though the content was stable. This pass
 * is the deterministic part of the fix: when the model CREATES a concept that
 * matches a page this source previously produced, the create is rewritten as an
 * UPDATE of the previous page — same path, same subject — so the identity
 * survives a re-ingest.
 *
 * Matching is two-tiered:
 * - an EXACT normalized subject match is always trusted;
 * - otherwise, a CONTENT match (Jaccard overlap of the tokenized body, citations
 *   excluded) reconciles a renamed subject (`x` vs `x-one`).
 *
 * Both tiers are CLASS-aware. Two leaves of one subject under two classes are
 * siblings, not the same page: a new leaf must reanchor only onto the previous
 * leaf of ITS OWN class. Matching by subject alone would let one new leaf claim
 * its sibling's previous page, then rewrite its path to one whose class
 * contradicts its own declared `class` — the exact mismatch `conceptPathMismatch`
 * rejects — or reanchor a grid-aware leaf onto a flat pre-grid page.
 *
 * A previous page is never used when the plan already targets it, and a
 * previous page is claimed at most once.
 */
export type PreviousConcept = {
  path: string;
  subject: string | null;
  class: string | null;
  content: string | null;
};

export function reanchorToPreviousConcepts(
  plan: ConsolidationPlan,
  previousConcepts: PreviousConcept[],
): ConsolidationPlan {
  // Keyed by (class, subject): the two axes a leaf's identity rests on.
  const previousByAxes = new Map<string, PreviousConcept>();
  for (const concept of previousConcepts) {
    if (!concept.subject) continue;
    const key = `${concept.class ?? ''}\u0000${concept.subject}`;
    if (!previousByAxes.has(key)) previousByAxes.set(key, concept);
  }

  const planPaths = new Set(plan.operations.map((operation) => operation.path));
  const rewrite = new Map<string, PreviousConcept>();
  const claimed = new Set<string>();

  for (const operation of plan.operations) {
    if (operation.type !== 'create' || !operation.path.startsWith(CONCEPT_PREFIX)) continue;
    const declared = (plan.pages ?? []).find((page) => page.path === operation.path);
    const subject = declared?.subject ? normalizeProvenanceValue(declared.subject) : null;
    // Same fallback as detectConceptSplits: the model often names the class
    // correctly in the path and omits the declared field.
    const klass = (declared?.class ? normalizeProvenanceValue(declared.class) : null)
      ?? (parseConceptPagePath(operation.path)?.class ?? null);
    const content = operation.content ?? '';

    const available = (candidate: PreviousConcept | undefined): candidate is PreviousConcept =>
      candidate !== undefined
      && candidate.path !== operation.path
      && !planPaths.has(candidate.path)
      && !claimed.has(candidate.path);
    const sameClass = (candidate: PreviousConcept | undefined): candidate is PreviousConcept =>
      candidate !== undefined && (candidate.class ?? null) === klass;

    // 1. Exact normalized subject match — always trusted (the key already
    //    carries the class, so an exact hit is class-consistent by construction).
    let previous: PreviousConcept | undefined;
    if (subject) {
      const exact = previousByAxes.get(`${klass ?? ''}\u0000${subject}`);
      if (available(exact) && sameClass(exact)) previous = exact;
    }

    // 2. Content match (Jaccard) — reconciles a renamed subject, within the same class.
    if (!previous && content) {
      const newTokens = contentTokens(content);
      if (newTokens.size > 0) {
        let bestScore = REANCHOR_MIN_OVERLAP;
        for (const candidate of previousConcepts) {
          if (!candidate.content || !available(candidate) || !sameClass(candidate)) continue;
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
