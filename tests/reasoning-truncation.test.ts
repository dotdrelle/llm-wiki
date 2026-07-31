import { afterEach, describe, expect, it } from 'vitest';
import { LLMService } from '../src/services/llmService.ts';
import { resetProviderRateLimiterForTests } from '../src/services/rateLimiter.ts';
import {
  outputCapIncludesReasoning,
  reasoningAwareOutputCap,
} from '../src/config/engineCapabilities.ts';
import type { AppConfig, LlmEngine, LlmProvider } from '../src/types.ts';

/**
 * Lot A′ — plan-implementation-reasoning.md.
 *
 * Sur un moteur à raisonnement, le plafond de sortie couvre le raisonnement ET
 * le contenu. Le modèle peut donc épuiser le budget avant d'écrire un
 * caractère utile : HTTP 200, `finish_reason: length`, contenu vide.
 *
 * Observé sur Albert / gpt-oss-120b, où la sonde a produit le cas avec
 * `max_tokens: 64`.
 *
 * L'échec n'était pas silencieux : un garde-fou générique existait déjà
 * (`llmService.ts` — « The model returned an empty response. »). Mais il ne
 * nommait ni la cause, ni le remède, et se déclenchait à l'identique pour trois
 * situations différentes. Ces tests figent la distinction :
 *
 *   coupure pendant le raisonnement  → erreur spécifique, avec le plafond et
 *                                      le volume de raisonnement observé
 *   troncature avec contenu partiel  → laissé passer, la validation en aval
 *                                      tranche
 *   vide sur fin normale             → garde-fou générique, cause à chercher
 *                                      ailleurs
 */

function configFor(provider: LlmProvider, engine: LlmEngine): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider,
      engine,
      model: 'openai/gpt-oss-120b',
      apiKey: 'k',
      baseUrl: `https://trunc-${provider}-${engine}.test/v1`,
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 600,
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
        enabled: false,
        baseUrl: 'https://x.test/v1',
        timeoutMs: 600000,
        embeddingModel: 'm',
        rerankEnabled: false,
        rerankerModel: 'r',
        topK: 10,
        rerankTopK: 5,
        maxResults: 3,
      },
    },
    mcp: {},
  };
}

/** Flux imitant un moteur à raisonnement : deltas de raisonnement puis fin. */
function streamOf(
  service: LLMService,
  chunks: Array<Record<string, unknown>>,
): void {
  (service as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) yield chunk;
          },
        }),
      },
    },
  };
}

const reasoningDelta = (key: string, text: string) => ({
  choices: [{ delta: { [key]: text } }],
});

async function run(service: LLMService, request = {}) {
  return service.completeText({
    system: 'S',
    user: 'U',
    maxOutputTokens: 3000,
    ...request,
  });
}

describe('coupure pendant le raisonnement', () => {
  afterEach(() => {
    resetProviderRateLimiterForTests();
  });

  it.each(['reasoning', 'reasoning_content'])(
    'lève une erreur nommant la cause quand %s a consommé le plafond',
    async (key) => {
      const service = new LLMService(configFor('openai-compatible', 'albert'));
      streamOf(service, [
        reasoningDelta(key, 'step '.repeat(40)),
        { choices: [{ delta: {}, finish_reason: 'length' }] },
      ]);

      await expect(run(service)).rejects.toThrow(/truncated with an empty answer/);
      await expect(run(service)).rejects.toThrow(/maxOutputTokens=3000/);
      await expect(run(service)).rejects.toThrow(/characters of reasoning/);
    },
  );

  it('compte aussi le raisonnement livré en thinking_blocks', async () => {
    const service = new LLMService(configFor('ai-gateway', 'generic'));
    streamOf(service, [
      {
        choices: [
          { delta: { thinking_blocks: [{ type: 'thinking', thinking: 'abcdefghij' }] } },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ]);
    await expect(run(service)).rejects.toThrow(/10 characters of reasoning/);
  });

  it('laisse passer une réponse tronquée qui a tout de même produit du contenu', async () => {
    // Troncature en fin de génération : le contenu partiel reste exploitable,
    // et la validation de section en aval décidera de son sort.
    const service = new LLMService(configFor('openai-compatible', 'albert'));
    streamOf(service, [
      reasoningDelta('reasoning', 'step '.repeat(40)),
      { choices: [{ delta: { content: 'partial answer' }, finish_reason: 'length' }] },
    ]);
    await expect(run(service)).resolves.toBe('partial answer');
  });

  it('laisse le garde-fou générique traiter un contenu vide sur fin normale', async () => {
    // Un contenu vide sur `finish_reason: stop` n'est pas une coupure : il
    // relève du garde-fou générique préexistant. Le requalifier ici masquerait
    // sa vraie cause.
    const service = new LLMService(configFor('openai-compatible', 'albert'));
    streamOf(service, [
      reasoningDelta('reasoning', 'step '.repeat(40)),
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    await expect(run(service)).rejects.toThrow(/returned an empty response/);
    await expect(run(service)).rejects.not.toThrow(/truncated/);
  });

  it('reste silencieux quand aucun raisonnement n’est en cause', async () => {
    const service = new LLMService(configFor('openai-compatible', 'openai'));
    streamOf(service, [{ choices: [{ delta: {}, finish_reason: 'length' }] }]);
    await expect(run(service)).rejects.toThrow(/truncated with an empty answer/);
    await expect(run(service)).rejects.not.toThrow(/characters of reasoning/);
  });
});

describe('plafond de sortie élargi pour le raisonnement', () => {
  it('élargit le plafond partout où il couvre aussi le raisonnement', () => {
    for (const engine of ['albert', 'ollama', 'vllm', 'mlx', 'openai', 'generic'] as LlmEngine[]) {
      const config = configFor('openai-compatible', engine);
      expect(outputCapIncludesReasoning(config.llm)).toBe(true);
      expect(reasoningAwareOutputCap(config.llm, 3000)).toBe(9000);
    }
    expect(reasoningAwareOutputCap(configFor('ai-gateway', 'generic').llm, 3000)).toBe(9000);
  });

  it('laisse le plafond intact pour anthropic, dont le budget de réflexion est séparé', () => {
    const config = configFor('openai-compatible', 'anthropic');
    expect(outputCapIncludesReasoning(config.llm)).toBe(false);
    expect(reasoningAwareOutputCap(config.llm, 3000)).toBe(3000);
  });

  it('respecte llm.reasoningOutputMultiplier — la valeur par défaut est provisoire', () => {
    const config = configFor('openai-compatible', 'albert');
    config.llm.reasoningOutputMultiplier = 1.5;
    expect(reasoningAwareOutputCap(config.llm, 3000)).toBe(4500);
  });
});
