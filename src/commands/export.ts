import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { createTraceLogger } from '../services/traceLogger.ts';
import { expandDeliverable, exportOutputPath } from '../services/exportService.ts';
import { safeWriteFile, pathExists } from '../utils/fs.ts';
import { resolveInside, relativeFrom } from '../utils/path.ts';
import { Spinner } from '../utils/spinner.ts';

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
  });
  console.log(`Trace file: ${logger.displayPath}`);

  const spinner = options.verbose || options.debug ? null : new Spinner('Preparing export…');

  try {
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

    if (!absoluteInput) {
      throw new Error(`Deliverable not found: ${input}`);
    }

    const relativeInput = relativeFrom(workspace.paths.rootDir, absoluteInput);
    const outputRelative = options.output ?? exportOutputPath(relativeInput, { polish: options.polish });
    const absoluteOutput = resolveInside(workspace.paths.rootDir, outputRelative);

    const llm = new LLMService(config);
    const llmStart = { value: 0 };
    const expanded = await expandDeliverable(
      relativeInput,
      config,
      workspace,
      llm,
      logger,
      (progress) => {
        if (progress.phase === 'read') {
          spinner?.update('Reading deliverable…');
          spinner?.updateSub(progress.path);
          return;
        }

        if (progress.phase === 'source') {
          spinner?.update(`Loading sources (${progress.index}/${progress.total})…`);
          spinner?.updateSub(progress.path);
          return;
        }

        if (progress.phase === 'llm') {
          llmStart.value = Date.now();
          spinner?.update('Expanding deliverable with LLM…');
          spinner?.updateSub(() => {
            const seconds = ((Date.now() - llmStart.value) / 1000).toFixed(1);
            return `${progress.citations ?? 0} source(s) · LLM ${seconds}s`;
          });
          return;
        }

        if (progress.phase === 'polish') {
          llmStart.value = Date.now();
          spinner?.update('Polishing export…');
          spinner?.updateSub(() => {
            const seconds = ((Date.now() - llmStart.value) / 1000).toFixed(1);
            return `editorial pass · LLM ${seconds}s`;
          });
        }
      },
      { polish: options.polish },
    );

    spinner?.update('Writing export…');
    spinner?.updateSub(outputRelative);

    await safeWriteFile(absoluteOutput, expanded);
    spinner?.stop();
    console.log(`Exported → ${outputRelative}`);
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
  }
}
