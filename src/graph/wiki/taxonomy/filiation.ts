import type { RegistryCommunity, TaxonomyRegistry } from './schema.ts';

/*
 Explicit filiation and mass-deprecation guardrail (plan Lot 3, 6.3).

 Ordinary Jaccard re-anchoring is made for an UNplanned evolution:
 pages that move a little, a community that survives a minor
 reshuffle. A deliberate granularity reorganization — merge, split,
 comparative regrouping — often moves more than half of the members and
 makes an existing community pass for a disappearance. Deciding a
 merge on member overlap alone would then erase, in a single revision, a
 map the user recognized, without leaving anything to rebuild it from.

 This module does not reinvent `anchorCommunities`: it reports what the
 registry is going to do (who is absorbed, renamed, deprecated, and towards what), then it
 bounds the UNFILED DISAPPEARANCE. A community that disappears pointing at a
 replacement swallows its fraction of the map without loss; a community that
 vanishes without a successor is a hole. Beyond an explicit threshold of holes,
 the publication is refused, whatever the recognition thresholds.

 No business rule enters here: everything is an operation on counts and
 identifiers.
*/

/** A community's filiation is the operation this revision makes it undergo. */
export type LineageOp = 'unchanged' | 'rename' | 'merge' | 'split' | 'move' | 'created';

export type LineageEntry =
  | { id: string; op: LineageOp }
  | { id: string; op: 'merge'; into: string }
  | { id: string; op: 'split'; branches: string[] }
  | { id: string; op: 'move'; into: string };

export type LineageReport = {
  /** Operation applied to each community of the previous one this revision. */
  entries: LineageEntry[];
  /** Previous communities left with no filiated descendant: real disappearances. */
  trulyLost: string[];
};

/**
 * Guardrail command: maximum rate of active communities of the previous one that
 * can be deprecated WITHOUT a successor in a revision.
 *
 * A value of 0.3 says: a revision can make at most ~3 active communities out of
 * 10 disappear from the map in unfiled holes; beyond that, it is a
 * reorganization that only an explicit filiation plan can explain, and
 * nothing provided it.
 */
export const MAX_UNFILED_DEPRECATION_RATE = 0.3;

/**
 * Guardrail against unexplained mass deprecation.
 *
 * Counts, among the ACTIVE communities of the previous registry (never
 * deprecated), those that this revision deprecates without a resolvable `replacedBy` —
 * that is, a map hole, not an absorption. If the proportion exceeds
 * the threshold, the publication is refused.
 *
 * `force` must NEVER bypass this guardrail: it is not a recognition
 * threshold that tolerates being relaxed, it is the promise that every
 * map disappearance stays traceable. A `force` that still wants to
 * deprecate en masse must first provide a filiation — here,
 * `replacedBy` — and not break the door down.
 */
export function guardAgainstMassDisruption(
  previous: TaxonomyRegistry | null,
  current: RegistryCommunity[],
  options: { maxUnfiledRate?: number } = {},
): { ok: true } | { ok: false; issues: string[] } {
  if (!previous) return { ok: true };
  const maxRate = options.maxUnfiledRate ?? MAX_UNFILED_DEPRECATION_RATE;

  const activeBefore = previous.communities.filter((c) => !c.deprecated);
  if (activeBefore.length === 0) return { ok: true };

  const currentById = new Map(current.map((c) => [c.id, c]));
  // Resolve a deprecation chain: which LIVE community does this
  // entry end up pointing at?
  const endsAtLive = (id: string): string | null => {
    const seen = new Set<string>();
    let cursor: string | null = id;
    let hops = 0;
    while (cursor && !seen.has(cursor) && hops < 16) {
      seen.add(cursor);
      const entry = currentById.get(cursor);
      if (!entry) return null;
      if (entry.deprecated) {
        cursor = entry.replacedBy ?? null;
        hops += 1;
        continue;
      }
      return cursor;
    }
    return null;
  };

  // A "hole": an active community from before that either is not in
  // the revision at all, or is deprecated without a live replacement.
  const unfiled: string[] = [];
  for (const before of activeBefore) {
    const id = before.id;
    const target = endsAtLive(id);
    if (target === null) unfiled.push(id);
  }

  const rate = unfiled.length / activeBefore.length;
  if (rate <= maxRate) return { ok: true };

  const issues = [
    `unfiled deprecation ${Math.round(rate * 100)}% beyond the ceiling ${Math.round(maxRate * 100)}%`,
    `active communities disappeared without a successor: ${unfiled.join(', ')}`,
    'provide an explicit filiation (replacedBy / changeNote) before publishing; force does not bypass this guardrail',
  ];
  return { ok: false, issues };
}

/**
 * Reports the filiation of each previous community towards this revision.
 *
 * Useful for before/after reports (§6.3) and for deciding a `split`:
 * two new communities that would only share one common ancestor
 * split apart, and a recovered ancestor under its own identity
 * is "renamed" rather than "replaced".
 */
export function lineageReport(
  previous: TaxonomyRegistry | null,
  current: RegistryCommunity[],
): LineageReport {
  if (!previous) {
    return { entries: [], trulyLost: [] };
  }
  const currentById = new Map(current.map((c) => [c.id, c]));
  const entries: LineageEntry[] = [];
  const trulyLost: string[] = [];

  for (const before of previous.communities) {
    const id = before.id;
    if (before.deprecated) {
      // Already a hole from an earlier revision: we follow it, we do not re-break it.
      entries.push({ id, op: 'unchanged' });
      continue;
    }
    const now = currentById.get(id);
    if (!now || now.deprecated) {
      // Gone or deprecated: the filiation depends on the successor.
      const target = !now ? undefined : (now.replacedBy ?? undefined);
      if (target && currentById.get(target) && !currentById.get(target)!.deprecated) {
        entries.push({ id, op: 'merge', into: target });
      } else {
        trulyLost.push(id);
        entries.push({ id, op: 'move', into: target ?? '' });
      }
      continue;
    }
    // The same identity survives: rename? The label changed.
    const beforeLabel = before.prefLabel;
    const nowLabel = now.prefLabel;
    const sameLabel = Object.keys(beforeLabel).every(
      (lang) => nowLabel[lang] && nowLabel[lang] === beforeLabel[lang],
    );
    if (!sameLabel) entries.push({ id, op: 'rename' });
    else entries.push({ id, op: 'unchanged' });
  }

  return { entries, trulyLost };
}
/**
 * STABLE and deterministic rule for picking the survivor of a merge (§6.3).
 *
 * "The survivor that carries the most telling name" has no place here: a map
 * identity is recognised by its continuity, not by a draft label. The rule is
 * purely mechanical and reproducible on every call over the same registry.
 *
 * The OLDEST community survives (`firstSeenRevision` minimal) — the one readers
 * have recognised for the longest time; at equal age the smallest id breaks the
 * tie lexicographically. Neither the label, nor the page count, nor the list
 * position count.
 */
export function pickSurvivor(candidates: RegistryCommunity[]): string | null {
  if (candidates.length === 0) return null;
  // A non-empty `candidates` guarantees at least one iteration assigns survivor,
  // so the non-null assertion below is safe.
  let survivor: RegistryCommunity = candidates[0]!;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const candidateAge = candidate.firstSeenRevision;
    const survivorAge = survivor.firstSeenRevision;
    if (
      candidateAge < survivorAge ||
      (candidateAge === survivorAge && candidate.id < survivor.id)
    ) {
      survivor = candidate;
    }
  }
  return survivor.id;
}

/**
 * Writes the deprecated stub of a community absorbed by a merge (§6.3).
 *
 * An absorbed identity is never deleted: it stays in the registry, becomes
 * `deprecated: true` and redirects `replacedBy` toward the survivor, and the
 * survivor records it in `replaces` — that is what lets `resolveCommunity` and
 * the before/after reports read the redirection back. Never mutates `current`;
 * returns a new list.
 *
 * Refuses redirections that would erase an identity: a missing target, one
 * already deprecated, or the community itself produce no stub.
 */
export function deprecateInto(
  current: RegistryCommunity[],
  args: { id: string; replacedBy: string; revision: number },
): RegistryCommunity[] {
  if (args.replacedBy === args.id) return current;
  const survivor = current.find((c) => c.id === args.replacedBy);
  if (!survivor || survivor.deprecated) return current;

  return current.map((community) => {
    if (community.id === args.id && !community.deprecated) {
      return {
        ...community,
        deprecated: true,
        replacedBy: args.replacedBy,
        changeNote: [
          ...(community.changeNote ?? []),
          { revision: args.revision, kind: 'deprecated', from: [args.replacedBy] },
        ],
      };
    }
    if (community.id === args.replacedBy) {
      const already = (community.replaces ?? []).includes(args.id);
      if (already) return community;
      return {
        ...community,
        replaces: [...(community.replaces ?? []), args.id],
      };
    }
    return community;
  });
}

export type LineageSummary = {
  /** Identities kept as they were. */
  unchanged: string[];
  /** Identities kept under a different label. */
  renamed: string[];
  /** Absorbed toward a survivor. */
  merged: Array<{ id: string; into: string }>;
  /** A shared ancestor split between new branches. */
  split: Array<{ from: string; branches: string[] }>;
  /** Moved toward a target (strictly filiated deprecation). */
  moved: Array<{ id: string; into: string }>;
  /** Deprecated stubs of this revision, with their eventual successor. */
  deprecated: Array<{ id: string; into: string | null }>;
  /** Live communities born in this revision, excluding splits. */
  created: string[];
  /** Gone with no filiated successor: gaps in the map. */
  trulyLost: string[];
};

/**
 * Before/after report of the revision, by category (§6.3).
 *
 * It derives merges and splits from the MOVEMENT OF PAGES, never from a named
 * inventory: pages carry continuity, and both registries (the previous and
 * current `assignments`) suffice to trace where each page landed. A vanished
 * community whose pages all migrate to a single survivor is a merge; spread
 * across several survivors, a split. A page that changes leaf while its origin
 * community survives is a move.
 *
 * Requires the COMPLETE current registry (`assignments` included) to trace the
 * movement — unlike `lineageReport`, which only compares communities.
 */
export function summarizeLineage(
  previous: TaxonomyRegistry | null,
  current: TaxonomyRegistry,
): LineageSummary {
  const communities = current.communities;
  if (!previous) {
    return {
      unchanged: [],
      renamed: [],
      merged: [],
      split: [],
      moved: [],
      deprecated: [],
      created: communities.filter((c) => !c.deprecated).map((c) => c.id),
      trulyLost: [],
    };
  }

  const currentById = new Map(communities.map((c) => [c.id, c]));

  // Page -> live community of the current registry, following the deprecations
  // of the DESTINATION (as a reader of the map would).
  const endsAtLive = (id: string): string | null => {
    let cursor: string | null = id;
    const seen = new Set<string>();
    for (let hops = 0; cursor && !seen.has(cursor) && hops < 16; hops += 1) {
      seen.add(cursor);
      const entry = currentById.get(cursor);
      if (!entry) return null;
      if (entry.deprecated) {
        cursor = entry.replacedBy ?? null;
        continue;
      }
      return entry.id;
    }
    return null;
  };
  // For each page: its origin community (in `previous`) and where it lands (in
  // `current`, resolved to a live leaf).
  const pageFrom = new Map<string, string>();
  const pagesTo = new Map<string, string[]>();
  for (const [page, assignment] of Object.entries(previous.assignments)) {
    pageFrom.set(page, assignment.primaryCommunity);
  }
  for (const [page, assignment] of Object.entries(current.assignments)) {
    const from = pageFrom.get(page);
    if (!from) continue;
    const to = endsAtLive(assignment.primaryCommunity);
    if (!to) continue;
    const list = pagesTo.get(to) ?? [];
    list.push(page);
    pagesTo.set(to, list);
  }

  const unchanged: string[] = [];
  const renamed: string[] = [];
  const merged: Array<{ id: string; into: string }> = [];
  const moved: Array<{ id: string; into: string }> = [];
  const deprecated: Array<{ id: string; into: string | null }> = [];
  const trulyLost: string[] = [];
  const splitByFrom = new Map<string, string[]>();

  for (const before of previous.communities) {
    if (before.deprecated) continue;
    const id = before.id;
    const now = currentById.get(id);

    if (now && !now.deprecated) {
      const beforeLabel = before.prefLabel;
      const nowLabel = now.prefLabel;
      const same = Object.keys(beforeLabel).every(
        (lang) => nowLabel[lang] && nowLabel[lang] === beforeLabel[lang],
      );
      if (same) unchanged.push(id);
      else renamed.push(id);
      continue;
    }

    // Vanished (or deprecated) community: where did its pages go?
    const descendants = new Set<string>();
    for (const [to, pages] of pagesTo) {
      for (const page of pages) {
        if (pageFrom.get(page) === id) descendants.add(to);
      }
    }
    const named = [...descendants].filter((target) => target !== id);

    if (now?.deprecated && named.length === 0) {
      // Explicitly deprecated toward a survivor with no observed page
      // migration: follow the declared redirection itself.
      const declared = endsAtLive(now.replacedBy ?? '');
      if (declared) merged.push({ id, into: declared });
      else {
        deprecated.push({ id, into: now.replacedBy ?? null });
        if (!now.replacedBy) trulyLost.push(id);
      }
      continue;
    }

    if (named.length === 1) {
      merged.push({ id, into: named[0]! });
      continue;
    }
    if (named.length >= 2) {
      // Split: several leaves take over the pages of a single source.
      for (const branch of named) {
        splitByFrom.set(id, [...(splitByFrom.get(id) ?? []), branch]);
      }
      continue;
    }

    // No observable migrated page: a real disappearance or a move without
    // continuation. Without an explicit successor it is a gap.
    deprecated.push({ id, into: now?.replacedBy ?? null });
    if (!now?.replacedBy) trulyLost.push(id);
  }

  const split: Array<{ from: string; branches: string[] }> = [];
  for (const [from, branches] of splitByFrom) {
    if (branches.length >= 2)
      split.push({ from, branches: [...new Set(branches)].sort() });
  }
  const splitIds = new Set(split.flatMap((entry) => entry.branches));

  const builtBefore = new Set(
    previous.communities.filter((c) => !c.deprecated).map((c) => c.id),
  );
  const created = communities
    .filter((c) => !c.deprecated && !builtBefore.has(c.id) && !splitIds.has(c.id))
    .map((c) => c.id);

  trulyLost.sort();
  return {
    unchanged: unchanged.sort(),
    renamed: renamed.sort(),
    merged: merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    split,
    moved: moved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    deprecated: deprecated.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    created: created.sort(),
    trulyLost,
  };
}
