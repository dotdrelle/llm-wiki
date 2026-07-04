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
