import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { safeWriteFile } from '../../../utils/fs.ts';
import { toPosix } from '../../../utils/path.ts';
import { canonicalJson } from './canonical.ts';

/*
 Knowledge fingerprint — what the taxonomy is allowed to go stale on.

 `wikiGraphEtagForFiles` describes the graph RENDER: it covers templates,
 build contexts, deliverables and `build-state.json`, and it hashes `mtime` +
 size. That is correct for invalidating a display cache, and wrong for deciding
 that a classification is stale — a `build` that touches no knowledge
 page, a workspace copy or a `git clone` sufficed to declare
 the map obsolete. A warning that lights up for no reason is a
 warning one learns to ignore, and the actually-stale corpus then
 goes unnoticed.

 This fingerprint therefore only sees the knowledge pages, and only through
 their content.
*/

/**
 * Node types that make up the knowledge corpus.
 *
 * Single source of truth: the inventory, the projection and the fingerprint must
 * agree on what a knowledge page is. Two divergent lists
 * would allow a file to be classified without participating in the fingerprint — hence
 * a classification that never goes stale — or the reverse.
 *
 * The corpus is the EXTRACTED knowledge, not the raw inputs it came from.
 * `wiki/sources/**` (the source note) and `raw/ingested/**` (the archived
 * source) both restate the same document that produced a concept: submitting
 * all three to the synthesis hands the model three views of one subject and it
 * groups them as three identities. Classifying concepts alone removes the
 * redundancy at its root; a source's note remains discoverable in the graph,
 * it simply no longer drives the taxonomy.
 */
export const KNOWLEDGE_NODE_TYPES = new Set(['wiki']);

/**
 * Corresponding files, expressed once.
 *
 * The mirror of the type above: `wiki/**` minus the source notes gives `wiki`.
 * `wiki/log.md` is the technical journal — it is rewritten at every job and
 * carries no classifiable knowledge.
 */
export const KNOWLEDGE_FILE_PATTERNS = [
  'wiki/**/*.md',
  '!wiki/log.md',
  '!wiki/sources/**/*.md',
];

/**
 * Version of the fingerprint algorithm, carried by the marker.
 *
 * Two fingerprints computed by two different algorithms are not
 * comparable: declaring them different would be true but useless, declaring them
 * equal would be false. We therefore compare the algorithm first, and a divergence
 * is treated as an absence of information — not as a staleness.
 */
export const KNOWLEDGE_ETAG_ALGORITHM = 'knowledge-content-sha256-v1';

export async function listKnowledgeFiles(rootDir: string): Promise<string[]> {
  return (await fg(KNOWLEDGE_FILE_PATTERNS, { cwd: rootDir, dot: false }))
    .map(toPosix)
    .sort();
}

/**
 * Logical content of a page: what changes its meaning, nothing else.
 *
 * Line endings depend on the system that wrote the file and trailing
 * whitespace depends on the editor. Including them would make a taxonomy's
 * freshness depend on the workstation that made the last `git
 * checkout`, which is exactly the defect being fixed.
 */
export function knowledgeContentHash(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

type CacheEntry = { mtimeMs: number; ctimeMs: number; size: number; hash: string };
type CacheFile = { algorithm: string; entries: Record<string, CacheEntry> };

function cachePath(rootDir: string): string {
  return path.join(rootDir, '.wiki', 'graph', 'knowledge-hash-cache.json');
}

/**
 * Hash cache — an optimization, never a source of truth.
 *
 * Hashing the content of ~230 pages at every publication, multiplied by the
 * number of sources in a batch, is a real cost. `mtime`, `ctime` and size serve
 * here, and only here, to decide if the memorized hash is still valid: they
 * never enter the published fingerprint. That is the nuance that keeps the
 * two properties at once — a faithful copy keeps the same fingerprint, and a
 * repeated publication does not re-read the whole corpus.
 *
 * `ctime` is the guardrail that `mtime` alone was missing: a rewrite that
 * restores `mtime` (backup restore, tool that preserves the
 * timestamp) still updates `ctime`, so the hash is recomputed instead
 * of being wrongly reused. The `mtime`+`ctime`+size tuple only misses a
 * modification that would preserve all three, which no current filesystem
 * allows without out-of-band manipulation.
 *
 * Deleting this file therefore changes no result, only latency.
 */
async function readCache(rootDir: string): Promise<Map<string, CacheEntry>> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(rootDir), 'utf8')) as CacheFile;
    if (!parsed || parsed.algorithm !== KNOWLEDGE_ETAG_ALGORITHM) return new Map();
    return new Map(Object.entries(parsed.entries ?? {}));
  } catch {
    return new Map();
  }
}

async function writeCache(rootDir: string, entries: Map<string, CacheEntry>): Promise<void> {
  const payload: CacheFile = {
    algorithm: KNOWLEDGE_ETAG_ALGORITHM,
    entries: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  await safeWriteFile(cachePath(rootDir), canonicalJson(payload));
}

/**
 * Knowledge corpus fingerprint: canonical paths + content hash.
 *
 * Contains neither `mtime`, nor size, nor timestamp. Two workspaces whose
 * pages have the same content have the same fingerprint, whatever their
 * copy, build or export history.
 */
export async function knowledgeEtagForFiles(
  rootDir: string,
  files: string[],
  options: { cache?: boolean } = {},
): Promise<string> {
  const useCache = options.cache ?? true;
  const previous = useCache ? await readCache(rootDir) : new Map<string, CacheEntry>();
  const next = new Map<string, CacheEntry>();
  const hash = createHash('sha256');
  hash.update(KNOWLEDGE_ETAG_ALGORITHM);
  hash.update('\0');

  for (const file of files) {
    const absolute = path.join(rootDir, file);
    let entry: CacheEntry | undefined;
    try {
      const fileStat = await stat(absolute);
      const cached = previous.get(file);
      if (cached
        && cached.mtimeMs === fileStat.mtimeMs
        && cached.ctimeMs === fileStat.ctimeMs
        && cached.size === fileStat.size) {
        entry = cached;
      } else {
        entry = {
          mtimeMs: fileStat.mtimeMs,
          ctimeMs: fileStat.ctimeMs,
          size: fileStat.size,
          hash: knowledgeContentHash(await readFile(absolute, 'utf8')),
        };
      }
    } catch {
      // A file that disappeared between listing and reading is not a
      // publication error: it simply does not belong to this corpus.
      continue;
    }
    next.set(file, entry);
    hash.update(file);
    hash.update('\0');
    hash.update(entry.hash);
    hash.update('\0');
  }

  if (useCache) await writeCache(rootDir, next).catch(() => {});
  return hash.digest('hex');
}

/** Shortcut: list then fingerprint, the current call. */
export async function knowledgeEtag(
  rootDir: string,
  options: { cache?: boolean } = {},
): Promise<string> {
  return knowledgeEtagForFiles(rootDir, await listKnowledgeFiles(rootDir), options);
}
