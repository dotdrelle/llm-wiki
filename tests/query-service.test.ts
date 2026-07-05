import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/services/queryService.ts';
import type { AppConfig, SearchResult } from '../src/types.ts';

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
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
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
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

describe('query service', () => {
  it('queries wiki pages without raw/ingested fallback', async () => {
    let includeRaw: boolean | undefined;
    const service = new QueryService(
      createConfig(),
      {
        ensureInitialized: async () => undefined,
        loadProfileSection: async () => '',
      } as any,
      { completeText: async () => 'answer' } as any,
      {
        search: async (_question: string, options: { includeRaw?: boolean }) => {
          includeRaw = options.includeRaw;
          return [] satisfies SearchResult[];
        },
      } as any,
    );

    await service.query('question');

    expect(includeRaw).toBe(false);
  });
});
