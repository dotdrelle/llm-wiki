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
import {
  VectorIndexService,
  VectorIndexConfigMismatchError,
  type VectorIndex,
} from './vectorIndexService.ts';
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
const RERANK_RESULT_MAX_CHARS = 1200;
const VECTOR_DISABLE_AFTER_CONSECUTIVE_ERRORS = 3;
const BM25_K1 = 1.35;
const BM25_B = 0.72;

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[’']/g, ' ')
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
  ).filter((token) => !STOP_WORDS.has(token));
}

interface LexicalDocument {
  page: WikiPage;
  chunk: MarkdownChunk;
  pageChunkCount: number;
  tokens: string[];
  tokenCounts: Map<string, number>;
  headingTokens: string[];
  nameTokens: string[];
  pathTokens: string[];
}

interface Bm25Corpus {
  documents: LexicalDocument[];
  documentFrequency: Map<string, number>;
  averageLength: number;
}

export interface RetrievalSearchOptions {
  limit?: number;
  includeRaw?: boolean;
  rerank?: boolean;
  intent?: 'build' | 'search';
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function buildBm25Corpus(pages: WikiPage[]): Bm25Corpus {
  const documents: LexicalDocument[] = [];
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;

  for (const page of pages) {
    const chunks = splitByHeadings(page.content);
    const nameTokens = tokenize(page.name);
    const pathTokens = tokenize(page.relativePath);
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content);
      const document: LexicalDocument = {
        page,
        chunk,
        pageChunkCount: chunks.length,
        tokens,
        tokenCounts: countTokens(tokens),
        headingTokens: tokenize(chunk.heading),
        nameTokens,
        pathTokens,
      };
      documents.push(document);
      totalLength += Math.max(1, tokens.length);
      for (const token of new Set(tokens)) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  return {
    documents,
    documentFrequency,
    averageLength: documents.length > 0 ? totalLength / documents.length : 1,
  };
}

function bm25TermScore(
  termFrequency: number,
  documentFrequency: number,
  documentLength: number,
  averageLength: number,
  documentCount: number,
): number {
  if (termFrequency <= 0 || documentFrequency <= 0 || documentCount <= 0) return 0;
  const idf = Math.log(
    1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
  );
  const denominator =
    termFrequency +
    BM25_K1 * (1 - BM25_B + BM25_B * (documentLength / Math.max(1, averageLength)));
  return idf * ((termFrequency * (BM25_K1 + 1)) / denominator);
}

function scoreDocument(
  queryTokens: string[],
  document: LexicalDocument,
  corpus: Bm25Corpus,
): number {
  const queryCounts = countTokens(queryTokens);
  const documentLength = Math.max(1, document.tokens.length);
  let score = 0;

  for (const [token, queryFrequency] of queryCounts) {
    score +=
      queryFrequency *
      bm25TermScore(
        document.tokenCounts.get(token) ?? 0,
        corpus.documentFrequency.get(token) ?? 0,
        documentLength,
        corpus.averageLength,
        corpus.documents.length,
      );
    if (document.headingTokens.includes(token)) score += 1.8;
    if (document.nameTokens.includes(token)) score += 3.6;
    if (document.pathTokens.includes(token)) score += 1.4;
    if (canonicalizeName(document.page.name).includes(canonicalizeName(token)))
      score += 0.8;
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

function resultText(result: SearchResult): string {
  const text = [
    result.page.name,
    result.chunk?.headingPath.join(' > '),
    result.chunk?.content ?? result.page.content,
  ]
    .filter(Boolean)
    .join('\n\n');
  return text.length > RERANK_RESULT_MAX_CHARS
    ? `${text.slice(0, RERANK_RESULT_MAX_CHARS).trimEnd()}\n[truncated]`
    : text;
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
  private vectorIndex: VectorIndex | undefined;
  private readonly loggedVectorFallbacks = new Set<string>();
  private vectorDisabledAfterError = false;
  private consecutiveVectorErrors = 0;

  constructor(workspace: WorkspaceService, config: AppConfig, logger?: TraceLogger) {
    this.workspace = workspace;
    this.config = config;
    this.logger = logger;
  }

  invalidateCache(): void {
    this.wikiPagesCache = undefined;
  }

  private getVectorIndex(): VectorIndex {
    this.vectorIndex ??= new VectorIndexService(
      this.config,
      this.workspace,
      new EmbeddingService(
        this.config,
        this.logger,
        this.workspace.paths.queryEmbeddingCacheDir,
      ),
      new RerankService(this.config, this.logger, this.workspace.paths.rerankCacheDir),
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

  async search(query: string, options?: RetrievalSearchOptions): Promise<SearchResult[]> {
    const buildBm25Only =
      options?.intent === 'build' && this.config.retrieval.buildStrategy === 'bm25';
    if (
      !buildBm25Only &&
      !options?.includeRaw &&
      this.config.retrieval.vector.enabled &&
      !this.vectorDisabledAfterError
    ) {
      if (!(await pathExists(this.workspace.paths.vectorIndexDir))) {
        await this.logVectorFallback('missing-index', query);
        return this.searchLexical(query, options);
      }

      try {
        const vectorResults = await this.getVectorIndex().search(query, {
          limit: options?.limit,
          rerank: options?.rerank,
        });
        this.consecutiveVectorErrors = 0;
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
        if (error instanceof VectorIndexConfigMismatchError) {
          this.vectorDisabledAfterError = true;
          const message = error.message;
          await this.logVectorFallback('vector-index-mismatch', query, error, {
            disabled: true,
          });
          console.warn(`Warning: vector retrieval disabled — ${message}`);
        } else {
          this.consecutiveVectorErrors += 1;
          if (this.consecutiveVectorErrors >= VECTOR_DISABLE_AFTER_CONSECUTIVE_ERRORS) {
            this.vectorDisabledAfterError = true;
          }
          await this.logVectorFallback('vector-error', query, error, {
            consecutiveErrors: this.consecutiveVectorErrors,
            disabled: this.vectorDisabledAfterError,
          });
          if (this.vectorDisabledAfterError) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
              `Warning: vector retrieval disabled after ${this.consecutiveVectorErrors} consecutive error(s); using lexical fallback. ${message}`,
            );
          }
        }
        // Keep retrieval robust for ingest/build/query/MCP: vector search is an
        // optimization, while lexical search is the compatibility fallback.
      }
    }

    return this.searchLexical(query, options);
  }

  async rerankResults(
    query: string,
    results: SearchResult[],
    options?: { limit?: number },
  ): Promise<SearchResult[]> {
    if (this.config.retrieval.vector.rerankEnabled === false || results.length === 0) {
      return results;
    }

    const limit = Math.min(options?.limit ?? results.length, results.length);
    try {
      const reranked = await new RerankService(
        this.config,
        this.logger,
        this.workspace.paths.rerankCacheDir,
      ).rerank(query, results.map(resultText), limit);
      const ranked = reranked
        .map((result) => {
          const item = results[result.index];
          return item ? { ...item, score: result.score } : undefined;
        })
        .filter((result): result is SearchResult => Boolean(result));
      if (ranked.length === 0) return results.slice(0, limit);
      return ranked;
    } catch (error) {
      await this.logVectorFallback('rerank-error', query, error);
      return results;
    }
  }

  private async logVectorFallback(
    reason: 'missing-index' | 'vector-error' | 'vector-index-mismatch' | 'rerank-error',
    query: string,
    error?: unknown,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.logger) return;
    const key =
      reason === 'missing-index'
        ? reason
        : `${reason}:${String(error)}:${details.disabled ? 'disabled' : 'active'}`;
    if (this.loggedVectorFallbacks.has(key)) return;
    this.loggedVectorFallbacks.add(key);
    await this.logger.warn('retrieval:vector-fallback', {
      reason,
      indexPath: this.workspace.paths.vectorIndexDir,
      queryPreview: query.slice(0, 160),
      fallback: 'lexical',
      ...details,
      ...(error
        ? { message: error instanceof Error ? error.message : String(error) }
        : {}),
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

    const corpus = buildBm25Corpus([...wikiPages, ...rawPages]);

    for (const document of corpus.documents) {
      const score = scoreDocument(queryTokens, document, corpus);
      if (score > 0) {
        const isWholePageChunk = document.pageChunkCount === 1 && !document.chunk.heading;
        results.push({
          page: document.page,
          score,
          relatedPaths:
            document.page.relativePath === 'wiki/index.md'
              ? extractIndexRelatedPaths(queryTokens, document.page)
              : extractRelatedPaths(document.chunk.content),
          chunk: isWholePageChunk
            ? undefined
            : {
                headingPath: document.chunk.headingPath,
                content: document.chunk.content,
              },
        });
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
