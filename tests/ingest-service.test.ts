import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IngestService } from '../src/services/ingestService.ts';
import { IngestCache } from '../src/ingest/extractionCache.ts';
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
  WikiPage,
} from '../src/types.ts';
import { slugifyPath } from '../src/utils/path.ts';

/**
 * Cache désactivé pour les tests unitaires.
 *
 * Le cache d'ingestion écrit de vrais fichiers ; sous horloge simulée, ces
 * entrées/sorties ne se résolvent pas et le test se fige. Ces tests portent sur
 * le contrat d'ingestion, pas sur la reprise, qui a ses propres tests.
 */
function disabledCache(): IngestCache {
  return new IngestCache('/tmp/wiki-unused', false);
}

function createConfig(): AppConfig {
  return {
    wikiRoot: '/tmp/wiki',
    language: 'fr',
    llm: {
      provider: 'openai-compatible',

      engine: 'ollama',
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
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
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
  // Racine unique par instance : le cache d'ingestion écrit réellement sur
  // disque, et un répertoire partagé ferait fuiter le plan d'un test dans un
  // autre — exactement le faux positif qui a masqué la clé de cache incomplète.
  paths: { rootDir: string; internalDir?: string } = {
    rootDir: path.join(os.tmpdir(), `wiki-ingest-${Math.random().toString(36).slice(2)}`),
  };
  sourcePaths = ['/tmp/wiki/raw/untracked/note.md'];
  sourceBody = 'Body.';
  detectedEncoding?: SourceDocument['detectedEncoding'];
  readIndexAppliedCounts: number[] = [];
  wikiPages: WikiPage[] = [];
  failApply = false;

  async ensureInitialized(): Promise<void> {}

  async loadProfileSection(): Promise<string> {
    return '';
  }

  async resolveSourceInputs(): Promise<string[]> {
    return this.sourcePaths;
  }

  async readSourceDocument(
    sourcePath = '/tmp/wiki/raw/untracked/note.md',
  ): Promise<SourceDocument> {
    const fileName = sourcePath.split('/').at(-1) ?? 'note.md';
    // Le vrai workspace slugifie le titre (`slugify(title || fileName)`) ; le
    // double doit en faire autant, sinon le chemin de note de source qu'il
    // annonce n'est pas celui que l'ingestion attend.
    const slug = slugifyPath(fileName).replace(/\.md$/, '');
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
      ...(this.detectedEncoding && { detectedEncoding: this.detectedEncoding }),
    };
  }

  async readIndex(): Promise<string> {
    this.readIndexAppliedCounts.push(this.appliedBatches.length);
    return '# Wiki Index\n';
  }

  async normalizeWikiOperations(operations: WikiOperation[]): Promise<WikiOperation[]> {
    return operations;
  }

  async listWikiPages(): Promise<WikiPage[]> {
    return this.wikiPages;
  }

  sourceUnchanged = false;

  async isSourceUnchangedSinceIngest(): Promise<boolean> {
    return this.sourceUnchanged;
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

/*
 Double de LLM à DEUX phases, comme le contrat du Lot 2.

 Une source coûte désormais N extractions — une par lot d'empaquetage — puis
 exactement une consolidation. Les doubles distinguent les deux : compter les
 appels sans les distinguer masquerait précisément ce que le lot corrige, à
 savoir qu'un fragment ne décide plus des fichiers.
*/
class FakeLLMService {
  calls = 0;
  extractionCalls = 0;
  planCalls = 0;

  /**
   * Chemin de note de source annoncé par le prompt de consolidation.
   *
   * Un vrai modèle le lit dans son message ; le double doit en faire autant,
   * sinon il renvoie un plan pour un autre document et la validation le rejette
   * — à juste titre.
   */
  sourceNotePath = 'wiki/sources/note.md';

  async completeJson(request: { label?: string; user?: string }): Promise<unknown> {
    this.calls += 1;
    if (request?.label === 'ingest_extract') {
      this.extractionCalls += 1;
      return this.extract();
    }
    const declared = /^Source note path: (.+)$/m.exec(request?.user ?? '')?.[1];
    if (declared) this.sourceNotePath = declared.trim();
    this.planCalls += 1;
    return this.plan();
  }

  protected async extract(): Promise<unknown> {
    return {
      facts: [{ statement: 'Fait documenté.', citation: 'raw/ingested/note.md' }],
      subjects: [
        { id: 's1', label: 'Sujet', scope: 'source', importance: 'core', rationale: 'Cœur du document.' },
      ],
      relations: [],
      mainSubject: 's1',
    };
  }

  protected async plan(): Promise<IngestPlan & { pages?: unknown[] }> {
    return {
      summary: 'Updated wiki from note.',
      operations: [
        {
          type: 'create',
          path: this.sourceNotePath,
          content: '# Note\n\n[src: raw/ingested/note.md]\n',
        },
      ],
      pages: [{ path: this.sourceNotePath, subject: 'note', scope: 'source' }],
    };
  }
}

class FailingOnceLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    if (this.planCalls === 1) {
      throw new Error('model returned malformed JSON');
    }
    return {
      summary: 'Updated wiki from second note.',
      operations: [
        {
          type: 'create',
          path: this.sourceNotePath,
          content: '# Second\n\n[src: raw/ingested/second.md]\n',
        },
      ],
    };
  }
}

class FailingTwiceThenSuccessLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    if (this.planCalls <= 2) {
      throw new Error('model returned malformed JSON');
    }
    return {
      summary: 'Updated wiki from second note.',
      operations: [
        {
          type: 'create',
          path: this.sourceNotePath,
          content: '# Second\n\n[src: raw/ingested/second.md]\n',
        },
      ],
    };
  }
}

class ValidationFailingLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    throw new Error('Invalid structured JSON returned by the model.');
  }
}

class BadCitationLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
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

class UnreconciledCitationLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    return {
      summary: 'Updated wiki from source with malformed citation marker.',
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/note.md',
          content: '# Note\n\nFait documenté. [src: raw/untracked/note.md\n',
        },
      ],
    };
  }
}

class BareSourcePathLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    return {
      summary: 'Updated wiki from source with a bare (unbracketed) source path.',
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/note.md',
          content: '# Note\n\nSource: raw/ingested/note.md\nCollection: demo\n\nFait documenté.\n',
        },
      ],
    };
  }
}

class WideWhitespaceCitationLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    return {
      summary: 'Updated wiki from source with an already-correct but oddly wrapped citation.',
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/note.md',
          // Already the exact archive path, but with 5+ whitespace characters
          // (a line break) after "[src:" — more than the bare-path
          // lookbehind's small bound tolerates if left unnormalized.
          content: '# Note\n\nFait documenté [src:\n    raw/ingested/note.md].\n',
        },
      ],
    };
  }
}

class FakeRetrievalService {
  invalidateCalls = 0;

  constructor(private wikiPages: WikiPage[] = []) {}

  async search(): Promise<SearchResult[]> {
    return [];
  }
  async warmCache(): Promise<WikiPage[]> {
    return this.wikiPages;
  }
  invalidateCache(): void {
    this.invalidateCalls += 1;
  }
}

class SectionedLLMService extends FakeLLMService {
  protected async plan(): Promise<IngestPlan> {
    return {
      summary: `Updated section ${this.planCalls}.`,
      operations: [
        {
          type: 'update',
          path: this.sourceNotePath,
          content: `# Note\n\nSection ${this.planCalls}. [src: raw/ingested/note.md]\n`,
        },
      ],
    };
  }
}

class ConcurrentIngestLLMService extends FakeLLMService {
  active = 0;
  maxActive = 0;

  protected async extract(): Promise<unknown> {
    const call = this.extractionCalls;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.active -= 1;
    return {
      facts: [{ statement: `Fait ${call}.`, citation: 'raw/ingested/note.md' }],
      subjects: [],
      relations: [],
      mainSubject: null,
    };
  }

  protected async plan(): Promise<IngestPlan> {
    const call = this.planCalls;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.active -= 1;
    return {
      summary: `Updated section ${call}.`,
      operations: [
        {
          type: 'update',
          path: this.sourceNotePath,
          content: `# Note\n\nSection ${call}. [src: raw/ingested/note.md]\n`,
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
      disabledCache(),
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

  it('re-ingests an unchanged source whose produced pages have vanished', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceUnchanged = true;
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-ingest-vanish-'));
    workspace.paths.rootDir = root;
    workspace.paths.internalDir = path.join(root, '.wiki', 'internal');
    await mkdir(workspace.paths.internalDir, { recursive: true });
    await writeFile(
      path.join(workspace.paths.internalDir, 'source-registry.json'),
      `${JSON.stringify({
        version: 1,
        sources: [{
          sourceId: 'path:raw/ingested/note.md',
          archivePath: 'raw/ingested/note.md',
          producedPages: ['wiki/sources/note.md', 'wiki/concepts/unclassified/foo.md'],
        }],
      })}\n`,
      'utf8',
    );
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      new CountingRefreshService() as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    await service.ingest([], {});

    expect(workspace.appliedOperations.length).toBeGreaterThan(0);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(logger.entries.some((entry) => entry.event === 'ingest:source-skip')).toBe(false);
    expect(logger.entries.some((entry) => entry.event === 'ingest:source-reingest')).toBe(true);
  });

  it('still skips an unchanged source whose produced pages all exist', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceUnchanged = true;
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-ingest-present-'));
    workspace.paths.rootDir = root;
    workspace.paths.internalDir = path.join(root, '.wiki', 'internal');
    await mkdir(workspace.paths.internalDir, { recursive: true });
    await mkdir(path.join(root, 'wiki', 'sources'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'concepts', 'unclassified'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'sources', 'note.md'), '# Note\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'concepts', 'unclassified', 'foo.md'), '# Foo\n', 'utf8');
    await writeFile(
      path.join(workspace.paths.internalDir, 'source-registry.json'),
      `${JSON.stringify({
        version: 1,
        sources: [{
          sourceId: 'path:raw/ingested/note.md',
          archivePath: 'raw/ingested/note.md',
          producedPages: ['wiki/sources/note.md', 'wiki/concepts/unclassified/foo.md'],
        }],
      })}\n`,
      'utf8',
    );
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      new CountingRefreshService() as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.ingest([], {});

    expect(workspace.appliedOperations.length).toBe(0);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(results[0]?.skipped).toBe(true);
    expect(logger.entries.some((entry) => entry.event === 'ingest:source-skip')).toBe(true);
  });

  it('rewrites model-mutated source citations to the exact archived source path', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourcePaths = [
      '/tmp/wiki/raw/untracked/Constituer l_équipe d_avant-projet.md',
    ];
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new BadCitationLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
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
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:citation-path-rewrite')
        ?.level,
    ).toBe('info');
    expect(
      logger.entries.some((entry) => entry.event === 'ingest:citation-unreconciled'),
    ).toBe(false);
  });

  it('warns when source citations cannot be reconciled', async () => {
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new UnreconciledCitationLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    await service.ingest([], {});

    expect(
      logger.entries.find((entry) => entry.event === 'ingest:citation-unreconciled')
        ?.level,
    ).toBe('warn');
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:citation-unreconciled')
        ?.data,
    ).toMatchObject({ unreconciledCitations: 1 });
  });

  it('wraps a bare source-path mention (no [src: ] brackets) into a real citation', async () => {
    // Regression: the model sometimes names its source as a plain "Source:
    // raw/ingested/…" header line instead of a per-claim [src: …] citation.
    // Invisible to enforceSourceCitationPath's bracket-matching regex and to
    // every downstream link renderer — the reference silently never becomes
    // a link. A per-source consolidation only ever has one legitimate source
    // to name, so wrapping it to the canonical archive path is safe.
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new BareSourcePathLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    await service.ingest([], {});

    expect(workspace.appliedOperations[0].content).toContain('Source: [src: raw/ingested/note.md]');
    expect(workspace.appliedOperations[0].content).not.toContain('Source: raw/ingested/note.md\n');
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:citation-bare-path-wrapped')?.data,
    ).toMatchObject({ wrappedBarePaths: 1 });
  });

  it('normalizes an already-correct citation with multi-line whitespace instead of leaving it for the bare-path pass to double-wrap', async () => {
    // Regression: the bracket-normalization pass used to return an
    // already-matching "[src: ...]" marker untouched, preserving whatever
    // whitespace the model used inside the brackets (including a newline,
    // since \s matches it). BARE_RAW_PATH_PATTERN's lookbehind only tolerates
    // up to 4 whitespace characters, so a 5+-character gap (a line break)
    // fell outside it and the inner path got wrapped a second time, producing
    // "[src:\n    [src: raw/ingested/note.md]]".
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new WideWhitespaceCitationLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    await service.ingest([], {});

    expect(workspace.appliedOperations[0].content).toContain('[src: raw/ingested/note.md]');
    expect(workspace.appliedOperations[0].content).not.toMatch(/\[src:[^\]]*\[src:/);
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:citation-bare-path-wrapped'),
    ).toBeUndefined();
  });

  it('warns when a source was decoded with the Latin-1 fallback', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.detectedEncoding = 'latin-1';
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    await service.ingest([], {});

    expect(
      logger.entries.find((entry) => entry.event === 'ingest:source')?.data,
    ).toMatchObject({ detectedEncoding: 'latin-1' });
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:encoding-fallback'),
    ).toMatchObject({
      level: 'warn',
      data: {
        source: 'raw/untracked/note.md',
        encoding: 'latin-1',
      },
    });
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
      disabledCache(),
    );

    const results = await service.ingest([], {});

    /*
     Deux lots d'empaquetage, deux extractions — puis UNE consolidation.

     C'est l'invariant du Lot 2 : un fragment ne décide plus des fichiers. Avant,
     chaque section produisait ses propres opérations, concaténées sans être
     confrontées ; deux sections d'un même document pouvaient donc écrire deux
     notes de source, ou deux pages du même concept.
    */
    expect(llm.extractionCalls).toBe(2);
    expect(llm.planCalls).toBe(1);
    expect(workspace.appliedBatches).toHaveLength(1);
    // Une seule note de source, quel que soit le nombre de lots.
    expect(workspace.appliedBatches[0]).toHaveLength(1);
    expect(retrieval.invalidateCalls).toBe(1);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(results[0].plan?.operations).toHaveLength(1);
    expect(workspace.readIndexAppliedCounts).toEqual([0]);
    /*
     Le plan d'empaquetage est journalisé pour toute source, découpée ou non :
     c'est ce qui permet d'expliquer après coup pourquoi une source a coûté N
     appels, au lieu de constater le nombre sans pouvoir le justifier.
    */
    const pack = logger.entries.find((entry) => entry.event === 'ingest:pack');
    expect(pack?.data).toMatchObject({ packs: 2, maxChars: 120, truncatedBlocks: 0 });
    expect((pack?.data as { packChars: number[] }).packChars).toHaveLength(2);
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:consolidate')?.data,
    ).toMatchObject({ operations: 1, errors: 0 });
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:apply')?.data,
    ).toMatchObject({ atomic: true });
  });

  it('limits concurrent ingest section LLM calls', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceBody = [
      '# Large source',
      '',
      '## First section',
      'A'.repeat(70),
      '',
      '## Second section',
      'B'.repeat(70),
      '',
      '## Third section',
      'C'.repeat(70),
      '',
      '## Fourth section',
      'D'.repeat(70),
    ].join('\n');
    const config = createConfig();
    config.retrieval.maxSourceChars = 120;
    config.limits.maxInFlightRequests = 2;
    const logger = new MemoryTraceLogger();
    const llm = new ConcurrentIngestLLMService();
    const retrieval = new FakeRetrievalService();
    const service = new IngestService(
      config,
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      retrieval as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.ingest([], {});

    expect(llm.extractionCalls).toBe(4);
    expect(llm.planCalls).toBe(1);
    expect(llm.maxActive).toBeLessThanOrEqual(2);
    expect(llm.maxActive).toBeGreaterThan(1);
    expect(workspace.appliedBatches).toHaveLength(1);
    expect(results[0].plan?.operations).toHaveLength(1);
  });

  it('returns review diffs for planned wiki operations', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.wikiPages = [
      {
        absolutePath: '/tmp/wiki/wiki/sources/note.md',
        relativePath: 'wiki/sources/note.md',
        name: 'note.md',
        type: 'source',
        content: '# Note\n\nOld content.\n',
      },
    ];
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService(workspace.wikiPages) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.ingest([], { dryRun: true });

    expect(results[0].review).toHaveLength(1);
    expect(results[0].review?.[0]).toMatchObject({
      path: 'wiki/sources/note.md',
      status: 'pending',
      beforeExists: true,
      afterExists: true,
    });
    expect(results[0].review?.[0].diff.changed).toBe(true);
    expect(results[0].review?.[0].diff.preview.join('\n')).toContain('- Old content.');
    expect(workspace.appliedOperations).toEqual([]);
    expect(workspace.archivedSources).toEqual([]);
  });

  it('can reject one planned operation before applying ingest', async () => {
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.ingest([], { reject: ['wiki/sources/note.md'] });

    expect(results[0].review?.[0]).toMatchObject({
      path: 'wiki/sources/note.md',
      status: 'rejected',
    });
    expect(results[0].plan?.operations).toEqual([]);
    expect(workspace.appliedOperations).toEqual([]);
    expect(workspace.archivedSources).toEqual([]);
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:apply-skip')?.data,
    ).toMatchObject({ reason: 'all operations rejected' });
  });

  it('retries a transient LLM planning failure once before failing the source', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const workspace = new FakeWorkspaceService();
      const logger = new MemoryTraceLogger();
      const llm = new FailingOnceLLMService();
      const service = new IngestService(
        createConfig(),
        workspace as unknown as WorkspaceService,
        llm as unknown as LLMService,
        new FakeRetrievalService() as unknown as RetrievalService,
        { refresh: async () => [] } as unknown as RefreshService,
        logger,
        disabledCache(),
      );

      const ingest = service.ingest([], {});
      await vi.waitFor(() => expect(llm.planCalls).toBe(1));
      await vi.advanceTimersByTimeAsync(3000);
      const results = await ingest;

      expect(llm.planCalls).toBe(2);
      expect(results).toHaveLength(1);
      expect(results[0].failed).toBeUndefined();
      expect(results[0].retry).toMatchObject({
        attempts: 2,
        retries: 1,
        classification: 'transient',
      });
      expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
      expect(logger.entries.some((entry) => entry.event === 'ingest:source-failed')).toBe(
        false,
      );
      expect(logger.entries.some((entry) => entry.event === 'ingest:retry')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry ingest validation errors', async () => {
    const workspace = new FakeWorkspaceService();
    const logger = new MemoryTraceLogger();
    const llm = new ValidationFailingLLMService();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.ingest([], {});

    expect(llm.planCalls).toBe(1);
    expect(results[0]).toMatchObject({
      source: 'raw/untracked/note.md',
      failed: true,
      error: 'Invalid structured JSON returned by the model.',
    });
    expect(logger.entries.some((entry) => entry.event === 'ingest:retry')).toBe(false);
  });

  it('continues ingesting remaining sources when one source fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const workspace = new FakeWorkspaceService();
    workspace.sourcePaths = [
      '/tmp/wiki/raw/untracked/first.md',
      '/tmp/wiki/raw/untracked/second.md',
    ];
    const logger = new MemoryTraceLogger();
    const llm = new FailingTwiceThenSuccessLLMService();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    try {
      const ingest = service.ingest([], {});
      await vi.waitFor(() => expect(llm.planCalls).toBe(1));
      await vi.advanceTimersByTimeAsync(3000);
      const results = await ingest;

      expect(llm.planCalls).toBe(3);
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
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a planned ingest file without calling the LLM', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'wiki-ingest-plan-'));
    const workspace = new FakeWorkspaceService();
    workspace.paths = { rootDir };
    const planPath = path.join(rootDir, '.wiki', 'ingest-plans', 'plan.json');
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        sources: [
          {
            source: 'raw/untracked/note.md',
            summary: 'Planned note.',
            operations: [
              {
                type: 'create',
                path: 'wiki/sources/note.md',
                content: '# Note\n\n[src: raw/ingested/note.md]\n',
              },
            ],
            review: [
              {
                type: 'create',
                path: 'wiki/sources/note.md',
                source: 'raw/untracked/note.md',
                archivePath: 'raw/ingested/note.md',
                status: 'pending',
                beforeExists: false,
                afterExists: true,
                diff: { changed: true, addedLines: 1, removedLines: 0, preview: [] },
              },
            ],
          },
        ],
      }),
      'utf8',
    );
    const logger = new MemoryTraceLogger();
    const llm = new FakeLLMService();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.applyPlannedIngest(['.wiki/ingest-plans/plan.json']);

    expect(llm.calls).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('raw/untracked/note.md');
    expect(results[0].failed).toBeUndefined();
    expect(workspace.appliedBatches).toEqual([
      [
        {
          type: 'create',
          path: 'wiki/sources/note.md',
          content: '# Note\n\n[src: raw/ingested/note.md]\n',
        },
      ],
    ]);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(logger.entries.some((entry) => entry.event === 'ingest:apply')).toBe(true);
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
      disabledCache(),
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

  /*
   Concept-homonym gap (B17): a source about "Sujet" is ingested while a
   concept page for a related subject already exists but was produced by a
   DIFFERENT source. `FakeRetrievalService.search()` returns `[]` here,
   exactly reproducing the observed failure — plain retrieval relevance does
   not reliably surface the existing page across sources — so this only
   passes if the subject-based lookup (independent of retrieval) surfaces it.
  */
  it('surfaces an existing concept page from another source as a reuse candidate by subject', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.wikiPages = [
      {
        absolutePath: '/tmp/wiki/wiki/concepts/sujet-historique.md',
        relativePath: 'wiki/concepts/sujet-historique.md',
        name: 'Sujet historique',
        type: 'concept',
        content: '---\nsubject: sujet-historique\nscope: product\n---\n\n# Sujet historique\n\nContenu existant.\n',
      },
    ];
    class CapturingLLMService extends FakeLLMService {
      lastPlanPrompt: string | null = null;

      async completeJson(request: { label?: string; user?: string }): Promise<unknown> {
        if (request?.label !== 'ingest_extract') this.lastPlanPrompt = request?.user ?? null;
        return super.completeJson(request);
      }
    }
    const llm = new CapturingLLMService();
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService(workspace.wikiPages) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      new MemoryTraceLogger(),
      disabledCache(),
    );

    await service.ingest([], {});

    expect(llm.lastPlanPrompt).toContain('wiki/concepts/sujet-historique.md');
    expect(llm.lastPlanPrompt).toContain('[existing page for a closely related subject]');
  });
});


