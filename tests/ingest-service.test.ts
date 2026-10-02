import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IngestService, staleRebuiltLeaves } from '../src/services/ingestService.ts';
import { IngestCache } from '../src/ingest/extractionCache.ts';
import { extractSectionSheets } from '../src/ingest/sectionSheets.ts';
import { sheetContentHash, sheetInputHash } from '../src/ingest/sheetDedup.ts';
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
  sourceBody = '# Contexte\n\nInformations de contexte.\n\n# Fait documenté\n\nFait documenté.';
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

class RebuildWorkspaceService extends FakeWorkspaceService {
  conceptLeaves: string[] = [];

  async resolveIngestedSourceInputs(): Promise<string[]> {
    return this.sourcePaths;
  }

  async listConceptLeafPaths(): Promise<string[]> {
    return this.conceptLeaves;
  }
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

  async completeText(request: { label?: string; user?: string }): Promise<string> {
    this.calls += 1;
    if (request.label === 'ingest_taxo_sheet') {
      this.extractionCalls += 1;
      const body = /# Section\n##[^\n]*\n\n([\s\S]*)/.exec(request.user ?? '')?.[1]?.trim()
        ?? 'Fait documenté dans la section.';
      return `Description: Fait documenté.\nTags: #knowledge\n\n${body}`;
    }
    if (request.label === 'ingest_taxo_families') {
      const tags = [...(request.user ?? '').matchAll(/^- ([^:\n]+):/gm)].map((match) => match[1]!.trim());
      return JSON.stringify([{ family: 'Knowledge', tags: [...new Set(tags)] }]);
    }
    if (request.label === 'ingest_taxo_sheet_dedup') return 'KEEP';
    return 'KEEP';
  }

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
          content: '# Note\n\nFait documenté. [src: raw/ingested/note.md]\n',
        },
      ],
      pages: [{ path: this.sourceNotePath, subject: 'note', scope: 'source' }],
    };
  }
}

class FailingOnceLLMService extends FakeLLMService {
  sheetCalls = 0;
  async completeText(request: { label?: string; user?: string }): Promise<string> {
    if (request.label === 'ingest_taxo_sheet' && this.sheetCalls++ === 0) {
      throw new Error('model returned malformed JSON');
    }
    return super.completeText(request);
  }

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
          content: '# Second\n\n[src: raw/ingested/note.md]\n',
        },
      ],
    };
  }
}

class FailingTwiceThenSuccessLLMService extends FakeLLMService {
  sheetAttempts = 0;
  async completeText(request: { label?: string; user?: string }): Promise<string> {
    if (request.label === 'ingest_taxo_sheet' && request.user?.includes('## first')) {
      this.sheetAttempts += 1;
      throw new Error('model returned malformed JSON');
    }
    return super.completeText(request);
  }

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
  async completeText(): Promise<string> {
    throw new Error('Invalid structured JSON returned by the model.');
  }

  protected async plan(): Promise<IngestPlan> {
    throw new Error('Invalid structured JSON returned by the model.');
  }
}

class FakeRetrievalService {
  invalidateCalls = 0;

  constructor(private wikiPages: WikiPage[] = [], private returnSearchCandidates = false) {}

  async search(): Promise<SearchResult[]> {
    return this.returnSearchCandidates
      ? this.wikiPages.map((page) => ({ page, score: 1, relatedPaths: [] }))
      : [];
  }
  async warmCache(): Promise<WikiPage[]> {
    return this.wikiPages;
  }
  invalidateCache(): void {
    this.invalidateCalls += 1;
  }
}

class ConcurrentIngestLLMService extends FakeLLMService {
  active = 0;
  maxActive = 0;

  async completeText(request: { label?: string; user?: string }): Promise<string> {
    if (request.label !== 'ingest_taxo_sheet') return super.completeText(request);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.active -= 1;
    return super.completeText(request);
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
  it('chunks initial family assignment for large tag inventories under one shared family catalogue', async () => {
    const fichePages: WikiPage[] = Array.from({ length: 61 }, (_, index) => {
      const tag = `tag-${String(index + 1).padStart(3, '0')}`;
      return {
        absolutePath: `/tmp/wiki/wiki/sources/doc/${tag}.md`,
        relativePath: `wiki/sources/doc/${tag}.md`, name: `${tag}.md`, type: 'source',
        content: `---\ntitle: Topic ${index + 1}\ntags: [${tag}]\n---\n# Topic ${index + 1}\nEvidence.`,
      };
    });
    const logger = new MemoryTraceLogger();
    const workspace = new FakeWorkspaceService();
    const calls: Array<{ label?: string; user?: string }> = [];
    const llm = Object.assign(new FakeLLMService(), {
      async completeText(request: { label?: string; user?: string }) {
        calls.push(request);
        if (request.label === 'ingest_taxo_family_catalogue') return '["Knowledge", "Operations", "Security"]';
        if (request.label === 'ingest_taxo_family_batch') {
          const assignmentBlock = (request.user ?? '').split('Tags to assign:\n')[1] ?? '';
          const tags = [...assignmentBlock.matchAll(/^- ([^:\n]+)(?::|$)/gm)].map((match) => match[1]!.trim());
          return JSON.stringify([{ family: 'Knowledge', tags }]);
        }
        return 'KEEP';
      },
    });
    const service = new IngestService(
      createConfig(), workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService(fichePages) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger, disabledCache(),
    );

    await (service as unknown as { regenerateTaxoTagPages(): Promise<void> }).regenerateTaxoTagPages();

    const batches = calls.filter((call) => call.label === 'ingest_taxo_family_batch');
    const assignedTags = batches.flatMap((call) => {
      const assignmentBlock = (call.user ?? '').split('Tags to assign:\n')[1] ?? '';
      return [...assignmentBlock.matchAll(/^- ([^:\n]+)(?::|$)/gm)].map((match) => match[1]!.trim());
    });
    expect(calls.filter((call) => call.label === 'ingest_taxo_family_catalogue')).toHaveLength(1);
    expect(batches).toHaveLength(2);
    expect(Math.max(...batches.map((call) => (call.user ?? '').split('Tags to assign:\n')[1]?.split('\n').filter(Boolean).length ?? 0))).toBeLessThanOrEqual(40);
    expect(assignedTags).toHaveLength(61);
    expect(new Set(assignedTags).size).toBe(61);
    expect(workspace.appliedOperations.filter((operation) => operation.path.startsWith('wiki/concepts/knowledge/'))).toHaveLength(61);
    expect(workspace.appliedOperations.some((operation) => operation.path.includes('/unfiled/'))).toBe(false);
  });

  it('falls back to an unfiled pivot page when the first family grouping degrades', async () => {
    const fiche: WikiPage = {
      absolutePath: '/tmp/wiki/wiki/sources/doc/section.md',
      relativePath: 'wiki/sources/doc/section.md', name: 'section.md', type: 'source',
      content: '---\ntitle: Réseau\ntags: [orphelin]\n---\n# Réseau\nFiche.',
    };
    const logger = new MemoryTraceLogger();
    const workspace = new FakeWorkspaceService();
    const llm = Object.assign(new FakeLLMService(), {
      async completeText() { return 'not a complete family assignment'; },
    });
    const service = new IngestService(
      createConfig(), workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService([fiche]) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger, disabledCache(),
    );
    await (service as unknown as { regenerateTaxoTagPages(): Promise<void> }).regenerateTaxoTagPages();
    // A degraded first grouping must not leave the wiki without its navigation
    // pages: the tag lands under unfiled/, and the degradation is announced.
    expect(workspace.appliedOperations.some((operation) => operation.path === 'wiki/concepts/unfiled/orphelin.md')).toBe(true);
    expect(logger.entries.some((entry) => entry.event === 'ingest:tag-family-degraded')).toBe(true);
  });

  it('announces a new tag left unfiled when families are already established', async () => {
    const fiche: WikiPage = {
      absolutePath: '/tmp/wiki/wiki/sources/doc/section.md',
      relativePath: 'wiki/sources/doc/section.md', name: 'section.md', type: 'source',
      content: '---\ntitle: Réseau\ntags: [orphelin]\n---\n# Réseau\nFiche.',
    };
    const established: WikiPage = {
      absolutePath: '/tmp/wiki/wiki/concepts/reseau/vlan.md',
      relativePath: 'wiki/concepts/reseau/vlan.md', name: 'vlan.md', type: 'concept',
      content: '---\ntype: concept\nsubject: vlan\nfamily: Réseau\ntags: [vlan]\ngenerated:\n  by: llm-wiki-tags\n---\n# Vlan\n',
    };
    const logger = new MemoryTraceLogger();
    const workspace = new FakeWorkspaceService();
    const llm = Object.assign(new FakeLLMService(), {
      async completeText() { return 'not a complete family assignment'; },
    });
    const service = new IngestService(
      createConfig(), workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService([fiche, established]) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger, disabledCache(),
    );
    await (service as unknown as { regenerateTaxoTagPages(): Promise<void> }).regenerateTaxoTagPages();
    expect(workspace.appliedOperations.some((operation) => operation.path.includes('/unfiled/'))).toBe(false);
    expect(logger.entries.some((entry) => entry.event === 'ingest:tag-unfiled' && entry.data?.tag === 'orphelin')).toBe(true);
  });

  it('does not treat the unfiled holding folder as an established family', async () => {
    const fiche: WikiPage = {
      absolutePath: '/tmp/wiki/wiki/sources/doc/section.md',
      relativePath: 'wiki/sources/doc/section.md', name: 'section.md', type: 'source',
      content: '---\ntitle: Logiciel\ntags: [logiciel]\n---\n# Logiciel\nFiche.',
    };
    const provisional: WikiPage = {
      absolutePath: '/tmp/wiki/wiki/concepts/unfiled/logiciel.md',
      relativePath: 'wiki/concepts/unfiled/logiciel.md', name: 'logiciel.md', type: 'concept',
      // Deliberately stale/malformed family metadata: the reserved path alone
      // must keep this incremental pivot out of the established-family set.
      content: '---\ntype: concept\nsubject: logiciel\nfamily: Divers\ntags: [logiciel]\ngenerated:\n  by: llm-wiki-tags\n---\n# Logiciel\n',
    };
    const logger = new MemoryTraceLogger();
    const workspace = new FakeWorkspaceService();
    let familyCalls = 0;
    const llm = Object.assign(new FakeLLMService(), {
      async completeText(request: { label?: string }) {
        if (request.label === 'ingest_taxo_families') {
          familyCalls += 1;
          return JSON.stringify([{ family: 'Applications', tags: ['logiciel'] }]);
        }
        return 'KEEP';
      },
    });
    const service = new IngestService(
      createConfig(), workspace as unknown as WorkspaceService,
      llm as unknown as LLMService,
      new FakeRetrievalService([fiche, provisional]) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger, disabledCache(),
    );
    await (service as unknown as { regenerateTaxoTagPages(): Promise<void> }).regenerateTaxoTagPages();
    expect(familyCalls).toBe(1);
    expect(workspace.appliedOperations.some((operation) => operation.path === 'wiki/concepts/applications/logiciel.md')).toBe(true);
  });

  it('previews only legacy generated notes and leaves TAXO fiches/pivots plus stable legacy pages alone', async () => {
    const pages: WikiPage[] = [
      {
        absolutePath: '/tmp/wiki/wiki/sources/old-note.md', relativePath: 'wiki/sources/old-note.md',
        name: 'old-note.md', type: 'source',
        content: '---\ntype: source\ngenerated:\n  by: llm-wiki\nstatus: draft\n---\n## Résumé\nAncien résumé.\n',
      },
      {
        absolutePath: '/tmp/wiki/wiki/concepts/network.md', relativePath: 'wiki/concepts/network.md',
        name: 'network.md', type: 'concept',
        content: '---\ntype: concept\ngenerated:\n  by: llm-wiki\nstatus: draft\n---\n# Network\n',
      },
      {
        absolutePath: '/tmp/wiki/wiki/concepts/old-taxo/old-taxo_tarifs.md', relativePath: 'wiki/concepts/old-taxo/old-taxo_tarifs.md',
        name: 'old-taxo_tarifs.md', type: 'concept',
        content: '---\ntype: concept\ngenerated:\n  by: taxo-pipeline\nstatus: draft\n---\n# Old TAXO leaf\n',
      },
      {
        absolutePath: '/tmp/wiki/wiki/concepts/stable.md', relativePath: 'wiki/concepts/stable.md',
        name: 'stable.md', type: 'concept',
        content: '---\ntype: concept\ngenerated:\n  by: llm-wiki\nstatus: stable\n---\n# Stable\n',
      },
      {
        absolutePath: '/tmp/wiki/wiki/concepts/family/tag.md', relativePath: 'wiki/concepts/family/tag.md',
        name: 'tag.md', type: 'concept',
        content: '---\ntype: concept\ngenerated:\n  by: llm-wiki-tags\nfamily: family\n---\n# Tag\n',
      },
      {
        absolutePath: '/tmp/wiki/wiki/sources/doc/section.md', relativePath: 'wiki/sources/doc/section.md',
        name: 'section.md', type: 'source',
        content: '---\ntype: source\ngenerated:\n  by: taxo-pipeline\ninput_hash: abc\n---\n# Section\n',
      },
    ];
    const migrationWorkspace = new FakeWorkspaceService();
    const service = new IngestService(
      createConfig(),
      migrationWorkspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService(pages) as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      new MemoryTraceLogger(),
      disabledCache(),
    );

    await expect(service.previewLegacySheetMigration()).resolves.toEqual({
      remove: ['wiki/concepts/network.md', 'wiki/concepts/old-taxo/old-taxo_tarifs.md', 'wiki/sources/old-note.md'],
      protected: ['wiki/concepts/stable.md'],
    });
    expect(migrationWorkspace.appliedOperations).toEqual([]); // preview is read-only
    Object.defineProperty(service, 'regenerateIndex', { value: async () => undefined });
    await expect(service.applyLegacySheetMigration()).resolves.toEqual([
      'wiki/concepts/network.md', 'wiki/concepts/old-taxo/old-taxo_tarifs.md', 'wiki/sources/old-note.md',
    ]);
    expect(migrationWorkspace.appliedOperations.map((operation) => operation.path).sort()).toEqual([
      'wiki/concepts/network.md', 'wiki/concepts/old-taxo/old-taxo_tarifs.md', 'wiki/sources/old-note.md',
    ]);
  });

  it('prunes registry-owned pages from vanished archives after a complete inventory, but protects shared/stable pages', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-ingest-prune-'));
    const workspace = new FakeWorkspaceService();
    workspace.paths.rootDir = root;
    workspace.paths.internalDir = path.join(root, '.wiki', 'internal');
    await mkdir(workspace.paths.internalDir, { recursive: true });
    await writeFile(path.join(workspace.paths.internalDir, 'source-registry.json'), JSON.stringify({
      version: 1,
      sources: [
        { sourceId: 'path:raw/ingested/gone.md', archivePath: 'raw/ingested/gone.md', contentHash: 'x', status: 'active', firstSeenAt: 'x', lastSeenAt: 'x', lastIngestedAt: 'x', producedPages: ['wiki/sources/gone/a.md', 'wiki/sources/shared.md', 'wiki/concepts/team/verified.md'] },
        { sourceId: 'path:raw/ingested/live.md', archivePath: 'raw/ingested/live.md', contentHash: 'x', status: 'active', firstSeenAt: 'x', lastSeenAt: 'x', lastIngestedAt: 'x', producedPages: ['wiki/sources/shared.md'] },
      ],
    }), 'utf8');
    const pages: WikiPage[] = [
      { absolutePath: '', relativePath: 'wiki/sources/gone/a.md', name: 'a.md', type: 'source', content: '---\nstatus: draft\n---\n# A\n' },
      { absolutePath: '', relativePath: 'wiki/sources/shared.md', name: 'shared.md', type: 'source', content: '---\nstatus: draft\n---\n# Shared\n' },
      { absolutePath: '', relativePath: 'wiki/concepts/team/verified.md', name: 'verified.md', type: 'concept', content: '---\nstatus: stable\n---\n# Verified\n' },
    ];
    const logger = new MemoryTraceLogger();
    const retrieval = new FakeRetrievalService(pages);
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      retrieval as unknown as RetrievalService,
      { refresh: async () => [] } as unknown as RefreshService,
      logger,
      disabledCache(),
    );
    const prune = (service as unknown as {
      pruneMissingSourcePages: (ids: ReadonlySet<string>) => Promise<void>;
    }).pruneMissingSourcePages.bind(service);

    try {
      await prune(new Set(['path:raw/ingested/live.md']));
      expect(workspace.appliedOperations).toEqual([
        { type: 'delete', path: 'wiki/sources/gone/a.md' },
      ]);
      expect(JSON.parse(await readFile(path.join(workspace.paths.internalDir, 'source-registry.json'), 'utf8'))
        .sources.find((source: { sourceId: string }) => source.sourceId.endsWith('gone.md')).status).toBe('missing');
      expect(logger.entries.some((entry) => entry.event === 'ingest:sheet-pruned')).toBe(true);
      expect(logger.entries.some((entry) => entry.event === 'ingest:sheet-prune-skipped')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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


  it('does not purge the concept tree during a --from-ingested rebuild', async () => {
    const workspace = new RebuildWorkspaceService();
    workspace.sourcePaths = ['/tmp/wiki/raw/ingested/note.md'];
    workspace.conceptLeaves = [
      'wiki/concepts/old/note.md',
      'wiki/concepts/other/thing.md',
    ];
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

    await service.ingest([], { fromIngested: true });

    expect(workspace.appliedBatches.flat().some((operation) => (
      operation.type === 'delete'
      && ['wiki/concepts/old/note.md', 'wiki/concepts/other/thing.md'].includes(operation.path)
    ))).toBe(false);
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
    expect(workspace.appliedOperations.some((operation) => operation.path === 'wiki/sources/note/contexte.md')).toBe(true);
  });


  it('rebuilds an unchanged archive when its TAXO section input hashes are stale or absent', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceUnchanged = true;
    const service = new IngestService(
      createConfig(),
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
      new CountingRefreshService() as unknown as RefreshService,
      new MemoryTraceLogger(),
      disabledCache(),
    );
    const select = (service as unknown as {
      filterSourcesNeedingTaxoPrePass: (paths: string[], registry: null, options: object) => Promise<Array<{ sourcePath: string; relativePath: string }>>;
    }).filterSourcesNeedingTaxoPrePass.bind(service);
    await expect(select(['/tmp/wiki/raw/ingested/note.md'], null, {}))
      .resolves.toEqual([{
        sourcePath: '/tmp/wiki/raw/ingested/note.md',
        relativePath: 'raw/untracked/note.md',
      }]);
  });

  it('still skips an unchanged source whose produced pages all exist', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceUnchanged = true;
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-ingest-present-'));
    workspace.paths.rootDir = root;
    workspace.paths.internalDir = path.join(root, '.wiki', 'internal');
    await mkdir(workspace.paths.internalDir, { recursive: true });
    const config = createConfig();
    const rawContent = `# note\n\n${workspace.sourceBody}\n`;
    const sheet = extractSectionSheets(rawContent, 'note', config.ingest?.sheets)[0]!;
    const signature = `4:${config.llm.model}:${config.language}`;
    const startLine = sheet.sourceRanges[0]!.startLine;
    const endLine = sheet.sourceRanges[sheet.sourceRanges.length - 1]!.endLine;
    const sheetPath = 'wiki/sources/note/contexte.md';
    const tagPath = 'wiki/concepts/knowledge/knowledge.md';
    await mkdir(path.dirname(path.join(root, sheetPath)), { recursive: true });
    await mkdir(path.dirname(path.join(root, tagPath)), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'concepts', 'unclassified'), { recursive: true });
    const sheetContent = [
      '---', 'type: source', 'title: Note', 'tags:', '  - knowledge',
      `input_hash: ${sheetInputHash('raw/ingested/note.md', startLine, endLine, sheet.body, signature)}`,
      `content_hash: ${sheetContentHash(sheet.body, signature)}`,
      '---', '', '# Contexte', '', 'Information de contexte.',
    ].join('\n');
    const tagContent = [
      '---', 'type: concept', 'subject: "knowledge"',
      'concept_id: "00000000-0000-4000-8000-000000000001"',
      'subject_id: "00000000-0000-4000-8000-000000000002"',
      'title: "Knowledge"', 'family: "Knowledge"', 'sheet_count: 1',
      'status: draft', 'generated:', '  by: llm-wiki-tags',
      '  at: 2026-01-01T00:00:00.000Z', 'tags: ["knowledge"]',
      '---', '', '# Knowledge', '', '## Sources', '',
      '- **Note** [src: wiki/sources/note/contexte.md]', '',
    ].join('\n');
    await writeFile(path.join(root, sheetPath), sheetContent, 'utf8');
    await writeFile(path.join(root, tagPath), tagContent, 'utf8');
    await writeFile(
      path.join(workspace.paths.internalDir, 'source-registry.json'),
      `${JSON.stringify({
        version: 1,
        sources: [{
          sourceId: 'path:raw/ingested/note.md',
          archivePath: 'raw/ingested/note.md',
          producedPages: [sheetPath, tagPath],
        }],
      })}\n`,
      'utf8',
    );
    const retrieval = new FakeRetrievalService([
      { absolutePath: path.join(root, sheetPath), relativePath: sheetPath, name: 'contexte.md', type: 'source', content: sheetContent },
      { absolutePath: path.join(root, tagPath), relativePath: tagPath, name: 'knowledge.md', type: 'concept', content: tagContent },
    ]);
    const logger = new MemoryTraceLogger();
    const service = new IngestService(
      config,
      workspace as unknown as WorkspaceService,
      new FakeLLMService() as unknown as LLMService,
      retrieval as unknown as RetrievalService,
      new CountingRefreshService() as unknown as RefreshService,
      logger,
      disabledCache(),
    );

    const results = await service.ingest([], {});

    expect(workspace.appliedOperations).toEqual([]);
    expect(workspace.archivedSources).toEqual(['raw/untracked/note.md']);
    expect(results[0]?.skipped).toBe(true);
    expect(logger.entries.some((entry) => entry.event === 'ingest:source-skip')).toBe(true);
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


  it('limits concurrent ingest section LLM calls', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.sourceBody = [
      '# Large source',
      '',
      '# First section',
      'A'.repeat(70),
      '',
      '# Second section',
      'B'.repeat(70),
      '',
      '# Third section',
      'C'.repeat(70),
      '',
      '# Fourth section',
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
    expect(llm.maxActive).toBeLessThanOrEqual(2);
    expect(llm.maxActive).toBeGreaterThan(1);
    expect(workspace.appliedBatches).toHaveLength(1);
    expect(results[0].plan?.operations).toHaveLength(4);
  });

  it('returns review diffs for planned wiki operations', async () => {
    const workspace = new FakeWorkspaceService();
    workspace.wikiPages = [
      {
        absolutePath: '/tmp/wiki/wiki/sources/note/contexte.md',
        relativePath: 'wiki/sources/note/contexte.md',
        name: 'contexte.md',
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
      path: 'wiki/sources/note/contexte.md',
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

    const results = await service.ingest([], { reject: ['wiki/sources/note/contexte.md'] });

    expect(results[0].review?.[0]).toMatchObject({
      path: 'wiki/sources/note/contexte.md',
      status: 'rejected',
    });
    expect(results[0].plan?.operations).toEqual([]);
    expect(workspace.appliedOperations).toEqual([]);
    expect(workspace.archivedSources).toEqual([]);
    expect(
      logger.entries.find((entry) => entry.event === 'ingest:apply-skip')?.data,
    ).toMatchObject({ reason: 'all operations rejected' });
  });

  it('retries a transient TAXO section failure once before using the faithful fallback', async () => {
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
      await vi.waitFor(() => expect(llm.sheetCalls).toBe(1));
      await vi.advanceTimersByTimeAsync(3000);
      const results = await ingest;

      expect(llm.sheetCalls).toBe(2);
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

  it('keeps the original section when TAXO output is malformed', async () => {
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

    expect(results[0]?.source).toBe('raw/untracked/note.md');
    expect(results[0]?.failed).toBeUndefined();
    expect(logger.entries.some((entry) => entry.event === 'ingest:retry')).toBe(false);
    expect(logger.entries.some((entry) => entry.event === 'ingest:sheet-fallback')).toBe(true);
  });

  it('isolates repeated TAXO section failures and continues with remaining sources', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const workspace = new FakeWorkspaceService();
    workspace.sourcePaths = [
      '/tmp/wiki/raw/untracked/first.md',
      '/tmp/wiki/raw/untracked/second.md',
    ];
    // Give each document its own H1: the failing fake targets the first one by
    // its document title (`## first`), and both share the same section bodies.
    const readSourceDocument = workspace.readSourceDocument.bind(workspace);
    workspace.readSourceDocument = async (sourcePath = '') => {
      const doc = await readSourceDocument(sourcePath);
      const documentSlug = sourcePath.includes('second') ? 'second' : 'first';
      return {
        ...doc,
        title: documentSlug,
        body: `# ${documentSlug}\n\n${workspace.sourceBody}`,
        rawContent: `# ${documentSlug}\n\n${workspace.sourceBody}\n`,
      };
    };
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
      await vi.waitFor(() => expect(llm.sheetAttempts).toBe(1));
      await vi.advanceTimersByTimeAsync(10000);
      const results = await ingest;

      expect(results).toHaveLength(2);
      expect(results.every((result) => !result.failed)).toBe(true);
      expect(workspace.appliedBatches).toHaveLength(2);
      expect(workspace.archivedSources).toEqual(['raw/untracked/first.md', 'raw/untracked/second.md']);
      expect(logger.entries.some((entry) => entry.event === 'ingest:sheet-fallback')).toBe(true);
      expect(
        logger.entries.find((entry) => entry.event === 'ingest:run-done')?.data,
      ).toMatchObject({
        failed: 0,
        status: 'success',
      });
    } finally {
      vi.useRealTimers();
    }
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

});



describe('staleRebuiltLeaves', () => {
  const registry = (sources: Array<{ archivePath: string; producedPages: string[] }>) => ({
    version: 1,
    sources: sources.map((source) => ({
      sourceId: `path:${source.archivePath}`,
      archivePath: source.archivePath,
      contentHash: 'sha256:x',
      status: 'active' as const,
      firstSeenAt: 't',
      lastSeenAt: 't',
      lastIngestedAt: 't',
      producedPages: source.producedPages,
    })),
  });

  it('flags concept leaves a rebuild no longer produces', () => {
    const previous = registry([
      { archivePath: 'raw/ingested/s.md', producedPages: ['wiki/concepts/old/x.md', 'wiki/sources/s.md'] },
    ]);
    const current = registry([
      { archivePath: 'raw/ingested/s.md', producedPages: ['wiki/concepts/new/x.md', 'wiki/sources/s.md'] },
    ]);
    expect(staleRebuiltLeaves(previous, current, ['raw/ingested/s.md'])).toEqual([
      'wiki/concepts/old/x.md',
    ]);
  });

  it('keeps a leaf another source still produces', () => {
    const previous = registry([
      { archivePath: 'raw/ingested/a.md', producedPages: ['wiki/concepts/offre/x.md'] },
      { archivePath: 'raw/ingested/b.md', producedPages: ['wiki/concepts/offre/x.md'] },
    ]);
    const current = registry([
      { archivePath: 'raw/ingested/a.md', producedPages: [] },
      { archivePath: 'raw/ingested/b.md', producedPages: ['wiki/concepts/offre/x.md'] },
    ]);
    expect(staleRebuiltLeaves(previous, current, ['raw/ingested/a.md'])).toEqual([]);
  });

  it('never prunes a source note, the index or a page outside the rebuild', () => {
    const previous = registry([
      { archivePath: 'raw/ingested/s.md', producedPages: ['wiki/sources/s.md', 'wiki/index.md', 'wiki/concepts/old/x.md'] },
    ]);
    const current = registry([{ archivePath: 'raw/ingested/s.md', producedPages: [] }]);
    expect(staleRebuiltLeaves(previous, current, ['raw/ingested/s.md'])).toEqual([
      'wiki/concepts/old/x.md',
    ]);
  });

  it('returns nothing when there is no previous registry', () => {
    const current = registry([{ archivePath: 'raw/ingested/s.md', producedPages: [] }]);
    expect(staleRebuiltLeaves(null, current, ['raw/ingested/s.md'])).toEqual([]);
  });
});
