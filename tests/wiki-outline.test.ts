import { describe, expect, it } from 'vitest';
import { summarizeWikiGraph } from '../src/graph/wiki/overview.ts';
import type { WikiGraphSnapshot } from '../src/graph/wiki/snapshot.ts';

// wiki_outline exists to decide *what to read*, so it must stay small and
// honest: no page content, knowledge pages only, and an explicit signal when
// the graph carries no real topology.

function node(id: string, type: string, communityId: string) {
  return {
    id,
    title: id,
    type,
    href: `/${id}`,
    community: { communityId, communityLabel: communityId, assignment: 'explicit' },
    degree: 0,
    x: 0,
    y: 0,
    r: 1,
    ring: 1,
    secondary: '',
    inbound: 0,
    outbound: 0,
  };
}

function snapshot(overrides: Partial<WikiGraphSnapshot> = {}): WikiGraphSnapshot {
  return {
    workspace: 'ws',
    structureEtag: 'etag',
    topologyEtag: 'topology',
    nodes: [
      node('wiki/concepts/billing.md', 'wiki', 'billing'),
      node('wiki/concepts/invoice.md', 'wiki', 'billing'),
      node('wiki/sources/contract.md', 'wiki-source', 'billing'),
      node('templates/notes/basic-note.md', 'template', 'billing'),
      node('deliverables/notes/basic-note.md', 'deliverable', 'billing'),
      node('wiki/concepts/support.md', 'wiki', 'support'),
    ],
    edges: [
      { id: 'rel-0', from: 'wiki/concepts/billing.md', to: 'wiki/concepts/invoice.md', type: 'links_to' },
      { id: 'rel-1', from: 'wiki/concepts/billing.md', to: 'wiki/sources/contract.md', type: 'cites' },
      { id: 'rel-2', from: 'wiki/concepts/billing.md', to: 'wiki/concepts/support.md', type: 'related_to' },
    ],
    communities: [
      {
        id: 'billing',
        label: 'billing',
        nodeIds: [
          'wiki/concepts/billing.md',
          'wiki/concepts/invoice.md',
          'wiki/sources/contract.md',
          'templates/notes/basic-note.md',
          'deliverables/notes/basic-note.md',
        ],
        documentCount: 5,
        conceptCount: 2,
        sourceCount: 1,
        internalRelations: 2,
        externalRelations: 1,
      },
      {
        id: 'support',
        label: 'support',
        nodeIds: ['wiki/concepts/support.md'],
        documentCount: 1,
        conceptCount: 1,
        sourceCount: 0,
        internalRelations: 0,
        externalRelations: 1,
      },
    ],
    communityEdges: [{ from: 'billing', to: 'support', count: 1, relations: { related_to: 1 } }],
    createdAt: 0,
    ...overrides,
  } as unknown as WikiGraphSnapshot;
}

describe('summarizeWikiGraph', () => {
  it('ranks communities by size and never returns page content', () => {
    const outline = summarizeWikiGraph(snapshot());
    expect(outline.communities.map((item) => item.id)).toEqual(['billing', 'support']);
    expect(JSON.stringify(outline)).not.toContain('preview');
    expect(outline.pageCount).toBe(6);
  });

  it('offers knowledge pages only, most connected first', () => {
    const [billing] = summarizeWikiGraph(snapshot()).communities;
    expect(billing.topPages[0]).toBe('wiki/concepts/billing.md');
    expect(billing.topPages).not.toContain('templates/notes/basic-note.md');
    expect(billing.topPages).not.toContain('deliverables/notes/basic-note.md');
  });

  it('flags a graph with no communities at all', () => {
    const empty = snapshot({ communities: [] } as Partial<WikiGraphSnapshot>);
    expect(summarizeWikiGraph(empty).degenerate).toBe(true);
    expect(summarizeWikiGraph(snapshot()).degenerate).toBe(false);
  });

  it('caps the payload and drops edges pointing at dropped communities', () => {
    const outline = summarizeWikiGraph(snapshot(), { maxCommunities: 1 });
    expect(outline.communities).toHaveLength(1);
    expect(outline.truncated).toBe(true);
    expect(outline.communityEdges).toHaveLength(0);
  });
});
