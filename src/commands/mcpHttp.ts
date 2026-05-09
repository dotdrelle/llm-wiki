import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../types.ts';
import {
  WIKI_MCP_TOOLS,
  checkMcpAccessKey,
  createWikiMcpServer,
} from '../services/mcpServer.ts';
import { resolveInside } from '../utils/path.ts';

interface McpHttpOptions {
  host?: string;
  port?: number;
  path?: string;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1];
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

function renderLandingPage(config: AppConfig, endpointUrl: string, scheme: string): string {
  const authStatus = config.mcp.accessKey
    ? 'Bearer token required'
    : 'Warning: mcp.accessKey is not configured; the endpoint accepts unauthenticated clients.';
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
    <p class="lead">This endpoint is intended for MCP clients such as Claude, Claude Code, and OpenWebUI. Browsers can view this status page; MCP clients should POST JSON-RPC requests to the same URL.</p>
    <section class="panel">
      <dl>
        <dt>Status</dt><dd>Ready</dd>
        <dt>Endpoint</dt><dd><code>${escapeHtml(endpointUrl)}</code></dd>
        <dt>Transport</dt><dd>${scheme === 'https' ? 'HTTPS' : 'HTTP'} Streamable HTTP</dd>
        <dt>Authentication</dt><dd>${escapeHtml(authStatus)}</dd>
        <dt>Workspace</dt><dd><code>${escapeHtml(config.wikiRoot)}</code></dd>
      </dl>
    </section>
    <section class="panel">
      <h2>Available tools</h2>
      <ul>${tools}</ul>
      <p class="note">Only the canonical <code>wiki_*</code> tools are exposed. Recommended question-answering flow: call <code>wiki_search_context</code>, then read selected files with <code>wiki_read_many</code>, then let the client answer from that context.</p>
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

  const listener = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `${tls ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`);
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

      if (!checkMcpAccessKey(config, bearerToken(req))) {
        reject(res, 401, 'invalid or missing bearer token');
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

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = await createWikiMcpServer(config);
      await server.connect(transport);
      await transport.handleRequest(req, res);
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

  const httpServer = tls
    ? createHttpsServer(tls, listener)
    : createServer(listener);

  httpServer.listen(port, host, () => {
    const scheme = tls ? 'https' : 'http';
    console.log(`wiki mcp-http -> ${scheme}://${host}:${port}${endpointPath}`);
    if (!config.mcp.accessKey) {
      console.log('Warning: mcp.accessKey is not configured; the endpoint accepts unauthenticated clients.');
    }
  });
}
