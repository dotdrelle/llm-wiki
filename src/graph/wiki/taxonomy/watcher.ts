import { watch, type FSWatcher } from 'node:fs';
import { collectGenerations, readMarker, taxonomyPaths, type TaxonomyMarker } from './store.ts';
import { recoverPendingWork } from './recovery.ts';

/** Fallback when notifications do not cross the mount. */
export const TAXONOMY_POLL_INTERVAL_MS = 1_500;
/** Groups the close notifications of a single publication. */
export const TAXONOMY_DEBOUNCE_MS = 150;

export type TaxonomyWatcher = {
  /** Checks the state now, without waiting for the next wake-up. */
  check: () => Promise<void>;
  stop: () => void;
};

/**
 * Watches a workspace's revision marker.
 *
 * A single watcher and a single timer **per Serve workspace**, never one per
 * SSE client: clients subscribe to what this one publishes.
 *
 * `fs.watch`/inotify is not reliable across a Docker bind mount, which
 * is precisely the targeted deployment. We therefore try the native watcher and
 * degrade to a periodic `stat`. This polling is not the polling removed from the
 * client: it is a server-side inode read, without transfer and without effect
 * on the rendering — not to be confused with a scene re-fetch.
 *
 * We watch the DIRECTORY, not the file: the marker is published by
 * `rename`, so its inode is replaced at each revision and a watcher placed
 * on the file would follow the old inode until it sees nothing anymore.
 */
export function createTaxonomyWatcher(options: {
  rootDir: string;
  /** Called exactly once per genuinely new revision. */
  onRevision: (marker: TaxonomyMarker) => void;
  pollIntervalMs?: number;
  debounceMs?: number;
  /** Resumption of pending work; can be disabled for a passive reader. */
  recover?: boolean;
}): TaxonomyWatcher {
  const paths = taxonomyPaths(options.rootDir);
  const pollIntervalMs = options.pollIntervalMs ?? TAXONOMY_POLL_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? TAXONOMY_DEBOUNCE_MS;
  const recover = options.recover ?? true;

  let lastRevision = -1;
  let initialCollectionPending = true;
  let stopped = false;
  /*
   Checks are serialized by a queue, not by a flag.

   A "one at a time" flag that exits the caller without checking anything
   makes `check()` a liar: the promise resolves while no read took
   place, and a caller that just wrote — or a test — observes the
   previous state. The queue guarantees that waiting for `check()` means waiting for a
   check started AFTER the call.
  */
  let queue: Promise<void> = Promise.resolve();
  let watcher: FSWatcher | null = null;
  let debounce: NodeJS.Timeout | null = null;
  const interval = setInterval(() => void check(), pollIntervalMs);
  // A polling timer must not keep the process alive on its own.
  interval.unref?.();

  function check(): Promise<void> {
    queue = queue.then(runCheck, runCheck);
    return queue;
  }

  async function runCheck(): Promise<void> {
    if (stopped) return;
    try {
      if (initialCollectionPending) {
        initialCollectionPending = false;
        await collectGenerations(options.rootDir);
      }
      if (recover) await recoverPendingWork(options.rootDir);
      const marker = await readMarker(options.rootDir);
      if (!marker) return;
      /*
       The comparison is on the revision NUMBER, not on the `mtime`.

       An mtime moves at every rewrite, including identical ones, and its
       granularity varies by filesystem — two publications in
       the same second can share it. The monotonic counter, for its part, says
       exactly what we want to know: is there something new.
      */
      if (marker.revision <= lastRevision) return;
      lastRevision = marker.revision;
      options.onRevision(marker);
    } catch {
      // A failed read does not stop the watch: the next wake-up
      // will retry. A watcher that dies on a transient error would leave
      // the screen mute until Serve restarts.
    }
  }

  function schedule(): void {
    if (stopped || debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void check();
    }, debounceMs);
    debounce.unref?.();
  }

  function attach(): void {
    if (stopped) return;
    try {
      watcher = watch(paths.dir, (_event, name) => {
        // The directory also carries the generations, far more numerous than
        // the publications. Ignoring them avoids re-reading the marker at each
        // written proposal, published or not.
        if (name && name !== 'revision.json' && name !== 'dirty.json') return;
        schedule();
      });
      watcher.on('error', () => {
        // The mount does not propagate notifications: polling takes
        // over, alone. This is the planned degradation, not a failure.
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  attach();
  void check();

  return {
    check,
    stop() {
      stopped = true;
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      debounce = null;
      watcher?.close();
      watcher = null;
    },
  };
}
