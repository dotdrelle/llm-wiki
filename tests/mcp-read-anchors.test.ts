import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createWikiMcpServer } from '../src/services/mcpServer.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import { materializeLineAnchor } from '../src/provenance/locators.ts';
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

async function withServer(run: (client: Client, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-read-anchors-'));
  const config = createConfig(root);
  const workspace = new WorkspaceService(config);
  await workspace.initWorkspace({});
  const server = await createWikiMcpServer(config, {
    workspace,
    retrieval: { invalidateCache() {} } as never,
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(client, root);
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}

const SOURCE = [
  '---',
  'title: Test',
  '---',
  '# Top',
  '',
  'intro',
  '',
  '## Sub',
  '',
  'SUBSECTION CONTENT',
  '',
  '## Other',
  '',
  'OTHER CONTENT',
  '',
  '## Dup',
  '',
  'one',
  '',
  '# Dup',
  '',
  'two',
  '',
].join('\n');

describe('wiki_read_pages references', () => {
  it('resolves nested headings, full paths, stale anchors, ambiguity and locked reports', async () => {
    await withServer(async (client, root) => {
      await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
      await mkdir(path.join(root, 'raw', 'untracked', 'Donna'), { recursive: true });
      await writeFile(path.join(root, 'raw', 'ingested', 'source.md'), SOURCE, 'utf8');
      await writeFile(
        path.join(root, 'raw', 'untracked', 'Donna', 'report.md.lock'),
        '# Report\n\nREPORT CONTENT\n',
        'utf8',
      );
      const payload = textPayload(await client.callTool({
        name: 'wiki_read_pages',
        arguments: {
          paths: [
            'raw/ingested/source.md#Sub',
            'raw/ingested/source.md#Top > Sub',
            'raw/ingested/source.md#Nope',
            'raw/ingested/source.md#Dup',
            'raw/untracked/Donna/report.md.lock',
          ],
          maxTotalChars: 12_000,
        },
      }));
      const pages = payload.pages as Array<Record<string, unknown>>;
      expect(pages).toHaveLength(5);
      expect(pages[0].status).toBe('read');
      expect(pages[0].anchorStatus).toBe('resolved');
      expect(String(pages[0].content)).toContain('SUBSECTION CONTENT');
      expect(String(pages[0].content)).not.toContain('OTHER CONTENT');
      expect(pages[1].status).toBe('read');
      expect(pages[2].status).toBe('anchor-missing');
      expect(pages[2].content).toBe('');
      expect(pages[3].status).toBe('anchor-ambiguous');
      expect(pages[3].alternatives).toEqual(expect.arrayContaining(['Top > Dup', 'Dup']));
      expect(pages[4].status).toBe('read');
      expect(String(pages[4].content)).toContain('REPORT CONTENT');
      const coverage = payload.coverage as Record<string, unknown>;
      expect(coverage.covered).toBe(3);
      expect(coverage.incomplete).toBe(true);
    });
  });

  it('reports over-budget references instead of dropping them', async () => {
    await withServer(async (client, root) => {
      await mkdir(path.join(root, 'wiki'), { recursive: true });
      await writeFile(path.join(root, 'wiki', 'large-a.md'), `# A\n\n${'a'.repeat(1500)}\n`, 'utf8');
      await writeFile(path.join(root, 'wiki', 'large-b.md'), `# B\n\n${'b'.repeat(1500)}\n`, 'utf8');
      const payload = textPayload(await client.callTool({
        name: 'wiki_read_pages',
        arguments: {
          paths: ['wiki/large-a.md', 'wiki/large-b.md'],
          maxTotalChars: 1_000,
        },
      }));
      const pages = payload.pages as Array<Record<string, unknown>>;
      expect(pages).toHaveLength(2);
      expect(pages[0].status).toBe('partial');
      expect(pages[1].status).toBe('over-budget');
      expect(pages[1].content).toBe('');
      const coverage = payload.coverage as Record<string, unknown>;
      expect(coverage.overBudget).toBe(1);
      expect(coverage.charBudget).toBe(1_000);
      expect(Number(coverage.charsUsed)).toBeLessThanOrEqual(1_000);
    });
  });

  it('reads an exact line anchor and refuses a fabricated one without widening', async () => {
    await withServer(async (client, root) => {
      await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
      const sourcePath = path.join(root, 'raw', 'ingested', 'source.md');
      await writeFile(sourcePath, SOURCE, 'utf8');
      const lines = SOURCE.split('\n');
      const line = lines.indexOf('SUBSECTION CONTENT') + 1;
      const anchor = materializeLineAnchor(SOURCE, line, line);
      expect(anchor).toBeTruthy();
      const payload = textPayload(await client.callTool({
        name: 'wiki_read_pages',
        arguments: { paths: [`raw/ingested/source.md#${anchor}`] },
      }));
      const page = (payload.pages as Array<Record<string, unknown>>)[0];
      expect(page.status).toBe('read');
      expect(page.content).toBe('SUBSECTION CONTENT');
    });
  });

  it('wiki_read_page names an unresolved anchor and returns the section when resolved', async () => {
    await withServer(async (client, root) => {
      await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
      await writeFile(path.join(root, 'raw', 'ingested', 'source.md'), SOURCE, 'utf8');
      const resolved = await client.callTool({
        name: 'wiki_read_page',
        arguments: { path: 'raw/ingested/source.md#Sub' },
      });
      expect(resolved.isError).toBeFalsy();
      expect(String((resolved.content as Array<{ text: string }>)[0].text)).toContain('SUBSECTION CONTENT');
      const missing = await client.callTool({
        name: 'wiki_read_page',
        arguments: { path: 'raw/ingested/source.md#Nope' },
      });
      expect(missing.isError).toBe(true);
      expect(String((missing.content as Array<{ text: string }>)[0].text)).toMatch(/anchor missing/i);
    });
  });
});
