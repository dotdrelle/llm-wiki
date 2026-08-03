import { HistoryService, historyLoggerWarning } from '../services/historyService.ts';
import { createTraceLogger, printTraceSummary } from '../services/traceLogger.ts';
import type { AppConfig } from '../types.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { RerankService } from '../services/rerankService.ts';
import { VectorIndexService } from '../services/vectorIndexService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function restoreCmd(
  config: AppConfig,
  options: { file?: string; run?: string; to?: string; dryRun?: boolean },
): Promise<void> {
  if ((!options.file && !options.run) || (options.file && options.run) || (options.file && !options.to)) {
    throw new Error('wiki restore requires --run <sha>, or --file <path> --to <sha>.');
  }
  const history = new HistoryService(config.wikiRoot, config.history);
  const result = options.run
    ? await history.restoreRun(options.run, { dryRun: options.dryRun })
    : await history.restoreFile(options.file!, options.to!, { dryRun: options.dryRun });
  const restoredFiles = 'restoredFiles' in result ? result.restoredFiles : result.files;
  if (options.dryRun) {
    console.log(
      options.run
        ? `Would restore run ${options.run} (${restoredFiles.length} file(s))`
        : `${'existed' in result && result.existed ? 'Would restore' : 'Would remove'} ${options.file} from ${options.to}`,
    );
    return;
  }
  const logger = await createTraceLogger({
    rootDir: config.wikiRoot,
    logsDir: `${config.wikiRoot}/.wiki/logs`,
    command: 'restore',
    configFile: config.configPath,
    provider: config.llm.provider,
    model: config.llm.model,
  });
  try {
    await historyLoggerWarning(logger, result);
    let reindexed = false;
    if (
      !options.dryRun &&
      config.retrieval.vector.enabled &&
      restoredFiles.some((file) => file === 'wiki' || file.startsWith('wiki/'))
    ) {
      try {
        const indexResult = await new VectorIndexService(
          config,
          new WorkspaceService(config),
          new EmbeddingService(config),
          new RerankService(config),
        ).buildIndex();
        reindexed = Boolean(indexResult);
      } catch (error) {
        await logger.warn('history:restore-index-warning', {
          message: error instanceof Error ? error.message : String(error),
        });
        console.warn(`Warning: restore succeeded but vector index update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (result.sha) {
      await logger.info('history:restore', {
        mode: options.run ? 'run' : 'file',
        target: options.run ?? options.file,
        sha: result.sha,
        restoredFiles,
        reindexed,
        warnings: result.warnings,
      });
    }
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log(
      options.run
        ? `Restored run ${options.run}`
        : `Restored ${options.file} from ${options.to}`,
    );
  } finally {
    await logger.close();
    printTraceSummary(logger);
  }
}
