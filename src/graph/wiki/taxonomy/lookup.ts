import { communityId, type RegistryLookup } from '../communityProjection.ts';
import { communityLabel, resolveCommunity, type TaxonomyRegistry } from './schema.ts';

/**
 * Adapts a registry to the minimal view that assignment needs.
 *
 * It is here, and only here, that the registry vocabulary becomes the
 * `(id, label)` pair that the snapshot exposes. The projection stays ignorant
 * of SKOS, of languages and of revisions; the registry stays ignorant of the graph.
 *
 * Absorptions are resolved along the way: an assignment that still points at
 * a merged concept returns the ACTIVE community, never a vanished bubble.
 * That is what lets a registry slightly behind on its own
 * merges stay readable rather than make pages disappear.
 */
export function registryLookup(
  registry: TaxonomyRegistry,
  language: string,
  fallbackLanguage = 'en',
): RegistryLookup {
  const resolved = new Map<string, { communityId: string; communityLabel: string }>();

  for (const [page, assignment] of Object.entries(registry.assignments)) {
    const community = resolveCommunity(registry, assignment.primaryCommunity);
    if (!community || community.deprecated) continue;
    resolved.set(page, {
      communityId: community.id,
      communityLabel: communityLabel(community, language, fallbackLanguage),
    });
  }

  return { assign: (pageId) => resolved.get(pageId) ?? null };
}

export type CommunityDomain = { id: string; label: string };
export type CommunityHierarchy = {
  /** Root domains: what the map shows at the first level. */
  domains: CommunityDomain[];
  /** Leaf → domain. Empty when the taxonomy is still flat. */
  parents: Record<string, string>;
};

/**
 * Tree of the communities, as the screen must walk it.
 *
 * The registry carries the hierarchy, but a graph node only knows its
 * leaf: that is the level that carries the pages. Without this table, the map
 * would show the leaves — hence as many bubbles as there are subjects — instead
 * of the few domains it is supposed to show.
 *
 * It is empty on a deterministic taxonomy: the map then falls back on
 * its flat rendering, which is the correct behavior as long as no domain
 * exists.
 */
export function communityHierarchy(
  registry: TaxonomyRegistry,
  language: string,
  fallbackLanguage = 'en',
): CommunityHierarchy {
  const active = registry.communities.filter((community) => !community.deprecated);
  const byId = new Map(active.map((community) => [community.id, community]));
  const parents: Record<string, string> = {};
  const used = new Set<string>();

  for (const community of active) {
    if (!community.parentCommunity) continue;
    const domain = byId.get(community.parentCommunity);
    if (!domain) continue;
    parents[community.id] = domain.id;
    used.add(domain.id);
  }

  return {
    // Only the domains that really carry communities: a root
    // without a child is a leaf, and it displays as such.
    domains: active
      .filter((community) => used.has(community.id))
      .map((community) => ({ id: community.id, label: communityLabel(community, language, fallbackLanguage) })),
    parents,
  };
}

/**
 * Identifier redirects, from the absorbed one to the active one.
 *
 * The client uses them for two things that would otherwise be visible losses:
 * follow a selection through a merge, and find the Canvas position
 * saved under the old identifier.
 */
export function communityRedirects(registry: TaxonomyRegistry): Record<string, string> {
  const redirects: Record<string, string> = {};
  for (const community of registry.communities) {
    if (!community.deprecated) continue;
    const target = resolveCommunity(registry, community.id);
    if (target && target.id !== community.id) redirects[community.id] = target.id;
  }
  // First activation of the registry: the historical positions are still
  // indexed by the slug derived from the deterministic label. They must follow
  // the new opaque id exactly like a later merge. On a
  // multilingual collision, no ambiguous migration is invented.
  const legacyOwners = new Map<string, string | null>();
  for (const community of registry.communities) {
    if (community.deprecated) continue;
    const labels = [
      ...Object.values(community.prefLabel),
      ...Object.values(community.altLabel ?? {}).flat(),
    ];
    for (const label of labels) {
      const legacy = communityId(label);
      const previous = legacyOwners.get(legacy);
      legacyOwners.set(legacy, previous === undefined || previous === community.id ? community.id : null);
    }
  }
  for (const [legacy, owner] of legacyOwners) {
    if (owner && legacy !== owner && redirects[legacy] === undefined) redirects[legacy] = owner;
  }
  return redirects;
}
