import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildConsolidationPrompt, CONSOLIDATION_PROMPT_VERSION } from '../prompts/consolidationPrompt.ts';
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
import { collectionFromSourcePath, readProvenance } from '../ingest/provenance.ts';
import { validateConsolidation } from '../ingest/validateConsolidation.ts';
import { hashText } from '../utils/hash.ts';
import { normalizeSourceBody } from '../utils/markdown.ts';
import { planSourcePacks } from '../utils/sourcePacking.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { withFileLock } from '../utils/fs.ts';
import { publishCorpusRevision } from '../graph/wiki/taxonomy/publish.ts';
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

function enforceSourceCitationPath(
  operations: WikiOperation[],
  archiveCitationPath: string,
): {
  operations: WikiOperation[];
  rewrittenCitations: number;
  unreconciledCitations: number;
} {
  let rewrittenCitations = 0;
  let unreconciledCitations = 0;
  const operationsWithCitations = operations.map((operation) => {
    if (operation.content === undefined) return operation;
    let validCitationMarkers = 0;

    const content = operation.content.replace(
      /\[src:\s*([^\]]+)\]/gi,
      (match, citationPath: string) => {
        validCitationMarkers += 1;
        const cleanCitationPath = citationPath.trim();
        if (!cleanCitationPath) {
          unreconciledCitations += 1;
          return match;
        }
        if (cleanCitationPath === archiveCitationPath) return match;
        rewrittenCitations += 1;
        return `[src: ${archiveCitationPath}]`;
      },
    );
    const sourceMarkers = operation.content.match(/\[src:/gi)?.length ?? 0;
    unreconciledCitations += Math.max(0, sourceMarkers - validCitationMarkers);

    return content === operation.content ? operation : { ...operation, content };
  });

  return {
    operations: operationsWithCitations,
    rewrittenCitations,
    unreconciledCitations,
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
     Cache de reprise, injectable.

     Injecté plutôt que construit en dur pour qu'un appelant sans disque — un
     test unitaire, un dry-run éphémère — puisse le désactiver. Le défaut reste
     le comportement du produit : reprendre sans repayer.
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

    const selectionStartedAt = Date.now();
    const sourcePaths = await this.workspace.resolveSourceInputs(inputs);
    await this.logger.info('ingest:source-selection', {
      resolvedCount: sourcePaths.length,
      durationMs: Date.now() - selectionStartedAt,
    });

    const results: IngestResult[] = [];
    const rejectedPaths = new Set(options?.reject ?? []);
    /*
     Cache de reprise, partagé par toutes les sources du lot.

     Il n'est jamais présenté comme un plan approuvable : seul le plan consolidé
     final passe en revue. Son rôle est qu'une coupure ne repaie pas des appels
     dont la réponse était valide.
    */
    const cache = this.injectedCache
      ?? new IngestCache(this.workspace.paths.rootDir, options?.dryRun !== true);
    if (!options?.dryRun) await cache.collect().catch(() => 0);

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
              // Une source inchangée reste une source VUE : sans cette ligne,
              // elle basculerait `missing` au premier inventaire alors qu'elle
              // vient d'être présentée.
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
         Un seul planificateur, pour l'ingestion comme pour `wiki doctor`.

         Le découpage précédent coupait à chaque titre sans jamais
         ré-empaqueter : le nombre d'appels LLM dépendait de la mise en forme du
         document, pas de son volume. Deux documents frères recevaient un nombre
         très différent de décisions, et l'écart de concepts qui en résultait se
         lisait ensuite comme une différence de richesse.
        */
        const plan = planSourcePacks(rawBody, { maxChars: maxSourceChars });
        const sections = plan.packs.map((pack) => pack.text);

        // Journalisé pour TOUTE source, même non découpée : c'est la mesure qui
        // permet d'expliquer après coup pourquoi une source a coûté N appels.
        await this.logger.info('ingest:pack', {
          source: source.relativePath,
          ...plan.diagnostics,
        });

        const sourcePagePath = path.posix.join('wiki', 'sources', `${source.slug}.md`);
        /*
         L'identité de la source entre dans la clé de cache, pas seulement son
         contenu.

         Deux documents distincts peuvent avoir un corps identique — un modèle de
         fiche rempli deux fois, un export dupliqué. Sans le chemin de citation
         dans la clé, le plan consolidé de l'un serait resservi à l'autre, avec
         ses citations et sa note de source : une page attribuée au mauvais
         document, et rien pour le signaler.
        */
        const sourceHash = hashText(`${source.archiveCitationPath}\u0000${rawBody}`);
        const modelId = this.config.llm.model;

        /*
         Phase 1 — N extractions concurrentes, aucune écriture.

         Chaque lot rapporte des faits et des sujets candidats avec des
         identifiants locaux. Aucun ne peut créer, mettre à jour ni supprimer
         quoi que ce soit : c'est ce qui rend impossible le défaut d'origine, où
         deux fragments écrivaient deux pages du même concept sans se voir.
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
             Un lot qui échoue est retenté seul.

             `mapWithConcurrency` isole les lots, et le cache conserve ceux qui
             ont abouti : une reprise ne repaie jamais un appel déjà valide.
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
            return { extraction: canonicalExtraction, ...(retry.retries > 0 && { retry }) };
          },
        );

        /*
         Phase 2 — une consolidation, qui voit toute la source.

         L'ordre de terminaison des extractions ne doit pas changer le résultat :
         `mapWithConcurrency` rend les résultats dans l'ordre des lots, et la
         fusion préfixe les identifiants par leur index. Deux exécutions
         concurrentes différentes produisent donc le même prompt.
        */
        const merged = mergeExtractions(sectionResults.map((result) => result.extraction));
        const collection = collectionFromSourcePath(source.relativePath);
        const warmPages = await this.retrieval.warmCache();
        const existingSourceNote = warmPages.find(
          (page) => page.relativePath === sourcePagePath,
        )?.content ?? null;

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
            excerpt: (result.chunk?.content ?? result.page.content)
              .replace(/\s+/g, ' ')
              .slice(0, maxChunkChars),
          };
        });

        const indexContent = await this.workspace.readIndex();
        const consolidationPrompt = buildConsolidationPrompt({
          source,
          extraction: merged,
          sourcePagePath,
          existingSourceNote,
          inventory,
          indexContent,
          collection,
          ctx: buildPromptContext(this.config, { profileSection }),
        });
        const consolidationCacheKey = consolidationCacheName({
          sourceHash,
          extractionsHash: hashText(JSON.stringify(merged)),
          inventoryHash: hashText(JSON.stringify([inventory, indexContent, existingSourceNote])),
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
          inventory: inventory.length,
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

        /*
         Normaliser d'ABORD, valider ensuite.

         `normalizeWikiOperations` canonise les chemins que le modèle a écrits —
         accents, espaces, casse. Valider avant elle reviendrait à comparer la
         note de source attendue à un chemin que le moteur s'apprête justement à
         corriger, et à rejeter un plan parfaitement applicable.
        */
        const normalizedOperations = await this.workspace.normalizeWikiOperations(
          consolidated.operations,
        );
        // `pages[].path` désigne les mêmes opérations, mais vivait jusque-là
        // avant la canonisation des chemins. Un modèle proposant un accent ou
        // une espace recevait donc une opération normalisée et perdait sa
        // provenance au moment de la jointure. La correspondance par position
        // est stable : normalizeWikiOperations conserve ordre et cardinalité.
        const normalizedPathByOriginal = new Map<string, string>();
        consolidated.operations.forEach((operation, index) => {
          const normalized = normalizedOperations[index];
          if (normalized) normalizedPathByOriginal.set(operation.path, normalized.path);
        });
        const normalizedPages = (consolidated.pages ?? []).map((page) => ({
          ...page,
          path: normalizedPathByOriginal.get(page.path) ?? page.path,
        }));
        const {
          operations: citationSafeOperations,
          rewrittenCitations,
          unreconciledCitations,
        } = enforceSourceCitationPath(normalizedOperations, source.archiveCitationPath);
        await this.logger.info('ingest:normalize', {
          source: source.relativePath,
          operations: citationSafeOperations.length,
          rewrittenCitations,
          unreconciledCitations,
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

        const knownPaths = new Set(warmPages.map((page) => page.relativePath));
        const validation = validateConsolidation(
          { ...consolidated, operations: citationSafeOperations, pages: normalizedPages },
          {
            sourcePagePath,
            citationPath: source.archiveCitationPath,
            existingPaths: knownPaths,
            collection,
          },
        );
        await this.logger.info('ingest:consolidate', {
          source: source.relativePath,
          operations: validation.operations.length,
          errors: validation.errors.length,
          warnings: validation.warnings.length,
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
           Un plan structurellement invalide n'est pas appliqué à moitié.

           Le rejeter entier laisse la source en attente et le cache
           d'extraction intact : la reprise ne repaiera que la consolidation.
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


        // Un seul plan, celui de la consolidation. Le `flatMap` d'avant
        // concaténait les décisions de chaque fragment sans les confronter.
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
           L'unité de commit visible est une source appliquée avec succès.

           Publier une fois en fin de commande laisserait un long ingest
           multi-source muet du début à la fin ; publier à chaque fichier écrit
           ferait un rendu par page. La source cohérente est le grain qui
           correspond à ce qu'un lecteur perçoit comme « quelque chose est
           arrivé », et Serve coalesce les marqueurs rapprochés.
          */
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
   * Consigne une source dans le registre de provenance
   * (`docs/content-lifecycle.md` § 5).
   *
   * **Ne peut pas faire échouer une ingestion.** Le registre est une
   * observation : il rend le cycle de vie visible, il n'en fait pas partie.
   * Une erreur d'écriture est journalisée et l'ingestion continue — l'inverse
   * ferait perdre un travail LLM déjà payé pour un fichier annexe.
   *
   * @param operations opérations appliquées, ou `null` pour une source vue
   *   sans être réingérée (`unchanged since last ingest`).
   */
  /**
   * Rend visible au graphe ce qui vient d'être écrit.
   *
   * Même discipline qu'`observeSource` : c'est une observation du cycle de vie,
   * pas une étape de celui-ci. Une révision non allouée est un problème
   * d'affichage, et la faire échouer emporterait un travail d'ingestion déjà
   * payé. `publishCorpusRevision` ne lève jamais et bascule sur `dirty.json`,
   * que Serve reprendra.
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

  private async observeSource(
    source: SourceDocument,
    operations: WikiOperation[] | null,
  ): Promise<void> {
    try {
      const registryPath = path.join(this.workspace.paths.internalDir, 'source-registry.json');
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
          // Ce qui a été APPLIQUÉ, pas ce que le modèle a proposé. Une
          // suppression ne produit pas de page.
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
