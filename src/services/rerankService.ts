import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../types.ts';
import { safeWriteFile } from '../utils/fs.ts';
import { hashParts, hashText } from '../utils/hash.ts';
import { slugify } from '../utils/path.ts';
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

const RERANK_MAX_DOCUMENTS_PER_REQUEST = 64;

export class RerankService {
  private readonly config: AppConfig;
  private readonly logger?: TraceLogger;
  private readonly cacheDir?: string;

  constructor(config: AppConfig, logger?: TraceLogger, cacheDir?: string) {
    this.config = config;
    this.logger = logger;
    this.cacheDir = cacheDir;
  }

  private cacheData(query: string, documents: string[], topN: number) {
    const provider = providerRateLimitKey(this.config.retrieval.vector.baseUrl);
    const model = this.config.retrieval.vector.rerankerModel;
    const documentsHash = hashParts(documents);
    const key = hashText(
      JSON.stringify({
        version: 1,
        provider,
        model,
        query,
        documentsHash,
        topN,
      }),
    );
    return {
      provider,
      model,
      queryHash: hashText(query),
      documentsHash,
      topN,
      key,
    };
  }

  private cachePath(
    query: string,
    documents: string[],
    topN: number,
  ): string | undefined {
    if (!this.cacheDir) return undefined;
    const data = this.cacheData(query, documents, topN);
    return path.join(
      this.cacheDir,
      slugify(data.model || 'reranker'),
      `${data.key}.json`,
    );
  }

  private async readCachedRerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<RerankResult[] | undefined> {
    const filePath = this.cachePath(query, documents, topN);
    if (!filePath) return undefined;
    const expected = this.cacheData(query, documents, topN);
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8')) as {
        version?: number;
        provider?: string;
        model?: string;
        queryHash?: string;
        documentsHash?: string;
        topN?: number;
        results?: unknown;
      };
      if (
        data.version === 1 &&
        data.provider === expected.provider &&
        data.model === expected.model &&
        data.queryHash === expected.queryHash &&
        data.documentsHash === expected.documentsHash &&
        data.topN === expected.topN &&
        Array.isArray(data.results)
      ) {
        const results = data.results.filter(
          (item): item is RerankResult =>
            item &&
            typeof item === 'object' &&
            typeof (item as RerankResult).index === 'number' &&
            typeof (item as RerankResult).score === 'number',
        );
        if (results.length === data.results.length) return results;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async writeCachedRerank(
    query: string,
    documents: string[],
    topN: number,
    results: RerankResult[],
  ): Promise<void> {
    const filePath = this.cachePath(query, documents, topN);
    if (!filePath) return;
    const data = this.cacheData(query, documents, topN);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await safeWriteFile(
        filePath,
        JSON.stringify(
          {
            version: 1,
            provider: data.provider,
            model: data.model,
            queryHash: data.queryHash,
            documentsHash: data.documentsHash,
            topN: data.topN,
            createdAt: new Date().toISOString(),
            results,
          },
          null,
          2,
        ),
      );
    } catch {
      // Cache writes must never make retrieval fail.
    }
  }

  async rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<RerankResult[]> {
    if (documents.length === 0) return [];
    const effectiveTopN = Math.min(topN, documents.length);
    const cached = await this.readCachedRerank(query, documents, effectiveTopN);
    if (cached) return cached;

    const results: RerankResult[] = [];
    for (let offset = 0; offset < documents.length; offset += RERANK_MAX_DOCUMENTS_PER_REQUEST) {
      const batch = documents.slice(offset, offset + RERANK_MAX_DOCUMENTS_PER_REQUEST);
      const batchTopN = Math.min(effectiveTopN, batch.length);
      const batchResults = await this.rerankRequest(query, batch, batchTopN);
      results.push(
        ...batchResults.map((result) => ({
          index: result.index + offset,
          score: result.score,
        })),
      );
    }
    const ranked = results.sort((a, b) => b.score - a.score).slice(0, effectiveTopN);
    await this.writeCachedRerank(query, documents, effectiveTopN, ranked);
    return ranked;
  }

  private async rerankRequest(
    query: string,
    documents: string[],
    effectiveTopN: number,
  ): Promise<RerankResult[]> {
    let raw = '';
    const maxAttempts = providerRateLimitRetryMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await throttleProviderRequestStart({
        key: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
        requestsPerMinute: this.config.limits.requestsPerMinute,
        logger: this.logger,
        label: 'rerank',
      });
      const res = await fetch(
        `${this.config.retrieval.vector.baseUrl.replace(/\/$/, '')}/rerank`,
        {
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
            top_n: effectiveTopN,
          }),
          signal: AbortSignal.timeout(this.config.retrieval.vector.timeoutMs),
        },
      );

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
    const results = (data.results ?? [])
      .filter(
        (item): item is { index: number; relevance_score: number } =>
          typeof item.index === 'number' && typeof item.relevance_score === 'number',
      )
      .map((item) => ({ index: item.index, score: item.relevance_score }));
    return results;
  }
}
