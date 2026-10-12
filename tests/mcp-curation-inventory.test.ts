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

describe('wiki_curation_inventory MCP tool', () => {
  async function setup() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-mcp-inventory-'));
    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    await workspace.initWorkspace({});
    const fiche = (title: string, tags: string, body: string) =>
      `---\ntitle: ${title}\ntags: ${tags}\n---\n\n${body}\n`;
    await mkdir(path.join(root, 'wiki', 'sources', 'doc'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'answers'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'sources', 'doc', 'a.md'), fiche('A', '["Réseau", "hyperviseur"]', 'Description: same text.'), 'utf8');
    await writeFile(path.join(root, 'wiki', 'sources', 'doc', 'b.md'), fiche('B', '["hyperviseur"]', 'Description: same text.'), 'utf8');
    await writeFile(path.join(root, 'wiki', 'sources', 'doc', 'c.md'), '# C\n\nTags: #alpha #beta\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'sources', 'doc', 'empty.md'), `---\ntitle: ${'x'.repeat(400)}\n---\n`, 'utf8');
    await writeFile(path.join(root, 'wiki', 'answers', 'q.md'), '# Q\n', 'utf8');
    const server = await createWikiMcpServer(config, { workspace, retrieval: { invalidateCache() {} } as never });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { root, client };
  }

  it('reads tags from the frontmatter, counts body characters and groups exact duplicates', async () => {
    const { client } = await setup();
    const payload = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: {} }));
    const pages = payload.pages as Array<{ path: string; tags: string[]; chars: number }>;
    const byPath = Object.fromEntries(pages.map((page) => [page.path, page]));
    expect(byPath['wiki/sources/doc/a.md']?.tags).toEqual(['hyperviseur', 'réseau'].sort());
    expect(byPath['wiki/sources/doc/c.md']?.tags).toEqual(['alpha', 'beta']);
    expect(byPath['wiki/sources/doc/empty.md']?.chars).toBe(0);
    expect(payload.exactDuplicates).toEqual([['wiki/sources/doc/a.md', 'wiki/sources/doc/b.md']]);
    await client.close();
  });

  it('keeps the answer type in wiki_list_pages', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'wiki_list_pages', arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(text).toContain('wiki/answers/q.md [answer]');
    expect(text).toContain('wiki/sources/doc/a.md [source]');
    await client.close();
  });

  it('pages through the same inventory and reflects a removed fiche', async () => {
    const { root, client } = await setup();
    const first = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: { limit: 2 } }));
    expect(first.total).toBe(4);
    expect(first.nextCursor).toBe(2);
    await rm(path.join(root, 'wiki', 'sources', 'doc', 'b.md'));
    const after = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: {} }));
    expect(after.total).toBe(3);
    expect(after.exactDuplicates).toEqual([]);
    await client.close();
  });
});
