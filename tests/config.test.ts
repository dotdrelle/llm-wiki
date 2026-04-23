import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loadConfig.ts';
import { resolveConfig } from '../src/config/schema.ts';

describe('config resolution', () => {
  it('defaults Ollama base URL when provider is ollama', () => {
    const config = resolveConfig(
      {
        llm: {
          provider: 'ollama',
          model: 'qwen2.5:14b',
        },
      },
      '/tmp/wiki',
    );

    expect(config.llm.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(config.llm.apiKey).toBe('ollama');
    expect(config.llm.timeoutMs).toBe(600000);
  });

  it('requires baseUrl for openai-compatible provider', () => {
    expect(() =>
      resolveConfig(
        {
          llm: {
            provider: 'openai-compatible',
            model: 'custom-model',
          },
        },
        '/tmp/wiki',
      ),
    ).toThrow(/requires llm\.baseUrl/i);
  });

  it('loads config from parent directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-config-'));
    const nested = path.join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(root, '.wikirc.yaml'),
      ['llm:', '  provider: ollama', '  model: llama3.1'].join('\n'),
      'utf8',
    );

    const config = await loadConfig(nested);
    expect(config.wikiRoot).toBe(root);
    expect(config.llm.provider).toBe('ollama');
  });
});
