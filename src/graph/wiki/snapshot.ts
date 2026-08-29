import { createHash } from 'node:crypto';
import type { WikiGraphEdge, WikiGraphNode } from './projection.ts';
import {
  createCommunityProjection,
  createAxisGrouping,
  type GroupAxis,
  type WikiGraphCommunity,
  type WikiGraphCommunityEdge,
} from './communityProjection.ts';

export type { WikiGraphCommunity } from './communityProjection.ts';

export type AxisGrouping = {
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
};

/**
 * Edge identifier derived from content, never from position.
 */
export function graphEdgeId(edge: Pick<WikiGraphEdge, 'from' | 'to' | 'type'>): string {
  return createHash('sha256')
    .update(JSON.stringify([edge.from, edge.to, edge.type]), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export interface WikiGraphSnapshot {
  workspace: string;
  structureEtag: string;
  topologyEtag: string;
  nodes: Array<Omit<WikiGraphNode, 'raw' | 'html' | 'preview'>>;
  edges: Array<WikiGraphEdge & { id: string }>;
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
  /**
   * The same corpus re-rooted by the non-default axes. `concept` is absent on
   * purpose: it is the top-level `communities`/`communityEdges`, and shipping
   * it twice would double the concept half of the payload. The browser adds the
   * `concept` entry back from the top-level fields when it loads the snapshot.
   */
  groupings: Partial<Record<GroupAxis, AxisGrouping>>;
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
  const edges = graph.edges.map((edge) => ({ ...edge, id: graphEdgeId(edge) }));
  const communityProjection = createCommunityProjection(graph.nodes, graph.edges);
  const groupings: Partial<Record<GroupAxis, AxisGrouping>> = {
    subject: createAxisGrouping(graph.nodes, graph.edges, 'subject'),
    type: createAxisGrouping(graph.nodes, graph.edges, 'type'),
    tag: createAxisGrouping(graph.nodes, graph.edges, 'tag'),
  };
  return {
    workspace: options.workspace ?? 'wiki',
    structureEtag: etag,
    topologyEtag: communityProjection.topologyEtag,
    nodes,
    edges,
    communities: communityProjection.communities,
    communityEdges: communityProjection.communityEdges,
    groupings,
    createdAt: Date.now(),
  };
}
