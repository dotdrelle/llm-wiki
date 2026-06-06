import path from 'node:path';
import { ingestPlanSchema } from '../config/schema.ts';
import { buildIngestPrompt } from '../prompts/ingestPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { normalizeSourceBody, splitSourceSections } from '../utils/markdown.ts';
import type { TokenUsage } from './llmService.ts';
import type {
  AppConfig,
  IngestCommandOptions,
  IngestResult,
  WikiOperation,
} from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RefreshService } from './refreshService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

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

  return { operations: operationsWithCitations, rewrittenCitations, unreconciledCitations };
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

    for (let i = 0; i < sourcePaths.length; i++) {
      const sourcePath = sourcePaths[i];
      let sourceLabel = sourcePath;
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
        });

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
        const sections = rawBody.length > maxSourceChars
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
        const allOperations: WikiOperation[] = [];
        let lastSummary = '';

        for (const [sectionIndex, body] of sections.entries()) {
          const sectionLabel = sections.length > 1
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
            ...(sections.length > 1 && { section: `${sectionIndex + 1}/${sections.length}` }),
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
            ...(sections.length > 1 && { section: `${sectionIndex + 1}/${sections.length}` }),
          });

          const progress = {
            sectionIndex,
            sectionTotal: sections.length,
          };
          options?.onSourceLlm?.(sourcePath, i, sourcePaths.length, progress);
          const plan = await this.llm.completeJson(
            {
              ...prompt,
              label: 'ingest_plan',
              logger: this.logger,
              traceData: { source: source.relativePath },
              onUsage: (usage) => {
                options?.onSourceUsage?.(sourcePath, i, sourcePaths.length, usage, progress);
              },
            },
            ingestPlanSchema,
          );
          await this.logger.info('ingest:plan', {
            source: source.relativePath,
            operations: plan.operations.length,
            summary: plan.summary,
            ...(sections.length > 1 && { section: `${sectionIndex + 1}/${sections.length}` }),
          });

          const normalizedOperations = await this.workspace.normalizeWikiOperations(
            plan.operations,
          );
          const {
            operations: citationSafeOperations,
            rewrittenCitations,
            unreconciledCitations,
          } = enforceSourceCitationPath(normalizedOperations, source.archiveCitationPath);
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
              ...(sections.length > 1 && { section: `${sectionIndex + 1}/${sections.length}` }),
            });
          }

          allOperations.push(...citationSafeOperations);
          lastSummary = sections.length > 1
            ? `${plan.summary}${sectionLabel}`
            : plan.summary;
        }

        if (!options?.dryRun) {
          const operationCounts = allOperations.reduce(
            (counts, operation) => {
              counts[operation.type] += 1;
              return counts;
            },
            { create: 0, update: 0, delete: 0 },
          );
          const applyStartedAt = Date.now();
          await this.workspace.applyNormalizedWikiOperations(allOperations);
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
          plan: { summary: lastSummary, operations: allOperations },
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
}
