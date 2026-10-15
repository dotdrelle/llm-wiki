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
    const payload = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: { view: 'pages' } }));
    const summary = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: {} }));
    const pages = payload.pages as Array<{ path: string; tags: string[]; chars: number }>;
    const byPath = Object.fromEntries(pages.map((page) => [page.path, page]));
    expect(byPath['wiki/sources/doc/a.md']?.tags).toEqual(['hyperviseur', 'réseau'].sort());
    expect(byPath['wiki/sources/doc/c.md']?.tags).toEqual(['alpha', 'beta']);
    expect(byPath['wiki/sources/doc/empty.md']?.chars).toBe(0);
    expect(summary.exactDuplicates).toEqual([['wiki/sources/doc/a.md', 'wiki/sources/doc/b.md']]);
    expect(summary.pages).toBeUndefined();
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
    const first = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: { view: 'pages', limit: 2 } }));
    expect(first.total).toBe(4);
    expect(first.nextCursor).toBe(2);
    await rm(path.join(root, 'wiki', 'sources', 'doc', 'b.md'));
    const after = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: { view: 'pages' } }));
    expect(after.total).toBe(3);
    const afterSummary = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: {} }));
    expect(afterSummary.exactDuplicates).toEqual([]);
    await client.close();
  });

  it('extends to concept pivots with deterministic signals, each with its owner', async () => {
    const { root, client } = await setup();
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    await writeFile(path.join(root, 'raw', 'ingested', 'doc.md'), '# Doc\n', 'utf8');
    await mkdir(path.join(root, 'wiki', 'concepts', 'fam'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'sources', 'doc', 'cited.md'),
      '---\ntitle: Cited\ntags: [hyperviseur]\nsources:\n  - path: raw/ingested/doc.md\n---\n\nBody [src: raw/ingested/doc.md] and [x](../gone.md) [[nowhere]].\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'concepts', 'fam', 'hyperviseur.md'),
      '---\ntitle: Hyperviseur\ntags: [hyperviseur]\nsheet_count: 3\nstatus: draft\ngenerated:\n  by: llm-wiki-tags\nsources:\n  - path: raw/ingested/doc.md\n---\n\n- [src: wiki/sources/doc/cited.md]\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'concepts', 'fam', 'orphan.md'),
      '---\ntitle: Orphan\ntags: [ghost]\nstatus: draft\ngenerated:\n  by: llm-wiki-tags\nsources: raw/ingested/doc.md\n---\n\n- [src: wiki/sources/doc/vanished.md]\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'concepts', 'fam', 'kept.md'),
      '---\ntitle: Kept\ntags: [hyperviseur]\nstatus: stable\nverified:\n  - by: human:merge\n    at: now\n---\n\n- [src: wiki/sources/doc/cited.md]\n', 'utf8');
    const payload = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: {} }));
    const counts = payload.counts as Record<string, unknown>;
    expect(counts.concepts).toBe(3);
    expect(payload.editorialPages).toEqual(['wiki/concepts/fam/kept.md']);
    const signals = payload.signals as Array<{ path: string; signal: string; owner: string; detail?: string }>;
    const of = (pagePath: string) => signals.filter((signal) => signal.path === pagePath);
    expect(of('wiki/sources/doc/cited.md').map((s) => s.signal).sort()).toEqual(['broken-link']);
    expect(of('wiki/sources/doc/cited.md')[0]).toMatchObject({ owner: 'curation' });
    expect(of('wiki/sources/doc/cited.md')[0]?.detail).toContain('[[nowhere]]');
    expect(of('wiki/concepts/fam/hyperviseur.md')).toEqual([
      expect.objectContaining({ signal: 'pivot-sheet-count-mismatch', owner: 'rebuild' }),
    ]);
    expect(of('wiki/concepts/fam/orphan.md').map((s) => s.signal).sort()).toEqual([
      'broken-citation', 'invalid-sources', 'pivot-tag-not-carried', 'pivot-without-fiche-citation',
    ]);
    expect(of('wiki/concepts/fam/orphan.md').every((s) => s.owner === 'rebuild')).toBe(true);
    expect(of('wiki/concepts/fam/kept.md').map((s) => [s.signal, s.owner])).toEqual([['missing-sources', 'editorial']]);
    // Fiches written before sources: was derived say so too.
    expect(of('wiki/sources/doc/a.md').map((s) => s.signal)).toEqual(['missing-sources']);
    const conceptsOnly = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: { view: 'pages', scope: 'concepts' } }));
    expect((conceptsOnly.pages as Array<{ kind: string }>).every((page) => page.kind === 'concept')).toBe(true);
    await client.close();
  });

  it('returns candidate groups as reading batches of at most 25, never as duplicates', async () => {
    const { root, client } = await setup();
    for (let index = 0; index < 30; index += 1) {
      await writeFile(path.join(root, 'wiki', 'sources', 'doc', `wide-${String(index).padStart(2, '0')}.md`),
        `---\ntitle: Wide ${index}\ntags: [wide]\n---\n\nDistinct body ${index} [src: raw/ingested/big.md]\n`, 'utf8');
    }
    const payload = textPayload(await client.callTool({ name: 'wiki_curation_inventory', arguments: { view: 'candidates', limit: 100 } }));
    expect(String(payload.note)).toMatch(/not findings/);
    const batches = payload.batches as Array<{ reason: string; key: string; size: number; part: number; parts: number; paths: string[] }>;
    // Narrowest first: the two-fiche hyperviseur group leads.
    expect(batches[0]).toMatchObject({ reason: 'shared-tag', key: 'hyperviseur', size: 2, parts: 1 });
    const wide = batches.filter((batch) => batch.key === 'wide');
    expect(wide.map((batch) => [batch.part, batch.parts, batch.paths.length])).toEqual([[1, 2, 25], [2, 2, 5]]);
    expect(batches.some((batch) => batch.reason === 'shared-source' && batch.key === 'raw/ingested/big.md')).toBe(false);
    expect(batches.every((batch) => batch.paths.length <= 25)).toBe(true);
    await client.close();
  });
});
