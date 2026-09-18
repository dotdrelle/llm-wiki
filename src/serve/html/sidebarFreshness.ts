import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, toPosix } from '../../utils/path.ts';

/*
 What the sidebar knows about a wiki page without rendering it: its label and
 whether the last ingest touched it.

 Extracted out of wikiHtml.ts because it is the hot path, not because it is
 long. The sidebar renders on every page view and re-renders every 4 s while a
 build/export/polish job holds a deliverable lock, and the naive version paid
 one `stat` plus one `open`+`read` per wiki page on every one of those renders.
 Keeping the caching rules in one place is what makes that affordable — and
 reviewable.
*/

// The first 4 KB of a file, or null when it cannot be read.
//
// `close()` lives in a `finally`: a throw between `open` and `close` — EIO on a
// network mount, the file removed mid-render, EMFILE from the fan-out itself —
// leaked the descriptor for the process lifetime, and the sidebar issues one
// of these per wiki page, every render.
const FILE_HEAD_BYTES = 4096;
export async function readFileHead(rootDir: string, relativePath: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(resolveInside(rootDir, relativePath), 'r');
    const buffer = Buffer.alloc(FILE_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * The mtime of every wiki markdown file, in ONE pass.
 *
 * Two readers need it — the ingest-change badges and the title cache — and
 * statting the tree twice per render (then re-opening every concept leaf on
 * top) is what made a few thousand leaves cost several thousand syscalls a
 * render.
 */
export async function wikiFileMtimes(
  rootDir: string,
  wikiFiles: string[],
): Promise<Map<string, number>> {
  const mtimes = new Map<string, number>();
  await Promise.all(
    wikiFiles.filter((file) => file.startsWith('wiki/') && file.endsWith('.md')).map(async (file) => {
      try {
        const info = await stat(resolveInside(rootDir, file));
        mtimes.set(file, info.mtimeMs);
      } catch {
        // Vanished between the glob and the stat: nothing to announce.
      }
    }),
  );
  return mtimes;
}

/** Wiki files the last ingest run touched, keyed to the mtime the browser reads. */
export function recentIngestChanges(
  mtimes: Map<string, number>,
  ingestStart: number | null,
): Map<string, number> {
  const changed = new Map<string, number>();
  if (ingestStart === null) return changed;
  for (const [file, mtimeMs] of mtimes) {
    if (mtimeMs >= ingestStart) changed.set(file, mtimeMs);
  }
  return changed;
}

/**
 * Which folders hold a page the last ingest touched.
 *
 * Derived once per `changed` map and memoized against it: `renderNavNode`
 * asked the question once per folder node and answered it by materializing and
 * scanning the whole key list every time — O(folders x changed files) array
 * allocations per render.
 */
const changedFolderCache = new WeakMap<Map<string, number>, Set<string>>();
export function foldersWithChanges(changed: Map<string, number>): Set<string> {
  const cached = changedFolderCache.get(changed);
  if (cached) return cached;
  const folders = new Set<string>();
  for (const file of changed.keys()) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join('/'));
  }
  changedFolderCache.set(changed, folders);
  return folders;
}

/**
 * The sidebar label of a wiki page, cached against the file's mtime.
 *
 * Reading the head of every wiki page on every render was affordable while the
 * concept branch only covered taxo leaves (normally none); widened to every
 * concept leaf it became one open+read per leaf, per render, on a 4 s poll.
 * The mtime is already known from `wikiFileMtimes`, so it doubles as the
 * invalidation token: an edited page re-reads, an untouched one does not.
 */
const wikiTitleCache = new Map<string, { mtimeMs: number; title: string | null }>();
// A deleted page leaves its entry behind, and nothing else prunes it. Dropping
// the whole cache past a ceiling costs one render's worth of reads and keeps
// this from growing with every page the workspace ever held.
const WIKI_TITLE_CACHE_MAX = 20_000;
export async function wikiPageTitle(
  rootDir: string,
  file: string,
  mtimeMs: number | undefined,
  read: (rootDir: string, file: string) => Promise<string | null>,
): Promise<string | null> {
  // No mtime means the stat failed (the file vanished mid-render): read
  // without caching rather than pinning an entry that nothing can invalidate.
  if (mtimeMs === undefined) return read(rootDir, file);
  const key = `${rootDir}\u0000${file}`;
  const cached = wikiTitleCache.get(key);
  if (cached && cached.mtimeMs === mtimeMs) return cached.title;
  const title = await read(rootDir, file);
  if (wikiTitleCache.size >= WIKI_TITLE_CACHE_MAX) wikiTitleCache.clear();
  wikiTitleCache.set(key, { mtimeMs, title });
  return title;
}

/** Whether a wiki path is a concept leaf (`wiki/concepts/<concept>/<subject>.md`). */
export function isConceptLeafPath(relativePath: string): boolean {
  const parts = toPosix(relativePath).split('/');
  return parts.length === 4 && parts[1] === 'concepts';
}

/** The concept folder a leaf lives in, for the subject fallback. */
export function conceptFolderOf(relativePath: string): string {
  return toPosix(relativePath).split('/')[2] ?? '';
}

/** The basename a concept leaf falls back to when it declares no `subject`. */
export function conceptBasenameSubject(relativePath: string, concept: string): string {
  const base = path.basename(relativePath, '.md');
  return concept && base.startsWith(`${concept}_`) ? base.slice(concept.length + 1) : base;
}
