import path from 'node:path';
import type { AppConfig, IngestCommandOptions } from '../types.ts';
import { IngestService } from '../services/ingestService.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { RerankService } from '../services/rerankService.ts';
import { VectorIndexService } from '../services/vectorIndexService.ts';
import { createTraceLogger, printTraceSummary } from '../services/traceLogger.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { Spinner } from '../utils/spinner.ts';
import { summarizeCommit } from '../utils/summary.ts';
import { HistoryService, commitHistorySafely, prepareHistorySafely } from '../services/historyService.ts';

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
    configFile: config.configPath,
    provider: config.llm.provider,
    model: config.llm.model,
    caller: process.env.WIKI_RUN_CALLER,
  });
  console.log(`Trace file: ${logger.displayPath}`);

  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config, logger);
  const refresh = new RefreshService(config, workspace, llm, retrieval, logger);
  const service = new IngestService(config, workspace, llm, retrieval, refresh, logger);

  if (options.apply && !options.migrateSheets) {
    throw new Error('--apply is only valid with --migrate-sheets.');
  }
  if (options.migrateSheets) {
    if (!options.fromIngested || files.length > 0) {
      throw new Error('--migrate-sheets requires --from-ingested and no [files...] (a full archive rebuild).');
    }
    const preview = await service.previewLegacySheetMigration();
    console.log(`TAXO migration preview: ${preview.remove.length} legacy page(s) eligible for removal; ${preview.protected.length} protected page(s) retained.`);
    for (const page of preview.remove) console.log(`  - ${page}`);
    for (const page of preview.protected) console.log(`  = ${page} (stable/verified)`);
    if (!options.apply) {
      console.log('No wiki pages changed. Review this list, then run `wiki ingest --from-ingested --migrate-sheets --apply` on a workspace copy.');
      return;
    }
    if (options.dryRun) throw new Error('--apply and --dry-run cannot be combined.');
  }

  const spinner = options.verbose || options.debug ? null : new Spinner('Ingesting…');
  try {
    const history = new HistoryService(workspace.paths.rootDir, config.history);
    if (!options.dryRun) await prepareHistorySafely(history, 'ingest', logger);
    spinner?.start();
    let tokensLabel = '';
    const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    const taxoWarnings: string[] = [];
    const formatTaxoWarning = (event: string, detail?: Record<string, unknown>): string => {
      const text = (value: unknown) => (value == null ? '' : String(value));
      switch (event) {
        case 'tag-family-degraded':
          return `tag families could not be built (${text(detail?.reason) || 'unknown'})`
            + `${detail?.tags ? ` — ${text(detail.tags)} tag(s) left unfiled` : ''}`;
        case 'tag-family-partial':
          return `${text(detail?.missing) || 'some'} tag(s) missing from the family grouping`
            + `${Array.isArray(detail?.tags) && detail.tags.length ? `: ${detail.tags.join(', ')}` : ''}`;
        case 'tag-unfiled':
          return `tag "${text(detail?.tag)}" has no family — no page written`;
        case 'tag-page-protected':
          return `${text(detail?.path)} kept (stable/verified)`;
        case 'sheet-skipped':
          return `${text(detail?.source)} · ${text(detail?.section)} skipped (${text(detail?.reason) || 'no substantial content'})`;
        case 'sheet-duplicate':
          return `${text(detail?.section)} duplicates ${text(detail?.duplicateOf)} — skipped`;
        case 'sheet-close':
          return `${text(detail?.section)} is close to ${text(detail?.duplicateOf)} — skipped`;
        case 'sheet-fallback':
          return `${text(detail?.section)} kept its raw body (model failed)`;
        case 'sheet-unanchored':
          return `${text(detail?.section)} citation left unanchored`;
        default:
          return `${event}: ${JSON.stringify(detail ?? {})}`;
      }
    };
    const results = await service.ingest(files, {
          ...options,
          force: options.migrateSheets ? true : options.force,
          dryRun: options.dryRun,
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
          onPhase: (phase, detail) => {
            if (phase === 'regroup') {
              const tags = Number(detail?.tags ?? 0);
              spinner?.update(`Organizing tag families${tags > 0 ? ` (${tags} tags)` : ''}…`);
            } else if (phase === 'index') {
              spinner?.update('Regenerating wiki index…');
            }
          },
          onWarning: (event, detail) => {
            taxoWarnings.push(formatTaxoWarning(event, detail));
          },
        });
    if (options.migrateSheets && options.apply) {
      if (results.length === 0 || results.some((result) => result.failed)) {
        throw new Error('TAXO migration stopped before legacy cleanup because the full archive rebuild did not complete successfully.');
      }
      const removed = await service.applyLegacySheetMigration();
      console.log(`TAXO migration applied: ${removed.length} legacy page(s) removed; protected pages were retained.`);
      for (const page of removed) console.log(`  - ${page}`);
    }
    spinner?.stop();
    for (const warning of taxoWarnings.slice(0, 20)) console.warn(`  ⚠️ ${warning}`);
    if (taxoWarnings.length > 20) {
      console.warn(`  ⚠️ … ${taxoWarnings.length - 20} more TAXO warning(s); see the trace file.`);
    }

    if (results.length === 0) {
      console.log(
        options.fromIngested
          ? 'No markdown source found in raw/ingested.'
          : 'No markdown source found in raw/untracked.',
      );
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
      if (result.retry && result.retry.retries > 0) {
        console.log(
          `  Retry: ${result.retry.retries} (${result.retry.classification ?? 'unknown'})`,
        );
      }
      const review = result.review ?? [];
      const reviewedPaths = new Set(review.map((operation) => operation.path));
      for (const operation of review) {
        console.log(
          `  - ${operation.type.toUpperCase()} ${operation.path} [${operation.status}]`,
        );
        console.log(
          `    ${operation.beforeExists ? 'existing' : 'new'} -> ${
            operation.afterExists ? 'present' : 'deleted'
          }, +${operation.diff.addedLines}/-${operation.diff.removedLines}`,
        );
        for (const line of operation.diff.preview.slice(0, 4)) {
          console.log(`    ${line}`);
        }
      }
      for (const operation of result.plan?.operations ?? []) {
        if (!reviewedPaths.has(operation.path)) {
          console.log(`  - ${operation.type.toUpperCase()} ${operation.path}`);
        }
      }
    }

    const failed = results.filter((result) => result.failed);
    if (failed.length > 0) {
      console.error(
        `\nIngest completed with ${failed.length} failed source(s). See ${logger.displayPath}.`,
      );
      process.exitCode = 1;
    }

    const hasChangedSources = results.some((result) => !result.failed && !result.skipped);
    if (!options.dryRun && config.retrieval.vector.enabled && hasChangedSources) {
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
        if (indexResult.skippedChunks > 0) {
          console.warn(
            `Warning: skipped vector embeddings for ${indexResult.skippedChunks} oversized chunk(s) from ${indexResult.skippedPages.length} page(s). Lexical search will still cover those documents.`,
          );
          for (const warning of indexResult.warnings.slice(0, 5)) {
            console.warn(`- ${warning}`);
          }
          if (indexResult.warnings.length > 5) {
            console.warn(
              `- ... ${indexResult.warnings.length - 5} more skipped chunk(s).`,
            );
          }
        }
      } catch (error) {
        console.warn(
          `\nWarning: ingest completed, but vector index update failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        console.warn(
          'Run `wiki index` after fixing the embedding/reranker configuration.',
        );
      }
    }
    if (!options.dryRun && hasChangedSources) {
      // No `scope` here on purpose: ingest holds the `workspace-write` lock,
      // so it is the only writer for its duration and the full versioned
      // scope is exactly what this run produced.
      const changedSources = results
        .filter((result) => !result.failed && !result.skipped)
        .map((result) => path.basename(result.source));
      console.log('Committing history…');
      const historyResult = await commitHistorySafely(history, {
        command: 'ingest',
        message: summarizeCommit('ingest', 'source', changedSources),
      }, logger);
      if (historyResult.sha) {
        await logger.info('history:commit', {
          command: 'ingest',
          sha: historyResult.sha,
          files: historyResult.files,
        });
      }
    }
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
    printTraceSummary(logger);
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
