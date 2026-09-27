import type { AppConfig } from '../types.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { RerankService } from '../services/rerankService.ts';
import { createTraceLogger, printTraceSummary } from '../services/traceLogger.ts';
import { VectorIndexService } from '../services/vectorIndexService.ts';
import { regenerateWikiIndex } from '../services/wikiIndexService.ts';
import {
  applyWorkspaceOverview,
  draftWorkspaceOverview,
  readWorkspaceOverviewEvidence,
  readWorkspaceOverviewDraft,
  saveWorkspaceOverviewDraft,
} from '../services/workspaceOverviewService.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { withSpinner } from '../utils/spinner.ts';

export default async function indexCmd(
  config: AppConfig,
  options: { overview?: boolean; applyOverview?: boolean } = {},
): Promise<void> {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const logger = await createTraceLogger({
    rootDir: workspace.paths.rootDir,
    logsDir: workspace.paths.logsDir,
    command: 'index',
    configFile: config.configPath,
    provider: config.llm.provider,
    model: config.llm.model,
    caller: process.env.WIKI_RUN_CALLER,
  });
  console.log(`Trace file: ${logger.displayPath}`);
  const service = new VectorIndexService(
    config,
    workspace,
    new EmbeddingService(config, logger),
    new RerankService(config, logger, workspace.paths.rerankCacheDir),
  );
  try {
    if (options.overview && options.applyOverview) {
      throw new Error('Generate and apply the overview in separate commands so you can review the draft first.');
    }
    if (options.overview) {
      const draft = await withSpinner('Drafting workspace overview…', () =>
        draftWorkspaceOverview({
          contextSize: config.llm.numCtx,
          llmConfig: config.llm,
          workspace,
          llm: new LLMService(config),
          logger,
        }),
      );
      console.log(`\nWorkspace overview draft (${draft.evidencePaths.length} evidence page(s)):\n`);
      console.log(draft.overview);
      if (draft.omittedPages > 0) {
        console.warn(`\nWarning: ${draft.omittedPages} evidence page(s) were omitted by the context limit.`);
      }
      const draftPath = await saveWorkspaceOverviewDraft(workspace, draft.overview, draft.evidence);
      console.log(`\nDraft saved to ${draftPath}. Review and edit it before applying.`);
    }
    if (options.applyOverview) {
      const overview = await readWorkspaceOverviewDraft(workspace);
      const evidence = await readWorkspaceOverviewEvidence(workspace);
      const applied = await applyWorkspaceOverview(workspace, overview, evidence);
      console.log('\nApplied the reviewed draft to the marked overview section in wiki/index.md.');
      if (applied.legacyBackupPath) {
        console.log(`The previous unmarked index is preserved at ${applied.legacyBackupPath}.`);
      }
    }
    const wikiIndex = await regenerateWikiIndex(workspace.paths.rootDir);
    if (wikiIndex.status === 'failed') {
      await logger.warn('index:wiki-map-regeneration-failed', {
        error: wikiIndex.error instanceof Error ? wikiIndex.error.message : String(wikiIndex.error),
      });
      console.warn('Warning: the generated wiki map was not refreshed; preserving its existing content.');
    }
    const result = await withSpinner('Indexing wiki vectors…', () =>
      service.buildIndex(),
    );
    console.log(
      `Indexed ${result.indexedChunks} chunk(s) from ${result.indexedPages} wiki page(s) and archived document(s).`,
    );
    console.log(
      `Embeddings: ${result.embeddedChunks} new/changed, ${result.reusedChunks} reused.`,
    );
    if (result.warnings.length > 0) {
      if (result.skippedChunks > 0) {
        console.warn(
          `Warning: skipped vector embeddings for ${result.skippedChunks} oversized chunk(s) from ${result.skippedPages.length} page(s). Lexical search will still cover those documents.`,
        );
      } else {
        console.warn('Warning: some content was indexed with a fallback.');
      }
      for (const warning of result.warnings.slice(0, 5)) {
        console.warn(`- ${warning}`);
      }
      if (result.warnings.length > 5) {
        console.warn(`- ... ${result.warnings.length - 5} more skipped chunk(s).`);
      }
    }
    if (result.rebuiltForConfigChange) {
      console.warn(
        'Existing vector index was built with different embedding settings and was rebuilt.',
      );
    }
  } finally {
    await logger.close();
    printTraceSummary(logger);
  }
}
