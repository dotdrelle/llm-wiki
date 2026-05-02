import path from 'node:path';
import type { AppConfig, IngestCommandOptions } from '../types.ts';
import { IngestService } from '../services/ingestService.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { createTraceLogger } from '../services/traceLogger.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { Spinner } from '../utils/spinner.ts';

const SUBCOMMANDS = new Set(['init', 'ingest', 'query', 'lint', 'build', 'refresh', 'serve', 'doctor']);

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
    const fmtTok = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const results = await service.ingest(files, {
      ...options,
      onSourceStart: (sourcePath, index, total) => {
        tokensLabel = '';
        const name = path.basename(sourcePath, '.md');
        spinner?.update(`Ingesting ${name} (${index + 1}/${total})…`);
        spinner?.updateSub(undefined);
      },
      onSourceLlm: (sourcePath, index, total) => {
        tokensLabel = '';
        const llmStart = Date.now();
        const name = path.basename(sourcePath, '.md');
        spinner?.update(`Ingesting ${name} (${index + 1}/${total})…`);
        spinner?.updateSub(() => {
          const s = ((Date.now() - llmStart) / 1000).toFixed(1);
          return `${name} · LLM ${s}s${tokensLabel}`;
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
      console.error(`\nIngest completed with ${failed.length} failed source(s). See ${logger.displayPath}.`);
      process.exitCode = 1;
    }
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
  }
}
