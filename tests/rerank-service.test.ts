import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetProviderRateLimiterForTests } from '../src/services/rateLimiter.ts';
import { RerankService } from '../src/services/rerankService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: true,
      slotBatchSize: 5,
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: true,
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

describe('rerank service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetProviderRateLimiterForTests();
  });

  it('caches rerank results persistently when cache directory is provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-root-'));
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-cache-'));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const config = createConfig(root);
    const first = await new RerankService(config, undefined, cacheDir).rerank(
      'architecture',
      ['old decision', 'new decision'],
      2,
    );
    const second = await new RerankService(config, undefined, cacheDir).rerank(
      'architecture',
      ['old decision', 'new decision'],
      2,
    );

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('splits rerank requests above the provider batch limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-root-'));
    const requestSizes: number[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        documents?: string[];
      };
      const documents = body.documents ?? [];
      requestSizes.push(documents.length);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            results: documents.map((_, index) => ({
              index,
              relevance_score: index,
            })),
          }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const documents = Array.from({ length: 66 }, (_, index) => `document ${index}`);
    const results = await new RerankService(createConfig(root)).rerank(
      'architecture',
      documents,
      66,
    );

    expect(requestSizes).toEqual([64, 2]);
    expect(results.slice(0, 3)).toEqual([
      { index: 63, score: 63 },
      { index: 62, score: 62 },
      { index: 61, score: 61 },
    ]);
    expect(results).toContainEqual({ index: 65, score: 1 });
  });
});
