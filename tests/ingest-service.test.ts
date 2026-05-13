import { describe, expect, it } from 'vitest';
import { IngestService } from '../src/services/ingestService.ts';
import type { LLMService } from '../src/services/llmService.ts';
import type { RefreshService } from '../src/services/refreshService.ts';
import type { RetrievalService } from '../src/services/retrievalService.ts';
import type { TraceLogger } from '../src/services/traceLogger.ts';
import type { WorkspaceService } from '../src/services/workspaceService.ts';
import type {
  AppConfig,
  IngestPlan,
  SearchResult,
  SourceDocument,
  WikiOperation,
} from '../src/types.ts';
import { slugifyPath } from '../src/utils/path.ts';

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
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
      vector: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
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

class FakeWorkspaceService {
  appliedOperations: WikiOperation[] = [];
  appliedBatches: WikiOperation[][] = [];
  archivedSources: string[] = [];
  sourcePaths = ['/tmp/wiki/raw/untracked/note.md'];
  sourceBody = 'Body.';
  readIndexAppliedCounts: number[] = [];
  failApply = false;

  async ensureInitialized(): Promise<void> {}

  async resolveSourceInputs(): Promise<string[]> {
    return this.sourcePaths;
  }

  async readSourceDocument(
    sourcePath = '/tmp/wiki/raw/untracked/note.md',
  ): Promise<SourceDocument> {
    const fileName = sourcePath.split('/').at(-1) ?? 'note.md';
    const slug = fileName.replace(/\.md$/, '');
    return {
      absolutePath: sourcePath,
      relativePath: `raw/untracked/${fileName}`,
      archiveRelativePath: `raw/ingested/${slugifyPath(fileName)}`,
      archiveCitationPath: `raw/ingested/${slugifyPath(fileName)}`,
      fileName,
      slug,
      title: slug,
      frontmatter: {},
      rawContent: `# ${slug}\n\n${this.sourceBody}\n`,
      body: this.sourceBody,
    };
  }

  async readIndex(): Promise<string> {
    this.readIndexAppliedCounts.push(this.appliedBatches.length);
    return '# Wiki Index\n';
  }

  async normalizeWikiOperations(operations: WikiOperation[]): Promise<WikiOperation[]> {
    return operations;
  }

  async isSourceUnchangedSinceIngest(): Promise<boolean> {
    return false;
  }

  async applyWikiOperations(operations: WikiOperation[]): Promise<void> {
    await this.applyWikiOperationsAtomic(operations);
  }

  async applyNormalizedWikiOperations(operations: WikiOperation[]): Promise<void> {
    await this.applyWikiOperationsAtomic(operations);
  }

  private async applyWikiOperationsAtomic(operations: WikiOperation[]): Promise<void> {
    if (this.failApply) {
      throw new Error('disk write failed');
    }
    this.appliedBatches.push(operations);
    this.appliedOperations = operations;
  }

  async archiveSource(source: SourceDocument): Promise<void> {
    this.archivedSources.push(source.relativePath);
  }

  async appendLog(): Promise<void> {}
}

class FakeLLMService {
  calls = 0;

  async completeJson(): Promise<IngestPlan> {
    this.calls += 1;
    return {
      summary: 'Updated wiki from note.',
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/note.md',
          content: '# Note\n\n[src: raw/ingested/note.md]\n',
        },
      ],
    };
  }
}

class FailingOnceLLMService extends FakeLLMService {
  async completeJson(): Promise<IngestPlan> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error('model returned malformed JSON');
    }
    return {
      summary: 'Updated wiki from second note.',
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/second.md',
          content: '# Second\n\n[src: raw/ingested/second.md]\n',
        },
      ],
    };
  }
}

class BadCitationLLMService extends FakeLLMService {
  async completeJson(): Promise<IngestPlan> {
    this.calls += 1;
    return {
      summary: 'Updated wiki from source with malformed citation.',
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/constituer-lequipe-davant-projet.md',
          content:
            "# Constituer l'équipe\n\nFait documenté. [src: raw/ingested/Constituer l'équipe d_avant-projet.md]\n",
        },
      ],
    };
  }
}

class FakeRetrievalService {
  invalidateCalls = 0;

  async search(): Promise<SearchResult[]> {
    return [];
  }
  invalidateCache(): void {
    this.invalidateCalls += 1;
  }
}

class SectionedLLMService extends FakeLLMService {
  async completeJson(): Promise<IngestPlan> {
    this.calls += 1;
    return {
      summary: `Updated section ${this.calls}.`,
      operations: [
        {
          type: 'update',
          path: 'wiki/sources/note.md',
          content: `# Note\n\nSection ${this.calls}. [src: raw/ingested/note.md]\n`,
        },
      ],
    };
  }
}

class FailingRefreshService {
  async refresh() {
    throw new Error('Your credit balance is too low to access the Anthropic API.');
  }
}

class CountingRefreshService {
  calls = 0;

  async refresh() {
    this.calls += 1;
    return [];
  }
}

class MemoryTraceLogger implements TraceLogger {
  readonly runId = 'test-run';
  readonly filePath = '/tmp/wiki/.wiki/logs/test.log';
  readonly displayPath = '.wiki/logs/test.log';
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

describe('ingest service', () => {
  it('runs automatic refresh when build.refreshOnIngest is enabled', async () => {
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const refresh = new CountingRefreshService();
    const config = createConfig();
    config.build.refreshOnIngest = true;
    const service = new IngestService(
      config,
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      refresh as unknown as RefreshService,
      logger,
    );

    await service.ingest([], {});

    expect(refresh.calls).toBe(1);
  });

  it('keeps ingest successful when automatic refresh fails', async () => {
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      new FailingRefreshService() as unknown as RefreshService,
      logger,
    );

    const results = await service.ingest([], { refresh: true });

    expect(results).toHaveLength(1);
    expect(workspace.appliedOperations).toHaveLength(1);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(logger.entries.some((entry) => entry.event === 'ingest:refresh-failed')).toBe(
      true,
    );
    expect(logger.entries.some((entry) => entry.event === 'ingest:run-done')).toBe(true);
  });

  it('rewrites model-mutated source citations to the exact archived source path', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourcePaths = ['/tmp/wiki/raw/untracked/Constituer l_équipe d_avant-projet.md'];
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new BadCitationLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
    );

    const results = await service.ingest([], {});

    expect(results[0].plan?.operations[0].content).toContain(
      '[src: raw/ingested/constituer-lequipe-davant-projet.md]',
    );
    expect(workspace.appliedOperations[0].content).toContain(
      '[src: raw/ingested/constituer-lequipe-davant-projet.md]',
    );
    expect(workspace.appliedOperations[0].content).not.toContain(
      "Constituer l'équipe d_avant-projet.md",
    );
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:citation-path-rewrite')
        ?.data,
    ).toMatchObject({ rewrittenCitations: 1 });
  });

  it('plans oversized sources section by section then applies atomically before archiving once', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceBody = [
      '# Large source',
      '',
      '## First section',
      'A'.repeat(70),
      '',
      '## Second section',
      'B'.repeat(70),
    ].join('\n');
    const config = createConfig();
    config.retrieval.maxSourceChars = 120;
    const logger = new MemoryTraceLogger();
    const llm = new SectionedLLMService();
    const retrieval = new FakeRetrievalService();
    const service = new IngestService(
      config,
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      retrieval as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
    );

    const results = await service.ingest([], {});

    expect(llm.calls).toBe(2);
    expect(workspace.appliedBatches).toHaveLength(1);
    expect(workspace.appliedBatches[0]).toHaveLength(2);
    expect(retrieval.invalidateCalls).toBe(1);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(results[0].plan?.operations).toHaveLength(2);
    expect(workspace.readIndexAppliedCounts).toEqual([0, 0]);
    expect(logger.entries.some((entry) => entry.event === 'ingest:split')).toBe(true);
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:apply')?.data,
    ).toMatchObject({ atomic: true, sections: 2 });
  });

  it('continues ingesting remaining sources when one source fails', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourcePaths = [
      '/tmp/wiki/raw/untracked/first.md',
      '/tmp/wiki/raw/untracked/second.md',
    ];
    const logger = new MemoryTraceLogger();
    const llm = new FailingOnceLLMService();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
    );

    const results = await service.ingest([], {});

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source: 'raw/untracked/first.md',
      failed: true,
    });
    expect(results[1].source).toBe('raw/untracked/second.md');
    expect(results[1].failed).toBeUndefined();
    expect(workspace.appliedOperations).toHaveLength(1);
    expect(workspace.archivedSources).toEqual(['raw/untracked/second.md']);
    expect(logger.entries.some((entry) => entry.event === 'ingest:source-failed')).toBe(
      true,
    );
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:run-done')?.data,
    ).toMatchObject({
      failed: 1,
      status: 'partial_failure',
    });
  });

  it('does not report a source as successful when applying operations fails', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.failApply = true;
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
    );

    const results = await service.ingest([], {});

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'raw/untracked/note.md',
      failed: true,
      error: 'disk write failed',
    });
    expect(workspace.archivedSources).toEqual([]);
  });
});
