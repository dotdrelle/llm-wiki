import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildGraph, generateGraph, graphEtag, graphEtagForFiles, listGraphFiles } from '../html/wikiHtml.ts';

export type GraphRoutesDeps = {
  rootDir: string;
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
  if (req.method === 'GET' && urlPath === '/api/graph-etag') {
    deps.sendJson(res, 200, { etag: await graphEtag(deps.rootDir) });
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph-data') {
    const graphFiles = await listGraphFiles(deps.rootDir);
    const etag = await graphEtagForFiles(deps.rootDir, graphFiles);
    const graph = await buildGraph(deps.rootDir, graphFiles);
    deps.sendJson(res, 200, {
      etag,
      nodes: graph.nodes,
      edges: graph.edges.map((edge, index) => ({ ...edge, id: `rel-${index}` })),
    });
    return true;
  }

  if (urlPath === '/graph') {
    const html = await generateGraph(deps.rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  return false;
}
