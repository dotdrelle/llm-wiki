import path from 'node:path';
import { buildGraphOverview, graphEtagForFiles, listGraphFiles } from '../../serve/html/wikiHtml.ts';
import { cachedSnapshot, createSnapshot, storeSnapshot, type WikiGraphSnapshot } from './snapshot.ts';

/**
 * Projection version, to increment as soon as the way communities or
 * assignments are derived changes.
 */
export const GRAPH_PROJECTION_VERSION = 2;

/** Node types that carry knowledge: concepts and source notes. */
const KNOWLEDGE_NODE_TYPES = new Set(['wiki', 'wiki-source']);

/**
 * Single entry point for "give me the current wiki graph snapshot".
 *
 * The graph is a direct reading of the concept folders, `subject` and `tags` —
 * there is no registry to load and no model call. The cache key is the file
 * etag plus the projection version.
 */
export async function loadWikiGraphSnapshot(options: {
  rootDir: string;
  workspace?: string;
  language?: string;
}): Promise<WikiGraphSnapshot> {
  const { rootDir } = options;
  const workspace = options.workspace ?? path.basename(rootDir);

  const files = await listGraphFiles(rootDir);
  const etag = await graphEtagForFiles(rootDir, files);
  const cacheEtag = JSON.stringify([etag, workspace, GRAPH_PROJECTION_VERSION]);

  const cached = cachedSnapshot(rootDir, cacheEtag);
  if (cached) return cached;

  const graph = await buildGraphOverview(rootDir, files);

  return storeSnapshot(
    rootDir,
    createSnapshot(etag, graph, { workspace }),
    cacheEtag,
  );
}

export interface WikiOutlineCommunity {
  id: string;
  label: string;
  documentCount: number;
  conceptCount: number;
  sourceCount: number;
  internalRelations: number;
  externalRelations: number;
  topPages: string[];
}

export interface WikiOutline {
  workspace: string;
  topologyEtag: string;
  pageCount: number;
  communityCount: number;
  degenerate: boolean;
  communities: WikiOutlineCommunity[];
  communityEdges: Array<{ from: string; to: string; count: number }>;
  truncated: boolean;
}

/**
 * Communities, sizes and their most connected pages — never page content.
 */
export function summarizeWikiGraph(
  snapshot: WikiGraphSnapshot,
  options: { maxCommunities?: number; maxPagesPerCommunity?: number } = {},
): WikiOutline {
  const maxCommunities = options.maxCommunities ?? 40;
  const maxPagesPerCommunity = options.maxPagesPerCommunity ?? 8;

  const degree = new Map<string, number>();
  for (const edge of snapshot.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));

  const ranked = [...snapshot.communities].sort(
    (a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label),
  );
  const kept = ranked.slice(0, maxCommunities);

  const communities = kept.map((community) => ({
    id: community.id,
    label: community.label,
    documentCount: community.documentCount,
    conceptCount: community.conceptCount,
    sourceCount: community.sourceCount,
    internalRelations: community.internalRelations,
    externalRelations: community.externalRelations,
    topPages: [...community.nodeIds]
      .filter((nodeId) => KNOWLEDGE_NODE_TYPES.has(nodeById.get(nodeId)?.type ?? ''))
      .sort(
        (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b),
      )
      .slice(0, maxPagesPerCommunity),
  }));

  const keptIds = new Set(communities.map((community) => community.id));

  return {
    workspace: snapshot.workspace,
    topologyEtag: snapshot.topologyEtag,
    pageCount: snapshot.nodes.length,
    communityCount: snapshot.communities.length,
    degenerate: snapshot.communities.length === 0,
    communities,
    communityEdges: snapshot.communityEdges
      .filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to))
      .map((edge) => ({ from: edge.from, to: edge.to, count: edge.count })),
    truncated: ranked.length > kept.length,
  };
}
