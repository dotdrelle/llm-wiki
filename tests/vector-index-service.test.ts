import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VectorIndexService } from '../src/services/vectorIndexService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b',
      apiKey: 'test-key',
      baseUrl: 'https://albert.api.etalab.gouv.fr/v1',
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
      vector: {
        enabled: true,
        baseUrl: 'https://albert.api.etalab.gouv.fr/v1',
        apiKey: 'test-key',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 20,
        rerankTopK: 10,
        maxResults: 4,
      },
    },
    mcp: {},
  };
}

class FakeEmbeddingService {
  calls = 0;

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    return texts.map((text) => [
      text.includes('fonctionnel') || text.includes('expertise') ? 1 : 0,
      text.includes('docker') ? 1 : 0,
      0.1,
    ]);
  }
}

class FakeRerankService {
  async rerank(_query: string, documents: string[], topN: number) {
    return documents
      .map((document, index) => ({
        index,
        score: document.includes('fonctionnel') || document.includes('expertise') ? 1 : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }
}

class EmptyRerankService {
  async rerank() {
    return [];
  }
}

class ThrowingRerankService {
  async rerank() {
    throw new Error('reranker should not be called');
  }
}

describe('vector index service', () => {
  it('indexes wiki pages only and reuses unchanged chunk embeddings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-vector-'));
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'answers'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Index\n', 'utf8');
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'fonctionnel.md'),
      '# Fonctionnel\n\nFlux de saisie expertise.\n',
      'utf8',
    );
    await writeFile(path.join(root, 'wiki', 'answers', 'old.md'), '# Answer\n', 'utf8');
    await writeFile(path.join(root, 'raw', 'ingested', 'raw.md'), '# Raw\n', 'utf8');

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const embeddings = new FakeEmbeddingService();
    const service = new VectorIndexService(
      config,
      workspace,
      embeddings as any,
      new FakeRerankService() as any,
    );

    const first = await service.buildIndex();
    const second = await service.buildIndex();
    const results = await service.search('architecture fonctionnelle expertise');

    expect(first.metadata.embeddingModel).toBe('BAAI/bge-m3');
    expect(first.metadata.dimension).toBe(3);
    expect(first.indexedPages).toBe(1);
    expect(first.indexedChunks).toBe(1);
    expect(second.embeddedChunks).toBe(0);
    expect(second.reusedChunks).toBe(1);
    expect(results[0]?.page.relativePath).toBe('wiki/concepts/fonctionnel.md');
    expect(results.map((result) => result.page.relativePath)).not.toContain(
      'wiki/answers/old.md',
    );
  });

  it('rejects searches when the configured embedding model no longer matches the index', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-vector-meta-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'fonctionnel.md'),
      '# Fonctionnel\n\nExpertise.\n',
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const service = new VectorIndexService(
      config,
      workspace,
      new FakeEmbeddingService() as any,
      new EmptyRerankService() as any,
    );
    await service.buildIndex();

    config.retrieval.vector.embeddingModel = 'text-embedding-3-small';
    const changedService = new VectorIndexService(
      config,
      workspace,
      new FakeEmbeddingService() as any,
      new EmptyRerankService() as any,
    );

    await expect(changedService.search('expertise')).rejects.toThrow(
      /built with different embedding settings.*wiki index/i,
    );
  });

  it('falls back to vector order when reranker returns no results', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-vector-empty-rerank-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'fonctionnel.md'),
      '# Fonctionnel\n\nExpertise.\n',
      'utf8',
    );

    const config = createConfig(root);
    const service = new VectorIndexService(
      config,
      new WorkspaceService(config),
      new FakeEmbeddingService() as any,
      new EmptyRerankService() as any,
    );

    await service.buildIndex();

    const results = await service.search('expertise');
    expect(results[0]?.page.relativePath).toBe('wiki/fonctionnel.md');
  });

  it('recreates the internal vector index directory when .wiki is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-vector-missing-dir-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'fonctionnel.md'),
      '# Fonctionnel\n\nExpertise.\n',
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const service = new VectorIndexService(
      config,
      workspace,
      new FakeEmbeddingService() as any,
      new EmptyRerankService() as any,
    );

    await service.buildIndex();
    await expect(access(workspace.paths.vectorIndexDir)).resolves.toBeUndefined();

    const results = await service.search('expertise');
    expect(results[0]?.page.relativePath).toBe('wiki/fonctionnel.md');
  });

  it('skips reranker when rerankEnabled is false', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'llm-wiki-vector-rerank-disabled-'),
    );
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'fonctionnel.md'),
      '# Fonctionnel\n\nExpertise.\n',
      'utf8',
    );

    const config = createConfig(root);
    config.retrieval.vector.rerankEnabled = false;
    const service = new VectorIndexService(
      config,
      new WorkspaceService(config),
      new FakeEmbeddingService() as any,
      new ThrowingRerankService() as any,
    );

    await service.buildIndex();

    const results = await service.search('expertise');
    expect(results[0]?.page.relativePath).toBe('wiki/fonctionnel.md');
  });

  it('skips reranker when search rerank is false', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-vector-rerank-option-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'fonctionnel.md'),
      '# Fonctionnel\n\nExpertise.\n',
      'utf8',
    );

    const config = createConfig(root);
    const service = new VectorIndexService(
      config,
      new WorkspaceService(config),
      new FakeEmbeddingService() as any,
      new ThrowingRerankService() as any,
    );

    await service.buildIndex();

    const results = await service.search('expertise', { rerank: false });
    expect(results[0]?.page.relativePath).toBe('wiki/fonctionnel.md');
  });
});
