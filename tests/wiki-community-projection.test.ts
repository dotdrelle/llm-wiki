import { describe, expect, it } from 'vitest';
import {
  assignGraphCommunities,
  createAxisGrouping,
  createCommunityProjection,
  topologyEtag,
} from '../src/graph/wiki/communityProjection.ts';
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphNodeType,
} from '../src/graph/wiki/projection.ts';

function node(id: string, type: WikiGraphNodeType = 'wiki', extra: Partial<WikiGraphNode> = {}): WikiGraphNode {
  return {
    id,
    title: id,
    type,
    href: `/${id}`,
    preview: '',
    raw: '',
    html: '',
    community: { communityId: 'unclassified', communityLabel: 'Unclassified', assignment: 'fallback' },
    degree: 0,
    x: 0,
    y: 0,
    r: 10,
    ring: 1,
    secondary: id,
    inbound: 0,
    outbound: 0,
    ...extra,
  };
}

describe('wiki community projection', () => {
  it('uses the concept folder as the community, and the node type for the rest', () => {
    const nodes = [
      node('wiki/concepts/market-offering/a.md'),
      node('wiki/concepts/security/b.md'),
      node('raw/ingested/source.md', 'raw-source'),
      node('templates/report.md', 'template'),
      node('deliverables/report.md', 'deliverable'),
    ];
    const assigned = assignGraphCommunities(nodes);
    const byId = new Map(assigned.map((item) => [item.id, item.community]));

    expect(byId.get('wiki/concepts/market-offering/a.md')).toMatchObject({
      communityId: 'market-offering', communityLabel: 'Market Offering', assignment: 'seed',
    });
    expect(byId.get('wiki/concepts/security/b.md')).toMatchObject({
      communityId: 'security', communityLabel: 'Security', assignment: 'seed',
    });
    expect(byId.get('raw/ingested/source.md')).toMatchObject({ communityLabel: 'Raw sources', assignment: 'seed' });
    expect(byId.get('templates/report.md')).toMatchObject({ communityLabel: 'Templates', assignment: 'seed' });
    expect(byId.get('deliverables/report.md')).toMatchObject({ communityLabel: 'Deliverables', assignment: 'seed' });
  });

  it('links two concept folders when their leaves share a subject or a tag', () => {
    const nodes = [
      node('wiki/concepts/market-offering/zephyr.md', 'wiki', { subject: 'zephyr', tags: ['security'] }),
      node('wiki/concepts/security/zephyr.md', 'wiki', { subject: 'zephyr', tags: ['security'] }),
    ];
    const assigned = assignGraphCommunities(nodes);
    const projection = createCommunityProjection(assigned, []);
    const pairs = projection.communityEdges.map((edge) => `${edge.from}->${edge.to}:${edge.count}`);
    expect(pairs.some((pair) => pair.startsWith('market-offering->security')
      || pair.startsWith('security->market-offering'))).toBe(true);
  });

  it('hashes unambiguous sorted topology tuples', () => {
    const nodes = assignGraphCommunities([
      node('wiki/concepts/a/x.md'),
      node('wiki/concepts/b/y.md'),
    ]);
    const edges: WikiGraphEdge[] = [];
    expect(topologyEtag(nodes, edges)).toBe(topologyEtag([...nodes].reverse(), edges));
  });
});

describe('wiki axis grouping', () => {
  it('groups concept leaves by subject across folders', () => {
    const nodes = [
      node('wiki/concepts/market-offering/zephyr.md', 'wiki', { subject: 'zephyr', tags: ['security'] }),
      node('wiki/concepts/security/zephyr.md', 'wiki', { subject: 'zephyr', tags: ['security'] }),
    ];
    const { communities } = createAxisGrouping(nodes, [], 'subject');
    expect(communities).toHaveLength(1);
    expect(communities[0]).toMatchObject({ id: 'zephyr', documentCount: 2 });
  });

  it('groups by OKF type and groups by tag with multi-membership', () => {
    const nodes = [
      node('wiki/concepts/market-offering/a.md', 'wiki', { subject: 'a', okfType: 'product', tags: ['cloud', 'gdpr'] }),
      node('wiki/concepts/security/b.md', 'wiki', { subject: 'b', okfType: 'requirement', tags: ['cloud'] }),
    ];
    const byType = createAxisGrouping(nodes, [], 'type');
    expect(byType.communities.map((item) => item.id).sort()).toEqual(['product', 'requirement']);

    const byTag = createAxisGrouping(nodes, [], 'tag');
    expect(byTag.communities.map((item) => item.id).sort()).toEqual(['cloud', 'gdpr']);
    // The first leaf carries both tags: it appears in both bubbles.
    const cloud = byTag.communities.find((item) => item.id === 'cloud');
    expect(cloud?.nodeIds).toEqual(['wiki/concepts/market-offering/a.md', 'wiki/concepts/security/b.md']);
  });

  it('links two tag bubbles when a leaf carries both tags', () => {
    const nodes = [
      node('wiki/concepts/market-offering/a.md', 'wiki', { subject: 'a', tags: ['cloud', 'gdpr'] }),
    ];
    const { communityEdges } = createAxisGrouping(nodes, [], 'tag');
    const pairs = communityEdges.map((edge) => `${edge.from}->${edge.to}`);
    expect(pairs.some((pair) => pair.includes('cloud') && pair.includes('gdpr'))).toBe(true);
  });
});
