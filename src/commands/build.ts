import type { AppConfig, BuildCommandOptions } from '../types.ts';
import { BuildService } from '../services/buildService.ts';
import { LLMService } from '../services/llmService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { createTraceLogger, printTraceSummary } from '../services/traceLogger.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { Spinner } from '../utils/spinner.ts';

export default async function buildCmd(
  config: AppConfig,
  templates: string[],
  options: BuildCommandOptions,
) {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const logger = await createTraceLogger({
    rootDir: workspace.paths.rootDir,
    logsDir: workspace.paths.logsDir,
    command: 'build',
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
  const service = new BuildService(config, workspace, llm, retrieval, logger);

  const spinner =
    options.verbose || options.debug ? null : new Spinner('Building deliverables…');
  try {
    if (options.plan) {
      spinner?.start();
      const plan = await service.planBuild({
        templates,
        onPageLoad: (relativePath, index, total) => {
          spinner?.update(`Reading wiki (${index + 1}/${total})…`);
          spinner?.updateSub(relativePath);
        },
      });
      spinner?.stop();
      console.log(
        `Build plan: ${plan.estimatedRequests} request(s), ~${plan.estimatedInputTokens.toLocaleString()} input token(s)`,
      );
      console.log(
        `Limits: ${plan.limits.requestsPerMinute} req/min, target ${plan.limits.targetInputTokensPerCall.toLocaleString()} input tokens/call, max ${plan.limits.maxInputTokensPerCall.toLocaleString()}`,
      );
      if (typeof plan.limits.dailyInputTokens === 'number') {
        console.log(
          `Daily input budget: ${plan.limits.dailyInputTokens.toLocaleString()} token(s)`,
        );
      }
      for (const templatePlan of plan.templates) {
        console.log(`\n${templatePlan.template} -> ${templatePlan.output}`);
        console.log(
          `  ${templatePlan.instructions} slot(s), ${templatePlan.batches.length} batch(es)`,
        );
        for (const batch of templatePlan.batches) {
          const flags = [
            batch.exceedsTarget ? 'over target' : undefined,
            batch.exceedsMax ? 'over max' : undefined,
          ]
            .filter(Boolean)
            .join(', ');
          console.log(
            `  - batch ${batch.index + 1}: ${batch.slotIds.length} slot(s), ~${batch.estimatedInputTokens.toLocaleString()} input token(s)${flags ? ` (${flags})` : ''}`,
          );
          if (batch.contextPages.length > 0) {
            console.log('    context:');
            for (const contextPage of batch.contextPages) {
              console.log(`      - ${contextPage}`);
            }
          }
        }
      }
      return;
    }

    spinner?.start();
    const results = await service.build({
      templates,
      force: options.force,
      changedOnly: false,
      stabilize: options.stabilize,
      onPageLoad: (relativePath, index, total) => {
        spinner?.update(`Reading wiki (${index + 1}/${total})…`);
        spinner?.updateSub(relativePath);
      },
      onStabilize: (template, output) => {
        const name = template.replace(/^templates\//, '').replace(/\.md$/, '');
        spinner?.update(`Stabilizing ${name}…`);
        spinner?.updateSub(output);
      },
      onProgress: (template, batch, topContextPages) => {
        const batchStart = Date.now();
        const name = template.replace(/^templates\//, '').replace(/\.md$/, '');
        spinner?.update(`Building ${name} (batch ${batch.index + 1}/${batch.total})…`);
        const ctx = formatContextSummary(topContextPages, template);
        spinner?.updateSub(() => {
          const s = ((Date.now() - batchStart) / 1000).toFixed(1);
          return `${ctx} · retrieval ${s}s`;
        });
      },
      onBatchLlm: (template, batch, topContextPages) => {
        const llmStart = Date.now();
        const name = template.replace(/^templates\//, '').replace(/\.md$/, '');
        spinner?.update(`Building ${name} (batch ${batch.index + 1}/${batch.total})…`);
        const ctx = formatContextSummary(topContextPages, template);
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
      const stabilized = result.stabilized
        ? `, stabilized: ${result.stabilized.kept.length} kept, ${result.stabilized.merged.length} merged, ${result.stabilized.inserted.length} inserted, ${result.stabilized.removed.length} removed`
        : '';
      console.log(
        `${result.template} -> ${result.output} (${result.changed ? 'updated' : 'unchanged'}${stabilized})`,
      );
    }
  } catch (e) {
    spinner?.stop();
    throw e;
  } finally {
    await logger.close();
    printTraceSummary(logger);
  }
}

function formatContextSummary(contextPages: string[], fallback: string): string {
  if (contextPages.length === 0) return fallback;
  if (contextPages.length === 1) return contextPages[0];
  return `${contextPages[0]} +${contextPages.length - 1} context page(s)`;
}
