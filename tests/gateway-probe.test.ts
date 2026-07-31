import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGatewayCatalog, probeRerank } from '../src/services/gatewayProbe.ts';
import type { AppConfig } from '../src/types.ts';

/**
 * Sondage gateway pour `wiki doctor` — plan-implementation-engine-gateway.md,
 * commit 8.
 *
 * L'invariant testé est la dégradation gracieuse : `/model/info` (typé) →
 * `/v1/models` (non typé) → indisponible. Jamais un défaut inventé en silence.
 */

function gatewayConfig(overrides: Partial<AppConfig['retrieval']['vector']> = {}): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider: 'ai-gateway',
      engine: 'generic',
      model: 'anthropic/claude-sonnet-4-5',
      apiKey: 'sk-virtual',
      baseUrl: 'http://gateway:4000/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 60,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: { refreshOnIngest: false, maxBuildContextChars: 12000 },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: true,
        baseUrl: 'http://gateway:4000/v1',
        apiKey: 'sk-virtual',
        timeoutMs: 600000,
        embeddingModel: 'infinity/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'infinity/bge-reranker',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
        ...overrides,
      },
    },
    mcp: {},
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errorResponse(status: number) {
  return { ok: false, status } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalogue de la gateway', () => {
  it('lit les modes et les fenêtres de contexte depuis /model/info', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('http://gateway:4000/model/info');
      return jsonResponse({
        data: [
          {
            model_name: 'anthropic/claude-sonnet-4-5',
            model_info: { mode: 'chat', max_input_tokens: 200000 },
          },
          { model_name: 'infinity/bge-m3', model_info: { mode: 'embedding' } },
        ],
      });
    });

    const catalog = await fetchGatewayCatalog(gatewayConfig());
    expect(catalog?.typed).toBe(true);
    expect(catalog?.source).toBe('model-info');
    expect(catalog?.byName.get('anthropic/claude-sonnet-4-5')).toMatchObject({
      mode: 'chat',
      maxInputTokens: 200000,
    });
  });

  it('dégrade vers /v1/models sans mode ni fenêtre', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/model/info')) return errorResponse(404);
      return jsonResponse({ data: [{ id: 'openai/gpt-4.1-mini' }] });
    });

    const catalog = await fetchGatewayCatalog(gatewayConfig());
    expect(catalog?.typed).toBe(false);
    expect(catalog?.source).toBe('models');
    expect(catalog?.byName.get('openai/gpt-4.1-mini')?.maxInputTokens).toBeUndefined();
  });

  it('renvoie undefined quand la gateway est injoignable, sans inventer de modèles', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await fetchGatewayCatalog(gatewayConfig())).toBeUndefined();
  });
});

describe('sondage du rerank', () => {
  it('confirme un endpoint présent', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('http://gateway:4000/v1/rerank');
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'infinity/bge-reranker',
        top_n: 1,
      });
      return jsonResponse({ results: [] });
    });
    expect(await probeRerank(gatewayConfig())).toEqual({ status: 'ok' });
  });

  it.each([404, 405, 501])('conclut à une absence sur HTTP %s', async (status) => {
    vi.stubGlobal('fetch', async () => errorResponse(status));
    expect((await probeRerank(gatewayConfig())).status).toBe('unsupported');
  });

  it.each([400, 401, 429, 500])(
    'ne conclut pas à une absence sur HTTP %s — l’endpoint existe, le problème est ailleurs',
    async (status) => {
      vi.stubGlobal('fetch', async () => errorResponse(status));
      expect((await probeRerank(gatewayConfig())).status).toBe('unknown');
    },
  );

  it('reste prudent quand la requête échoue', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('timeout');
    });
    const result = await probeRerank(gatewayConfig());
    expect(result.status).toBe('unknown');
  });
});
