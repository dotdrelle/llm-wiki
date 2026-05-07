import { describe, expect, it } from 'vitest';
import { LLMService } from '../src/services/llmService.ts';
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

  it('rewrites provider billing errors into an actionable message', async () => {
    const service = new LLMService(createConfig());
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
  });
});
