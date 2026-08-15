import type { TaxonomyRegistry } from './schema.ts';

/*
 Distribution check, before publication.

 The revision that merged 142 pages into a single bubble was
 STRUCTURALLY valid: consistent identifiers, conforming labels,
 complete coverage. It was functionally unusable. A registry
 can therefore pass every form check and destroy navigation,
 which means a check was missing — the one on the shape of the
 distribution, not on that of the data.
*/

/**
 * Maximum share of the corpus that a leaf community can carry.
 *
 * Beyond it, it is no longer a subject: it is the corpus with a name on it. The
 * threshold is relative so it stays valid from a 50-page wiki to a
 * 5,000-page one, and it comes with an absolute floor so as not to declare
 * "excessive" a 6-page leaf in a 10-page corpus.
 */
export const MAX_LEAF_SHARE = 0.35;
export const LEAF_SHARE_FLOOR = 12;

/**
 * A domain that has only one daughter community adds a navigation level
 * to separate nothing: two clicks instead of one, with no information gained.
 */
export const MIN_CHILDREN_PER_DOMAIN = 2;

export type DistributionIssue = { code: string; reason: string };
export type DistributionReport = {
  ok: boolean;
  issues: DistributionIssue[];
  pageCount: number;
  domains: number;
  leaves: number;
  /** Size of the largest leaf, in pages. */
  largestLeaf: number;
};

/**
 * Judges the shape of a taxonomy: depth, sizes, absence of catch-alls.
 *
 * This check is distinct from the schema validation because it answers a
 * different question. Validation asks "is this registry coherent?"; this
 * report asks "is this map navigable?". Both must pass
 * before publication.
 */
export function checkDistribution(registry: TaxonomyRegistry): DistributionReport {
  const issues: DistributionIssue[] = [];
  const active = registry.communities.filter((community) => !community.deprecated);
  const children = new Map<string, number>();
  for (const community of active) {
    if (community.parentCommunity) {
      children.set(community.parentCommunity, (children.get(community.parentCommunity) ?? 0) + 1);
    }
  }

  const sizes = new Map<string, number>();
  for (const assignment of Object.values(registry.assignments)) {
    sizes.set(assignment.primaryCommunity, (sizes.get(assignment.primaryCommunity) ?? 0) + 1);
  }
  const pageCount = Object.keys(registry.assignments).length;
  const leaves = active.filter((community) => !children.has(community.id));
  const domains = active.filter((community) => children.has(community.id));

  const cap = Math.max(LEAF_SHARE_FLOOR, Math.ceil(pageCount * MAX_LEAF_SHARE));
  let largestLeaf = 0;
  for (const leaf of leaves) {
    const size = sizes.get(leaf.id) ?? 0;
    largestLeaf = Math.max(largestLeaf, size);
    if (size > cap) {
      issues.push({
        code: 'leaf_too_large',
        reason: `${leaf.id} carries ${size} page(s) out of ${pageCount} (maximum ${cap}): that is a catch-all, not a subject`,
      });
    }
  }

  for (const domain of domains) {
    const count = children.get(domain.id) ?? 0;
    if (count < MIN_CHILDREN_PER_DOMAIN) {
      issues.push({
        code: 'domain_too_thin',
        reason: `${domain.id} has only ${count} daughter communit(y/ies): a navigation level for nothing`,
      });
    }
  }

  // An entirely flat taxonomy is exactly the original defect: it
  // can be legitimate on a very small corpus, never beyond it.
  if (!domains.length && pageCount > cap) {
    issues.push({
      code: 'no_hierarchy',
      reason: `no parent domain for ${pageCount} page(s): the map cannot be walked level by level`,
    });
  }

  // An empty leaf will never appear: it clutters the index and makes
  // one believe in a subject that does not exist.
  for (const leaf of leaves) {
    if (!(sizes.get(leaf.id) ?? 0)) {
      issues.push({ code: 'empty_leaf', reason: `${leaf.id} carries no page` });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    pageCount,
    domains: domains.length,
    leaves: leaves.length,
    largestLeaf,
  };
}
