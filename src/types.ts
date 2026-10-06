/**
 * Routing: where requests are sent. Two values only.
 * - `openai-compatible`: a single server, reached directly.
 * - `ai-gateway`: an external AI gateway (LiteLLM, Bifrost, Portkey…) that
 *   routes to several providers itself. Opaque endpoint: no local-server
 *   bypass is applied, parameter normalization is delegated to the gateway
 *   (cf. `drop_params`).
 */
export type LlmProvider = 'openai-compatible' | 'ai-gateway';

/**
 * Engine: how the server in front behaves. Carries the `doctor` workarounds
 * and calibrations. Irrelevant — and ignored — when `provider` is
 * `ai-gateway`, where each model may have a different engine.
 */
export type LlmEngine =
  | 'ollama'
  | 'vllm'
  | 'mlx'
  | 'albert'
  | 'openai'
  | 'generic';

export type ConfigPresetName = 'albert' | 'openai' | 'ollama' | 'nvidia';

export interface LlmConfig {
  provider: LlmProvider;
  engine: LlmEngine;
  model: string;
  apiKey?: string;
  baseUrl: string;
  temperature: number;
  timeoutMs: number;
  numCtx?: number;
  /**
   * Margin applied to the output cap to absorb reasoning, which is counted
   * against the same budget as the content. Default 3, provisional.
   */
  reasoningOutputMultiplier?: number;
  flashAttention?: boolean;
  kvCacheType?: 'f16' | 'q8_0' | 'q4_0';
  /**
   * OpenAI-style `reasoning_effort`, sent on every call when set: the knob of
   * the thinking mode. `none`/`minimal` turn reasoning down (some models only
   * accept tools that way). Dropped when the model was measured to refuse it.
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * What the configured model was measured to accept, written by
   * `wiki doctor --apply` (`config/modelProbe.ts`). Absent = not probed yet:
   * the static per-engine rules apply.
   */
  capabilities?: LlmCapabilities;
}

export interface LlmCapabilities {
  /** The model these facts were measured on; another model ignores them. */
  model: string;
  /** `temperature` accepted. `false`: never sent. */
  temperature?: boolean;
  /** The model reasons before answering (reasoning fields or `<think>`). */
  thinking?: boolean;
  /**
   * `named`: a forced `{type:'function'}` tool_choice is accepted.
   * `auto`: only `tool_choice: "auto"` is (thinking mode refuses a forced one).
   * Tool calling itself is required by agent mode and maintenance.
   */
  toolChoice?: 'named' | 'auto';
  /** `reasoning_effort` accepted (only measured when one is sent). */
  reasoningEffort?: boolean;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export interface BuildConfig {
  refreshOnIngest: boolean;
  slotBatchSize?: number;
  maxBuildContextChars: number;
}

export interface LimitsConfig {
  requestsPerMinute: number;
  dailyInputTokens?: number;
  maxInFlightRequests?: number;
  maxInputTokensPerCall: number;
  targetInputTokensPerCall: number;
  maxProfileChars: number;
}

export interface RetrievalConfig {
  maxContextFiles: number;
  maxChunksPerPage: number;
  maxChunkChars: number;
  maxSourceChars: number;
  vector: VectorRetrievalConfig;
}

export interface VectorRetrievalConfig {
  enabled: boolean;
  /**
   * Inherited from the `llm` block when absent from the file — `resolveConfig`
   * always fills them in. Optional in the type because no consumer attaches
   * behaviour to them today: they serve `doctor` and the wizard, which know
   * how to fall back to the `llm` block.
   */
  provider?: LlmProvider;
  engine?: LlmEngine;
  baseUrl: string;
  apiKey?: string;
  requestsPerMinute?: number;
  timeoutMs: number;
  embeddingModel: string;
  rerankEnabled: boolean;
  rerankerModel: string;
  topK: number;
  rerankTopK: number;
  maxResults: number;
}

export interface TlsConfig {
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

export interface McpConfig {
  accessKey?: string;
  readToken?: string;
  writeToken?: string;
  tls?: TlsConfig;
}

export interface ServeConfig {
  tls?: TlsConfig;
}

export interface HistoryConfig {
  enabled: boolean;
  authorName: string;
  authorEmail: string;
}

export interface IngestConfig {
  sheets: { minSectionChars: number; minContentChars: number; maxTags: number };
  families: { min: number; max: number };
  tagPages: { sourcePreviewLimit: number };
}

export interface AppConfig {
  wikiRoot: string;
  configPath?: string;
  preset?: ConfigPresetName;
  language: string;
  llm: LlmConfig;
  limits: LimitsConfig;
  build: BuildConfig;
  retrieval: RetrievalConfig;
  mcp: McpConfig;
  history?: HistoryConfig;
  ingest?: IngestConfig;
  serve?: ServeConfig;
}

export interface BuildCommandOptions {
  force?: boolean;
  plan?: boolean;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
  stabilize?: boolean;
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
  fromIngested?: boolean;
  migrateSheets?: boolean;
  apply?: boolean;
  reject?: string[];
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
  cacheDir: string;
  queryEmbeddingCacheDir: string;
  rerankCacheDir: string;
  buildStatePath: string;
  rawDir: string;
  rawUntrackedDir: string;
  rawIngestedDir: string;
  vectorIndexDir: string;
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
  /** Byte length of the original file on disk before any encoding conversion */
  rawByteLength?: number;
  /** Present only when the file was not valid UTF-8 and was decoded as Latin-1 instead */
  detectedEncoding?: 'latin-1';
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
  relatedPaths?: string[];
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

export interface IngestReviewOperation {
  type: WikiOperation['type'];
  path: string;
  source: string;
  archivePath: string;
  status: 'pending' | 'applied' | 'rejected';
  beforeExists: boolean;
  afterExists: boolean;
  beforeHash?: string;
  afterHash?: string;
  diff: {
    changed: boolean;
    addedLines: number;
    removedLines: number;
    preview: string[];
  };
}

export interface IngestRetryInfo {
  attempts: number;
  retries: number;
  classification?: 'transient' | 'validation' | 'unknown';
}

export interface IngestResult {
  source: string;
  /**
   * The ARCHIVE identity of that source (`raw/ingested/<slug>.md`) — what the
   * source registry keys on. `source` is the on-disk relative path, which is
   * NOT the same string as soon as the file name carries an accent, a space or
   * a capital: comparing the two silently matched nothing.
   */
  archivePath?: string;
  plan?: IngestPlan;
  review?: IngestReviewOperation[];
  retry?: IngestRetryInfo;
  skipped?: boolean;
  failed?: boolean;
  error?: string;
}

export interface TemplateInstruction {
  id: string;
  token: string;
  instruction: string;
  headingPath: string[];
  headingLevel: number;
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

export interface BuildContextSection {
  relativePath: string;
  content: string;
}

export interface TemplateBuildContextResolution {
  context: BuildContext;
  requested: unknown[];
  resolved: string[];
  missing: unknown[];
}

export interface TemplateBuildContextReport {
  template: string;
  requested: unknown[];
  resolved: string[];
  missing: unknown[];
  fileCount: number;
  truncated: boolean;
}

export interface BuildState {
  deliverables: Record<
    string,
    {
      templateHash: string;
      wikiHash: string;
      buildContextHash: string;
      outputHash: string;
      /** 2 = hash of the bytes written (normalized); absent = legacy, not comparable to disk. */
      outputHashVersion?: number;
      /** Section keys the template produced at this build; absent = recorded before hand sections were kept. */
      producedSections?: string[];
      outputRelativePath: string;
    }
  >;
}

export interface DeliverableBuildResult {
  template: string;
  output: string;
  changed: boolean;
  skipped: boolean;
  stabilized?: StabilizeDiff;
}

export interface StabilizeDiff {
  kept: string[];
  merged: string[];
  inserted: string[];
  removed: string[];
  /** Hand-added sections carried over verbatim (not produced by the template). */
  preserved?: string[];
}

export interface StabilizeResult {
  markdown: string;
  diff: StabilizeDiff;
}

export interface BuildSlotPlan {
  id: string;
  headingPath: string[];
  contextPages: string[];
  estimatedInputTokens: number;
}

export interface BuildBatchPlan {
  index: number;
  slotIds: string[];
  contextPages: string[];
  estimatedInputTokens: number;
  exceedsTarget: boolean;
  exceedsMax: boolean;
}

export interface TemplateBuildPlan {
  template: string;
  output: string;
  instructions: number;
  batches: BuildBatchPlan[];
  slots: BuildSlotPlan[];
}

export interface BuildRunPlan {
  templates: TemplateBuildPlan[];
  buildContextResolutions: TemplateBuildContextReport[];
  estimatedRequests: number;
  estimatedInputTokens: number;
  limits: LimitsConfig;
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
  flatConceptPages: string[];
  conceptPagesMissingGroup: string[];
  fichePagesMissingAnchor: string[];
  tagPagesMissingFiches: string[];
  duplicateConceptGroups: Array<{ key: string; groups: string[] }>;
  pagesMissingOkfType: string[];
  semantic?: SemanticLintReport;
}
