import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RetrievalService } from '../src/services/retrievalService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    build: {
      refreshOnIngest: true,
      slotBatchSize: 5,
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      vector: {
        enabled: true,
        embeddingModel: 'BAAI/bge-m3',
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

describe('retrieval service', () => {
  it('includes raw/ingested files only when explicitly requested', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-retrieval-'));
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Index\n', 'utf8');
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'architecture.md'),
      '# Architecture\n\nSynthese architecture JUNO.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'raw', 'ingested', 'architecture-source.md'),
      '# Source\n\nArchitecture source brute JUNO.\n',
      'utf8',
    );

    const config = createConfig(root);
    const retrieval = new RetrievalService(new WorkspaceService(config), config);

    const wikiOnly = await retrieval.search('architecture source brute JUNO', {
      includeRaw: false,
    });
    const withRaw = await retrieval.search('architecture source brute JUNO', {
      includeRaw: true,
    });

    expect(wikiOnly.map((result) => result.page.relativePath)).not.toContain(
      'raw/ingested/architecture-source.md',
    );
    expect(withRaw.map((result) => result.page.relativePath)).toContain(
      'raw/ingested/architecture-source.md',
    );
  });
});
