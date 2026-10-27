import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveMcpTargets, type ExternalMcpEndpoint } from './uploadRoutes.ts';

type ProxyPost = (
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    write: (c: Uint8Array) => void;
    end: () => void;
    headersSent?: boolean;
  },
  targetUrl: string,
  extraHeaders?: Record<string, string>,
  options?: { retry429?: boolean; retryNetwork?: boolean },
) => Promise<void>;

type McpRoutesDeps = {
  mcpAccessKey: () => string | undefined;
  /** Re-read per request: a connector the runtime just wrote must be reachable at once. */
  externalMcpEndpoints: () => Promise<ExternalMcpEndpoint[]>;
  mcpWikiPort: () => string;
  mcpProductionPort: () => string;
  proxyPost: ProxyPost;
};

export const BUILTIN_MCP_NAMES = { wiki: 'llm-wiki', production: 'wiki-production' } as const;

/*
 * The browser names a connector; it never supplies a URL. The relay used to
 * take `?url=` and POST anywhere serve could reach — the host through
 * host.docker.internal, the Docker network, the LAN, a metadata endpoint — and
 * hand the answer back. Now the only targets are the two workspace servers and
 * the endpoints declared in mcp.endpoints.json, and their credentials are added
 * here: the browser's own Authorization header is never forwarded.
 */
export async function handleMcpRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: McpRoutesDeps,
): Promise<boolean> {
  if (req.method !== 'POST' || urlPath !== '/api/mcp') return false;

  const name = (new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '').trim();
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('name param required');
    return true;
  }
  const { wikiTarget, productionTarget } = resolveMcpTargets(deps.mcpWikiPort, deps.mcpProductionPort);
  let target: { url: string; headers: Record<string, string> } | null = null;
  if (name === BUILTIN_MCP_NAMES.wiki) {
    const key = deps.mcpAccessKey();
    target = { url: wikiTarget, headers: key ? { authorization: `Bearer ${key}` } : {} };
  } else if (name === BUILTIN_MCP_NAMES.production) {
    const token = process.env.PRODUCTION_MCP_AUTH_TOKEN;
    target = { url: productionTarget, headers: token ? { authorization: `Bearer ${token}` } : {} };
  } else {
    const endpoint = (await deps.externalMcpEndpoints()).find((candidate) => candidate.name === name);
    if (endpoint) target = { url: endpoint.url, headers: endpoint.headers };
  }
  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Unknown MCP connector: ${name}. Add it from the Connectors panel (saved by the runtime) or in mcp.endpoints.json.`);
    return true;
  }
  await deps.proxyPost(req, res, target.url, target.headers, { retryNetwork: true });
  return true;
}
