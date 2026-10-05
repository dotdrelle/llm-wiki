/** Read the supported string/object forms of a declared source inventory. */
export function declaredSourcePaths(data: Record<string, unknown>): string[] {
  const raw = data.sources;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string') {
        return (entry as { path: string }).path;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\\/g, '/'));
}
