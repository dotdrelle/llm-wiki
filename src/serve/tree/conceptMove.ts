import { readFile } from 'node:fs/promises';
import { applyProvenance, readProvenance } from '../../ingest/provenance.ts';
import { okfTypeForPath } from '../../okf/frontmatter.ts';
import {
  CONCEPT_PATH_PREFIX,
  parseConceptPagePath,
} from '../../ingest/conceptGrid.ts';
import { resolveInside } from '../../utils/path.ts';
import { safeWriteFile } from '../../utils/fs.ts';

/*
 Filing a concept leaf by hand, from the tree.

 The concept is the FOLDER, never a frontmatter field. A move under
 `wiki/concepts/` is therefore a filing decision — drag a leaf into another
 concept folder and it is re-filed — and it rewrites two things: the leaf's
 `subject` (when the file name changed) and the inbound `[src: …]` links that
 pointed at the old path. The OKF frontmatter is applied on the way.
*/

export type ConceptMoveDecision =
  | { kind: 'ignore' }
  | { kind: 'reject'; reason: string }
  | { kind: 'refile'; className: string; subject: string };

/**
 * Decides what a move touching `wiki/concepts/` means, before anything is
 * renamed. Pure.
 */
export function decideConceptMove(input: {
  from: string;
  to: string;
  isFile: boolean;
}): ConceptMoveDecision {
  const touches = input.from.startsWith(CONCEPT_PATH_PREFIX) || input.to.startsWith(CONCEPT_PATH_PREFIX);
  if (!touches) return { kind: 'ignore' };

  if (!input.isFile) {
    return {
      kind: 'reject',
      reason: 'moving a folder under wiki/concepts/ would re-file every page it holds: rename the concept by moving its leaves instead',
    };
  }

  const axes = parseConceptPagePath(input.to);
  if (!axes) {
    return {
      kind: 'reject',
      reason: 'a concept page must live under wiki/concepts/<concept>/<subject>.md',
    };
  }
  return { kind: 'refile', className: axes.class, subject: axes.subject };
}

/**
 * Rewrites the leaf's provenance after it has just been renamed into `target`.
 *
 * `subject` follows the file name when it is missing; the concept is the
 * folder, so nothing else changes. The OKF frontmatter is applied.
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
      scope: null,
      kind: null,
      tags: [],
    },
    okfTypeForPath(target, { kind: current.kind }),
  );
  if (rewritten !== content) await safeWriteFile(absolute, rewritten);
}
