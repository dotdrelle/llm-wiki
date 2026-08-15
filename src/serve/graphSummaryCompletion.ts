/**
 * Bridge between the graph routes and the configured LLM.
 *
 * `graph/wiki/summary.ts` knows neither the configuration nor the provider: it
 * receives a completion function or nothing. That is what makes it testable
 * without a network, and here is where it is given its engine.
 */
import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';

// One service per configuration: it carries an HTTP client and a rate-limit
// key, rebuilding them per request would mean opening a new connection per
// card opened.
const services = new WeakMap<AppConfig, LLMService>();

export function graphSummaryCompletion(
  config: AppConfig,
): ((request: { system: string; user: string }) => Promise<string>) | undefined {
  if (!config.llm?.baseUrl || !config.llm?.model) return undefined;
  return async ({ system, user }) => {
    let service = services.get(config);
    if (!service) {
      service = new LLMService(config);
      services.set(config, service);
    }
    return service.completeText({
      system,
      user,
      temperature: 0.2,
      // A context card is three lines long. Without a cap, a chatty model would
      // block the card from opening while it writes a page.
      maxOutputTokens: 260,
      label: 'graph-context-summary',
    });
  };
}
