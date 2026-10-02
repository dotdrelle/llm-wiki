export type TagFamily = { family: string; tags: string[] };

function parseArray(raw: string): unknown[] | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function key(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').trim().toLocaleLowerCase();
}

/** Parse a bounded list of proposed family labels for a large-corpus first pass. */
export function parseTagFamilyLabels(raw: string, min: number, max: number): string[] | null {
  const labels = (parseArray(raw) ?? [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique = labels.filter((label) => {
    const normalized = key(label);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return unique.length >= min && unique.length <= max ? unique : null;
}

/** Keep only assignments to the family catalogue and restore its canonical spelling. */
export function restrictTagFamilies(proposed: TagFamily[], allowedFamilies: string[]): TagFamily[] {
  const allowed = new Map(allowedFamilies.map((family) => [key(family), family]));
  const merged = new Map<string, TagFamily>();
  for (const group of proposed) {
    const family = allowed.get(key(group.family));
    if (!family) continue;
    const normalized = key(family);
    const current = merged.get(normalized) ?? { family, tags: [] };
    current.tags.push(...group.tags);
    merged.set(normalized, current);
  }
  return [...merged.values()];
}

/**
 * Parse a model grouping tolerantly: every well-formed assignment is kept,
 * unknown and repeated tags are ignored, and missing tags simply stay out of
 * the result. A single omitted tag must not discard an otherwise usable
 * grouping. Returns null only when no tag at all could be assigned.
 */
export function parseTagFamilies(raw: string, expectedTags: string[]): TagFamily[] | null {
  const expected = new Map(expectedTags.map((tag) => [key(tag), tag]));
  const assigned = new Set<string>();
  const groups: TagFamily[] = [];
  for (const item of parseArray(raw) ?? []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { family?: unknown; tags?: unknown };
    if (typeof row.family !== 'string' || !row.family.trim() || !Array.isArray(row.tags)) continue;
    const tags: string[] = [];
    for (const value of row.tags) {
      if (typeof value !== 'string') continue;
      const normalized = key(value);
      const canonical = expected.get(normalized);
      if (!canonical || assigned.has(normalized)) continue;
      assigned.add(normalized);
      tags.push(canonical);
    }
    if (tags.length > 0) groups.push({ family: row.family.trim(), tags });
  }
  return assigned.size > 0 ? groups : null;
}

/** Tags the model response did not assign to any family. */
export function missingTagAssignments(groups: TagFamily[], expectedTags: string[]): string[] {
  const assigned = new Set(groups.flatMap((group) => group.tags.map((tag) => key(tag))));
  return expectedTags.filter((tag) => !assigned.has(key(tag)));
}

/** Keep established family labels, while accepting new families when needed. */
export function anchorTagFamilies(
  proposed: TagFamily[],
  established: TagFamily[],
): TagFamily[] {
  const establishedNames = new Map(established.map((row) => [key(row.family), row.family]));
  const merged = new Map<string, TagFamily>(
    established.map((row) => [key(row.family), { family: row.family, tags: [...row.tags] }]),
  );
  for (const group of proposed) {
    const canonical = establishedNames.get(key(group.family)) ?? group.family;
    const familyKey = key(canonical);
    const current = merged.get(familyKey) ?? { family: canonical, tags: [] };
    for (const tag of group.tags) {
      if (!current.tags.some((item) => key(item) === key(tag))) current.tags.push(tag);
    }
    merged.set(familyKey, current);
  }
  return [...merged.values()];
}

export function tagFamilyMap(groups: TagFamily[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const group of groups) {
    for (const tag of group.tags) result.set(key(tag), group.family);
  }
  return result;
}
