import type { AppConfig } from '../types.ts';

export interface RerankResult {
  index: number;
  score: number;
}

export class RerankService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<RerankResult[]> {
    if (documents.length === 0) return [];
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

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Rerank request failed with HTTP ${res.status}: ${raw}`);
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
