import type { WikiOperation } from '../types.ts';
import type { ConsolidationPlan } from './consolidationSchema.ts';
import { parseConceptPagePath, CONCEPT_PATH_PREFIX } from './conceptGrid.ts';
import {
  applyProvenance,
  isValidProvenanceValue,
  normalizeProvenanceValue,
  normalizeTagValue,
  subjectsAreRelated,
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
    return { provenance: declared, issues: conceptSubjectIssues(at, declared), warnings, derived: false };
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
    precomputedFolderConflicts?: FolderConflict[];
  },
): ValidatedConsolidation {
  const errors: ConsolidationIssue[] = [];
  const warnings: ConsolidationIssue[] = [];
  const budget = context.conceptBudget ?? DEFAULT_CONCEPT_BUDGET;

  const declaredPages = plan.pages ?? [];
  const provenanceInput = new Map(declaredPages.map((page) => [page.path, page]));
  const provenanceByPath = new Map<string, PageProvenance>();

  /*
   A source produces ONE source note.
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

  for (const split of context.precomputedSplits ?? detectConceptSplits(plan)) {
    warnings.push({
      path: split.path,
      reason: `concept split: subject "${split.subject}" shares an identity with "${split.duplicateOfSubject}" (${split.duplicateOfPath}) — one product should be one concept`,
    });
  }

  for (const conflict of context.precomputedFolderConflicts ?? []) {
    warnings.push({
      path: conflict.path,
      reason: `near-duplicate concept folder: "${conflict.proposedFolder}" doubles the existing folder "${conflict.existingFolder}" (singular/plural of one word) — reuse the existing folder`,
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

/**
 * A proposed folder that near-duplicates an EXISTING concept folder.
 *
 * The closed grid used to make this impossible by construction: classes were
 * a fixed vocabulary built once at corpus level. The folder model removed
 * that guarantee, and the LLM re-invented it per source — the first parallel
 * a first parallel ingest once produced both `products` and `product`, one folder per
 * singular/plural spelling, and every later source filed into whichever the
 * model happened to pick. Nothing merged them afterwards. This detector is
 * the structural replacement: singular/plural variants (or an exact match
 * after accent/lowercase normalization) of an existing folder are a
 * near-duplicate, and the ingest retry loop tells the model to reuse the
 * existing folder instead.
 */
export type FolderConflict = {
  /** The planned leaf path that would open the near-duplicate folder. */
  path: string;
  /** The folder name the plan proposes. */
  proposedFolder: string;
  /** The existing folder it near-duplicates. */
  existingFolder: string;
};

const FOLDER_SINGULAR_SUFFIXES = new Set(['s', 'x']);

export function folderNearKey(folder: string): string {
  return folder
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The words of a folder name, each singularized. Both '-' and '_' collapse to
 * the same separator in `folderNearKey`, so a name written with underscores
 * compares like its hyphenated twin — "exigences_meteo_france" and
 * "requirements-operations" are one folder for this check.
 */
export function folderWords(key: string): string[] {
  return key.split('-').filter(Boolean).map((word) => {
    if (word.length >= 4 && FOLDER_SINGULAR_SUFFIXES.has(word[word.length - 1] ?? '')) {
      const stem = word.slice(0, -1);
      return stem.length >= 3 ? stem : word;
    }
    return word;
  });
}

export function foldersAreNearDuplicates(left: string, right: string): boolean {
  const a = folderNearKey(left);
  const b = folderNearKey(right);
  if (!a || !b || a === b) return false;
  // Whole-name singular/plural: "produit" / "produits".
  if (a.length >= 4 && b.length >= 4) {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (longer.length - shorter.length === 1
      && longer.startsWith(shorter)
      && FOLDER_SINGULAR_SUFFIXES.has(longer[longer.length - 1] ?? '')) {
      return true;
    }
  }
  // Word-aware: one concept, one folder — whatever the number or the
  // refinement appended after a hyphen. "requirement"/"requirements",
  // "exigence"/"requirements-operations", "produit"/"produit-anaplan",
  // "solution-logicielle"/"solutions-externes" are all the SAME first word
  // and therefore near-duplicates: file into the existing folder, keep the
  // refinement as the subject.
  const wa = folderWords(a);
  const wb = folderWords(b);
  if (wa.length > 0 && wb.length > 0 && wa[0] === wb[0]) return true;
  return false;
}

export function detectNearDuplicateFolders(
  plan: ConsolidationPlan,
  { existingFolders = [] }: { existingFolders?: string[] } = {},
): FolderConflict[] {
  const conflicts: FolderConflict[] = [];
  const proposedNew = new Set<string>();
  for (const operation of plan.operations ?? []) {
    if (operation.type !== 'create' || !operation.path.startsWith(CONCEPT_PREFIX)) continue;
    const folder = parseConceptPagePath(operation.path)?.class ?? null;
    if (!folder) continue;
    // A leaf filed into an existing folder is the model working as intended.
    if (existingFolders.includes(folder)) continue;
    const conflictWith = (existing: string) => {
      conflicts.push({ path: operation.path, proposedFolder: folder, existingFolder: existing });
    };
    const existing = existingFolders.find((candidate) =>
      foldersAreNearDuplicates(folder, candidate)
      || folderNearKey(folder) === folderNearKey(candidate));
    if (existing) {
      conflictWith(existing);
      continue;
    }
    // Two NEW folders proposed in one plan (or one batch) that are variants
    // of each other: the first one written wins, the second is the duplicate.
    const sibling = [...proposedNew].find((candidate) =>
      foldersAreNearDuplicates(folder, candidate));
    if (sibling) {
      conflictWith(sibling);
      continue;
    }
    proposedNew.add(folder);
  }
  return conflicts;
}

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
