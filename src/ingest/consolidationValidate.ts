import type { WikiOperation } from '../types.ts';
import type { ConsolidationPlan, ConsolidatedPage } from './consolidationSchema.ts';
import {
  conceptPagePath,
  conceptPathSegments,
  parseConceptPagePath,
  CONCEPT_PATH_PREFIX,
  UNCLASSIFIED_CLASS,
} from './conceptGrid.ts';
import {
  applyProvenance,
  isValidProvenanceValue,
  normalizeProvenanceValue,
  normalizeTagValue,
  subjectsShareEntityRoot,
  type PageProvenance,
} from './provenance.ts';
import { okfTypeForPath } from '../okf/frontmatter.ts';

/*
 Deterministic check of the consolidated plan.

 Validation answers "is this plan applicable?"; the budget answers "is this
 granularity defensible?". The two are separated on purpose: a structural error
 must block, a semantic reservation must be visible without preventing
 publication.
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
   * How many leaves took their subject from their path because the plan omitted
   * it. Deriving is silent per page — the path IS the declaration. The counter
   * tells a run where every leaf is derived from one where none is.
   */
  derivedAxes: number;
};

export const CONCEPT_PREFIX = CONCEPT_PATH_PREFIX;

function isSourceNote(path: string, sourcePagePath: string): boolean {
  return path === sourcePagePath;
}

/**
 * Makes a leaf's declared subject agree with its path, before judging it.
 *
 * The path `wiki/concepts/<concept>/<subject>.md` carries the identity in its
 * last segment; the concept is the folder, which is never restated in the
 * frontmatter. So only `subject` is reconciled:
 * - subject absent  ⇒ derived from the path, silently;
 * - subject present and diverging ⇒ the PATH wins, with a warning naming both;
 * - path malformed ⇒ nothing is derived, and the checks below reject it.
 */
function reconcileConceptSubject(
  at: string,
  declared: PageProvenance,
): {
  provenance: PageProvenance;
  issues: ConsolidationIssue[];
  warnings: ConsolidationIssue[];
  derived: boolean;
} {
  const warnings: ConsolidationIssue[] = [];
  const fromPath = parseConceptPagePath(at);
  if (!fromPath) {
    // The concept IS the folder, so a leaf with no usable folder has no concept
    // axis at all. A `subject` the model declared must not paper over it — the
    // path, not the declaration, carries the identity — so this is rejected
    // exactly like a missing subject, never silently accepted.
    //
    // `refileMisfiledConceptLeaves` has already rescued every path that only
    // had the wrong DEPTH, so what reaches here is a value neither
    // normalization nor re-filing could make usable. The message names which
    // half, because "no concept folder" about a path that clearly has one sent
    // the reader looking for the wrong defect.
    const parsedAxes = conceptPathSegments(at);
    return {
      provenance: declared,
      issues: [{
        path: at,
        reason: parsedAxes === null
          ? 'concept page outside wiki/concepts/<concept>/<subject>.md'
          : !isValidProvenanceValue(parsedAxes.class)
            ? `concept page without a usable concept folder (« ${parsedAxes.class} »)`
            : `concept page without a usable subject (« ${parsedAxes.subject} »)`,
      }],
      warnings,
      derived: false,
    };
  }

  const derived = !declared.subject;
  const provenance: PageProvenance = { ...declared };
  if (!provenance.subject) provenance.subject = fromPath.subject;
  else if (provenance.subject !== fromPath.subject) {
    warnings.push({
      path: at,
      reason: `declared subject « ${provenance.subject} » contradicts the path; keeping « ${fromPath.subject} »`,
    });
    provenance.subject = fromPath.subject;
  }

  return { provenance, issues: conceptSubjectIssues(at, provenance), warnings, derived };
}

/**
 * Everything wrong with a leaf's identity.
 *
 * The rules are mechanical: a concept page must carry a usable `subject`. The
 * concept itself is the folder, so there is nothing else to contradict.
 */
function conceptSubjectIssues(at: string, provenance: PageProvenance): ConsolidationIssue[] {
  const issues: ConsolidationIssue[] = [];
  if (!provenance.subject) {
    issues.push({ path: at, reason: 'concept page without a usable subject' });
  }
  return issues;
}

/**
 * Re-files a concept leaf whose path has the wrong DEPTH into one the folder
 * model accepts.
 *
 * The concept IS the folder, so a leaf lives at exactly
 * `wiki/concepts/<concept>/<subject>.md`. Two shapes miss it:
 * - too flat (`wiki/concepts/<subject>.md`) — no concept axis at all, so the
 *   leaf waits under the reserved `unclassified/` folder;
 * - too deep (`wiki/concepts/<concept>/<sub>/<subject>.md`) — the model
 *   invented a sub-concept. The FIRST segment is the concept it chose and the
 *   rest is the subject, joined: both pieces of its judgement survive.
 *
 * Rejecting the whole source over one malformed path would drop a document the
 * engine already knows how to file — and it did, because a nested path was the
 * one shape nothing rescued. When even the normalized subject is unusable the
 * leaf is left for `reconcileConceptSubject` to reject.
 *
 * BOTH the operations and their `pages[]` provenance entries are rewritten, so
 * the refiled leaf keeps its declared scope/kind/tags. Deletes are never
 * rewritten: removing a legacy malformed leaf stays possible.
 */
function refileMisfiledConceptLeaves(
  operations: WikiOperation[],
  pages: ConsolidatedPage[],
): { operations: WikiOperation[]; pages: ConsolidatedPage[]; warnings: ConsolidationIssue[] } {
  const refile = (pathValue: string): { path: string; subject: string; flat: boolean } | null => {
    if (!pathValue.startsWith(CONCEPT_PATH_PREFIX) || !pathValue.endsWith('.md')) return null;
    const rest = pathValue.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length);
    if (!rest) return null;
    const parts = rest.split('/').filter(Boolean);
    if (parts.length === 2) return null;
    if (parts.length === 1) {
      const subject = normalizeProvenanceValue(parts[0] as string);
      return isValidProvenanceValue(subject)
        ? { path: conceptPagePath(UNCLASSIFIED_CLASS, subject), subject, flat: true }
        : null;
    }
    const concept = normalizeProvenanceValue(parts[0] as string);
    const subject = normalizeProvenanceValue(parts.slice(1).join('-'));
    if (!isValidProvenanceValue(concept) || !isValidProvenanceValue(subject)) return null;
    return { path: conceptPagePath(concept, subject), subject, flat: false };
  };
  const warnings: ConsolidationIssue[] = [];
  const announced = new Set<string>();
  const refiledOperations = operations.map((operation) => {
    if (operation.type === 'delete') return operation;
    const target = refile(operation.path);
    if (!target) return operation;
    if (!announced.has(operation.path)) {
      announced.add(operation.path);
      warnings.push({
        path: operation.path,
        reason: target.flat
          ? `concept leaf with no concept folder; re-filed under ${UNCLASSIFIED_CLASS}/`
          : `concept leaf nested below its concept folder; re-filed as ${target.path}`,
      });
    }
    return { ...operation, path: target.path };
  });
  const refiledPages = pages.map((page) => {
    const target = refile(page.path);
    if (!target) return page;
    return { ...page, path: target.path, subject: page.subject ?? target.subject };
  });
  return { operations: refiledOperations, pages: refiledPages, warnings };
}

/**
 * Validates, annotates and makes the plan applicable.
 */
export function validateConsolidation(
  plan: ConsolidationPlan,
  context: {
    sourcePagePath: string;
    citationPath: string;
    existingPaths: Set<string>;
    conceptBudget?: number;
    precomputedSplits?: ConceptSplit[];
  },
): ValidatedConsolidation {
  const errors: ConsolidationIssue[] = [];
  const warnings: ConsolidationIssue[] = [];
  const budget = context.conceptBudget ?? DEFAULT_CONCEPT_BUDGET;

  const refiled = refileMisfiledConceptLeaves(plan.operations ?? [], plan.pages ?? []);
  warnings.push(...refiled.warnings);
  const planOperations = refiled.operations;
  const declaredPages = refiled.pages;
  const provenanceInput = new Map(declaredPages.map((page) => [page.path, page]));
  const provenanceByPath = new Map<string, PageProvenance>();

  /*
   A source produces ONE source note.
  */
  const sourceNotes = planOperations.filter(
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
  for (const operation of planOperations) {
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

  for (let operation of planOperations) {
    const at = operation.path;

    // A page the plan calls "create" but that already exists is an update: it
    // is not a new concept (keep it out of the budget), and the write path
    // merges the existing engine frontmatter (sources, generated, status)
    // instead of resetting it to this source alone.
    if (operation.type === 'create' && at.startsWith(CONCEPT_PREFIX) && context.existingPaths.has(at)) {
      warnings.push({ path: at, reason: 'planned as create but the page already exists — treated as an update' });
      operation = { ...operation, type: 'update' };
    }

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
      const provenance: PageProvenance = {
        subject: subject && isValidProvenanceValue(subject) ? subject : null,
        scope: declared?.scope ?? null,
        kind: declared?.kind ?? null,
        tags: declared?.tags ?? [],
      };
      if (declared?.subject && !provenance.subject) {
        warnings.push({ path: at, reason: `non-normalizable subject: « ${declared.subject} »` });
      }
      let finalProvenance = provenance;
      if (at.startsWith(CONCEPT_PREFIX)) {
        const reconciled = reconcileConceptSubject(at, provenance);
        finalProvenance = reconciled.provenance;
        if (reconciled.derived) derivedAxes += 1;
        warnings.push(...reconciled.warnings);
        errors.push(...reconciled.issues);
      }
      // A leaf must never be orphaned: fewer than two tags, and the subject —
      // possibly just derived from the path above — and its OKF type become tags
      // so the entity link and its nature are always present. Both go through the
      // same tag normalization as the model's tags: split on the first term.
      if (finalProvenance.tags.length < 2) {
        const okfType = okfTypeForPath(at, finalProvenance);
        const additions: string[] = [];
        const subjectTag = finalProvenance.subject ? normalizeTagValue(finalProvenance.subject) : null;
        const typeTag = okfType ? normalizeTagValue(okfType) : null;
        if (subjectTag && !finalProvenance.tags.includes(subjectTag)) {
          additions.push(subjectTag);
        }
        if (typeTag && !finalProvenance.tags.includes(typeTag) && !additions.includes(typeTag)) {
          additions.push(typeTag);
        }
        if (additions.length) {
          finalProvenance = { ...finalProvenance, tags: [...finalProvenance.tags, ...additions] };
        }
      }
      provenanceByPath.set(at, finalProvenance);
      operations.push({
        ...operation,
        content: applyProvenance(operation.content ?? '', finalProvenance, okfTypeForPath(at, finalProvenance)),
      });
      continue;
    }

    operations.push(operation);
  }

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

  for (const split of context.precomputedSplits
    ?? detectConceptSplits({ ...plan, operations: planOperations, pages: declaredPages })) {
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
    const subject = (page.subject ? normalizeProvenanceValue(page.subject) : null)
      ?? (parseConceptPagePath(page.path)?.subject ?? null);
    if (!subject) continue;
    const pageFolder = parseConceptPagePath(page.path)?.class ?? null;
    for (let j = i + 1; j < declaredProductSubjects.length; j++) {
      const other = declaredProductSubjects[j]!;
      const otherSubject = (other.subject ? normalizeProvenanceValue(other.subject) : null)
        ?? (parseConceptPagePath(other.path)?.subject ?? null);
      if (!otherSubject) continue;
      const otherFolder = parseConceptPagePath(other.path)?.class ?? null;
      /*
       Two leaves of the same subject under DIFFERENT concepts are the model,
       not a split: one identity projected twice. Only a repeat WITHIN one
       concept duplicates anything.
      */
      if (pageFolder && otherFolder && pageFolder !== otherFolder) {
        continue;
      }
      /*
       The STRICT predicate, deliberately: this does not show a candidate, it
       DECLARES a duplicate — and a declared split costs retry rounds and tells
       the model to merge. The lenient `subjectsAreRelated` made two products
       sharing any qualifier ("jedox-cloud" / "anaplan-cloud") a split.
      */
      if (subjectsShareEntityRoot(subject, otherSubject) || sharesRawPrefix(subject, otherSubject)) {
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

function sharesRawPrefix(a: string, b: string): boolean {
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length >= 4 && long.startsWith(short) && long !== short;
}

export type ConceptOverflow = {
  newConcepts: number;
  budget: number;
  newConceptPaths: string[];
};

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

export function detectDuplicatePaths(plan: ConsolidationPlan): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const operation of plan.operations) {
    if (seen.has(operation.path)) duplicates.add(operation.path);
    seen.add(operation.path);
  }
  return [...duplicates].sort();
}

export type PreviousConcept = {
  path: string;
  subject: string | null;
  class: string | null;
  content: string | null;
};

/**
 * Re-anchors a freshly consolidated plan onto the concept pages this source
 * produced in a previous ingest. Matching is CLASS-aware (now concept-folder-
 * aware): two leaves of one subject under two folders are siblings, not the
 * same page.
 */
export function reanchorToPreviousConcepts(
  plan: ConsolidationPlan,
  previousConcepts: PreviousConcept[],
): ConsolidationPlan {
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
    const klass = parseConceptPagePath(operation.path)?.class ?? null;
    const content = operation.content ?? '';

    const available = (candidate: PreviousConcept | undefined): candidate is PreviousConcept =>
      candidate !== undefined
      && candidate.path !== operation.path
      && !planPaths.has(candidate.path)
      && !claimed.has(candidate.path);
    const sameClass = (candidate: PreviousConcept | undefined): candidate is PreviousConcept =>
      candidate !== undefined && (candidate.class ?? null) === klass;

    let previous: PreviousConcept | undefined;
    if (subject) {
      const exact = previousByAxes.get(`${klass ?? ''}\u0000${subject}`);
      if (available(exact) && sameClass(exact)) previous = exact;
    }

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

export const REANCHOR_MIN_OVERLAP = 0.5;

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
