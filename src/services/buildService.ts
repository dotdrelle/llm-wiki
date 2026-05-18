import matter from 'gray-matter';
import { deliverableResponseSchema } from '../config/schema.ts';
import {
  buildDeliverablePrompt,
  buildSingleSlotDeliverablePrompt,
} from '../prompts/buildPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { sanitizeFrontmatter } from '../utils/markdown.ts';
import { hashText } from '../utils/hash.ts';
import { PromptBudgetService } from './promptBudgetService.ts';
import type {
  AppConfig,
  BuildBatchPlan,
  BuildContext,
  BuildRunPlan,
  BuildState,
  BuildSlotPlan,
  DeliverableBuildResult,
  SearchResult,
  TemplateDocument,
  WikiPage,
} from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

const FINAL_CONTEXT_EXCLUDED_PATHS = new Set(['wiki/index.md', 'wiki/log.md']);

function extractMostRecentDateMs(result: SearchResult): number | undefined {
  const text = `${result.page.relativePath}\n${result.page.name}\n${result.page.content}`;
  const dates: number[] = [];

  for (const match of text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)) {
    dates.push(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  for (const match of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/g)) {
    dates.push(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  }

  for (const match of text.matchAll(/\b(\d{2})(\d{2})(20\d{2})\b/g)) {
    dates.push(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  }

  const validDates = dates.filter((date) => Number.isFinite(date));
  return validDates.length > 0 ? Math.max(...validDates) : undefined;
}

export class BuildService {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly retrieval: RetrievalService;
  private readonly logger?: TraceLogger;
  private readonly budget: PromptBudgetService;
  private readonly contextSearchCache = new Map<string, Promise<SearchResult[]>>();

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
    this.budget = new PromptBudgetService(config);
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

  private searchContextCached(
    query: string,
    options: { limit?: number; includeRaw?: boolean; rerank?: boolean },
  ): Promise<SearchResult[]> {
    const key = JSON.stringify({
      query,
      limit: options.limit,
      includeRaw: options.includeRaw ?? false,
      rerank: options.rerank ?? true,
    });
    let cached = this.contextSearchCache.get(key);
    if (!cached) {
      cached = this.retrieval.search(query, options).catch((error) => {
        this.contextSearchCache.delete(key);
        throw error;
      });
      this.contextSearchCache.set(key, cached);
    }
    return cached;
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
    wikiPages: WikiPage[],
    onBatch?: (batchIndex: number, batchCount: number, topContextPages: string[]) => void,
    onBatchLlm?: (
      batchIndex: number,
      batchCount: number,
      topContextPages: string[],
    ) => void,
  ): Promise<string> {
    if (template.instructions.length === 0) {
      const outputFrontmatter = sanitizeFrontmatter(template.frontmatter);
      return Object.keys(outputFrontmatter).length > 0
        ? matter.stringify(template.content.trim(), outputFrontmatter)
        : `${template.content.trim()}\n`;
    }

    const slots = await this.prepareSlots(template, wikiPages);
    if (this.logger) {
      for (const slot of slots) {
        await this.logger.info('build:slot-context', {
          template: template.relativePath,
          slot: slot.id,
          contextCount: slot.context.length,
          contextPages: slot.context.map((result) => result.page.relativePath),
        });
      }
    }

    const batches = this.planSlotBatches(template, buildContext, slots);
    const batchCount = batches.length;
    const replacements = new Map<string, string>();

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const batch = batches[batchIndex].slots;
      const topContextPages = [
        ...new Set(batch.flatMap((s) => s.context.map((r) => r.page.relativePath))),
      ].slice(0, 8);
      onBatch?.(batchIndex, batchCount, topContextPages);
      onBatchLlm?.(batchIndex, batchCount, topContextPages);
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

  private async prepareSlots(
    template: TemplateDocument,
    wikiPages: WikiPage[],
  ): Promise<
    Array<{
      id: string;
      instruction: string;
      headingPath: string[];
      surroundingText: string;
      context: SearchResult[];
    }>
  > {
    const wikiPageByPath = new Map(wikiPages.map((page) => [page.relativePath, page]));
    const templateFocusQueries = [
      ...new Set(
        template.instructions.flatMap((instruction) =>
          this.extractFocusQueries(instruction.instruction),
        ),
      ),
    ];
    const templateFocusContextEntries: Array<[string, SearchResult[]]> =
      await Promise.all(
        templateFocusQueries.slice(0, 6).map(
          async (focus) =>
            [
              focus,
              await this.searchContextCached(focus, {
                limit: 15,
                includeRaw: false,
                rerank: false,
              }),
            ] as [string, SearchResult[]],
        ),
      );
    const templateFocusContexts = new Map<string, SearchResult[]>(
      templateFocusContextEntries,
    );
    return Promise.all(
      template.instructions.map(async (instruction) => {
        const primaryContext = await this.searchContextCached(
          `${instruction.headingPath.join(' ')} ${instruction.instruction}`,
          {
            limit: Math.max(24, this.config.retrieval.vector.maxResults),
            includeRaw: false,
            rerank: false,
          },
        );
        const instructionFocusQueries = this.extractFocusQueries(
          instruction.instruction,
        ).filter((focus) => !templateFocusContexts.has(focus));
        const focusContexts = await Promise.all(
          instructionFocusQueries.slice(0, 6).map((focus) =>
            this.searchContextCached(`${instruction.headingPath.join(' ')} ${focus}`, {
              limit: 15,
              includeRaw: false,
              rerank: false,
            }),
          ),
        );
        const rerankQuery = `${instruction.headingPath.join(' ')} ${instruction.instruction}`;
        const mergedContext = this.mergeContextResults(
          [primaryContext, ...templateFocusContexts.values(), ...focusContexts].flat(),
        );
        const rankedContext =
          typeof this.retrieval.rerankResults === 'function'
            ? await this.retrieval.rerankResults(rerankQuery, mergedContext, {
                limit: Math.max(24, this.config.retrieval.vector.maxResults),
              })
            : mergedContext;
        const finalContext = this.prepareFinalContext(rankedContext);
        return {
          id: instruction.id,
          instruction: instruction.instruction,
          headingPath: instruction.headingPath,
          surroundingText: instruction.surroundingText,
          context: this.expandRelatedContext(finalContext, wikiPageByPath),
        };
      }),
    );
  }

  private extractFocusQueries(instruction: string): string[] {
    const listText = instruction.includes(':')
      ? instruction.split(':').slice(1).join(':').split('.')[0]
      : '';
    if (!listText) return [];
    return [
      ...new Set(
        listText
          .split(/,|;|\bet\b/iu)
          .map((item) => item.trim())
          .filter((item) => item.length >= 3)
          .map((item) => `${item} démonstration outil solution candidate JUNO`),
      ),
    ];
  }

  private mergeContextResults(results: SearchResult[]): SearchResult[] {
    const bestByPath = new Map<string, SearchResult>();
    for (const result of results) {
      const existing = bestByPath.get(result.page.relativePath);
      if (!existing || result.score > existing.score) {
        bestByPath.set(result.page.relativePath, {
          ...result,
          relatedPaths: [
            ...new Set([
              ...(existing?.relatedPaths ?? []),
              ...(result.relatedPaths ?? []),
            ]),
          ],
        });
      } else if (result.relatedPaths?.length) {
        existing.relatedPaths = [
          ...new Set([...(existing.relatedPaths ?? []), ...result.relatedPaths]),
        ];
      }
    }
    return [...bestByPath.values()].sort((a, b) => b.score - a.score);
  }

  private prepareFinalContext(results: SearchResult[]): SearchResult[] {
    return results
      .filter((result) => !FINAL_CONTEXT_EXCLUDED_PATHS.has(result.page.relativePath))
      .sort((a, b) => {
        const aDate = extractMostRecentDateMs(a);
        const bDate = extractMostRecentDateMs(b);
        if (aDate !== undefined && bDate !== undefined && aDate !== bDate) {
          return bDate - aDate;
        }
        if (aDate !== undefined && bDate === undefined) return -1;
        if (aDate === undefined && bDate !== undefined) return 1;
        return b.score - a.score;
      });
  }

  private expandRelatedContext(
    context: SearchResult[],
    wikiPageByPath: Map<string, WikiPage>,
  ): SearchResult[] {
    const expanded = [...context];
    const seen = new Set(expanded.map((result) => result.page.relativePath));
    let relatedCount = 0;
    const maxRelated = 4;

    for (const result of context) {
      for (const relatedPath of result.relatedPaths ?? []) {
        if (relatedCount >= maxRelated) return expanded;
        if (!relatedPath.startsWith('wiki/') || seen.has(relatedPath)) continue;
        if (FINAL_CONTEXT_EXCLUDED_PATHS.has(relatedPath)) continue;
        const page = wikiPageByPath.get(relatedPath);
        if (!page || page.type === 'answer') continue;
        seen.add(relatedPath);
        relatedCount += 1;
        expanded.push({
          page,
          score: Math.max(0, result.score - 0.01),
          relatedPaths: [],
        });
      }
    }

    return expanded;
  }

  private promptInputChars(
    template: TemplateDocument,
    buildContext: BuildContext,
    batch: Array<{
      id: string;
      instruction: string;
      headingPath: string[];
      surroundingText: string;
      context: SearchResult[];
    }>,
  ): number {
    const prompt =
      this.config.llm.provider === 'openai-compatible' && batch.length === 1
        ? buildSingleSlotDeliverablePrompt({
            template,
            slot: batch[0],
            buildContext: buildContext.content,
            maxChunkChars: this.config.retrieval.maxChunkChars,
            ctx: buildPromptContext(this.config),
          })
        : buildDeliverablePrompt({
            template,
            slots: batch,
            buildContext: buildContext.content,
            maxChunkChars: this.config.retrieval.maxChunkChars,
            ctx: buildPromptContext(this.config),
          });
    return prompt.system.length + prompt.user.length;
  }

  private trimBatchToMax(
    template: TemplateDocument,
    buildContext: BuildContext,
    batch: Array<{
      id: string;
      instruction: string;
      headingPath: string[];
      surroundingText: string;
      context: SearchResult[];
    }>,
  ): void {
    while (
      this.promptInputChars(template, buildContext, batch) > this.budget.maxInputChars()
    ) {
      const slot = [...batch].sort((a, b) => b.context.length - a.context.length)[0];
      if (!slot || slot.context.length <= 1) break;
      slot.context.pop();
    }
  }

  private planSlotBatches(
    template: TemplateDocument,
    buildContext: BuildContext,
    slots: Array<{
      id: string;
      instruction: string;
      headingPath: string[];
      surroundingText: string;
      context: SearchResult[];
    }>,
  ): Array<{
    slots: typeof slots;
    plan: BuildBatchPlan;
  }> {
    const batches: Array<{ slots: typeof slots; plan: BuildBatchPlan }> = [];
    let current: typeof slots = [];
    const maxSlotsPerBatch = this.config.build.slotBatchSize;

    const pushCurrent = () => {
      if (current.length === 0) return;
      this.trimBatchToMax(template, buildContext, current);
      const chars = this.promptInputChars(template, buildContext, current);
      batches.push({
        slots: current,
        plan: this.budget.describeBatch(
          batches.length,
          current.map((slot) => slot.id),
          [
            ...new Set(
              current.flatMap((slot) =>
                slot.context.map((result) => result.page.relativePath),
              ),
            ),
          ],
          chars,
        ),
      });
      current = [];
    };

    for (const slot of slots) {
      const candidate = [...current, slot];
      const candidateChars = this.promptInputChars(template, buildContext, candidate);
      const wouldExceedTarget = candidateChars > this.budget.targetInputChars();
      const wouldExceedSlotCap = candidate.length > maxSlotsPerBatch;
      if (current.length > 0 && (wouldExceedTarget || wouldExceedSlotCap)) {
        pushCurrent();
      }
      current.push(slot);
    }
    pushCurrent();

    return batches;
  }

  async planBuild(options?: {
    templates?: string[];
    onPageLoad?: (relativePath: string, index: number, total: number) => void;
  }): Promise<BuildRunPlan> {
    await this.workspace.ensureInitialized();
    const templatePaths = await this.workspace.resolveTemplateInputs(
      options?.templates ?? [],
    );
    const buildContext = await this.workspace.readBuildContext();
    const wikiPages = await this.retrieval.warmCache(options?.onPageLoad);
    const templatePlans = [];

    for (const templatePath of templatePaths) {
      const template = await this.workspace.readTemplateDocument(templatePath);
      const slots = await this.prepareSlots(template, wikiPages);
      const batches = this.planSlotBatches(template, buildContext, slots);
      const slotPlans: BuildSlotPlan[] = slots.map((slot) => {
        const chars = this.promptInputChars(template, buildContext, [slot]);
        return {
          id: slot.id,
          headingPath: slot.headingPath,
          contextPages: slot.context.map((result) => result.page.relativePath),
          estimatedInputTokens: this.budget.estimateTokens('x'.repeat(chars), ''),
        };
      });
      templatePlans.push({
        template: template.relativePath,
        output: template.outputRelativePath,
        instructions: template.instructions.length,
        batches: batches.map((batch) => batch.plan),
        slots: slotPlans,
      });
    }

    return {
      templates: templatePlans,
      estimatedRequests: templatePlans.reduce(
        (sum, plan) => sum + plan.batches.length,
        0,
      ),
      estimatedInputTokens: templatePlans.reduce(
        (sum, plan) =>
          sum +
          plan.batches.reduce(
            (batchSum, batch) => batchSum + batch.estimatedInputTokens,
            0,
          ),
        0,
      ),
      limits: this.config.limits,
    };
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

      options?.onProgress?.(
        template.relativePath,
        { index: results.length, total: templatePaths.length },
        [],
      );

      try {
        const rendered = await this.renderTemplate(
          template,
          buildContext,
          wikiPages,
          (batchIndex, batchCount, topContextPages) => {
            options?.onProgress?.(
              template.relativePath,
              { index: batchIndex, total: batchCount },
              topContextPages,
            );
          },
          (batchIndex, batchCount, topContextPages) => {
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
