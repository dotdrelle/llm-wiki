export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

/**
 * Endpoint par défaut d'un moteur, quand `llm.baseUrl` est absent.
 *
 * Un moteur absent de cette table **exige** une baseUrl explicite : il n'a pas
 * de valeur par défaut sensée. Faire retomber ces cas sur l'endpoint OpenAI
 * enverrait la clé d'un serveur local vers api.openai.com — c'est précisément
 * ce qu'un `else` par défaut avait laissé passer.
 */
export const ENGINE_DEFAULT_BASE_URL: Record<string, string> = {
  ollama: DEFAULT_OLLAMA_BASE_URL,
  anthropic: DEFAULT_ANTHROPIC_BASE_URL,
  openai: DEFAULT_OPENAI_BASE_URL,
  albert: 'https://albert.api.etalab.gouv.fr/v1',
};
