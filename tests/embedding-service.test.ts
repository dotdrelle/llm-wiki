import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingService } from '../src/services/embeddingService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      temperature: 0.1,
      timeoutMs: 600000,
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
      vector: {
        enabled: true,
        embeddingModel: 'BAAI/bge-m3',
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

describe('embedding service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves embedding order from response indexes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              { index: 1, embedding: [2, 2] },
              { index: 0, embedding: [1, 1] },
            ],
          }),
      })),
    );

    await expect(new EmbeddingService(createConfig()).embed(['a', 'b'])).resolves.toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('rejects incomplete embedding responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ index: 0, embedding: [1, 1] }],
          }),
      })),
    );

    await expect(new EmbeddingService(createConfig()).embed(['a', 'b'])).rejects.toThrow(
      /returned 1 vector\(s\) for 2 input\(s\)/,
    );
  });
});
