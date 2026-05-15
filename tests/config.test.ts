import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loadConfig.ts';
import { resolveConfig } from '../src/config/schema.ts';

describe('config resolution', () => {
  afterEach(() => {
    delete process.env.WIKI_MCP_AUTH_TOKEN;
    delete process.env.WIKI_MCP_ACCESS_KEY;
    delete process.env.WIKI_MCP_KEY;
    delete process.env.WIKI_MCP_TLS_CERT_PATH;
    delete process.env.WIKI_MCP_TLS_KEY_PATH;
    delete process.env.WIKI_MCP_TLS_CA_PATH;
  });

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
    expect(config.build.refreshOnIngest).toBe(true);
  });

  it('parses build refreshOnIngest', () => {
    const config = resolveConfig(
      {
        build: {
          refreshOnIngest: false,
        },
      },
      '/tmp/wiki',
    );

    expect(config.build.refreshOnIngest).toBe(false);
  });

  it('parses vector retrieval settings with defaults', () => {
    const config = resolveConfig(
      {
        retrieval: {
          vector: {
            enabled: true,
            topK: 40,
          },
        },
      },
      '/tmp/wiki',
    );

    expect(config.retrieval.vector).toEqual({
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: undefined,
      timeoutMs: 600000,
      embeddingModel: 'BAAI/bge-m3',
      rerankerModel: 'BAAI/bge-reranker-v2-m3',
      topK: 40,
      rerankTopK: 80,
      maxResults: 6,
    });
  });

  it('enables vector retrieval by default', () => {
    const config = resolveConfig({}, '/tmp/wiki');

    expect(config.retrieval.vector.enabled).toBe(true);
  });

  it('parses MCP access key and TLS paths', () => {
    const config = resolveConfig(
      {
        mcp: {
          accessKey: 'secret',
          tls: {
            certPath: 'certs/fullchain.pem',
            keyPath: 'certs/privkey.pem',
            caPath: 'certs/ca.pem',
          },
        },
      },
      '/tmp/wiki',
    );

    expect(config.mcp).toEqual({
      accessKey: 'secret',
      tls: {
        certPath: 'certs/fullchain.pem',
        keyPath: 'certs/privkey.pem',
        caPath: 'certs/ca.pem',
      },
    });
  });

  it('treats an empty MCP section as default config', () => {
    const config = resolveConfig({ mcp: null }, '/tmp/wiki');

    expect(config.mcp).toEqual({});
  });

  it('reads MCP settings from environment variables', () => {
    process.env.WIKI_MCP_AUTH_TOKEN = 'env-secret';
    process.env.WIKI_MCP_TLS_CERT_PATH = '/certs/fullchain.pem';
    process.env.WIKI_MCP_TLS_KEY_PATH = '/certs/privkey.pem';
    process.env.WIKI_MCP_TLS_CA_PATH = '/certs/ca.pem';

    const config = resolveConfig({}, '/tmp/wiki');

    expect(config.mcp).toEqual({
      accessKey: 'env-secret',
      tls: {
        certPath: '/certs/fullchain.pem',
        keyPath: '/certs/privkey.pem',
        caPath: '/certs/ca.pem',
      },
    });
  });

  it('keeps .wikirc MCP settings ahead of environment overrides', () => {
    process.env.WIKI_MCP_AUTH_TOKEN = 'env-secret';
    process.env.WIKI_MCP_TLS_CERT_PATH = '/certs/env-fullchain.pem';

    const config = resolveConfig(
      {
        mcp: {
          accessKey: 'yaml-secret',
          tls: {
            certPath: 'certs/fullchain.pem',
            keyPath: 'certs/privkey.pem',
          },
        },
      },
      '/tmp/wiki',
    );

    expect(config.mcp).toEqual({
      accessKey: 'yaml-secret',
      tls: {
        certPath: 'certs/fullchain.pem',
        keyPath: 'certs/privkey.pem',
      },
    });
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
