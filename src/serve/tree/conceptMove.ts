import { readFile } from 'node:fs/promises';
import { applyProvenance, readProvenance } from '../../ingest/provenance.ts';
import { okfTypeForPath } from '../../okf/frontmatter.ts';
import {
  CONCEPT_PATH_PREFIX,
  parseConceptPagePath,
  readConceptGrid,
  UNCLASSIFIED_CLASS,
} from '../../ingest/conceptGrid.ts';
import { resolveInside } from '../../utils/path.ts';
import { safeWriteFile } from '../../utils/fs.ts';

/*
 Filing a concept leaf by hand, from the tree.

 A leaf carries its axes twice: in its frontmatter (`class`, `subject`) and in
 its path, `wiki/concepts/<class>/<subject>.md`. Ingestion already settles the
 disagreement — `reconcileConceptAxes` makes the PATH authoritative and rewrites
 a contradicting frontmatter. The taxonomy settles it the other way: it reads
 the frontmatter and never looks at the path.

 A bare rename therefore moved the file and changed nothing else: dragging a
 page out of `unclassified` into a class left it filed under `unclassified` in
 the taxonomy, silently, until some later re-ingestion of its source happened to
 pass over it. Worse, `raw` renames leave every inbound `[src: …]` pointing at
 the old path.

 So a move under `wiki/concepts/` is not a file operation, it is a filing
 decision, and it goes through the same three steps `reclassify-concepts`
 already performs: check the class against the grid, rewrite the frontmatter,
 rewrite the inbound links.
*/

export type ConceptMoveDecision =
  | { kind: 'ignore' }
  | { kind: 'reject'; reason: string }
  | { kind: 'refile'; className: string; subject: string };

export type ConceptGridClasses = { status: 'ok'; set: ReadonlySet<string> } | { status: 'absent' } | { status: 'malformed'; issues: string[] };

/**
 * Decides what a move touching `wiki/concepts/` means, before anything is
 * renamed. Pure: the caller supplies the grid.
 */
export function decideConceptMove(input: {
  from: string;
  to: string;
  isFile: boolean;
  grid: ConceptGridClasses;
}): ConceptMoveDecision {
  const touches = input.from.startsWith(CONCEPT_PATH_PREFIX) || input.to.startsWith(CONCEPT_PATH_PREFIX);
  if (!touches) return { kind: 'ignore' };

  /*
   Moving a whole class folder re-files every leaf it holds and leaves the grid
   claiming a class nothing is filed under any more. That is a grid operation —
   retire the class, or empty it into `unclassified` — not a drag in a tree, and
   doing it silently here would be the one case where the vocabulary and the
   corpus stop agreeing without a word.
  */
  if (!input.isFile) {
    return {
      kind: 'reject',
      reason: 'moving a folder under wiki/concepts/ would re-file every page it holds: retire or empty the class instead',
    };
  }

  // The grid is introduced by its own pass; an absent one must not block a
  // workspace that has not run it yet. A malformed one is a different thing:
  // degrading it to "absent" would turn a blocking rule into silence.
  if (input.grid.status === 'malformed') {
    return { kind: 'reject', reason: `the concept grid cannot be read: ${input.grid.issues.join('; ')}` };
  }

  const axes = parseConceptPagePath(input.to);
  if (!axes) {
    return {
      kind: 'reject',
      reason: 'a concept page must live under wiki/concepts/<class>/<subject>.md',
    };
  }
  if (input.grid.status === 'ok'
    && axes.class !== UNCLASSIFIED_CLASS
    && !input.grid.set.has(axes.class)) {
    return {
      kind: 'reject',
      reason: `« ${axes.class} » is not a class of the workspace grid (wiki/concepts-grid.md)`,
    };
  }
  return { kind: 'refile', className: axes.class, subject: axes.subject };
}

/** Reads the grid in the shape `decideConceptMove` expects. */
export async function conceptGridClasses(rootDir: string): Promise<ConceptGridClasses> {
  const read = await readConceptGrid(rootDir);
  if (read.status === 'ok') return { status: 'ok', set: read.grid.set };
  if (read.status === 'malformed') return { status: 'malformed', issues: read.issues };
  return { status: 'absent' };
}

/**
 * Rewrites the axes of a leaf that has just been renamed into `target`.
 *
 * `class` always follows the destination — that is the whole point of the move.
 * `subject` is only filled when it is missing: the file name did not change, so
 * a subject that already disagrees with it is a pre-existing defect this
 * operation has no mandate to decide about.
 */
export async function applyConceptAxes(
  rootDir: string,
  target: string,
  axes: { className: string; subject: string },
): Promise<void> {
  const absolute = resolveInside(rootDir, target);
  const content = await readFile(absolute, 'utf8');
  const current = readProvenance(content);
  const rewritten = applyProvenance(
    content,
    {
      subject: current.subject ? null : axes.subject,
      collection: null,
      scope: null,
      kind: null,
      class: axes.className,
      classSecondary: [],
    },
    okfTypeForPath(target, { kind: current.kind }),
  );
  if (rewritten !== content) await safeWriteFile(absolute, rewritten);
}
