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
import type { WorkspaceService } from './workspaceService.ts';

export class BuildService {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly retrieval: RetrievalService;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
  ) {
    this.config = config;
    this.workspace = workspace;
    this.llm = llm;
    this.retrieval = retrieval;
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

    const prompt = buildDeliverablePrompt({
      template,
      slots,
    });
    const response = await this.llm.completeJson(prompt, deliverableResponseSchema);

    const replacements = new Map(response.replacements.map((item) => [item.id, item.content.trim()]));
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

    for (const templatePath of templatePaths) {
      const template = await this.workspace.readTemplateDocument(templatePath);
      const templateHash = await this.workspace.computeTemplateHash(template);
      const prior = previousState.deliverables[template.relativePath];
      const isFresh =
        prior &&
        prior.templateHash === templateHash &&
        prior.wikiHash === wikiHash &&
        !options?.force;

      if (options?.changedOnly && isFresh) {
        results.push({
          template: template.relativePath,
          output: template.outputRelativePath,
          changed: false,
          skipped: true,
        });
        continue;
      }

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
    }

    await this.workspace.writeBuildState(nextState);
    return results;
  }
}
