import type { AppConfig } from '../types.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { RerankService } from '../services/rerankService.ts';
import { createTraceLogger, printTraceSummary } from '../services/traceLogger.ts';
import { VectorIndexService } from '../services/vectorIndexService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { withSpinner } from '../utils/spinner.ts';

export default async function indexCmd(config: AppConfig): Promise<void> {
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
    const result = await withSpinner('Indexing wiki vectors…', () =>
      service.buildIndex(),
    );
    console.log(
      `Indexed ${result.indexedChunks} chunk(s) from ${result.indexedPages} wiki page(s).`,
    );
    console.log(
      `Embeddings: ${result.embeddedChunks} new/changed, ${result.reusedChunks} reused.`,
    );
    if (result.skippedChunks > 0) {
      console.warn(
        `Warning: skipped vector embeddings for ${result.skippedChunks} oversized chunk(s) from ${result.skippedPages.length} page(s). Lexical search will still cover those documents.`,
      );
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
