import type { WikiGraphEdge, WikiGraphNode } from './projection.ts';

export interface WikiGraphCommunity {
  id: string;
  label: string;
  nodeIds: string[];
  documentCount: number;
  internalRelations: number;
  externalRelations: number;
}

export interface WikiGraphSnapshot {
  structureEtag: string;
  nodes: Array<Omit<WikiGraphNode, 'raw' | 'html' | 'preview'>>;
  edges: Array<WikiGraphEdge & { id: string }>;
  communities: WikiGraphCommunity[];
  createdAt: number;
}

type CacheEntry = { etag: string; snapshot: WikiGraphSnapshot };
const cache = new Map<string, CacheEntry>();

export function cachedSnapshot(rootDir: string, etag: string): WikiGraphSnapshot | undefined {
  const entry = cache.get(rootDir);
  return entry?.etag === etag ? entry.snapshot : undefined;
}

export function storeSnapshot(rootDir: string, snapshot: WikiGraphSnapshot): WikiGraphSnapshot {
  cache.set(rootDir, { etag: snapshot.structureEtag, snapshot });
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  return snapshot;
}

export function createSnapshot(
  etag: string,
  graph: { nodes: WikiGraphNode[]; edges: WikiGraphEdge[] },
): WikiGraphSnapshot {
  const nodes = graph.nodes.map(({ raw, html, preview, ...node }) => {
    void raw; void html; void preview;
    return node;
  });
  const edges = graph.edges.map((edge, index) => ({ ...edge, id: `rel-${index}` }));
  const buckets = new Map<string, string[]>();
  for (const node of nodes) {
    const label = node.group?.trim() || communityLabel(node.id, node.type);
    const id = slug(label);
    const bucket = buckets.get(id) ?? [];
    bucket.push(node.id);
    buckets.set(id, bucket);
  }
  const communities = [...buckets].map(([id, nodeIds]) => {
    const members = new Set(nodeIds);
    let internalRelations = 0;
    let externalRelations = 0;
    for (const edge of edges) {
      const from = members.has(edge.from);
      const to = members.has(edge.to);
      if (from && to) internalRelations += 1;
      else if (from || to) externalRelations += 1;
    }
    const first = nodes.find((node) => members.has(node.id));
    return {
      id,
      label: first?.group?.trim() || communityLabel(first?.id ?? id, first?.type ?? 'wiki'),
      nodeIds: nodeIds.sort(),
      documentCount: nodeIds.length,
      internalRelations,
      externalRelations,
    };
  }).sort((a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label));
  return { structureEtag: etag, nodes, edges, communities, createdAt: Date.now() };
}

function communityLabel(id: string, type: WikiGraphNode['type']): string {
  const parts = id.split('/');
  if (parts[0] === 'wiki' && parts[1] === 'concepts' && parts[2]) return title(parts[2]);
  const labels: Record<WikiGraphNode['type'], string> = {
    wiki: 'Wiki', 'wiki-source': 'Wiki sources', 'raw-source': 'Raw sources',
    template: 'Templates', 'build-context': 'Build contexts', deliverable: 'Deliverables',
  };
  return labels[type];
}

function title(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'autres';
}
