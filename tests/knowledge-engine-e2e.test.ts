import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildService } from '../src/services/buildService.ts';
import { expandDeliverable, exportOutputPath } from '../src/services/exportService.ts';
import { IngestService } from '../src/services/ingestService.ts';
import type { LLMService } from '../src/services/llmService.ts';
import type { RefreshService } from '../src/services/refreshService.ts';
import { RetrievalService } from '../src/services/retrievalService.ts';
import type { TraceLogger } from '../src/services/traceLogger.ts';
import { VectorIndexService } from '../src/services/vectorIndexService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import { safeWriteFile } from '../src/utils/fs.ts';
import { normalizeGeneratedMarkdown } from '../src/utils/markdown.ts';
import type { AppConfig, IngestPlan } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'test-key',
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
      refreshOnIngest: false,
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
        enabled: true,
        baseUrl: 'http://127.0.0.1:7997/v1',
        apiKey: 'test-key',
        timeoutMs: 600000,
        embeddingModel: 'test-embedding',
        rerankEnabled: true,
        rerankerModel: 'test-reranker',
        topK: 20,
        rerankTopK: 10,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

class MemoryTraceLogger implements TraceLogger {
  readonly runId = 'e2e-run';
  readonly filePath = '/tmp/e2e.log';
  readonly displayPath = '.wiki/logs/e2e.log';
  readonly debugEnabled = false;
  readonly verboseEnabled = false;
  readonly entries: Array<{
    level: string;
    event: string;
    data?: Record<string, unknown>;
  }> = [];

  async info(event: string, data?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: 'info', event, data });
  }

  async debug(event: string, data?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: 'debug', event, data });
  }

  async warn(event: string, data?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: 'warn', event, data });
  }

  async error(event: string, data?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: 'error', event, data });
  }

  async close(): Promise<void> {}
}

class PipelineLLMService {
  async completeJson(request: { label?: string; user?: string }): Promise<unknown> {
    if (request.label === 'ingest_plan') {
      return {
        summary: 'Ingest converted product brief.',
        operations: [
          {
            type: 'create',
            path: 'wiki/sources/product-brief.md',
            content: [
              '# Product Brief',
              '',
              'Le produit Donna centralise les notes projet converties.',
              'La source décrit un workflow conversion, ingestion, index, build et export.',
              '[src: raw/ingested/product-brief.md]',
            ].join('\n'),
          },
          {
            type: 'create',
            path: 'wiki/concepts/donna-workflow.md',
            content: [
              '# Donna Workflow',
              '',
              'Donna transforme les documents multi-format en connaissance Markdown revue.',
              'Le workflow produit un livrable sourcé.',
              '[src: raw/ingested/product-brief.md]',
            ].join('\n'),
          },
        ],
      } satisfies IngestPlan;
    }

    const ids = [...(request.user ?? '').matchAll(/^## (instruction-\d+)$/gm)].map(
      (match) => match[1],
    );
    return {
      replacements: (ids.length > 0 ? ids : ['instruction-1']).map((id) => ({
        id,
        content:
          'Donna propose un moteur de connaissance avec conversion, review, indexation et export. [src: wiki/concepts/donna-workflow.md]',
      })),
    };
  }

  async completeText(request?: { label?: string }): Promise<string> {
    if (request?.label === 'export') {
      return [
        '# Export publication',
        '',
        'Donna publie un livrable enrichi avec ses sources archivées.',
        '[src: raw/ingested/product-brief.md]',
      ].join('\n');
    }
    return 'Donna publie un livrable poli. [src: raw/ingested/product-brief.md]';
  }
}

class FakeRefreshService {
  async refresh() {
    return [];
  }
}

class FakeEmbeddingService {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => [
      /Donna|conversion|knowledge|connaissance/i.test(text) ? 1 : 0,
      /export|livrable|publication/i.test(text) ? 1 : 0,
      0.1,
    ]);
  }
}

class FakeRerankService {
  async rerank(_query: string, documents: string[], topN: number) {
    return documents
      .map((document, index) => ({
        index,
        score: /Donna|conversion|connaissance|livrable/i.test(document) ? 1 : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }
}

async function createWorkspace(root: string): Promise<void> {
  await mkdir(path.join(root, '.wiki'), { recursive: true });
  await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
  await mkdir(path.join(root, 'wiki'), { recursive: true });
  await mkdir(path.join(root, 'templates'), { recursive: true });
  await mkdir(path.join(root, 'deliverables'), { recursive: true });
  await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
  await writeFile(
    path.join(root, 'templates', 'brief.md'),
    [
      '---',
      'title: Brief',
      'output: brief.md',
      '---',
      '',
      '# Brief',
      '',
      '[[INSTRUCTION: Résume le workflow Donna documenté.]]',
    ].join('\n'),
    'utf8',
  );
}

describe('knowledge engine E2E', () => {
  it('runs conversion review ingest index build and export on local services', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-knowledge-e2e-'));
    await createWorkspace(root);

    const convertedPath = path.join(root, 'raw', 'untracked', 'product-brief.md');
    await writeFile(
      convertedPath,
      [
        '---',
        'source: product-brief.pdf',
        'convertedBy: documents',
        '---',
        '',
        '# Product Brief',
        '',
        'Donna centralise les notes projet et produit un livrable public.',
        'Le flux attendu couvre conversion, review, ingest, index, build et export.',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const logger = new MemoryTraceLogger();
    const llm = new PipelineLLMService();
    const retrieval = new RetrievalService(workspace, config, logger);
    const ingest = new IngestService(
      config,
      workspace,
      llm as unknown as LLMService,
      retrieval,
      new FakeRefreshService() as unknown as RefreshService,
      logger,
    );

    const review = await ingest.ingest([], { dryRun: true });
    expect(review[0].review?.map((operation) => operation.status)).toEqual([
      'pending',
      'pending',
    ]);
    expect(review[0].review?.[0].diff.changed).toBe(true);
    expect(await readFile(convertedPath, 'utf8')).toContain('convertedBy: documents');

    const applied = await ingest.ingest([], {});
    expect(applied[0].review?.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
    ]);
    await expect(
      readFile(path.join(root, 'raw', 'ingested', 'product-brief.md'), 'utf8'),
    ).resolves.toContain('convertedBy: documents');

    const lexicalResults = await retrieval.search('Donna connaissance livrable', {
      limit: 3,
    });
    expect(lexicalResults.map((result) => result.page.relativePath)).toContain(
      'wiki/concepts/donna-workflow.md',
    );

    const vectorIndex = new VectorIndexService(
      config,
      workspace,
      new FakeEmbeddingService() as never,
      new FakeRerankService() as never,
    );
    const indexResult = await vectorIndex.buildIndex();
    expect(indexResult.indexedChunks).toBeGreaterThan(0);
    const vectorResults = await vectorIndex.search('Donna workflow connaissance', {
      limit: 3,
    });
    expect(vectorResults.map((result) => result.page.relativePath)).toContain(
      'wiki/concepts/donna-workflow.md',
    );

    const build = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      retrieval,
      logger,
    );
    const buildResults = await build.build();
    expect(buildResults[0].output).toBe('deliverables/brief.md');
    const deliverable = await readFile(
      path.join(root, 'deliverables', 'brief.md'),
      'utf8',
    );
    expect(deliverable).toContain('Donna propose un moteur de connaissance');
    expect(deliverable).toContain('[src: wiki/concepts/donna-workflow.md]');

    const exported = await expandDeliverable(
      'deliverables/brief.md',
      config,
      workspace,
      llm as unknown as LLMService,
      logger,
    );
    const exportRelative = exportOutputPath('deliverables/brief.md');
    await safeWriteFile(
      path.join(root, exportRelative),
      normalizeGeneratedMarkdown(exported),
    );
    const exportContent = await readFile(path.join(root, exportRelative), 'utf8');
    expect(exportContent).toContain('Export publication');
    expect(exportContent).toContain('[src: raw/ingested/product-brief.md]');

    expect(logger.entries.some((entry) => entry.event === 'ingest:review')).toBe(true);
    expect(logger.entries.some((entry) => entry.event === 'ingest:apply')).toBe(true);
    expect(logger.entries.some((entry) => entry.event === 'export:source')).toBe(true);
  });
});
