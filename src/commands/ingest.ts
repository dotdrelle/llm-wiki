import type { AppConfig } from '../types.ts';
import { IngestService } from '../services/ingestService.ts';
import { LLMService } from '../services/llmService.ts';
import { RefreshService } from '../services/refreshService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function ingestCmd(
  config: AppConfig,
  files: string[],
  options: { dryRun?: boolean; refresh?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config);
  const refresh = new RefreshService(config, workspace, llm, retrieval);
  const service = new IngestService(config, workspace, llm, retrieval, refresh);
  const results = await service.ingest(files, options);

  if (results.length === 0) {
    console.log('No markdown source found in raw/untracked.');
    return;
  }

  for (const result of results) {
    console.log(`\n${result.source}`);
    console.log(`  Summary: ${result.plan.summary}`);
    for (const operation of result.plan.operations) {
      console.log(`  - ${operation.type.toUpperCase()} ${operation.path}`);
    }
  }
}
