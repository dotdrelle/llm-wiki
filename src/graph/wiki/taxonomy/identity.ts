import { randomBytes } from 'node:crypto';
import { normalizeLabel } from './schema.ts';
import type { RegistryCommunity, TaxonomyRegistry } from './schema.ts';

/*
 Identity of a community.

 §3.1 of the plan leaves reproducibility after reconstruction open. This
 module does not settle that product decision: the allocator below is the
 provisional mechanism of the current registry, not the contractual guarantee of lot
 7. A reproducible strategy must above all not derive naively from the
 mutable member list; it can however rely on a durable
 identity source or a registry backup.

 The real need is not "recompute the same identifier", it is "do not
 lose continuity if the registry is rebuilt". That is achieved through
 re-anchoring: a community is recognized by its members and given back its
 old identifier. This is more robust than determinism, because it
 also survives a change of naming algorithm.
*/

const ID_PREFIX = 'cmty_';

/**
 * Provisional opaque identifier, sortable by creation date.
 *
 * The first 8 bytes encode the timestamp: two identifiers therefore compare
 * in their order of appearance, which makes an `ls` or a registry diff
 * readable without a lookup table. The rest is random.
 */
export function newCommunityId(now = Date.now()): string {
  const time = now.toString(36).padStart(9, '0');
  return `${ID_PREFIX}${time}${randomBytes(6).toString('hex')}`;
}

export function isCommunityId(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ID_PREFIX) && value.length > ID_PREFIX.length + 8;
}

/**
 * Jaccard similarity between two member sets.
 *
 * A community that gains or loses a few pages remains the same community;
 * one that has changed by half is no longer one. The overlap says precisely
 * that, and it depends neither on the label — which may have been renamed — nor on
 * the order.
 */
export function memberOverlap(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Recognition threshold. Above it, it is the same community continuing;
 * below it, it is another one occupying the ground.
 */
export const REANCHOR_MIN_OVERLAP = 0.5;

export type CommunityDraft = { members: string[]; label: string };

export type AnchoredCommunity = {
  id: string;
  members: string[];
  label: string;
  /** True when the identifier comes from the previous registry. */
  reanchored: boolean;
};

/**
 * Gives back their identifier to the recognized communities, allocates one to the others.
 *
 * Without a previous registry — first synthesis, or lost registry — everything is
 * new and everything receives an identifier. With a previous registry, we pair
 * by member overlap, from most to least similar, each
 * old identifier only usable once: two communities born
 * of a split cannot claim the same identity.
 */
export function anchorCommunities(
  drafts: CommunityDraft[],
  previous: TaxonomyRegistry | null,
  options: { minOverlap?: number; now?: number } = {},
): AnchoredCommunity[] {
  const minOverlap = options.minOverlap ?? REANCHOR_MIN_OVERLAP;
  const previousMembers = new Map<string, string[]>();
  if (previous) {
    for (const community of previous.communities) {
      if (community.deprecated) continue;
      previousMembers.set(community.id, []);
    }
    for (const [page, assignment] of Object.entries(previous.assignments)) {
      previousMembers.get(assignment.primaryCommunity)?.push(page);
    }
  }

  // All candidate pairings, from best to worst. Sorting
  // globally rather than deciding draft by draft avoids a first
  // mediocre draft seizing the identifier that a later one deserves better.
  const candidates: Array<{ draft: number; id: string; score: number }> = [];
  drafts.forEach((draft, index) => {
    for (const [id, members] of previousMembers) {
      const score = memberOverlap(draft.members, members);
      if (score >= minOverlap) candidates.push({ draft: index, id, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const takenDrafts = new Set<number>();
  const takenIds = new Set<string>();
  const assigned = new Map<number, string>();
  for (const candidate of candidates) {
    if (takenDrafts.has(candidate.draft) || takenIds.has(candidate.id)) continue;
    takenDrafts.add(candidate.draft);
    takenIds.add(candidate.id);
    assigned.set(candidate.draft, candidate.id);
  }

  return drafts.map((draft, index) => {
    const id = assigned.get(index);
    return {
      id: id ?? newCommunityId(options.now),
      members: draft.members,
      label: draft.label,
      reanchored: Boolean(id),
    };
  });
}

/**
 * Gives back its identifier to a preserved community that the model has redescribed.
 *
 * The case appears as soon as a drain pass submits a sample DISJOINT from the
 * previous one: the previous community has no page in the new sample,
 * its overlap drops to zero, and the model — which does not see it — proposes a
 * concept carrying exactly the same name. We then obtained two homonymous
 * communities in the same sibling group, which the registry rightly refuses: the
 * whole synthesis was rejected, and the drain could never finish.
 *
 * Member overlap cannot decide here — there is nothing to
 * overlap. But the label uniqueness constraint per sibling group already says
 * the essential: two same-named sisters are the same thing. We therefore recognize the
 * community by its name, in its sibling group, and only for a draft that has not
 * been re-anchored by any member.
 */
export function adoptByLabel(
  drafts: AnchoredCommunity[],
  preserved: Array<{ id: string; label: string }>,
): { communities: AnchoredCommunity[]; adopted: Set<string> } {
  // `normalizeLabel` already carries the registry's visible-equality rule.
  // Duplicating a variant of it here means condemning the two to diverge:
  // adoption would then stop recognizing exactly the homonyms that
  // validation refuses.
  const available = new Map<string, string>();
  for (const community of preserved) {
    const key = normalizeLabel(community.label);
    if (!available.has(key)) available.set(key, community.id);
  }
  const adopted = new Set<string>();
  const communities = drafts.map((draft) => {
    if (draft.reanchored) return draft;
    const id = available.get(normalizeLabel(draft.label));
    if (!id || adopted.has(id)) return draft;
    adopted.add(id);
    return { ...draft, id, reanchored: true };
  });
  return { communities, adopted };
}

/**
 * Marks as deprecated the communities of the previous registry that have not
 * survived, pointing them towards their replacement when there is one.
 *
 * They are **never deleted**: that is what makes the visual
 * convergence of a merge and the remap of a selection resolvable indefinitely,
 * including for a client that comes back with an old identifier.
 */
/**
 * Members of a community, **descendants included**.
 *
 * The registry only assigns a page to a leaf: a domain appears in
 * no value of `assignments`. Counting its members from only the direct
 * assignments therefore gave it zero — while by
 * definition it has more than any of its daughters. Any overlap reasoning
 * about a domain thus always returned 0, and the redirection
 * that depended on it fell on an arbitrary fallback.
 *
 * A leaf has no descendant: for it, the result is unchanged.
 */
export function membersByCommunity(registry: TaxonomyRegistry): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const community of registry.communities) members.set(community.id, []);
  const parentOf = new Map(
    registry.communities.map((community) => [community.id, community.parentCommunity ?? null] as const),
  );
  for (const [page, assignment] of Object.entries(registry.assignments)) {
    let current: string | null | undefined = assignment.primaryCommunity;
    // The depth is bounded by the schema; the guard protects against a registry
    // corrupted in a cycle rather than looping the loop indefinitely.
    for (let hops = 0; current && hops < 8; hops += 1) {
      members.get(current)?.push(page);
      current = parentOf.get(current) ?? null;
    }
  }
  return members;
}

export function deprecateMissing(
  previous: TaxonomyRegistry | null,
  survivors: AnchoredCommunity[],
  revision: number,
): RegistryCommunity[] {
  if (!previous) return [];
  const alive = new Set(survivors.map((community) => community.id));
  const previousMembers = membersByCommunity(previous);

  return previous.communities
    .filter((community) => !alive.has(community.id) && !community.deprecated)
    .map((community) => {
      // Where did its members go? The community that took the most
      // of them over is the natural merge target.
      const members = previousMembers.get(community.id) ?? [];
      let best: { id: string; score: number } | null = null;
      for (const survivor of survivors) {
        const score = memberOverlap(members, survivor.members);
        if (score > 0 && (!best || score > best.score)) best = { id: survivor.id, score };
      }
      /*
       No overlap: the fallback target was lying.

       The fallback was `survivors[0]` — the first community in the list, which
       has nothing to do with the disappeared one. A restored selection landed there
       silently, and the change note written just below said
       "removed" while `replacedBy` designated someone: the registry was
       contradicting itself.

       The closest community by STRUCTURE is then the best
       honest candidate — the surviving parent, which did contain its pages. Failing
       that, there is no successor, and that is what must be said.
      */
      const survivingParent = community.parentCommunity && alive.has(community.parentCommunity)
        ? community.parentCommunity
        : null;
      const replacedBy = best?.id ?? survivingParent ?? community.replacedBy ?? null;
      return {
        ...community,
        deprecated: true,
        replacedBy,
        changeNote: [
          ...(community.changeNote ?? []),
          { revision, kind: best ? 'merged' : replacedBy ? 'reparented' : 'removed', from: [community.id] },
        ],
      };
    });
}
