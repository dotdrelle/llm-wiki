import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { afterEach, describe, it, vi } from 'vitest';

import { handleConnectorsOAuthRoutes } from '../src/serve/routes/connectorsOAuthRoutes.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseRecorder() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

const readRequestBuffer = async (req: Readable, maxBytes = Number.POSITIVE_INFINITY) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const sendJson = (res: ReturnType<typeof responseRecorder>, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

describe('connectors OAuth serve proxy', () => {
  it('protects start and injects the active workspace plus internal bearer', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { ok: true, authorizationUrl: 'https://accounts.google.test/auth' },
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const req = Readable.from([
      JSON.stringify({ workspace: 'attacker-workspace', instanceId: 'google-2' }),
    ]);
    Object.assign(req, {
      method: 'POST',
      headers: {
        host: 'wiki.example.test',
        origin: 'https://wiki.example.test',
        'x-llm-wiki-oauth': '1',
      },
    });
    const res = responseRecorder();
    const handled = await handleConnectorsOAuthRoutes(
      req as never,
      res as never,
      '/api/connectors/google/oauth/start',
      {
        connectorUrl: () => 'http://host.docker.internal:3338/',
        oauthStartToken: () => 'start-secret',
        workspaceName: () => 'active-workspace',
        readRequestBuffer: readRequestBuffer as never,
        sendJson: sendJson as never,
      },
    );

    assert.equal(handled, true);
    assert.equal(res.status, 200);
    assert.equal(fetchMock.mock.calls.length, 1);
    const [target, init] = fetchMock.mock.calls[0]!;
    assert.equal(
      target,
      'http://host.docker.internal:3338/oauth/google/start',
    );
    assert.deepEqual(init?.headers, {
      authorization: 'Bearer start-secret',
      'content-type': 'application/json',
    });
    assert.deepEqual(JSON.parse(String(init?.body)), {
      workspace: 'active-workspace',
      instanceId: 'google-2',
    });
  });

  it('rejects cross-origin or unmarked OAuth start requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = Readable.from(['{}']);
    Object.assign(req, {
      method: 'POST',
      headers: {
        host: 'wiki.example.test',
        origin: 'https://evil.example.test',
        'x-llm-wiki-oauth': '1',
      },
    });
    const res = responseRecorder();
    await handleConnectorsOAuthRoutes(
      req as never,
      res as never,
      '/api/connectors/google/oauth/start',
      {
        connectorUrl: () => 'http://connectors:3338',
        oauthStartToken: () => 'secret',
        workspaceName: () => 'demo',
        readRequestBuffer: readRequestBuffer as never,
        sendJson: sendJson as never,
      },
    );
    assert.equal(res.status, 403);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it('rejects OAuth start requests without an Origin header', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = Readable.from(['{}']);
    Object.assign(req, {
      method: 'POST',
      headers: {
        host: 'wiki.example.test',
        'x-llm-wiki-oauth': '1',
      },
    });
    const res = responseRecorder();
    await handleConnectorsOAuthRoutes(
      req as never,
      res as never,
      '/api/connectors/google/oauth/start',
      {
        connectorUrl: () => 'http://connectors:3338',
        oauthStartToken: () => 'secret',
        workspaceName: () => 'demo',
        readRequestBuffer: readRequestBuffer as never,
        sendJson: sendJson as never,
      },
    );
    assert.equal(res.status, 403);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it('forwards the callback query byte-for-byte without reconstructing redirect_uri', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
      new Response('<h1>Google connected</h1>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'",
          'x-content-type-options': 'nosniff',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const req = Readable.from([]);
    Object.assign(req, {
      method: 'GET',
      url: '/oauth/google/callback?code=a%2Bb&state=signed.value',
      headers: {
        host: 'public.example.test',
        'x-forwarded-host': 'ignored.example.test',
      },
    });
    const res = responseRecorder();
    const handled = await handleConnectorsOAuthRoutes(
      req as never,
      res as never,
      '/oauth/google/callback',
      {
        connectorUrl: () => 'http://connectors.internal:3338',
        oauthStartToken: () => null,
        workspaceName: () => 'demo',
        readRequestBuffer: readRequestBuffer as never,
        sendJson: sendJson as never,
      },
    );

    assert.equal(handled, true);
    assert.equal(fetchMock.mock.calls[0]?.[0],
      'http://connectors.internal:3338/oauth/google/callback?code=a%2Bb&state=signed.value');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-security-policy'], "default-src 'none'");
    assert.equal(res.body, '<h1>Google connected</h1>');
  });
});
