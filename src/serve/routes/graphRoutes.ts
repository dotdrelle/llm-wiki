import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { generateGraph, renderGraphDocument } from '../html/wikiHtml.ts';
import { loadWikiGraphSnapshot } from '../../graph/wiki/overview.ts';
import { createFilteredSnapshot } from '../../graph/wiki/snapshot.ts';
import { graphDocumentSummary } from '../../graph/wiki/summary.ts';
import { loadTaxoGraph } from '../../graph/wiki/taxoGraph.ts';
import { loadProvenanceGraph, ProvenanceGraphError } from '../../graph/wiki/provenanceGraph.ts';
import { createGraphEventHub, type GraphEventHub } from '../sse/graphEvents.ts';
import { sendJsonPayload } from '../http/sendJsonPayload.ts';

export type GraphSearchAnswer = {
  mode: 'hybrid' | 'lexical' | 'lexical-fallback';
  reason: string | null;
  /** Nothing scored as relevant: these are the closest hits, not matches. */
  weak?: boolean;
  results: Array<{ path: string; score: number }>;
};

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
  /**
   * The engine's own retrieval (BM25, plus vectors when `retrieval.vector` is
   * configured), injected by `serve` like `completeText`. Absent, the graph
   * search answers 503 and the page says so instead of matching nothing.
   */
  searchWiki?: (query: string) => Promise<GraphSearchAnswer>;
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

  // The graph search is a relation filter: `?q=` narrows the corpus BEFORE the
  // projection, so leaf edges, community edges and every axis grouping agree.
  const queryOf = (req: IncomingMessage) =>
    new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
  const snapshotFor = async (req: IncomingMessage) => {
    const current = await snapshot();
    const q = queryOf(req);
    return q.trim() ? createFilteredSnapshot(current, q) : current;
  };

  if (req.method === 'GET' && urlPath === '/api/graph/events') {
    graphEventHub(() => deps.rootDir).subscribe(req, res);
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/overview') {
    // The only route whose payload is re-sent in full on every revision: it is
    // the one that justifies compression, and the only one that needs it.
    await sendJsonPayload(req, res, 200, await snapshotFor(req));
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

  // The TAXO page draws concept pivots and fiches: a node it shows must open
  // its summary and preview even where the community snapshot left it out.
  const knownNode = async (id: string | null) => Boolean(id) && (
    (await snapshot()).nodes.some((node) => node.id === id)
    || (await loadTaxoGraph(deps.rootDir)).nodes.some((node) => node.id === id));

  if (req.method === 'GET' && urlPath === '/api/graph/taxo') {
    await sendJsonPayload(req, res, 200, await loadTaxoGraph(deps.rootDir));
    return true;
  }

  // The Provenance view: one deliverable, read from its frozen evidence
  // manifest (or live, announced). Read-only, additive to the TAXO payload.
  if (req.method === 'GET' && urlPath === '/api/graph/provenance') {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    try {
      deps.sendJson(res, 200, await loadProvenanceGraph(deps.rootDir, params.get('id') ?? '', {
        build: params.get('build'),
        mode: params.get('mode') === 'live' ? 'live' : 'frozen',
      }));
    } catch (error) {
      if (error instanceof ProvenanceGraphError) {
        deps.sendJson(res, error.code === 'INVALID_DELIVERABLE' ? 400 : 404, { error: error.code, message: error.message });
      } else {
        deps.sendJson(res, 500, { error: 'PROVENANCE_FAILED', message: (error as Error).message });
      }
    }
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/search') {
    const q = queryOf(req).trim();
    if (!q) deps.sendJson(res, 200, { mode: 'lexical', reason: null, results: [] });
    else if (!deps.searchWiki) deps.sendJson(res, 503, { error: 'SEARCH_UNAVAILABLE' });
    else {
      try {
        deps.sendJson(res, 200, await deps.searchWiki(q));
      } catch (error) {
        deps.sendJson(res, 500, { error: 'SEARCH_FAILED', message: (error as Error).message });
      }
    }
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/document') {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
    const current = await snapshot();
    if (!id || !(await knownNode(id))) {
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
    if (!id || !(await knownNode(id))) {
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
    deps.sendJson(res, 200, await snapshotFor(req));
    return true;
  }

  if (urlPath === '/graph') {
    const html = await generateGraph(deps.rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  return false;
}
