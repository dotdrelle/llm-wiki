import { KNOWLEDGE_ETAG_ALGORITHM, knowledgeEtag } from './knowledge.ts';
import { publishGeneration, readMarker, writeDirtyFlag } from './store.ts';

export type CorpusPublishOutcome =
  | { status: 'published'; revision: number; corpus: string }
  | { status: 'deferred'; corpus: string | null };

/**
 * Publishes a deterministic revision after a coherent wiki write.
 *
 * The fingerprint is that of the **knowledge corpus** (`knowledgeEtag`), the
 * same one synthesis computes and publishes on: two fingerprints
 * computed differently would make the staleness comparison under lock
 * worthless. It deliberately ignores templates, contexts and deliverables — a
 * build does not stale a classification.
 *
 * The active registry generation, if there is one, is carried over as
 * is: an ingestion knows nothing about the synthesized taxonomy and has
 * no reason to remove it. It just advances the revision, that is all.
 *
 * **Never throws.** An unallocated revision is a display problem; letting
 * it bubble up would kill a production job that has, itself, succeeded. On
 * failure, the `dirty.json` flag takes over and Serve will resume — that
 * work, it knows how to redo, since it recomputes from the files.
 */
export async function publishCorpusRevision(
  rootDir: string,
  lock: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<CorpusPublishOutcome> {
  let corpus: string | null = null;
  try {
    corpus = await knowledgeEtag(rootDir);
    const current = await readMarker(rootDir);

    // A revision describes an observable change. Republishing the same corpus
    // would make every client flicker and inflate the counter with no new
    // state, notably when an unchanged source goes through the pipeline.
    //
    // Equality only means anything between fingerprints of the same algorithm: a
    // historical marker must be republished to migrate, even if its string
    // looks like ours.
    if (current?.corpus === corpus && current.corpusAlgorithm === KNOWLEDGE_ETAG_ALGORITHM) {
      return { status: 'published', revision: current.revision, corpus };
    }

    const outcome = await publishGeneration(
      rootDir,
      {
        corpus,
        corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
        registryRef: current?.registryRef ?? null,
        registryHash: current?.registryHash ?? null,
      },
      lock,
    );

    if (outcome.status === 'published') {
      return { status: 'published', revision: outcome.marker.revision, corpus };
    }

    await writeDirtyFlag(rootDir, {
      kind: 'deterministic',
      corpus,
      baseRevision: current?.revision ?? 0,
      at: Date.now(),
    });
    return { status: 'deferred', corpus };
  } catch {
    // Including the flag write: if even that fails, the next
    // ingestion will republish. None of this reaches the caller.
    return { status: 'deferred', corpus };
  }
}
