export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number | undefined,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const effectiveLimit = Math.max(1, Math.floor(limit ?? 1));
  if (items.length === 0) return [];
  if (effectiveLimit <= 1 || items.length === 1) {
    const sequential: R[] = [];
    for (let index = 0; index < items.length; index += 1) {
      sequential.push(await mapper(items[index], index));
    }
    return sequential;
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(effectiveLimit, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export interface Semaphore {
  /** Runs `task` once a slot is free; the slot is released whatever happens. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * Bounded async gate. `mapWithConcurrency` bounds one list; a run that extracts
 * several sources in parallel needs ONE budget across all of them — this is
 * that budget.
 */
export function createSemaphore(limit: number): Semaphore {
  const effectiveLimit = Math.max(1, Math.floor(limit || 1));
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> => new Promise((resolve) => {
    if (active < effectiveLimit) {
      active += 1;
      resolve();
      return;
    }
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
  const release = (): void => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
