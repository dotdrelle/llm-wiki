import type { WikiGraphEdge, WikiGraphNode } from './projection.ts';
import {
  createCommunityProjection,
  type WikiGraphCommunity,
  type WikiGraphCommunityEdge,
} from './communityProjection.ts';

export type { WikiGraphCommunity } from './communityProjection.ts';

export interface WikiGraphSnapshot {
  workspace: string;
  structureEtag: string;
  topologyEtag: string;
  nodes: Array<Omit<WikiGraphNode, 'raw' | 'html' | 'preview'>>;
  edges: Array<WikiGraphEdge & { id: string }>;
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
  createdAt: number;
}

type CacheEntry = { etag: string; snapshot: WikiGraphSnapshot };
const cache = new Map<string, CacheEntry>();

export function cachedSnapshot(rootDir: string, etag: string): WikiGraphSnapshot | undefined {
  const entry = cache.get(rootDir);
  return entry?.etag === etag ? entry.snapshot : undefined;
}

export function storeSnapshot(
  rootDir: string,
  snapshot: WikiGraphSnapshot,
  cacheEtag = snapshot.structureEtag,
): WikiGraphSnapshot {
  cache.set(rootDir, { etag: cacheEtag, snapshot });
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  return snapshot;
}

export function createSnapshot(
  etag: string,
  graph: { nodes: WikiGraphNode[]; edges: WikiGraphEdge[] },
  options: { workspace?: string } = {},
): WikiGraphSnapshot {
  const nodes = graph.nodes.map(({ raw, html, preview, ...node }) => {
    void raw; void html; void preview;
    return node;
  });
  const edges = graph.edges.map((edge, index) => ({ ...edge, id: `rel-${index}` }));
  const communityProjection = createCommunityProjection(graph.nodes, graph.edges);
  return {
    workspace: options.workspace ?? 'wiki',
    structureEtag: etag,
    topologyEtag: communityProjection.topologyEtag,
    nodes,
    edges,
    communities: communityProjection.communities,
    communityEdges: communityProjection.communityEdges,
    createdAt: Date.now(),
  };
}
