import {
  clearDirtyFlag,
  publishGeneration,
  readDirtyFlag,
  readMarker,
  type PublishOutcome,
} from './store.ts';

export type RecoveryOutcome =
  | { status: 'idle' }
  | { status: 'recovered'; revision: number }
  | { status: 'signalled'; revision: number | null }
  /** The corpus changed since the failure: the pending work is no longer worth anything. */
  | { status: 'superseded'; revision: number | null }
  | { status: 'deferred' };

/**
 * Resumes the work left pending by a producer that could not publish.
 *
 * The flag does not have the same power depending on its origin, and confusing
 * them would promise an impossible resumption:
 *
 * - `deterministic` — the projection recomputes entirely from the
 *   corpus files. Serve therefore really knows how to resume: it publishes and
 *   clears the flag.
 * - `pendingSynthesis` — the validated proposal lived in the producer's memory
 *   and disappeared with it. Serve **never calls the model** (D2): it
 *   cannot reconstruct it. It publishes the deterministic state while keeping the
 *   registry generation of the previous commit, keeps the flag, and leaves the
 *   resumption to the next execution of the orchestrated capability.
 *
 * In both cases the previous registry stays active: never an orphan
 * generation, never a partial state.
 */
export async function recoverPendingWork(
  rootDir: string,
  lock: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<RecoveryOutcome> {
  const flag = await readDirtyFlag(rootDir);
  if (!flag) return { status: 'idle' };

  const current = await readMarker(rootDir);
  if (flag.kind === 'pendingSynthesis' && current?.corpus === flag.corpus) {
    // The signal must survive for the orchestrator, not create a new
    // revision at each watcher poll. The targeted deterministic state is already
    // published; only the synthesis that Serve does not know how to
    // redo remains.
    return { status: 'signalled', revision: current.revision };
  }

  /*
   A corpus fingerprint never goes backwards.

   The flag carries the fingerprint frozen at the moment of failure. Nothing prevents an
   ingestion from succeeding BETWEEN that failure and this resumption: the marker then
   describes a more recent corpus, and republishing `flag.corpus` would make it go
   backwards. The active registry would nonetheless remain today's — the
   marker would therefore lie about what it corresponds to, and every consumer that
   compares the fingerprints would see the corpus "change" in reverse.

   The revision is the only total order available: it is monotonic by
   construction. If it exceeded the flag's base AND the fingerprint differs,
   someone has published since, and this flag speaks of a bygone state.
  */
  const movedOn = Boolean(
    current && current.revision > flag.baseRevision && current.corpus !== flag.corpus,
  );
  if (movedOn) {
    if (flag.kind === 'deterministic') {
      // The requested projection was superseded by a more recent one: there is
      // nothing left to resume, and keeping the flag would make the watcher loop.
      await clearDirtyFlag(rootDir);
      return { status: 'superseded', revision: current?.revision ?? null };
    }
    /*
     The synthesis, for its part, remains owed: nobody has redone it for the new
     corpus either. The flag survives so the orchestrated capability
     resumes it — but without touching the marker, which is already up to date.
    */
    return { status: 'signalled', revision: current?.revision ?? null };
  }

  const outcome: PublishOutcome = await publishGeneration(
    rootDir,
    {
      corpus: flag.corpus,
      // The lost synthesis must not take the active taxonomy with it: we
      // republish the current pointer, not an empty pointer.
      registryRef: current?.registryRef ?? null,
      registryHash: current?.registryHash ?? null,
    },
    lock,
  );

  if (outcome.status !== 'published') {
    // Lock unavailable or stale base: we will retry. The flag stays,
    // that is precisely its role.
    return { status: 'deferred' };
  }

  if (flag.kind === 'deterministic') {
    await clearDirtyFlag(rootDir);
    return { status: 'recovered', revision: outcome.marker.revision };
  }

  /*
   `pendingSynthesis`: the revision advances — the screen sees the most recent
   deterministic state — but the flag SURVIVES. Clearing it would pretend
   that the synthesis was resumed, and nobody would know anymore that it is missing.
  */
  return { status: 'signalled', revision: outcome.marker.revision };
}
