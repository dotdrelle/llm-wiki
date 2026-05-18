import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../types.ts';
import { safeWriteFile } from '../utils/fs.ts';
import { hashText } from '../utils/hash.ts';
import { slugify } from '../utils/path.ts';
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
  private readonly cacheDir?: string;

  constructor(config: AppConfig, logger?: TraceLogger, cacheDir?: string) {
    this.config = config;
    this.logger = logger;
    this.cacheDir = cacheDir;
  }

  private cachePath(text: string): string | undefined {
    if (!this.cacheDir) return undefined;
    const model = slugify(this.config.retrieval.vector.embeddingModel || 'embedding');
    const key = hashText(
      JSON.stringify({
        version: 1,
        provider: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
        model: this.config.retrieval.vector.embeddingModel,
        text,
      }),
    );
    return path.join(this.cacheDir, model, `${key}.json`);
  }

  private async readCachedEmbedding(text: string): Promise<number[] | undefined> {
    const filePath = this.cachePath(text);
    if (!filePath) return undefined;
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8')) as {
        version?: number;
        provider?: string;
        model?: string;
        textHash?: string;
        embedding?: unknown;
      };
      if (
        data.version === 1 &&
        data.provider === providerRateLimitKey(this.config.retrieval.vector.baseUrl) &&
        data.model === this.config.retrieval.vector.embeddingModel &&
        data.textHash === hashText(text) &&
        Array.isArray(data.embedding) &&
        data.embedding.every((value) => typeof value === 'number')
      ) {
        return data.embedding;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async writeCachedEmbedding(text: string, embedding: number[]): Promise<void> {
    const filePath = this.cachePath(text);
    if (!filePath) return;
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await safeWriteFile(
        filePath,
        JSON.stringify(
          {
            version: 1,
            provider: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
            model: this.config.retrieval.vector.embeddingModel,
            textHash: hashText(text),
            createdAt: new Date().toISOString(),
            embedding,
          },
          null,
          2,
        ),
      );
    } catch {
      // Cache writes must never make retrieval fail.
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const cached = await Promise.all(texts.map((text) => this.readCachedEmbedding(text)));
    const missingInputs = texts
      .map((text, index) => ({ text, index }))
      .filter((item) => !cached[item.index]);
    if (missingInputs.length === 0) {
      return cached as number[][];
    }

    let raw = '';
    const maxAttempts = providerRateLimitRetryMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await throttleProviderRequestStart({
        key: providerRateLimitKey(this.config.retrieval.vector.baseUrl),
        requestsPerMinute: this.config.limits.requestsPerMinute,
        logger: this.logger,
        label: 'embedding',
      });
      const res = await fetch(
        `${this.config.retrieval.vector.baseUrl.replace(/\/$/, '')}/embeddings`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.retrieval.vector.apiKey
              ? { Authorization: `Bearer ${this.config.retrieval.vector.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: this.config.retrieval.vector.embeddingModel,
            input: missingInputs.map((item) => item.text),
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
    if (embeddings.length !== missingInputs.length) {
      throw new Error(
        `Embedding response returned ${embeddings.length} vector(s) for ${missingInputs.length} input(s).`,
      );
    }
    const fetched = embeddings
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => {
        if (!Array.isArray(item.embedding)) {
          throw new Error('Embedding response is missing an embedding vector.');
        }
        return item.embedding;
      });
    await Promise.all(
      missingInputs.map((item, index) =>
        this.writeCachedEmbedding(item.text, fetched[index] ?? []),
      ),
    );

    const result = [...cached] as Array<number[] | undefined>;
    missingInputs.forEach((item, index) => {
      result[item.index] = fetched[index];
    });
    return result as number[][];
  }
}
