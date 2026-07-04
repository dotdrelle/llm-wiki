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
  externalMcpEndpoints: ExternalMcpEndpoint[];
  mcpWikiPort: () => string;
  mcpProductionPort: () => string;
  proxyPost: ProxyPost;
};

export async function handleMcpRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: McpRoutesDeps,
): Promise<boolean> {
  if (req.method !== 'POST' || urlPath !== '/api/mcp') return false;

  const target =
    new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? '';
  if (!target) {
    res.writeHead(400);
    res.end('url param required');
    return true;
  }
  const { wikiTarget, productionTarget } = resolveMcpTargets(
    deps.mcpWikiPort,
    deps.mcpProductionPort,
  );
  const normalizeTarget = (u: string) => u.replace(/\/+$/, '');
  const normalizedTarget = normalizeTarget(target);
  let headers: Record<string, string> = {};
  if (normalizedTarget === normalizeTarget(wikiTarget)) {
    headers = deps.mcpAccessKey() ? { authorization: `Bearer ${deps.mcpAccessKey()}` } : {};
  } else if (normalizedTarget === normalizeTarget(productionTarget)) {
    headers = process.env.PRODUCTION_MCP_AUTH_TOKEN
      ? { authorization: `Bearer ${process.env.PRODUCTION_MCP_AUTH_TOKEN}` }
      : {};
  } else {
    const endpoint = deps.externalMcpEndpoints.find(
      (candidate) => normalizeTarget(candidate.url) === normalizedTarget,
    );
    if (endpoint) headers = endpoint.headers;
  }
  await deps.proxyPost(
    req,
    res,
    target,
    headers,
    { retryNetwork: true },
  );
  return true;
}
