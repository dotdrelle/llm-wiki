import path from 'node:path';
import { applyOkfFrontmatter } from '../okf/frontmatter.ts';
import {
  materializeLocatorTokens,
} from '../provenance/promptLocators.ts';
import { detectSourceLoss, extractBodyCitations } from '../provenance/derive.ts';
import { retargetLeafCitationsToSourceNote } from '../provenance/retarget.ts';
import { findUncitedFactualSections, stampSourcePageTitle, validateSourcePage } from '../provenance/sourcePage.ts';
import { validateAnchoredCitations } from '../provenance/validate.ts';
import { anchorCitations } from '../provenance/anchor.ts';
import { materializeLineAnchor } from '../provenance/locators.ts';
import {
  extractionCacheName,
  IngestCache,
} from '../ingest/extractionCache.ts';
import {
  newKnowledgeIdentity,
  normalizeProvenanceValue,
  readProvenance,
} from '../ingest/provenance.ts';
import { CONCEPT_PREFIX, validateConsolidation } from '../ingest/consolidationValidate.ts';
import {
  buildTaxoSectionUser,
  TAXO_SECTION_SYSTEM,
  taxoPlanForSource,
  taxoSheetPath,
  taxoTagPageContent,
  type TaxoRow,
} from '../ingest/taxoConsolidation.ts';
import { extractSectionSheets, parseTaxoSheet } from '../ingest/sectionSheets.ts';
import { closeSheetCandidates, exactSheetDuplicate, sheetContentHash, sheetInputHash, type SheetIndexEntry } from '../ingest/sheetDedup.ts';
import { harmonizeTags, loadTagCatalogue } from '../ingest/tagCatalogue.ts';
import { anchorTagFamilies, missingTagAssignments, parseTagFamilies, parseTagFamilyLabels, restrictTagFamilies, type TagFamily } from '../ingest/tagFamilies.ts';
import { z } from 'zod';
import { hashText } from '../utils/hash.ts';
import { resolveInside } from '../utils/path.ts';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { normalizeSourceBody, splitCitationAnchor } from '../utils/markdown.ts';
import { createSemaphore, mapWithConcurrency, type Semaphore } from '../utils/concurrency.ts';
import { pathExists, withFileLock } from '../utils/fs.ts';
import { regenerateWikiIndex } from './wikiIndexService.ts';
import type { TokenUsage } from './llmService.ts';
import type {
  AppConfig,
  IngestCommandOptions,
  IngestResult,
  IngestRetryInfo,
  IngestReviewOperation,
  SourceDocument,
  WikiOperation,
  WikiPage,
} from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RefreshService } from './refreshService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';
import {
  hashContent,
  readSourceRegistry,
  markMissingSourceRecords,
  recordSourceObservation,
  SOURCE_REGISTRY_FILENAME,
  sourceIdFromArchivePath,
  writeSourceRegistry,
  type SourceRegistryFile,
} from './sourceRegistry.ts';

export interface LegacySheetMigrationPreview {
  remove: string[];
  protected: string[];
}

// Bumped for the nature + named-entity tag policy: prior cached model output
// may satisfy the old format while lacking the new semantic axes.
const TAXO_PROMPT_VERSION = 4;
const TAXO_FAMILY_BATCH_THRESHOLD = 60;
const TAXO_FAMILY_BATCH_SIZE = 40;
const TAXO_FAMILY_BATCH_CONCURRENCY = 3;

function isUnfiledTagPage(page: WikiPage, family: unknown): boolean {
  const conceptFolder = page.relativePath.split('/')[2] ?? '';
  return normalizeProvenanceValue(conceptFolder) === 'unfiled'
    || (typeof family === 'string' && normalizeProvenanceValue(family) === 'unfiled');
}

function classifyIngestError(error: unknown): IngestRetryInfo['classification'] {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('Invalid structured JSON returned by the model') ||
    message.includes('Ambiguous or invalid wiki path returned by the model')
  ) {
    return 'validation';
  }
  if (
    /\b(429|rate limit|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|temporar)/i.test(
      message,
    ) ||
    message.includes('model returned malformed JSON') ||
    message.includes('malformed JSON')
  ) {
    return 'transient';
  }
  return 'unknown';
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    onRetry?: (
      info: IngestRetryInfo & { message: string; nextDelayMs: number },
    ) => Promise<void>;
  } = {},
): Promise<{ value: T; retry: IngestRetryInfo }> {
  const maxAttempts = Math.max(1, options.attempts ?? 2);
  const baseDelayMs = options.delayMs ?? 3000;
  let lastClassification: IngestRetryInfo['classification'];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return {
        value: await fn(),
        retry: {
          attempts: attempt,
          retries: attempt - 1,
          ...(lastClassification && { classification: lastClassification }),
        },
      };
    } catch (error) {
      lastClassification = classifyIngestError(error);
      if (lastClassification === 'validation' || attempt >= maxAttempts) {
        throw error;
      }
      const nextDelayMs = baseDelayMs * attempt;
      await options.onRetry?.({
        attempts: attempt,
        retries: attempt - 1,
        classification: lastClassification,
        message: error instanceof Error ? error.message : String(error),
        nextDelayMs,
      });
      await new Promise((r) => setTimeout(r, nextDelayMs));
    }
  }

  throw new Error('Retry exhausted without a captured error.');
}

// A bare `raw/ingested/…` or `raw/untracked/…` mention, not already inside a
// `[src: …]` bracket the first pass above already normalized. The lookbehind
// only needs to rule out the handful of characters `[src: ` actually uses, not
// arbitrary text, so a small bound is enough and keeps the regex engine-safe.
const BARE_RAW_PATH_PATTERN = /(?<!\[src:\s{0,4})\braw\/(?:ingested|untracked)\/[^\s\]"'`)]+/gi;

// OKF v0.2 provenance: every page a source produces records that source in
// its frontmatter `sources` list — the structured complement of the body's
// [src: ...] citations, accumulated additively across ingests (a source cited
// twice is listed once).

function stampSourceProvenance(
  operations: WikiOperation[],
  source: { path: string; usageCount?: number },
  sourcePage?: { path: string; title?: string },
): WikiOperation[] {
  return operations.map((operation) => {
    if (operation.type === 'delete') return operation;
    let content = applyOkfFrontmatter(operation.content ?? '', {
      sources: [{ path: source.path, usage_count: source.usageCount }],
    });
    // The source note's displayed title is its first H1 (tree, graph, index):
    // seed it from the document title so a plan that opened on `## Résumé`
    // cannot make every source note read "Résumé".
    if (sourcePage?.title && operation.path === sourcePage.path) {
      content = stampSourcePageTitle(content, sourcePage.title);
    }
    return { ...operation, content };
  });
}

// A citation already anchored to an archived source or a workspace page, and
// path-safe (no whitespace, quote or backslash). Such a path is stable and, on
// an update, may belong to ANOTHER source the model preserved from the page it
// merged — see enforceSourceCitationPath. A malformed `raw/ingested/…` the
// model copied by hand (spaces, accents) is NOT anchored and is normalized to
// the source being ingested.
//
// Tested against the PATH ALONE, never `path#Section`: a section anchor is a
// heading, so it carries spaces and apostrophes by nature, and testing the
// whole citation rejected every real anchored citation — destroying the anchor
// AND reattributing another source's claim to the one being ingested.
const ANCHORED_CITATION_PATH = /^(?:raw\/ingested|wiki|deliverables|templates|build-context)\/[^\s"'`)\\]*[^\s"'`)\\]$/i;

function enforceSourceCitationPath(
  operations: WikiOperation[],
  archiveCitationPath: string,
): {
  operations: WikiOperation[];
  rewrittenCitations: number;
  unreconciledCitations: number;
  wrappedBarePaths: number;
} {
  let rewrittenCitations = 0;
  let unreconciledCitations = 0;
  let wrappedBarePaths = 0;
  const operationsWithCitations = operations.map((operation) => {
    if (operation.content === undefined) return operation;
    let validCitationMarkers = 0;

    let content = operation.content.replace(
      /\[src:\s*([^\]]+)\]/gi,
      (match, citationPath: string) => {
        validCitationMarkers += 1;
        const cleanCitationPath = citationPath.trim();
        if (!cleanCitationPath) {
          unreconciledCitations += 1;
          return match;
        }
        // A citation already anchored to an archived source (`raw/ingested/…`)
        // or a workspace page is LEFT ALONE. Rewriting it to THIS source is
        // only correct for the pending/mangled form of the source being
        // ingested; on an update the model preserves the existing page's
        // citations, and rewriting those misattributed the facts they back to
        // the source being ingested (the "sources associated are often not the
        // right ones" defect). Always normalize the spacing, though:
        // BARE_RAW_PATH_PATTERN below only tolerates a bounded run of
        // whitespace after "[src:", so an untouched "[src:\n    path]" would
        // be treated as bare and wrapped a second time.
        // A path never ends on sentence punctuation; a model that wrote the
        // period inside the bracket would otherwise produce a dead citation
        // ("…/report.md.").
        const { path: citedPath, anchor } = splitCitationAnchor(cleanCitationPath);
        // The trailing-punctuation strip applies to the PATH only. With an
        // anchor the `#` already bounds the path, and a heading may legitimately
        // end on `?` or `!`.
        const anchoredPath = anchor === null ? citedPath.replace(/[.,;:!?]+$/, '') : citedPath;
        if (ANCHORED_CITATION_PATH.test(anchoredPath)) {
          return `[src: ${anchoredPath}${anchor ? `#${anchor}` : ''}]`;
        }
        // `raw/untracked/…` is the pending form of the source being ingested,
        // and anything else is a shortened/relative path the model copied by
        // hand: both normalize to the archive path. The section anchor rides
        // along — this branch already assumes the citation names THIS source,
        // and a section of it is still a section of it. A stale anchor costs
        // nothing: `sliceCitedSection` finds no such heading and the export
        // reads the file whole.
        if (citedPath !== archiveCitationPath) rewrittenCitations += 1;
        return `[src: ${archiveCitationPath}${anchor ? `#${anchor}` : ''}]`;
      },
    );
    const sourceMarkers = operation.content.match(/\[src:/gi)?.length ?? 0;
    unreconciledCitations += Math.max(0, sourceMarkers - validCitationMarkers);

    // The model sometimes names its source as bare text instead of a
    // citation — a header line ("Source: raw/ingested/…") rather than a
    // per-claim [src: …]. Invisible to the citation machinery above and to
    // every downstream link renderer, which only ever looks for the bracket.
    // A bare `raw/ingested/…` mentions an archived source (possibly another
    // one, preserved from the page being updated) and is wrapped as itself; a
    // bare `raw/untracked/…` is the pending form of THIS source and becomes
    // its archive path.
    content = content.replace(BARE_RAW_PATH_PATTERN, (bare: string) => {
      wrappedBarePaths += 1;
      // BARE_RAW_PATH_PATTERN stops at `]`, quotes and brackets but not at
      // sentence punctuation, so a header line ending on the path ("Source:
      // raw/ingested/report.md.") would wrap the period into the citation and
      // make it a dead link.
      const cleanBare = bare.replace(/[.,;:!?]+$/, '');
      if (/^raw\/ingested\//i.test(cleanBare)) return `[src: ${cleanBare}]`;
      return `[src: ${archiveCitationPath}]`;
    });

    return content === operation.content ? operation : { ...operation, content };
  });

  return {
    operations: operationsWithCitations,
    rewrittenCitations,
    unreconciledCitations,
    wrappedBarePaths,
  };
}

interface ProvenancePipelineOptions {
  operations: WikiOperation[];
  sourcePagePath: string;
  archiveCitationPath: string;
  rawBody: string;
  /** Reads a workspace-relative file from DISK, or null. */
  readDisk: (documentPath: string) => string | null;
  /** The page as it exists before this write (disk content), for the loss guard. */
  existingContentOf: (pagePath: string) => string | null;
}

interface ProvenanceAnchorIssue {
  path: string;
  citation: string;
  code: string;
  message: string;
}

interface ProvenanceSourcePageIssue {
  path: string;
  code: string;
  message: string;
}

interface ProvenancePipelineResult {
  /** Operations after token materialization, anchoring and path enforcement. */
  operations: WikiOperation[];
  /** Pages refused by the proof contracts, with their reasons. */
  refused: Map<string, string[]>;
  /** Concept updates that would drop a terminal proof of the previous body. */
  lost: Array<{ path: string; lost: string[] }>;
  sourcePageIssues: ProvenanceSourcePageIssue[];
  anchorIssues: ProvenanceAnchorIssue[];
  retargeted: number;
  anchored: number;
  unresolvedAnchors: string[];
  rewrittenCitations: number;
  unreconciledCitations: number;
  wrappedBarePaths: number;
}

/**
 * The provenance post-processing every writer runs on a source's operations:
 * token materialization, engine-side
 * anchoring, the two-level retarget, citation-path enforcement, the source-page
 * and anchored-citation contracts, the refusal of unresolvable proofs, and the
 * deterministic loss guard. It reads text only — no LLM, no log side effects;
 * the caller logs the returned diagnostics.
 */
function runProvenancePipeline(options: ProvenancePipelineOptions): ProvenancePipelineResult {
  const tokenSafeOperations = options.operations.map((operation) =>
    operation.type === 'delete' || typeof operation.content !== 'string'
      ? operation
      : {
          ...operation,
          content: materializeLocatorTokens(operation.content, {
            documentPath: options.archiveCitationPath,
            documentContent: options.rawBody,
          }).content,
        },
  );
  const {
    operations: pathSafeOperations,
    rewrittenCitations,
    unreconciledCitations,
    wrappedBarePaths,
  } = enforceSourceCitationPath(tokenSafeOperations, options.archiveCitationPath);
  // Pages this plan writes are not on disk yet: a leaf citing the source note
  // composed in the SAME batch must still resolve, so read the batch first,
  // then the archive body, then the workspace. Paths are canonicalized before
  // lookup so a malformed model path cannot turn a valid citation into a
  // false missing-document error.
  const batchDocuments = new Map<string, string>();
  for (const operation of pathSafeOperations) {
    if (operation.type !== 'delete' && typeof operation.content === 'string') {
      batchDocuments.set(operation.path, operation.content);
    }
  }
  const loadDocument = (documentPath: string): string | null => {
    const fromBatch = batchDocuments.get(documentPath);
    if (fromBatch != null) return fromBatch;
    if (documentPath === options.archiveCitationPath) return options.rawBody;
    return options.readDisk(documentPath);
  };
  let anchored = 0;
  const unresolvedAnchors: string[] = [];
  const anchoredOperations = pathSafeOperations.map((operation) => {
    if (operation.type === 'delete' || typeof operation.content !== 'string') return operation;
    const result = anchorCitations(operation.content, loadDocument);
    anchored += result.anchored;
    unresolvedAnchors.push(...result.unresolved);
    return { ...operation, content: result.content };
  });
  const sourceNoteContent = anchoredOperations.find(
    (operation) => operation.path === options.sourcePagePath && typeof operation.content === 'string',
  )?.content ?? null;
  const { operations: twoLevelOperations, retargeted } = retargetLeafCitationsToSourceNote(
    anchoredOperations,
    {
      sourcePagePath: options.sourcePagePath,
      archiveCitationPath: options.archiveCitationPath,
      sourceNoteContent,
      previousContentOf: options.readDisk,
      resolvePage: loadDocument,
    },
  );
  const citationSafeOperations = twoLevelOperations;

  const sourcePageIssues: ProvenanceSourcePageIssue[] = citationSafeOperations
    .filter((operation) => operation.type !== 'delete' && /^wiki\/(?:concepts\/|sources\/)/.test(operation.path))
    .flatMap((operation) => {
      const content = operation.content ?? '';
      if (operation.path.startsWith('wiki/concepts/')) {
        return findUncitedFactualSections(content).map((heading) => ({
          path: operation.path,
          code: 'uncited-section',
          message: `section "${heading}" has no anchored citation`,
        }));
      }
      // The engine adds `type` and the archive `sources` at write time, so
      // validate the page it WILL write, not the model's raw output.
      const candidate = applyOkfFrontmatter(content, {
        type: 'source',
        sources: [{ path: options.archiveCitationPath }],
      });
      return validateSourcePage(candidate).issues.map((issue) => ({
        path: operation.path,
        code: issue.code,
        message: issue.message,
      }));
    });

  const anchorIssues: ProvenanceAnchorIssue[] = citationSafeOperations
    .filter((operation) => operation.type !== 'delete' && /^wiki\/(concepts|sources)\//.test(operation.path))
    .flatMap((operation) => validateAnchoredCitations(operation.content ?? '', loadDocument)
      .map((issue) => ({ path: operation.path, ...issue })));

  const refused = new Map<string, string[]>();
  const refuse = (pagePath: string, reason: string): void => {
    refused.set(pagePath, [...(refused.get(pagePath) ?? []), reason]);
  };
  for (const issue of sourcePageIssues) {
    // Structural identity failures and factual sections without their own
    // evidence refuse the page. Citation address issues are handled below by
    // anchor validation and path enforcement.
    if (issue.code === 'raw-source' || issue.code === 'single-source'
      || issue.code === 'subject' || issue.code === 'uncited-section') {
      refuse(issue.path, `${issue.code}: ${issue.message}`);
    }
  }
  for (const issue of anchorIssues) {
    if (issue.code === 'missing' || issue.code === 'ambiguous') {
      refuse(issue.path, `${issue.code}: ${issue.message}`);
    }
  }
  // A page that cites a refused page can no longer resolve through it.
  for (let pass = 0; pass <= citationSafeOperations.length; pass += 1) {
    let grew = false;
    for (const operation of citationSafeOperations) {
      if (operation.type === 'delete' || refused.has(operation.path)) continue;
      const citesRefused = extractBodyCitations(operation.content ?? '')
        .find((citation) => refused.has(citation.path));
      if (citesRefused) {
        refuse(operation.path, `cites a refused page: ${citesRefused.path}`);
        grew = true;
      }
    }
    if (!grew) break;
  }

  // Deterministic loss guard (§3.3): an update must not silently drop a
  // terminal proof the previous body reached. The comparison is the citation
  // closure, never a model judgement.
  const lost: Array<{ path: string; lost: string[] }> = [];
  for (const operation of citationSafeOperations) {
    if (operation.type !== 'update' || typeof operation.content !== 'string') continue;
    if (!/^wiki\/concepts\//.test(operation.path)) continue;
    const previous = options.existingContentOf(operation.path);
    if (!previous) continue;
    const loss = detectSourceLoss(previous, operation.content, { resolvePage: loadDocument });
    if (loss.length === 0) continue;
    lost.push({
      path: operation.path,
      lost: loss.map((fragment) => `${fragment.path}#${fragment.anchor ?? ''}`),
    });
  }

  return {
    operations: citationSafeOperations,
    refused,
    lost,
    sourcePageIssues,
    anchorIssues,
    retargeted,
    anchored,
    unresolvedAnchors,
    rewrittenCitations,
    unreconciledCitations,
    wrappedBarePaths,
  };
}

function diffPreview(before: string, after: string): IngestReviewOperation['diff'] {
  if (before === after) {
    return {
      changed: false,
      addedLines: 0,
      removedLines: 0,
      preview: [],
    };
  }

  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const beforeLineSet = new Set(beforeLines);
  const afterLineSet = new Set(afterLines);
  const preview: string[] = [];
  const maxPreviewLines = 12;

  for (const line of beforeLines) {
    if (!afterLineSet.has(line)) {
      preview.push(`- ${line}`);
    }
    if (preview.length >= maxPreviewLines) break;
  }
  if (preview.length < maxPreviewLines) {
    for (const line of afterLines) {
      if (!beforeLineSet.has(line)) {
        preview.push(`+ ${line}`);
      }
      if (preview.length >= maxPreviewLines) break;
    }
  }

  return {
    changed: true,
    addedLines: Math.max(0, afterLines.length - beforeLines.length),
    removedLines: Math.max(0, beforeLines.length - afterLines.length),
    preview,
  };
}

/**
 * Concept leaves a rebuild no longer produces.
 *
 * A `--from-ingested` run re-files archived sources: when the classification
 * changes (another concept or subject slug), the rebuild writes the new leaf
 * and leaves the old one on disk — the same idea then appears twice, and the
 * stale copy is the wrong one. The registry is the only place that knows what
 * the previous run produced; the model has no memory of it, so the engine
 * reconciles. Restricted to concept leaves: a source note, the index or a
 * hand-written page is never pruned. A page still produced by ANY source
 * (rebuilt or not) is kept.
 */
export function staleRebuiltLeaves(
  previousRegistry: SourceRegistryFile | null,
  currentRegistry: SourceRegistryFile,
  rebuiltArchivePaths: string[],
): string[] {
  if (!previousRegistry) return [];
  const rebuilt = new Set(rebuiltArchivePaths);
  if (rebuilt.size === 0) return [];
  const oldProduced = new Set<string>();
  for (const record of previousRegistry.sources) {
    if (!rebuilt.has(record.archivePath)) continue;
    for (const page of record.producedPages) oldProduced.add(page);
  }
  const stillProduced = new Set<string>();
  for (const record of currentRegistry.sources) {
    for (const page of record.producedPages) stillProduced.add(page);
  }
  return [...oldProduced]
    .filter((page) => page.startsWith(CONCEPT_PREFIX) && !stillProduced.has(page))
    .sort();
}


function buildReviewOperations({
  operations,
  existingPages,
  source,
  archivePath,
  rejectedPaths,
  applied,
}: {
  operations: WikiOperation[];
  existingPages: Map<string, WikiPage>;
  source: string;
  archivePath: string;
  rejectedPaths: Set<string>;
  applied: boolean;
}): IngestReviewOperation[] {
  return operations.map((operation) => {
    const before = existingPages.get(operation.path)?.content ?? '';
    const beforeExists = existingPages.has(operation.path);
    const after = operation.type === 'delete' ? '' : (operation.content ?? '');
    const afterExists = operation.type !== 'delete';
    const rejected = rejectedPaths.has(operation.path);

    return {
      type: operation.type,
      path: operation.path,
      source,
      archivePath,
      status: rejected ? 'rejected' : applied ? 'applied' : 'pending',
      beforeExists,
      afterExists,
      ...(beforeExists && { beforeHash: hashText(before) }),
      ...(afterExists && { afterHash: hashText(after) }),
      diff: diffPreview(before, after),
    };
  });
}

/** Progress hooks surfaced on the CLI: phase labels and TAXO warnings. */
type IngestProgressHooks = {
  onPhase?: (phase: string, detail?: Record<string, unknown>) => void;
  onWarning?: (event: string, detail?: Record<string, unknown>) => void;
};

export class IngestService {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly retrieval: RetrievalService;
  private readonly refresh: RefreshService;
  private readonly logger: TraceLogger;

  private readonly injectedCache?: IngestCache;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
    refresh: RefreshService,
    logger: TraceLogger,
    /*
     Resume cache, injectable.

     Injected rather than hard-constructed so that a caller without a disk — a
     unit test, an ephemeral dry-run — can disable it. The default remains the
     product behaviour: resume without repaying.
    */
    cache?: IngestCache,
  ) {
    this.injectedCache = cache;
    this.config = config;
    this.workspace = workspace;
    this.llm = llm;
    this.retrieval = retrieval;
    this.refresh = refresh;
    this.logger = logger;
  }

  async previewLegacySheetMigration(): Promise<LegacySheetMigrationPreview> {
    const remove: string[] = [];
    const protectedPages: string[] = [];
    for (const page of await this.retrieval.warmCache()) {
      const isConcept = page.relativePath.startsWith(CONCEPT_PREFIX);
      const isSource = page.relativePath.startsWith('wiki/sources/')
        && !page.relativePath.slice('wiki/sources/'.length).includes('/');
      if (!isConcept && !isSource) continue;
      const metadata = matter(page.content).data;
      const generatedBy = metadata?.generated && typeof metadata.generated === 'object'
        ? metadata.generated.by
        : undefined;
      const legacySourceNote = isSource && metadata?.type === 'source'
        && (generatedBy === 'llm-wiki' || /^## Résumé\s*$/m.test(page.content));
      const legacyConcept = isConcept && metadata?.type === 'concept'
        && (generatedBy === 'llm-wiki' || generatedBy === 'taxo-pipeline')
        && !metadata?.family;
      if (!legacySourceNote && !legacyConcept) continue;
      if (metadata?.status === 'stable' || metadata?.verified === true) {
        protectedPages.push(page.relativePath);
      } else {
        remove.push(page.relativePath);
      }
    }
    return { remove: remove.sort(), protected: protectedPages.sort() };
  }

  async applyLegacySheetMigration(): Promise<string[]> {
    const preview = await this.previewLegacySheetMigration();
    const operations: WikiOperation[] = [];
    const pages = new Map((await this.retrieval.warmCache()).map((page) => [page.relativePath, page]));
    for (const pagePath of preview.remove) {
      const page = pages.get(pagePath);
      if (!page) continue;
      const metadata = matter(page.content).data;
      if (metadata?.status === 'stable' || metadata?.verified === true) continue;
      operations.push({ type: 'delete', path: pagePath });
    }
    if (operations.length > 0) {
      await this.workspace.applyNormalizedWikiOperations(operations);
      this.retrieval.invalidateCache();
      await this.regenerateIndex('taxo-migration');
    }
    return operations.map((operation) => operation.path);
  }

  async ingest(
    inputs: string[],
    options?: IngestCommandOptions & {
      onSourceStart?: (sourcePath: string, index: number, total: number) => void;
      onSourceLlm?: (
        sourcePath: string,
        index: number,
        total: number,
        progress?: { sectionIndex: number; sectionTotal: number },
      ) => void;
      onSourceUsage?: (
        sourcePath: string,
        index: number,
        total: number,
        usage: TokenUsage,
        progress?: { sectionIndex: number; sectionTotal: number },
      ) => void;
    } & IngestProgressHooks,
  ): Promise<IngestResult[]> {
    const runStartedAt = Date.now();
    await this.workspace.ensureInitialized();
    await this.logger.info('ingest:run-start', {
      inputCount: inputs.length,
      dryRun: Boolean(options?.dryRun),
      refreshEnabled: options?.refresh === true,
    });

    /*
     Folder names are storage labels, not concept identities. The current
     identities and labels are read from pages already on disk, and each apply
     reconciles new labels against that live state before writing.
    */
    const selectionStartedAt = Date.now();
    const sourcePaths = options?.fromIngested
      ? await this.workspace.resolveIngestedSourceInputs(inputs)
      : await this.workspace.resolveSourceInputs(inputs);
    await this.logger.info('ingest:source-selection', {
      resolvedCount: sourcePaths.length,
      durationMs: Date.now() - selectionStartedAt,
    });

    const results: IngestResult[] = [];
    const rejectedPaths = new Set(options?.reject ?? []);
    /*
     Resume cache, shared by all sources in the batch.

     It is never presented as an approvable plan: only the final consolidated
     plan goes through review. Its role is that an interruption does not repay
     calls whose answer was valid.
    */
    const cache = this.injectedCache
      ?? new IngestCache(this.workspace.paths.rootDir, options?.dryRun !== true);
    if (!options?.dryRun) await cache.collect().catch(() => 0);

    /*
     Previous run's produced pages, read once for the whole batch.

     On an unchanged body the consolidation used to rename the same products
     from run to run. The stable reference against which a re-ingest must
     re-anchor is the source registry — what this source ACTUALLY produced last
     time — not the model's memory. Read it before the first source is observed,
     so every source sees the state of the PREVIOUS run.
     */
    const previousRegistry = await this.previousRegistry();

    const taxoEntries = await this.filterSourcesNeedingTaxoPrePass(sourcePaths, previousRegistry, options);
    const taxoRelativeByPath = new Map(taxoEntries.map((entry) => [entry.sourcePath, entry.relativePath]));
    const sheetIndex = await this.loadSheetIndex();
    /*
     Lookahead: extract the next sources while the current one is being
     committed, so writes stay progressive AND the model keeps several calls
     in flight. The shared gate is the single global budget; a source's
     sections no longer each open their own limit.
    */
    const llmGate = createSemaphore(this.config.limits.maxInFlightRequests ?? 3);
    const lookahead = Math.max(1, this.config.limits.maxInFlightRequests ?? 3);
    const extractionPromises = new Map<string, ReturnType<IngestService['extractTaxoSheets']>>();
    let scheduleCursor = 0;
    const scheduleExtractions = (): void => {
      while (extractionPromises.size < lookahead && scheduleCursor < sourcePaths.length) {
        const candidate = sourcePaths[scheduleCursor];
        scheduleCursor += 1;
        if (!taxoRelativeByPath.has(candidate)) continue;
        extractionPromises.set(candidate, this.extractTaxoSheets(
          [candidate],
          cache,
          options,
          sheetIndex,
          scheduleCursor - 1,
          sourcePaths.length,
          llmGate,
        ));
      }
    };
    scheduleExtractions();

    for (let i = 0; i < sourcePaths.length; i++) {
      const sourcePath = sourcePaths[i];
      let sourceLabel = sourcePath;
      let sourceRetry: IngestRetryInfo | undefined;
      options?.onSourceStart?.(sourcePath, i, sourcePaths.length);
      const sourceStartedAt = Date.now();
      await this.logger.info('ingest:source-start', {
        sourcePath,
      });

      try {
        const readStartedAt = Date.now();
        const source = await this.workspace.readSourceDocument(sourcePath, {
          ingested: options?.fromIngested === true,
        });
        sourceLabel = source.relativePath;
        await this.logger.info('ingest:source', {
          source: source.relativePath,
          title: source.title,
          sizeBytes: source.rawContent.length,
          durationMs: Date.now() - readStartedAt,
          ...(source.detectedEncoding && { detectedEncoding: source.detectedEncoding }),
        });
        if (source.detectedEncoding) {
          await this.logger.warn('ingest:encoding-fallback', {
            source: source.relativePath,
            encoding: source.detectedEncoding,
            advice:
              'Source file is not valid UTF-8. Re-export from Confluence with UTF-8 encoding to avoid potential character corruption.',
          });
        }

        // A rebuild from raw/ingested always re-consolidates: the point of
        // the command is to regenerate the concept pages, so the
        // unchanged-since-last-ingest skip must not fire on the very archive
        // the comparison would read.
        // TAXO must revisit an unchanged archive: the fiche input hash also
        // includes the prompt/model signature, so a prompt upgrade must
        // regenerate the fiche instead of being hidden by the archive hash
        // shortcut. The section cache still makes an unchanged TAXO pass
        // cheap and idempotent at the write layer.
        if (!options?.force && !options?.fromIngested
          && !taxoRelativeByPath.has(sourcePath)) {
          const unchanged = await this.workspace.isSourceUnchangedSinceIngest(source);
          if (unchanged) {
            const vanished = await this.findVanishedProducedPages(source, previousRegistry);
            if (vanished.length === 0) {
              await this.logger.info('ingest:source-skip', {
                source: source.relativePath,
                reason: 'unchanged since last ingest',
              });
              results.push({
                source: source.relativePath,
                archivePath: source.archiveCitationPath,
                plan: { summary: 'unchanged since last ingest', operations: [] },
                skipped: true,
              });
              if (!options?.dryRun) {
                await this.workspace.archiveSource(source);
                await this.logger.info('ingest:archive', {
                  source: source.relativePath,
                  archivePath: source.archiveCitationPath,
                  durationMs: Date.now() - sourceStartedAt,
                });
                // An unchanged source remains a SEEN source: without this line,
                // it would flip to `missing` on the first inventory even though
                // it has just been presented.
                await this.observeSource(source, null);
              }
              await this.logger.info('ingest:source-done', {
                source: source.relativePath,
                durationMs: Date.now() - sourceStartedAt,
                status: 'skipped',
              });
              continue;
            }
            // The archive is unchanged but the pages it produced are gone: the
            // skip above would leave the wiki empty while every step reported
            // success. Fall through and re-ingest, which restores them.
            await this.logger.warn('ingest:source-reingest', {
              source: source.relativePath,
              reason: 'produced pages vanished',
              vanished,
            });
          }
        }

        const rawBody = normalizeSourceBody(source.body ?? '');
        const sourcePagePath = path.posix.join('wiki', 'sources', `${source.slug}.md`);
        // The extraction of this source was scheduled ahead (lookahead): take
        // it, free its slot for the next source, and commit now. Pages are
        // written source by source instead of after a global extraction pass.
        const extractionPromise = extractionPromises.get(sourcePath);
        if (extractionPromise) extractionPromises.delete(sourcePath);
        scheduleExtractions();
        const extraction = extractionPromise
          ? await extractionPromise
          : {
              rowsBySource: new Map<string, TaxoRow[]>(),
              duplicatePagesBySource: new Map<string, string[]>(),
              sectionCounts: new Map<string, number>(),
              retryBySource: new Map<string, IngestRetryInfo>(),
              failedSources: new Map<string, string>(),
            };
        const extractionError = extraction.failedSources.get(source.relativePath);
        if (extractionError) {
          throw new Error(`TAXO extraction failed for this source: ${extractionError}`);
        }
        const consolidated = taxoPlanForSource(
          extraction.rowsBySource.get(source.relativePath) ?? [],
          new Date().toISOString(),
        );
        const duplicatePageReferences = extraction.duplicatePagesBySource.get(source.relativePath) ?? [];
        const knownPaths = new Set((await this.retrieval.warmCache()).map((page) => page.relativePath));
        const sectionCount = extraction.sectionCounts.get(source.relativePath) ?? 0;
        sourceRetry = extraction.retryBySource.get(source.relativePath);

        /*
         Normalize FIRST, validate second.

         `normalizeWikiOperations` canonicalizes the paths the model wrote —
         accents, spaces, case. Validating before it would amount to comparing
         the expected source note to a path that the engine is about to correct,
         and rejecting a perfectly applicable plan.
        */
        const normalizedOperations = await this.workspace.normalizeWikiOperations(
          consolidated.operations,
        );
        {
          const previousRecord = previousRegistry?.sources.find(
            (record) => record.sourceId === sourceIdFromArchivePath(source.archiveCitationPath),
          );
          const ownedByOtherSources = new Set((previousRegistry?.sources ?? [])
            .filter((record) => record.sourceId !== previousRecord?.sourceId)
            .flatMap((record) => record.producedPages));
          const nextPaths = new Set(normalizedOperations
            .filter((operation) => operation.type !== 'delete')
            .map((operation) => operation.path));
          const candidates = new Set([
            ...(previousRecord?.producedPages ?? []),
            sourcePagePath,
          ].filter((page) => page.startsWith('wiki/sources/') || page.startsWith(CONCEPT_PREFIX)));
          const existing = new Map(
            (await this.retrieval.warmCache()).map((page) => [page.relativePath, page]),
          );
          for (const pagePath of candidates) {
            if (nextPaths.has(pagePath) || ownedByOtherSources.has(pagePath)) continue;
            const page = existing.get(pagePath);
            if (!page) continue;
            const metadata = matter(page.content).data;
            if (metadata?.status === 'stable' || metadata?.verified === true) {
              await this.logger.info('ingest:sheet-prune-skipped', {
                source: source.relativePath,
                path: pagePath,
                reason: 'protected page',
              });
              continue;
            }
            // Prior ingest ownership makes old source notes and generated
            // concept leaves migration candidates. The canonical flat source
            // page is included explicitly for pre-registry TAXO workspaces.
            if (pagePath === sourcePagePath
              && !/^\s*by:\s*taxo-pipeline\s*$/m.test(page.content)
              && !previousRecord?.producedPages.includes(pagePath)) continue;
            normalizedOperations.push({ type: 'delete', path: pagePath });
            await this.logger.info('ingest:sheet-pruned', {
              source: source.relativePath,
              path: pagePath,
            });
          }
        }
        // `pages[].path` designates the same operations, but lived until now
        // before the canonicalization of the paths. A model proposing an accent
        // or a space therefore received a normalized operation and lost its
        // provenance at join time. The positional correspondence is stable:
        // normalizeWikiOperations preserves order and cardinality.
        const normalizedPathByOriginal = new Map<string, string>();
        consolidated.operations.forEach((operation, index) => {
          const normalized = normalizedOperations[index];
          if (normalized) normalizedPathByOriginal.set(operation.path, normalized.path);
        });
        const normalizedPages = (consolidated.pages ?? []).map((page) => ({
          ...page,
          path: normalizedPathByOriginal.get(page.path) ?? page.path,
        }));
        const effectiveRejectedPaths = rejectedPaths;
        const reconciledPages = normalizedPages;
        const normalizedSplits: [] = [];
        // The TAXO path passes through the full provenance pipeline:
        // materialization, anchoring, two-level retarget, path enforcement,
        // source-page/anchor contracts, refusal and the loss guard.
        const existingPages = new Map(
          (await this.retrieval.warmCache()).map((page) => [page.relativePath, page]),
        );
        const readDisk = (documentPath: string): string | null => {
          try {
            const absolute = resolveInside(this.workspace.paths.rootDir, documentPath);
            return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
          } catch {
            return null;
          }
        };
        const identityStampedOperations = normalizedOperations.map((operation) => (
          operation.path === sourcePagePath && operation.type !== 'delete' && source.title
            ? { ...operation, content: stampSourcePageTitle(operation.content ?? '', source.title) }
            : operation
        ));
        const provenance = runProvenancePipeline({
          operations: identityStampedOperations,
          sourcePagePath,
          archiveCitationPath: source.archiveCitationPath,
          rawBody,
          readDisk,
          existingContentOf: (pagePath) => existingPages.get(pagePath)?.content ?? null,
        });
        const citationSafeOperations = provenance.operations;
        if (provenance.anchored > 0 || provenance.unresolvedAnchors.length > 0) {
          await this.logger.info('ingest:anchoring', {
            source: source.relativePath,
            anchored: provenance.anchored,
            unresolved: provenance.unresolvedAnchors.slice(0, 20),
            unresolvedTotal: provenance.unresolvedAnchors.length,
          });
        }
        if (provenance.retargeted > 0) {
          await this.logger.info('ingest:two-level-citations', {
            source: source.relativePath,
            sourceNote: sourcePagePath,
            retargeted: provenance.retargeted,
          });
        }
        await this.logger.info('ingest:normalize', {
          source: source.relativePath,
          operations: citationSafeOperations.length,
          rewrittenCitations: provenance.rewrittenCitations,
          unreconciledCitations: provenance.unreconciledCitations,
          wrappedBarePaths: provenance.wrappedBarePaths,
        });
        if (provenance.rewrittenCitations > 0) {
          await this.logger.info('ingest:citation-path-rewrite', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            rewrittenCitations: provenance.rewrittenCitations,
          });
        }
        if (provenance.sourcePageIssues.length > 0) {
          await this.logger.warn('ingest:source-page-contract', {
            source: source.relativePath,
            issues: provenance.sourcePageIssues,
          });
        }
        if (provenance.anchorIssues.length > 0) {
          await this.logger.warn('ingest:provenance-anchors', {
            source: source.relativePath,
            issues: provenance.anchorIssues.slice(0, 20),
            total: provenance.anchorIssues.length,
          });
        }
        if (provenance.refused.size > 0) {
          await this.logger.warn('ingest:provenance-refused', {
            source: source.relativePath,
            pages: [...provenance.refused.entries()].map(([path, reasons]) => ({ path, reasons })),
          });
          for (const path of provenance.refused.keys()) effectiveRejectedPaths.add(path);
        }
        if (provenance.unreconciledCitations > 0) {
          await this.logger.warn('ingest:citation-unreconciled', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            unreconciledCitations: provenance.unreconciledCitations,
          });
        }
        if (provenance.wrappedBarePaths > 0) {
          // The model named its source as bare text instead of a citation —
          // invisible to the link renderer until wrapped. Not an error (the
          // content is still correct and now linkable), but worth surfacing:
          // a model that keeps doing this despite the prompt instruction is
          // a signal the instruction itself may need to be strengthened.
          await this.logger.info('ingest:citation-bare-path-wrapped', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            wrappedBarePaths: provenance.wrappedBarePaths,
          });
        }

        const validation = validateConsolidation(
          { ...consolidated, operations: citationSafeOperations, pages: reconciledPages },
          {
            sourcePagePath,
            citationPath: source.archiveCitationPath,
            existingPaths: knownPaths,
            existingPages: new Map([...existingPages].map(([pagePath, page]) => [pagePath, page.content])),
            precomputedSplits: normalizedSplits,
            taxo: true,
          },
        );
        await this.logger.info('ingest:consolidate', {
          source: source.relativePath,
          operations: validation.operations.length,
          errors: validation.errors.length,
          warnings: validation.warnings.length,
          derivedAxes: validation.derivedAxes,
          summary: consolidated.summary,
        });
        for (const warning of validation.warnings) {
          await this.logger.warn('ingest:consolidate-warning', {
            source: source.relativePath,
            path: warning.path,
            reason: warning.reason,
          });
        }
        if (validation.errors.length) {
          /*
           A structurally invalid plan is not applied halfway.

           Rejecting it whole leaves the source pending and the extraction cache
           intact: a resume will only repay the consolidation.
          */
          throw new Error(
            `Consolidated plan rejected: ${validation.errors
              .map((issue) => `${issue.path}: ${issue.reason}`)
              .join('; ')}`,
          );
        }

        if (options?.dryRun) {
          await this.logger.info('ingest:dry-run', { source: source.relativePath });
        }


        // A single plan, the consolidation's. The previous `flatMap`
        // concatenated the decisions of each fragment without confronting them.
        const allOperations = validation.operations;
        const lastSummary = consolidated.summary;

        const review = buildReviewOperations({
          operations: allOperations,
          existingPages,
          source: source.relativePath,
          archivePath: source.archiveCitationPath,
          rejectedPaths: effectiveRejectedPaths,
          applied: !options?.dryRun,
        });
        let applyOperations = allOperations.filter(
          (operation) => !effectiveRejectedPaths.has(operation.path),
        );
        const rejectedCount = allOperations.length - applyOperations.length;
        if (rejectedCount > 0) {
          await this.logger.info('ingest:review-reject', {
            source: source.relativePath,
            rejected: rejectedCount,
            paths: allOperations
              .filter((operation) => effectiveRejectedPaths.has(operation.path))
              .map((operation) => operation.path),
          });
        }
        await this.logger.info('ingest:review', {
          source: source.relativePath,
          operations: allOperations.length,
          rejected: rejectedCount,
          dryRun: Boolean(options?.dryRun),
        });

        // Deterministic loss guard (§3.3): an update must not silently drop a
        // terminal proof the previous body reached. The pipeline computed the
        // loss; here the offending operations are dropped and announced while
        // the rest of the ingest continues.
        if (provenance.lost.length > 0) {
          await this.logger.warn('ingest:provenance-loss', {
            source: source.relativePath,
            pages: provenance.lost,
          });
          const lostPaths = new Set(provenance.lost.map((entry) => entry.path));
          applyOperations = applyOperations.filter((operation) => !lostPaths.has(operation.path));
        }

        const allOperationsRejected =
          allOperations.length > 0 && applyOperations.length === 0;
        if (!options?.dryRun && allOperationsRejected) {
          await this.logger.info('ingest:apply-skip', {
            source: source.relativePath,
            reason: 'all operations rejected',
          });
        }

        if (!options?.dryRun && !allOperationsRejected) {
          const operationCounts = applyOperations.reduce(
            (counts, operation) => {
              counts[operation.type] += 1;
              return counts;
            },
            { create: 0, update: 0, delete: 0 },
          );
          const applyStartedAt = Date.now();
          // OKF v0.2 provenance: every leaf this source produces records its
          // raw source in the frontmatter `sources` list — the structured
          // complement of the body's [src: ...] citations, accumulated
          // additively across ingests (a source cited twice is listed once).
          // The usage_count is the registry's first reader: how many pages
          // this source has produced so far (the previous run's count — this
          // run's pages are appended to the registry AFTER the apply).
          const registryRecord = previousRegistry?.sources?.find(
            (record) => record.sourceId === sourceIdFromArchivePath(source.archiveCitationPath),
          );
          const usageCount = registryRecord?.producedPages?.length ?? 0;
          const stampedOperations = stampSourceProvenance(
            applyOperations,
            {
              path: source.archiveCitationPath,
              usageCount,
            },
            { path: sourcePagePath, title: source.title },
          );
          await this.workspace.applyNormalizedWikiOperations(stampedOperations);
          {
            for (const operation of stampedOperations) {
              if (operation.type === 'delete') continue;
              await this.logger.info('ingest:output', {
                path: operation.path,
                source: source.relativePath,
              });
            }
          }
          this.retrieval.invalidateCache();
          await this.logger.info('ingest:apply', {
            source: source.relativePath,
            durationMs: Date.now() - applyStartedAt,
            create: operationCounts.create,
            update: operationCounts.update,
            delete: operationCounts.delete,
            atomic: true,
            sections: sectionCount,
          });

          const archiveStartedAt = Date.now();
          if (!options?.fromIngested) {
            await this.workspace.archiveSource(source);
          }
          await this.logger.info('ingest:archive', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            durationMs: Date.now() - archiveStartedAt,
            ...(options?.fromIngested ? { note: 'already archived (rebuild)' } : {}),
          });

          await this.workspace.appendLog(
            'ingest',
            `${source.relativePath} -> ${source.archiveCitationPath} (${lastSummary})`,
          );
          await this.observeSource(source, [
            ...applyOperations,
            ...duplicatePageReferences.map((referencedPath) => ({ type: 'update' as const, path: referencedPath })),
          ]);
          /*
           The visible commit unit is a source applied successfully.

           Publishing once at the end of the command would leave a long
           multi-source ingest silent from start to finish; publishing on every
           written file would make one render per page. The coherent source is
           the grain that matches what a reader perceives as "something
           happened", and Serve coalesces nearby markers.
          */
          // The tags this source produced get their navigation page now, so
          // the concept tree grows with the run. The end-of-run family pass
          // remains the authority (grouping, moves, purge).
          const sourceTags = [...new Set((extraction.rowsBySource.get(source.relativePath) ?? [])
            .flatMap((row) => row.tags ?? []))];
          if (sourceTags.length > 0) {
            await this.refreshIncrementalTagPages(sourceTags);
          }
          // Index first: wiki/index.md is itself part of the knowledge corpus
          // the fingerprint below covers, so publishing before regenerating it
          // would freeze a corpus the index rewrite immediately invalidates
          // again — the same stale-marker trap this marker exists to catch.
          await this.regenerateIndex(source.relativePath);
          await this.publishGraphRevision(source.relativePath);
        }

        results.push({
          source: source.relativePath,
          archivePath: source.archiveCitationPath,
          plan: { summary: lastSummary, operations: applyOperations },
          review,
          ...(sourceRetry && { retry: sourceRetry }),
        });

        await this.logger.info('ingest:source-done', {
          source: source.relativePath,
          durationMs: Date.now() - sourceStartedAt,
          status: 'success',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.logger.error('ingest:source-failed', {
          sourcePath,
          durationMs: Date.now() - sourceStartedAt,
          message,
        });
        results.push({
          source: sourceLabel,
          failed: true,
          error: message,
        });
        // Free the lookahead slot this source may still hold: a failure before
        // its extraction was consumed must not stall the scheduling of the
        // next sources.
        if (extractionPromises.delete(sourcePath)) scheduleExtractions();
      }
    }

    const successfulResults = results.filter((result) => !result.failed);
    const failedResults = results.filter((result) => result.failed);
    const shouldRefresh = options?.refresh === true || this.config.build.refreshOnIngest;
    // A rebuild that re-files a source under another concept/subject leaves the
    // previous leaf on disk (the registry only REPORTS it). Reconcile here: with
    // no source-level failure, delete the concept leaves this rebuild no longer
    // produces and that no other source claims. A partial run must not read as
    // "these pages are gone", so it prunes nothing and says so.
    if (options?.fromIngested && !options?.dryRun) {
      const registryPath = this.workspace.paths.internalDir
        ? path.join(this.workspace.paths.internalDir, SOURCE_REGISTRY_FILENAME)
        : null;
      try {
        if (failedResults.length > 0) {
          await this.logger.warn('ingest:rebuild-prune-skipped', {
            reason: 'partial failure in the rebuild',
            failed: failedResults.length,
          });
        } else if (registryPath) {
          // The registry keys on the ARCHIVE path, so the rebuilt set must
          // too. Feeding it `result.source` (the on-disk relative path)
          // matched no record at all for any file whose name is not already
          // slug-identical, and the prune logged a clean `count: 0`.
          const rebuiltArchives = results
            .filter((result) => !result.skipped && !result.failed)
            .map((result) => result.archivePath)
            .filter((archivePath): archivePath is string => Boolean(archivePath));
          const currentRegistry = await readSourceRegistry(registryPath);
          const stale: string[] = [];
          for (const page of staleRebuiltLeaves(previousRegistry, currentRegistry, rebuiltArchives)) {
            const absolute = resolveInside(this.workspace.paths.rootDir, page);
            if (!(await pathExists(absolute))) continue;
            try {
              const metadata = matter(readFileSync(absolute, 'utf8')).data;
              if (metadata?.status === 'stable' || metadata?.verified === true) {
                await this.logger.info('ingest:rebuild-prune-skipped', { path: page, reason: 'protected page' });
                continue;
              }
            } catch {
              // A malformed page is still stale output if the registry proves
              // this rebuild no longer produces it; lint reports its format.
            }
            stale.push(page);
          }
          if (stale.length > 0) {
            await this.workspace.applyNormalizedWikiOperations(
              stale.map((page) => ({ type: 'delete', path: page })),
            );
            this.retrieval.invalidateCache();
          }
          await this.logger.info('ingest:rebuild-prune', { count: stale.length, removed: stale });
        }
      } catch (error) {
        await this.logger.warn('ingest:rebuild-prune-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!options?.dryRun && successfulResults.length > 0 && shouldRefresh) {
      const refreshStartedAt = Date.now();
      try {
        const refreshResults = await this.refresh.refresh();
        await this.logger.info('ingest:refresh', {
          durationMs: Date.now() - refreshStartedAt,
          changed: refreshResults.filter((result) => result.changed).length,
          skipped: refreshResults.filter((result) => result.skipped).length,
          unchanged: refreshResults.filter((result) => !result.changed && !result.skipped)
            .length,
        });
        if (this.logger.debugEnabled) {
          await this.logger.debug('ingest:refresh-results', {
            results: refreshResults,
          });
        }
      } catch (error) {
        await this.logger.error('ingest:refresh-failed', {
          durationMs: Date.now() - refreshStartedAt,
          message: error instanceof Error ? error.message : String(error),
          advice: 'Rerun `wiki refresh` later to rebuild stale deliverables.',
        });
      }
    } else {
      await this.logger.info('ingest:refresh', {
        skipped: true,
      });
    }

    const completeArchiveRebuild = Boolean(options?.fromIngested && inputs.length === 0
      && sourcePaths.length > 0
      && !options.dryRun && results.length === sourcePaths.length
      && results.every((result) => !result.failed));
    if (completeArchiveRebuild) {
      const activeSourceIds = new Set<string>();
      for (const sourcePath of sourcePaths) {
        const source = await this.workspace.readSourceDocument(sourcePath, { ingested: true });
        activeSourceIds.add(sourceIdFromArchivePath(source.archiveCitationPath));
      }
      await this.pruneMissingSourcePages(activeSourceIds);
    }

    if (!options?.dryRun
      && (successfulResults.length > 0 || completeArchiveRebuild)) {
      await this.regenerateTaxoTagPages(options);
    }

    await this.logger.info('ingest:run-done', {
      sourceCount: results.length,
      failed: failedResults.length,
      durationMs: Date.now() - runStartedAt,
      status: failedResults.length > 0 ? 'partial_failure' : 'success',
    });

    return results;
  }

  /**
   * Taxo pipeline pre-pass: one extraction call per `#` section of every
   * source in the batch, then ONE global dedup call over the whole table.
   * The per-source plans are derived deterministically afterwards, in the
   * main loop, from the result of this pass.
   */
  /**
   * Which sources the taxo pre-pass actually needs to spend LLM calls on.
   *
   * The pre-pass used to run over the WHOLE batch before the per-source
   * "unchanged since last ingest" skip below ever got a chance to fire:
   * every unchanged source paid for full section extraction, and its rows
   * even fed the global dedup call's naming decisions, only to be discarded
   * moments later when the main loop skipped it anyway. Re-checking here is
   * cheap — a hash comparison, no LLM call — which is exactly the cost the
   * pre-pass itself is not; any read error here is swallowed and the source
   * is conservatively kept in, so the main loop's own per-source try/catch
   * is what reports a genuine failure, never this optimization.
   */
  /**
   * Concept-vocabulary reconciliation, on the live corpus, per apply.
   *
   * A plan is often computed in another process, in parallel with its
   * siblings, from a folder list that predates their writes: a NEW folder can
   * duplicate one a sibling just created. Established identities are the
   * anchor — the model is asked only about newly proposed folders, maps each
   * onto a retrieved established concept or another proposal, and never
   * renames or merges two established folders: a vocabulary that could be
   * dissolved from one ingest to the next never settles. The engine then
   * rewrites the plan's paths. No synonym table or concept-folder registry.
   */


  private async filterSourcesNeedingTaxoPrePass(
    sourcePaths: string[],
    previousRegistry: SourceRegistryFile | null,
    options?: IngestCommandOptions,
  ): Promise<Array<{ sourcePath: string; relativePath: string }>> {
    if (options?.force) {
      return sourcePaths.map((sourcePath) => ({ sourcePath, relativePath: sourcePath }));
    }
    const language = this.config.language || 'en';
    const signature = `${TAXO_PROMPT_VERSION}:${this.config.llm.model}:${language}`;
    const existingInputHashes = new Set<string>();
    const existingContentHashes = new Set<string>();
    try {
      for (const page of await this.retrieval.warmCache()) {
        if (!page.relativePath.startsWith('wiki/sources/')) continue;
        const metadata = matter(page.content).data;
        const inputHash = metadata?.input_hash;
        const contentHash = metadata?.content_hash;
        if (typeof inputHash === 'string' && inputHash) existingInputHashes.add(inputHash);
        if (typeof contentHash === 'string' && contentHash) existingContentHashes.add(contentHash);
      }
    } catch {
      // A cache failure makes the optimization conservative: process sources.
    }
    const needed: Array<{ sourcePath: string; relativePath: string }> = [];
    for (const sourcePath of sourcePaths) {
      try {
        const source = await this.workspace.readSourceDocument(sourcePath, {
          ingested: options?.fromIngested === true,
        });
        const docTitle = /^#\s+(.+)$/m.exec(source.body ?? '')?.[1]?.trim() ?? source.title;
        const sections = extractSectionSheets(source.rawContent, docTitle, this.config.ingest?.sheets);
        const allCurrent = sections.length > 0 && sections.every((section) => {
          const startLine = section.sourceRanges[0]?.startLine ?? 1;
          const endLine = section.sourceRanges[section.sourceRanges.length - 1]?.endLine ?? 1;
          const hash = sheetInputHash(
            source.archiveCitationPath,
            startLine,
            endLine,
            section.body,
            signature,
          );
          return existingInputHashes.has(hash)
            && existingContentHashes.has(sheetContentHash(section.body, signature));
        });
        if (allCurrent) continue;
        const unchanged = await this.workspace.isSourceUnchangedSinceIngest(source);
        if (unchanged) {
          const vanished = await this.findVanishedProducedPages(source, previousRegistry);
          if (vanished.length === 0 && sections.length === 0) continue;
        }
        needed.push({ sourcePath, relativePath: source.relativePath });
      } catch {
        // Fall through to keeping it in — the main loop reads the source
        // again and reports the real failure through its own try/catch.
        needed.push({ sourcePath, relativePath: sourcePath });
      }
    }
    return needed;
  }

  private async isCloseSheetDuplicate(
    row: TaxoRow,
    candidates: SheetIndexEntry[],
    sourcePath: string,
    gate?: Semaphore,
  ): Promise<SheetIndexEntry | null> {
    const user = [
      `Incoming section: ${row.heading}`,
      row.description ? `Incoming description: ${row.description}` : '',
      row.facts.slice(0, 1800),
      '',
      'Bounded existing candidates:',
      ...candidates.map((candidate, index) => [
        `Candidate ${index + 1}: ${candidate.title}`,
        `Path: ${candidate.path}`,
        candidate.description ? `Description: ${candidate.description}` : '',
        candidate.excerpt ?? '',
      ].filter(Boolean).join('\n')),
      '',
      'Return exactly one line: DUPLICATE <candidate number> only if the incoming section contributes no materially new information and is the same subject; otherwise return KEEP.',
    ].filter(Boolean).join('\n');
    try {
      const callModel = () => this.llm.completeText({
        system: 'You conservatively identify near-duplicate knowledge sections. Similar titles or shared vocabulary alone are never enough to discard a section.',
        user,
        label: 'ingest_taxo_sheet_dedup',
        logger: this.logger,
        traceData: { source: sourcePath, section: row.heading, candidates: candidates.length },
      });
      const response = gate ? await gate.run(callModel) : await callModel();
      const match = /^\s*DUPLICATE\s+(\d+)\s*$/i.exec(response.trim());
      const index = match ? Number(match[1]) - 1 : -1;
      return Number.isInteger(index) && index >= 0 && index < candidates.length
        ? candidates[index]!
        : null;
    } catch (error) {
      await this.logger.warn('ingest:sheet-dedup-degraded', {
        source: sourcePath,
        section: row.heading,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * The on-disk fiche index used for cross-source duplicate detection.
   *
   * Seeded once at the start of a run; `extractTaxoSheets` grows it with every
   * surviving row, so a later source sees the fiches an earlier source just
   * produced — the ordering the global pre-pass used to provide, without
   * delaying every write until the whole batch is extracted.
   */
  private async loadSheetIndex(): Promise<SheetIndexEntry[]> {
    const sheetIndex: SheetIndexEntry[] = [];
    try {
      for (const page of await this.retrieval.warmCache()) {
        if (!page.relativePath.startsWith('wiki/sources/')) continue;
        const metadata = matter(page.content).data;
        const inputHash = metadata?.input_hash;
        sheetIndex.push({
          path: page.relativePath,
          title: typeof metadata?.title === 'string' ? metadata.title : page.name,
          ...(typeof metadata?.description === 'string' ? { description: metadata.description } : {}),
          ...(typeof inputHash === 'string' && inputHash ? { inputHash } : {}),
          ...(typeof metadata?.content_hash === 'string' && metadata.content_hash ? { contentHash: metadata.content_hash } : {}),
          excerpt: matter(page.content).content.replace(/\s+/g, ' ').slice(0, 1200),
        });
      }
    } catch {
      // A cache failure only loses the optional duplicate index; the run still
      // gets the deterministic per-batch checks.
    }
    return sheetIndex;
  }

  /** Extract the section fiches of one source (or a small batch). */
  private async extractTaxoSheets(
    sourcePaths: string[],
    cache: IngestCache,
    options: (IngestCommandOptions & {
      onSourceStart?: (sourcePath: string, index: number, total: number) => void;
      onSourceLlm?: (
        sourcePath: string,
        index: number,
        total: number,
        progress?: { sectionIndex: number; sectionTotal: number },
      ) => void;
      onSourceUsage?: (
        sourcePath: string,
        index: number,
        total: number,
        usage: TokenUsage,
        progress?: { sectionIndex: number; sectionTotal: number },
      ) => void;
    }) | undefined,
    sheetIndex: SheetIndexEntry[],
    sourceIndex: number,
    sourceTotal: number,
    gate?: Semaphore,
  ): Promise<{
    rowsBySource: Map<string, TaxoRow[]>;
    duplicatePagesBySource: Map<string, string[]>;
    sectionCounts: Map<string, number>;
    retryBySource: Map<string, IngestRetryInfo>;
    /** sourcePath -> error message. Surfaced by the main per-source loop as
     * a normal `failed: true` result. */
    failedSources: Map<string, string>;
  }> {
    const taxoSectionSchema = z.object({
      description: z.string().default(''),
      tags: z.array(z.string()).default([]),
      body: z.string().default(''),
    });
    // v3 is the Markdown fiche contract. It must not reuse v2's JSON
    // extraction cache, otherwise an old {concept,resume,facts} answer would
    // be interpreted as an empty fiche and silently remove TAXO output.
    const language = this.config.language || 'en';
    const modelId = `${this.config.llm.model}:${language}`;
    const rowsBySource = new Map<string, TaxoRow[]>();
    const duplicatePagesBySource = new Map<string, string[]>();
    const sectionCounts = new Map<string, number>();
    const retryBySource = new Map<string, IngestRetryInfo>();
    const failedSources = new Map<string, string>();
    const rows: TaxoRow[] = [];

    for (let i = 0; i < sourcePaths.length; i++) {
      const sourcePath = sourcePaths[i];
      // NOT options?.onSourceStart here: its contract is "fires once per
      // source, at the start of ITS processing." The main loop already
      // fires it when the source reaches its own turn — firing it here too
      // made the CLI spinner jump back to "source 1 of N" the moment this
      // (often much longer) pre-pass finished, reading as a restart.
      try {
        const source = await this.workspace.readSourceDocument(sourcePath, {
          ingested: options?.fromIngested === true,
        });
        const rawBody = normalizeSourceBody(source.body ?? '');
        const docTitle = /^#\s+(.+)$/m.exec(source.body ?? '')?.[1]?.trim()
          ?? source.title;
        const sections = extractSectionSheets(source.rawContent, docTitle, this.config.ingest?.sheets).map((section) => ({
          heading: section.title,
          body: section.body,
          startLine: section.sourceRanges[0]?.startLine ?? 1,
          endLine: section.sourceRanges[section.sourceRanges.length - 1]?.endLine ?? 1,
          locator: section.sourceRanges.map((range) => `${range.startLine}-${range.endLine}`).join(','),
          sourceRanges: section.sourceRanges,
        }));
        sectionCounts.set(source.relativePath, sections.length);
        const sourceHash = hashText(`${source.archiveCitationPath}\u0000${rawBody}`);

        /*
         Phase 1 — N concurrent extractions, one per section, no writes.

         Mirrors the classic pipeline's own per-pack extraction: independent
         reads of the same source have no reason to run one at a time.
        */
        const sectionResults = await mapWithConcurrency(
          sections,
          this.config.limits.maxInFlightRequests ?? 3,
          async (section, sectionIndex): Promise<{
            extraction: { description: string; tags: string[]; body: string };
            retry?: IngestRetryInfo;
          }> => {
            const cacheName = extractionCacheName({
              sourceHash,
              packIndex: sectionIndex,
              packHash: hashText(section.body),
              model: modelId,
              promptVersion: TAXO_PROMPT_VERSION,
              schemaVersion: 3,
            });
            let extraction: { description: string; tags: string[]; body: string } | null = null;
            const cached = await cache.read<unknown>(cacheName);
            if (cached) {
              const parsed = taxoSectionSchema.safeParse(cached);
              if (parsed.success) extraction = parsed.data;
            }
            const cachedHit = extraction !== null;
            let sectionRetry: IngestRetryInfo | undefined;
            if (!extraction) {
              try {
                const { value, retry } = await withRetry(
                  async () => {
                    const callModel = () => this.llm.completeText({
                    system: TAXO_SECTION_SYSTEM.replace('2 to 3', `2 to ${Math.max(2, this.config.ingest?.sheets.maxTags ?? 3)}`),
                      user: buildTaxoSectionUser(docTitle, section),
                      label: 'ingest_taxo_sheet',
                      logger: this.logger,
                      traceData: { source: source.relativePath, section: section.heading },
                      onUsage: (usage) => {
                        options?.onSourceUsage?.(sourcePath, sourceIndex, sourceTotal, usage, {
                          sectionIndex,
                          sectionTotal: sections.length,
                        });
                      },
                    });
                    const raw = gate ? await gate.run(callModel) : await callModel();
                    return parseTaxoSheet(raw, this.config.ingest?.sheets.maxTags ?? 3);
                  },
                  {
                    onRetry: async (retryInfo) => {
                      await this.logger.warn('ingest:retry', {
                        source: source.relativePath,
                        phase: 'taxo_extract',
                        attempts: retryInfo.attempts,
                        retries: retryInfo.retries,
                        classification: retryInfo.classification,
                        message: retryInfo.message,
                        section: section.heading,
                      });
                    },
                  },
                );
                extraction = value;
                if (retry.retries > 0) {
                  sectionRetry = retry;
                  if (options?.verbose) {
                    await this.logger.info('ingest:extract', {
                      source: source.relativePath,
                      section: section.heading,
                      cached: false,
                      retries: retry.retries,
                    });
                  }
                }
                await cache.write(cacheName, extraction);
              } catch (error) {
                // A bad section must not discard the other sections of the
                // document. Keep its faithful source body and make the
                // degraded state visible for the activity panel and agents.
                extraction = { description: '', tags: [], body: section.body };
                await this.logger.warn('ingest:sheet-fallback', {
                  source: source.relativePath,
                  section: section.heading,
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }
            options?.onSourceLlm?.(sourcePath, sourceIndex, sourceTotal, {
              sectionIndex,
              sectionTotal: sections.length,
            });
            await this.logger.info('ingest:sheet', {
              source: source.relativePath,
              sectionIndex,
              sectionTotal: sections.length,
              cached: cachedHit,
            });
            return { extraction, retry: sectionRetry };
          },
        );

        const sourceRetry = sectionResults.findLast((result) => result.retry)?.retry;
        if (sourceRetry) retryBySource.set(source.relativePath, sourceRetry);

        // Row numbers must be assigned in section order, not completion
        // order: mapWithConcurrency preserves input order in its results
        // array (each worker writes to results[index]), so iterating it
        // sequentially here — outside the concurrent mapper — keeps
        // `row.row` stable and matching the table the dedup call sees.
        const sourceRows: TaxoRow[] = [];
        for (let sectionIndex = 0; sectionIndex < sectionResults.length; sectionIndex++) {
          const { extraction } = sectionResults[sectionIndex]!;
          const section = sections[sectionIndex]!;
          if (extraction.body) {
            const citationAnchors: string[] = [];
            for (const range of section.sourceRanges ?? [{ startLine: section.startLine, endLine: section.endLine }]) {
              const anchor = materializeLineAnchor(source.rawContent, range.startLine, range.endLine);
              if (anchor) citationAnchors.push(anchor);
              else {
                await this.logger.warn('ingest:sheet-unanchored', {
                  source: source.archiveCitationPath,
                  section: section.heading,
                  startLine: range.startLine,
                  endLine: range.endLine,
                  reason: 'source line range is outside the archived document',
                });
              }
            }
            const row: TaxoRow = {
              row: rows.length + 1,
              source: source.archiveCitationPath,
              archivePath: source.archiveCitationPath,
              heading: section.heading,
              locator: section.locator,
              facts: extraction.body,
              description: extraction.description,
              tags: extraction.tags,
              documentTitle: docTitle,
              citationAnchors,
              citationAnchor: citationAnchors[0],
              sourceRanges: section.sourceRanges,
              contentHash: sheetContentHash(
                section.body,
                `${TAXO_PROMPT_VERSION}:${this.config.llm.model}:${language}`,
              ),
              inputHash: sheetInputHash(
                source.archiveCitationPath,
                section.startLine,
                section.endLine,
                section.body,
                `${TAXO_PROMPT_VERSION}:${this.config.llm.model}:${language}`,
              ),
            };
            const exactDuplicate = exactSheetDuplicate(row.contentHash ?? '', sheetIndex);
            const targetPath = taxoSheetPath(row);
            if (exactDuplicate && exactDuplicate.path !== targetPath) {
              const references = duplicatePagesBySource.get(source.relativePath) ?? [];
              if (!references.includes(exactDuplicate.path)) references.push(exactDuplicate.path);
              duplicatePagesBySource.set(source.relativePath, references);
              await this.logger.info('ingest:sheet-duplicate', {
                source: source.relativePath,
                section: section.heading,
                inputHash: row.inputHash,
                contentHash: row.contentHash,
                duplicateOf: exactDuplicate.path,
              });
              continue;
            }
            const candidates = closeSheetCandidates(
              row.heading,
              row.description ?? '',
              sheetIndex.filter((entry) => entry.path !== targetPath),
              5,
            );
            const closeMatch = candidates.length > 0
              ? await this.isCloseSheetDuplicate(row, candidates, source.relativePath, gate)
              : null;
            if (closeMatch) {
              await this.logger.info('ingest:sheet-close', {
                source: source.relativePath,
                section: section.heading,
                inputHash: row.inputHash,
                duplicateOf: closeMatch.path,
                candidates: candidates.length,
              });
              continue;
            }
            sheetIndex.push({
              path: targetPath,
              title: row.heading,
              description: row.description,
              inputHash: row.inputHash,
              contentHash: row.contentHash,
              excerpt: row.facts.slice(0, 1200),
            });
            rows.push(row);
            sourceRows.push(row);
          } else {
            await this.logger.info('ingest:sheet-skipped', {
              source: source.relativePath,
              sectionIndex,
              reason: 'empty-model-body',
            });
          }
        }
        rowsBySource.set(source.relativePath, sourceRows);
      } catch (error) {
        // Per-source isolation: one source's fatal extraction failure (every
        // retry exhausted, a malformed response, an unreadable file) used to
        // abort the ENTIRE batch before a single result was produced — even
        // when every other source's extraction had already succeeded and
        // been cached. Record it and let the rest of the batch proceed; the
        // main per-source loop surfaces this source as a normal failure.
        const message = error instanceof Error ? error.message : String(error);
        await this.logger.error('ingest:taxo-prepass-failed', { sourcePath, message });
        failedSources.set(sourcePath, message);
        rowsBySource.set(sourcePath, []);
      }
    }

    return { rowsBySource, duplicatePagesBySource, sectionCounts, retryBySource, failedSources };
  }


  /**
   * Makes what has just been written visible to the graph.
   *
   * There is no registry to publish any more: the graph reads the concept
   * folders, `subject` and `tags` directly from disk, so a finished ingest is
   * visible on the next read. Kept as a hook so the log still records the
   * lifecycle boundary, never throwing.
   */
  private async publishGraphRevision(sourceLabel: string): Promise<void> {
    await this.logger.info('ingest:graph-revision', {
      source: sourceLabel,
      revision: 'direct-read',
    });
  }

  /**
   * Keeps `wiki/index.md` a true reflection of `wiki/concepts/**` and
   * `wiki/sources/*` — deterministically, not by asking the consolidation
   * model to reproduce the growing list on top of its per-source work. Same
   * never-throws discipline as `publishGraphRevision`: an index rebuild
   * failing must not take down already-applied ingestion work.
   */
  private async regenerateIndex(sourceLabel: string): Promise<void> {
    const outcome = await regenerateWikiIndex(this.workspace.paths.rootDir);
    if (outcome.status === 'written') {
      await this.logger.info('ingest:index-regenerated', {
        source: sourceLabel,
        concepts: outcome.concepts,
        sources: outcome.sources,
      });
      if (outcome.migrated) {
        await this.logger.warn('ingest:index-migrated', {
          source: sourceLabel,
          note: 'legacy generated index replaced by the TAXO index; the previous content remains in the workspace history',
        });
      }
      return;
    }
    await this.logger.warn('ingest:index-regeneration-failed', {
      source: sourceLabel,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
  }

  /**
   * Deterministic early refresh of the navigation pages for the tags a
   * just-applied source produced. No LLM, no purge: every tag the run has
   * seen gets its page immediately (under `unfiled/` until the end-of-run
   * family pass moves it). The final `regenerateTaxoTagPages` stays the
   * authority; this only makes the pages appear as the run advances.
   */
  private async refreshIncrementalTagPages(tags: string[]): Promise<void> {
    const wanted = new Set(tags.map((tag) => normalizeProvenanceValue(tag)).filter(Boolean));
    if (wanted.size === 0) return;
    const pages = await this.retrieval.warmCache();
    const tagRows = new Map<string, Array<{ title: string; path: string; description?: string }>>();
    for (const page of pages) {
      if (!page.relativePath.startsWith('wiki/sources/')) continue;
      const parsed = matter(page.content);
      const pageTags = Array.isArray(parsed.data?.tags)
        ? parsed.data.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
      for (const tag of pageTags) {
        const normalized = normalizeProvenanceValue(tag);
        if (!normalized || !wanted.has(normalized)) continue;
        const entries = tagRows.get(normalized) ?? [];
        entries.push({
          title: typeof parsed.data?.title === 'string' ? parsed.data.title : page.relativePath,
          path: page.relativePath,
          ...(typeof parsed.data?.description === 'string' ? { description: parsed.data.description } : {}),
        });
        tagRows.set(normalized, entries);
      }
    }
    if (tagRows.size === 0) return;
    const existingTagPages = new Map<string, WikiPage>();
    for (const page of pages) {
      if (!page.relativePath.startsWith('wiki/concepts/')) continue;
      const parsed = matter(page.content);
      const subject = typeof parsed.data?.subject === 'string'
        ? normalizeProvenanceValue(parsed.data.subject)
        : normalizeProvenanceValue(path.posix.basename(page.relativePath, '.md'));
      if (subject) existingTagPages.set(subject, page);
    }
    const operations: WikiOperation[] = [];
    const generatedAt = new Date().toISOString();
    for (const [tag, entries] of tagRows) {
      const prior = existingTagPages.get(tag);
      const priorMatter = prior ? matter(prior.content) : null;
      if (priorMatter && (priorMatter.data?.status === 'stable' || priorMatter.data?.verified === true)) continue;
      const rawFamily = typeof priorMatter?.data?.family === 'string' ? priorMatter.data.family.trim() : '';
      const family = rawFamily && normalizeProvenanceValue(rawFamily) !== 'unfiled' ? rawFamily : 'unfiled';
      const targetPath = family === 'unfiled' || !prior
        ? `wiki/concepts/unfiled/${tag}.md`
        : prior.relativePath;
      const existing = pages.find((page) => page.relativePath === targetPath);
      const identitySource = existing ?? prior;
      const existingProvenance = identitySource ? readProvenance(identitySource.content) : null;
      const content = taxoTagPageContent(
        tag,
        family,
        entries,
        generatedAt,
        existingProvenance?.concept_id ?? newKnowledgeIdentity(),
        this.config.ingest?.tagPages.sourcePreviewLimit ?? 50,
        existingProvenance?.subject_id ?? newKnowledgeIdentity(),
      );
      const withoutGeneratedAt = (value: string): string => value.replace(/^( {2}at: ).*$/m, '$1<generated>');
      if (existing && withoutGeneratedAt(existing.content) === withoutGeneratedAt(content)) continue;
      operations.push({ type: existing ? 'update' : 'create', path: targetPath, content });
    }
    if (operations.length === 0) return;
    await this.workspace.applyNormalizedWikiOperations(operations);
    this.retrieval.invalidateCache();
    await this.logger.info('ingest:tag-pages-refreshed', {
      tags: tagRows.size,
      pages: operations.length,
    });
  }

  /** Build deterministic tag pivots after all TAXO fiches in the run exist. */
  private async regenerateTaxoTagPages(options?: IngestProgressHooks): Promise<void> {
    await this.logger.info('ingest:regroup-start', {});
    const pages = await this.retrieval.warmCache();
    const tagCatalogue = loadTagCatalogue(pages
      .filter((page) => page.relativePath.startsWith('wiki/sources/'))
      .map((page) => {
        const parsed = matter(page.content);
        return Array.isArray(parsed.data?.tags)
          ? parsed.data.tags.filter((tag): tag is string => typeof tag === 'string')
          : [];
      }));
    const tagRows = new Map<string, Array<{ title: string; path: string; description?: string }>>();
    for (const page of pages) {
      if (!page.relativePath.startsWith('wiki/sources/')) continue;
      const parsed = matter(page.content);
      const tags = Array.isArray(parsed.data?.tags)
        ? parsed.data.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
      for (const tag of harmonizeTags(tags, tagCatalogue)) {
        const normalized = tag;
        if (!normalized) continue;
        const entries = tagRows.get(normalized) ?? [];
        entries.push({
          title: typeof parsed.data?.title === 'string' ? parsed.data.title : page.relativePath,
          path: page.relativePath,
          ...(typeof parsed.data?.description === 'string' ? { description: parsed.data.description } : {}),
        });
        tagRows.set(normalized, entries);
      }
    }

    const activeTags = [...tagRows.keys()].sort((a, b) => a.localeCompare(b));
    const existingTagPages = new Map<string, WikiPage>();
    const establishedFamilies = new Map<string, TagFamily>();
    for (const page of pages) {
      if (!page.relativePath.startsWith('wiki/concepts/')) continue;
      const parsed = matter(page.content);
      const generatedTag = parsed.data?.generated
        && typeof parsed.data.generated === 'object'
        && parsed.data.generated.by === 'llm-wiki-tags';
      const hasFamily = typeof parsed.data?.family === 'string' && parsed.data.family.trim().length > 0;
      if (!generatedTag && !hasFamily) continue;
      const subject = typeof parsed.data?.subject === 'string'
        ? normalizeProvenanceValue(parsed.data.subject)
        : normalizeProvenanceValue(path.posix.basename(page.relativePath, '.md'));
      if (subject) existingTagPages.set(subject, page);
      if (isUnfiledTagPage(page, parsed.data?.family)) continue;
      const family = typeof parsed.data?.family === 'string'
        ? parsed.data.family.trim()
        : '';
      if (!family || normalizeProvenanceValue(family) === 'unfiled') continue;
      const row = establishedFamilies.get(family) ?? { family, tags: [] };
      const knownTags = Array.isArray(parsed.data?.tags)
        ? parsed.data.tags.filter((tag): tag is string => typeof tag === 'string')
        : subject ? [subject] : [];
      for (const tag of knownTags) {
        if (!row.tags.some((known) => normalizeProvenanceValue(known) === normalizeProvenanceValue(tag))) {
          row.tags.push(tag);
        }
      }
      establishedFamilies.set(family, row);
    }

    const established = [...establishedFamilies.values()];
    const newTags = activeTags.filter((tag) => {
      const page = existingTagPages.get(tag);
      if (!page) return true;
      const parsed = matter(page.content);
      const family = typeof parsed.data?.family === 'string'
        ? parsed.data.family.trim()
        : '';
      return isUnfiledTagPage(page, family) || !family;
    });
    const initialGrouping = established.length === 0;
    let llmCalls = 0;
    let proposedFamilies: TagFamily[] | null = null;
    if (newTags.length > 0) {
      await options?.onPhase?.('regroup', {
        tags: initialGrouping ? activeTags.length : newTags.length,
        establishedFamilies: established.length,
      });
      const taxonomyPrompt = initialGrouping
        ? [
            `Group these workspace tags into ${this.config.ingest?.families.min ?? 3} to ${this.config.ingest?.families.max ?? 10} semantic families. Use concise family names in the workspace language.`,
            'Return only a JSON array: [{"family":"...","tags":["..."]}]. Every tag must occur exactly once and remain unchanged.',
          ].join('\n')
        : [
            'Assign each new workspace tag to one established semantic family. Keep established family names unchanged.',
            'You may create a new family only when none of the established families fits.',
            'Return only a JSON array: [{"family":"...","tags":["..."]}]. Every new tag must occur exactly once and remain unchanged.',
          ].join('\n');
      const context = initialGrouping
        ? activeTags.map((tag) => `- ${tag}: ${tagRows.get(tag)?.slice(0, 3).map((row) => row.description || row.title).join('; ')}`).join('\n')
        : [
            'Established families:',
            ...established.map((row) => `- ${row.family}: ${row.tags.join(', ')}`),
            '',
            'New tags:',
            ...newTags.map((tag) => `- ${tag}: ${tagRows.get(tag)?.slice(0, 3).map((row) => row.description || row.title).join('; ')}`),
          ].join('\n');
      const requestedTags = initialGrouping ? activeTags : newTags;
      try {
        if (initialGrouping && requestedTags.length > TAXO_FAMILY_BATCH_THRESHOLD) {
          // A monolithic assignment prompt can become enormous and ask one
          // response to emit hundreds of tag assignments. On the 220-tag ACPI
          // corpus it consumed the full 10-minute model timeout and fell back
          // to unfiled pages. Discover a small, workspace-specific catalogue
          // once, then assign bounded chunks against that shared vocabulary.
          const minFamilies = this.config.ingest?.families.min ?? 3;
          const maxFamilies = this.config.ingest?.families.max ?? 10;
          const inventory = requestedTags.map((tag) => {
            const example = tagRows.get(tag)?.[0];
            const context = String(example?.description || example?.title || '').replace(/\s+/g, ' ').slice(0, 120);
            return context ? `- ${tag}: ${context}` : `- ${tag}`;
          }).join('\n');
          llmCalls += 1;
          const catalogueRaw = await this.llm.completeText({
            system: [
              `Propose ${minFamilies} to ${maxFamilies} concise semantic family names for this workspace's complete tag inventory.`,
              'Use the workspace language. Return only a JSON array of strings; do not assign tags yet.',
            ].join('\n'),
            user: `Workspace language: ${this.config.language || 'en'}\n\nTag inventory:\n${inventory}`,
            label: 'ingest_taxo_family_catalogue',
            logger: this.logger,
            traceData: { tags: requestedTags.length, establishedFamilies: 0 },
          });
          const familyLabels = parseTagFamilyLabels(catalogueRaw, minFamilies, maxFamilies);
          if (!familyLabels) {
            await this.logger.warn('ingest:tag-family-degraded', {
              reason: 'invalid-family-catalogue',
              tags: requestedTags.length,
            });
            options?.onWarning?.('tag-family-degraded', { reason: 'invalid-family-catalogue', tags: requestedTags.length });
          } else {
            const batches: string[][] = [];
            for (let index = 0; index < requestedTags.length; index += TAXO_FAMILY_BATCH_SIZE) {
              batches.push(requestedTags.slice(index, index + TAXO_FAMILY_BATCH_SIZE));
            }
            const assignments = await mapWithConcurrency(batches, TAXO_FAMILY_BATCH_CONCURRENCY, async (batch, batchIndex) => {
              options?.onPhase?.('regroup', {
                tags: requestedTags.length,
                batchIndex: batchIndex + 1,
                batchCount: batches.length,
              });
              const batchContext = batch.map((tag) => {
                const example = tagRows.get(tag)?.[0];
                const detail = String(example?.description || example?.title || '').replace(/\s+/g, ' ').slice(0, 240);
                return detail ? `- ${tag}: ${detail}` : `- ${tag}`;
              }).join('\n');
              llmCalls += 1;
              try {
                const raw = await this.llm.completeText({
                  system: [
                    'Assign every listed tag to exactly one family from the supplied catalogue.',
                    'Use the family names exactly as written. Do not invent, rename, omit, or repeat tags.',
                    'Return only a JSON array: [{"family":"...","tags":["..."]}].',
                  ].join('\n'),
                  user: `Workspace language: ${this.config.language || 'en'}\n\nFamilies:\n${familyLabels.map((family) => `- ${family}`).join('\n')}\n\nTags to assign:\n${batchContext}`,
                  label: 'ingest_taxo_family_batch',
                  logger: this.logger,
                  traceData: {
                    tags: batch.length,
                    batchIndex: batchIndex + 1,
                    batchCount: batches.length,
                    establishedFamilies: familyLabels.length,
                  },
                });
                const parsed = parseTagFamilies(raw, batch);
                return parsed ? restrictTagFamilies(parsed, familyLabels) : [];
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await this.logger.warn('ingest:tag-family-batch-failed', {
                  batch: batchIndex + 1,
                  batches: batches.length,
                  tags: batch.length,
                  message,
                });
                options?.onWarning?.('tag-family-degraded', {
                  reason: 'batch-failed',
                  batch: batchIndex + 1,
                  batches: batches.length,
                  message,
                });
                return [];
              }
            });
            const merged = new Map<string, TagFamily>();
            for (const group of assignments.flat()) {
              const normalized = normalizeProvenanceValue(group.family);
              const current = merged.get(normalized) ?? { family: group.family, tags: [] };
              current.tags.push(...group.tags);
              merged.set(normalized, current);
            }
            proposedFamilies = merged.size > 0 ? [...merged.values()] : null;
          }
        } else {
          llmCalls += 1;
          const raw = await this.llm.completeText({
            system: taxonomyPrompt,
            user: `Workspace language: ${this.config.language || 'en'}\n\n${context}`,
            label: 'ingest_taxo_families',
            logger: this.logger,
            traceData: { tags: requestedTags.length, establishedFamilies: established.length },
          });
          proposedFamilies = parseTagFamilies(raw, requestedTags);
          if (proposedFamilies && !initialGrouping) {
            proposedFamilies = anchorTagFamilies(proposedFamilies, established);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.logger.warn('ingest:tag-family-degraded', {
          reason: 'llm-failed',
          message,
        });
        options?.onWarning?.('tag-family-degraded', { reason: 'llm-failed', message });
      }
      if (!proposedFamilies) {
        await this.logger.warn('ingest:tag-family-degraded', {
          reason: 'invalid-or-incomplete-family-response',
          requestedTags,
        });
        options?.onWarning?.('tag-family-degraded', {
          reason: 'invalid-or-incomplete-family-response',
          tags: requestedTags.length,
        });
      } else {
        const missing = missingTagAssignments(proposedFamilies, requestedTags);
        if (missing.length > 0) {
          await this.logger.warn('ingest:tag-family-partial', {
            missing: missing.length,
            tags: missing.slice(0, 20),
          });
          options?.onWarning?.('tag-family-partial', {
            missing: missing.length,
            tags: missing.slice(0, 20),
          });
        }
      }
    }

    const familyByTag = new Map<string, string>();
    for (const group of proposedFamilies ?? established) {
      for (const tag of group.tags) familyByTag.set(normalizeProvenanceValue(tag), group.family);
    }
    // Reuse the recorded family for already-classified tags, including their
    // established spelling; a new grouping call cannot silently rename them.
    for (const tag of activeTags) {
      const current = existingTagPages.get(tag);
      const family = current ? matter(current.content).data?.family : undefined;
      if (current && typeof family === 'string' && family && !isUnfiledTagPage(current, family)) {
        familyByTag.set(tag, family.trim());
      }
    }
    const operations: WikiOperation[] = [];
    const generatedAt = new Date().toISOString();
    const expectedTagPaths = new Set<string>();
    for (const [tag, entries] of tagRows) {
      const priorPage = existingTagPages.get(tag);
      const priorMatter = priorPage ? matter(priorPage.content) : null;
      const protectedPage = Boolean(priorMatter && (
        priorMatter.data?.status === 'stable' || priorMatter.data?.verified === true
      ));
      const assignedFamily = familyByTag.get(tag);
      // First run without a usable family grouping: a tag still gets its
      // navigation page under `unfiled/` (the prototype behavior). Losing
      // every concept page to one degraded LLM answer was a silent dead end;
      // the degradation is warned either way.
      const unfiledFallback = initialGrouping
        && (!assignedFamily || normalizeProvenanceValue(assignedFamily) === 'unfiled');
      if (!protectedPage && !unfiledFallback
        && (!assignedFamily || normalizeProvenanceValue(assignedFamily) === 'unfiled')) {
        await this.logger.warn('ingest:tag-unfiled', {
          tag,
          ficheCount: entries.length,
          reason: 'no-family-assignment',
        });
        options?.onWarning?.('tag-unfiled', { tag, ficheCount: entries.length });
        continue;
      }
      const family = protectedPage && typeof priorMatter?.data?.family === 'string'
        ? priorMatter.data.family.trim()
        : unfiledFallback ? 'unfiled' : assignedFamily!;
      const tagPath = protectedPage ? priorPage!.relativePath
        : `wiki/concepts/${normalizeProvenanceValue(family)}/${tag}.md`;
      expectedTagPaths.add(tagPath);
      const existing = pages.find((page) => page.relativePath === tagPath);
      if (protectedPage) continue;
      const identitySource = existing ?? priorPage;
      const existingProvenance = identitySource ? readProvenance(identitySource.content) : null;
      const existingIdentity = existingProvenance?.concept_id ?? undefined;
      const subjectIdentity = existingProvenance?.subject_id ?? newKnowledgeIdentity();
      const content = taxoTagPageContent(
        tag,
        family,
        entries,
        generatedAt,
        existingIdentity ?? newKnowledgeIdentity(),
        this.config.ingest?.tagPages.sourcePreviewLimit ?? 50,
        subjectIdentity,
      );
      const withoutGeneratedAt = (value: string): string => value.replace(/^( {2}at: ).*$/m, '$1<generated>');
      if (existing && withoutGeneratedAt(existing.content) === withoutGeneratedAt(content)) {
        if (priorPage && priorPage.relativePath !== tagPath
          && /^\s*by:\s*llm-wiki-tags\s*$/m.test(priorPage.content)) {
          operations.push({ type: 'delete', path: priorPage.relativePath });
        }
        continue;
      }
      operations.push({
        type: existing ? 'update' : 'create',
        path: tagPath,
        content,
      });
      if (priorPage && priorPage.relativePath !== tagPath
        && /^\s*by:\s*llm-wiki-tags\s*$/m.test(priorPage.content)) {
        operations.push({ type: 'delete', path: priorPage.relativePath });
      }
    }
    for (const page of pages) {
      if (!page.relativePath.startsWith('wiki/concepts/')
        || expectedTagPaths.has(page.relativePath)
        || !/^\s*by:\s*llm-wiki-tags\s*$/m.test(page.content)) continue;
      const metadata = matter(page.content).data;
      if (metadata?.status === 'stable' || metadata?.verified === true) {
        await this.logger.info('ingest:tag-page-protected', { path: page.relativePath });
        options?.onWarning?.('tag-page-protected', { path: page.relativePath });
        continue;
      }
      operations.push({ type: 'delete', path: page.relativePath });
      await this.logger.info('ingest:tag-page-removed', { path: page.relativePath });
    }
    if (operations.length === 0) {
      await this.logger.info('ingest:regroup-done', {
        families: new Set(familyByTag.values()).size,
        tags: activeTags.length,
        newTags: newTags.length,
        unfiled: activeTags.filter((tag) => !familyByTag.has(tag) || normalizeProvenanceValue(familyByTag.get(tag)!) === 'unfiled').length,
        pagesWritten: 0,
        pagesRemoved: 0,
        llmCalls,
      });
      return;
    }
    await this.workspace.applyNormalizedWikiOperations(operations);
    for (const operation of operations) {
      if (operation.type === 'delete') continue;
      await this.logger.info('ingest:output', { path: operation.path, source: 'taxo-tags' });
    }
    this.retrieval.invalidateCache();
    await options?.onPhase?.('index', { pages: operations.length });
    await this.regenerateIndex('taxo-tags');
    await this.logger.info('ingest:taxo-tags', { pages: operations.length });
    await this.logger.info('ingest:regroup-done', {
      families: new Set(familyByTag.values()).size,
      tags: activeTags.length,
      newTags: newTags.length,
      unfiled: activeTags.filter((tag) => !familyByTag.has(tag) || normalizeProvenanceValue(familyByTag.get(tag)!) === 'unfiled').length,
      pagesWritten: operations.filter((operation) => operation.type !== 'delete').length,
      pagesRemoved: operations.filter((operation) => operation.type === 'delete').length,
      llmCalls,
    });
  }

  /**
   * Produced pages of a source that no longer exist on disk.
   *
   * The "unchanged since last ingest" skip is keyed on the ARCHIVE hash, not on
   * the wiki pages the previous ingest actually wrote. A page deleted by hand (a
   * source note, a concept leaf) would therefore stay deleted forever: re-exporting
   * the identical source re-archives it and skips, so every step reports success
   * over an empty wiki. This closes that gap — an unchanged source whose produced
   * pages have vanished is re-ingested instead of skipped.
   *
   * A concept leaf missing from its recorded path is not necessarily deleted:
   * `wiki/concepts/**` pages are also manually re-filed (moving
   * `wiki/concepts/unclassified/x.md` to `wiki/concepts/<class>/x.md` keeps the
   * `<subject>.md` basename — see `conceptPagePath`/`parseConceptPagePath`).
   * Re-ingesting on a manual move would re-derive and write a fresh page at the
   * old location, leaving both the moved page and a duplicate for the same
   * subject. Before declaring such a page vanished, check whether a page with
   * the same basename still exists elsewhere under `wiki/concepts/` — if so,
   * it moved, and re-ingesting it is exactly the thing to avoid. The
   * TAXO tag pages keep their tag basename when moved between family folders,
   * so exact basename matching is sufficient and avoids equating unrelated
   * underscore names.
   */
  private async findVanishedProducedPages(
    source: SourceDocument,
    previousRegistry: SourceRegistryFile | null,
  ): Promise<string[]> {
    if (!previousRegistry) return [];
    const sourceId = sourceIdFromArchivePath(source.archiveCitationPath);
    const record = previousRegistry.sources.find((entry) => entry.sourceId === sourceId);
    if (!record) return [];
    const missing: string[] = [];
    for (const page of record.producedPages) {
      if (!(await pathExists(resolveInside(this.workspace.paths.rootDir, page)))) {
        missing.push(page);
      }
    }
    if (missing.length === 0) return [];
    const missingConceptPages = missing.filter((page) => page.startsWith(CONCEPT_PREFIX));
    if (missingConceptPages.length === 0) return missing;
    const existingBasenames = new Set(
      (await this.retrieval.warmCache())
        .map((page) => page.relativePath)
        .filter((relativePath) => relativePath.startsWith(CONCEPT_PREFIX))
        .map((relativePath) => relativePath.slice(relativePath.lastIndexOf('/') + 1)),
    );
    const vanished = missing.filter((page) => {
      if (!page.startsWith(CONCEPT_PREFIX)) return true;
      const basename = page.slice(page.lastIndexOf('/') + 1);
      return !existingBasenames.has(basename);
    });
    if (vanished.length !== missing.length) {
      await this.logger.info('ingest:concept-page-moved', {
        source: source.relativePath,
        moved: missing.filter((page) => !vanished.includes(page)),
      });
    }
    return vanished;
  }

  /**
   * The previous run's provenance registry, read once for the whole batch.
   *
   * Read once for the whole live ingestion batch so every source reconciles
   * against the state of the previous run, not a partially updated registry.
   */
  private async previousRegistry(): Promise<SourceRegistryFile | null> {
    const registryPath = this.workspace.paths?.internalDir
      ? path.join(this.workspace.paths.internalDir, SOURCE_REGISTRY_FILENAME)
      : null;
    return registryPath ? readSourceRegistry(registryPath) : null;
  }

  private async pruneMissingSourcePages(activeSourceIds: ReadonlySet<string>): Promise<void> {
    if (!this.workspace.paths.internalDir) return;
    const registryPath = path.join(this.workspace.paths.internalDir, SOURCE_REGISTRY_FILENAME);
    const lockPath = `${registryPath}.lock`;
    await withFileLock(lockPath, async () => {
      const registry = await readSourceRegistry(registryPath);
      const missing = registry.sources.filter((record) => !activeSourceIds.has(record.sourceId));
      const activeOwnedPages = new Set(registry.sources
        .filter((record) => activeSourceIds.has(record.sourceId))
        .flatMap((record) => record.producedPages));
      const pages = new Map((await this.retrieval.warmCache())
        .map((page) => [page.relativePath, page]));
      const operations: WikiOperation[] = [];
      for (const pagePath of new Set(missing.flatMap((record) => record.producedPages))) {
        if (activeOwnedPages.has(pagePath)
          || !(pagePath.startsWith('wiki/sources/') || pagePath.startsWith(CONCEPT_PREFIX))) continue;
        const page = pages.get(pagePath);
        if (!page) continue;
        const metadata = matter(page.content).data;
        if (metadata?.status === 'stable' || metadata?.verified === true) {
          await this.logger.info('ingest:sheet-prune-skipped', {
            path: pagePath,
            reason: 'protected page from missing source',
          });
          continue;
        }
        operations.push({ type: 'delete', path: pagePath });
      }
      if (operations.length > 0) {
        await this.workspace.applyNormalizedWikiOperations(operations);
        this.retrieval.invalidateCache();
      }
      for (const operation of operations) {
        await this.logger.info('ingest:sheet-pruned', {
          path: operation.path,
          reason: 'source archive missing from complete rebuild inventory',
        });
      }
      const next = markMissingSourceRecords(registry, activeSourceIds);
      if (JSON.stringify(next) !== JSON.stringify(registry)) {
        await writeSourceRegistry(registryPath, next);
      }
    });
  }

  private async observeSource(
    source: SourceDocument,
    operations: WikiOperation[] | null,
  ): Promise<void> {    try {
      const registryPath = path.join(this.workspace.paths.internalDir, SOURCE_REGISTRY_FILENAME);
      const lockPath = `${registryPath}.lock`;
      // The lock makes the registry read-modify-write cycle atomic across
      // processes, not just each individual file write.
      await withFileLock(lockPath, async () => {
        const registry = await readSourceRegistry(registryPath);
        const next = recordSourceObservation(registry, {
          sourceId: sourceIdFromArchivePath(source.archiveCitationPath),
          archivePath: source.archiveCitationPath,
          contentHash: hashContent(source.rawContent),
          // What was APPLIED, not what the model proposed. A deletion does not
          // produce a page.
          producedPages: operations
            ?.filter((operation) => operation.type !== 'delete')
            .map((operation) => operation.path),
          ingested: operations !== null,
          observedAt: new Date().toISOString(),
        });
        await writeSourceRegistry(registryPath, next);
      });
    } catch (error) {
      await this.logger.warn('ingest:registry-write-failed', {
        source: source.relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

}
