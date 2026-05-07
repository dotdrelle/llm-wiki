import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../types.ts';
import { checkMcpAccessKey, createWikiMcpServer } from '../services/mcpServer.ts';
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
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = await createWikiMcpServer(config);
  await server.connect(transport);

  const listener = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `${tls ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== endpointPath) {
        reject(res, 404, 'Not found');
        return;
      }

      if (!checkMcpAccessKey(config, bearerToken(req))) {
        reject(res, 401, 'invalid or missing bearer token');
        return;
      }

      await transport.handleRequest(req, res);
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
