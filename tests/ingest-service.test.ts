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
      refreshOnIngest: true,
        slotBatchSize: 5,
    },
    retrieval: {
      maxContextFiles: 8,
        maxChunksPerPage: 2,
        maxChunkChars: 3000,
        maxSourceChars: 8000,
    },
  };
}

class FakeWorkspaceService {
  appliedOperations: WikiOperation[] = [];
  archivedSources: string[] = [];

  async ensureInitialized(): Promise<void> {}

  async resolveSourceInputs(): Promise<string[]> {
    return ['/tmp/wiki/raw/untracked/note.md'];
  }

  async readSourceDocument(): Promise<SourceDocument> {
    return {
      absolutePath: '/tmp/wiki/raw/untracked/note.md',
      relativePath: 'raw/untracked/note.md',
      archiveRelativePath: 'raw/ingested/note.md',
      archiveCitationPath: 'raw/ingested/note.md',
      fileName: 'note.md',
      slug: 'note',
      title: 'Note',
      frontmatter: {},
      rawContent: '# Note\n\nBody.\n',
      body: 'Body.',
    };
  }

  async readIndex(): Promise<string> {
    return '# Wiki Index\n';
  }

  async normalizeWikiOperations(operations: WikiOperation[]): Promise<WikiOperation[]> {
    return operations;
  }

  async applyWikiOperations(operations: WikiOperation[]): Promise<void> {
    this.appliedOperations = operations;
  }

  async archiveSource(source: SourceDocument): Promise<void> {
    this.archivedSources.push(source.relativePath);
  }

  async appendLog(): Promise<void> {}
}

class FakeLLMService {
  async completeJson(): Promise<IngestPlan> {
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

class MemoryTraceLogger implements TraceLogger {
  readonly runId = 'test-run';
  readonly filePath = '/tmp/wiki/.wiki/logs/test.log';
  readonly displayPath = '.wiki/logs/test.log';
  readonly debugEnabled = false;
  readonly verboseEnabled = false;
  readonly entries: Array<{ level: string; event: string; data?: Record<string, unknown> }> = [];

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

    const results = await service.ingest([], {});

    expect(results).toHaveLength(1);
    expect(workspace.appliedOperations).toHaveLength(1);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(logger.entries.some((entry) => entry.event === 'ingest:refresh-failed')).toBe(true);
    expect(logger.entries.some((entry) => entry.event === 'ingest:run-done')).toBe(true);
  });
});
