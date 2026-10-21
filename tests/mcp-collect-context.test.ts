import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createWikiMcpServer } from '../src/services/mcpServer.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'en',
    mcp: {},
    limits: { requestsPerMinute: 10, maxInputTokensPerCall: 50000, targetInputTokensPerCall: 40000, maxProfileChars: 4000 },
    build: { refreshOnIngest: true, slotBatchSize: 5, maxBuildContextChars: 12000 },
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
      engine: 'generic',
      baseUrl: 'https://example.invalid',
      apiKey: 'test',
      model: 'model',
      timeoutMs: 600000,
      temperature: 0,
    },
  };
}

function textPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error('Expected MCP result content array');
  const item = content.find(
    (entry): entry is { type: 'text'; text: string } =>
      Boolean(entry) && typeof entry === 'object' && (entry as { type?: unknown }).type === 'text',
  );
  if (!item) throw new Error('Expected text MCP result');
  return JSON.parse(item.text) as Record<string, unknown>;
}

describe('wiki_collect_context', () => {
  it('excludes attached page paths and reports the diagnostics of the same search', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-collect-context-'));
    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    await workspace.initWorkspace({});
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'concepts', 'a.md'), '# A\n\nA CONTENT\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'concepts', 'b.md'), '# B\n\nB CONTENT\n', 'utf8');

    const searchCalls: unknown[] = [];
    const retrieval = {
      invalidateCache() {},
      async searchWithDiagnostics(_query: string, options: unknown) {
        searchCalls.push(options);
        return {
          results: [
            {
              page: { relativePath: 'wiki/concepts/a.md', type: 'concept', content: '# A\n\nA CONTENT\n' },
              score: 10,
            },
            {
              page: { relativePath: 'wiki/concepts/b.md', type: 'concept', content: '# B\n\nB CONTENT\n' },
              score: 9,
            },
          ],
          diagnostics: { mode: 'hybrid', reason: null },
        };
      },
    };
    const server = await createWikiMcpServer(config, { workspace, retrieval: retrieval as never });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const payload = textPayload(await client.callTool({
        name: 'wiki_collect_context',
        arguments: { question: 'compare A and B', excludePaths: ['wiki/concepts/a.md'] },
      }));
      expect(searchCalls).toHaveLength(1);
      expect(searchCalls[0]).toMatchObject({ limit: 11, includeRaw: true });
      expect((payload.candidateResults as Array<{ path: string }>).map((result) => result.path))
        .toEqual(['wiki/concepts/b.md']);
      expect(payload.readPagePaths).toEqual(['wiki/concepts/b.md']);
      expect(payload.retrieval).toEqual({ mode: 'hybrid', reason: null });
    } finally {
      await client.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
