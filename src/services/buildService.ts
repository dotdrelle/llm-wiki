import { rm } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { deliverableResponseSchema } from '../config/schema.ts';
import {
  buildDeliverablePrompt,
  buildSingleSlotDeliverablePrompt,
} from '../prompts/buildPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import {
  canonicalizeSourceCitations,
  extractSourceCitations,
  sanitizeFrontmatter,
} from '../utils/markdown.ts';
import { hashText } from '../utils/hash.ts';
import { pathExists } from '../utils/fs.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { PromptBudgetService } from './promptBudgetService.ts';
import { StabilizeService } from './stabilizeService.ts';
import type {
  AppConfig,
  BuildBatchPlan,
  BuildContext,
  BuildRunPlan,
  BuildState,
  BuildSlotPlan,
  DeliverableBuildResult,
  SearchResult,
  StabilizeDiff,
  TemplateDocument,
  WikiPage,
} from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalSearchOptions, RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

const FINAL_CONTEXT_EXCLUDED_PATHS = new Set(['wiki/index.md', 'wiki/log.md']);
const PLAN_WORDS_EXCLUDED = new Set([
  'dans',
  'avec',
  'pour',
  'des',
  'les',
  'une',
  'section',
  'document',
  'template',
]);

function normalizeReplacementContent(content: string): string {
  // canonicalizeSourceCitations enforces the single authorized citation
  // format ([src: path]) as soon as model output enters the document: models
  // frequently emit variants ("[ src: ... ]", chained "; src:") that would
  // otherwise escape citation-based tooling downstream.
  return canonicalizeSourceCitations(
    content
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\`/g, '`')
      .trim(),
  );
}

function normalizeHeadingTextForCompare(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

function stripRepeatedSlotHeading(content: string, headingPath: string[]): string {
  const expected = headingPath.at(-1);
  if (!expected) return content;
  const lines = content.split('\n');
  const firstMeaningfulIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstMeaningfulIndex < 0) return content;
  const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[firstMeaningfulIndex] ?? '');
  if (!heading) return content;
  if (
    normalizeHeadingTextForCompare(heading[2]) !==
    normalizeHeadingTextForCompare(expected)
  ) {
    return content;
  }
  lines.splice(firstMeaningfulIndex, 1);
  return lines.join('\n').trim();
}

function normalizeReplacementHeadingLevels(
  content: string,
  parentHeadingLevel: number,
): string {
  if (parentHeadingLevel <= 0) return content;
  const firstHeading = /^(#{1,6})\s+.+$/m.exec(content);
  if (!firstHeading) return content;
  const firstLevel = firstHeading[1].length;
  const delta = parentHeadingLevel + 1 - firstLevel;
  if (delta <= 0) return content;

  return content.replace(/^(#{1,6})(\s+.+)$/gm, (_match, marks: string, rest: string) => {
    const nextLevel = Math.min(6, marks.length + delta);
    return `${'#'.repeat(nextLevel)}${rest}`;
  });
}

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
          intent: 'build',
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
    options: RetrievalSearchOptions,
  ): Promise<SearchResult[]> {
    const key = JSON.stringify({
      query,
      limit: options.limit,
      includeRaw: options.includeRaw ?? false,
      rerank: options.rerank ?? true,
      intent: options.intent ?? 'search',
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
    const profileSection = await this.workspace.loadProfileSection(
      this.config.limits.maxProfileChars,
    );
    const prompt = buildSingleSlotDeliverablePrompt({
      template,
      slot,
      buildContext: buildContext.content,
      maxChunkChars: this.config.retrieval.maxChunkChars,
      ctx: buildPromptContext(this.config, { profileSection }),
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
    const batchErrors: Error[] = [];

    const renderedBatches = await mapWithConcurrency(
      batches,
      this.config.limits.maxInFlightRequests ?? 3,
      async (plannedBatch, batchIndex) => {
        const batch = plannedBatch.slots;
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
        try {
          return await this.renderBatch(template, buildContext, batch, traceData);
        } catch (error) {
          // A single failed batch (timeout, malformed JSON, provider error)
          // must not discard the work of every other batch: its slots fall
          // back to the "Missing evidence" placeholder and the deliverable is
          // still produced. The template only fails when every batch fails.
          batchErrors.push(error instanceof Error ? error : new Error(String(error)));
          if (this.logger) {
            await this.logger.warn('build:batch-failed', {
              ...traceData,
              slots: batch.map((slot) => slot.id),
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return [];
        }
      },
    );

    if (batchCount > 0 && batchErrors.length === batchCount) {
      throw batchErrors[0];
    }
    for (const response of renderedBatches) {
      for (const item of response) {
        const instruction = template.instructions.find(({ id }) => id === item.id);
        const normalized = normalizeReplacementContent(item.content);
        replacements.set(
          item.id,
          instruction
            ? normalizeReplacementHeadingLevels(
                stripRepeatedSlotHeading(normalized, instruction.headingPath),
                instruction.headingLevel,
              )
            : normalized,
        );
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
                intent: 'build',
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
            intent: 'build',
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
              intent: 'build',
            }),
          ),
        );
        const rerankQuery = `${instruction.headingPath.join(' ')} ${instruction.instruction}`;
        const mergedContext = this.mergeContextResults(
          [primaryContext, ...templateFocusContexts.values(), ...focusContexts].flat(),
        );
        const rankedContext =
          this.config.retrieval.buildStrategy === 'hybrid' &&
          typeof this.retrieval.rerankResults === 'function'
            ? await this.retrieval.rerankResults(rerankQuery, mergedContext, {
                limit: Math.max(24, this.config.retrieval.vector.maxResults),
              })
            : mergedContext;
        // Cap the per-slot context to the configured budget. Reranking may
        // consider up to 24 candidates for quality, but only the top chunks
        // are sent to the model: without this cap a 40-instruction template
        // produces 100K+ char prompts per batch. Multi-query slots (named
        // comparisons, focused lists) keep a proportionally larger, still
        // bounded, allowance via contextLimitForQueryCount.
        const queryCount =
          1 +
          Math.min(templateFocusQueries.length, 6) +
          Math.min(instructionFocusQueries.length, 6);
        const contextLimit = this.contextLimitForQueryCount(queryCount);
        const finalContext = this.prepareFinalContext(rankedContext).slice(
          0,
          contextLimit,
        );
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

  private prepareSlotsForPlan(
    template: TemplateDocument,
    wikiPages: WikiPage[],
  ): Array<{
    id: string;
    instruction: string;
    headingPath: string[];
    surroundingText: string;
    context: SearchResult[];
  }> {
    const candidates = wikiPages.filter(
      (page) =>
        !FINAL_CONTEXT_EXCLUDED_PATHS.has(page.relativePath) && page.type !== 'answer',
    );
    const limit = Math.max(1, this.config.retrieval.maxContextFiles);

    return template.instructions.map((instruction) => {
      const queryWords = this.planQueryWords(
        `${instruction.headingPath.join(' ')} ${instruction.instruction}`,
      );
      const scored = candidates
        .map((page) => ({
          page,
          score: this.planPageScore(page, queryWords),
        }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return {
        id: instruction.id,
        instruction: instruction.instruction,
        headingPath: instruction.headingPath,
        surroundingText: instruction.surroundingText,
        context: scored,
      };
    });
  }

  private planQueryWords(text: string): string[] {
    return [
      ...new Set(
        text
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .match(/[a-z0-9-]{3,}/g)
          ?.filter((word) => !PLAN_WORDS_EXCLUDED.has(word)) ?? [],
      ),
    ].slice(0, 24);
  }

  private planPageScore(page: WikiPage, queryWords: string[]): number {
    if (queryWords.length === 0) return 0;
    const pathAndTitle = `${page.relativePath} ${page.name}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const content = page.content
      .slice(0, Math.max(this.config.retrieval.maxChunkChars * 4, 8000))
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    let score = 0;
    for (const word of queryWords) {
      if (pathAndTitle.includes(word)) score += 3;
      if (content.includes(word)) score += 1;
    }
    return score;
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
          .map((item) => `${item} démonstration outil solution candidate ACME`),
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
      const wouldExceedSlotCap =
        maxSlotsPerBatch !== undefined && candidate.length > maxSlotsPerBatch;
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
    fastContext?: boolean;
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
      const slots = options?.fastContext
        ? this.prepareSlotsForPlan(template, wikiPages)
        : await this.prepareSlots(template, wikiPages);
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
    const profileSection = await this.workspace.loadProfileSection(
      this.config.limits.maxProfileChars,
    );
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
      ctx: buildPromptContext(this.config, { profileSection }),
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
      const qualityIssue = this.replacementQualityIssue(batch, response.replacements);
      if (qualityIssue) {
        if (batch.length > 1) {
          if (this.logger) {
            await this.logger.warn('build:batch-split', {
              ...traceData,
              slots: batch.length,
              reason: qualityIssue,
            });
          }
          return this.renderSplitBatch(template, buildContext, batch, traceData);
        }
        if (this.logger) {
          await this.logger.warn('build:json-fallback', {
            ...traceData,
            slot: batch[0].id,
            reason: qualityIssue,
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
        return this.renderSplitBatch(template, buildContext, batch, traceData);
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

  private replacementQualityIssue(
    batch: Array<{ id: string }>,
    replacements: Array<{ id: string; content: string }>,
  ): string | undefined {
    const expectedIds = new Set(batch.map((slot) => slot.id));
    const seen = new Set<string>();
    for (const replacement of replacements) {
      if (!expectedIds.has(replacement.id)) return 'unexpected_replacement';
      if (seen.has(replacement.id)) return 'duplicate_replacement';
      seen.add(replacement.id);
      if (!replacement.content.trim()) return 'empty_replacement';
    }
    for (const id of expectedIds) {
      if (!seen.has(id)) return 'missing_replacement';
    }
    return undefined;
  }

  private async renderSplitBatch(
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

  // The build guarantees the citation contract of its deliverables: every
  // [src: ...] marker must point to an existing workspace file. Models
  // sometimes cite plausible but nonexistent paths; exports would silently
  // fail to resolve them later, so surface the issue at build time.
  private async reportMissingCitations(
    templateRelativePath: string,
    rendered: string,
  ): Promise<void> {
    const missing: string[] = [];
    for (const citation of [...new Set(extractSourceCitations(rendered))]) {
      const absolute = path.resolve(this.workspace.paths.rootDir, citation);
      const relative = path.relative(this.workspace.paths.rootDir, absolute);
      if (
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        !(await pathExists(absolute))
      ) {
        missing.push(citation);
      }
    }
    if (missing.length > 0 && this.logger) {
      await this.logger.warn('build:missing-citation', {
        template: templateRelativePath,
        citations: missing,
      });
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
    stabilize?: boolean;
    onStabilize?: (template: string, output: string) => void;
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
        stabilize: Boolean(options?.stabilize),
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
        let rendered = await this.renderTemplate(
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
        let changed = false;
        let stabilized: StabilizeDiff | undefined;
        if (options?.stabilize) {
          options.onStabilize?.(template.relativePath, template.outputRelativePath);
          const tmpPath = this.workspace.deriveTmpDeliverablePath(
            template.outputAbsolutePath,
          );
          try {
            const existing = await this.workspace.readDeliverableIfExists(
              template.outputAbsolutePath,
            );
            if (existing !== null) {
              await this.logger?.info('build:stabilize-start', {
                template: template.relativePath,
                output: template.outputRelativePath,
                tmpPath,
                existingSize: existing.length,
                newSize: rendered.length,
              });
              await this.workspace.writeDeliverable(tmpPath, rendered);
              const result = await new StabilizeService(
                this.config,
                this.llm,
                this.logger,
              ).stabilize(existing, rendered);
              rendered = result.markdown;
              stabilized = result.diff;
              changed = await this.workspace.writeDeliverable(
                template.outputAbsolutePath,
                rendered,
              );
              await this.workspace.writeChangesSidecar(
                template.outputAbsolutePath,
                result.diff,
              );
            } else {
              changed = await this.workspace.writeDeliverable(
                template.outputAbsolutePath,
                rendered,
              );
              await this.workspace.deleteChangesSidecarIfExists(
                template.outputAbsolutePath,
              );
            }
          } catch (error) {
            await this.logger?.error('build:stabilize-failed', {
              template: template.relativePath,
              output: template.outputRelativePath,
              tmpPath,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            await rm(tmpPath, { force: true });
          }
        } else {
          changed = await this.workspace.writeDeliverable(
            template.outputAbsolutePath,
            rendered,
          );
          await this.workspace.deleteChangesSidecarIfExists(template.outputAbsolutePath);
        }

        await this.reportMissingCitations(template.relativePath, rendered);

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
          stabilized,
        });

        if (this.logger) {
          await this.logger.info('build:template-done', {
            template: template.relativePath,
            output: template.outputRelativePath,
            changed,
            stabilized,
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
