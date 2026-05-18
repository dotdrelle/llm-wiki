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
const EMBED_BATCH_SIZE = 16;
const EMBED_BATCH_MAX_CHARS = 24_000;
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
}

export interface VectorIndexBuildResult {
  indexedChunks: number;
  embeddedChunks: number;
  reusedChunks: number;
  indexedPages: number;
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

export class VectorIndexService {
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
    };
  }

  async buildIndex(): Promise<VectorIndexBuildResult> {
    const pages = await this.workspace.listWikiPages();
    const rowsWithoutVectors = this.buildRowsWithoutVectors(pages);
    const existingById = new Map<string, VectorRow>();
    const existing = await this.openTable();
    if (existing) {
      for (const row of (await existing.query().toArray()) as VectorRow[]) {
        existingById.set(row.id, row);
      }
    }

    const rows: VectorRow[] = [];
    let embeddedChunks = 0;
    let reusedChunks = 0;
    for (const batch of embeddingBatches(rowsWithoutVectors)) {
      const missing = batch.filter((row) => existingById.get(row.id)?.hash !== row.hash);
      const embedded = new Map<string, number[]>();
      if (missing.length > 0) {
        const vectors = await this.embeddings.embed(missing.map((row) => row.content));
        missing.forEach((row, index) => {
          embedded.set(row.id, vectors[index]);
        });
        embeddedChunks += missing.length;
      }

      for (const row of batch) {
        const existingRow = existingById.get(row.id);
        const vector =
          existingRow && existingRow.hash === row.hash
            ? normalizeVector(existingRow.vector)
            : embedded.get(row.id);
        if (!vector) {
          throw new Error(`Missing embedding for ${row.path}`);
        }
        if (existingRow && existingRow.hash === row.hash) {
          reusedChunks += 1;
        }
        rows.push({ ...row, vector });
      }
    }

    const db = await this.connect();
    if (rows.length === 0) {
      const names = await db.tableNames();
      if (names.includes(TABLE_NAME)) {
        await db.dropTable(TABLE_NAME);
      }
    } else {
      const tableData = makeArrowTable(rows as unknown as Record<string, unknown>[], {
        vectorColumns: { vector: { type: new Float32() } },
      });
      await db.createTable(TABLE_NAME, tableData, { mode: 'overwrite' });
    }

    return {
      indexedChunks: rows.length,
      embeddedChunks,
      reusedChunks,
      indexedPages: new Set(rows.map((row) => row.path)).size,
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

    const [queryVector] = await this.embeddings.embed([query]);
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
