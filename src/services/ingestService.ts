import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildConsolidationPrompt, buildConsolidationRetryUser, CONSOLIDATION_PROMPT_VERSION } from '../prompts/consolidationPrompt.ts';
import { buildExtractionPrompt, EXTRACTION_PROMPT_VERSION } from '../prompts/extractionPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import {
  consolidationPlanSchema,
  CONSOLIDATION_SCHEMA_VERSION,
  type ConsolidationPlan,
} from '../ingest/consolidationSchema.ts';
import {
  consolidationCacheName,
  extractionCacheName,
  IngestCache,
} from '../ingest/extractionCache.ts';
import {
  EXTRACTION_SCHEMA_VERSION,
  mergeExtractions,
  sourceExtractionSchema,
  type SourceExtraction,
} from '../ingest/extractionSchema.ts';
import {
  collectionFromSourcePath,
  normalizeProvenanceValue,
  readProvenance,
  subjectsAreRelated,
} from '../ingest/provenance.ts';
import { CONCEPT_PREFIX, DEFAULT_CONCEPT_BUDGET, detectConceptOverflow, detectConceptSplits, detectDuplicatePaths, reanchorToPreviousConcepts, validateConsolidation } from '../ingest/consolidationValidate.ts';
import { CONCEPT_GRID_RELATIVE_PATH, readConceptGrid } from '../ingest/conceptGrid.ts';
import { hashText } from '../utils/hash.ts';
import { normalizeSourceBody } from '../utils/markdown.ts';
import { planSourcePacks } from '../utils/sourcePacking.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { withFileLock } from '../utils/fs.ts';
import { publishCorpusRevision } from '../graph/wiki/taxonomy/publish.ts';
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
  recordSourceObservation,
  SOURCE_REGISTRY_FILENAME,
  sourceIdFromArchivePath,
  writeSourceRegistry,
} from './sourceRegistry.ts';

interface IngestSectionResult {
  extraction: SourceExtraction;
  retry?: IngestRetryInfo;
}

interface PlannedIngestSource {
  source: string;
  summary?: string;
  operations: WikiOperation[];
  review?: IngestReviewOperation[];
  skipped?: boolean;
}

interface PlannedIngestFile {
  schemaVersion?: number;
  generatedAt?: string;
  sources?: PlannedIngestSource[];
}

export const INGEST_PLAN_FILE_VERSION = 2;

/**
 * Ceiling on the consolidation split-fix retries. One is usually enough; the
 * bound exists so a pathological source cannot loop indefinitely on a split the
 * model refuses to merge. After the last attempt, the plan is applied as-is and
 * the split is still reported as a warning.
 */
const MAX_SPLIT_RETRIES = 2;

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
        if (cleanCitationPath !== archiveCitationPath) rewrittenCitations += 1;
        // Always normalize to the single-space canonical form, even when the
        // path already matched: BARE_RAW_PATH_PATTERN below only tolerates a
        // small, bounded run of whitespace after "[src:" to recognize an
        // already-bracketed path. An untouched "[src:\n    path]" the model
        // emitted verbatim would fall outside that bound and get treated as
        // bare, wrapping the inner path a second time.
        return `[src: ${archiveCitationPath}]`;
      },
    );
    const sourceMarkers = operation.content.match(/\[src:/gi)?.length ?? 0;
    unreconciledCitations += Math.max(0, sourceMarkers - validCitationMarkers);

    // The model sometimes names its source as bare text instead of a
    // citation — a header line ("Source: raw/ingested/…") rather than a
    // per-claim [src: …]. Invisible to the citation machinery above and to
    // every downstream link renderer, which only ever looks for the bracket.
    // A per-source consolidation only ever has one legitimate source to name,
    // so wrapping it to the canonical archive path is the same repair as the
    // rewrite above, just for a mention that never carried brackets at all.
    content = content.replace(BARE_RAW_PATH_PATTERN, () => {
      wrappedBarePaths += 1;
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
    },
  ): Promise<IngestResult[]> {
    const runStartedAt = Date.now();
    await this.workspace.ensureInitialized();
    const profileSection = await this.workspace.loadProfileSection(
      this.config.limits.maxProfileChars,
    );
    await this.logger.info('ingest:run-start', {
      inputCount: inputs.length,
      dryRun: Boolean(options?.dryRun),
      refreshEnabled: options?.refresh === true,
    });

    /*
     The workspace's ranking grid, read ONCE for the whole batch.

     Read before the first source, for the same reason the source registry is:
     every source of a run must see one state of the world. Read per source, a
     grid edited mid-run would file the first half of the batch against one
     closed set and the second half against another, with nothing in the log
     saying which page answered to which.

     A malformed grid stops the run here, before any model call. Falling back to
     "no grid" would silently downgrade every blocking axis rule to a warning —
     the failure mode this whole lot exists to remove.
    */
    const gridRead = await readConceptGrid(this.workspace.paths.rootDir);
    if (gridRead.status === 'malformed') {
      throw new Error(
        `${CONCEPT_GRID_RELATIVE_PATH} is unusable: ${gridRead.issues.join('; ')}`,
      );
    }
    const grid = gridRead.status === 'ok' ? gridRead.grid : undefined;
    await this.logger.info('ingest:concept-grid', {
      status: gridRead.status,
      classes: grid?.classes.length ?? 0,
    });

    const selectionStartedAt = Date.now();
    const sourcePaths = await this.workspace.resolveSourceInputs(inputs);
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

     §12.2: on an unchanged body the consolidation renamed the same products
     from run to run. The stable reference against which a re-ingest must
     re-anchor is the source registry — what this source ACTUALLY produced last
     time — not the model's memory. Read it before the first source is observed,
     so every source sees the state of the PREVIOUS run.
     */
    const registryPath = this.workspace.paths?.internalDir
      ? path.join(this.workspace.paths.internalDir, SOURCE_REGISTRY_FILENAME)
      : null;
    const previousRegistry = registryPath ? await readSourceRegistry(registryPath) : null;

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
        const source = await this.workspace.readSourceDocument(sourcePath);
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

        if (!options?.force) {
          const unchanged = await this.workspace.isSourceUnchangedSinceIngest(source);
          if (unchanged) {
            await this.logger.info('ingest:source-skip', {
              source: source.relativePath,
              reason: 'unchanged since last ingest',
            });
            results.push({
              source: source.relativePath,
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
        }

        const { maxChunkChars, maxSourceChars } = this.config.retrieval;
        const rawBody = normalizeSourceBody(source.body ?? '');
        /*
         A single planner, for ingestion as well as `wiki doctor`.

         The previous splitting cut at every title without ever repacking: the
         number of LLM calls depended on the document's formatting, not on its
         volume. Two sibling documents received a very different number of
         decisions, and the resulting gap in concepts then read as a difference
         in richness.
        */
        const plan = planSourcePacks(rawBody, { maxChars: maxSourceChars });
        const sections = plan.packs.map((pack) => pack.text);

        // Logged for EVERY source, even unsplit: this is the measure that lets
        // us explain afterwards why a source cost N calls.
        await this.logger.info('ingest:pack', {
          source: source.relativePath,
          ...plan.diagnostics,
        });

        const sourcePagePath = path.posix.join('wiki', 'sources', `${source.slug}.md`);
        /*
         The source identity enters the cache key, not just its content.

         Two distinct documents can have an identical body — a record template
         filled twice, a duplicated export. Without the citation path in the
         key, one document's consolidated plan would be re-served to the other,
         with its citations and its source note: a page attributed to the wrong
         document, and nothing to signal it.
        */
        const sourceHash = hashText(`${source.archiveCitationPath}\u0000${rawBody}`);
        const modelId = this.config.llm.model;

        /*
         Phase 1 — N concurrent extractions, no writes.

         Each batch reports facts and candidate subjects with local identifiers.
         None can create, update or delete anything: that is what makes the
         original flaw impossible, where two fragments wrote two pages of the
         same concept without seeing each other.
        */
        const sectionResults = await mapWithConcurrency(
          plan.packs,
          this.config.limits.maxInFlightRequests ?? 3,
          async (pack, sectionIndex): Promise<IngestSectionResult> => {
            const cacheName = extractionCacheName({
              sourceHash,
              packIndex: sectionIndex,
              packHash: hashText(pack.text),
              model: modelId,
              promptVersion: EXTRACTION_PROMPT_VERSION,
              schemaVersion: EXTRACTION_SCHEMA_VERSION,
            });
            const cached = await cache.read<unknown>(cacheName);
            if (cached) {
              const parsed = sourceExtractionSchema.safeParse(cached);
              if (parsed.success) {
                const extraction = {
                  ...parsed.data,
                  facts: parsed.data.facts.map((fact) => ({
                    ...fact,
                    citation: source.archiveCitationPath,
                  })),
                };
                await this.logger.info('ingest:extract', {
                  source: source.relativePath,
                  pack: `${sectionIndex + 1}/${plan.packs.length}`,
                  cached: true,
                  subjects: extraction.subjects.length,
                  facts: extraction.facts.length,
                });
                if (extraction._dangling && (extraction._dangling.orphanedRelations > 0 || extraction._dangling.orphanedFacts > 0)) {
                  await this.logger.warn('ingest:extract-dangling', {
                    source: source.relativePath,
                    cached: true,
                    ...extraction._dangling,
                    advice: 'References (relations, fact subjects) to undeclared identifiers were discarded without rejecting the source.',
                  });
                }
                return { extraction };
              }
            }

            const prompt = buildExtractionPrompt({
              source,
              body: pack.text,
              headingPath: pack.headingPath,
              packIndex: sectionIndex,
              packTotal: plan.packs.length,
              ctx: buildPromptContext(this.config, { profileSection }),
            });
            await this.logger.info('ingest:prompt', {
              source: source.relativePath,
              phase: 'extract',
              promptChars: prompt.system.length + prompt.user.length,
              pack: `${sectionIndex + 1}/${plan.packs.length}`,
            });

            const progress = { sectionIndex, sectionTotal: plan.packs.length };
            options?.onSourceLlm?.(sourcePath, i, sourcePaths.length, progress);
            /*
             A failing batch is retried alone.

             `mapWithConcurrency` isolates the batches, and the cache keeps the
             ones that succeeded: a resume never repays an already-valid call.
            */
            const { value: extraction, retry } = await withRetry(
              () =>
                this.llm.completeJson(
                  {
                    ...prompt,
                    label: 'ingest_extract',
                    logger: this.logger,
                    traceData: { source: source.relativePath },
                    onUsage: (usage) => {
                      options?.onSourceUsage?.(sourcePath, i, sourcePaths.length, usage, progress);
                    },
                  },
                  sourceExtractionSchema,
                ),
              {
                onRetry: async (retryInfo) => {
                  await this.logger.warn('ingest:retry', {
                    source: source.relativePath,
                    phase: 'extract',
                    attempts: retryInfo.attempts,
                    retries: retryInfo.retries,
                    classification: retryInfo.classification,
                    nextDelayMs: retryInfo.nextDelayMs,
                    message: retryInfo.message,
                    pack: `${sectionIndex + 1}/${plan.packs.length}`,
                  });
                },
              },
            );

            const canonicalExtraction: SourceExtraction = {
              ...extraction,
              facts: extraction.facts.map((fact) => ({
                ...fact,
                citation: source.archiveCitationPath,
              })),
            };

            await cache.write(cacheName, canonicalExtraction);
            await this.logger.info('ingest:extract', {
              source: source.relativePath,
              pack: `${sectionIndex + 1}/${plan.packs.length}`,
              cached: false,
              subjects: canonicalExtraction.subjects.length,
              facts: canonicalExtraction.facts.length,
            });
            if (canonicalExtraction._dangling && (canonicalExtraction._dangling.orphanedRelations > 0 || canonicalExtraction._dangling.orphanedFacts > 0)) {
              await this.logger.warn('ingest:extract-dangling', {
                source: source.relativePath,
                pack: `${sectionIndex + 1}/${plan.packs.length}`,
                ...canonicalExtraction._dangling,
                advice: 'References (relations, fact subjects) to undeclared identifiers were discarded without rejecting the source.',
              });
            }
            return { extraction: canonicalExtraction, ...(retry.retries > 0 && { retry }) };
          },
        );

        /*
         Phase 2 — one consolidation, which sees the whole source.

         The completion order of the extractions must not change the result:
         `mapWithConcurrency` returns results in batch order, and the merge
         prefixes identifiers by their index. Two different concurrent runs
         therefore produce the same prompt.
        */
        const merged = mergeExtractions(sectionResults.map((result) => result.extraction));
        const collection = collectionFromSourcePath(source.relativePath);
        const warmPages = await this.retrieval.warmCache();
        const existingSourceNote = warmPages.find(
          (page) => page.relativePath === sourcePagePath,
        )?.content ?? null;

        // Concept pages this source produced in a previous ingest, with their
        // current provenance. They are the stable reference for re-anchoring.
        const sourceId = sourceIdFromArchivePath(source.archiveCitationPath);
        const previousRecord = (previousRegistry?.sources ?? []).find((record) => record.sourceId === sourceId);
        const previousConcepts = (previousRecord?.producedPages ?? [])
          .filter((page) => page.startsWith(CONCEPT_PREFIX))
          .map((page) => {
            const content = warmPages.find((entry) => entry.relativePath === page)?.content ?? null;
            const provenance = content ? readProvenance(content) : null;
            return { path: page, subject: provenance?.subject ?? null, class: provenance?.class ?? null, content };
          });

        const contextStartedAt = Date.now();
        const relevantPages = await this.retrieval.search(
          [source.title, ...merged.subjects.map((subject) => subject.label)].join(' '),
          { limit: this.config.retrieval.maxContextFiles, includeRaw: false },
        );
        await this.logger.info('ingest:context', {
          source: source.relativePath,
          pagesFound: relevantPages.length,
          durationMs: Date.now() - contextStartedAt,
        });

        const inventory = relevantPages.map((result) => {
          const provenance = readProvenance(result.page.content);
          return {
            path: result.page.relativePath,
            title: result.page.name,
            subject: provenance.subject,
            scope: provenance.scope,
            class: provenance.class,
            excerpt: (result.chunk?.content ?? result.page.content)
              .replace(/\s+/g, ' ')
              .slice(0, maxChunkChars),
          };
        });

        // Surface the previous concepts to the model as pages to REUSE, not
        // just as retrieval hits — the retrieval top-N does not reliably bring
        // them back, which is exactly why the model re-created them.
        const previousInventory = previousConcepts
          .filter((concept) => !inventory.some((page) => page.path === concept.path))
          .map((concept) => {
            const page = warmPages.find((entry) => entry.relativePath === concept.path);
            const provenance = page ? readProvenance(page.content) : null;
            return {
              path: concept.path,
              title: page?.name ?? concept.path.split('/').pop() ?? concept.path,
              subject: provenance?.subject ?? concept.subject ?? null,
              scope: provenance?.scope ?? null,
              class: provenance?.class ?? null,
              excerpt: (page?.content ?? '').replace(/\s+/g, ' ').slice(0, maxChunkChars),
              previousForSource: true,
            };
          });
        // Existing concept pages whose subject plausibly matches a candidate
        // subject from THIS extraction, regardless of which source produced
        // them. `inventory` above (retrieval relevance) does not reliably
        // surface a same-subject page when the wording differs across
        // sources — this is the concept-homonym gap: "<product> certifications"
        // and "<product> solution" each ingested separately, neither seeing the
        // other's "<product>" page in its top-N, each inventing its own
        // near-duplicate. `previousInventory` only covers this source's OWN
        // prior pages, not ones another source already created for the same
        // subject.
        const candidateRoots = merged.subjects
          .map((subject) => normalizeProvenanceValue(subject.label))
          .filter(Boolean);
        const alreadyListed = new Set([...inventory, ...previousInventory].map((page) => page.path));
        const MAX_SUBJECT_MATCHES = 5;
        const subjectMatchInventory = candidateRoots.length
          ? warmPages
              .filter((page) => page.relativePath.startsWith(CONCEPT_PREFIX) && !alreadyListed.has(page.relativePath))
              .map((page) => ({ page, provenance: readProvenance(page.content) }))
              .filter(({ provenance }) => provenance.subject != null
                && candidateRoots.some((root) => subjectsAreRelated(root, provenance.subject as string)))
              .slice(0, MAX_SUBJECT_MATCHES)
              .map(({ page, provenance }) => ({
                path: page.relativePath,
                title: page.name,
                subject: provenance.subject,
                scope: provenance.scope,
                class: provenance.class,
                excerpt: page.content.replace(/\s+/g, ' ').slice(0, maxChunkChars),
                subjectMatch: true,
              }))
          : [];
        const fullInventory = [...inventory, ...previousInventory, ...subjectMatchInventory];

        const indexContent = await this.workspace.readIndex();
        const consolidationPrompt = buildConsolidationPrompt({
          source,
          extraction: merged,
          sourcePagePath,
          existingSourceNote,
          inventory: fullInventory,
          indexContent,
          collection,
          ...(grid ? { grid } : {}),
          ctx: buildPromptContext(this.config, { profileSection }),
        });
        const consolidationCacheKey = consolidationCacheName({
          sourceHash,
          extractionsHash: hashText(JSON.stringify(merged)),
          // The grid is part of the prompt, so it is part of the cache key:
          // re-filing the same source against a different closed set must not
          // replay the answer given for the previous one.
          inventoryHash: hashText(JSON.stringify([
            fullInventory, indexContent, existingSourceNote, grid?.classes ?? null,
          ])),
          model: modelId,
          promptVersion: CONSOLIDATION_PROMPT_VERSION,
          schemaVersion: CONSOLIDATION_SCHEMA_VERSION,
        });
        await this.logger.info('ingest:prompt', {
          source: source.relativePath,
          phase: 'consolidate',
          promptChars: consolidationPrompt.system.length + consolidationPrompt.user.length,
          subjects: merged.subjects.length,
          facts: merged.facts.length,
          inventory: fullInventory.length,
        });

        let consolidated: ConsolidationPlan | null = null;
        const cachedPlan = await cache.read<unknown>(consolidationCacheKey);
        if (cachedPlan) {
          const parsed = consolidationPlanSchema.safeParse(cachedPlan);
          if (parsed.success) consolidated = parsed.data;
        }
        if (!consolidated) {
          const { value, retry } = await withRetry(
            () =>
              this.llm.completeJson(
                {
                  ...consolidationPrompt,
                  label: 'ingest_consolidate',
                  logger: this.logger,
                  traceData: { source: source.relativePath },
                  onUsage: (usage) => {
                    options?.onSourceUsage?.(sourcePath, i, sourcePaths.length, usage);
                  },
                },
                consolidationPlanSchema,
              ),
            {
              onRetry: async (retryInfo) => {
                await this.logger.warn('ingest:retry', {
                  source: source.relativePath,
                  phase: 'consolidate',
                  attempts: retryInfo.attempts,
                  retries: retryInfo.retries,
                  classification: retryInfo.classification,
                  nextDelayMs: retryInfo.nextDelayMs,
                  message: retryInfo.message,
                });
              },
            },
          );
          consolidated = value;
          if (retry.retries > 0) sourceRetry = retry;
          await cache.write(consolidationCacheKey, value);
        }

        // Deterministic re-anchor against the previous run's concept pages:
        // a create whose normalized subject already exists is an update.
        consolidated = reanchorToPreviousConcepts(consolidated, previousConcepts);

        /*
         Granularity-fix retry.

         The consolidation is one stateless call per source. Two failures of
         granularity survive the prompt wording reliably enough to warrant a
         re-ask: a product split into several concept pages (a product and its
         national arm, a product and its modules), and a source that
         creates more concepts than its budget. The engine detects both, re-asks
         with the exact subjects to merge, bounded. The cached plan is never
         written here: a plan that needed correction must not be re-served
         verbatim on a resume.
         */
        // Reused below (validateConsolidation's existingPaths): warmPages is
        // not mutated between the two uses, so one Set covers both.
        const knownPaths = new Set(warmPages.map((page) => page.relativePath));
        // The correction asks the model to merge concepts, but a retry must not
        // lose the source note: a plan without one is rejected outright, and the
        // model, once focused on merging, drops it. Capture it once from the
        // pre-retry plan and re-inject it into any correction that omits it.
        const sourceNoteOperations = consolidated.operations.filter(
          (operation) => operation.path === sourcePagePath && operation.type !== 'delete',
        );
        const sourceNotePages = (consolidated.pages ?? []).filter(
          (page) => page.path === sourcePagePath,
        );
        // Threaded into validateConsolidation below so it does not repeat this
        // same O(n²) subject scan on data the loop already checked clean.
        // The extra `<= MAX_SPLIT_RETRIES` pass (which never corrects, only
        // checks) guarantees `lastSplits` is always computed against the
        // FINAL `consolidated` — without it, exhausting the retries would
        // leave `lastSplits` one correction stale relative to the plan
        // `validateConsolidation` actually receives.
        let lastSplits: ReturnType<typeof detectConceptSplits> = [];
        for (let retryAttempt = 0; retryAttempt <= MAX_SPLIT_RETRIES; retryAttempt += 1) {
          const splits = detectConceptSplits(consolidated);
          lastSplits = splits;
          const overflow = detectConceptOverflow(
            consolidated,
            knownPaths,
            DEFAULT_CONCEPT_BUDGET,
          );
          const duplicatePaths = detectDuplicatePaths(consolidated);
          if (splits.length === 0 && !overflow && duplicatePaths.length === 0) break;
          if (retryAttempt === MAX_SPLIT_RETRIES) break;
          await this.logger.warn('ingest:consolidate-retry', {
            source: source.relativePath,
            attempt: retryAttempt + 1,
            splits: splits.map((split) => `${split.subject}~${split.duplicateOfSubject}`),
            overflow: overflow ? { newConcepts: overflow.newConcepts, budget: overflow.budget } : null,
            duplicatePaths,
          });
          const retryPrompt = {
            ...consolidationPrompt,
            user: buildConsolidationRetryUser(consolidationPrompt.user, {
              splits,
              overflow: overflow ? { newConcepts: overflow.newConcepts, budget: overflow.budget } : undefined,
              duplicatePaths,
            }),
          };
          const { value } = await withRetry(
            () =>
              this.llm.completeJson(
                {
                  ...retryPrompt,
                  label: 'ingest_consolidate_retry',
                  logger: this.logger,
                  traceData: { source: source.relativePath },
                  onUsage: (usage) => {
                    options?.onSourceUsage?.(sourcePath, i, sourcePaths.length, usage);
                  },
                },
                consolidationPlanSchema,
              ),
            {
              onRetry: async (retryInfo) => {
                await this.logger.warn('ingest:retry', {
                  source: source.relativePath,
                  phase: 'consolidate-retry',
                  attempts: retryInfo.attempts,
                  retries: retryInfo.retries,
                  classification: retryInfo.classification,
                  nextDelayMs: retryInfo.nextDelayMs,
                  message: retryInfo.message,
                });
              },
            },
          );
          let corrected = reanchorToPreviousConcepts(value, previousConcepts);
          // Re-inject the source note if the merge dropped it: the correction is
          // about concepts, the note is invariant.
          const hasSourceNote = corrected.operations.some(
            (operation) => operation.path === sourcePagePath && operation.type !== 'delete',
          );
          if (!hasSourceNote && sourceNoteOperations.length) {
            corrected = {
              ...corrected,
              operations: [...sourceNoteOperations, ...corrected.operations],
              pages: [...sourceNotePages, ...(corrected.pages ?? [])],
            };
          }
          consolidated = corrected;
        }

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
        // `lastSplits` was computed against pre-normalization paths; remap
        // them the same way normalizedPages was, so a warning reported below
        // names the actual page path, not the model's pre-normalized one.
        const normalizedSplits = lastSplits.map((split) => ({
          ...split,
          path: normalizedPathByOriginal.get(split.path) ?? split.path,
          duplicateOfPath: normalizedPathByOriginal.get(split.duplicateOfPath) ?? split.duplicateOfPath,
        }));
        const {
          operations: citationSafeOperations,
          rewrittenCitations,
          unreconciledCitations,
          wrappedBarePaths,
        } = enforceSourceCitationPath(normalizedOperations, source.archiveCitationPath);
        await this.logger.info('ingest:normalize', {
          source: source.relativePath,
          operations: citationSafeOperations.length,
          rewrittenCitations,
          unreconciledCitations,
          wrappedBarePaths,
        });
        if (rewrittenCitations > 0) {
          await this.logger.info('ingest:citation-path-rewrite', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            rewrittenCitations,
          });
        }
        if (unreconciledCitations > 0) {
          await this.logger.warn('ingest:citation-unreconciled', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            unreconciledCitations,
          });
        }
        if (wrappedBarePaths > 0) {
          // The model named its source as bare text instead of a citation —
          // invisible to the link renderer until wrapped. Not an error (the
          // content is still correct and now linkable), but worth surfacing:
          // a model that keeps doing this despite the prompt instruction is
          // a signal the instruction itself may need to be strengthened.
          await this.logger.info('ingest:citation-bare-path-wrapped', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            wrappedBarePaths,
          });
        }

        const validation = validateConsolidation(
          { ...consolidated, operations: citationSafeOperations, pages: normalizedPages },
          {
            sourcePagePath,
            citationPath: source.archiveCitationPath,
            existingPaths: knownPaths,
            collection,
            precomputedSplits: normalizedSplits,
            grid,
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
        sourceRetry = sourceRetry ?? sectionResults.findLast((result) => result.retry)?.retry;

        const existingPages = new Map(
          (await this.retrieval.warmCache()).map((page) => [page.relativePath, page]),
        );
        const review = buildReviewOperations({
          operations: allOperations,
          existingPages,
          source: source.relativePath,
          archivePath: source.archiveCitationPath,
          rejectedPaths,
          applied: !options?.dryRun,
        });
        const applyOperations = allOperations.filter(
          (operation) => !rejectedPaths.has(operation.path),
        );
        const rejectedCount = allOperations.length - applyOperations.length;
        if (rejectedCount > 0) {
          await this.logger.info('ingest:review-reject', {
            source: source.relativePath,
            rejected: rejectedCount,
            paths: allOperations
              .filter((operation) => rejectedPaths.has(operation.path))
              .map((operation) => operation.path),
          });
        }
        await this.logger.info('ingest:review', {
          source: source.relativePath,
          operations: allOperations.length,
          rejected: rejectedCount,
          dryRun: Boolean(options?.dryRun),
        });

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
          await this.workspace.applyNormalizedWikiOperations(applyOperations);
          this.retrieval.invalidateCache();
          await this.logger.info('ingest:apply', {
            source: source.relativePath,
            durationMs: Date.now() - applyStartedAt,
            create: operationCounts.create,
            update: operationCounts.update,
            delete: operationCounts.delete,
            atomic: true,
            sections: sections.length,
          });

          const archiveStartedAt = Date.now();
          await this.workspace.archiveSource(source);
          await this.logger.info('ingest:archive', {
            source: source.relativePath,
            archivePath: source.archiveCitationPath,
            durationMs: Date.now() - archiveStartedAt,
          });

          await this.workspace.appendLog(
            'ingest',
            `${source.relativePath} -> ${source.archiveCitationPath} (${lastSummary})`,
          );
          await this.observeSource(source, applyOperations);
          /*
           The visible commit unit is a source applied successfully.

           Publishing once at the end of the command would leave a long
           multi-source ingest silent from start to finish; publishing on every
           written file would make one render per page. The coherent source is
           the grain that matches what a reader perceives as "something
           happened", and Serve coalesces nearby markers.
          */
          // Index first: wiki/index.md is itself part of the knowledge corpus
          // the fingerprint below covers, so publishing before regenerating it
          // would freeze a corpus the index rewrite immediately invalidates
          // again — the same stale-marker trap fixed in reclassify-concepts.
          await this.regenerateIndex(source.relativePath);
          await this.publishGraphRevision(source.relativePath);
        }

        results.push({
          source: source.relativePath,
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
      }
    }

    const successfulResults = results.filter((result) => !result.failed);
    const failedResults = results.filter((result) => result.failed);
    const shouldRefresh = options?.refresh === true || this.config.build.refreshOnIngest;
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

    await this.logger.info('ingest:run-done', {
      sourceCount: results.length,
      failed: failedResults.length,
      durationMs: Date.now() - runStartedAt,
      status: failedResults.length > 0 ? 'partial_failure' : 'success',
    });

    return results;
  }

  async applyPlannedIngest(
    planFiles: string[],
    options?: Pick<IngestCommandOptions, 'reject' | 'refresh'>,
  ): Promise<IngestResult[]> {
    const runStartedAt = Date.now();
    await this.workspace.ensureInitialized();
    await this.logger.info('ingest:run-start', {
      inputCount: planFiles.length,
      apply: true,
      refreshEnabled: options?.refresh === true,
    });

    const rejectedPaths = new Set(options?.reject ?? []);
    const plannedSources: PlannedIngestSource[] = [];
    for (const planFile of planFiles) {
      const absolutePath = this.resolveWorkspacePath(planFile, 'ingest plan file');
      const raw = await readFile(absolutePath, 'utf8');
      const parsed = JSON.parse(raw) as PlannedIngestFile | PlannedIngestSource[];
      if (!Array.isArray(parsed)
        && parsed.schemaVersion !== undefined
        && parsed.schemaVersion !== INGEST_PLAN_FILE_VERSION) {
        throw new Error(
          `Unsupported ingest plan version ${parsed.schemaVersion}; expected ${INGEST_PLAN_FILE_VERSION}.`,
        );
      }
      const sources = Array.isArray(parsed) ? parsed : parsed.sources;
      if (!Array.isArray(sources)) {
        throw new Error(`Invalid ingest plan file: ${planFile}`);
      }
      plannedSources.push(...sources);
    }

    await this.logger.info('ingest:source-selection', {
      resolvedCount: plannedSources.length,
    });

    const results: IngestResult[] = [];
    for (let i = 0; i < plannedSources.length; i++) {
      const planned = plannedSources[i];
      const sourceStartedAt = Date.now();
      await this.logger.info('ingest:source-start', {
        sourcePath: planned.source,
      });
      try {
        if (planned.skipped) {
          await this.archivePlannedSource(planned);
          results.push({
            source: planned.source,
            plan: { summary: planned.summary ?? 'unchanged since last ingest', operations: [] },
            skipped: true,
          });
          await this.logger.info('ingest:source-done', {
            source: planned.source,
            durationMs: Date.now() - sourceStartedAt,
            status: 'skipped',
          });
          continue;
        }

        const operations = await this.workspace.normalizeWikiOperations(
          planned.operations ?? [],
        );
        const applyOperations = operations.filter(
          (operation) => !rejectedPaths.has(operation.path),
        );
        const rejectedCount = operations.length - applyOperations.length;
        await this.logger.info('ingest:review', {
          source: planned.source,
          operations: operations.length,
          rejected: rejectedCount,
          apply: true,
        });

        if (operations.length > 0 && applyOperations.length === 0) {
          await this.logger.info('ingest:apply-skip', {
            source: planned.source,
            reason: 'all operations rejected',
          });
        } else {
          const operationCounts = applyOperations.reduce(
            (counts, operation) => {
              counts[operation.type] += 1;
              return counts;
            },
            { create: 0, update: 0, delete: 0 },
          );
          const applyStartedAt = Date.now();
          await this.workspace.applyNormalizedWikiOperations(applyOperations);
          this.retrieval.invalidateCache();
          await this.logger.info('ingest:apply', {
            source: planned.source,
            durationMs: Date.now() - applyStartedAt,
            create: operationCounts.create,
            update: operationCounts.update,
            delete: operationCounts.delete,
            atomic: true,
          });
        }

        await this.archivePlannedSource(planned);
        await this.workspace.appendLog(
          'ingest',
          `${planned.source} (${planned.summary ?? 'planned ingest applied'})`,
        );
        results.push({
          source: planned.source,
          plan: { summary: planned.summary ?? '', operations: applyOperations },
          review: planned.review,
        });
        await this.logger.info('ingest:source-done', {
          source: planned.source,
          durationMs: Date.now() - sourceStartedAt,
          status: 'success',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.logger.error('ingest:source-failed', {
          sourcePath: planned.source,
          durationMs: Date.now() - sourceStartedAt,
          message,
        });
        results.push({
          source: planned.source,
          failed: true,
          error: message,
        });
      }
    }

    const successfulResults = results.filter((result) => !result.failed);
    const failedResults = results.filter((result) => result.failed);
    const shouldRefresh = options?.refresh === true || this.config.build.refreshOnIngest;
    if (successfulResults.length > 0 && shouldRefresh) {
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

    await this.logger.info('ingest:run-done', {
      sourceCount: results.length,
      failed: failedResults.length,
      durationMs: Date.now() - runStartedAt,
      status: failedResults.length > 0 ? 'partial_failure' : 'success',
    });
    return results;
  }

  /**
   * Records a source in the provenance registry
   * (`docs/content-lifecycle.md` § 5).
   *
   * **Must not fail an ingestion.** The registry is an observation: it makes
   * the lifecycle visible, it is not part of it. A write error is logged and
   * the ingestion continues — the opposite would lose already-paid LLM work
   * for a side file.
   *
   * @param operations operations applied, or `null` for a source seen without
   *   being re-ingested (`unchanged since last ingest`).
   */
  /**
   * Makes what has just been written visible to the graph.
   *
   * Same discipline as `observeSource`: it is an observation of the lifecycle,
   * not a step of it. An unallocated revision is a display problem, and making
   * it fail would take down already-paid ingestion work. `publishCorpusRevision`
   * never throws and falls back to `dirty.json`, which Serve will pick up.
   */
  private async publishGraphRevision(sourceLabel: string): Promise<void> {
    const outcome = await publishCorpusRevision(this.workspace.paths.rootDir);
    if (outcome.status === 'published') {
      await this.logger.info('ingest:graph-revision', {
        source: sourceLabel,
        revision: outcome.revision,
      });
      return;
    }
    await this.logger.warn('ingest:graph-revision-deferred', { source: sourceLabel });
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
      return;
    }
    await this.logger.warn('ingest:index-regeneration-failed', {
      source: sourceLabel,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
  }

  private async observeSource(
    source: SourceDocument,
    operations: WikiOperation[] | null,
  ): Promise<void> {
    try {
      const registryPath = path.join(this.workspace.paths.internalDir, SOURCE_REGISTRY_FILENAME);
      const lockPath = `${registryPath}.lock`;
      // Ingest processes can run concurrently against the same workspace
      // (`wiki ingest --plan-only`/`--apply` orchestration): the lock makes
      // the read-modify-write cycle across processes atomic, not just each
      // write.
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

  private async archivePlannedSource(planned: PlannedIngestSource): Promise<void> {
    const sourcePath = this.resolveWorkspacePath(planned.source, 'ingest source');
    const source = await this.workspace.readSourceDocument(sourcePath);
    const archiveStartedAt = Date.now();
    await this.workspace.archiveSource(source);
    await this.logger.info('ingest:archive', {
      source: source.relativePath,
      archivePath: source.archiveCitationPath,
      durationMs: Date.now() - archiveStartedAt,
    });
  }

  private resolveWorkspacePath(value: string, label: string): string {
    const absolutePath = path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(this.workspace.paths.rootDir, value);
    const relativePath = path.relative(this.workspace.paths.rootDir, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Invalid ${label}: path must stay inside the workspace.`);
    }
    return absolutePath;
  }
}
