import type { AppConfig, RefreshCommandOptions } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { createTraceLogger } from '../services/traceLogger.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { Spinner } from '../utils/spinner.ts';

export default async function refreshCmd(
  config: AppConfig,
  templates: string[],
  options: RefreshCommandOptions,
) {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const logger = await createTraceLogger({
    rootDir: workspace.paths.rootDir,
    logsDir: workspace.paths.logsDir,
    command: 'refresh',
    verbose: options.verbose,
    debug: options.debug,
    traceFile: options.traceFile,
    configFile: config.configPath,
    provider: config.llm.provider,
    model: config.llm.model,
    caller: process.env.WIKI_RUN_CALLER,
  });
  console.log(`Trace file: ${logger.displayPath}`);

  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config, logger);
  const service = new RefreshService(config, workspace, llm, retrieval, logger);

  const spinner = options.verbose || options.debug ? null : new Spinner('Building deliverables…');
  try {
    spinner?.start();
    const results = await service.refresh({
      templates,
      force: options.force,
      onPageLoad: (relativePath, index, total) => {
        spinner?.update(`Reading wiki (${index + 1}/${total})…`);
        spinner?.updateSub(relativePath);
      },
      onProgress: (template, batch, topContextPages) => {
        const batchStart = Date.now();
        const name = template.replace(/^templates\//, '').replace(/\.md$/, '');
        spinner?.update(`Building ${name} (batch ${batch.index + 1}/${batch.total})…`);
        const ctx = topContextPages.length > 0 ? topContextPages.join(', ') : template;
        spinner?.updateSub(() => {
          const s = ((Date.now() - batchStart) / 1000).toFixed(1);
          return `${ctx} · retrieval ${s}s`;
        });
      },
      onBatchLlm: (template, batch, topContextPages) => {
        const llmStart = Date.now();
        const name = template.replace(/^templates\//, '').replace(/\.md$/, '');
        spinner?.update(`Building ${name} (batch ${batch.index + 1}/${batch.total})…`);
        const ctx = topContextPages.length > 0 ? topContextPages.join(', ') : template;
        spinner?.updateSub(() => {
          const s = ((Date.now() - llmStart) / 1000).toFixed(1);
          return `${ctx} · LLM ${s}s`;
        });
      },
    });
    spinner?.stop();

    if (results.length === 0) {
      console.log('No template found in templates/.');
      return;
    }

    for (const result of results) {
      console.log(
        `${result.template} -> ${result.output} (${result.skipped ? 'up-to-date' : result.changed ? 'updated' : 'unchanged'})`,
      );
    }
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
  }
}
