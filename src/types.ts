export type LlmProvider = 'openai' | 'ollama' | 'openai-compatible' | 'anthropic';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl: string;
  temperature: number;
  timeoutMs: number;
  numCtx?: number;
  flashAttention?: boolean;
  kvCacheType?: 'f16' | 'q8_0' | 'q4_0';
}

export interface BuildConfig {
  refreshOnIngest: boolean;
  slotBatchSize: number;
  maxBuildContextChars: number;
}

export interface RetrievalConfig {
  maxContextFiles: number;
  maxChunksPerPage: number;
  maxChunkChars: number;
  maxSourceChars: number;
}

export interface McpConfig {
  accessKey?: string;
}

export interface AppConfig {
  wikiRoot: string;
  configPath?: string;
  language: string;
  llm: LlmConfig;
  build: BuildConfig;
  retrieval: RetrievalConfig;
  mcp: McpConfig;
}

export interface BuildCommandOptions {
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
}

export interface RefreshCommandOptions {
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
}

export interface IngestCommandOptions {
  dryRun?: boolean;
  refresh?: boolean;
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
}

export interface WorkspacePaths {
  rootDir: string;
  configPath: string;
  gitignorePath: string;
  claudePath: string;
  internalDir: string;
  logsDir: string;
  buildStatePath: string;
  rawDir: string;
  rawUntrackedDir: string;
  rawIngestedDir: string;
  wikiDir: string;
  wikiIndexPath: string;
  wikiLogPath: string;
  wikiConceptsDir: string;
  wikiSourcesDir: string;
  wikiAnswersDir: string;
  templatesDir: string;
  buildContextDir: string;
  deliverablesDir: string;
}

export interface SourceDocument {
  absolutePath: string;
  relativePath: string;
  archiveRelativePath: string;
  archiveCitationPath: string;
  fileName: string;
  slug: string;
  title: string;
  frontmatter: Record<string, unknown>;
  rawContent: string;
  body: string;
}

export type WikiPageType = 'index' | 'concept' | 'source' | 'answer' | 'other';

export interface WikiPage {
  absolutePath: string;
  relativePath: string;
  name: string;
  type: WikiPageType;
  content: string;
}

export interface SearchResult {
  page: WikiPage;
  score: number;
  chunk?: {
    headingPath: string[];
    content: string;
  };
}

export interface WikiOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
}

export interface IngestPlan {
  summary: string;
  operations: WikiOperation[];
}

export interface IngestResult {
  source: string;
  plan?: IngestPlan;
  skipped?: boolean;
  failed?: boolean;
  error?: string;
}

export interface TemplateInstruction {
  id: string;
  token: string;
  instruction: string;
  headingPath: string[];
  surroundingText: string;
}

export interface TemplateDocument {
  absolutePath: string;
  relativePath: string;
  frontmatter: Record<string, unknown>;
  content: string;
  instructions: TemplateInstruction[];
  outputRelativePath: string;
  outputAbsolutePath: string;
}

export interface BuildContext {
  content: string;
  hash: string;
  fileCount: number;
  truncated: boolean;
  rawTotalChars: number;
}

export interface BuildState {
  deliverables: Record<
    string,
    {
      templateHash: string;
      wikiHash: string;
      buildContextHash: string;
      outputHash: string;
      outputRelativePath: string;
    }
  >;
}

export interface DeliverableReplacement {
  id: string;
  content: string;
}

export interface DeliverableBuildResult {
  template: string;
  output: string;
  changed: boolean;
  skipped: boolean;
}

export interface SemanticLintReport {
  contradictions: Array<{ pages: string[]; description: string }>;
  missingConcepts: Array<{ name: string; rationale: string }>;
  shallowPages: Array<{ name: string; reason: string }>;
}

export interface LintReport {
  deadLinks: Array<{ file: string; link: string }>;
  orphanPages: string[];
  missingSources: Array<{ file: string; citation: string }>;
  staleDeliverables: string[];
  unresolvedInstructions: string[];
  semantic?: SemanticLintReport;
}
