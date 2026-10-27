import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { handleChatRoutes } from '../src/serve/routes/chatRoutes.ts';
import { handleMcpRoutes } from '../src/serve/routes/mcpRoutes.ts';
import type { AppConfig } from '../src/types.ts';

function responseRecorder() {
  return {
    status: 0,
    body: '',
    headersSent: false,
    writeHead(status: number) {
      this.status = status;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

function config(baseUrl: string): AppConfig {
  return { llm: { baseUrl, apiKey: 'configured-key' } } as unknown as AppConfig;
}

function postRequest(url: string, headers: Record<string, string> = {}) {
  return Object.assign(Readable.from([]), { method: 'POST', url, headers }) as unknown as IncomingMessage;
}

type Proxied = { url: string; headers: Record<string, string> };

function chatDeps(cfg: AppConfig, proxied: Proxied[]) {
  return {
    config: cfg,
    proxyPost: async (_req: IncomingMessage, _res: unknown, url: string, headers: Record<string, string>) => {
      proxied.push({ url, headers });
    },
    sendJson: (res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void }, status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    },
  };
}

describe('/api/chat target', () => {
  it('ignores browser override headers: the configured endpoint and key only', async () => {
    for (const target of ['https://attacker.example/v1', 'http://169.254.169.254/latest', 'http://127.0.0.1:11434/v1']) {
      const proxied: Proxied[] = [];
      const res = responseRecorder();
      await handleChatRoutes(
        postRequest('/api/chat', { 'x-llm-wiki-llm-base-url': target, 'x-llm-wiki-llm-api-key': 'browser-key' }),
        res as unknown as ServerResponse,
        '/api/chat',
        chatDeps(config('https://gateway.test/v1'), proxied) as never,
      );
      expect(proxied, target).toEqual([
        { url: 'https://gateway.test/v1/chat/completions', headers: { authorization: 'Bearer configured-key' } },
      ]);
    }
  });

  it('refuses plainly when no endpoint is configured', async () => {
    const proxied: Proxied[] = [];
    const res = responseRecorder();
    await handleChatRoutes(
      postRequest('/api/chat'),
      res as unknown as ServerResponse,
      '/api/chat',
      chatDeps({ llm: {} } as unknown as AppConfig, proxied) as never,
    );
    expect(res.status).toBe(400);
    expect(proxied).toHaveLength(0);
  });
});

describe('/api/mcp relay', () => {
  function mcpDeps(proxied: Proxied[]) {
    return {
      mcpAccessKey: () => 'wiki-key',
      externalMcpEndpoints: async () => [
        { name: 'exa', url: 'https://mcp.exa.example/mcp', headers: { authorization: 'Bearer exa-key' } },
      ],
      mcpWikiPort: () => '3333',
      mcpProductionPort: () => '8080',
      proxyPost: async (_req: IncomingMessage, _res: unknown, url: string, headers: Record<string, string> = {}) => {
        proxied.push({ url, headers });
      },
    };
  }

  it('targets a declared connector by name, with its server-side credentials', async () => {
    const proxied: Proxied[] = [];
    const res = responseRecorder();
    await handleMcpRoutes(postRequest('/api/mcp?name=exa'), res as unknown as ServerResponse, '/api/mcp', mcpDeps(proxied) as never);
    expect(proxied).toEqual([{ url: 'https://mcp.exa.example/mcp', headers: { authorization: 'Bearer exa-key' } }]);
  });

  it('reaches the built-in wiki server by its name', async () => {
    const proxied: Proxied[] = [];
    const res = responseRecorder();
    await handleMcpRoutes(postRequest('/api/mcp?name=llm-wiki'), res as unknown as ServerResponse, '/api/mcp', mcpDeps(proxied) as never);
    expect(proxied).toHaveLength(1);
    expect(proxied[0].headers).toEqual({ authorization: 'Bearer wiki-key' });
  });

  it('refuses an unknown name and no longer accepts a URL', async () => {
    for (const url of ['/api/mcp?name=nope', '/api/mcp?url=http%3A%2F%2F169.254.169.254%2F', '/api/mcp']) {
      const proxied: Proxied[] = [];
      const res = responseRecorder();
      const handled = await handleMcpRoutes(postRequest(url), res as unknown as ServerResponse, '/api/mcp', mcpDeps(proxied) as never);
      expect(handled, url).toBe(true);
      expect(res.status, url).toBeGreaterThanOrEqual(400);
      expect(proxied, url).toHaveLength(0);
    }
  });
});

describe('secrets never reach the page', () => {
  it('serializes no LLM key, no connector bearer and no credentials in the base URL', async () => {
    let html = '';
    const cfg = {
      llm: { provider: 'openai-compatible', model: 'm', baseUrl: 'https://user:pw@gateway.test/v1?api-key=q', apiKey: 'llm-secret-key' },
      limits: { maxProfileChars: 1000 },
      language: 'en',
    } as unknown as AppConfig;
    await handleChatRoutes(
      Object.assign(Readable.from([]), { method: 'GET', url: '/chat', headers: {} }) as unknown as IncomingMessage,
      responseRecorder() as unknown as ServerResponse,
      '/chat',
      {
        config: cfg,
        workspace: { paths: { internalDir: '/nonexistent/.wiki' }, loadProfileSection: async () => '' },
        externalMcpEndpoints: async () => [
          { name: 'exa', url: 'https://mcp.exa.example/mcp', headers: { authorization: 'Bearer exa-secret' }, bearer: 'exa-secret' },
        ],
        mcpWikiPort: () => '3333',
        mcpProductionPort: () => '8080',
        runtimeUrl: () => null,
        workspaceNameFromEnv: () => 'ws',
        rootDir: '/nonexistent',
        sendGzippedHtml: async (_req: unknown, _res: unknown, body: string) => { html = body; },
      } as never,
    );
    expect(html).toContain('window.__WIKI_CONFIG__');
    for (const secret of ['llm-secret-key', 'exa-secret', 'user:pw', 'api-key=q']) expect(html, secret).not.toContain(secret);
    expect(html).toContain('"hasApiKey":true');
    expect(html).toContain('"hasBearer":true');
  });
});

describe('upstream redirects', () => {
  it('are answered 502, never followed nor relayed', async () => {
    const { refuseUpstreamRedirect } = await import('../src/serve/proxy/refuseRedirect.ts');
    const res = responseRecorder();
    const refused = await refuseUpstreamRedirect(
      new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/' } }),
      'https://gateway.test/v1/chat/completions?key=secret',
      res as never,
    );
    expect(refused).toBe(true);
    expect(res.status).toBe(502);
    expect(res.body).not.toContain('169.254');
    expect(await refuseUpstreamRedirect(new Response('{}', { status: 200 }), 'https://x.test', responseRecorder() as never)).toBe(false);
  });
});
