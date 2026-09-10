import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import {
  applyProvenance,
  isValidProvenanceValue,
  normalizeProvenanceValue,
  readProvenance,
} from '../../ingest/provenance.ts';
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
  | { kind: 'refile'; className: string; subject: string; target: string; isTaxoRefile: boolean };

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

  const toRest = input.to.startsWith(CONCEPT_PATH_PREFIX) && input.to.endsWith('.md')
    ? input.to.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length).split('/')
    : null;
  if (!toRest || toRest.length !== 2) {
    return {
      kind: 'reject',
      reason: 'a concept page can only be refiled inside a concept folder',
    };
  }
  const [className, base] = toRest as [string, string];
  // A `<concept>_<resume>.md` leaf carries its concept in the file name: the
  // move renames it to the new concept, so the name never lies about where
  // the leaf lives. Parsed structurally here — the underscore in the name is
  // the taxo convention, not a provenance value.
  const fromRest = input.from.startsWith(CONCEPT_PATH_PREFIX) && input.from.endsWith('.md')
    ? input.from.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length).split('/')
    : null;
  if (fromRest && fromRest.length === 2 && base.startsWith(`${fromRest[0]}_`)) {
    const resume = base.slice(fromRest[0].length + 1);
    if (!isValidProvenanceValue(className) || !isValidProvenanceValue(resume)) {
      return {
        kind: 'reject',
        reason: 'a concept page can only be refiled inside a concept folder',
      };
    }
    return {
      kind: 'refile',
      className,
      subject: resume,
      target: `${CONCEPT_PATH_PREFIX}${className}/${className}_${resume}.md`,
      isTaxoRefile: true,
    };
  }
  const axes = parseConceptPagePath(input.to);
  if (!axes) {
    return {
      kind: 'reject',
      reason: 'a concept page can only be refiled inside a concept folder',
    };
  }
  return { kind: 'refile', className: axes.class, subject: axes.subject, target: input.to, isTaxoRefile: false };
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
  axes: { className: string; subject: string; isTaxoRefile: boolean },
): Promise<void> {
  const absolute = resolveInside(rootDir, target);
  const content = await readFile(absolute, 'utf8');
  const parsed = matter(content);
  // The taxo leaves carry an explicit `concept:` field in their frontmatter:
  // the move changed the folder, so the field follows it — read and
  // rewritten through the parsed frontmatter DATA object, never matched
  // against the raw file text, so a body line that happens to start with
  // "concept:" (prose, a bullet list) is never touched.
  const withConcept = parsed.data.concept != null
    ? matter.stringify(parsed.content, { ...parsed.data, concept: axes.className })
    : content;
  const current = readProvenance(withConcept);
  const rewritten = applyProvenance(
    withConcept,
    {
      // A taxo leaf's subject is derived from its OWN basename
      // (<concept>_<resume> normalized, e.g. "jedox-tarifs") — it is
      // therefore always truthy, so "only fill when absent" would silently
      // leave it naming the OLD concept forever after a move. Re-derive it
      // from the file's new basename, the same way ingest does at creation
      // time. The classic model's subject is independent of the folder
      // ("cost-model" stays "cost-model" wherever it is filed) and must NOT
      // be touched on a plain re-file — only the taxo convention ties the
      // subject to the path this tightly.
      subject: axes.isTaxoRefile
        ? normalizeProvenanceValue(target.split('/').pop()?.replace(/\.md$/, '') ?? '')
        : (current.subject ? null : axes.subject),
      scope: null,
      kind: null,
      tags: [],
    },
    okfTypeForPath(target, { kind: current.kind }),
  );
  if (rewritten !== withConcept || withConcept !== content) await safeWriteFile(absolute, rewritten);
}
