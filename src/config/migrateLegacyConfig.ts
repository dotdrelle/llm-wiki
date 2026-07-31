import YAML from 'yaml';
import { safeWriteFile } from '../utils/fs.ts';
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
} from './defaults.ts';
import type { LlmEngine } from '../types.ts';

/**
 * Migration des `.wikirc.yaml` antérieurs à 0.16.
 *
 * `llm.provider` portait deux axes à la fois : où l'on tape et comment se
 * comporte le serveur en face. Ils sont désormais séparés en `provider`
 * (`openai-compatible` | `ai-gateway`) et `engine`.
 *
 * Cette table vit ici — appelée uniquement par `wiki doctor --apply` — et non
 * dans `resolveConfig`, pour ne pas grever le chemin de lecture d'une
 * normalisation permanente. Elle est supprimable d'un bloc à la 1.0.
 */

interface LegacyMapping {
  engine: LlmEngine;
  /**
   * `resolveConfig` dérivait la baseUrl du provider quand elle était absente.
   * On la matérialise à la migration : c'est la seule façon de garantir que le
   * fichier migré cible exactement le même endpoint qu'avant.
   */
  defaultBaseUrl: string;
}

const LEGACY_PROVIDERS: Record<string, LegacyMapping> = {
  openai: { engine: 'openai', defaultBaseUrl: DEFAULT_OPENAI_BASE_URL },
  ollama: { engine: 'ollama', defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL },
  anthropic: { engine: 'anthropic', defaultBaseUrl: DEFAULT_ANTHROPIC_BASE_URL },
};

/**
 * Heuristique de dernier recours, appliquée une seule fois, pour les anciens
 * `openai-compatible` qui n'avaient pas de moteur déclaré. Elle reprend le
 * `looksLikeMlx()` que `doctor` appliquait à chaque exécution — après la
 * migration, le moteur est déclaré et plus rien n'est deviné.
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
  /** Ancienne valeur de `llm.provider`, telle qu'elle figurait dans le fichier. */
  from: string;
  /** Nouvelle paire, pour l'affichage. */
  to: { provider: string; engine: LlmEngine };
  /** Vrai si la baseUrl, jusqu'ici implicite, a dû être matérialisée. */
  materializedBaseUrl?: string;
}

/**
 * Détecte un ancien format et calcule sa réécriture, sans rien écrire.
 * Renvoie `undefined` si le fichier est déjà au format courant.
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

  // Déjà migré : provider courant et engine déclaré.
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

/** Applique la migration au fichier et renvoie ce qui a changé. */
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

/** Vrai si l'erreur provient du rejet d'un `llm.provider` obsolète. */
export function isLegacyProviderError(error: unknown): boolean {
  return (
    error instanceof Error && /llm\.provider: ".*" is no longer recognized/.test(error.message)
  );
}
