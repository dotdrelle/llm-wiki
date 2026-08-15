import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeWriteFile, withFileLock } from '../../../utils/fs.ts';
import { canonicalJson, contentHash } from './canonical.ts';

/*
 Taxonomy registry: immutable generations, pointer-marker.

 A single `communities.json` rewritten before the marker does not hold the
 promise "the previous registry stays active": if the producer dies between
 the write and the publication, the previous content is already lost and nothing
 rebuilds it on restart. Each validated content is therefore written into an
 immutable generation addressed by its fingerprint, and the marker `rename` is
 the ONLY point of publication.

 That is the objects/references pattern: a generation that nobody references
 is inert, two concurrent producers write two files that never
 meet, and the write can therefore happen outside the lock. The lock
 now only protects a compare-and-swap on the pointer.
*/

/** Critical section reduced to a `rename`: going beyond that means being dead. */
export const REVISION_LOCK_TTL_MS = 45_000;
/** Capped plateau: a LONG and REGULAR wait budget (~60 s total). */
export const REVISION_LOCK_ATTEMPTS = 240;
export const REVISION_LOCK_MAX_BACKOFF_MS = 250;
/** The current one, plus three published: readers' grace window. */
export const GENERATION_RETENTION = 4;
/**
 * An orphan can belong to a producer still waiting for the lock.
 * The threshold therefore exceeds the acquisition budget, with a margin.
 */
export const ORPHAN_MIN_AGE_MS = 120_000;

export type TaxonomyMarker = {
  /** Monotonic counter per workspace. Never goes backwards. */
  revision: number;
  /** Fingerprint of the corpus on which the generation was computed. */
  corpus: string;
  /**
   * Algorithm that produced `corpus`.
   *
   * Absent on historical markers, which carried the broad fingerprint of the
   * complete graph. Two fingerprints from different algorithms do not
   * compare: `isComparableCorpus` answers "no" rather than letting a string
   * equality decide at random, and the caller treats that as an absence
   * of information — never as a corpus staleness.
   */
  corpusAlgorithm?: string;
  /** File name of the active generation, or null for a pure deterministic revision. */
  registryRef: string | null;
  /** Fingerprint of this generation's content. */
  registryHash: string | null;
  /** Previous published generations kept for in-flight readers. */
  retainedRegistryRefs?: string[];
  /** Publication timestamp, informational. */
  publishedAt: number;
};

export type DirtyFlag = {
  /**
   * `deterministic` — Serve knows how to recompute this work from the files and
   * resumes it alone. `pendingSynthesis` — the proposal lived in the
   * producer's memory and disappeared with it; Serve never calls the model back, it
   * signals and lets the orchestrated capability resume.
   */
  kind: 'deterministic' | 'pendingSynthesis';
  corpus: string;
  baseRevision: number;
  at: number;
};

export type TaxonomyPaths = {
  dir: string;
  marker: string;
  lock: string;
  dirty: string;
};

export function taxonomyPaths(rootDir: string): TaxonomyPaths {
  const dir = path.join(rootDir, '.wiki', 'graph');
  return {
    dir,
    marker: path.join(dir, 'revision.json'),
    lock: path.join(dir, 'revision.lock'),
    dirty: path.join(dir, 'dirty.json'),
  };
}

const GENERATION_PREFIX = 'communities.';
const GENERATION_SUFFIX = '.json';

export function generationName(hash: string): string {
  return `${GENERATION_PREFIX}${hash}${GENERATION_SUFFIX}`;
}

function generationHash(name: string): string | null {
  if (!name.startsWith(GENERATION_PREFIX) || !name.endsWith(GENERATION_SUFFIX)) return null;
  const hash = name.slice(GENERATION_PREFIX.length, -GENERATION_SUFFIX.length);
  return /^[0-9a-f]{32}$/.test(hash) ? hash : null;
}

/**
 * Writes a generation — **outside the lock**.
 *
 * Safe because immutable: the name derives from the content, so two distinct
 * producers write two distinct files, and rewriting the same generation
 * rewrites the same bytes. As long as no marker references it, it
 * exists for nobody.
 */
export async function writeGeneration(
  rootDir: string,
  registry: unknown,
): Promise<{ ref: string; hash: string; canonical: string }> {
  const canonical = canonicalJson(registry);
  const hash = contentHash(canonical);
  const ref = generationName(hash);
  await safeWriteFile(path.join(taxonomyPaths(rootDir).dir, ref), canonical);
  return { ref, hash, canonical };
}

/**
 * Are two corpus fingerprints comparable?
 *
 * A historical marker carries the broad fingerprint of the complete graph, with no
 * algorithm name. Comparing it to the knowledge fingerprint would give a
 * systematic inequality — true by accident, and interpreted as "the corpus
 * has changed" while nobody wrote anything. The right answer is "I don't
 * know", and that is what this predicate lets us say.
 */
export function isComparableCorpus(marker: TaxonomyMarker | null, algorithm: string): boolean {
  return Boolean(marker) && marker!.corpusAlgorithm === algorithm;
}

export async function readMarker(rootDir: string): Promise<TaxonomyMarker | null> {
  try {
    const raw = await readFile(taxonomyPaths(rootDir).marker, 'utf8');
    const marker = JSON.parse(raw) as TaxonomyMarker;
    return typeof marker?.revision === 'number' ? marker : null;
  } catch {
    // Absent on first startup, truncated if a disk gave out: in both
    // cases the reader falls back on the deterministic projection, never on an
    // error.
    return null;
  }
}

/**
 * Coherent read: **registry first, marker afterwards**.
 *
 * A single re-read suffices. The registry is published by `rename`, so never
 * observable half-way; the risk is not tearing but freshness —
 * reading revision N's generation and discovering the world is at N+1. The
 * revision being monotonic, there is no ABA, and comparing the marker AFTER
 * the fact detects every case.
 */
export async function readActiveRegistry(
  rootDir: string,
  attempts = 3,
): Promise<{ marker: TaxonomyMarker; registry: unknown } | null> {
  const paths = taxonomyPaths(rootDir);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const marker = await readMarker(rootDir);
    if (!marker) return null;
    if (!marker.registryRef || !marker.registryHash) return { marker, registry: null };

    let canonical: string;
    try {
      canonical = await readFile(path.join(paths.dir, marker.registryRef), 'utf8');
    } catch {
      continue;
    }
    if (contentHash(canonical) !== marker.registryHash) continue;

    const after = await readMarker(rootDir);
    if (after?.revision !== marker.revision) continue;
    return { marker, registry: JSON.parse(canonical) };
  }
  return null;
}

export type PublishOutcome =
  | { status: 'published'; marker: TaxonomyMarker }
  | { status: 'stale'; marker: TaxonomyMarker | null }
  | { status: 'unavailable'; error: unknown };

/**
 * Publishes an already-written generation: the pointer compare-and-swap.
 *
 * `expectedCorpus` is the fingerprint on which the proposal was computed.
 * Re-read under lock, if it moved, the proposal is abandoned: it
 * describes a corpus that no longer exists, and overwriting it would publish a
 * taxonomy over a more recent ingestion.
 */
export async function publishGeneration(
  rootDir: string,
  input: {
    corpus: string;
    registryRef: string | null;
    registryHash: string | null;
    expectedCorpus?: string;
    /** Algorithm of `corpus`. Absent ⇒ historical marker, not comparable. */
    corpusAlgorithm?: string;
  },
  // The defaults are the product's; a caller with a different constraint — a
  // one-shot CLI, a test — tightens the budget without redefining the policy.
  lock: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<PublishOutcome> {
  const paths = taxonomyPaths(rootDir);
  try {
    const outcome = await withFileLock(
      paths.lock,
      async (): Promise<PublishOutcome> => {
        const current = await readMarker(rootDir);
        /*
         The expectation is only checked between comparable fingerprints.

         A historical marker carries the broad fingerprint of the complete graph.
         Confronting it with a knowledge fingerprint would give a permanent
         inequality: the very first publication after migration would be
         rejected as "stale", and the next one too, indefinitely. The
         compare-and-swap only means anything between two values produced by the same
         algorithm; otherwise there is nothing to compare, and the publication passes.
        */
        const comparable = !current
          || current.corpusAlgorithm === input.corpusAlgorithm;
        if (
          input.expectedCorpus !== undefined &&
          current &&
          comparable &&
          current.corpus !== input.expectedCorpus
        ) {
          return { status: 'stale', marker: current };
        }
        const marker: TaxonomyMarker = {
          revision: (current?.revision ?? 0) + 1,
          corpus: input.corpus,
          ...(input.corpusAlgorithm ? { corpusAlgorithm: input.corpusAlgorithm } : {}),
          registryRef: input.registryRef,
          registryHash: input.registryHash,
          retainedRegistryRefs: [
            ...(current?.registryRef && current.registryRef !== input.registryRef
              ? [current.registryRef]
              : []),
            ...(current?.retainedRegistryRefs ?? []),
          ]
            .filter((ref, index, refs) => ref !== input.registryRef && refs.indexOf(ref) === index)
            .slice(0, GENERATION_RETENTION - 1),
          publishedAt: Date.now(),
        };
        await safeWriteFile(paths.marker, canonicalJson(marker));
        return { status: 'published', marker };
      },
      {
        ttlMs: lock.ttlMs ?? REVISION_LOCK_TTL_MS,
        attempts: lock.attempts ?? REVISION_LOCK_ATTEMPTS,
        maxBackoffMs: lock.maxBackoffMs ?? REVISION_LOCK_MAX_BACKOFF_MS,
      },
    );
    if (outcome.status === 'published') {
      // The collection is best-effort and outside the lock: a cleanup failure
      // must never turn an already-published commit into an apparent failure.
      try {
        await collectGenerations(rootDir);
      } catch {
        // The next commit or Serve startup will retry.
      }
    }
    return outcome;
  } catch (error) {
    /*
     Invariant: the failure to allocate a revision NEVER makes the
     ingestion fail. `withFileLock` propagates its exception; letting it bubble
     up would kill a production job for a display problem. The graph has the
     right to be late, the corpus does not have the right to be lost.
    */
    return { status: 'unavailable', error };
  }
}

export async function writeDirtyFlag(rootDir: string, flag: DirtyFlag): Promise<void> {
  await safeWriteFile(taxonomyPaths(rootDir).dirty, canonicalJson(flag));
}

export async function readDirtyFlag(rootDir: string): Promise<DirtyFlag | null> {
  try {
    const raw = await readFile(taxonomyPaths(rootDir).dirty, 'utf8');
    const flag = JSON.parse(raw) as DirtyFlag;
    return flag?.kind === 'deterministic' || flag?.kind === 'pendingSynthesis' ? flag : null;
  } catch {
    return null;
  }
}

export async function clearDirtyFlag(rootDir: string): Promise<void> {
  await rm(taxonomyPaths(rootDir).dirty, { force: true });
}

/**
 * Collects the generations that have become useless.
 *
 * Three rules, and the third is the trap: a generation written 200 ms ago
 * can belong to a producer still waiting for the lock.
 * Deleting it would break its publication, even though it looks orphan.
 */
export async function collectGenerations(
  rootDir: string,
  options: { retention?: number; minAgeMs?: number; now?: number } = {},
): Promise<string[]> {
  const retention = options.retention ?? GENERATION_RETENTION;
  const minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const now = options.now ?? Date.now();
  const paths = taxonomyPaths(rootDir);

  const marker = await readMarker(rootDir);
  let names: string[];
  try {
    names = await readdir(paths.dir);
  } catch {
    return [];
  }

  const generations: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!generationHash(name)) continue;
    try {
      const info = await stat(path.join(paths.dir, name));
      generations.push({ name, mtimeMs: info.mtimeMs });
    } catch {
      // Gone between readdir and stat: nothing to collect.
    }
  }

  const retained = new Set([
    ...(marker?.registryRef ? [marker.registryRef] : []),
    ...(marker?.retainedRegistryRefs ?? []).slice(0, Math.max(0, retention - 1)),
  ]);
  const removed: string[] = [];
  for (const generation of generations) {
    // Only the marker history proves that a generation was published.
    // The mtime does not distinguish an old publication from an orphan
    // proposal written by a producer that never acquired the lock.
    if (retained.has(generation.name)) continue;
    if (now - generation.mtimeMs < minAgeMs) continue;
    await rm(path.join(paths.dir, generation.name), { force: true });
    removed.push(generation.name);
  }
  return removed;
}
