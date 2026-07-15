import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../types.ts';
import {
  WIKI_MCP_TOOLS,
  createWikiMcpServices,
  createWikiMcpServer,
  type WikiMcpServices,
} from '../services/mcpServer.ts';
import { pruneWindowTimestamps } from '../services/rateLimiter.ts';
import { resolveInside } from '../utils/path.ts';

interface McpHttpOptions {
  host?: string;
  port?: number;
  path?: string;
}

type McpScope = 'read' | 'write';
const WRITE_MCP_TOOLS = new Set(['wiki_write_page', 'wiki_add_source', 'profile_update']);

interface SharedMcpContext {
  key: string;
  services: WikiMcpServices;
  createdAt: number;
}

const sharedMcpContexts = new Map<string, SharedMcpContext>();

function bearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1];
}

function constantTimeEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function mcpToolScope(toolName: string | undefined): McpScope {
  return toolName && WRITE_MCP_TOOLS.has(toolName) ? 'write' : 'read';
}

export function hasAnyMcpToken(config: AppConfig): boolean {
  return Boolean(config.mcp.accessKey || config.mcp.readToken || config.mcp.writeToken);
}

export function mcpScopesForToken(
  config: AppConfig,
  token: string | undefined,
): McpScope[] | null {
  if (!hasAnyMcpToken(config)) return ['read', 'write'];
  if (constantTimeEqual(token, config.mcp.accessKey)) return ['read', 'write'];
  if (constantTimeEqual(token, config.mcp.writeToken)) return ['read', 'write'];
  if (constantTimeEqual(token, config.mcp.readToken)) return ['read'];
  return null;
}

function requiredScopeForJsonRpc(body: unknown): McpScope {
  const calls = Array.isArray(body) ? body : [body];
  return calls.some((call) => {
    const method =
      typeof call === 'object' && call !== null && 'method' in call
        ? String((call as { method?: unknown }).method ?? '')
        : '';
    const params =
      typeof call === 'object' && call !== null && 'params' in call
        ? (call as { params?: unknown }).params
        : null;
    const toolName =
      typeof params === 'object' && params !== null && 'name' in params
        ? String((params as { name?: unknown }).name ?? '')
        : '';
    return method === 'tools/call' && mcpToolScope(toolName) === 'write';
  })
    ? 'write'
    : 'read';
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createMcpRateLimiter({
  limit = Number(process.env.WIKI_MCP_RATE_LIMIT_REQUESTS ?? 120),
  windowMs = Number(process.env.WIKI_MCP_RATE_LIMIT_WINDOW_MS ?? 60_000),
} = {}) {
  const buckets = new Map<string, number[]>();
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 120;
  const safeWindowMs =
    Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : 60_000;
  return {
    check(key: string, now = Date.now()) {
      const bucket = pruneWindowTimestamps(buckets.get(key) ?? [], now, safeWindowMs);
      if (bucket.length >= safeLimit) {
        buckets.set(key, bucket);
        const retryAfterMs = Math.max(1, safeWindowMs - (now - bucket[0]));
        return { ok: false, retryAfterMs };
      }
      bucket.push(now);
      buckets.set(key, bucket);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

function rateLimitKey(req: IncomingMessage, token: string | undefined): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  return token ? `token:${token}` : `ip:${ip}`;
}

function sharedContextTtlMs(): number {
  const value = Number(process.env.WIKI_MCP_CONTEXT_TTL_MS ?? 30_000);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 30_000;
}

export function mcpServiceContextKey(config: AppConfig): string {
  return JSON.stringify({
    wikiRoot: path.resolve(config.wikiRoot),
    configPath: config.configPath ? path.resolve(config.configPath) : null,
    language: config.language,
    retrieval: {
      maxContextFiles: config.retrieval.maxContextFiles,
      maxChunksPerPage: config.retrieval.maxChunksPerPage,
      maxChunkChars: config.retrieval.maxChunkChars,
      maxSourceChars: config.retrieval.maxSourceChars,
      vector: {
        enabled: config.retrieval.vector.enabled,
        baseUrl: config.retrieval.vector.baseUrl,
        embeddingModel: config.retrieval.vector.embeddingModel,
        rerankEnabled: config.retrieval.vector.rerankEnabled,
        rerankerModel: config.retrieval.vector.rerankerModel,
        topK: config.retrieval.vector.topK,
        rerankTopK: config.retrieval.vector.rerankTopK,
        maxResults: config.retrieval.vector.maxResults,
      },
    },
  });
}

export async function getSharedMcpServices(
  config: AppConfig,
  now = Date.now(),
): Promise<WikiMcpServices> {
  const key = mcpServiceContextKey(config);
  const ttlMs = sharedContextTtlMs();
  const existing = sharedMcpContexts.get(key);
  if (existing && (ttlMs === 0 || now - existing.createdAt <= ttlMs)) {
    return existing.services;
  }
  const services = await createWikiMcpServices(config);
  sharedMcpContexts.set(key, { key, services, createdAt: now });
  return services;
}

export function clearSharedMcpServices(): void {
  sharedMcpContexts.clear();
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify({ error: message }));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function wantsHtml(req: IncomingMessage): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html') || accept.includes('*/*');
}

function renderLandingPage(
  config: AppConfig,
  endpointUrl: string,
  scheme: string,
): string {
  const authStatus = hasAnyMcpToken(config)
    ? 'Bearer token enabled'
    : 'Warning: mcp.accessKey is not configured; the endpoint accepts unauthenticated clients.';
  const workspaceStatus = hasAnyMcpToken(config)
    ? 'Protected workspace'
    : config.wikiRoot;
  const tools = WIKI_MCP_TOOLS.map(
    (tool) =>
      `<li><code>${escapeHtml(tool.name)}</code><span>${escapeHtml(tool.description)}</span></li>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>llm-wiki MCP connector</title>
  <style>
    :root { color-scheme: light dark; --bg: #f8fafc; --panel: #ffffff; --text: #111827; --muted: #64748b; --line: #d8dee8; --accent: #2563eb; --code: #eef2ff; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --panel: #111827; --text: #f8fafc; --muted: #94a3b8; --line: #253044; --accent: #60a5fa; --code: #1e293b; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0; }
    .eyebrow { color: var(--accent); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; }
    h1 { margin: 8px 0 10px; font-size: clamp(32px, 6vw, 52px); line-height: 1.05; letter-spacing: 0; }
    .lead { margin: 0 0 28px; color: var(--muted); max-width: 720px; font-size: 17px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 22px; margin: 18px 0; }
    dl { display: grid; grid-template-columns: 150px 1fr; gap: 10px 18px; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    code { background: var(--code); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    li { display: grid; grid-template-columns: minmax(170px, 240px) 1fr; gap: 14px; align-items: start; padding: 12px 0; border-top: 1px solid var(--line); }
    li:first-child { border-top: 0; padding-top: 0; }
    li span { color: var(--muted); }
    .note { color: var(--muted); margin: 12px 0 0; }
    @media (max-width: 640px) { dl, li { grid-template-columns: 1fr; } main { padding: 32px 0; } }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">MCP Streamable HTTP</div>
    <h1>llm-wiki MCP connector</h1>
    <p class="lead">This endpoint is intended for MCP clients such as Claude and Claude Code. Browsers can view this status page; MCP clients should POST JSON-RPC requests to the same URL.</p>
    <section class="panel">
      <dl>
        <dt>Status</dt><dd>Ready</dd>
        <dt>Endpoint</dt><dd><code>${escapeHtml(endpointUrl)}</code></dd>
        <dt>Transport</dt><dd>${scheme === 'https' ? 'HTTPS' : 'HTTP'} Streamable HTTP</dd>
        <dt>Authentication</dt><dd>${escapeHtml(authStatus)}</dd>
        <dt>Workspace</dt><dd><code>${escapeHtml(workspaceStatus)}</code></dd>
      </dl>
    </section>
    <section class="panel">
      <h2>Available tools</h2>
      <ul>${tools}</ul>
      <p class="note">Only the canonical <code>wiki_*</code> tools are exposed. For synthesis-style answers, start with <code>wiki_collect_context</code>, use <code>readPages</code> as primary evidence, and call search/read tools again if coverage is insufficient.</p>
    </section>
  </main>
</body>
</html>`;
}

async function tlsOptions(config: AppConfig): Promise<
  | {
      cert: Buffer;
      key: Buffer;
      ca?: Buffer;
    }
  | undefined
> {
  const { certPath, keyPath, caPath } = config.mcp.tls ?? {};
  if (!certPath && !keyPath && !caPath) return undefined;
  if (!certPath || !keyPath) {
    throw new Error('mcp.tls.certPath and mcp.tls.keyPath must both be set for HTTPS.');
  }

  const resolveTlsPath = (value: string) =>
    path.isAbsolute(value) ? value : resolveInside(config.wikiRoot, value);

  const cert = await readFile(resolveTlsPath(certPath));
  const key = await readFile(resolveTlsPath(keyPath));
  const ca = caPath ? await readFile(resolveTlsPath(caPath)) : undefined;
  return ca ? { cert, key, ca } : { cert, key };
}

export default async function mcpHttpCmd(
  config: AppConfig,
  options: McpHttpOptions,
): Promise<void> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3333;
  const endpointPath = options.path ?? '/mcp';
  const tls = await tlsOptions(config);
  const rateLimiter = createMcpRateLimiter();

  const listener = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(
        req.url ?? '/',
        `${tls ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`,
      );
      const normalizedEndpointPath = endpointPath.endsWith('/')
        ? endpointPath.slice(0, -1)
        : endpointPath;
      const normalizedRequestPath = url.pathname.endsWith('/')
        ? url.pathname.slice(0, -1)
        : url.pathname;
      if (normalizedRequestPath !== normalizedEndpointPath) {
        reject(res, 404, 'Not found');
        return;
      }

      if (req.method === 'GET' && wantsHtml(req)) {
        const scheme = tls ? 'https' : 'http';
        const endpointUrl = `${scheme}://${req.headers.host ?? `${host}:${port}`}${endpointPath}`;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(renderLandingPage(config, endpointUrl, scheme));
        return;
      }

      const token = bearerToken(req);
      const scopes = mcpScopesForToken(config, token);
      if (!scopes) {
        reject(res, 401, 'invalid or missing bearer token');
        return;
      }
      const rate = rateLimiter.check(rateLimitKey(req, token));
      if (!rate.ok) {
        res.setHeader('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
        reject(res, 429, 'rate limit exceeded');
        return;
      }

      const body = await readRequestBody(req);
      let parsed: unknown = null;
      try {
        parsed = body.length > 0 ? JSON.parse(body.toString('utf8')) : null;
      } catch {
        reject(res, 400, 'invalid JSON-RPC request body');
        return;
      }
      const requiredScope = requiredScopeForJsonRpc(parsed);
      if (requiredScope === 'write' && !scopes.includes('write')) {
        reject(res, 403, 'token does not have write scope');
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const services = await getSharedMcpServices(config);
      const server = await createWikiMcpServer(config, services);
      await server.connect(transport);
      // Body was already consumed above to check scopes; handleRequest's
      // parsedBody param (its documented mechanism for exactly this case —
      // see server/streamableHttp.js) passes it through instead of
      // re-reading req's stream, which has already ended.
      await transport.handleRequest(req, res, parsed);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        reject(res, 500, error instanceof Error ? error.message : String(error));
      } else {
        res.end();
      }
    }
  };

  const httpServer = tls ? createHttpsServer(tls, listener) : createServer(listener);

  httpServer.listen(port, host, () => {
    const scheme = tls ? 'https' : 'http';
    console.log(`wiki mcp-http -> ${scheme}://${host}:${port}${endpointPath}`);
    if (!hasAnyMcpToken(config)) {
      console.log(
        'Warning: mcp.accessKey is not configured; the endpoint accepts unauthenticated clients.',
      );
    }
  });
}
