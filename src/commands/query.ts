import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { QueryService } from '../services/queryService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function queryCmd(config: AppConfig, question: string) {
  const workspace = new WorkspaceService(config);
  const llm = new LLMService(config);
  const retrieval = new RetrievalService(workspace, config);
  const service = new QueryService(config, workspace, llm, retrieval);
  const answer = await service.query(question);
  console.log(answer);
}
