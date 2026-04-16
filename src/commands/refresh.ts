import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function refreshCmd(
  config: AppConfig,
  templates: string[],
  options: { force?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config);
  const service = new RefreshService(config, workspace, llm, retrieval);
  const results = await service.refresh({
    templates,
    force: options.force,
  });

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
