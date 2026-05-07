import path from 'node:path';
import { semanticLintSchema } from '../config/schema.ts';
import { buildSemanticLintPrompt } from '../prompts/lintPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { extractSourceCitations, extractWikiLinks } from '../utils/markdown.ts';
import { canonicalizeName } from '../utils/path.ts';
import { pathExists } from '../utils/fs.ts';
import type { AppConfig, LintReport } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { WorkspaceService } from './workspaceService.ts';

export class LintService {
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly config: AppConfig;

  constructor(
    workspace: WorkspaceService,
    llm: LLMService,
    config: AppConfig,
  ) {
    this.workspace = workspace;
    this.llm = llm;
    this.config = config;
  }

  async run(options?: { withLlm?: boolean }): Promise<LintReport> {
    await this.workspace.ensureInitialized();
    const pages = await this.workspace.listWikiPages();
    const pageTargets = new Set(pages.map((page) => canonicalizeName(page.name)));
    const incomingLinks = new Map<string, number>();
    const deadLinks: Array<{ file: string; link: string }> = [];
    const missingSources: Array<{ file: string; citation: string }> = [];

    for (const page of pages) {
      for (const link of extractWikiLinks(page.content)) {
        const canonicalLink = canonicalizeName(link);
        if (pageTargets.has(canonicalLink)) {
          incomingLinks.set(canonicalLink, (incomingLinks.get(canonicalLink) ?? 0) + 1);
        } else {
          deadLinks.push({ file: page.relativePath, link });
        }
      }

      for (const citation of extractSourceCitations(page.content)) {
        const absoluteCitationPath = path.resolve(this.workspace.paths.rootDir, citation);
        const relativeCitationPath = path.relative(
          this.workspace.paths.rootDir,
          absoluteCitationPath,
        );
        const escapesRoot =
          relativeCitationPath.startsWith('..') || path.isAbsolute(relativeCitationPath);

        if (escapesRoot || !(await pathExists(absoluteCitationPath))) {
          missingSources.push({ file: page.relativePath, citation });
        }
      }
    }

    const orphanPages = pages
      .filter((page) => page.type !== 'index' && page.type !== 'other')
      .filter((page) => (incomingLinks.get(canonicalizeName(page.name)) ?? 0) === 0)
      .map((page) => page.relativePath);

    const templates = await this.workspace.listTemplatePaths();
    const state = await this.workspace.readBuildState();
    const wikiHash = await this.workspace.computeWikiHash();
    const staleDeliverables: string[] = [];

    for (const templatePath of templates) {
      const template = await this.workspace.readTemplateDocument(templatePath);
      const templateHash = await this.workspace.computeTemplateHash(template);
      const buildInfo = state.deliverables[template.relativePath];
      if (
        !buildInfo ||
        buildInfo.templateHash !== templateHash ||
        buildInfo.wikiHash !== wikiHash ||
        !(await pathExists(template.outputAbsolutePath))
      ) {
        staleDeliverables.push(template.outputRelativePath);
      }
    }

    const unresolvedInstructions: string[] = [];
    for (const deliverablePath of await this.workspace.listDeliverablePaths()) {
      const content = await this.workspace.readTextFile(deliverablePath);
      if (content.includes('[[INSTRUCTION:')) {
        unresolvedInstructions.push(
          path.relative(this.workspace.paths.rootDir, deliverablePath).split(path.sep).join('/'),
        );
      }
    }

    const report: LintReport = {
      deadLinks,
      orphanPages,
      missingSources,
      staleDeliverables,
      unresolvedInstructions,
    };

    if (options?.withLlm) {
      const prompt = buildSemanticLintPrompt(
        await this.workspace.readIndex(),
        pages,
        buildPromptContext(this.config),
      );
      report.semantic = await this.llm.completeJson(prompt, semanticLintSchema);
    }

    return report;
  }
}
