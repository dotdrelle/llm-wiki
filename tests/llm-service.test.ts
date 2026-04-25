import { describe, expect, it } from 'vitest';
import { LLMService } from '../src/services/llmService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
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
    },
    retrieval: {
      maxContextFiles: 8,
        maxChunkChars: 3000,
        maxSourceChars: 8000,
    },
  };
}

describe('llm service', () => {
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
