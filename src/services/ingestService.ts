import path from 'node:path';
import { ingestPlanSchema } from '../config/schema.ts';
import { buildIngestPrompt } from '../prompts/ingestPrompt.ts';
import type { AppConfig, IngestCommandOptions, IngestResult } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RefreshService } from './refreshService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

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

  async ingest(inputs: string[], options?: IngestCommandOptions): Promise<IngestResult[]> {
    const runStartedAt = Date.now();
    await this.workspace.ensureInitialized();
    await this.logger.info('ingest:run-start', {
      inputCount: inputs.length,
      dryRun: Boolean(options?.dryRun),
      refreshEnabled: options?.refresh !== false && this.config.build.refreshOnIngest,
    });

    const selectionStartedAt = Date.now();
    const sourcePaths = await this.workspace.resolveSourceInputs(inputs);
    await this.logger.info('ingest:source-selection', {
      resolvedCount: sourcePaths.length,
      durationMs: Date.now() - selectionStartedAt,
    });

    const results: IngestResult[] = [];

    for (const sourcePath of sourcePaths) {
      const sourceStartedAt = Date.now();
      await this.logger.info('ingest:source-start', {
        sourcePath,
      });

      try {
        const readStartedAt = Date.now();
        const source = await this.workspace.readSourceDocument(sourcePath);
        await this.logger.info('ingest:source', {
          source: source.relativePath,
          title: source.title,
          sizeBytes: source.rawContent.length,
          durationMs: Date.now() - readStartedAt,
        });

        const contextStartedAt = Date.now();
        const relevantPages = await this.retrieval.search(source.body || source.title, {
          limit: this.config.retrieval.maxContextFiles,
          includeRaw: false,
        });
        await this.logger.info('ingest:context', {
          source: source.relativePath,
          pagesFound: relevantPages.length,
          durationMs: Date.now() - contextStartedAt,
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

        // Truncate source body if needed — warn always visible on console
        const { maxChunkChars, maxSourceChars } = this.config.retrieval;
        const rawBody = source.body ?? '';
        const sourceBodyTruncated = rawBody.length > maxSourceChars;
        if (sourceBodyTruncated) {
          await this.logger.warn('ingest:truncation', {
            source: source.relativePath,
            field: 'sourceBody',
            originalChars: rawBody.length,
            truncatedToChars: maxSourceChars,
          });
        }
        const body = sourceBodyTruncated
          ? `${rawBody.slice(0, maxSourceChars)}\n...[source tronquée — ${rawBody.length - maxSourceChars} chars omis]`
          : rawBody;

        // Count relevant pages that will be truncated
        const relevantPagesTruncated = relevantPages.filter(
          (r) => (r.chunk?.content ?? r.page.content).length > maxChunkChars,
        ).length;
        if (relevantPagesTruncated > 0) {
          await this.logger.warn('ingest:truncation', {
            source: source.relativePath,
            field: 'relevantPages',
            truncatedPageCount: relevantPagesTruncated,
            truncatedToCharsPerPage: maxChunkChars,
          });
        }

        const sourcePagePath = path.posix.join('wiki', 'sources', `${source.slug}.md`);
        const prompt = buildIngestPrompt({
          source,
          body,
          indexContent: await this.workspace.readIndex(),
          relevantPages,
          sourcePagePath,
          maxChunkChars,
        });
        await this.logger.info('ingest:prompt', {
          source: source.relativePath,
          promptChars: prompt.system.length + prompt.user.length,
          relevantPages: relevantPages.length,
          sourcePagePath,
        });
        if (this.logger.debugEnabled) {
          await this.logger.debug('ingest:prompt-detail', {
            source: source.relativePath,
            sourceBodyChars: rawBody.length,
            sourceBodyTruncated,
            relevantPagesTruncated,
          });
        }

        const plan = await this.llm.completeJson(
          {
            ...prompt,
            label: 'ingest_plan',
            logger: this.logger,
            traceData: {
              source: source.relativePath,
            },
          },
          ingestPlanSchema,
        );
        await this.logger.info('ingest:plan', {
          source: source.relativePath,
          operations: plan.operations.length,
          summary: plan.summary,
        });

        const normalizedOperations = await this.workspace.normalizeWikiOperations(plan.operations);
        const rewrittenPaths = normalizedOperations
          .map((operation, index) => ({
            from: plan.operations[index]?.path,
            to: operation.path,
          }))
          .filter((rewrite) => rewrite.from !== rewrite.to);
        await this.logger.info('ingest:normalize', {
          source: source.relativePath,
          operations: normalizedOperations.length,
          rewrittenPaths: rewrittenPaths.length,
        });
        if (this.logger.debugEnabled && rewrittenPaths.length > 0) {
          await this.logger.debug('ingest:normalize-paths', {
            source: source.relativePath,
            rewrites: rewrittenPaths,
          });
        }

        const normalizedPlan = {
          ...plan,
          operations: normalizedOperations,
        };
        const operationCounts = normalizedOperations.reduce(
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
        if (this.logger.debugEnabled) {
          await this.logger.debug('ingest:operation-paths', {
            source: source.relativePath,
            operations: normalizedOperations.map((operation) => ({
              type: operation.type,
              path: operation.path,
            })),
          });
        }

        results.push({
          source: source.relativePath,
          plan: normalizedPlan,
        });

        if (!options?.dryRun) {
          const applyStartedAt = Date.now();
          await this.workspace.applyWikiOperations(normalizedPlan.operations);
          await this.logger.info('ingest:apply', {
            source: source.relativePath,
            durationMs: Date.now() - applyStartedAt,
            create: operationCounts.create,
            update: operationCounts.update,
            delete: operationCounts.delete,
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
            `${source.relativePath} -> ${source.archiveCitationPath} (${normalizedPlan.summary})`,
          );
        } else {
          await this.logger.info('ingest:dry-run', {
            source: source.relativePath,
          });
        }

        await this.logger.info('ingest:source-done', {
          source: source.relativePath,
          durationMs: Date.now() - sourceStartedAt,
          status: 'success',
        });
      } catch (error) {
        await this.logger.error('ingest:source-failed', {
          sourcePath,
          durationMs: Date.now() - sourceStartedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    if (!options?.dryRun && options?.refresh !== false && this.config.build.refreshOnIngest) {
      const refreshStartedAt = Date.now();
      try {
        const refreshResults = await this.refresh.refresh();
        await this.logger.info('ingest:refresh', {
          durationMs: Date.now() - refreshStartedAt,
          changed: refreshResults.filter((result) => result.changed).length,
          skipped: refreshResults.filter((result) => result.skipped).length,
          unchanged: refreshResults.filter((result) => !result.changed && !result.skipped).length,
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
          advice: 'Rerun `wiki refresh` later or use `wiki ingest --no-refresh`.',
        });
      }
    } else {
      await this.logger.info('ingest:refresh', {
        skipped: true,
      });
    }

    await this.logger.info('ingest:run-done', {
      sourceCount: results.length,
      durationMs: Date.now() - runStartedAt,
      status: 'success',
    });

    return results;
  }
}
