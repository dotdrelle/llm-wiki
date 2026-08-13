import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { generateGraph, renderGraphDocument } from '../html/wikiHtml.ts';
import { loadWikiGraphSnapshot } from '../../graph/wiki/overview.ts';
import { graphDocumentSummary } from '../../graph/wiki/summary.ts';
import { createGraphEventHub, type GraphEventHub } from '../sse/graphEvents.ts';
import { sendJsonPayload } from '../http/sendJsonPayload.ts';

export type GraphRoutesDeps = {
  rootDir: string;
  fallbackCommunityLabel: () => string;
  language: () => string;
  workspaceNameFromEnv: () => string | null;
  /**
   * Complétion LLM, injectée par `serve` qui seul détient la configuration.
   * Absente quand aucun LLM n'est configuré : la fiche de contexte rend alors
   * un extrait plutôt que rien.
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
 Un seul diffuseur par processus Serve.

 `/api/graph/events` est une route DIRECTE, pas un proxy vers un service amont
 comme `/api/runtime/events` : Serve est l'origine du flux. Le shell l'ouvre sur
 la même origine puis relaie les révisions à son iframe par postMessage, et
 `/graph` autonome l'ouvre directement — une connexion par document, jamais une
 par panneau.
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
      fallbackCommunityLabel: deps.fallbackCommunityLabel(),
      language: deps.language(),
    });

  if (req.method === 'GET' && urlPath === '/api/graph/events') {
    graphEventHub(() => deps.rootDir).subscribe(req, res);
    return true;
  }

  if (req.method === 'GET' && urlPath === '/api/graph/overview') {
    // La seule route dont la charge repart en entier à chaque révision : c'est
    // celle qui justifie la compression, et la seule à en avoir besoin.
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
