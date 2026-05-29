import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingService } from '../src/services/embeddingService.ts';
import { LLMService } from '../src/services/llmService.ts';
import { resetProviderRateLimiterForTests } from '../src/services/rateLimiter.ts';
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
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
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

describe('embedding service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetProviderRateLimiterForTests();
    delete process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS;
    delete process.env.LLM_WIKI_RATE_LIMIT_RETRY_MS;
    delete process.env.LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS;
    delete process.env.LLM_WIKI_RATE_LIMIT_RETRY_SAFETY_MS;
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

    await expect(new EmbeddingService(createConfig()).embed(['a', 'b'])).resolves.toEqual(
      [
        [1, 1],
        [2, 2],
      ],
    );
  });

  it('caches embeddings persistently when cache directory is provided', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embedding-cache-'));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: [{ index: 0, embedding: [1, 1] }],
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new EmbeddingService(createConfig(), undefined, cacheDir).embed(['a']),
    ).resolves.toEqual([[1, 1]]);
    await expect(
      new EmbeddingService(createConfig(), undefined, cacheDir).embed(['a']),
    ).resolves.toEqual([[1, 1]]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete embedding responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [],
          }),
      })),
    );

    await expect(new EmbeddingService(createConfig()).embed(['a'])).rejects.toThrow(
      /returned 0 vector\(s\) for 1 input/,
    );
  });

  it('splits failed embedding batches and preserves order', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string[] };
      const input = body.input ?? [];
      if (input.length > 1) {
        return {
          ok: false,
          status: 403,
          text: async (): Promise<string> => 'forbidden batch',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async (): Promise<string> =>
          JSON.stringify({
            data: [{ index: 0, embedding: [input[0].charCodeAt(0)] }],
          }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new EmbeddingService(createConfig()).embed(['a', 'b', 'c'])).resolves.toEqual(
      [[97], [98], [99]],
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('neutralizes path-like references when a single embedding input is rejected', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string[] };
      const input = body.input ?? [];
      if (input.some((item) => item.includes('raw/ingested/project/page.md'))) {
        return {
          ok: false,
          status: 403,
          text: async (): Promise<string> => 'forbidden input',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async (): Promise<string> =>
          JSON.stringify({
            data: [{ index: 0, embedding: [3, 3] }],
          }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new EmbeddingService(createConfig()).embed([
        'Reference [src: raw/ingested/project/page.md] avec contenu.',
      ]),
    ).resolves.toEqual([[3, 3]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body ?? '{}')) as {
      input: string[];
    };
    expect(retryBody.input[0]).toContain('[source]');
    expect(retryBody.input[0]).not.toContain('raw/ingested/project/page.md');
  });

  it('shares provider throttling with LLM requests for the same base URL', async () => {
    process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS = '50';
    const config: AppConfig = {
      ...createConfig(),
      limits: {
        ...createConfig().limits,
        requestsPerMinute: 1,
      },
    };
    const starts: number[] = [];
    const llm = new LLMService(config);

    (
      llm as unknown as {
        client: {
          chat: {
            completions: {
              create: () => Promise<AsyncIterable<unknown>>;
            };
          };
        };
      }
    ).client = {
      chat: {
        completions: {
          create: async () => {
            starts.push(Date.now());
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: 'ok' } }] };
              },
            };
          },
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              data: [{ index: 0, embedding: [1, 1] }],
            }),
        };
      }),
    );

    await llm.completeText({ system: 's', user: 'u' });
    await new EmbeddingService(config).embed(['a']);

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(45);
  });

  it('waits and retries embeddings after an HTTP 429 response', async () => {
    process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS = '20';
    process.env.LLM_WIKI_RATE_LIMIT_RETRY_MS = '20';
    process.env.LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS = '2';
    process.env.LLM_WIKI_RATE_LIMIT_RETRY_SAFETY_MS = '1';
    const starts: number[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        if (starts.length === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers(),
            text: async (): Promise<string> =>
              '{"detail":"10 requests per minute exceeded"}',
          };
        }
        return {
          ok: true,
          status: 200,
          text: async (): Promise<string> =>
            JSON.stringify({
              data: [{ index: 0, embedding: [1, 1] }],
            }),
        };
      }),
    );

    await expect(new EmbeddingService(createConfig()).embed(['a'])).resolves.toEqual([
      [1, 1],
    ]);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(15);
  });
});
