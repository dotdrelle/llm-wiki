import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { buildGraphOverview, generateGraph, graphEtagForFiles, listGraphFiles, renderGraphDocument } from '../html/wikiHtml.ts';
import { cachedSnapshot, createSnapshot, storeSnapshot } from '../../graph/wiki/snapshot.ts';

export type GraphRoutesDeps = {
  rootDir: string;
  fallbackCommunityLabel: () => string;
  workspaceNameFromEnv: () => string | null;
  sendJson: (
    res: {
      writeHead: (s: number, h: Record<string, string>) => void;
      end: (c?: string) => void;
    },
    status: number,
    data: unknown,
  ) => void;
  sendGzippedHtml: (
    req: IncomingMessage,
    res: ServerResponse,
    html: string,
    headers?: Record<string, string>,
    status?: number,
  ) => Promise<void>;
};

export async function handleGraphRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: GraphRoutesDeps,
): Promise<boolean> {
  const snapshot = async () => {
    const files = await listGraphFiles(deps.rootDir);
    const etag = await graphEtagForFiles(deps.rootDir, files);
    const workspace = deps.workspaceNameFromEnv() ?? path.basename(deps.rootDir);
    const fallbackCommunityLabel = deps.fallbackCommunityLabel();
    const cacheEtag = JSON.stringify([etag, workspace, fallbackCommunityLabel]);
    const cached = cachedSnapshot(deps.rootDir, cacheEtag);
    if (cached) return cached;
    const graph = await buildGraphOverview(deps.rootDir, files, fallbackCommunityLabel);
    return storeSnapshot(
      deps.rootDir,
      createSnapshot(etag, graph, { workspace }),
      cacheEtag,
    );
  };

  if (req.method === 'GET' && urlPath === '/api/graph/overview') {
    deps.sendJson(res, 200, await snapshot());
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/etag') {
    const current = await snapshot();
    deps.sendJson(res, 200, {
      structureEtag: current.structureEtag,
      topologyEtag: current.topologyEtag,
    });
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/community') {
    const current = await snapshot();
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
    const community = current.communities.find((item) => item.id === id);
    if (!community) deps.sendJson(res, 404, { error: 'COMMUNITY_NOT_FOUND' });
    else {
      const members = new Set(community.nodeIds);
      deps.sendJson(res, 200, {
        ...community,
        nodes: current.nodes.filter((node) => members.has(node.id)),
        edges: current.edges.filter((edge) => members.has(edge.from) || members.has(edge.to)),
      });
    }
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/document') {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
    const current = await snapshot();
    if (!id || !current.nodes.some((node) => node.id === id)) {
      deps.sendJson(res, 404, { error: 'DOCUMENT_NOT_FOUND' });
    } else {
      const document = await renderGraphDocument(deps.rootDir, id);
      deps.sendJson(res, 200, {
        ...document,
        incoming: current.edges.filter((edge) => edge.to === id),
        outgoing: current.edges.filter((edge) => edge.from === id),
      });
    }
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/list') {
    const current = await snapshot();
    deps.sendJson(res, 200, current);
    return true;
  }

  if (urlPath === '/graph') {
    const html = await generateGraph(deps.rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  return false;
}
