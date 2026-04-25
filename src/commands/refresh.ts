import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { Spinner } from '../utils/spinner.ts';

export default async function refreshCmd(
  config: AppConfig,
  templates: string[],
  options: { force?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config);
  const service = new RefreshService(config, workspace, llm, retrieval);
  const spinner = new Spinner('Building deliverables…');
  spinner.start();
  const results = await service.refresh({
    templates,
    force: options.force,
    onProgress: (template, batch) => {
      const name = template.replace(/^templates\//, '').replace(/\.md$/, '');
      spinner.update(`Building ${name} (batch ${batch.index + 1}/${batch.total})…`);
    },
  });
  spinner.stop();

  if (results.length === 0) {
    console.log('No template found in templates/.');
    return;
  }

  for (const result of results) {
    console.log(
      `${result.template} -> ${result.output} (${result.skipped ? 'up-to-date' : result.changed ? 'updated' : 'unchanged'})`,
    );
  }
}
