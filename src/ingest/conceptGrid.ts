import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidProvenanceValue, normalizeProvenanceValue } from './provenance.ts';

/*
 The concept grid: the CLOSED set of ranking classes of a workspace.

 A class is not an entity. The name of one product is a subject; the class is
 what receives every document evaluating that KIND of thing — this product
 today, the next one next month. The distinction is the whole point: built one
 source at a time, the consolidation can only ever name what the document in
 front of it names, so it produces one page per product, per supplier, per
 ticket, and the wiki ends up an entity list where it needed a filing plan.

 The grid is therefore a workspace-level artefact, decided once over the whole
 corpus and consumed afterwards. Nothing here builds it — that is the concepts
 pass. This module only READS it, so that the ingest can range into it and
 refuse what it cannot range.

 Source of truth: the controlled-vocabulary block of `wiki/concepts-grid.md`.
 A markdown file, because the grid is small enough (2 to 15 entries) to be
 written or corrected by hand, and because a human must be able to read what
 the whole classification rests on without a tool.
*/

/** Where the grid lives, relative to the workspace root. */
export const CONCEPT_GRID_RELATIVE_PATH = 'wiki/concepts-grid.md';

/**
 * Size bounds of a grid.
 *
 * Below two classes there is no classification, only a label. Above fifteen
 * the grid stops being a filing plan a person can hold in mind, and the model
 * ranging into it starts hesitating between neighbours — which is the defect
 * the grid exists to remove. The same two numbers must bound the concepts
 * pass that WRITES the grid: they are exported for that reason.
 */
export const MIN_GRID_CLASSES = 2;
export const MAX_GRID_CLASSES = 15;

/**
 * What a class says about itself, for the prompt that files into it.
 *
 * The vocabulary block alone gives the closed set — enough to VALIDATE. It is
 * not enough to FILE: two neighbouring classes can be indistinguishable from
 * their identifiers alone, and the whole point of the
 * membership criterion is that it decides between them without arbitration.
 * So the criterion travels with the grid, and a grid written by hand with only
 * a vocabulary block still works — the class then speaks for itself under its
 * own name, which is worse but never wrong.
 */
export type ConceptClassInfo = { id: string; label: string; criterion: string | null };

export type ConceptGrid = {
  /** Declared order, preserved: it is the order the filing procedure asks in. */
  readonly classes: readonly string[];
  readonly set: ReadonlySet<string>;
  /** Per-class label and membership question, when the file documents them. */
  readonly info?: ReadonlyMap<string, ConceptClassInfo>;
};

export type ConceptGridRead =
  | { status: 'absent' }
  | { status: 'ok'; grid: ConceptGrid }
  | { status: 'malformed'; issues: string[] };

/**
 * Parses the grid out of the markdown file.
 *
 * Deliberately strict and dependency-free: the block is written by the
 * concepts pass in one known shape, and a grid we only half-understood is
 * worse than no grid at all — it would silently narrow the closed set and
 * reject legitimate pages. Anything unexpected is reported, never guessed.
 *
 * Recognized shape (fenced yaml block, anywhere in the file):
 *
 *     ```yaml
 *     class:
 *       - first-class
 *       - second-class
 *     ```
 */
export function parseConceptGrid(markdown: string): ConceptGridRead {
  const block = findClassBlock(markdown);
  if (block == null) return { status: 'absent' };

  const issues: string[] = [];
  const classes: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of block) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('-')) {
      issues.push(`unreadable line in the class list: « ${line} »`);
      continue;
    }
    const value = line.slice(1).trim().replace(/^["']|["']$/g, '');
    if (!value) {
      issues.push('empty entry in the class list');
      continue;
    }
    const normalized = normalizeProvenanceValue(value);
    if (!normalized || !isValidProvenanceValue(normalized)) {
      issues.push(`class « ${value} » is not a valid identifier (lowercase, dash-separated)`);
      continue;
    }
    if (normalized !== value) {
      issues.push(`class « ${value} » is not written in canonical form (expected « ${normalized} »)`);
      continue;
    }
    if (seen.has(normalized)) {
      issues.push(`class « ${normalized} » is declared twice`);
      continue;
    }
    seen.add(normalized);
    classes.push(normalized);
  }

  if (!issues.length && classes.length < MIN_GRID_CLASSES) {
    issues.push(`${classes.length} class(es) declared, minimum is ${MIN_GRID_CLASSES}`);
  }
  if (!issues.length && classes.length > MAX_GRID_CLASSES) {
    issues.push(`${classes.length} classes declared, maximum is ${MAX_GRID_CLASSES}`);
  }
  if (issues.length) return { status: 'malformed', issues };
  return { status: 'ok', grid: { classes, set: seen, info: parseClassInfo(markdown, seen) } };
}

/**
 * Reads the documented label and membership question of each class.
 *
 * Best-effort by design, and only for classes the vocabulary block already
 * declared: the prose sections are documentation, the block is the contract.
 * A section that cannot be read costs a less precise prompt, never a class
 * silently added to or removed from the closed set.
 */
function parseClassInfo(
  markdown: string,
  known: ReadonlySet<string>,
): ReadonlyMap<string, ConceptClassInfo> {
  const info = new Map<string, ConceptClassInfo>();
  const sections = markdown.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const label = section.split(/\r?\n/, 1)[0]?.trim() ?? '';
    const id = section.match(/\*\*id\.\*\*\s*`([^`]+)`/)?.[1]?.trim();
    if (!id || !known.has(id) || info.has(id)) continue;
    const criterion = section
      .match(/\*\*Membership criterion\.\*\*\s*\*?([^\n*]+)\*?/)?.[1]
      ?.trim() ?? null;
    info.set(id, { id, label: label || id, criterion });
  }
  return info;
}

/**
 * Reads the grid of a workspace.
 *
 * A missing file is `absent`, not an error: the grid is introduced by its own
 * pass, and an ingest run must stay possible before it exists — in that state
 * the validation only warns. A file that exists but cannot be read as a grid
 * is `malformed` and must stop the run: degrading to `absent` would turn every
 * blocking rule into a warning without anything saying so.
 */
export async function readConceptGrid(rootDir: string): Promise<ConceptGridRead> {
  let content: string;
  try {
    content = await readFile(path.join(rootDir, CONCEPT_GRID_RELATIVE_PATH), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'absent' };
    throw error;
  }
  const parsed = parseConceptGrid(content);
  if (parsed.status === 'absent') {
    return {
      status: 'malformed',
      issues: [`${CONCEPT_GRID_RELATIVE_PATH} exists but carries no "class:" vocabulary block`],
    };
  }
  return parsed;
}

/** Lines of the first fenced block that declares `class:`, or null if there is none. */
function findClassBlock(markdown: string): string[] | null {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let inClassKey = false;
  let collected: string[] | null = null;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence && collected) return collected;
      inFence = !inFence;
      inClassKey = false;
      continue;
    }
    if (!inFence) continue;
    if (/^\s*class\s*:\s*$/.test(line)) {
      inClassKey = true;
      collected = [];
      continue;
    }
    // Another top-level key closes the class list: only `- item` lines and
    // indented continuations belong to it.
    if (inClassKey && /^\S/.test(line) && !line.trim().startsWith('-')) {
      inClassKey = false;
      continue;
    }
    if (inClassKey && collected) collected.push(line);
  }
  return collected;
}

/*
 Path convention of a leaf.

 One leaf per (class × subject): a subject cited under three classes yields
 three pages, each carrying only what belongs to its class. The path therefore
 CARRIES the two axes, which makes two things deterministic that used to need a
 model: reuse (the path of an existing leaf is deducible, so the consolidation
 no longer needs an inventory of the corpus to avoid duplicating a page), and
 the transverse edge of the graph (two leaves sharing a subject under two
 classes are siblings — computed, not guessed).

 That only holds while the path and the declared axes cannot disagree, which is
 what `conceptPathMismatch` enforces.
*/
export const CONCEPT_PATH_PREFIX = 'wiki/concepts/';

/**
 * The reserved class a leaf falls into when it matches no class of the grid —
 * or when no grid exists yet.
 *
 * It is never part of the grid itself: the grid is the closed set a pass (or a
 * human) decided, and `unclassified` is the ENGINE's answer to "this subject
 * does not belong to that set yet". It is always a valid class, so nothing is
 * ever rejected for want of a class; the leaf waits at
 * `wiki/concepts/unclassified/<subject>.md` until someone files it into a real
 * class. The taxonomy already treats it as the "Non classé" bucket
 * (`derived.ts`), so no further wiring is needed there.
 */
export const UNCLASSIFIED_CLASS = 'unclassified';

export function conceptPagePath(className: string, subject: string): string {
  return `${CONCEPT_PATH_PREFIX}${className}/${subject}.md`;
}

export type ConceptPathAxes = { class: string; subject: string };

export function parseConceptPagePath(pagePath: string): ConceptPathAxes | null {
  if (!pagePath.startsWith(CONCEPT_PATH_PREFIX) || !pagePath.endsWith('.md')) return null;
  const rest = pagePath.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length);
  const parts = rest.split('/');
  if (parts.length !== 2) return null;
  const [className, subject] = parts as [string, string];
  if (!isValidProvenanceValue(className) || !isValidProvenanceValue(subject)) return null;
  return { class: className, subject };
}

/**
 * Why a leaf's path disagrees with its declared axes, or null when they agree.
 *
 * The defect this catches is not hypothetical: on a real corpus a page named
 * after one product was written with the `subject` of a completely different
 * page, and nothing rejected it. The taxonomy then read that frontmatter as authoritative.
 */
export function conceptPathMismatch(
  pagePath: string,
  axes: { class: string; subject: string },
): string | null {
  const expected = conceptPagePath(axes.class, axes.subject);
  if (pagePath === expected) return null;
  return `path does not match its declared axes; expected ${expected}`;
}
