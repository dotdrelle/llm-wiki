import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { generateGraph, renderGraphDocument } from '../html/wikiHtml.ts';
import { loadWikiGraphSnapshot } from '../../graph/wiki/overview.ts';
import { graphDocumentSummary } from '../../graph/wiki/summary.ts';
import { createGraphEventHub, type GraphEventHub } from '../sse/graphEvents.ts';
import { sendJsonPayload } from '../http/sendJsonPayload.ts';

export type GraphRoutesDeps = {
  rootDir: string;
  language: () => string;
  workspaceNameFromEnv: () => string | null;
  /**
   * LLM completion, injected by `serve` which alone holds the configuration.
   * Absent when no LLM is configured: the context card then renders an excerpt
   * rather than nothing.
   */
  completeText?: (request: { system: string; user: string }) => Promise<string>;
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

/*
 A single broadcaster per Serve process.

 `/api/graph/events` is a DIRECT route, not a proxy toward an upstream service
 like `/api/runtime/events`: Serve is the origin of the stream. The shell opens
 it on the same origin then relays revisions to its iframe via postMessage, and
 the standalone `/graph` opens it directly — one connection per document, never
 one per panel.
*/
let hub: GraphEventHub | null = null;

export function graphEventHub(rootDir: () => string): GraphEventHub {
  if (!hub) hub = createGraphEventHub(rootDir);
  return hub;
}

export function stopGraphEventHub(): void {
  hub?.stop();
  hub = null;
}

export async function handleGraphRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: GraphRoutesDeps,
): Promise<boolean> {
  // Shared with the wiki_outline MCP tool: see graph/wiki/overview.ts for why
  // the etag/cache sequence must not be duplicated per caller.
  const snapshot = async () =>
    loadWikiGraphSnapshot({
      rootDir: deps.rootDir,
      workspace: deps.workspaceNameFromEnv() ?? path.basename(deps.rootDir),
      language: deps.language(),
    });

  if (req.method === 'GET' && urlPath === '/api/graph/events') {
    graphEventHub(() => deps.rootDir).subscribe(req, res);
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/overview') {
    // The only route whose payload is re-sent in full on every revision: it is
    // the one that justifies compression, and the only one that needs it.
    await sendJsonPayload(req, res, 200, await snapshot());
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

  if (req.method === 'GET' && urlPath === '/api/graph/summary') {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
    const current = await snapshot();
    if (!id || !current.nodes.some((node) => node.id === id)) {
      deps.sendJson(res, 404, { error: 'DOCUMENT_NOT_FOUND' });
      return true;
    }
    const document = await renderGraphDocument(deps.rootDir, id);
    deps.sendJson(
      res,
      200,
      await graphDocumentSummary({
        rootDir: deps.rootDir,
        id,
        title: document.title,
        preview: document.preview,
        contentEtag: document.contentEtag,
        complete: deps.completeText,
      }),
    );
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
