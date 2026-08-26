import { mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveInside } from '../../utils/path.ts';

/**
 * Left-panel tree mutations, for ALL of its sections.
 *
 * Only `raw/untracked/` used to be editable: delete, move. The other sections —
 * wiki, templates, build-context, deliverables — had no move, folder create or
 * delete at all. Writing a second implementation per section would have
 * multiplied by five the places where the no-escape guarantee must hold,
 * without making any of them safer.
 *
 * This module is therefore parameterized by the authorized root. The sections
 * differ only by their `TreeRoot`; the mechanism itself is unique — including
 * for Pending, whose legacy API now delegates here.
 */

export type TreeEntryKind = 'file' | 'folder';

export type TreeRoot = {
  /** Relative path of the sub-tree, without a trailing slash. */
  root: string;
  /**
   * File extension imposed on files, or null to impose none.
   * The wiki, templates and deliverables are Markdown: accepting anything else
   * there would create files no view can display.
   */
  fileExtension: string | null;
  /**
   * Prune the folders the operation just emptied, up to the excluded root.
   * True for Pending, where a folder is only a temporary grouping; false for
   * the wiki, where an empty folder is an organizing intention nobody asked to
   * erase.
   */
  pruneEmptyDirs: boolean;
};

// `EDITABLE_DIRS` in wikiHtml.ts is the same list seen from the rendering.
// Here it also carries the per-section rules, which have no meaning HTML-side.
export const TREE_ROOTS: Record<string, TreeRoot> = {
  wiki: { root: 'wiki', fileExtension: '.md', pruneEmptyDirs: false },
  deliverables: { root: 'deliverables', fileExtension: '.md', pruneEmptyDirs: false },
  templates: { root: 'templates', fileExtension: '.md', pruneEmptyDirs: false },
  'build-context': { root: 'build-context', fileExtension: '.md', pruneEmptyDirs: false },
  pending: { root: 'raw/untracked', fileExtension: '.md', pruneEmptyDirs: true },
};

export type TreeResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: 400 | 409 | 413; error: string };

function fail(error: string, status: 400 | 409 | 413 = 400): TreeResult {
  return { ok: false, status, error };
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Section that owns a path, or null.
 *
 * Here, and nowhere else, is decided what a client-supplied path is allowed to
 * be. A path outside the known roots, or carrying `..`, is not corrected: it is
 * refused.
 */
export function resolveTreeRoot(relativePath: string): TreeRoot | null {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return null;
  for (const entry of Object.values(TREE_ROOTS)) {
    if (normalized === entry.root || normalized.startsWith(`${entry.root}/`)) return entry;
  }
  return null;
}

export function normalizeRelative(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const relative = toPosix(value).replace(/^\/+|\/+$/g, '');
  if (!relative) return null;
  if (relative.split('/').includes('..')) return null;
  return relative;
}

function isRootItself(relativePath: string, root: TreeRoot): boolean {
  return relativePath === root.root;
}

function hasAllowedExtension(relativePath: string, root: TreeRoot): boolean {
  return root.fileExtension === null || relativePath.endsWith(root.fileExtension);
}

export async function deleteEntry(rootDir: string, rawPath: string): Promise<TreeResult> {
  const relativePath = normalizeRelative(rawPath);
  const root = relativePath ? resolveTreeRoot(relativePath) : null;
  if (!relativePath || !root) return fail('path outside the editable tree');
  // Deleting a section's root would amount to deleting the section.
  if (isRootItself(relativePath, root)) return fail('cannot delete a section root');

  try {
    const absolute = resolveInside(rootDir, relativePath);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      await rm(absolute, { recursive: true });
      await pruneEmptyParents(rootDir, path.posix.dirname(relativePath), root);
      return { ok: true, status: 200, body: { path: relativePath, kind: 'folder' } };
    }
    if (!info.isFile() || !hasAllowedExtension(relativePath, root)) {
      return fail(`only ${root.fileExtension ?? 'known'} files can be deleted here`);
    }
    await rm(absolute);
    await pruneEmptyParents(rootDir, path.posix.dirname(relativePath), root);
    return { ok: true, status: 200, body: { path: relativePath, kind: 'file' } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Move an entry. `toDir` is the DESTINATION folder; the entry keeps its name.
 * A move from one section to another is refused: a template placed in `wiki/`
 * is no longer a template, and nothing in the UI would say what it became.
 */
export async function moveEntry(
  rootDir: string,
  rawFrom: unknown,
  rawTo: unknown,
): Promise<TreeResult> {
  const from = normalizeRelative(rawFrom);
  const fromRoot = from ? resolveTreeRoot(from) : null;
  if (!from || !fromRoot) return fail('path outside the editable tree');
  if (isRootItself(from, fromRoot)) return fail('cannot move a section root');

  // Empty destination = the source section's root, the only folder that is not
  // written as a full path in the UI.
  const toDir = rawTo === '' || rawTo === undefined || rawTo === null
    ? fromRoot.root
    : normalizeRelative(rawTo);
  const toRoot = toDir ? resolveTreeRoot(toDir) : null;
  if (!toDir || !toRoot) return fail('destination outside the editable tree');
  if (toRoot.root !== fromRoot.root) {
    return fail(`cannot move between sections (${fromRoot.root} → ${toRoot.root})`);
  }

  const name = from.slice(from.lastIndexOf('/') + 1);
  const target = `${toDir}/${name}`;
  if (target === from) return { ok: true, status: 200, body: { from, to: target, unchanged: true } };
  // Moving a folder into itself or one of its descendants would detach the
  // sub-tree: rename() returns EINVAL in the first case and behaves differently
  // across platforms in the second.
  if (`${toDir}/`.startsWith(`${from}/`)) return fail('cannot move a folder into itself');

  try {
    const source = resolveInside(rootDir, from);
    const destination = resolveInside(rootDir, target);
    const sourceInfo = await stat(source);
    if (sourceInfo.isFile() && !hasAllowedExtension(from, fromRoot)) {
      return fail(`only ${fromRoot.fileExtension ?? 'known'} files can be moved here`);
    }
    const destinationDirInfo = await stat(resolveInside(rootDir, toDir)).catch(() => null);
    if (!destinationDirInfo?.isDirectory()) return fail('destination folder does not exist');
    // Never overwrite: rename() would replace the file silently. The collision
    // belongs to whoever moves.
    if (await stat(destination).then(() => true, () => false)) {
      return fail(`already exists: ${target}`, 409);
    }
    await rename(source, destination);
    await pruneEmptyParents(rootDir, path.posix.dirname(from), fromRoot);
    return {
      ok: true,
      status: 200,
      body: { from, to: target, kind: sourceInfo.isDirectory() ? 'folder' : 'file' },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// Un fichier depose dans Pending est du Markdown redige a la main : au-dela de
// 5 Mo ce n'est plus une source, c'est une erreur de manipulation.
const MAX_CREATED_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Create a folder, or a file, inside a section.
 *
 * `rawContent` lets a caller seed the file (drag & drop of a .md into Pending
 * writes the dropped file's text here). Absent, the file is created empty, as
 * the "New file" button has always done.
 */
export async function createEntry(
  rootDir: string,
  rawParent: unknown,
  rawName: unknown,
  kind: TreeEntryKind,
  rawContent?: unknown,
): Promise<TreeResult> {
  const parent = normalizeRelative(rawParent);
  const root = parent ? resolveTreeRoot(parent) : null;
  if (!parent || !root) return fail('parent outside the editable tree');

  const name = typeof rawName === 'string' ? rawName.trim() : '';
  // A name is just a name: no separator, so no traversal possible through this
  // path, and no implicit hierarchy creation.
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return fail('invalid name');
  }
  const fileName = kind === 'file' && root.fileExtension && !name.endsWith(root.fileExtension)
    ? `${name}${root.fileExtension}`
    : name;
  const target = `${parent}/${fileName}`;

  try {
    const absolute = resolveInside(rootDir, target);
    if (await stat(absolute).then(() => true, () => false)) {
      return fail(`already exists: ${target}`, 409);
    }
    const parentInfo = await stat(resolveInside(rootDir, parent)).catch(() => null);
    if (!parentInfo?.isDirectory()) return fail('parent folder does not exist');
    if (kind === 'folder') {
      await mkdir(absolute, { recursive: false });
    } else {
      const content = typeof rawContent === 'string' ? rawContent : '';
      if (content.length > MAX_CREATED_FILE_BYTES) return fail('file too large', 413);
      // `wx`: fails if the file exists, rather than truncating it. The
      // existence check above leaves a race window that this flag closes.
      await writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' });
    }
    return { ok: true, status: 200, body: { path: target, kind } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Prune the folders the operation emptied, up to the excluded section root.
 * Always best-effort: failing to tidy up must not turn a successful deletion
 * into an error.
 */
async function pruneEmptyParents(
  rootDir: string,
  relativeDir: string,
  root: TreeRoot,
): Promise<void> {
  if (!root.pruneEmptyDirs) return;
  const sectionRoot = resolveInside(rootDir, root.root);
  let current: string;
  try {
    current = resolveInside(rootDir, relativeDir);
  } catch {
    return;
  }
  while (current !== sectionRoot && current.startsWith(`${sectionRoot}${path.sep}`)) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      // rmdir, not rm: rm() without `recursive` throws EISDIR even on an empty
      // folder, which made deleting the last file of a folder fail even though
      // the work was already done.
      await rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
