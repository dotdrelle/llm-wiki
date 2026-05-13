import type { AppConfig } from '../types.ts';

export class EmbeddingService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
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

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Embedding request failed with HTTP ${res.status}: ${raw}`);
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
