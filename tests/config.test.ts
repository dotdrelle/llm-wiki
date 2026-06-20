import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loadConfig.ts';
import { resolveConfig } from '../src/config/schema.ts';

describe('config resolution', () => {
  afterEach(() => {
    delete process.env.WIKI_MCP_AUTH_TOKEN;
    delete process.env.WIKI_MCP_TLS_CERT_PATH;
    delete process.env.WIKI_MCP_TLS_KEY_PATH;
    delete process.env.WIKI_MCP_TLS_CA_PATH;
    delete process.env.WIKI_SERVE_TLS_CERT_PATH;
    delete process.env.WIKI_SERVE_TLS_KEY_PATH;
    delete process.env.WIKI_SERVE_TLS_CA_PATH;
    delete process.env.WIKI_CONFIG_PATH;
    delete process.env.WIKI_WORKSPACE;
    delete process.env.WIKI_WORKSPACE_PATH;
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
      rerankEnabled: true,
      rerankerModel: 'BAAI/bge-reranker-v2-m3',
      topK: 40,
      rerankTopK: 80,
      maxResults: 6,
    });
  });

  it('disables vector retrieval by default', () => {
    const config = resolveConfig({}, '/tmp/wiki');

    expect(config.retrieval.vector.enabled).toBe(false);
  });

  it('parses disabled vector reranking', () => {
    const config = resolveConfig(
      {
        retrieval: {
          vector: {
            rerankEnabled: false,
          },
        },
      },
      '/tmp/wiki',
    );

    expect(config.retrieval.vector.rerankEnabled).toBe(false);
  });

  it('parses MCP access key and ignores YAML TLS paths', () => {
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
      tls: undefined,
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

  it('keeps .wikirc MCP access key ahead of environment overrides and reads TLS from env', () => {
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
        certPath: '/certs/env-fullchain.pem',
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

  it('prefers WIKI_WORKSPACE_PATH when loading config', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-config-env-'));
    const other = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-config-other-'));
    await writeFile(
      path.join(root, '.wikirc.yaml'),
      ['llm:', '  provider: ollama', '  model: llama3.1'].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(other, '.wikirc.yaml'),
      ['llm:', '  provider: openai', '  model: gpt-4o'].join('\n'),
      'utf8',
    );
    process.env.WIKI_WORKSPACE_PATH = root;

    const config = await loadConfig(other);

    expect(config.wikiRoot).toBe(root);
    expect(config.llm.provider).toBe('ollama');
    expect(config.llm.model).toBe('llama3.1');
  });

  it('loads explicit WIKI_CONFIG_PATH inside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-config-explicit-'));
    await writeFile(
      path.join(root, '.wikirc.yaml'),
      ['llm:', '  provider: ollama', '  model: default-model'].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(root, '.wikirc.yaml.openai'),
      ['llm:', '  provider: openai', '  model: gpt-4o'].join('\n'),
      'utf8',
    );
    process.env.WIKI_WORKSPACE_PATH = root;
    process.env.WIKI_CONFIG_PATH = '.wikirc.yaml.openai';

    const config = await loadConfig(root);

    expect(config.configPath).toBe(path.join(root, '.wikirc.yaml.openai'));
    expect(config.wikiRoot).toBe(root);
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.model).toBe('gpt-4o');
  });
});
