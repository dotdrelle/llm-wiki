import { buildQueryPrompt } from '../prompts/queryPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import type { AppConfig } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { WorkspaceService } from './workspaceService.ts';

export class QueryService {
  private readonly config: AppConfig;
  private readonly workspace: WorkspaceService;
  private readonly llm: LLMService;
  private readonly retrieval: RetrievalService;

  constructor(
    config: AppConfig,
    workspace: WorkspaceService,
    llm: LLMService,
    retrieval: RetrievalService,
  ) {
    this.config = config;
    this.workspace = workspace;
    this.llm = llm;
    this.retrieval = retrieval;
  }

  async query(question: string): Promise<string> {
    await this.workspace.ensureInitialized();
    const context = await this.retrieval.search(question, {
      limit: this.config.retrieval.maxContextFiles,
      includeRaw: false,
    });
    const profileSection = await this.workspace.loadProfileSection(
      this.config.limits.maxProfileChars,
    );
    const prompt = buildQueryPrompt(
      question,
      context,
      this.config.retrieval.maxChunkChars,
      buildPromptContext(this.config, { profileSection }),
    );
    return this.llm.completeText(prompt);
  }
}
