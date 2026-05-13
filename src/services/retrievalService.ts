import { canonicalizeName } from '../utils/path.ts';
import { pathExists } from '../utils/fs.ts';
import {
  extractSourceCitations,
  extractWikiLinks,
  splitByHeadings,
} from '../utils/markdown.ts';
import type { AppConfig, SearchResult, WikiPage } from '../types.ts';
import type { MarkdownChunk } from '../utils/markdown.ts';
import type { WorkspaceService } from './workspaceService.ts';
import { EmbeddingService } from './embeddingService.ts';
import { RerankService } from './rerankService.ts';
import { VectorIndexService } from './vectorIndexService.ts';
import type { TraceLogger } from './traceLogger.ts';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'dans',
  'avec',
  'pour',
  'de',
  'du',
  'la',
  'le',
  'un',
  'en',
  'ou',
  'il',
  'elle',
  'on',
  'into',
  'have',
  'will',
  'sur',
  'une',
  'des',
  'les',
  'est',
  'are',
  'you',
  'your',
  'not',
  'pas',
  'peux',
  'peut',
  'tu',
  'me',
  'moi',
  'donner',
  'resume',
]);

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
  ).filter((token) => !STOP_WORDS.has(token));
}

function scoreChunk(queryTokens: string[], chunk: MarkdownChunk, page: WikiPage): number {
  const contentSet = new Set(tokenize(chunk.content));
  const headingTokens = tokenize(chunk.heading);
  const nameTokens = tokenize(page.name);
  const pathTokens = tokenize(page.relativePath);
  let score = 0;

  for (const token of queryTokens) {
    if (contentSet.has(token)) score += 1;
    if (headingTokens.includes(token)) score += 3;
    if (nameTokens.includes(token)) score += 8;
    if (pathTokens.includes(token)) score += 4;
    if (canonicalizeName(page.name).includes(canonicalizeName(token))) score += 1;
  }

  return score;
}

function normalizeRelatedPath(value: string): string | undefined {
  const clean = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').split('#')[0];
  if (!clean.startsWith('wiki/') && !clean.startsWith('raw/ingested/')) {
    return undefined;
  }
  return clean;
}

function extractRelatedPaths(content: string): string[] {
  return [
    ...new Set(
      [...extractWikiLinks(content), ...extractSourceCitations(content)]
        .map(normalizeRelatedPath)
        .filter((path): path is string => Boolean(path)),
    ),
  ];
}

function scoreText(queryTokens: string[], text: string): number {
  const tokens = new Set(tokenize(text));
  let score = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) score += 1;
  }
  return score;
}

function extractIndexRelatedPaths(queryTokens: string[], indexPage: WikiPage): string[] {
  const lines = indexPage.content.split('\n');
  const minScore = queryTokens.length > 1 ? 2 : 1;
  const matchingLineIndexes = lines
    .map((line, index) => ({ index, score: scoreText(queryTokens, line) }))
    .filter((line) => line.score >= minScore)
    .map((line) => line.index);
  const related = new Set<string>();
  const windowSize = 15;

  for (const lineIndex of matchingLineIndexes) {
    const start = Math.max(0, lineIndex - windowSize);
    const end = Math.min(lines.length, lineIndex + windowSize + 1);
    for (const line of lines.slice(start, end)) {
      for (const relatedPath of extractWikiLinks(line)) {
        const normalized = normalizeRelatedPath(relatedPath);
        if (normalized?.startsWith('wiki/concepts/')) {
          related.add(normalized);
        }
      }
    }
  }

  return [...related];
}

function mergeResults(results: SearchResult[]): SearchResult[] {
  const bestByPath = new Map<string, SearchResult>();
  const wikiSourceNames = new Set(
    results
      .filter((result) => result.page.relativePath.startsWith('wiki/sources/'))
      .map((result) => result.page.name),
  );

  for (const result of results) {
    if (
      result.page.relativePath.startsWith('raw/ingested/') &&
      wikiSourceNames.has(result.page.name)
    ) {
      continue;
    }

    const existing = bestByPath.get(result.page.relativePath);
    if (!existing || result.score > existing.score) {
      bestByPath.set(result.page.relativePath, {
        ...result,
        relatedPaths: [
          ...new Set([...(existing?.relatedPaths ?? []), ...(result.relatedPaths ?? [])]),
        ],
      });
      continue;
    }

    if (result.relatedPaths?.length) {
      existing.relatedPaths = [
        ...new Set([...(existing.relatedPaths ?? []), ...result.relatedPaths]),
      ];
    }
  }

  return [...bestByPath.values()].sort((a, b) => b.score - a.score);
}

export class RetrievalService {
  private readonly workspace: WorkspaceService;
  private readonly config: AppConfig;
  private readonly logger?: TraceLogger;
  private wikiPagesCache: Promise<WikiPage[]> | undefined;
  private vectorIndex: VectorIndexService | undefined;
  private readonly loggedVectorFallbacks = new Set<string>();

  constructor(workspace: WorkspaceService, config: AppConfig, logger?: TraceLogger) {
    this.workspace = workspace;
    this.config = config;
    this.logger = logger;
  }

  invalidateCache(): void {
    this.wikiPagesCache = undefined;
  }

  private getVectorIndex(): VectorIndexService {
    this.vectorIndex ??= new VectorIndexService(
      this.config,
      this.workspace,
      new EmbeddingService(this.config),
      new RerankService(this.config),
    );
    return this.vectorIndex;
  }

  async warmCache(
    onPage?: (relativePath: string, index: number, total: number) => void,
  ): Promise<WikiPage[]> {
    if (!this.wikiPagesCache) {
      this.wikiPagesCache = this.workspace.listWikiPages(onPage);
    }
    return this.wikiPagesCache;
  }

  async search(
    query: string,
    options?: { limit?: number; includeRaw?: boolean },
  ): Promise<SearchResult[]> {
    if (!options?.includeRaw && this.config.retrieval.vector.enabled) {
      if (!(await pathExists(this.workspace.paths.vectorIndexDir))) {
        await this.logVectorFallback('missing-index', query);
        return this.searchLexical(query, options);
      }

      try {
        const vectorResults = await this.getVectorIndex().search(query, {
          limit: options?.limit,
        });
        const lexicalResults = await this.searchLexical(query, {
          ...options,
          limit:
            options?.limit ??
            Math.max(
              this.config.retrieval.maxContextFiles,
              this.config.retrieval.vector.maxResults,
            ),
        });
        return mergeResults([...vectorResults, ...lexicalResults]).slice(
          0,
          options?.limit ?? this.config.retrieval.vector.maxResults,
        );
      } catch (error) {
        await this.logVectorFallback('vector-error', query, error);
        // Keep retrieval robust for ingest/build/query/MCP: vector search is an
        // optimization, while lexical search is the compatibility fallback.
      }
    }

    return this.searchLexical(query, options);
  }

  private async logVectorFallback(
    reason: 'missing-index' | 'vector-error',
    query: string,
    error?: unknown,
  ): Promise<void> {
    if (!this.logger) return;
    const key = reason === 'missing-index' ? reason : `${reason}:${String(error)}`;
    if (this.loggedVectorFallbacks.has(key)) return;
    this.loggedVectorFallbacks.add(key);
    await this.logger.warn('retrieval:vector-fallback', {
      reason,
      indexPath: this.workspace.paths.vectorIndexDir,
      queryPreview: query.slice(0, 160),
      fallback: 'lexical',
      ...(error ? { message: error instanceof Error ? error.message : String(error) } : {}),
    });
  }

  private async searchLexical(
    query: string,
    options?: { limit?: number; includeRaw?: boolean },
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? this.config.retrieval.maxContextFiles;
    const queryTokens = tokenize(query);
    const allWikiPages = await (this.wikiPagesCache ??= this.workspace.listWikiPages());
    const wikiPages = allWikiPages.filter((page) => page.type !== 'answer');
    const rawPages = options?.includeRaw
      ? await this.workspace.listIngestedSourcePages()
      : [];
    const wikiPageByPath = new Map(wikiPages.map((page) => [page.relativePath, page]));

    const results: SearchResult[] = [];

    for (const page of [...wikiPages, ...rawPages]) {
      const chunks = splitByHeadings(page.content);

      for (const chunk of chunks) {
        const score = scoreChunk(queryTokens, chunk, page);
        if (score > 0) {
          const isWholePageChunk = chunks.length === 1 && !chunk.heading;
          results.push({
            page,
            score,
            relatedPaths:
              page.relativePath === 'wiki/index.md'
                ? extractIndexRelatedPaths(queryTokens, page)
                : extractRelatedPaths(chunk.content),
            chunk: isWholePageChunk
              ? undefined
              : { headingPath: chunk.headingPath, content: chunk.content },
          });
        }
      }
    }

    const indexPage = allWikiPages.find((page) => page.relativePath === 'wiki/index.md');
    if (indexPage) {
      const relatedIndexPaths = extractIndexRelatedPaths(queryTokens, indexPage);
      for (let i = 0; i < relatedIndexPaths.length; i++) {
        const relatedPage = wikiPageByPath.get(relatedIndexPaths[i]);
        if (!relatedPage || relatedPage.type === 'answer') continue;
        results.push({
          page: relatedPage,
          score: Math.max(1, 18 - i * 0.05),
          relatedPaths: extractRelatedPaths(relatedPage.content),
        });
      }
    }

    const maxChunksPerPage = this.config.retrieval.maxChunksPerPage;
    const sorted = mergeResults(results);
    const pageChunkCount = new Map<string, number>();
    const diverse: SearchResult[] = [];
    for (const result of sorted) {
      const key = result.page.relativePath;
      const count = pageChunkCount.get(key) ?? 0;
      if (count < maxChunksPerPage) {
        diverse.push(result);
        pageChunkCount.set(key, count + 1);
        if (diverse.length >= limit) break;
      }
    }
    return diverse;
  }
}
