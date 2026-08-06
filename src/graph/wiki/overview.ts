import path from 'node:path';
import { buildGraphOverview, graphEtagForFiles, listGraphFiles } from '../../serve/html/wikiHtml.ts';
import { cachedSnapshot, createSnapshot, storeSnapshot, type WikiGraphSnapshot } from './snapshot.ts';

/**
 * Single entry point for "give me the current wiki graph snapshot".
 *
 * The etag/cache sequence used to live inline in `serve/routes/graphRoutes.ts`.
 * It has a second caller now (the `wiki_outline` MCP tool), and duplicating it
 * would be worse than it looks: `snapshot.ts` keys its cache by `rootDir`
 * alone, so two callers computing two different cache etags for the same
 * workspace would evict each other on every call. One function, one cache key.
 */
export async function loadWikiGraphSnapshot(options: {
  rootDir: string;
  workspace?: string;
  fallbackCommunityLabel?: string;
}): Promise<WikiGraphSnapshot> {
  const { rootDir } = options;
  const fallbackCommunityLabel = options.fallbackCommunityLabel ?? 'Ungrouped';
  const workspace = options.workspace ?? path.basename(rootDir);

  const files = await listGraphFiles(rootDir);
  const etag = await graphEtagForFiles(rootDir, files);
  const cacheEtag = JSON.stringify([etag, workspace, fallbackCommunityLabel]);

  const cached = cachedSnapshot(rootDir, cacheEtag);
  if (cached) return cached;

  const graph = await buildGraphOverview(rootDir, files, fallbackCommunityLabel);
  return storeSnapshot(rootDir, createSnapshot(etag, graph, { workspace }), cacheEtag);
}

const KNOWLEDGE_NODE_TYPES = new Set(['wiki', 'wiki-source', 'raw-source']);

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
  /** True when every community fell back to the default label. */
  degenerate: boolean;
  communities: WikiOutlineCommunity[];
  communityEdges: Array<{ from: string; to: string; count: number }>;
  truncated: boolean;
}

/**
 * Communities, sizes and their most connected pages — never page content.
 *
 * The outline exists to decide *what to read*; reading is `wiki_collect_context`'s
 * job. Returning content here would blow up the context window of the very
 * turn that is supposed to be planning cheaply.
 */
export function summarizeWikiGraph(
  snapshot: WikiGraphSnapshot,
  options: { fallbackCommunityLabel?: string; maxCommunities?: number; maxPagesPerCommunity?: number } = {},
): WikiOutline {
  const fallbackCommunityLabel = options.fallbackCommunityLabel ?? 'Ungrouped';
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
    // Node ids are workspace-relative paths. The graph also carries template,
    // build-context and deliverable nodes; anchoring a slot on a deliverable
    // would be circular, so only knowledge pages are offered here.
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
    // A freshly ingested wiki has no explicit communities at all. Saying so
    // is the point: a caller that mistakes one fallback bucket for a topology
    // will happily invent template sections the wiki cannot support.
    degenerate:
      snapshot.communities.length === 0 ||
      snapshot.communities.every((community) => community.label === fallbackCommunityLabel),
    communities,
    communityEdges: snapshot.communityEdges
      .filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to))
      .map((edge) => ({ from: edge.from, to: edge.to, count: edge.count })),
    truncated: ranked.length > kept.length,
  };
}
