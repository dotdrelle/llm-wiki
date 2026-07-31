import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  isLegacyProviderError,
  migrateLegacyConfigFile,
  planLegacyConfigMigration,
} from '../src/config/migrateLegacyConfig.ts';
import { resolveConfig } from '../src/config/schema.ts';

/**
 * Migration des wikirc antérieurs à 0.16 — plan-implementation-engine-gateway.md,
 * commit 3.
 *
 * L'invariant testé est le seul qui compte : un fichier migré doit charger
 * sans erreur ET viser exactement le même endpoint qu'avant.
 */

describe('migration du format llm.provider', () => {
  it('rejette les anciens providers avec un message actionnable', () => {
    for (const provider of ['openai', 'ollama', 'anthropic']) {
      let caught: unknown;
      try {
        resolveConfig({ llm: { provider, model: 'm' } }, '/tmp/wiki');
      } catch (error) {
        caught = error;
      }
      expect(isLegacyProviderError(caught)).toBe(true);
      expect((caught as Error).message).toContain('wiki doctor --apply');
      expect((caught as Error).message).toContain(`engine: ${provider}`);
    }
  });

  it.each([
    ['openai', 'openai', 'https://api.openai.com/v1'],
    ['ollama', 'ollama', 'http://127.0.0.1:11434/v1'],
    ['anthropic', 'anthropic', 'https://api.anthropic.com/v1'],
  ])(
    'migre provider %s en engine %s et matérialise la baseUrl implicite',
    (legacy, engine, expectedBaseUrl) => {
      const planned = planLegacyConfigMigration({
        llm: { provider: legacy, model: 'a-model' },
      });

      expect(planned).toBeDefined();
      expect(planned?.migration.to).toEqual({ provider: 'openai-compatible', engine });
      expect(planned?.migration.materializedBaseUrl).toBe(expectedBaseUrl);

      // L'invariant : le fichier migré cible le même endpoint qu'avant.
      const config = resolveConfig(planned!.nextConfig, '/tmp/wiki');
      expect(config.llm.provider).toBe('openai-compatible');
      expect(config.llm.engine).toBe(engine);
      expect(config.llm.baseUrl).toBe(expectedBaseUrl);
    },
  );

  it('conserve une baseUrl explicite', () => {
    const planned = planLegacyConfigMigration({
      llm: { provider: 'ollama', model: 'qwen2.5', baseUrl: 'http://gpu.local:11434/v1' },
    });
    expect(planned?.migration.materializedBaseUrl).toBeUndefined();
    expect(resolveConfig(planned!.nextConfig, '/tmp/wiki').llm.baseUrl).toBe(
      'http://gpu.local:11434/v1',
    );
  });

  it.each([
    ['http://localhost:8080/v1', 'a-model', 'mlx'],
    ['http://localhost:9000/v1', 'mlx-community/qwen', 'mlx'],
    ['https://albert.api.etalab.gouv.fr/v1', 'a-model', 'albert'],
    ['http://localhost:8000/v1', 'a-model', 'vllm'],
    ['http://localhost:9999/v1', 'a-model', 'generic'],
  ])(
    'devine le moteur une dernière fois pour un ancien openai-compatible (%s)',
    (baseUrl, model, engine) => {
      const planned = planLegacyConfigMigration({
        llm: { provider: 'openai-compatible', model, baseUrl },
      });
      expect(planned?.migration.to.engine).toBe(engine);
    },
  );

  it('ne touche pas un fichier déjà migré', () => {
    expect(
      planLegacyConfigMigration({
        llm: { provider: 'openai-compatible', engine: 'ollama', model: 'm' },
      }),
    ).toBeUndefined();
    expect(
      planLegacyConfigMigration({
        llm: { provider: 'ai-gateway', model: 'anthropic/claude', baseUrl: 'http://g/v1' },
      }),
    ).toBeUndefined();
  });

  it('réécrit le fichier sur disque en préservant les autres clés', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-migrate-'));
    const configPath = path.join(root, '.wikirc.yaml');
    await writeFile(
      configPath,
      [
        'language: fr',
        'llm:',
        '  provider: ollama',
        '  model: qwen2.5',
        '  numCtx: 32768',
        'limits:',
        '  requestsPerMinute: 50',
      ].join('\n'),
      'utf8',
    );

    const migration = await migrateLegacyConfigFile(
      configPath,
      await readFile(configPath, 'utf8'),
    );

    expect(migration?.to.engine).toBe('ollama');
    const rewritten = YAML.parse(await readFile(configPath, 'utf8'));
    expect(rewritten.llm.provider).toBe('openai-compatible');
    expect(rewritten.llm.engine).toBe('ollama');
    expect(rewritten.llm.numCtx).toBe(32768);
    expect(rewritten.language).toBe('fr');
    expect(rewritten.limits.requestsPerMinute).toBe(50);

    // Et il charge.
    expect(resolveConfig(rewritten, root).llm.engine).toBe('ollama');
  });
});
