import type { AppConfig } from '../types.ts';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export const defaultConfig: AppConfig = {
  wikiRoot: '.',
  language: 'fr',
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    temperature: 0.1,
    timeoutMs: 600000,
  },
  build: {
    refreshOnIngest: true,
    slotBatchSize: 3,
    maxBuildContextChars: 12000,
  },
  retrieval: {
    maxContextFiles: 5,
    maxChunksPerPage: 2,
    maxChunkChars: 3000,
    maxSourceChars: 8000,
    vector: {
      enabled: true,
      embeddingModel: 'BAAI/bge-m3',
      rerankerModel: 'BAAI/bge-reranker-v2-m3',
      topK: 120,
      rerankTopK: 80,
      maxResults: 6,
    },
  },
  mcp: {},
};
