import { mkdir } from 'node:fs/promises';
import * as lancedb from '@lancedb/lancedb';
import { makeArrowTable } from '@lancedb/lancedb';
import { Float32 } from 'apache-arrow';
import {
  extractSourceCitations,
  extractWikiLinks,
  splitByHeadings,
} from '../utils/markdown.ts';
import { hashText } from '../utils/hash.ts';
import { pathExists } from '../utils/fs.ts';
import type { AppConfig, SearchResult, WikiPage } from '../types.ts';
import type { EmbeddingService } from './embeddingService.ts';
import type { RerankService } from './rerankService.ts';
import type { WorkspaceService } from './workspaceService.ts';

const TABLE_NAME = 'wiki_chunks';
const META_TABLE_NAME = '_meta';
export const EMBED_BATCH_SIZE = 16;
export const EMBED_BATCH_MAX_CHARS = 24_000;
const RERANK_MAX_CHARS = 1200;

interface VectorRow {
  id: string;
  path: string;
  name: string;
  type: string;
  headingPath: string;
  heading: string;
  content: string;
  hash: string;
  vector: number[];
  _distance?: number;
}

export interface VectorIndexStats {
  exists: boolean;
  rows: number;
  path?: string;
  metadata?: VectorIndexMetadata;
}

export interface VectorIndexBuildResult {
  indexedChunks: number;
  embeddedChunks: number;
  reusedChunks: number;
  indexedPages: number;
  skippedChunks: number;
  skippedPages: string[];
  warnings: string[];
  metadata: VectorIndexMetadata;
  reusedExistingIndex: boolean;
  rebuiltForConfigChange: boolean;
}

export interface VectorIndex {
  stats(): Promise<VectorIndexStats>;
  buildIndex(): Promise<VectorIndexBuildResult>;
  search(
    query: string,
    options?: { limit?: number; rerank?: boolean },
  ): Promise<SearchResult[]>;
}

export interface VectorIndexMetadata {
  schemaVersion: number;
  provider: string;
  embeddingModel: string;
  dimension: number;
  builtAt: string;
}

interface VectorIndexMetadataRow extends VectorIndexMetadata {
  key: string;
}

function chunkId(page: WikiPage, index: number, part: number): string {
  return hashText(`${page.relativePath}:${index}:${part}`);
}

function rowText(row: VectorRow): string {
  const text = [row.name, row.heading, row.content].filter(Boolean).join('\n\n');
  return text.length > RERANK_MAX_CHARS
    ? `${text.slice(0, RERANK_MAX_CHARS).trimEnd()}\n[truncated]`
    : text;
}

function splitChunkForEmbedding(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];
  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += maxChars) {
      chunks.push(paragraph.slice(index, index + maxChars));
    }
    current = '';
  }

  if (current) chunks.push(current);
  return chunks;
}

function embeddingBatches<T extends { content: string }>(rows: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const row of rows) {
    if (
      current.length > 0 &&
      (current.length >= EMBED_BATCH_SIZE ||
        currentChars + row.content.length > EMBED_BATCH_MAX_CHARS)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(row);
    currentChars += row.content.length;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function scoreFromDistance(distance: number | undefined): number {
  if (typeof distance !== 'number') return 0;
  return 1 / (1 + Math.max(0, distance));
}

function normalizeVector(value: unknown): number[] | undefined {
  if (Array.isArray(value)) return value;
  if (value instanceof Float32Array || value instanceof Float64Array) {
    return Array.from(value);
  }
  if (
    value &&
    typeof value === 'object' &&
    'toArray' in value &&
    typeof (value as { toArray?: unknown }).toArray === 'function'
  ) {
    const array = (value as { toArray: () => unknown }).toArray();
    return Array.isArray(array) ||
      array instanceof Float32Array ||
      array instanceof Float64Array
      ? Array.from(array)
      : undefined;
  }
  return undefined;
}

export class VectorIndexConfigMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorIndexConfigMismatchError';
  }
}

function providerKey(config: AppConfig): string {
  return config.retrieval.vector.baseUrl.replace(/\/+$/, '');
}

function expectedMetadata(config: AppConfig, dimension: number): VectorIndexMetadata {
  return {
    schemaVersion: 1,
    provider: providerKey(config),
    embeddingModel: config.retrieval.vector.embeddingModel,
    dimension,
    builtAt: new Date().toISOString(),
  };
}

function metadataMatchesConfig(
  config: AppConfig,
  metadata: VectorIndexMetadata | undefined,
  dimension: number,
): boolean {
  return (
    Boolean(metadata) &&
    metadata?.provider === providerKey(config) &&
    metadata.embeddingModel === config.retrieval.vector.embeddingModel &&
    metadata.dimension === dimension
  );
}

// ~16 000 chars ≈ 4-5k tokens for French prose: comfortable margin under the
// 8192-token limit of bge-m3-class embedding models, regardless of tokenizer.
const EMBEDDING_QUERY_MAX_CHARS = 16000;

export function boundEmbeddingQuery(query: string, maxChars = EMBEDDING_QUERY_MAX_CHARS): string {
  const text = String(query ?? '');
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  return `${text.slice(0, headLength)}\n…\n${text.slice(-tailLength)}`;
}

function isEmbeddingInputLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(token|tokens|context|maximum|limit|too long|too large|8192|context_length_exceeded)\b/i.test(
    message,
  );
}

function embeddingSkipWarning(row: Omit<VectorRow, 'vector'>, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    `Skipped vector embedding for ${row.path}`,
    row.heading ? ` (${row.heading})` : '',
    `: input too large (${row.content.length.toLocaleString()} chars).`,
    ' Lexical search will still cover this content.',
    message ? ` Provider message: ${message.slice(0, 240)}` : '',
  ].join('');
}

export class VectorIndexService implements VectorIndex {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly embeddings: EmbeddingService;
  private readonly reranker: RerankService;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    embeddings: EmbeddingService,
    reranker: RerankService,
  ) {
    this.config = config;
    this.workspace = workspace;
    this.embeddings = embeddings;
    this.reranker = reranker;
  }

  private async connect() {
    await mkdir(this.workspace.paths.vectorIndexDir, { recursive: true });
    return lancedb.connect(this.workspace.paths.vectorIndexDir);
  }

  private async openTable() {
    if (!(await pathExists(this.workspace.paths.vectorIndexDir))) return undefined;
    const db = await this.connect();
    const names = await db.tableNames();
    if (!names.includes(TABLE_NAME)) return undefined;
    return db.openTable(TABLE_NAME);
  }

  private async readMetadata(): Promise<VectorIndexMetadata | undefined> {
    if (!(await pathExists(this.workspace.paths.vectorIndexDir))) return undefined;
    const db = await this.connect();
    const names = await db.tableNames();
    if (!names.includes(META_TABLE_NAME)) return undefined;
    const table = await db.openTable(META_TABLE_NAME);
    const rows = (await table.query().toArray()) as VectorIndexMetadataRow[];
    const row = rows.find((candidate) => candidate.key === 'index') ?? rows[0];
    if (!row) return undefined;
    return {
      schemaVersion: Number(row.schemaVersion ?? 0),
      provider: String(row.provider ?? ''),
      embeddingModel: String(row.embeddingModel ?? ''),
      dimension: Number(row.dimension ?? 0),
      builtAt: String(row.builtAt ?? ''),
    };
  }

  private async writeMetadata(metadata: VectorIndexMetadata): Promise<void> {
    const db = await this.connect();
    const tableNames = await db.tableNames();
    await db.createTable(META_TABLE_NAME, [{ key: 'index', ...metadata }], {
      mode: tableNames.includes(META_TABLE_NAME) ? 'overwrite' : 'create',
    });
  }

  private async assertCompatibleMetadata(queryDimension: number): Promise<void> {
    const metadata = await this.readMetadata();
    if (!metadata) {
      throw new VectorIndexConfigMismatchError(
        'Vector index metadata is missing. Rebuild the index with `wiki index`.',
      );
    }
    const expectedProvider = providerKey(this.config);
    const expectedModel = this.config.retrieval.vector.embeddingModel;
    const mismatches = [
      metadata.provider !== expectedProvider
        ? `provider ${metadata.provider || '(unknown)'} -> ${expectedProvider}`
        : null,
      metadata.embeddingModel !== expectedModel
        ? `embedding model ${metadata.embeddingModel || '(unknown)'} -> ${expectedModel}`
        : null,
      metadata.dimension !== queryDimension
        ? `dimension ${metadata.dimension || '(unknown)'} -> ${queryDimension}`
        : null,
    ].filter(Boolean);
    if (mismatches.length > 0) {
      throw new VectorIndexConfigMismatchError(
        `Vector index was built with different embedding settings (${mismatches.join(', ')}). Rebuild with \`wiki index\`.`,
      );
    }
  }

  private buildRowsWithoutVectors(pages: WikiPage[]): Omit<VectorRow, 'vector'>[] {
    const rows: Omit<VectorRow, 'vector'>[] = [];
    for (const page of pages.filter(
      (candidate) =>
        candidate.type !== 'answer' &&
        candidate.relativePath !== 'wiki/index.md' &&
        candidate.relativePath !== 'wiki/log.md',
    )) {
      const chunks = splitByHeadings(page.content);
      chunks.forEach((chunk, index) => {
        const headingPath = JSON.stringify(chunk.headingPath);
        const parts = splitChunkForEmbedding(
          chunk.content.trim(),
          this.config.retrieval.maxChunkChars,
        );
        parts.forEach((content, part) => {
          if (!content) return;
          rows.push({
            id: chunkId(page, index, part),
            path: page.relativePath,
            name: page.name,
            type: page.type,
            headingPath,
            heading: chunk.heading,
            content,
            hash: hashText(
              JSON.stringify({
                path: page.relativePath,
                headingPath,
                part,
                content,
              }),
            ),
          });
        });
      });
    }
    return rows;
  }

  async stats(): Promise<VectorIndexStats> {
    const table = await this.openTable();
    if (!table) {
      return { exists: false, rows: 0, path: this.workspace.paths.vectorIndexDir };
    }
    return {
      exists: true,
      rows: await table.countRows(),
      path: this.workspace.paths.vectorIndexDir,
      metadata: await this.readMetadata(),
    };
  }

  async buildIndex(): Promise<VectorIndexBuildResult> {
    const pages = await this.workspace.listWikiPages();
    const rowsWithoutVectors = this.buildRowsWithoutVectors(pages);
    const skippedRows = new Set<string>();
    const skippedPages = new Set<string>();
    const warnings: string[] = [];
    const skipRow = (row: Omit<VectorRow, 'vector'>, error: unknown) => {
      skippedRows.add(row.id);
      skippedPages.add(row.path);
      warnings.push(embeddingSkipWarning(row, error));
    };
    const embedSingle = async (
      row: Omit<VectorRow, 'vector'>,
    ): Promise<number[] | undefined> => {
      try {
        const [vector] = await this.embeddings.embed([row.content]);
        return vector;
      } catch (error) {
        if (!isEmbeddingInputLimitError(error)) throw error;
        skipRow(row, error);
        return undefined;
      }
    };

    let firstRow: Omit<VectorRow, 'vector'> | undefined;
    let probeVector: number[] | undefined;
    for (const row of rowsWithoutVectors) {
      probeVector = await embedSingle(row);
      if (probeVector) {
        firstRow = row;
        break;
      }
    }
    const currentDimension = probeVector?.length ?? 0;
    const existingMetadata = await this.readMetadata();
    const canReuseExisting = metadataMatchesConfig(
      this.config,
      existingMetadata,
      currentDimension,
    );
    const existingById = new Map<string, VectorRow>();
    const existing = await this.openTable();
    const rebuiltForConfigChange = Boolean(existing) && !canReuseExisting;
    if (existing && canReuseExisting) {
      for (const row of (await existing.query().toArray()) as VectorRow[]) {
        existingById.set(row.id, row);
      }
    }
    const probedEmbeddings = new Map<string, number[]>();
    if (!canReuseExisting && firstRow && probeVector) {
      probedEmbeddings.set(firstRow.id, probeVector);
    }
    const reusableExistingVector = (row: Omit<VectorRow, 'vector'>): number[] | undefined => {
      const existingRow = existingById.get(row.id);
      if (!existingRow || existingRow.hash !== row.hash) return undefined;
      const vector = normalizeVector(existingRow.vector);
      return vector?.length === currentDimension ? vector : undefined;
    };

    const rows: VectorRow[] = [];
    let embeddedChunks = probedEmbeddings.size;
    let reusedChunks = 0;
    for (const batch of embeddingBatches(rowsWithoutVectors)) {
      const missing = batch.filter(
        (row) =>
          !skippedRows.has(row.id) &&
          !reusableExistingVector(row) &&
          !probedEmbeddings.has(row.id),
      );
      const embedded = new Map<string, number[]>();
      for (const [id, vector] of probedEmbeddings) {
        embedded.set(id, vector);
      }
      if (missing.length > 0) {
        try {
          const vectors = await this.embeddings.embed(missing.map((row) => row.content));
          missing.forEach((row, index) => {
            embedded.set(row.id, vectors[index]);
          });
          embeddedChunks += missing.length;
        } catch (error) {
          if (!isEmbeddingInputLimitError(error)) throw error;
          for (const row of missing) {
            const vector = await embedSingle(row);
            if (vector) {
              embedded.set(row.id, vector);
              embeddedChunks += 1;
            }
          }
        }
      }

      for (const row of batch) {
        if (skippedRows.has(row.id)) continue;
        const existingVector = reusableExistingVector(row);
        const vector = existingVector ?? embedded.get(row.id);
        if (!vector) {
          throw new Error(`Missing embedding for ${row.path}`);
        }
        if (existingVector) {
          reusedChunks += 1;
        }
        rows.push({ ...row, vector });
      }
    }

    const db = await this.connect();
    const tableNames = await db.tableNames();
    const metadata = expectedMetadata(this.config, currentDimension);
    if (rows.length === 0) {
      if (tableNames.includes(TABLE_NAME)) {
        await db.dropTable(TABLE_NAME);
      }
    } else {
      const tableData = makeArrowTable(rows as unknown as Record<string, unknown>[], {
        vectorColumns: { vector: { type: new Float32() } },
      });
      await db.createTable(TABLE_NAME, tableData, {
        mode: tableNames.includes(TABLE_NAME) ? 'overwrite' : 'create',
      });
    }
    await this.writeMetadata(metadata);

    return {
      indexedChunks: rows.length,
      embeddedChunks,
      reusedChunks,
      indexedPages: new Set(rows.map((row) => row.path)).size,
      skippedChunks: skippedRows.size,
      skippedPages: [...skippedPages].sort(),
      warnings,
      metadata,
      reusedExistingIndex: canReuseExisting,
      rebuiltForConfigChange,
    };
  }

  async search(
    query: string,
    options?: { limit?: number; rerank?: boolean },
  ): Promise<SearchResult[]> {
    const table = await this.openTable();
    if (!table) {
      throw new Error('Vector index is missing.');
    }

    // Embedding models cap the input size (bge-m3: 8192 tokens). Ingest
    // context retrieval passes the whole source section as the query — with
    // maxSourceChars raised to 36000 that exceeds the cap (HTTP 413) and
    // silently degrades every large document to lexical fallback. Head+tail
    // keeps the title/intro and conclusion, which carry most of the signal.
    const [queryVector] = await this.embeddings.embed([boundEmbeddingQuery(query)]);
    await this.assertCompatibleMetadata(queryVector.length);
    const vectorRows = (await table
      .vectorSearch(queryVector)
      .limit(this.config.retrieval.vector.topK)
      .toArray()) as VectorRow[];

    const rerankCandidates = vectorRows.slice(0, this.config.retrieval.vector.rerankTopK);
    let rankedRows = vectorRows;
    if (
      options?.rerank !== false &&
      this.config.retrieval.vector.rerankEnabled !== false &&
      rerankCandidates.length > 0
    ) {
      try {
        const reranked = await this.reranker.rerank(
          query,
          rerankCandidates.map(rowText),
          this.config.retrieval.vector.rerankTopK,
        );
        const rerankedRows = reranked
          .map((result) => {
            const row = rerankCandidates[result.index];
            return row ? { ...row, rerankScore: result.score } : undefined;
          })
          .filter((row): row is VectorRow & { rerankScore: number } => Boolean(row));
        rankedRows = rerankedRows.length > 0 ? rerankedRows : vectorRows;
      } catch {
        rankedRows = vectorRows;
      }
    }

    const pages = await this.workspace.listWikiPages();
    const pageByPath = new Map(pages.map((page) => [page.relativePath, page]));
    const limit = options?.limit ?? this.config.retrieval.vector.maxResults;
    const selected: SearchResult[] = [];
    const seenPaths = new Set<string>();

    for (const row of rankedRows as Array<VectorRow & { rerankScore?: number }>) {
      if (seenPaths.has(row.path)) continue;
      const page = pageByPath.get(row.path);
      if (!page || page.type === 'answer') continue;
      seenPaths.add(row.path);
      selected.push({
        page,
        score: row.rerankScore ?? scoreFromDistance(row._distance),
        relatedPaths: [
          ...new Set([
            ...extractWikiLinks(row.content),
            ...extractSourceCitations(row.content),
          ]),
        ],
        chunk: {
          headingPath: JSON.parse(row.headingPath) as string[],
          content: row.content,
        },
      });
      if (selected.length >= limit) break;
    }

    return selected;
  }
}
