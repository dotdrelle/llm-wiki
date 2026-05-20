import { afterEach, describe, expect, it } from 'vitest';
import { LLMService } from '../src/services/llmService.ts';
import {
  providerRateLimitRetryDelayMs,
  resetProviderRateLimiterForTests,
} from '../src/services/rateLimiter.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.com/v1',
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
        enabled: false,
        baseUrl: 'https://api.anthropic.com/v1',
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

function createOpenAIConfig(): AppConfig {
  return {
    ...createConfig(),
    llm: {
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
  };
}

describe('llm service', () => {
  afterEach(() => {
    resetProviderRateLimiterForTests();
    delete process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS;
    delete process.env.LLM_WIKI_RATE_LIMIT_RETRY_MS;
    delete process.env.LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS;
    delete process.env.LLM_WIKI_RATE_LIMIT_RETRY_SAFETY_MS;
  });

  it('omits temperature for OpenAI GPT-5 models', async () => {
    const service = new LLMService(createOpenAIConfig());
    let capturedParams: Record<string, unknown> | undefined;

    (
      service as unknown as {
        client: {
          chat: {
            completions: {
              create: (
                params: Record<string, unknown>,
              ) => Promise<AsyncIterable<unknown>>;
            };
          };
        };
      }
    ).client = {
      chat: {
        completions: {
          create: async (params) => {
            capturedParams = params;
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: '{}' } }] };
                yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } };
              },
            };
          },
        },
      },
    };

    await service.completeText({
      system: 'You are a test.',
      user: 'Return JSON.',
      temperature: 0,
    });

    expect(capturedParams).not.toHaveProperty('temperature');
  });

  it('captures Anthropic-shaped streaming usage without stream_options', async () => {
    const service = new LLMService(createConfig());
    let capturedParams: Record<string, unknown> | undefined;
    let capturedUsage: unknown;

    (
      service as unknown as {
        client: {
          chat: {
            completions: {
              create: (
                params: Record<string, unknown>,
              ) => Promise<AsyncIterable<unknown>>;
            };
          };
        };
      }
    ).client = {
      chat: {
        completions: {
          create: async (params) => {
            capturedParams = params;
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: '{}' } }] };
                yield { choices: [], usage: { input_tokens: 12, output_tokens: 3 } };
              },
            };
          },
        },
      },
    };

    await service.completeText({
      system: 'You are a test.',
      user: 'Return JSON.',
      onUsage: (usage) => {
        capturedUsage = usage;
      },
    });

    expect(capturedParams).not.toHaveProperty('stream_options');
    expect(capturedUsage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('throttles LLM request starts using requestsPerMinute', async () => {
    process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS = '50';
    const service = new LLMService({
      ...createConfig(),
      llm: {
        ...createConfig().llm,
        model: `test-throttle-${Date.now()}`,
      },
      limits: {
        ...createConfig().limits,
        requestsPerMinute: 1,
      },
    });
    const starts: number[] = [];

    (
      service as unknown as {
        client: {
          chat: {
            completions: {
              create: (
                params: Record<string, unknown>,
              ) => Promise<AsyncIterable<unknown>>;
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

    try {
      await service.completeText({ system: 's', user: 'u' });
      await service.completeText({ system: 's', user: 'u' });
    } finally {
      delete process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS;
    }

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(45);
  });

  it('uses the rate limit window as the 429 retry fallback', () => {
    process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS = '60';

    expect(
      providerRateLimitRetryDelayMs({
        key: `test-retry-fallback-${Date.now()}`,
        source: { headers: {} },
      }),
    ).toBe(60);
  });

  it('waits and retries once after an HTTP 429 response', async () => {
    process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS = '20';
    process.env.LLM_WIKI_RATE_LIMIT_RETRY_MS = '20';
    process.env.LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS = '2';
    process.env.LLM_WIKI_RATE_LIMIT_RETRY_SAFETY_MS = '1';
    const service = new LLMService({
      ...createConfig(),
      llm: {
        ...createConfig().llm,
        model: `test-429-retry-${Date.now()}`,
      },
    });
    const starts: number[] = [];

    (
      service as unknown as {
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
            if (starts.length === 1) {
              throw Object.assign(new Error('10 requests per minute exceeded'), {
                status: 429,
                headers: {},
              });
            }
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: 'ok' } }] };
              },
            };
          },
        },
      },
    };

    await expect(service.completeText({ system: 's', user: 'u' })).resolves.toBe('ok');
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(15);
  });

  it('rewrites provider billing errors into an actionable message', async () => {
    process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS = '20';
    const service = new LLMService({
      ...createConfig(),
      llm: {
        ...createConfig().llm,
        model: `test-billing-${Date.now()}`,
      },
    });
    const creditError = Object.assign(
      new Error('Your credit balance is too low to access the Anthropic API.'),
      {
        status: 400,
        requestID: 'req_test_123',
        code: 'invalid_request_error',
        type: 'invalid_request_error',
        error: {
          message: 'Your credit balance is too low to access the Anthropic API.',
        },
      },
    );

    (
      service as unknown as {
        client: {
          chat: {
            completions: {
              create: () => Promise<never>;
            };
          };
        };
      }
    ).client = {
      chat: {
        completions: {
          create: async () => {
            throw creditError;
          },
        },
      },
    };

    try {
      await expect(
        service.completeText({
          system: 'You are a test.',
          user: 'Return JSON.',
        }),
      ).rejects.toThrow(/out of credits or quota/i);

      await expect(
        service.completeText({
          system: 'You are a test.',
          user: 'Return JSON.',
        }),
      ).rejects.toThrow(/req_test_123/i);
    } finally {
      delete process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS;
    }
  });
});
