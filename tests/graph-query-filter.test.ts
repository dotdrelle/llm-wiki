import { describe, expect, it } from 'vitest';
import type { WikiGraphEdge, WikiGraphNode } from '../src/graph/wiki/projection.ts';
import { createSnapshot, createFilteredSnapshot } from '../src/graph/wiki/snapshot.ts';
import { filterGraphByQuery } from '../src/graph/wiki/queryFilter.ts';

function node(id: string, title: string, extra: Partial<WikiGraphNode> = {}): WikiGraphNode {
  return {
    id,
    title,
    type: 'wiki',
    href: `/${id}`,
    preview: '',
    raw: '',
    html: '',
    community: { communityId: id.split('/')[2] ?? 'x', communityLabel: id.split('/')[2] ?? 'x', assignment: 'seed' },
    degree: 1,
    x: 0,
    y: 0,
    r: 8,
    ring: 1,
    secondary: id,
    inbound: 0,
    outbound: 0,
    ...extra,
  };
}

const security = node('wiki/concepts/securite/durcissement.md', 'Durcissement des postes', { tags: ['sécurité', 'endpoint'] });
const anaplan = node('wiki/concepts/produit/anaplan.md', 'Anaplan', { subject: 'Anaplan', okfType: 'product' });
const jedox = node('wiki/concepts/produit/jedox.md', 'Jedox', { subject: 'Jedox' });
const orphan = node('wiki/concepts/produit/calculette.md', 'Calculette', { subject: 'Calculette' });
const edges: WikiGraphEdge[] = [
  { from: security.id, to: anaplan.id, type: 'links_to' },
  { from: anaplan.id, to: jedox.id, type: 'cites' },
  { from: jedox.id, to: orphan.id, type: 'cites' },
];

describe('graph query filter', () => {
  it('returns the corpus untouched for an empty query', () => {
    const result = filterGraphByQuery([security, anaplan, jedox, orphan], edges, '   ');
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
  });

  it('matches a tag accent-insensitively ("secu" finds "sécurité")', () => {
    const result = filterGraphByQuery([security, anaplan, jedox, orphan], edges, 'secu');
    expect(result.nodes.map((item) => item.id)).toContain(security.id);
  });

  it('shows every relation touching a matched node, and pulls the far end in', () => {
    // "ana" matches Anaplan. Both relations that touch it are kept, so the
    // security page and Jedox come back even though they do not match; the
    // unrelated Jedox→Calculette relation and its far end do NOT.
    const result = filterGraphByQuery([security, anaplan, jedox, orphan], edges, 'ana');
    const ids = result.nodes.map((item) => item.id);
    expect(ids).toContain(anaplan.id);
    expect(ids).toContain(security.id);
    expect(ids).toContain(jedox.id);
    expect(ids).not.toContain(orphan.id);
    expect(result.edges).toHaveLength(2);
  });

  it('matches a relation label ("links")', () => {
    const result = filterGraphByQuery([security, anaplan, jedox, orphan], edges, 'links');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.type).toBe('links_to');
  });
});

describe('filtered snapshot', () => {
  it('re-projects communities and relations from the reduced corpus', () => {
    const base = createSnapshot('etag', { nodes: [security, anaplan, jedox, orphan], edges }, { workspace: 'demo' });
    const filtered = createFilteredSnapshot(base, 'ana');
    expect(filtered.nodes.map((item) => item.id).sort()).toEqual([anaplan.id, jedox.id, security.id].sort());
    expect(filtered.edges).toHaveLength(2);
    // The community relation is rebuilt from the reduced corpus, not copied
    // from the full snapshot.
    expect(filtered.communities.some((community) => community.nodeIds.includes(orphan.id))).toBe(false);
  });
});
