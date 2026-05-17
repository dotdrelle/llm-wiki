import type { AppConfig } from '../types.ts';
import {
  providerRateLimitKey,
  providerRateLimitRetryDelayMs,
  providerRateLimitRetryMaxAttempts,
  throttleProviderRequestStart,
  waitForProviderRateLimitRetry,
} from './rateLimiter.ts';
import type { TraceLogger } from './traceLogger.ts';

export interface RerankResult {
  index: number;
  score: number;
}

export class RerankService {
  private readonly config: AppConfig;
  private readonly logger?: TraceLogger;

  constructor(config: AppConfig, logger?: TraceLogger) {
    this.config = config;
    this.logger = logger;
  }

  async rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<RerankResult[]> {
    if (documents.length === 0) return [];
    let raw = '';
    const maxAttempts = providerRateLimitRetryMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await throttleProviderRequestStart({
        key: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
        requestsPerMinute: this.config.limits.requestsPerMinute,
        logger: this.logger,
        label: 'rerank',
      });
      const res = await fetch(`${this.config.retrieval.vector.baseUrl.replace(/\/$/, '')}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.retrieval.vector.apiKey
            ? { Authorization: `Bearer ${this.config.retrieval.vector.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.retrieval.vector.rerankerModel,
          query,
          documents,
          top_n: Math.min(topN, documents.length),
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
          event: 'rerank:rate-limit-wait',
          label: 'rerank',
          status: res.status,
          attempt,
          maxAttempts,
          waitMs,
        });
        continue;
      }
      if (!res.ok) {
        throw new Error(`Rerank request failed with HTTP ${res.status}: ${raw}`);
      }
      break;
    }

    const data = JSON.parse(raw) as {
      results?: Array<{ index?: number; relevance_score?: number }>;
    };
    return (data.results ?? [])
      .filter(
        (item): item is { index: number; relevance_score: number } =>
          typeof item.index === 'number' && typeof item.relevance_score === 'number',
      )
      .map((item) => ({ index: item.index, score: item.relevance_score }));
  }
}
