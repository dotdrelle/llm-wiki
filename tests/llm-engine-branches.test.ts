import { afterEach, describe, expect, it } from 'vitest';
import { LLMService } from '../src/services/llmService.ts';
import { resetProviderRateLimiterForTests } from '../src/services/rateLimiter.ts';
import {
  prefersSingleSlotTextRendering,
  supportsModelJsonRepair,
} from '../src/config/engineCapabilities.ts';
import type { AppConfig, LlmEngine, LlmProvider } from '../src/types.ts';

/**
 * Tests de caractérisation — plan-implementation-engine-gateway.md, commits 1 et 4.
 *
 * Ils figent le comportement des contournements par moteur. Les assertions
 * décrivaient à l'origine les branches `config.llm.provider` ; elles sont
 * conservées à l'identique après la bascule vers `config.llm.engine`, avec la
 * correspondance suivante :
 *
 *   provider: 'openai'            → engine: 'openai'
 *   provider: 'ollama'            → engine: 'ollama'
 *   provider: 'anthropic'         → engine: 'anthropic'
 *   provider: 'openai-compatible' → engine: 'mlx' | 'vllm' | 'albert' | 'generic'
 *
 * S'y ajoute le mode `ai-gateway`, où **aucun** contournement ne s'applique.
 */

function baseConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      engine: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 600,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: false,
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
        baseUrl: 'https://api.openai.com/v1',
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

/** Serveur direct, moteur explicite. */
function engineFor(engine: LlmEngine, model: string): AppConfig {
  return withLlm('openai-compatible', engine, model);
}

/** Derrière une AI gateway : `engine` est ignoré. */
function gatewayFor(model: string): AppConfig {
  return withLlm('ai-gateway', 'generic', model);
}

function withLlm(provider: LlmProvider, engine: LlmEngine, model: string): AppConfig {
  const config = baseConfig();
  return {
    ...config,
    llm: {
      ...config.llm,
      provider,
      engine,
      model,
      // Le rate limiter est indexé par baseUrl : une URL distincte par
      // combinaison évite qu'un test fasse fuiter son état sur le suivant.
      baseUrl: `https://${provider}-${engine}.test/v1`,
    },
  };
}

/** Remplace le client OpenAI par un double qui capture les paramètres d'appel. */
function captureParams(service: LLMService): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  (service as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          captured = params;
          return {
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: '{}' } }] };
              yield {
                choices: [],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              };
            },
          };
        },
      },
    },
  };
  return () => captured;
}

/** Remplace le client par un double qui lève l'erreur fournie. */
function throwWith(service: LLMService, error: unknown): void {
  (service as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async () => {
          throw error;
        },
      },
    },
  };
}

async function run(service: LLMService, request = {}): Promise<void> {
  await service.completeText({
    system: 'You are a test.',
    user: 'Return JSON.',
    ...request,
  });
}

describe('contournements par moteur (caractérisation)', () => {
  afterEach(() => {
    resetProviderRateLimiterForTests();
  });

  // ── #1 · supportsTemperature ──────────────────────────────────────────────

  it('#1 omet temperature pour engine openai + gpt-5', async () => {
    const service = new LLMService(engineFor('openai', 'gpt-5-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('temperature');
  });

  it('#1 envoie temperature pour engine openai + modèle non gpt-5', async () => {
    const service = new LLMService(engineFor('openai', 'gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params()).toHaveProperty('temperature');
  });

  it('#1 envoie temperature pour un gpt-5 servi par un moteur local', async () => {
    const service = new LLMService(engineFor('vllm', 'gpt-5-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params()).toHaveProperty('temperature');
  });

  it('#1 B-A · omet temperature pour un gpt-5 préfixé derrière une gateway', async () => {
    // Correctif B-A : la regex est ancrée sur le segment final du nom, sinon
    // "openai/gpt-5-mini" ne matchait pas et OpenAI rejetait la requête.
    const service = new LLMService(gatewayFor('openai/gpt-5-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('temperature');
  });

  it('#1 B-A · omet temperature pour un gpt-5 préfixé en direct', async () => {
    const service = new LLMService(engineFor('openai', 'openai/gpt-5-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('temperature');
  });

  it('#1 envoie temperature pour un modèle non gpt-5 derrière une gateway', async () => {
    const service = new LLMService(gatewayFor('anthropic/claude-sonnet-4-5'));
    const params = captureParams(service);
    await run(service);
    expect(params()).toHaveProperty('temperature');
  });

  // ── #3 · diagnostic HTTP 500 Ollama ───────────────────────────────────────

  it('#3 enrichit le message HTTP 500 pour engine ollama', async () => {
    const service = new LLMService(engineFor('ollama', 'qwen2.5'));
    throwWith(service, { status: 500, message: 'internal error' });
    await expect(run(service)).rejects.toThrow(/numCtx/);
  });

  it('#3 laisse le message HTTP 500 générique hors ollama', async () => {
    const service = new LLMService(engineFor('vllm', 'qwen2.5'));
    throwWith(service, { status: 500, message: 'internal error' });
    await expect(run(service)).rejects.not.toThrow(/numCtx/);
  });

  it('#3 laisse le message HTTP 500 générique derrière une gateway', async () => {
    const service = new LLMService(gatewayFor('ollama/qwen2.5'));
    throwWith(service, { status: 500, message: 'internal error' });
    await expect(run(service)).rejects.not.toThrow(/numCtx/);
  });

  // ── #4 · fusion system dans user ──────────────────────────────────────────

  it.each<LlmEngine>(['mlx', 'vllm', 'albert', 'generic'])(
    '#4 fusionne system dans user pour le moteur local %s',
    async (engine) => {
      const service = new LLMService(engineFor(engine, 'qwen2.5'));
      const params = captureParams(service);
      await run(service);
      const messages = params().messages as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toContain('You are a test.');
      expect(messages[0]?.content).toContain('Return JSON.');
    },
  );

  it.each<LlmEngine>(['openai', 'anthropic', 'ollama'])(
    '#4 conserve un rôle system distinct pour %s',
    async (engine) => {
      const service = new LLMService(engineFor(engine, 'a-model'));
      const params = captureParams(service);
      await run(service);
      const messages = params().messages as Array<{ role: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('system');
    },
  );

  it('#4 conserve un rôle system distinct derrière une gateway', async () => {
    const service = new LLMService(gatewayFor('mlx/qwen2.5'));
    const params = captureParams(service);
    await run(service);
    expect(params().messages).toHaveLength(2);
  });

  // ── #5 · options.num_ctx ──────────────────────────────────────────────────

  it('#5 transmet options.num_ctx pour ollama quand numCtx est configuré', async () => {
    const config = engineFor('ollama', 'qwen2.5');
    const service = new LLMService({
      ...config,
      llm: { ...config.llm, numCtx: 32768 },
    });
    const params = captureParams(service);
    await run(service);
    expect(params().options).toEqual({ num_ctx: 32768 });
  });

  it('#5 omet options quand numCtx est absent', async () => {
    const service = new LLMService(engineFor('ollama', 'qwen2.5'));
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('options');
  });

  it('#5 omet options hors ollama même avec numCtx', async () => {
    const config = engineFor('vllm', 'qwen2.5');
    const service = new LLMService({
      ...config,
      llm: { ...config.llm, numCtx: 32768 },
    });
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('options');
  });

  it('#5 omet options derrière une gateway même avec numCtx', async () => {
    const config = gatewayFor('ollama/qwen2.5');
    const service = new LLMService({
      ...config,
      llm: { ...config.llm, numCtx: 32768 },
    });
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('options');
  });

  // ── #6 · response_format JSON ─────────────────────────────────────────────

  it('#6 envoie response_format en jsonMode pour engine openai', async () => {
    const service = new LLMService(engineFor('openai', 'gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service, { jsonMode: true });
    expect(params().response_format).toEqual({ type: 'json_object' });
  });

  it('#6 envoie response_format en jsonMode pour engine ollama', async () => {
    const service = new LLMService(engineFor('ollama', 'qwen2.5'));
    const params = captureParams(service);
    await run(service, { jsonMode: true });
    expect(params().response_format).toEqual({ type: 'json_object' });
  });

  it('#6 envoie response_format en jsonMode derrière une gateway', async () => {
    const service = new LLMService(gatewayFor('openai/gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service, { jsonMode: true });
    expect(params().response_format).toEqual({ type: 'json_object' });
  });

  it('#6 omet response_format pour engine anthropic', async () => {
    const service = new LLMService(engineFor('anthropic', 'claude-sonnet-4-5'));
    const params = captureParams(service);
    await run(service, { jsonMode: true });
    expect(params()).not.toHaveProperty('response_format');
  });

  // `albert` est sorti de cette liste : mesuré comme supportant json_object.
  it.each<LlmEngine>(['mlx', 'vllm', 'generic'])(
    '#6 omet response_format pour le moteur local %s',
    async (engine) => {
      const service = new LLMService(engineFor(engine, 'qwen2.5'));
      const params = captureParams(service);
      await run(service, { jsonMode: true });
      expect(params()).not.toHaveProperty('response_format');
    },
  );

  it('#6 omet response_format hors jsonMode', async () => {
    const service = new LLMService(engineFor('openai', 'gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('response_format');
  });

  // ── #7 · plafond de tokens générés ────────────────────────────────────────

  it('#7 utilise max_completion_tokens pour engine openai', async () => {
    const service = new LLMService(engineFor('openai', 'gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service, { maxOutputTokens: 256 });
    expect(params().max_completion_tokens).toBe(256);
    expect(params()).not.toHaveProperty('max_tokens');
  });

  it('#7 utilise max_tokens hors openai', async () => {
    const service = new LLMService(engineFor('anthropic', 'claude-sonnet-4-5'));
    const params = captureParams(service);
    await run(service, { maxOutputTokens: 256 });
    expect(params().max_tokens).toBe(256);
    expect(params()).not.toHaveProperty('max_completion_tokens');
  });

  it('#7 utilise max_tokens derrière une gateway — la traduction lui incombe', async () => {
    const service = new LLMService(gatewayFor('openai/gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service, { maxOutputTokens: 256 });
    expect(params().max_tokens).toBe(256);
    expect(params()).not.toHaveProperty('max_completion_tokens');
  });

  // ── #8 · stream_options ───────────────────────────────────────────────────

  it('#8 demande stream_options hors anthropic', async () => {
    const service = new LLMService(engineFor('openai', 'gpt-4.1-mini'));
    const params = captureParams(service);
    await run(service);
    expect(params().stream_options).toEqual({ include_usage: true });
  });

  it('#8 omet stream_options pour engine anthropic', async () => {
    const service = new LLMService(engineFor('anthropic', 'claude-sonnet-4-5'));
    const params = captureParams(service);
    await run(service);
    expect(params()).not.toHaveProperty('stream_options');
  });

  it('#8 demande stream_options derrière une gateway', async () => {
    const service = new LLMService(gatewayFor('anthropic/claude-sonnet-4-5'));
    const params = captureParams(service);
    await run(service);
    expect(params().stream_options).toEqual({ include_usage: true });
  });
});

/**
 * Capacités mesurées sur Albert via `scripts/probe-engine.mjs` — trois
 * contournements hérités du groupe `openai-compatible` qui ne s'y justifiaient
 * pas. Ces tests figent la mesure, et documentent ce qu'il faudrait re-sonder
 * pour l'étendre à vllm / mlx / generic.
 */
describe('capacités mesurées du moteur albert', () => {
  it('#6 M2 · envoie response_format en jsonMode pour albert', async () => {
    const service = new LLMService(engineFor('albert', 'openai/gpt-oss-120b'));
    const params = captureParams(service);
    await run(service, { jsonMode: true });
    expect(params().response_format).toEqual({ type: 'json_object' });
  });

  it.each<LlmEngine>(['mlx', 'vllm', 'generic'])(
    '#6 M2 · reste désactivé pour %s, non sondé',
    async (engine) => {
      const service = new LLMService(engineFor(engine, 'a-model'));
      const params = captureParams(service);
      await run(service, { jsonMode: true });
      expect(params()).not.toHaveProperty('response_format');
    },
  );

  it('#4 M1 · albert conserve le repli system→user — verdict de sonde non concluant', async () => {
    // La passe M1 a renvoyé un contenu vide sous un plafond de 64 tokens :
    // une coupure pendant le raisonnement, pas un rejet du rôle system. Tant
    // que ce n'est pas isolé, on garde le comportement prudent.
    const service = new LLMService(engineFor('albert', 'openai/gpt-oss-120b'));
    const params = captureParams(service);
    await run(service);
    expect(params().messages).toHaveLength(1);
  });
});

describe('capacités structurelles par moteur', () => {
  it('M3 · la réparation JSON par le modèle est active sur albert, pas sur les serveurs bruts', () => {
    expect(supportsModelJsonRepair(engineFor('albert', 'm').llm)).toBe(true);
    expect(supportsModelJsonRepair(gatewayFor('openai/gpt-5.4').llm)).toBe(true);
    for (const engine of ['mlx', 'vllm', 'generic'] as LlmEngine[]) {
      expect(supportsModelJsonRepair(engineFor(engine, 'm').llm)).toBe(false);
    }
  });

  it('M4 · le rendu slot unique ne sérialise plus le build sur albert ni derrière une gateway', () => {
    expect(prefersSingleSlotTextRendering(engineFor('albert', 'm').llm)).toBe(false);
    expect(prefersSingleSlotTextRendering(gatewayFor('openai/gpt-5.4').llm)).toBe(false);
    for (const engine of ['mlx', 'vllm', 'generic'] as LlmEngine[]) {
      expect(prefersSingleSlotTextRendering(engineFor(engine, 'm').llm)).toBe(true);
    }
  });
});
