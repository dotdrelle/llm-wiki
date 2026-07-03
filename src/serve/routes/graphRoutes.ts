import type { IncomingMessage, ServerResponse } from 'node:http';

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
  graphEtag: (rootDir: string) => Promise<string>;
  listGraphFiles: (rootDir: string) => Promise<string[]>;
  graphEtagForFiles: (rootDir: string, files: string[]) => Promise<string>;
  buildGraph: (rootDir: string, files: string[]) => Promise<{ nodes: unknown[]; edges: object[] }>;
  generateGraph: (rootDir: string) => Promise<string>;
};

export async function handleGraphRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: GraphRoutesDeps,
): Promise<boolean> {
  if (req.method === 'GET' && urlPath === '/api/graph-etag') {
    deps.sendJson(res, 200, { etag: await deps.graphEtag(deps.rootDir) });
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph-data') {
    const graphFiles = await deps.listGraphFiles(deps.rootDir);
    const etag = await deps.graphEtagForFiles(deps.rootDir, graphFiles);
    const graph = await deps.buildGraph(deps.rootDir, graphFiles);
    deps.sendJson(res, 200, {
      etag,
      nodes: graph.nodes,
      edges: graph.edges.map((edge, index) => ({ ...edge, id: `rel-${index}` })),
    });
    return true;
  }

  if (urlPath === '/graph') {
    const html = await deps.generateGraph(deps.rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  return false;
}
