import { describe, expect, it } from 'vitest';
import {
  assignGraphCommunities,
  createCommunityProjection,
  topologyEtag,
} from '../src/graph/wiki/communityProjection.ts';
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphNodeType,
} from '../src/graph/wiki/projection.ts';

function node(id: string, type: WikiGraphNodeType = 'wiki'): WikiGraphNode {
  return {
    id,
    title: id,
    type,
    href: `/${id}`,
    preview: '',
    raw: '',
    html: '',
    community: { communityId: 'ungrouped', communityLabel: 'Ungrouped', assignment: 'fallback' },
    degree: 0,
    x: 0,
    y: 0,
    r: 10,
    ring: 1,
    secondary: id,
    inbound: 0,
    outbound: 0,
  };
}

describe('wiki community projection', () => {
  it('assigns communities in deterministic passes without turning types into communities', () => {
    const nodes = [
      node('wiki/concepts/zeta/a.md'),
      node('wiki/concepts/alpha/a.md'),
      node('wiki/concepts/alpha/b.md'),
      node('raw/ingested/source.md', 'raw-source'),
      node('templates/report.md', 'template'),
      node('deliverables/report.md', 'deliverable'),
      node('build-context/no-majority.md', 'build-context'),
    ];
    const edges: WikiGraphEdge[] = [
      { from: 'wiki/concepts/zeta/a.md', to: 'raw/ingested/source.md', type: 'cites' },
      { from: 'wiki/concepts/alpha/a.md', to: 'raw/ingested/source.md', type: 'generated_from' },
      { from: 'wiki/concepts/alpha/a.md', to: 'templates/report.md', type: 'uses_template' },
      { from: 'wiki/concepts/alpha/b.md', to: 'templates/report.md', type: 'uses_template' },
      { from: 'wiki/concepts/zeta/a.md', to: 'templates/report.md', type: 'uses_template' },
      { from: 'templates/report.md', to: 'deliverables/report.md', type: 'produces' },
      { from: 'wiki/concepts/alpha/a.md', to: 'build-context/no-majority.md', type: 'uses_context' },
      { from: 'wiki/concepts/zeta/a.md', to: 'build-context/no-majority.md', type: 'uses_context' },
    ];

    const assigned = assignGraphCommunities(nodes, [...edges].reverse(), new Map(), 'Sans groupe');
    const byId = new Map(assigned.map((item) => [item.id, item.community]));
    expect(byId.get('raw/ingested/source.md')).toMatchObject({ communityId: 'alpha', assignment: 'inherited' });
    expect(byId.get('templates/report.md')).toMatchObject({ communityId: 'alpha', assignment: 'inherited' });
    expect(byId.get('deliverables/report.md')).toMatchObject({ communityId: 'alpha', assignment: 'inherited' });
    expect(byId.get('build-context/no-majority.md')).toEqual({
      communityId: 'ungrouped',
      communityLabel: 'Sans groupe',
      assignment: 'fallback',
    });
  });

  it('gives frontmatter community precedence and keeps the fallback id stable', () => {
    const nodes = [node('wiki/page.md'), node('wiki/other.md')];
    const explicit = new Map([['wiki/page.md', { label: 'Community wins' }]]);
    const assigned = assignGraphCommunities(nodes, [], explicit, 'Non classé');
    expect(assigned[0]?.community).toEqual({
      communityId: 'community-wins',
      communityLabel: 'Community wins',
      assignment: 'explicit',
    });
    expect(assigned[1]?.community.communityId).toBe('ungrouped');
    expect(assigned[1]?.community.communityLabel).toBe('Non classé');
  });

  it('assigns deliverables from producer plurality with a stable alphabetical tie', () => {
    const baseNodes = [
      node('templates/zeta.md', 'template'),
      node('wiki/alpha.md'),
      node('deliverables/result.md', 'deliverable'),
    ];
    const explicit = new Map([
      ['templates/zeta.md', { label: 'Zeta' }],
      ['wiki/alpha.md', { label: 'Alpha' }],
    ]);
    const edges: WikiGraphEdge[] = [
      { from: 'templates/zeta.md', to: 'deliverables/result.md', type: 'produces' },
      { from: 'wiki/alpha.md', to: 'deliverables/result.md', type: 'produces' },
    ];
    const forward = assignGraphCommunities(baseNodes, edges, explicit);
    const reverse = assignGraphCommunities(baseNodes, [...edges].reverse(), explicit);
    expect(forward.find((item) => item.type === 'deliverable')?.community.communityId).toBe('alpha');
    expect(reverse.find((item) => item.type === 'deliverable')?.community.communityId).toBe('alpha');
  });

  it('aggregates every edge once and hashes unambiguous sorted topology tuples', () => {
    const explicit = new Map([
      ['wiki/a.md', { label: 'A' }],
      ['wiki/bc.md', { label: 'A' }],
      ['wiki/ab.md', { label: 'B' }],
      ['wiki/c.md', { label: 'B' }],
    ]);
    const nodes = assignGraphCommunities(
      [node('wiki/a.md'), node('wiki/bc.md'), node('wiki/ab.md'), node('wiki/c.md')],
      [],
      explicit,
    );
    const edges: WikiGraphEdge[] = [
      { from: 'wiki/a.md', to: 'wiki/bc.md', type: 'links_to' },
      { from: 'wiki/a.md', to: 'wiki/ab.md', type: 'cites' },
      { from: 'wiki/c.md', to: 'wiki/a.md', type: 'related_to' },
    ];
    const projection = createCommunityProjection(nodes, edges);
    const reversedProjection = createCommunityProjection([...nodes].reverse(), [...edges].reverse());
    expect(
      projection.communities.reduce((sum, community) => sum + community.internalRelations, 0)
      + projection.communityEdges.reduce((sum, edge) => sum + edge.count, 0),
    ).toBe(edges.length);
    expect(projection.communityEdges).toEqual([
      { from: 'a', to: 'b', count: 1, relations: { cites: 1 } },
      { from: 'b', to: 'a', count: 1, relations: { related_to: 1 } },
    ]);
    expect(reversedProjection.communities).toEqual(projection.communities);
    expect(reversedProjection.communityEdges).toEqual(projection.communityEdges);
    expect(topologyEtag(nodes, edges)).toBe(topologyEtag([...nodes].reverse(), [...edges].reverse()));
    expect(topologyEtag(nodes, edges)).toBe(topologyEtag(
      nodes.map((item) => ({ ...item, raw: `edited ${item.id}`, preview: 'changed', html: '<p>changed</p>' })),
      edges,
    ));

    const collisionNodes = assignGraphCommunities(
      [node('wiki/a.md'), node('wiki/bc.md')], [], explicit,
    );
    const otherCollisionNodes = assignGraphCommunities(
      [node('wiki/ab.md'), node('wiki/c.md')], [], explicit,
    );
    expect(topologyEtag(collisionNodes, [])).not.toBe(topologyEtag(otherCollisionNodes, []));
  });
});
