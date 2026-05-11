import path from 'node:path';
import type { AppConfig, IngestCommandOptions } from '../types.ts';
import { IngestService } from '../services/ingestService.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { RerankService } from '../services/rerankService.ts';
import { VectorIndexService } from '../services/vectorIndexService.ts';
import { createTraceLogger } from '../services/traceLogger.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { Spinner } from '../utils/spinner.ts';

const SUBCOMMANDS = new Set([
  'init',
  'ingest',
  'query',
  'index',
  'lint',
  'build',
  'refresh',
  'serve',
  'doctor',
]);

export default async function ingestCmd(
  config: AppConfig,
  files: string[],
  options: IngestCommandOptions,
) {
  const suspicious = files.filter((f) => SUBCOMMANDS.has(f));
  if (suspicious.length > 0) {
    console.error(
      `Error: "${suspicious.join('", "')}" is a wiki subcommand, not a file.\n` +
        `Did you mean to run the commands separately?\n` +
        `  wiki ingest\n` +
        `  wiki ${suspicious.join('\n  wiki ')}`,
    );
    process.exit(1);
  }

  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const logger = await createTraceLogger({
    rootDir: workspace.paths.rootDir,
    logsDir: workspace.paths.logsDir,
    command: 'ingest',
    verbose: options.verbose,
    debug: options.debug,
    traceFile: options.traceFile,
  });
  console.log(`Trace file: ${logger.displayPath}`);

  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config);
  const refresh = new RefreshService(config, workspace, llm, retrieval, logger);
  const service = new IngestService(config, workspace, llm, retrieval, refresh, logger);

  const spinner = options.verbose || options.debug ? null : new Spinner('Ingesting…');
  try {
    spinner?.start();
    let tokensLabel = '';
    const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    const results = await service.ingest(files, {
      ...options,
      onSourceStart: (sourcePath, index, total) => {
        tokensLabel = '';
        const name = path.basename(sourcePath, '.md');
        spinner?.update(`Ingesting ${name} (${index + 1}/${total})…`);
        spinner?.updateSub(undefined);
      },
      onSourceLlm: (sourcePath, index, total, progress) => {
        tokensLabel = '';
        const llmStart = Date.now();
        const name = path.basename(sourcePath, '.md');
        const sectionLabel =
          progress && progress.sectionTotal > 1
            ? `, section ${progress.sectionIndex + 1}/${progress.sectionTotal}`
            : '';
        spinner?.update(`Ingesting ${name} (${index + 1}/${total}${sectionLabel})…`);
        spinner?.updateSub(() => {
          const s = ((Date.now() - llmStart) / 1000).toFixed(1);
          const subSection =
            progress && progress.sectionTotal > 1
              ? `section ${progress.sectionIndex + 1}/${progress.sectionTotal} · `
              : '';
          return `${name} · ${subSection}LLM ${s}s${tokensLabel}`;
        });
      },
      onSourceUsage: (_sourcePath, _index, _total, usage) => {
        tokensLabel = ` · ${fmtTok(usage.inputTokens)}in ${fmtTok(usage.outputTokens)}out`;
      },
    });
    spinner?.stop();

    if (results.length === 0) {
      console.log('No markdown source found in raw/untracked.');
      return;
    }

    for (const result of results) {
      if (result.failed) {
        console.error(`\n${result.source} (failed)`);
        console.error(`  Error: ${result.error ?? 'unknown error'}`);
        continue;
      }
      if (result.skipped) {
        console.log(`\n${result.source} (skipped — unchanged since last ingest)`);
        continue;
      }
      console.log(`\n${result.source}`);
      console.log(`  Summary: ${result.plan?.summary ?? ''}`);
      for (const operation of result.plan?.operations ?? []) {
        console.log(`  - ${operation.type.toUpperCase()} ${operation.path}`);
      }
    }

    const failed = results.filter((result) => result.failed);
    if (failed.length > 0) {
      console.error(
        `\nIngest completed with ${failed.length} failed source(s). See ${logger.displayPath}.`,
      );
      process.exitCode = 1;
    } else if (!options.dryRun && config.retrieval.vector.enabled) {
      const vectorIndex = new VectorIndexService(
        config,
        workspace,
        new EmbeddingService(config),
        new RerankService(config),
      );
      try {
        const indexResult = await withIndexSpinner(() => vectorIndex.buildIndex());
        console.log(
          `\nVector index updated: ${indexResult.indexedChunks} chunk(s), ${indexResult.embeddedChunks} new/changed, ${indexResult.reusedChunks} reused.`,
        );
      } catch (error) {
        console.warn(
          `\nWarning: ingest completed, but vector index update failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        console.warn('Run `wiki index` after fixing the embedding/reranker configuration.');
      }
    }
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
  }
}

async function withIndexSpinner<T>(task: () => Promise<T>): Promise<T> {
  const spinner = new Spinner('Updating vector index…');
  spinner.start();
  try {
    const result = await task();
    spinner.stop();
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}
