export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

/**
 * Default endpoint of an engine, when `llm.baseUrl` is absent.
 *
 * An engine absent from this table **requires** an explicit baseUrl: it has no
 * sensible default. Folding these cases onto the OpenAI endpoint would send a
 * local server's key to api.openai.com — which is precisely what a default
 * `else` had let through.
 */
export const ENGINE_DEFAULT_BASE_URL: Record<string, string> = {
  ollama: DEFAULT_OLLAMA_BASE_URL,
  anthropic: DEFAULT_ANTHROPIC_BASE_URL,
  openai: DEFAULT_OPENAI_BASE_URL,
  albert: 'https://albert.api.etalab.gouv.fr/v1',
};
