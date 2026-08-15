import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { handleChatRoutes } from '../src/serve/routes/chatRoutes.ts';
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
    json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

function config(baseUrl: string): AppConfig {
  return {
    llm: {
      baseUrl,
      apiKey: 'configured-key',
    },
  } as unknown as AppConfig;
}

function chatRequest(overrideBaseUrl: string) {
  return Object.assign(Readable.from([]), {
    method: 'POST',
    headers: { 'x-llm-wiki-llm-base-url': overrideBaseUrl },
  }) as unknown as IncomingMessage;
}

function makeDeps(cfg: AppConfig, proxied: Array<{ url: string; headers?: Record<string, string> }>) {
  return {
    config: cfg,
    proxyPost: async (
      _req: IncomingMessage,
      _res: unknown,
      url: string,
      headers: Record<string, string>,
    ) => {
      proxied.push({ url, headers });
    },
    sendJson: (
      res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void },
      status: number,
      data: unknown,
    ) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    },
  };
}

describe('/api/chat LLM override SSRF guard', () => {
  it('rejects a cloud-metadata override target', async () => {
    const proxied: Array<{ url: string }> = [];
    const res = responseRecorder();
    const handled = await handleChatRoutes(
      chatRequest('http://169.254.169.254/latest/meta-data'),
      res as unknown as ServerResponse,
      '/api/chat',
      makeDeps(config('https://gateway.test/v1'), proxied) as never,
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(400);
    expect(proxied).toHaveLength(0);
  });

  it('rejects loopback and private literal targets', async () => {
    for (const target of [
      'http://127.0.0.1:11434/v1',
      'http://192.168.1.10/v1',
      'http://10.0.0.5/v1',
      'http://[::1]:8080/v1',
      'http://[fe80::1]/v1',
      'http://[fc00::1]/v1',
    ]) {
      const proxied: Array<{ url: string }> = [];
      const res = responseRecorder();
      await handleChatRoutes(
        chatRequest(target),
        res as unknown as ServerResponse,
        '/api/chat',
        makeDeps(config('https://gateway.test/v1'), proxied) as never,
      );
      expect(res.status, target).toBe(400);
      expect(proxied, target).toHaveLength(0);
    }
  });

  it('rejects internal hostname targets', async () => {
    for (const target of [
      'http://localhost:11434/v1',
      'http://foo.local/v1',
      'http://service.internal/v1',
      'http://metadata.google.internal/v1',
    ]) {
      const proxied: Array<{ url: string }> = [];
      const res = responseRecorder();
      await handleChatRoutes(
        chatRequest(target),
        res as unknown as ServerResponse,
        '/api/chat',
        makeDeps(config('https://gateway.test/v1'), proxied) as never,
      );
      expect(res.status, target).toBe(400);
      expect(proxied, target).toHaveLength(0);
    }
  });

  it('still proxies a public host override', async () => {
    const proxied: Array<{ url: string; headers: Record<string, string> }> = [];
    const res = responseRecorder();
    await handleChatRoutes(
      chatRequest('https://api.openai.com/v1'),
      res as unknown as ServerResponse,
      '/api/chat',
      makeDeps(config('https://gateway.test/v1'), proxied) as never,
    );

    expect(res.status).toBe(0);
    expect(proxied).toHaveLength(1);
    expect(proxied[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('allows a port/key tweak on the configured host', async () => {
    const proxied: Array<{ url: string }> = [];
    const res = responseRecorder();
    await handleChatRoutes(
      chatRequest('http://gateway.test:8080/v1'),
      res as unknown as ServerResponse,
      '/api/chat',
      makeDeps(config('http://gateway.test/v1'), proxied) as never,
    );

    expect(res.status).toBe(0);
    expect(proxied).toHaveLength(1);
    expect(proxied[0].url).toBe('http://gateway.test:8080/v1/chat/completions');
  });
});
