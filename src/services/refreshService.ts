import type { AppConfig, DeliverableBuildResult } from '../types.ts';
import { BuildService } from './buildService.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { WorkspaceService } from './workspaceService.ts';

export class RefreshService {
  private readonly buildService: BuildService;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
    logger?: TraceLogger,
  ) {
    this.buildService = new BuildService(config, workspace, llm, retrieval, logger);
  }

  async refresh(options?: {
    templates?: string[];
    force?: boolean;
    onProgress?: (template: string, batch: { index: number; total: number }, topContextPages: string[]) => void;
    onBatchLlm?: (template: string, batch: { index: number; total: number }, topContextPages: string[]) => void;
    onPageLoad?: (relativePath: string, index: number, total: number) => void;
  }): Promise<DeliverableBuildResult[]> {
    return this.buildService.build({
      templates: options?.templates,
      force: options?.force,
      changedOnly: !options?.force,
      onProgress: options?.onProgress,
      onBatchLlm: options?.onBatchLlm,
      onPageLoad: options?.onPageLoad,
    });
  }
}
