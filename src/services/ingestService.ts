import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ingestPlanSchema } from '../config/schema.ts';
import { buildIngestPrompt } from '../prompts/ingestPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { hashText } from '../utils/hash.ts';
import { normalizeSourceBody, splitSourceSections } from '../utils/markdown.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import type { TokenUsage } from './llmService.ts';
import type {
  AppConfig,
  IngestCommandOptions,
  IngestResult,
  IngestRetryInfo,
  IngestReviewOperation,
  WikiOperation,
  WikiPage,
} from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RefreshService } from './refreshService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

interface IngestSectionResult {
  operations: WikiOperation[];
  summary: string;
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
  generatedAt?: string;
  sources?: PlannedIngestSource[];
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

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
    refresh: RefreshService,
    logger: TraceLogger,
  ) {
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
        const sections =
          rawBody.length > maxSourceChars
            ? splitSourceSections(rawBody, maxSourceChars)
            : [rawBody];

        if (sections.length > 1) {
          await this.logger.info('ingest:split', {
            source: source.relativePath,
            sections: sections.length,
            originalChars: rawBody.length,
            maxSourceChars,
          });
        }

        const sourcePagePath = path.posix.join('wiki', 'sources', `${source.slug}.md`);
        const sectionResults = await mapWithConcurrency(
          sections,
          this.config.limits.maxInFlightRequests ?? 3,
          async (body, sectionIndex): Promise<IngestSectionResult> => {
            const sectionLabel =
              sections.length > 1
                ? ` (section ${sectionIndex + 1}/${sections.length})`
                : '';

            const contextStartedAt = Date.now();
            const relevantPages = await this.retrieval.search(body || source.title, {
              limit: this.config.retrieval.maxContextFiles,
              includeRaw: false,
            });
            await this.logger.info('ingest:context', {
              source: source.relativePath,
              pagesFound: relevantPages.length,
              durationMs: Date.now() - contextStartedAt,
              ...(sections.length > 1 && {
                section: `${sectionIndex + 1}/${sections.length}`,
              }),
            });
            if (this.logger.debugEnabled) {
              await this.logger.debug('ingest:context-pages', {
                source: source.relativePath,
                pages: relevantPages.map((page) => ({
                  path: page.page.relativePath,
                  score: page.score,
                })),
              });
            }

            const relevantPagesTruncated = relevantPages.filter(
              (r) => (r.chunk?.content ?? r.page.content).length > maxChunkChars,
            ).length;
            if (relevantPagesTruncated > 0) {
              await this.logger.info('ingest:truncation', {
                source: source.relativePath,
                field: 'relevantPages',
                truncatedPageCount: relevantPagesTruncated,
                truncatedToCharsPerPage: maxChunkChars,
              });
            }

            const prompt = buildIngestPrompt({
              source,
              body,
              indexContent: await this.workspace.readIndex(),
              relevantPages,
              sourcePagePath,
              maxChunkChars,
              ctx: buildPromptContext(this.config, { profileSection }),
            });
            await this.logger.info('ingest:prompt', {
              source: source.relativePath,
              promptChars: prompt.system.length + prompt.user.length,
              relevantPages: relevantPages.length,
              sourcePagePath,
              ...(sections.length > 1 && {
                section: `${sectionIndex + 1}/${sections.length}`,
              }),
            });

            const progress = {
              sectionIndex,
              sectionTotal: sections.length,
            };
            options?.onSourceLlm?.(sourcePath, i, sourcePaths.length, progress);
            const { value: plan, retry } = await withRetry(
              () =>
                this.llm.completeJson(
                  {
                    ...prompt,
                    label: 'ingest_plan',
                    logger: this.logger,
                    traceData: { source: source.relativePath },
                    onUsage: (usage) => {
                      options?.onSourceUsage?.(
                        sourcePath,
                        i,
                        sourcePaths.length,
                        usage,
                        progress,
                      );
                    },
                  },
                  ingestPlanSchema,
                ),
              {
                onRetry: async (retryInfo) => {
                  await this.logger.warn('ingest:retry', {
                    source: source.relativePath,
                    attempts: retryInfo.attempts,
                    retries: retryInfo.retries,
                    classification: retryInfo.classification,
                    nextDelayMs: retryInfo.nextDelayMs,
                    message: retryInfo.message,
                    ...(sections.length > 1 && {
                      section: `${sectionIndex + 1}/${sections.length}`,
                    }),
                  });
                },
              },
            );
            await this.logger.info('ingest:plan', {
              source: source.relativePath,
              operations: plan.operations.length,
              summary: plan.summary,
              ...(sections.length > 1 && {
                section: `${sectionIndex + 1}/${sections.length}`,
              }),
            });

            const normalizedOperations = await this.workspace.normalizeWikiOperations(
              plan.operations,
            );
            const {
              operations: citationSafeOperations,
              rewrittenCitations,
              unreconciledCitations,
            } = enforceSourceCitationPath(
              normalizedOperations,
              source.archiveCitationPath,
            );
            const rewrittenPaths = normalizedOperations
              .map((operation, index) => ({
                from: plan.operations[index]?.path,
                to: operation.path,
              }))
              .filter((rewrite) => rewrite.from !== rewrite.to);
            await this.logger.info('ingest:normalize', {
              source: source.relativePath,
              operations: citationSafeOperations.length,
              rewrittenPaths: rewrittenPaths.length,
              rewrittenCitations,
              unreconciledCitations,
            });
            if (this.logger.debugEnabled && rewrittenPaths.length > 0) {
              await this.logger.debug('ingest:normalize-paths', {
                source: source.relativePath,
                rewrites: rewrittenPaths,
              });
            }
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

            const operationCounts = citationSafeOperations.reduce(
              (counts, operation) => {
                counts[operation.type] += 1;
                return counts;
              },
              { create: 0, update: 0, delete: 0 },
            );
            await this.logger.info('ingest:operations', {
              source: source.relativePath,
              create: operationCounts.create,
              update: operationCounts.update,
              delete: operationCounts.delete,
            });

            if (options?.dryRun) {
              await this.logger.info('ingest:dry-run', {
                source: source.relativePath,
                ...(sections.length > 1 && {
                  section: `${sectionIndex + 1}/${sections.length}`,
                }),
              });
            }

            return {
              operations: citationSafeOperations,
              summary:
                sections.length > 1 ? `${plan.summary}${sectionLabel}` : plan.summary,
              ...(retry.retries > 0 && { retry }),
            };
          },
        );
        const allOperations = sectionResults.flatMap((result) => result.operations);
        const lastSummary = sectionResults.at(-1)?.summary ?? '';
        sourceRetry = sectionResults.findLast((result) => result.retry)?.retry;

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
