import type { AppConfig } from '../types.ts';
import { BuildService } from '../services/buildService.ts';
import { LLMService } from '../services/llmService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function buildCmd(
  config: AppConfig,
  templates: string[],
  options: { force?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config);
  const service = new BuildService(config, workspace, llm, retrieval);
  const results = await service.build({
    templates,
    force: options.force,
    changedOnly: false,
  });

  if (results.length === 0) {
    console.log('No template found in templates/.');
    return;
  }

  for (const result of results) {
    console.log(
      `${result.template} -> ${result.output} (${result.changed ? 'updated' : 'unchanged'})`,
    );
  }
}
