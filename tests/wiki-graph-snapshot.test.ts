import { describe, expect, it } from 'vitest';
import { createSnapshot } from '../src/graph/wiki/snapshot.ts';
import type { WikiGraphNode } from '../src/graph/wiki/projection.ts';

function node(id: string, group?: string): WikiGraphNode {
  return { id, title: id, type: 'wiki', href: `/${id}`, preview: 'secret preview', raw: 'secret raw', html: '<p>secret</p>', group, degree: 1, x: 0, y: 0, r: 10, ring: 1, secondary: id, inbound: 0, outbound: 1 };
}

describe('wiki graph v2 snapshot', () => {
  it('removes document content and creates deterministic community statistics', () => {
    const snapshot = createSnapshot('etag-1', {
      nodes: [node('wiki/concepts/security/a.md', 'Security'), node('wiki/concepts/security/b.md', 'Security'), node('wiki/other.md')],
      edges: [
        { from: 'wiki/concepts/security/a.md', to: 'wiki/concepts/security/b.md', type: 'links_to' },
        { from: 'wiki/concepts/security/b.md', to: 'wiki/other.md', type: 'links_to' },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(snapshot.structureEtag).toBe('etag-1');
    expect(snapshot.communities.find((item) => item.id === 'security')).toMatchObject({ documentCount: 2, internalRelations: 1, externalRelations: 1 });
  });
});
