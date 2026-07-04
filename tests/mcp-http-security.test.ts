import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearSharedMcpServices,
  createMcpRateLimiter,
  getSharedMcpServices,
  mcpServiceContextKey,
  mcpScopesForToken,
  mcpToolScope,
} from '../src/commands/mcpHttp.ts';
import type { AppConfig } from '../src/types.ts';

function config(mcp: AppConfig['mcp']): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    mcp,
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: true,
      slotBatchSize: 5,
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 5,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      vector: {
        enabled: false,
        baseUrl: 'https://example.invalid',
        timeoutMs: 600000,
        embeddingModel: 'embedding',
        rerankEnabled: false,
        rerankerModel: 'rerank',
        topK: 20,
        rerankTopK: 10,
        maxResults: 5,
      },
    },
    llm: {
      provider: 'openai-compatible',
      baseUrl: 'https://example.invalid',
      apiKey: 'test',
      model: 'model',
      timeoutMs: 600000,
      temperature: 0,
    },
  };
}

describe('MCP HTTP security helpers', () => {
  it('maps read and write tools to the required scope', () => {
    expect(mcpToolScope('wiki_read_page')).toBe('read');
    expect(mcpToolScope('wiki_write_page')).toBe('write');
    expect(mcpToolScope('profile_update')).toBe('write');
  });

  it('supports legacy full-access and distinct read/write tokens', () => {
    const scoped = config({
      accessKey: 'legacy',
      readToken: 'read',
      writeToken: 'write',
    });

    expect(mcpScopesForToken(scoped, 'legacy')).toEqual(['read', 'write']);
    expect(mcpScopesForToken(scoped, 'read')).toEqual(['read']);
    expect(mcpScopesForToken(scoped, 'write')).toEqual(['read', 'write']);
    expect(mcpScopesForToken(scoped, 'wrong')).toBeNull();
  });

  it('allows local unauthenticated mode only when no token is configured', () => {
    expect(mcpScopesForToken(config({}), undefined)).toEqual(['read', 'write']);
    expect(mcpScopesForToken(config({ readToken: 'read' }), undefined)).toBeNull();
  });

  it('rate limits by rolling window', () => {
    const limiter = createMcpRateLimiter({ limit: 2, windowMs: 1000 });

    expect(limiter.check('client', 1000).ok).toBe(true);
    expect(limiter.check('client', 1100).ok).toBe(true);
    const blocked = limiter.check('client', 1200);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check('client', 2101).ok).toBe(true);
  });

  it('keys shared MCP services by workspace and retrieval config without secrets', () => {
    const first = config({ readToken: 'read-a', writeToken: 'write-a' });
    first.wikiRoot = '/tmp/wiki-a';
    first.retrieval.maxContextFiles = 5;
    const second = config({ readToken: 'read-b', writeToken: 'write-b' });
    second.wikiRoot = '/tmp/wiki-b';
    second.retrieval.maxContextFiles = 9;

    const firstKey = mcpServiceContextKey(first);
    const secondKey = mcpServiceContextKey(second);

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).not.toContain('read-a');
    expect(firstKey).not.toContain('write-a');
  });

  it('reuses shared MCP services until the context TTL expires', async () => {
    const previousTtl = process.env.WIKI_MCP_CONTEXT_TTL_MS;
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-mcp-http-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Index\n', 'utf8');
    const appConfig = config({});
    appConfig.wikiRoot = root;
    process.env.WIKI_MCP_CONTEXT_TTL_MS = '50';
    clearSharedMcpServices();

    try {
      const first = await getSharedMcpServices(appConfig, 1000);
      const second = await getSharedMcpServices(appConfig, 1025);
      const third = await getSharedMcpServices(appConfig, 1100);

      expect(second).toBe(first);
      expect(third).not.toBe(first);
    } finally {
      clearSharedMcpServices();
      if (previousTtl === undefined) delete process.env.WIKI_MCP_CONTEXT_TTL_MS;
      else process.env.WIKI_MCP_CONTEXT_TTL_MS = previousTtl;
    }
  });
});
