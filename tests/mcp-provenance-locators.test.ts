import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
      buildStrategy: 'bm25',
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

describe('wiki_list_provenance_locators MCP tool', () => {
  it('exposes the catalogue of a raw archive and refuses other trees', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-mcp-locators-'));
    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    await workspace.initWorkspace({});
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    await writeFile(path.join(root, 'raw', 'ingested', 'doc.md'), '# Doc\n\n## Coûts\n\n90 k€.\n', 'utf8');

    const server = await createWikiMcpServer(config, {
      workspace,
      retrieval: { invalidateCache() {} } as never,
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'wiki_list_provenance_locators')).toBe(true);

      const payload = textPayload(
        await client.callTool({
          name: 'wiki_list_provenance_locators',
          arguments: { path: 'raw/ingested/doc.md' },
        }),
      );
      const tokens = (payload.locators as Array<{ token: string }>).map((entry) => entry.token);
      expect(tokens).toContain('section:Doc > Coûts');
      // The catalogue never carries a materialized offset or hash.
      expect(JSON.stringify(payload)).not.toMatch(/sha256=/);

      const refused = await client.callTool({
        name: 'wiki_list_provenance_locators',
        arguments: { path: 'wiki/concepts/demo/a.md' },
      });
      expect(refused.isError).toBe(true);

      // The catalogue is queryable and paged, not paged blind.
      const filtered = textPayload(
        await client.callTool({
          name: 'wiki_list_provenance_locators',
          arguments: { path: 'raw/ingested/doc.md', query: 'Coûts' },
        }),
      );
      expect(filtered.total).toBe(1);
      const none = textPayload(
        await client.callTool({
          name: 'wiki_list_provenance_locators',
          arguments: { path: 'raw/ingested/doc.md', query: 'Absent' },
        }),
      );
      expect(none.total).toBe(0);
      const paged = textPayload(
        await client.callTool({
          name: 'wiki_list_provenance_locators',
          arguments: { path: 'raw/ingested/doc.md', limit: 1 },
        }),
      );
      expect((paged.locators as unknown[]).length).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
