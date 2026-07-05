import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/types.ts';
import { ConceptGroupingService } from '../src/services/conceptGroupingService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';

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
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: false,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

describe('concept grouping service', () => {
  it('plans and applies flat concept moves from frontmatter group', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-concepts-'));
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'index.md'),
      '# Wiki Index\n\n## Concepts\n\n- [ESX](concepts/esx.md)\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'esx.md'),
      '---\ngroup: Infrastructure\n---\n# ESX\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'orphan.md'),
      '# Orphan\n',
      'utf8',
    );

    const service = new ConceptGroupingService(new WorkspaceService(createConfig(root)));
    const plan = await service.plan();

    expect(plan.moves).toEqual([
      {
        source: 'wiki/concepts/esx.md',
        target: 'wiki/concepts/infrastructure/esx.md',
        group: 'Infrastructure',
      },
    ]);
    expect(plan.skipped).toContainEqual({
      path: 'wiki/concepts/orphan.md',
      reason: 'missing frontmatter group',
    });

    await service.apply(plan);

    await expect(
      readFile(path.join(root, 'wiki', 'concepts', 'infrastructure', 'esx.md'), 'utf8'),
    ).resolves.toContain('# ESX');
    await expect(
      readFile(path.join(root, 'wiki', 'index.md'), 'utf8'),
    ).resolves.toContain('concepts/infrastructure/esx.md');
  });
});
