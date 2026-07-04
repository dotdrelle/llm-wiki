import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExternalMcpEndpoint } from './uploadRoutes.ts';

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
  const wikiTarget =
    process.env.WIKI_MCP_PROXY_URL ?? `http://localhost:${deps.mcpWikiPort()}/mcp`;
  const productionTarget =
    process.env.PRODUCTION_MCP_PROXY_URL ??
    `http://localhost:${deps.mcpProductionPort()}/mcp/`;
  const normalizeTarget = (u: string) => u.replace(/\/+$/, '');
  const proxyHeaders: Record<string, Record<string, string>> = {
    [normalizeTarget(wikiTarget)]: deps.mcpAccessKey()
      ? { authorization: `Bearer ${deps.mcpAccessKey()}` }
      : {},
    [normalizeTarget(productionTarget)]: process.env.PRODUCTION_MCP_AUTH_TOKEN
      ? { authorization: `Bearer ${process.env.PRODUCTION_MCP_AUTH_TOKEN}` }
      : {},
  };
  for (const endpoint of deps.externalMcpEndpoints) {
    proxyHeaders[normalizeTarget(endpoint.url)] = endpoint.headers;
  }
  const headers = proxyHeaders[normalizeTarget(target)] ?? {};
  await deps.proxyPost(
    req,
    res,
    target,
    headers,
    { retryNetwork: true },
  );
  return true;
}
