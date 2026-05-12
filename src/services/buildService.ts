import matter from 'gray-matter';
import { deliverableResponseSchema } from '../config/schema.ts';
import {
  buildDeliverablePrompt,
  buildSingleSlotDeliverablePrompt,
} from '../prompts/buildPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { sanitizeFrontmatter } from '../utils/markdown.ts';
import { hashText } from '../utils/hash.ts';
import type {
  AppConfig,
  BuildContext,
  BuildState,
  DeliverableBuildResult,
  SearchResult,
  TemplateDocument,
} from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

export class BuildService {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly retrieval: RetrievalService;
  private readonly logger?: TraceLogger;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
    logger?: TraceLogger,
  ) {
    this.config = config;
    this.workspace = workspace;
    this.llm = llm;
    this.retrieval = retrieval;
    this.logger = logger;
  }

  private isContextLengthExceeded(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /context_length_exceeded|exceed(?:s|ed) the configured limit|reduce the length/i.test(
      error.message,
    );
  }

  private extractFocusedQueries(text: string): string[] {
    const queries: string[] = [];
    const addQuery = (value: string) => {
      const clean = value
        .replace(/\s+/g, ' ')
        .replace(/^[\s:;,.()[\]-]+|[\s:;,.()[\]-]+$/g, '')
        .trim();
      if (
        clean.length >= 3 &&
        clean.length <= 80 &&
        !['INSTRUCTION'].includes(clean.toUpperCase())
      ) {
        queries.push(clean);
      }
    };

    for (const line of text.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex < 0) continue;
      const listedItems = line.slice(colonIndex + 1);
      for (const item of listedItems.split(/[,;]/u)) {
        addQuery(item);
        for (const part of item.split('/')) {
          addQuery(part);
        }
      }
    }

    for (const match of text.matchAll(/\b[\p{Lu}\d][\p{Lu}\d-]{2,}\b/gu)) {
      addQuery(match[0]);
    }

    return [...new Set(queries)];
  }

  private buildRetrievalQueries(
    instruction: {
      instruction: string;
      headingPath: string[];
    },
    templateFocusedQueries: string[],
  ): string[] {
    const baseQuery = `${instruction.headingPath.join(' ')} ${instruction.instruction}`;
    const queries = [
      baseQuery,
      ...templateFocusedQueries,
      ...this.extractFocusedQueries(instruction.instruction),
    ];

    return [...new Set(queries)];
  }

  private contextLimitForQueryCount(queryCount: number): number {
    const configured = this.config.retrieval.maxContextFiles;
    if (queryCount <= 1) return configured;
    return Math.min(Math.max(configured, queryCount + 1), configured * 3, 12);
  }

  private async searchInstructionContext(instruction: {
    instruction: string;
    headingPath: string[];
    templateFocusedQueries: string[];
  }): Promise<SearchResult[]> {
    const queries = this.buildRetrievalQueries(
      instruction,
      instruction.templateFocusedQueries,
    );
    const perQueryResults = await Promise.all(
      queries.map((query) =>
        this.retrieval.search(query, {
          limit: this.config.retrieval.maxContextFiles,
          includeRaw: false,
        }),
      ),
    );
    const limit = this.contextLimitForQueryCount(queries.length);
    const byPath = new Map<string, SearchResult>();

    for (let rank = 0; byPath.size < limit; rank++) {
      let foundAtRank = false;
      for (const results of perQueryResults) {
        const result = results[rank];
        if (!result) continue;
        foundAtRank = true;
        if (!byPath.has(result.page.relativePath)) {
          byPath.set(result.page.relativePath, result);
          if (byPath.size >= limit) break;
        }
      }
      if (!foundAtRank) break;
    }

    return [...byPath.values()];
  }

  private async renderSingleSlotText(
    template: TemplateDocument,
    buildContext: BuildContext,
    slot: {
      id: string;
      instruction: string;
      headingPath: string[];
      surroundingText: string;
      context: SearchResult[];
    },
    traceData: Record<string, unknown>,
    label: string,
  ): Promise<string> {
    const prompt = buildSingleSlotDeliverablePrompt({
      template,
      slot,
      buildContext: buildContext.content,
      maxChunkChars: this.config.retrieval.maxChunkChars,
      ctx: buildPromptContext(this.config),
    });
    return this.llm.completeText({
      ...prompt,
      label,
      logger: this.logger,
      traceData,
    });
  }

  private async renderTemplate(
    template: TemplateDocument,
    buildContext: BuildContext,
    onBatch?: (batchIndex: number, topContextPages: string[]) => void,
    onBatchLlm?: (batchIndex: number, topContextPages: string[]) => void,
  ): Promise<string> {
    if (template.instructions.length === 0) {
      const outputFrontmatter = sanitizeFrontmatter(template.frontmatter);
      return Object.keys(outputFrontmatter).length > 0
        ? matter.stringify(template.content.trim(), outputFrontmatter)
        : `${template.content.trim()}\n`;
    }

    const templateFocusedQueries = this.extractFocusedQueries(template.content);
    const slots = await Promise.all(
      template.instructions.map(async (instruction) => ({
        id: instruction.id,
        instruction: instruction.instruction,
        headingPath: instruction.headingPath,
        surroundingText: instruction.surroundingText,
        context: await this.searchInstructionContext({
          ...instruction,
          templateFocusedQueries,
        }),
      })),
    );

    const batchSize = this.config.build.slotBatchSize;
    const batchCount = Math.ceil(slots.length / batchSize);
    const replacements = new Map<string, string>();

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const batch = slots.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
      const topContextPages = [
        ...new Set(
          batch.flatMap((s) => s.context.slice(0, 2).map((r) => r.page.relativePath)),
        ),
      ].slice(0, 3);
      onBatch?.(batchIndex, topContextPages);
      onBatchLlm?.(batchIndex, topContextPages);
      const traceData = {
        template: template.relativePath,
        instructionCount: template.instructions.length,
        batchIndex,
        batchCount,
      };
      const response = await this.renderBatch(template, buildContext, batch, traceData);
      for (const item of response) {
        replacements.set(item.id, item.content.trim());
      }
    }
    let renderedBody = template.content;
    for (const instruction of template.instructions) {
      const replacement =
        replacements.get(instruction.id) ??
        '> Missing evidence: the wiki does not contain enough documented information for this section.';
      renderedBody = renderedBody.replace(instruction.token, replacement);
    }

    const outputFrontmatter = sanitizeFrontmatter(template.frontmatter);
    return Object.keys(outputFrontmatter).length > 0
      ? matter.stringify(renderedBody.trim(), outputFrontmatter)
      : `${renderedBody.trim()}\n`;
  }

  private async renderBatch(
    template: TemplateDocument,
    buildContext: BuildContext,
    batch: Array<{
      id: string;
      instruction: string;
      headingPath: string[];
      surroundingText: string;
      context: SearchResult[];
    }>,
    traceData: Record<string, unknown>,
  ): Promise<Array<{ id: string; content: string }>> {
    if (this.config.llm.provider === 'openai-compatible' && batch.length === 1) {
      if (this.logger) {
        await this.logger.info('build:text-render', {
          ...traceData,
          slot: batch[0].id,
          reason: 'openai-compatible-single-slot',
        });
      }
      return [
        {
          id: batch[0].id,
          content: await this.renderSingleSlotText(
            template,
            buildContext,
            batch[0],
            traceData,
            'deliverable_render_text',
          ),
        },
      ];
    }

    const prompt = buildDeliverablePrompt({
      template,
      slots: batch,
      buildContext: buildContext.content,
      maxChunkChars: this.config.retrieval.maxChunkChars,
      ctx: buildPromptContext(this.config),
    });

    try {
      const response = await this.llm.completeJson(
        {
          ...prompt,
          label: 'deliverable_render',
          logger: this.logger,
          traceData,
        },
        deliverableResponseSchema,
      );
      return response.replacements;
    } catch (error) {
      if (batch.length > 1 && this.isContextLengthExceeded(error)) {
        if (this.logger) {
          await this.logger.warn('build:batch-split', {
            ...traceData,
            slots: batch.length,
            reason: 'context_length_exceeded',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const midpoint = Math.ceil(batch.length / 2);
        const first = await this.renderBatch(
          template,
          buildContext,
          batch.slice(0, midpoint),
          traceData,
        );
        const second = await this.renderBatch(
          template,
          buildContext,
          batch.slice(midpoint),
          traceData,
        );
        return [...first, ...second];
      }

      if (batch.length !== 1) {
        throw error;
      }

      if (this.logger) {
        await this.logger.warn('build:json-fallback', {
          ...traceData,
          slot: batch[0].id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return [
        {
          id: batch[0].id,
          content: await this.renderSingleSlotText(
            template,
            buildContext,
            batch[0],
            traceData,
            'deliverable_render_text_fallback',
          ),
        },
      ];
    }
  }

  private nextState(state: BuildState): BuildState {
    return {
      deliverables: { ...state.deliverables },
    };
  }

  async build(options?: {
    templates?: string[];
    force?: boolean;
    changedOnly?: boolean;
    onProgress?: (
      template: string,
      batch: { index: number; total: number },
      topContextPages: string[],
    ) => void;
    onBatchLlm?: (
      template: string,
      batch: { index: number; total: number },
      topContextPages: string[],
    ) => void;
    onPageLoad?: (relativePath: string, index: number, total: number) => void;
  }): Promise<DeliverableBuildResult[]> {
    await this.workspace.ensureInitialized();
    const templatePaths = await this.workspace.resolveTemplateInputs(
      options?.templates ?? [],
    );
    const buildContext = await this.workspace.readBuildContext();
    const wikiPages = await this.retrieval.warmCache(options?.onPageLoad);
    const wikiHash = await this.workspace.computeWikiHash(wikiPages);
    const previousState = await this.workspace.readBuildState();
    const nextState = this.nextState(previousState);
    const results: DeliverableBuildResult[] = [];

    if (this.logger) {
      await this.logger.info('build:run-start', {
        templateCount: templatePaths.length,
        buildContextFiles: buildContext.fileCount,
        buildContextTruncated: buildContext.truncated,
        force: Boolean(options?.force),
        changedOnly: Boolean(options?.changedOnly),
      });
    }

    for (const templatePath of templatePaths) {
      const templateStartedAt = Date.now();
      const template = await this.workspace.readTemplateDocument(templatePath);
      const templateHash = await this.workspace.computeTemplateHash(template);
      const prior = previousState.deliverables[template.relativePath];
      const isFresh =
        prior &&
        prior.templateHash === templateHash &&
        prior.wikiHash === wikiHash &&
        prior.buildContextHash === buildContext.hash &&
        !options?.force;

      if (this.logger) {
        await this.logger.info('build:template-start', {
          template: template.relativePath,
          output: template.outputRelativePath,
          instructions: template.instructions.length,
          fresh: Boolean(isFresh),
        });
      }

      if (options?.changedOnly && isFresh) {
        results.push({
          template: template.relativePath,
          output: template.outputRelativePath,
          changed: false,
          skipped: true,
        });
        if (this.logger) {
          await this.logger.info('build:template-skip', {
            template: template.relativePath,
            output: template.outputRelativePath,
            durationMs: Date.now() - templateStartedAt,
          });
        }
        continue;
      }

      const batchCount =
        Math.ceil(template.instructions.length / this.config.build.slotBatchSize) || 1;
      options?.onProgress?.(
        template.relativePath,
        { index: results.length, total: templatePaths.length },
        [],
      );

      try {
        const rendered = await this.renderTemplate(
          template,
          buildContext,
          (batchIndex, topContextPages) => {
            options?.onProgress?.(
              template.relativePath,
              { index: batchIndex, total: batchCount },
              topContextPages,
            );
          },
          (batchIndex, topContextPages) => {
            options?.onBatchLlm?.(
              template.relativePath,
              { index: batchIndex, total: batchCount },
              topContextPages,
            );
          },
        );
        const changed = await this.workspace.writeDeliverable(
          template.outputAbsolutePath,
          rendered,
        );

        nextState.deliverables[template.relativePath] = {
          templateHash,
          wikiHash,
          buildContextHash: buildContext.hash,
          outputHash: hashText(rendered),
          outputRelativePath: template.outputRelativePath,
        };

        results.push({
          template: template.relativePath,
          output: template.outputRelativePath,
          changed,
          skipped: false,
        });

        if (this.logger) {
          await this.logger.info('build:template-done', {
            template: template.relativePath,
            output: template.outputRelativePath,
            changed,
            durationMs: Date.now() - templateStartedAt,
          });
        }
      } catch (error) {
        if (this.logger) {
          await this.logger.error('build:template-failed', {
            template: template.relativePath,
            output: template.outputRelativePath,
            durationMs: Date.now() - templateStartedAt,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    }

    await this.workspace.writeBuildState(nextState);

    if (this.logger) {
      await this.logger.info('build:run-done', {
        templateCount: results.length,
        changed: results.filter((result) => result.changed).length,
        skipped: results.filter((result) => result.skipped).length,
        unchanged: results.filter((result) => !result.changed && !result.skipped).length,
      });
    }

    return results;
  }
}
