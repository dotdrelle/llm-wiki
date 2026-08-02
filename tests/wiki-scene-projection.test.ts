import { describe, expect, it } from 'vitest';
import { projectWikiScene } from '../src/graph/wiki/canvas/wikiSceneProjection.ts';
import type { WikiGraphSnapshot } from '../src/graph/wiki/snapshot.ts';

const snapshot: WikiGraphSnapshot = {
  workspace: 'test', structureEtag: 's1', topologyEtag: 't1', generatedAt: 'now',
  nodes: [
    { id: 'a.md', title: 'A', type: 'wiki', degree: 1, ring: 0, community: { communityId: 'c1', communityLabel: 'One', assignment: 'explicit' } },
    { id: 'b.md', title: 'B', type: 'wiki', degree: 1, ring: 0, community: { communityId: 'c1', communityLabel: 'One', assignment: 'explicit' } },
    { id: 'c.md', title: 'C', type: 'wiki', degree: 1, ring: 0, community: { communityId: 'c2', communityLabel: 'Two', assignment: 'explicit' } },
  ],
  edges: [{ id: 'e1', from: 'a.md', to: 'c.md', type: 'links_to' }],
  communities: [
    { id: 'c1', label: 'One', nodeIds: ['a.md', 'b.md'], documentCount: 2, conceptCount: 2, sourceCount: 0, internalRelations: 0, externalRelations: 1 },
    { id: 'c2', label: 'Two', nodeIds: ['c.md'], documentCount: 1, conceptCount: 1, sourceCount: 0, internalRelations: 0, externalRelations: 1 },
  ],
  communityEdges: [{ from: 'c1', to: 'c2', count: 1, relations: { links_to: 1 } }],
} as unknown as WikiGraphSnapshot;

describe('wiki canvas scene projection', () => {
  it('projects communities, members, and a direct document neighbourhood', () => {
    expect(projectWikiScene(snapshot).nodes).toHaveLength(2);
    expect(projectWikiScene(snapshot, { communityId: 'c1' }).nodes.map((node) => node.id)).toEqual(['a.md', 'b.md']);
    const focus = projectWikiScene(snapshot, { communityId: 'c1', documentId: 'a.md' });
    expect(focus.level).toBe('focus');
    expect(focus.nodes.map((node) => node.id)).toEqual(['a.md', 'c.md']);
    expect(focus.edges).toHaveLength(1);
  });

  it('keeps overview positions deterministic', () => {
    expect(projectWikiScene(snapshot)).toEqual(projectWikiScene(snapshot));
  });

  it.each([300, 1_000, 5_000])('projects a direct neighbourhood from %i nodes within an interactive budget', (size) => {
    const nodes = Array.from({ length: size }, (_, index) => ({
      id: `node-${index}.md`, title: `Node ${index}`, type: 'wiki', degree: index ? 2 : size - 1, ring: 0,
      community: { communityId: 'large', communityLabel: 'Large', assignment: 'explicit' },
    }));
    const edges = Array.from({ length: size - 1 }, (_, index) => ({
      id: `edge-${index}`, from: 'node-0.md', to: `node-${index + 1}.md`, type: 'links_to',
    }));
    const large = {
      ...snapshot, nodes, edges,
      communities: [{ id: 'large', label: 'Large', nodeIds: nodes.map((node) => node.id), documentCount: size, conceptCount: size, sourceCount: 0, internalRelations: edges.length, externalRelations: 0 }],
      communityEdges: [],
    } as unknown as WikiGraphSnapshot;
    const started = performance.now();
    const scene = projectWikiScene(large, { communityId: 'large', documentId: 'node-0.md' });
    expect(scene.nodes).toHaveLength(Math.min(50, size));
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
