import { normalizeProvenanceValue, normalizeTags } from './provenance.ts';

export type TagCatalogue = Map<string, string>;

/** Accent-insensitive comparison key; display labels remain workspace-owned. */
export function normalizeTagKey(value: string): string {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function loadTagCatalogue(tagLists: Iterable<Iterable<string>>): TagCatalogue {
  const counts = new Map<string, Map<string, number>>();
  for (const tags of tagLists) {
    for (const tag of normalizeTags([...tags])) {
      const key = normalizeTagKey(tag);
      if (!key) continue;
      const labels = counts.get(key) ?? new Map<string, number>();
      labels.set(tag, (labels.get(tag) ?? 0) + 1);
      counts.set(key, labels);
    }
  }
  const catalogue: TagCatalogue = new Map();
  for (const [key, labels] of counts) {
    const best = [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) catalogue.set(key, best[0]);
  }
  return catalogue;
}

/** Map new model labels to the established spelling where the key agrees. */
export function harmonizeTags(values: Iterable<string>, catalogue: TagCatalogue): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of normalizeTags([...values])) {
    const canonical = catalogue.get(normalizeTagKey(value)) ?? normalizeProvenanceValue(value);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return result;
}
