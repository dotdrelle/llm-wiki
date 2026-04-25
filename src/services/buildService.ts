import matter from 'gray-matter';
import { deliverableResponseSchema } from '../config/schema.ts';
import { buildDeliverablePrompt } from '../prompts/buildPrompt.ts';
import { sanitizeFrontmatter } from '../utils/markdown.ts';
import { hashText } from '../utils/hash.ts';
import type {
  AppConfig,
  BuildState,
  DeliverableBuildResult,
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

  private async renderTemplate(template: TemplateDocument): Promise<string> {
    if (template.instructions.length === 0) {
      const outputFrontmatter = sanitizeFrontmatter(template.frontmatter);
      return Object.keys(outputFrontmatter).length > 0
        ? matter.stringify(template.content.trim(), outputFrontmatter)
        : `${template.content.trim()}\n`;
    }

    const slots = await Promise.all(
      template.instructions.map(async (instruction) => ({
        id: instruction.id,
        instruction: instruction.instruction,
        headingPath: instruction.headingPath,
        surroundingText: instruction.surroundingText,
        context: await this.retrieval.search(
          `${instruction.headingPath.join(' ')} ${instruction.instruction}`,
          { limit: this.config.retrieval.maxContextFiles, includeRaw: false },
        ),
      })),
    );

    const batchSize = this.config.build.slotBatchSize;
    const batchCount = Math.ceil(slots.length / batchSize);
    const replacements = new Map<string, string>();

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const batch = slots.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
      const prompt = buildDeliverablePrompt({
        template,
        slots: batch,
        maxChunkChars: this.config.retrieval.maxChunkChars,
      });
      const response = await this.llm.completeJson(
        {
          ...prompt,
          label: 'deliverable_render',
          logger: this.logger,
          traceData: {
            template: template.relativePath,
            instructionCount: template.instructions.length,
            batchIndex,
            batchCount,
          },
        },
        deliverableResponseSchema,
      );
      for (const item of response.replacements) {
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

  private nextState(state: BuildState): BuildState {
    return {
      deliverables: { ...state.deliverables },
    };
  }

  async build(options?: {
    templates?: string[];
    force?: boolean;
    changedOnly?: boolean;
  }): Promise<DeliverableBuildResult[]> {
    await this.workspace.ensureInitialized();
    const templatePaths = await this.workspace.resolveTemplateInputs(options?.templates ?? []);
    const wikiHash = await this.workspace.computeWikiHash();
    const previousState = await this.workspace.readBuildState();
    const nextState = this.nextState(previousState);
    const results: DeliverableBuildResult[] = [];

    if (this.logger) {
      await this.logger.info('build:run-start', {
        templateCount: templatePaths.length,
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

      try {
        const rendered = await this.renderTemplate(template);
        const changed = await this.workspace.writeDeliverable(template.outputAbsolutePath, rendered);

        nextState.deliverables[template.relativePath] = {
          templateHash,
          wikiHash,
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
