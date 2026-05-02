import type { AppConfig } from '../types.ts';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export const defaultConfig: AppConfig = {
  wikiRoot: '.',
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    temperature: 0.1,
    timeoutMs: 600000,
  },
  build: {
    slotBatchSize: 3,
  },
  retrieval: {
    maxContextFiles: 5,
    maxChunksPerPage: 2,
    maxChunkChars: 3000,
    maxSourceChars: 8000,
  },
};
