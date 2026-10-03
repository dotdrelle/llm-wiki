import YAML from 'yaml';
import { safeWriteFile } from '../utils/fs.ts';
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OPENAI_BASE_URL } from './defaults.ts';
import type { LlmEngine } from '../types.ts';

/**
 * Migration of `.wikirc.yaml` files predating 0.16.
 *
 * `llm.provider` carried two axes at once: where requests are sent and how the
 * server in front behaves. They are now separated into `provider`
 * (`openai-compatible` | `ai-gateway`) and `engine`.
 *
 * This table lives here — called only by `wiki doctor --apply` — and not in
 * `resolveConfig`, so as not to burden the read path with a permanent
 * normalization. It can be removed in one block at 1.0.
 */

interface LegacyMapping {
  engine: LlmEngine;
  /**
   * `resolveConfig` derived the baseUrl from the provider when it was absent.
   * We materialize it at migration: that is the only way to guarantee that the
   * migrated file targets exactly the same endpoint as before.
   */
  defaultBaseUrl: string;
}

const LEGACY_PROVIDERS: Record<string, LegacyMapping> = {
  openai: { engine: 'openai', defaultBaseUrl: DEFAULT_OPENAI_BASE_URL },
  ollama: { engine: 'ollama', defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL },
  // The native `anthropic` engine was removed from the config. The legacy
  // value migrates to the generic engine — the file keeps loading and targets
  // the same endpoint; `doctor` then calibrates it like any other server.
  anthropic: { engine: 'generic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
};

/**
 * Last-resort heuristic, applied a single time, for the old
 * `openai-compatible` that had no declared engine. It takes up the
 * `looksLikeMlx()` that `doctor` applied on every run — after migration, the
 * engine is declared and nothing is guessed anymore.
 */
function guessLocalEngine(llm: Record<string, unknown>): LlmEngine {
  const model = typeof llm.model === 'string' ? llm.model.toLowerCase() : '';
  const baseUrl = typeof llm.baseUrl === 'string' ? llm.baseUrl : '';
  if (model.includes('mlx') || baseUrl.includes(':8080')) return 'mlx';
  if (/albert\.api\.etalab\.gouv\.fr/i.test(baseUrl)) return 'albert';
  if (baseUrl.includes(':8000') || model.includes('vllm')) return 'vllm';
  return 'generic';
}

export interface LegacyConfigMigration {
  /** Old value of `llm.provider`, as it appeared in the file. */
  from: string;
  /** True when the provider/engine pair itself was rewritten (not only a removed engine). */
  providerMigrated: boolean;
  /** New pair, for display. */
  to: { provider: string; engine: LlmEngine };
  /** True if the baseUrl, implicit until now, had to be materialized. */
  materializedBaseUrl?: string;
  /** Removed engines rewritten in place, e.g. `llm.engine: anthropic → generic`. */
  replacedEngines?: Array<{ key: string; from: string; to: LlmEngine }>;
}

/**
 * Engines removed from the schema. A file can carry one under the CURRENT
 * provider — the old wizard wrote `engine: anthropic`, and so did the former
 * migration of `provider: anthropic` — so the provider check alone misses it.
 */
const REMOVED_ENGINES: Record<string, LegacyMapping> = {
  anthropic: { engine: 'generic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function planProviderMigration(
  llmBlock: Record<string, unknown>,
): { llm: Record<string, unknown>; from: string; materializedBaseUrl?: string } | undefined {
  const provider = llmBlock.provider;
  if (typeof provider !== 'string') return undefined;

  // Already migrated: current provider and declared engine.
  if (provider === 'ai-gateway') return undefined;
  if (provider === 'openai-compatible' && typeof llmBlock.engine === 'string') {
    return undefined;
  }

  const mapping = LEGACY_PROVIDERS[provider];
  if (provider !== 'openai-compatible' && !mapping) return undefined;
  const engine: LlmEngine = mapping?.engine ?? guessLocalEngine(llmBlock);
  const hasBaseUrl = typeof llmBlock.baseUrl === 'string' && llmBlock.baseUrl.length > 0;
  const materializedBaseUrl =
    !hasBaseUrl && mapping ? mapping.defaultBaseUrl : undefined;
  return {
    llm: {
      ...llmBlock,
      provider: 'openai-compatible',
      engine,
      ...(materializedBaseUrl ? { baseUrl: materializedBaseUrl } : {}),
    },
    from: provider,
    ...(materializedBaseUrl ? { materializedBaseUrl } : {}),
  };
}

/**
 * Detects an old format and computes its rewrite, without writing anything.
 * Returns `undefined` if the file is already in the current format.
 */
export function planLegacyConfigMigration(
  rawConfig: unknown,
): { nextConfig: Record<string, unknown>; migration: LegacyConfigMigration } | undefined {
  if (!isRecord(rawConfig)) return undefined;
  const root = rawConfig;
  if (!isRecord(root.llm)) return undefined;

  const providerStep = planProviderMigration(root.llm);
  let llm: Record<string, unknown> = providerStep?.llm ?? { ...root.llm };
  let materializedBaseUrl = providerStep?.materializedBaseUrl;
  const replacedEngines: NonNullable<LegacyConfigMigration['replacedEngines']> = [];

  const llmEngine = llm.engine;
  if (typeof llmEngine === 'string' && REMOVED_ENGINES[llmEngine]) {
    const mapping = REMOVED_ENGINES[llmEngine];
    const hasBaseUrl = typeof llm.baseUrl === 'string' && llm.baseUrl.length > 0;
    // The removed engine had a default endpoint; `generic` has none, so an
    // implicit baseUrl must be written or the file would target nothing.
    if (!hasBaseUrl) materializedBaseUrl = mapping.defaultBaseUrl;
    llm = { ...llm, engine: mapping.engine, ...(hasBaseUrl ? {} : { baseUrl: mapping.defaultBaseUrl }) };
    replacedEngines.push({ key: 'llm.engine', from: llmEngine, to: mapping.engine });
  }

  // The vector block inherits the llm baseUrl when it has none, so only its
  // engine needs rewriting.
  let retrieval = root.retrieval;
  if (isRecord(retrieval) && isRecord(retrieval.vector)) {
    const vectorEngine = retrieval.vector.engine;
    if (typeof vectorEngine === 'string' && REMOVED_ENGINES[vectorEngine]) {
      const mapping = REMOVED_ENGINES[vectorEngine];
      retrieval = { ...retrieval, vector: { ...retrieval.vector, engine: mapping.engine } };
      replacedEngines.push({ key: 'retrieval.vector.engine', from: vectorEngine, to: mapping.engine });
    }
  }

  if (!providerStep && replacedEngines.length === 0) return undefined;

  return {
    nextConfig: {
      ...root,
      llm,
      ...(retrieval !== root.retrieval ? { retrieval } : {}),
    },
    migration: {
      from: providerStep?.from ?? String(root.llm.provider ?? 'openai-compatible'),
      providerMigrated: Boolean(providerStep),
      to: {
        provider: String(llm.provider ?? 'openai-compatible'),
        engine: (llm.engine as LlmEngine | undefined) ?? 'generic',
      },
      ...(materializedBaseUrl ? { materializedBaseUrl } : {}),
      ...(replacedEngines.length ? { replacedEngines } : {}),
    },
  };
}

/** Applies the migration to the file and returns what changed. */
export async function migrateLegacyConfigFile(
  configPath: string,
  rawText: string,
): Promise<LegacyConfigMigration | undefined> {
  const rawConfig = rawText.trim() ? YAML.parse(rawText) : {};
  const planned = planLegacyConfigMigration(rawConfig);
  if (!planned) return undefined;
  await safeWriteFile(configPath, YAML.stringify(planned.nextConfig));
  return planned.migration;
}

/** True if the error comes from rejecting an obsolete `llm.provider` or a removed engine. */
export function isLegacyProviderError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:llm\.provider|llm\.engine|retrieval\.vector\.engine): ".*" is no longer recognized/.test(error.message)
  );
}
