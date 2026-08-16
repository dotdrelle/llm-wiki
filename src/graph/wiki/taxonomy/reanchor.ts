import type { RegistryCommunity } from './schema.ts';

/**
 * Gives a root back to any active community whose parent is no longer one.
 *
 * A leaf preserved because it was not submitted keeps its
 * `parentCommunity` — but nothing guarantees that this domain survived the same
 * revision: ANOTHER leaf of the same domain, sampled this time, can
 * have had it replaced or deprecated. The leaf then stayed active while
 * pointing at a dead parent.
 *
 * The registry passed validation, and yet `communityHierarchy`
 * only builds the tree from the active communities: the parent was
 * untraceable, the leaf fell out of the hierarchy and reappeared as a
 * root bubble on the map, contradicting what the registry declared.
 *
 * We therefore follow the parent's redirection as long as it leads to a live root,
 * and failing that we promote the child to root — what the schema allows, and
 * which keeps it navigable instead of suspending it in the void.
 */
export function reattachOrphanedChildren(communities: RegistryCommunity[]): void {
  const byId = new Map(communities.map((community) => [community.id, community]));
  const isLiveRoot = (community: RegistryCommunity | undefined): boolean =>
    Boolean(community && !community.deprecated && !community.parentCommunity);

  for (const community of communities) {
    if (community.deprecated || !community.parentCommunity) continue;
    let parent = byId.get(community.parentCommunity);
    if (isLiveRoot(parent)) continue;
    // The replacement target must be a live ROOT: hanging onto a
    // leaf would dig a third level that the schema forbids.
    for (let hops = 0; parent?.deprecated && parent.replacedBy && hops < 16; hops += 1) {
      parent = byId.get(parent.replacedBy);
    }
    community.parentCommunity = isLiveRoot(parent) ? parent!.id : null;
  }
}
