import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import doctorCmd from '../src/commands/doctor.ts';
import { resetProviderRateLimiterForTests } from '../src/services/rateLimiter.ts';
import type { AppConfig } from '../src/types.ts';

const tempRoots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-doctor-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'wiki'), { recursive: true });
  await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
  await mkdir(path.join(root, 'templates'), { recursive: true });
  await mkdir(path.join(root, 'build-context'), { recursive: true });
  await writeFile(path.join(root, 'wiki', 'index.md'), '# Index\n', 'utf8');
  return root;
}

function createConfig(root: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      model: 'configured-model',
      apiKey: 'test-key',
      baseUrl: 'https://provider.test/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 1000,
      maxInFlightRequests: 3,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: true,
      maxBuildContextChars: 24000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: 'https://vector.test/v1',
        apiKey: 'vector-key',
        requestsPerMinute: 1000,
        timeoutMs: 600000,
        embeddingModel: 'test-embedding',
        rerankEnabled: true,
        rerankerModel: 'test-reranker',
        topK: 48,
        rerankTopK: 24,
        maxResults: 6,
      },
    },
    mcp: {},
  };
  return {
    ...base,
    ...overrides,
    llm: { ...base.llm, ...overrides.llm },
    limits: { ...base.limits, ...overrides.limits },
    build: { ...base.build, ...overrides.build },
    retrieval: {
      ...base.retrieval,
      ...overrides.retrieval,
      vector: {
        ...base.retrieval.vector,
        ...overrides.retrieval?.vector,
      },
    },
  };
}

async function captureDoctor(config: AppConfig): Promise<string> {
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    await doctorCmd(config);
  } finally {
    log.mockRestore();
  }
  return lines.join('\n');
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('doctor qualitative diagnostics', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    resetProviderRateLimiterForTests();
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('reports an invalid provider API key as an error', async () => {
    const root = await createWorkspace();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)));

    const output = await captureDoctor(createConfig(root));

    expect(output).toContain('✗ API key invalid or missing');
    expect(output).not.toContain('✓ API key accepted');
    expect(output).toContain('── Doctor status');
    expect(output).toContain('✗ 1 error(s)');
  });

  it('reports a missing non-Ollama model when the provider exposes model IDs', async () => {
    const root = await createWorkspace();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ id: 'other-model' }] })),
    );

    const output = await captureDoctor(createConfig(root));

    expect(output).toContain('✗ Model configured-model not listed by provider');
    expect(output).toContain('other-model');
    expect(output).toContain('✗ 1 error(s)');
  });

  it('classifies a missing rerank endpoint in the vector check output', async () => {
    const root = await createWorkspace();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith('/models')) {
          return jsonResponse({ data: [{ id: 'configured-model' }] });
        }
        if (pathname.endsWith('/embeddings')) {
          return jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
        }
        if (pathname.endsWith('/rerank')) {
          return jsonResponse({ error: 'not found' }, 404);
        }
        return jsonResponse({}, 500);
      }),
    );

    const config = createConfig(root);
    config.retrieval.vector.enabled = true;
    const output = await captureDoctor(config);

    expect(output).toContain('✓ Model configured-model listed by provider');
    expect(output).toContain('✓ embedding test-embedding OK (2 dimensions)');
    expect(output).toContain('⚠ reranker check failed for test-reranker');
    expect(output).toContain('HTTP 404');
    expect(output).toContain('⚠ 0 error(s)');
  });

  it('reports malformed embedding responses instead of passing vector checks', async () => {
    const root = await createWorkspace();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith('/models')) {
          return jsonResponse({ data: [{ id: 'configured-model' }] });
        }
        if (pathname.endsWith('/embeddings')) {
          return jsonResponse({ data: [{ index: 0 }] });
        }
        return jsonResponse({ results: [] });
      }),
    );

    const config = createConfig(root);
    config.retrieval.vector.enabled = true;
    const output = await captureDoctor(config);

    expect(output).toContain('⚠ embedding check failed for test-embedding');
    expect(output).toContain('Embedding response is missing an embedding vector');
    expect(output).not.toContain('✓ embedding test-embedding OK');
    expect(output).toContain('⚠ 0 error(s)');
  });
});
