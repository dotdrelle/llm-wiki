import YAML from 'yaml';
import { safeWriteFile } from '../utils/fs.ts';
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
} from './defaults.ts';
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
  anthropic: { engine: 'anthropic', defaultBaseUrl: DEFAULT_ANTHROPIC_BASE_URL },
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
  /** New pair, for display. */
  to: { provider: string; engine: LlmEngine };
  /** True if the baseUrl, implicit until now, had to be materialized. */
  materializedBaseUrl?: string;
}

/**
 * Detects an old format and computes its rewrite, without writing anything.
 * Returns `undefined` if the file is already in the current format.
 */
export function planLegacyConfigMigration(
  rawConfig: unknown,
): { nextConfig: Record<string, unknown>; migration: LegacyConfigMigration } | undefined {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return undefined;
  }
  const root = rawConfig as Record<string, unknown>;
  const llm = root.llm;
  if (!llm || typeof llm !== 'object' || Array.isArray(llm)) return undefined;
  const llmBlock = llm as Record<string, unknown>;
  const provider = llmBlock.provider;
  if (typeof provider !== 'string') return undefined;

  // Already migrated: current provider and declared engine.
  if (provider === 'ai-gateway') return undefined;
  if (provider === 'openai-compatible' && typeof llmBlock.engine === 'string') {
    return undefined;
  }

  const mapping = LEGACY_PROVIDERS[provider];
  const engine: LlmEngine = mapping?.engine ?? guessLocalEngine(llmBlock);
  const hasBaseUrl = typeof llmBlock.baseUrl === 'string' && llmBlock.baseUrl.length > 0;
  const materializedBaseUrl =
    !hasBaseUrl && mapping ? mapping.defaultBaseUrl : undefined;

  if (provider !== 'openai-compatible' && !mapping) return undefined;

  return {
    nextConfig: {
      ...root,
      llm: {
        ...llmBlock,
        provider: 'openai-compatible',
        engine,
        ...(materializedBaseUrl ? { baseUrl: materializedBaseUrl } : {}),
      },
    },
    migration: {
      from: provider,
      to: { provider: 'openai-compatible', engine },
      ...(materializedBaseUrl ? { materializedBaseUrl } : {}),
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

/** True if the error comes from rejecting an obsolete `llm.provider`. */
export function isLegacyProviderError(error: unknown): boolean {
  return (
    error instanceof Error && /llm\.provider: ".*" is no longer recognized/.test(error.message)
  );
}
