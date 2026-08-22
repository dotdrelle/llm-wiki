/**
 * Bridge between the graph routes and the taxonomy synthesis.
 *
 * `graph/wiki/taxonomy/simple.ts` knows neither the configuration nor the
 * provider: it receives a `propose` function or nothing. This is the mirror of
 * `graphSummaryCompletion.ts` — it gives the synthesis its engine, so the
 * `/graph` "Rebuild" button and the `wiki taxonomy --apply` CLI share the exact
 * same model selection (including the `llm.taxonomyModel` override) without the
 * CLI and Serve duplicating it.
 */
import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import {
  simpleSynthesisSchema,
  synthesizeSimpleTaxonomy,
  type SimpleSynthesizeOutcome,
} from '../graph/wiki/taxonomy/simple.ts';

// One service per configuration: same reason as graphSummaryCompletion — an
// HTTP client and a rate-limit key per config, never rebuilt per request.
const services = new WeakMap<AppConfig, LLMService>();

// One in-flight synthesis per workspace: nothing upstream of this route stops
// two "Rebuild" clicks (two tabs, a double-click) from racing an uncoordinated
// registry write — no idempotency key, no approval banner, unlike a run
// dispatched through Donna/the runtime. Reuse the in-flight promise instead of
// starting a second synthesis for the same root.
const inFlight = new Map<string, Promise<SimpleSynthesizeOutcome>>();

export function graphTaxonomyRun(
  config: AppConfig,
): ((rootDir: string, language: string) => Promise<SimpleSynthesizeOutcome>) | undefined {
  if (!config.llm?.baseUrl || !config.llm?.model) return undefined;

  const taxonomyConfig = config.llm.taxonomyModel
    ? { ...config, llm: { ...config.llm, model: config.llm.taxonomyModel } }
    : config;

  return async (rootDir, language) => {
    const existing = inFlight.get(rootDir);
    if (existing) return existing;

    let service = services.get(taxonomyConfig);
    if (!service) {
      service = new LLMService(taxonomyConfig);
      services.set(taxonomyConfig, service);
    }
    const propose = async (request: { system: string; user: string }) =>
      service.completeJson(
        {
          ...request,
          jsonMode: true,
          jsonExtraction: 'trailing',
          label: 'taxonomy-synthesis',
          temperature: 0,
        },
        simpleSynthesisSchema,
      );
    const run = synthesizeSimpleTaxonomy(rootDir, { language }, { propose })
      .finally(() => inFlight.delete(rootDir));
    inFlight.set(rootDir, run);
    return run;
  };
}
