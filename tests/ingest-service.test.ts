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

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
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
    },
    mcp: {},
  };
}

class FakeWorkspaceService {
  appliedOperations: WikiOperation[] = [];
  archivedSources: string[] = [];
  sourcePaths = ['/tmp/wiki/raw/untracked/note.md'];
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
      archiveRelativePath: `raw/ingested/${fileName}`,
      archiveCitationPath: `raw/ingested/${fileName}`,
      fileName,
      slug,
      title: slug,
      frontmatter: {},
      rawContent: `# ${slug}\n\nBody.\n`,
      body: 'Body.',
    };
  }

  async readIndex(): Promise<string> {
    return '# Wiki Index\n';
  }

  async normalizeWikiOperations(operations: WikiOperation[]): Promise<WikiOperation[]> {
    return operations;
  }

  async isSourceUnchangedSinceIngest(): Promise<boolean> {
    return false;
  }

  async applyWikiOperations(operations: WikiOperation[]): Promise<void> {
    if (this.failApply) {
      throw new Error('disk write failed');
    }
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

class FakeRetrievalService {
  async search(): Promise<SearchResult[]> {
    return [];
  }
  invalidateCache(): void {}
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
