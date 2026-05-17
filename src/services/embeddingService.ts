import type { AppConfig } from '../types.ts';
import {
  providerRateLimitKey,
  providerRateLimitRetryDelayMs,
  providerRateLimitRetryMaxAttempts,
  throttleProviderRequestStart,
  waitForProviderRateLimitRetry,
} from './rateLimiter.ts';
import type { TraceLogger } from './traceLogger.ts';

export class EmbeddingService {
  private readonly config: AppConfig;
  private readonly logger?: TraceLogger;

  constructor(config: AppConfig, logger?: TraceLogger) {
    this.config = config;
    this.logger = logger;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    let raw = '';
    const maxAttempts = providerRateLimitRetryMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await throttleProviderRequestStart({
        key: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
        requestsPerMinute: this.config.limits.requestsPerMinute,
        logger: this.logger,
        label: 'embedding',
      });
      const res = await fetch(`${this.config.retrieval.vector.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.retrieval.vector.apiKey
            ? { Authorization: `Bearer ${this.config.retrieval.vector.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.retrieval.vector.embeddingModel,
          input: texts,
        }),
        signal: AbortSignal.timeout(this.config.retrieval.vector.timeoutMs),
      });

      raw = await res.text();
      if (res.status === 429 && attempt < maxAttempts) {
        const waitMs = providerRateLimitRetryDelayMs({
          key: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
          source: res,
        });
        await waitForProviderRateLimitRetry({
          logger: this.logger,
          event: 'embedding:rate-limit-wait',
          label: 'embedding',
          status: res.status,
          attempt,
          maxAttempts,
          waitMs,
        });
        continue;
      }
      if (!res.ok) {
        throw new Error(`Embedding request failed with HTTP ${res.status}: ${raw}`);
      }
      break;
    }

    const data = JSON.parse(raw) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    const embeddings = data.data ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding response returned ${embeddings.length} vector(s) for ${texts.length} input(s).`,
      );
    }
    return embeddings
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => {
        if (!Array.isArray(item.embedding)) {
          throw new Error('Embedding response is missing an embedding vector.');
        }
        return item.embedding;
      });
  }
}
