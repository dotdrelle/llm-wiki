import { readFile, mkdtemp } from 'node:fs/promises';
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
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
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
      baseUrl: 'https://example.invalid',
      apiKey: 'test',
      model: 'model',
      timeoutMs: 600000,
      temperature: 0,
    },
  };
}

function textPayload(result: unknown) {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('Expected MCP result content');
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error('Expected MCP result content array');
  const item = content.find(
    (entry): entry is { type: 'text'; text: string } =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      (entry as { type?: unknown }).type === 'text' &&
      typeof (entry as { text?: unknown }).text === 'string',
  );
  if (!item) throw new Error('Expected text MCP result');
  return JSON.parse(item.text) as Record<string, unknown>;
}

describe('wiki_add_source MCP tool', () => {
  it('exposes the tool, supports dry-run, writes, and audits without full content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-mcp-source-'));
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
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'wiki_add_source')).toBe(true);

      const dryRun = textPayload(
        await client.callTool({
          name: 'wiki_add_source',
          arguments: { name: 'gmail-message', content: '# Secret body', dryRun: true },
        }),
      );
      expect(dryRun).toMatchObject({ dryRun: true, written: false });
      expect(dryRun).not.toHaveProperty('confirmed');
      expect(dryRun).not.toHaveProperty('requiresConfirmation');
      const target = workspace.resolveUntrackedSourceTarget({ name: 'gmail-message' });
      await expect(readFile(target.absolutePath, 'utf8')).rejects.toThrow();

      const written = textPayload(
        await client.callTool({
          name: 'wiki_add_source',
          arguments: { name: 'gmail-message', content: '# Secret body' },
        }),
      );
      expect(written).toMatchObject({ written: true, overwritten: false });
      await expect(readFile(target.absolutePath, 'utf8')).resolves.toBe('# Secret body');

      const audit = await readFile(
        path.join(workspace.paths.logsDir, 'audit.log'),
        'utf8',
      );
      expect(audit).toContain('"tool":"wiki_add_source"');
      expect(audit).toContain('"action":"dry_run"');
      expect(audit).toContain('"action":"write"');
      expect(audit).not.toContain('# Secret body');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
