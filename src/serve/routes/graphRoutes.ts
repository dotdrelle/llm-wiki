import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { generateGraph, renderGraphDocument } from '../html/wikiHtml.ts';
import { loadWikiGraphSnapshot } from '../../graph/wiki/overview.ts';
import { graphDocumentSummary } from '../../graph/wiki/summary.ts';

export type GraphRoutesDeps = {
  rootDir: string;
  fallbackCommunityLabel: () => string;
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
    });

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
