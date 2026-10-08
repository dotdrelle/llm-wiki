import { readdir, readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import {
  applyProvenance,
  isValidProvenanceValue,
  newKnowledgeIdentity,
  normalizeProvenanceValue,
  readProvenance,
} from '../../ingest/provenance.ts';
import { okfTypeForPath } from '../../okf/frontmatter.ts';
import {
  CONCEPT_PATH_PREFIX,
  parseConceptPagePath,
} from '../../ingest/conceptGrid.ts';
import { resolveInside } from '../../utils/path.ts';
import { pathExists, safeWriteFile } from '../../utils/fs.ts';

/*
 Filing a concept leaf by hand, from the tree.

 Folder names are current labels; `concept_id` is the durable identity. A move
 under `wiki/concepts/` is a filing decision — drag a leaf into another
 concept folder and it is re-filed — and it rewrites the leaf's subject label
 when needed, assigns the destination concept identity, and repoints inbound
 links. The OKF frontmatter is applied on the way.
*/

export type ConceptMoveDecision =
  | { kind: 'ignore' }
  | { kind: 'reject'; reason: string }
  | { kind: 'refile'; className: string; subject: string; target: string; isTagPage: boolean };

/**
 * Decides what a move touching `wiki/concepts/` means, before anything is
 * renamed. Pure.
 */
export function decideConceptMove(input: {
  from: string;
  to: string;
  isFile: boolean;
  isTagPage?: boolean;
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
  const fromRest = input.from.startsWith(CONCEPT_PATH_PREFIX) && input.from.endsWith('.md')
    ? input.from.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length).split('/')
    : null;
  if (input.isTagPage) {
    const subject = normalizeProvenanceValue(base);
    if (!fromRest || fromRest.length !== 2 || !isValidProvenanceValue(className)
      || !isValidProvenanceValue(subject) || subject !== base) {
      return { kind: 'reject', reason: 'a TAXO tag page must keep its tag filename when moved between families' };
    }
    return { kind: 'refile', className, subject, target: input.to, isTagPage: true };
  }
  const axes = parseConceptPagePath(input.to);
  if (!axes) {
    return {
      kind: 'reject',
      reason: 'a concept page can only be refiled inside a concept folder',
    };
  }
  return { kind: 'refile', className: axes.class, subject: axes.subject, target: input.to, isTagPage: false };
}

/**
 * Refuse a manual re-file into a destination whose pages carry SEVERAL
 * distinct concept identities: the moved page could not adopt one without
 * silently choosing between them.
 *
 * A destination with no identity at all — the pre-TAXO concept folders an
 * older ingest left behind carry none — or with one identity and some
 * unidentified pages is not ambiguous: the move is the reader's explicit
 * filing decision, and `applyConceptAxes` gives the page the folder's single
 * identity, or a fresh one. Refusing those cases blocked every hand-filing
 * into a legacy folder with a message only `pnpm concepts:identities` could
 * answer.
 */
export async function conceptFolderIdentityIssue(
  rootDir: string,
  sourcePath: string,
  destinationFolder: string,
  isTagPage = false,
): Promise<string | null> {
  // Family folders contain independent tag concepts; their page identities
  // are intentionally distinct and must not be collapsed to a folder ID.
  if (isTagPage) return null;
  if (parseConceptPagePath(sourcePath)?.class === destinationFolder) return null;
  const targetFolder = resolveInside(rootDir, `${CONCEPT_PATH_PREFIX}${destinationFolder}`);
  const children = await readdir(targetFolder, { withFileTypes: true }).catch(() => []);
  const pages = children.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  if (pages.length === 0) return null;
  const pagesByIdentity = new Map<string, string[]>();
  for (const page of pages) {
    const content = await readFile(resolveInside(rootDir, `${CONCEPT_PATH_PREFIX}${destinationFolder}/${page.name}`), 'utf8').catch(() => '');
    const identity = content ? readProvenance(content).concept_id : null;
    if (identity) pagesByIdentity.set(identity, [...(pagesByIdentity.get(identity) ?? []), page.name]);
  }
  if (pagesByIdentity.size > 1) {
    const groups = [...pagesByIdentity.values()].map((names) => names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''));
    return `The pages of ${destinationFolder}/ carry ${pagesByIdentity.size} different concept identities (${groups.join(' | ')}); `
      + 'the moved page cannot pick one. Resolve the conflict (pnpm concepts:identities on a copy) or refile into another folder.';
  }
  return null;
}

/**
 * A readable fallback for a classic concept leaf whose physical name is
 * already taken in the destination folder.
 *
 * A manual re-file must not be refused just because two folders happen to hold
 * a same-named file. When the destination basename collides, the move lands
 * under the subject display label's normalized filename. Returns null when
 * there is no usable label, when it names the same file, or when that filename
 * is already filed there — the caller then keeps the hard 409.
 *
 * Taxo leaves (`<concept>_<resume>.md`) do NOT use it: their name carries the
 * concept by convention, so a fallback would break that shape.
 */
export async function subjectRefileTarget(input: {
  rootDir: string;
  source: string;
  toDir: string;
  currentTarget: string;
}): Promise<{ target: string; subject: string } | null> {
  const content = await readFile(resolveInside(input.rootDir, input.source), 'utf8').catch(() => null);
  if (!content) return null;
  const raw = matter(content).data?.subject;
  if (typeof raw !== 'string') return null;
  const subject = normalizeProvenanceValue(raw);
  if (!isValidProvenanceValue(subject)) return null;
  const target = `${input.toDir}/${subject}.md`;
  if (target === input.currentTarget) return null;
  if (await pathExists(resolveInside(input.rootDir, target))) return null;
  return { target, subject };
}

/**
 * Rewrites the leaf's provenance after it has just been renamed into `target`.
 *
 * `subject` follows the file name when it is missing; `concept_id` follows the
 * destination folder's stable identity. The OKF frontmatter is applied.
 */
export async function applyConceptAxes(
  rootDir: string,
  target: string,
  axes: { sourcePath: string; className: string; subject: string; isTagPage: boolean },
): Promise<void> {
  const absolute = resolveInside(rootDir, target);
  const content = await readFile(absolute, 'utf8');
  const parsed = matter(content);
  // The taxo leaves carry an explicit `concept:` field in their frontmatter:
  // the move changed the folder, so the field follows it — read and
  // rewritten through the parsed frontmatter DATA object, never matched
  // against the raw file text, so a body line that happens to start with
  // "concept:" (prose, a bullet list) is never touched.
  const targetFolder = resolveInside(rootDir, `${CONCEPT_PATH_PREFIX}${axes.className}`);
  const targetFiles = await readdir(targetFolder, { withFileTypes: true }).catch(() => []);
  const establishedFamily = axes.isTagPage
    ? (await Promise.all(targetFiles
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== target.split('/').pop())
      .map(async (entry) => {
        const sibling = await readFile(resolveInside(rootDir, `${CONCEPT_PATH_PREFIX}${axes.className}/${entry.name}`), 'utf8').catch(() => '');
        const family = sibling ? matter(sibling).data?.family : null;
        return typeof family === 'string' && normalizeProvenanceValue(family) === axes.className ? family : null;
      }))).find((family): family is string => family !== null)
    : undefined;
  const withConcept = axes.isTagPage
    ? matter.stringify(parsed.content, { ...parsed.data, family: establishedFamily ?? axes.className })
    : parsed.data.concept != null
      ? matter.stringify(parsed.content, { ...parsed.data, concept: axes.className })
      : content;
  const current = readProvenance(withConcept);
  const sourceFolder = parseConceptPagePath(axes.sourcePath)?.class ?? null;
  const targetIdentities = new Set<string>();
  for (const entry of targetFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === target.split('/').pop()) continue;
    const sibling = await readFile(resolveInside(rootDir, `${CONCEPT_PATH_PREFIX}${axes.className}/${entry.name}`), 'utf8').catch(() => '');
    const id = readProvenance(sibling).concept_id;
    if (id) targetIdentities.add(id);
  }
  const targetConceptId = axes.isTagPage
    ? current.concept_id ?? newKnowledgeIdentity()
    : targetIdentities.size === 1
    ? [...targetIdentities][0]!
    : sourceFolder === axes.className
      ? current.concept_id ?? newKnowledgeIdentity()
      : newKnowledgeIdentity();
  const rewritten = applyProvenance(
    withConcept,
    {
      subject: axes.isTagPage
        ? (current.subject ?? axes.subject)
        : (current.subject ? null : axes.subject),
      concept_id: targetConceptId,
      subject_id: current.subject_id ?? newKnowledgeIdentity(),
      scope: null,
      kind: null,
      tags: [],
    },
    okfTypeForPath(target),
  );
  if (rewritten !== withConcept || withConcept !== content) await safeWriteFile(absolute, rewritten);
}
