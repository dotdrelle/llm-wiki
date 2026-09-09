import path from 'node:path';
import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { createTraceLogger, printTraceSummary } from '../services/traceLogger.ts';
import { expandDeliverable, exportOutputPath } from '../services/exportService.ts';
import { safeWriteFile, pathExists } from '../utils/fs.ts';
import { normalizeGeneratedMarkdown } from '../utils/markdown.ts';
import { resolveInside, relativeFrom } from '../utils/path.ts';
import { Spinner } from '../utils/spinner.ts';
import { HistoryService, commitHistorySafely, prepareHistorySafely } from '../services/historyService.ts';

interface ExportOptions {
  output?: string;
  polish?: boolean;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
}

export default async function exportCmd(
  config: AppConfig,
  input: string,
  options: ExportOptions,
): Promise<void> {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();

  const logger = await createTraceLogger({
    rootDir: workspace.paths.rootDir,
    logsDir: workspace.paths.logsDir,
    command: 'export',
    verbose: options.verbose,
    debug: options.debug,
    traceFile: options.traceFile,
    configFile: config.configPath,
    provider: config.llm.provider,
    model: config.llm.model,
    caller: process.env.WIKI_RUN_CALLER,
  });
  console.log(`Trace file: ${logger.displayPath}`);

  const spinner =
    options.verbose || options.debug ? null : new Spinner('Preparing export…');

  try {
    const history = new HistoryService(workspace.paths.rootDir, config.history);
    await prepareHistorySafely(history, options.polish ? 'polish' : 'export', logger);
    spinner?.start();
    spinner?.updateSub(input);

    const candidates = [
      resolveInside(workspace.paths.rootDir, input),
      resolveInside(workspace.paths.deliverablesDir, input),
    ];

    let absoluteInput: string | undefined;
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        absoluteInput = candidate;
        break;
      }
    }

    // Both candidates are FLAT. A deliverable built into deliverables/technical/
    // is therefore invisible to its own name, and the caller — Donna included,
    // since the listing shows bare names — either got "not found" or, when a
    // stray file of that name sat at the root, exported THAT one and wrote the
    // result beside it instead of next to the build.
    if (!absoluteInput) {
      const deliverables = await workspace.listDeliverablePaths();
      const wanted = path.basename(input);
      const matches = deliverables.filter((file) => path.basename(file) === wanted);
      if (matches.length === 1) absoluteInput = matches[0];
      else if (matches.length > 1) {
        throw new Error(
          `Several deliverables are named ${wanted}: ${matches
            .map((file) => relativeFrom(workspace.paths.rootDir, file))
            .join(', ')}. Pass the full path.`,
        );
      }
    }

    if (!absoluteInput) {
      const available = (await workspace.listDeliverablePaths())
        .map((file) => relativeFrom(workspace.paths.rootDir, file));
      throw new Error(
        available.length
          ? `Deliverable not found: ${input}. Available: ${available.join(', ')}.`
          : `Deliverable not found: ${input}, and this workspace has none yet.`,
      );
    }

    const relativeInput = relativeFrom(workspace.paths.rootDir, absoluteInput);
    const outputRelative =
      options.output ?? exportOutputPath(relativeInput, { polish: options.polish });
    const absoluteOutput = resolveInside(workspace.paths.rootDir, outputRelative);

    const llm = new LLMService(config);
    const retrieval = new RetrievalService(workspace, config, logger);
    const llmStart = { value: 0 };
    const { content: expanded, warnings } = await expandDeliverable(
      relativeInput,
      config,
      workspace,
      retrieval,
      llm,
      logger,
      (progress) => {
        if (progress.phase === 'read') {
          spinner?.update('Reading deliverable…');
          spinner?.updateSub(progress.path);
          return;
        }

        if (progress.phase === 'source') {
          spinner?.update(`Resolving sources (${progress.index}/${progress.total})…`);
          spinner?.updateSub(progress.section ?? progress.path);
          return;
        }

        if (progress.phase === 'llm') {
          llmStart.value = Date.now();
          spinner?.update(`Expanding section ${progress.index}/${progress.total}…`);
          spinner?.updateSub(() => {
            const seconds = ((Date.now() - llmStart.value) / 1000).toFixed(1);
            return `${progress.section ?? ''} · ${progress.citations ?? 0} fragment(s) · LLM ${seconds}s`;
          });
          return;
        }

        if (progress.phase === 'polish') {
          llmStart.value = Date.now();
          spinner?.update(
            progress.total
              ? `Polishing section ${progress.index}/${progress.total}…`
              : 'Polishing export…',
          );
          spinner?.updateSub(() => {
            const seconds = ((Date.now() - llmStart.value) / 1000).toFixed(1);
            return `${progress.section ?? 'editorial pass'} · LLM ${seconds}s`;
          });
        }
      },
      { polish: options.polish },
    );

    spinner?.update('Writing export…');
    spinner?.updateSub(outputRelative);

    await safeWriteFile(absoluteOutput, normalizeGeneratedMarkdown(expanded));
    spinner?.stop();
    const historyResult = await commitHistorySafely(history, {
      command: options.polish ? 'polish' : 'export',
      message: `${options.polish ? 'polish' : 'export'}: ${outputRelative}`,
      // Export/polish lock scopes are per-deliverable: siblings run in
      // parallel on the same workspace, so stage this deliverable only.
      scope: [outputRelative],
    }, logger);
    if (historyResult.sha) {
      await logger.info('history:commit', {
        command: options.polish ? 'polish' : 'export',
        sha: historyResult.sha,
        files: historyResult.files,
      });
    }
    for (const warning of warnings) {
      console.warn(`  ⚠ ${warning}`);
    }
    console.log(`Exported → ${outputRelative}`);
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
    printTraceSummary(logger);
  }
}
