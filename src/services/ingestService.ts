import path from 'node:path';
import { ingestPlanSchema } from '../config/schema.ts';
import { buildIngestPrompt } from '../prompts/ingestPrompt.ts';
import type { AppConfig, IngestPlan } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RefreshService } from './refreshService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { WorkspaceService } from './workspaceService.ts';

export class IngestService {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly retrieval: RetrievalService;
  private readonly refresh: RefreshService;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
    refresh: RefreshService,
  ) {
    this.config = config;
    this.workspace = workspace;
    this.llm = llm;
    this.retrieval = retrieval;
    this.refresh = refresh;
  }

  async ingest(
    inputs: string[],
    options?: { dryRun?: boolean; refresh?: boolean },
  ): Promise<Array<{ source: string; plan: IngestPlan }>> {
    await this.workspace.ensureInitialized();
    const sourcePaths = await this.workspace.resolveSourceInputs(inputs);
    const results: Array<{ source: string; plan: IngestPlan }> = [];

    for (const sourcePath of sourcePaths) {
      const source = await this.workspace.readSourceDocument(sourcePath);
      const relevantPages = await this.retrieval.search(source.body || source.title, {
        limit: this.config.retrieval.maxContextFiles,
        includeRaw: false,
      });
      const sourcePagePath = path.posix.join('wiki', 'sources', `${source.slug}.md`);
      const prompt = buildIngestPrompt({
        source,
        indexContent: await this.workspace.readIndex(),
        relevantPages,
        sourcePagePath,
      });
      const plan = await this.llm.completeJson(prompt, ingestPlanSchema);

      results.push({
        source: source.relativePath,
        plan,
      });

      if (!options?.dryRun) {
        await this.workspace.applyWikiOperations(plan.operations);
        await this.workspace.archiveSource(source);
        await this.workspace.appendLog(
          'ingest',
          `${source.relativePath} -> ${source.archiveCitationPath} (${plan.summary})`,
        );
      }
    }

    if (!options?.dryRun && options?.refresh !== false && this.config.build.refreshOnIngest) {
      await this.refresh.refresh();
    }

    return results;
  }
}
