import type { AppConfig, DeliverableBuildResult } from '../types.ts';
import { BuildService } from './buildService.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { WorkspaceService } from './workspaceService.ts';

export class RefreshService {
  private readonly buildService: BuildService;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
  ) {
    this.buildService = new BuildService(config, workspace, llm, retrieval);
  }

  async refresh(options?: {
    templates?: string[];
    force?: boolean;
  }): Promise<DeliverableBuildResult[]> {
    return this.buildService.build({
      templates: options?.templates,
      force: options?.force,
      changedOnly: !options?.force,
    });
  }
}
