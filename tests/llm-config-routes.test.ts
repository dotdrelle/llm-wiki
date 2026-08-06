import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { afterEach, describe, it, vi } from 'vitest';

import { handleConfigRoutes } from '../src/serve/routes/configRoutes.ts';
import type { AppConfig } from '../src/types.ts';

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

const sendJson = (res: ReturnType<typeof responseRecorder>, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

function deps(llm: Partial<AppConfig['llm']> = {}, body = '') {
  return {
    config: {
      llm: {
        provider: 'ai-gateway',
        engine: 'generic',
        baseUrl: 'https://gateway.test/v1',
        apiKey: 'k',
        model: 'deepseek-v4-pro',
        temperature: 0.1,
        ...llm,
      },
    } as unknown as AppConfig,
    proxyDeps: {} as never,
    runtimePathForWorkspace: (p: string) => p,
    workspaceNameFromEnv: () => 'acpi',
    mirrorRuntimeConfig: async () => ({}) as AppConfig,
    readRequestBody: async () => body,
    sendJson,
  };
}

async function call(method: string, urlPath: string, dependencies: ReturnType<typeof deps>) {
  const res = responseRecorder();
  const req = Object.assign(Readable.from([]), { method, url: urlPath });
  const handled = await handleConfigRoutes(req as never, res as never, urlPath, dependencies as never);
  return { handled, res, payload: res.body ? JSON.parse(res.body) : null };
}

describe('temperature is owned by .wikirc, not by the session', () => {
  it('is never accepted as a session override', async () => {
    // The panel carried a field for it, prefilled from the same config and
    // defaulting to 0.7 against a schema default of 0.1. It could not be
    // persisted and had no effect on Donna at all — two sources for one
    // setting, one of which was decoration.
    const { payload } = await call(
      'PATCH',
      '/api/llm-config',
      deps({}, JSON.stringify({ model: 'm', temperature: 1.9, baseUrl: 'https://x.test/v1' })),
    );

    assert.equal(payload.ok, true);
    assert.equal('temperature' in payload.override, false);
    assert.equal(payload.override.model, 'm');
    assert.equal(payload.override.baseUrl, 'https://x.test/v1');
  });

  it('is still readable, because the fallback chat path needs it', async () => {
    const { payload } = await call('GET', '/api/llm-config', deps());
    assert.equal(payload.temperature, 0.1);
  });
});

describe('LLM endpoint probe', () => {
  it('reports a reachable endpoint and how many models it serves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ data: [{ model_name: 'deepseek-v4-pro' }, { model_name: 'other' }] }, { status: 200 }),
    ));

    const { handled, payload } = await call('POST', '/api/llm/probe', deps());

    assert.equal(handled, true);
    assert.equal(payload.ok, true);
    assert.equal(payload.models, 2);
    assert.equal(payload.warning, undefined);
  });

  it('names the model mismatch, the failure hardest to guess', async () => {
    // Reachable endpoint, wrong model: every request fails with a message that
    // looks like a connection problem. Saying it explicitly is the point.
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ data: [{ model_name: 'llama-3' }] }, { status: 200 }),
    ));

    const { payload } = await call('POST', '/api/llm/probe', deps());

    assert.equal(payload.ok, true);
    assert.match(payload.warning, /deepseek-v4-pro.*not in the 1 models/);
  });

  it('reports an unreachable endpoint without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const { res, payload } = await call('POST', '/api/llm/probe', deps());

    // 200 with ok:false, not a 5xx: the probe SUCCEEDED at answering the
    // question. The answer is just "no".
    assert.equal(res.status, 200);
    assert.equal(payload.ok, false);
    assert.equal(payload.reason, 'unreachable');
    assert.match(payload.message, /https:\/\/gateway\.test\/v1/);
  });

  it('says so plainly when nothing is configured', async () => {
    const { payload } = await call('POST', '/api/llm/probe', deps({ baseUrl: '' }));

    assert.equal(payload.ok, false);
    assert.equal(payload.reason, 'no-base-url');
  });

  it('spends no tokens: it reads the catalog, never a completion', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return Response.json({ data: [] }, { status: 200 });
    }));

    await call('POST', '/api/llm/probe', deps());

    assert.ok(urls.length > 0, 'la sonde doit bien appeler quelque chose');
    for (const url of urls) assert.doesNotMatch(url, /chat\/completions/);
  });
});
