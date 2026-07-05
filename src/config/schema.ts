import { z } from 'zod';
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
} from './defaults.ts';
import type { AppConfig, ConfigPresetName } from '../types.ts';

const ALBERT_BASE_URL = 'https://albert.api.etalab.gouv.fr/v1';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

type PlainObject = Record<string, unknown>;

export type ConfigProvenanceSource =
  | 'default'
  | `preset:${ConfigPresetName}`
  | 'file'
  | 'env';

export interface EffectiveConfigDetails {
  config: AppConfig;
  provenance: Record<string, ConfigProvenanceSource>;
}

const CONFIG_PRESETS: Record<ConfigPresetName, PlainObject> = {
  albert: {
    llm: {
      provider: 'openai-compatible',
      baseUrl: ALBERT_BASE_URL,
    },
    limits: {
      requestsPerMinute: 100,
      maxInFlightRequests: 3,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
    },
    build: {
      maxBuildContextChars: 24000,
    },
    retrieval: {
      buildStrategy: 'bm25',
      vector: {
        enabled: true,
        baseUrl: ALBERT_BASE_URL,
        requestsPerMinute: 100,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 48,
        rerankTopK: 24,
        maxResults: 6,
      },
    },
  },
  openai: {
    llm: {
      provider: 'openai',
      baseUrl: DEFAULT_OPENAI_BASE_URL,
    },
    retrieval: {
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: DEFAULT_OPENAI_BASE_URL,
      },
    },
  },
  ollama: {
    llm: {
      provider: 'ollama',
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      apiKey: 'ollama',
      numCtx: 32768,
    },
    limits: {
      requestsPerMinute: 50,
      maxInFlightRequests: 3,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
    },
    retrieval: {
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: DEFAULT_OLLAMA_BASE_URL,
        rerankEnabled: false,
      },
    },
  },
  nvidia: {
    llm: {
      provider: 'openai-compatible',
      baseUrl: NVIDIA_BASE_URL,
    },
    limits: {
      requestsPerMinute: 40,
      maxInFlightRequests: 3,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
    },
    retrieval: {
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: NVIDIA_BASE_URL,
      },
    },
  },
};

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function omitUndefined(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, isPlainObject(entry) ? omitUndefined(entry) : entry]),
  );
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const result: PlainObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = deepMerge(result[key], value);
  }
  return result;
}

function pathHasOwnValue(value: unknown, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = value;
  for (const part of parts) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return false;
    }
    current = current[part];
  }
  return current !== undefined;
}

function sourceForPath(
  rawInput: unknown,
  presetInput: unknown,
  presetName: ConfigPresetName | undefined,
  path: string,
): ConfigProvenanceSource {
  if (pathHasOwnValue(rawInput, path)) return 'file';
  if (presetName && pathHasOwnValue(presetInput, path)) return `preset:${presetName}`;
  return 'default';
}

function normalizeOperationType(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'create' ||
    normalized === 'add' ||
    normalized === 'insert' ||
    normalized === 'new' ||
    normalized.includes('create') ||
    normalized.includes('add') ||
    normalized.includes('insert')
  ) {
    return 'create';
  }

  if (
    normalized === 'update' ||
    normalized === 'write' ||
    normalized === 'replace' ||
    normalized === 'modify' ||
    normalized === 'patch' ||
    normalized === 'edit' ||
    normalized === 'overwrite' ||
    normalized === 'upsert' ||
    normalized === 'append' ||
    normalized.includes('update') ||
    normalized.includes('write') ||
    normalized.includes('replace') ||
    normalized.includes('modify') ||
    normalized.includes('patch') ||
    normalized.includes('edit') ||
    normalized.includes('overwrite') ||
    normalized.includes('upsert') ||
    normalized.includes('append')
  ) {
    return 'update';
  }

  if (
    normalized === 'delete' ||
    normalized === 'remove' ||
    normalized === 'rm' ||
    normalized === 'drop' ||
    normalized.includes('delete') ||
    normalized.includes('remove') ||
    normalized.includes('drop')
  ) {
    return 'delete';
  }

  return normalized;
}

function normalizeWikiOperation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const path =
    candidate.path ??
    candidate.file ??
    candidate.filePath ??
    candidate.filename ??
    candidate.target ??
    candidate.destination ??
    candidate.page;
  const content =
    candidate.content ??
    candidate.text ??
    candidate.body ??
    candidate.markdown ??
    candidate.value;
  const rawType =
    candidate.type ??
    candidate.action ??
    candidate.operation ??
    candidate.op ??
    candidate.kind;
  const type =
    rawType == null || (typeof rawType === 'string' && rawType.trim() === '')
      ? typeof content === 'string'
        ? 'update'
        : 'delete'
      : normalizeOperationType(rawType);

  return {
    ...candidate,
    type,
    path: typeof path === 'string' ? path.trim() : path,
    content: typeof content === 'string' ? content : content,
  };
}

function normalizeDeliverableReplacement(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const entries = Object.entries(candidate);
  if (
    entries.length === 1 &&
    !('id' in candidate) &&
    !('content' in candidate) &&
    typeof entries[0]?.[1] === 'string'
  ) {
    return {
      id: entries[0][0],
      content: entries[0][1],
    };
  }

  const id =
    candidate.id ??
    candidate.slotId ??
    candidate.slot_id ??
    candidate.instructionId ??
    candidate.instruction_id;
  const content =
    candidate.content ??
    candidate.markdown ??
    candidate.text ??
    candidate.body ??
    candidate.value ??
    candidate.replacement ??
    candidate.answer;

  return {
    ...candidate,
    id: typeof id === 'string' ? id.trim() : id,
    content: normalizeMarkdownContent(content),
  };
}

function escapeMarkdownTableCell(value: unknown): string {
  if (value == null) {
    return '';
  }

  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return text.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

function normalizeMarkdownContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return content;
  }

  if (
    Array.isArray(content) &&
    content.every((item) => item && typeof item === 'object' && !Array.isArray(item))
  ) {
    const rows = content as Array<Record<string, unknown>>;
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    if (headers.length === 0) {
      return '';
    }

    return [
      `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map(
        (row) =>
          `| ${headers.map((header) => escapeMarkdownTableCell(row[header])).join(' | ')} |`,
      ),
    ].join('\n');
  }

  return content;
}

function normalizeDeliverableResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const rawReplacements =
    candidate.replacements ?? candidate.items ?? candidate.slots ?? candidate.answers;
  const replacements =
    rawReplacements &&
    typeof rawReplacements === 'object' &&
    !Array.isArray(rawReplacements)
      ? Object.entries(rawReplacements).map(([id, content]) => ({ id, content }))
      : rawReplacements;

  return {
    ...candidate,
    replacements: Array.isArray(replacements)
      ? replacements.map(normalizeDeliverableReplacement)
      : replacements,
  };
}

const llmSchema = z
  .object({
    provider: z
      .enum(['openai', 'ollama', 'openai-compatible', 'anthropic'])
      .default('openai'),
    model: z.string().min(1).default('gpt-5-mini'),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    temperature: z.number().min(0).max(2).default(0.1),
    timeoutMs: z.number().int().positive().default(600000),
    numCtx: z.number().int().positive().optional(),
    flashAttention: z.boolean().optional(),
    kvCacheType: z.enum(['f16', 'q8_0', 'q4_0']).optional(),
  })
  .default({
    provider: 'openai',
    model: 'gpt-5-mini',
    temperature: 0.1,
    timeoutMs: 600000,
  });

const buildSchema = z
  .object({
    refreshOnIngest: z.boolean().default(true),
    slotBatchSize: z.number().int().min(1).max(50).optional(),
    maxBuildContextChars: z.number().int().min(1000).default(24000),
  })
  .default({
    refreshOnIngest: true,
    maxBuildContextChars: 24000,
  });

const limitsSchema = z
  .object({
    requestsPerMinute: z.number().int().min(1).default(10),
    dailyInputTokens: z.number().int().min(1).optional(),
    maxInFlightRequests: z.number().int().min(1).max(16).default(3),
    maxInputTokensPerCall: z.number().int().min(1000).default(50000),
    targetInputTokensPerCall: z.number().int().min(1000).default(40000),
    maxProfileChars: z.number().int().min(100).default(4000),
  })
  .default({
    requestsPerMinute: 10,
    maxInFlightRequests: 3,
    maxInputTokensPerCall: 50000,
    targetInputTokensPerCall: 40000,
    maxProfileChars: 4000,
  })
  .superRefine((limits, ctx) => {
    if (limits.targetInputTokensPerCall > limits.maxInputTokensPerCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetInputTokensPerCall'],
        message: 'targetInputTokensPerCall must be <= maxInputTokensPerCall',
      });
    }
  });

const retrievalSchema = z
  .object({
    maxContextFiles: z.number().int().min(1).max(24).default(5),
    maxChunksPerPage: z.number().int().min(1).max(10).default(2),
    maxChunkChars: z.number().int().min(200).default(3000),
    maxSourceChars: z.number().int().min(500).default(8000),
    buildStrategy: z.enum(['bm25', 'hybrid']).default('bm25'),
    vector: z
      .object({
        enabled: z.boolean().default(false),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().min(1).optional(),
        requestsPerMinute: z.number().int().min(1).optional(),
        timeoutMs: z.number().int().min(1000).default(600000).optional(),
        embeddingModel: z.string().min(1).default('BAAI/bge-m3'),
        rerankEnabled: z.boolean().default(true),
        rerankerModel: z.string().min(1).default('BAAI/bge-reranker-v2-m3'),
        topK: z.number().int().min(1).max(200).default(48),
        rerankTopK: z.number().int().min(1).max(100).default(24),
        maxResults: z.number().int().min(1).max(24).default(6),
      })
      .default({
        enabled: false,
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 48,
        rerankTopK: 24,
        maxResults: 6,
      }),
  })
  .default({
    maxContextFiles: 5,
    maxChunksPerPage: 2,
    maxChunkChars: 3000,
    maxSourceChars: 8000,
    buildStrategy: 'bm25',
    vector: {
      enabled: false,
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      timeoutMs: 600000,
      embeddingModel: 'BAAI/bge-m3',
      rerankEnabled: true,
      rerankerModel: 'BAAI/bge-reranker-v2-m3',
      topK: 48,
      rerankTopK: 24,
      maxResults: 6,
    },
  });

const mcpSchema = z
  .preprocess(
    (value) => value ?? {},
    z.object({
      accessKey: z.string().min(1).optional(),
      readToken: z.string().min(1).optional(),
      writeToken: z.string().min(1).optional(),
      tls: z
        .object({
          certPath: z.string().min(1).optional(),
          keyPath: z.string().min(1).optional(),
          caPath: z.string().min(1).optional(),
        })
        .optional(),
    }),
  )
  .default({});

const serveSchema = z.preprocess((value) => value ?? {}, z.object({})).default({});

export const rawConfigSchema = z.object({
  preset: z.enum(['albert', 'openai', 'ollama', 'nvidia']).optional(),
  wikiRoot: z.string().optional(),
  language: z.string().min(2).max(20).default('fr').optional(),
  llm: llmSchema.optional(),
  limits: limitsSchema.optional(),
  build: buildSchema.optional(),
  retrieval: retrievalSchema.optional(),
  mcp: mcpSchema.optional(),
  serve: serveSchema.optional(),
});

export const wikiOperationSchema = z.preprocess(
  normalizeWikiOperation,
  z
    .object({
      type: z.preprocess(normalizeOperationType, z.enum(['create', 'update', 'delete'])),
      path: z.string().min(1),
      content: z.string().optional(),
    })
    .superRefine((operation, context) => {
      if (operation.type !== 'delete' && typeof operation.content !== 'string') {
        context.addIssue({
          code: 'custom',
          path: ['content'],
          message: `Operation ${operation.path} requires content for ${operation.type}.`,
        });
      }
    }),
);

export const ingestPlanSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const candidate = value as Record<string, unknown>;
    return {
      ...candidate,
      summary:
        candidate.summary ??
        candidate.log_message ??
        candidate.message ??
        candidate.description,
      operations:
        candidate.operations ?? candidate.changes ?? candidate.patches ?? candidate.files,
    };
  },
  z.object({
    summary: z.string().default('Ingest completed.'),
    operations: z.array(wikiOperationSchema).default([]),
  }),
);

export const deliverableResponseSchema = z.preprocess(
  normalizeDeliverableResponse,
  z.object({
    replacements: z.array(
      z.object({
        id: z.string().min(1),
        content: z.string().min(1),
      }),
    ),
  }),
);

export const semanticLintSchema = z.object({
  contradictions: z
    .array(
      z.object({
        pages: z.array(z.string().min(1)).default([]),
        description: z.string().min(1),
      }),
    )
    .default([]),
  missingConcepts: z
    .array(
      z.object({
        name: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .default([]),
  shallowPages: z
    .array(
      z.object({
        name: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
});

export const buildStateSchema = z.object({
  deliverables: z.record(
    z.string(),
    z.object({
      templateHash: z.string().min(1),
      wikiHash: z.string().min(1),
      buildContextHash: z.string().default(''),
      outputHash: z.string().min(1),
      outputRelativePath: z.string().min(1),
    }),
  ),
});

export function resolveConfig(
  input: unknown,
  wikiRoot: string,
  configPath?: string,
): AppConfig {
  return resolveConfigDetails(input, wikiRoot, configPath).config;
}

export function resolveConfigDetails(
  input: unknown,
  wikiRoot: string,
  configPath?: string,
): EffectiveConfigDetails {
  const rawInput = isPlainObject(input) ? omitUndefined(input) : {};
  const rawPreset = isPlainObject(rawInput) ? rawInput.preset : undefined;
  const presetName = rawPreset ? z.enum(['albert', 'openai', 'ollama', 'nvidia']).parse(rawPreset) : undefined;
  const presetInput = presetName ? CONFIG_PRESETS[presetName] : {};
  const mergedInput = deepMerge(presetInput, rawInput);
  const parsed = rawConfigSchema.parse(mergedInput ?? {});
  const provider = parsed.llm?.provider ?? 'openai';

  const baseUrl =
    parsed.llm?.baseUrl ??
    (provider === 'ollama'
      ? DEFAULT_OLLAMA_BASE_URL
      : provider === 'anthropic'
        ? DEFAULT_ANTHROPIC_BASE_URL
        : DEFAULT_OPENAI_BASE_URL);

  if (provider === 'openai-compatible' && !parsed.llm?.baseUrl) {
    throw new Error('Provider "openai-compatible" requires llm.baseUrl in .wikirc.yaml.');
  }

  const apiKey =
    parsed.llm?.apiKey ??
    (provider === 'ollama' ? 'ollama' : undefined);

  const vectorBaseUrl = parsed.retrieval?.vector?.baseUrl ?? baseUrl;
  const vectorApiKey =
    parsed.retrieval?.vector?.apiKey ??
    apiKey;

  const mcpCertPath = process.env.WIKI_MCP_TLS_CERT_PATH;
  const mcpKeyPath = process.env.WIKI_MCP_TLS_KEY_PATH;
  const mcpCaPath = process.env.WIKI_MCP_TLS_CA_PATH;
  const mcpTls =
    mcpCertPath || mcpKeyPath || mcpCaPath
      ? {
          ...(mcpCertPath ? { certPath: mcpCertPath } : {}),
          ...(mcpKeyPath ? { keyPath: mcpKeyPath } : {}),
          ...(mcpCaPath ? { caPath: mcpCaPath } : {}),
        }
      : parsed.mcp?.tls;

  const serveCertPath = process.env.WIKI_SERVE_TLS_CERT_PATH;
  const serveKeyPath = process.env.WIKI_SERVE_TLS_KEY_PATH;
  const serveCaPath = process.env.WIKI_SERVE_TLS_CA_PATH;
  const serveTls =
    serveCertPath || serveKeyPath || serveCaPath
      ? {
          ...(serveCertPath ? { certPath: serveCertPath } : {}),
          ...(serveKeyPath ? { keyPath: serveKeyPath } : {}),
          ...(serveCaPath ? { caPath: serveCaPath } : {}),
        }
      : undefined;
  const mcpAccessKey =
    parsed.mcp?.accessKey ??
    process.env.WIKI_MCP_ACCESS_KEY ??
    process.env.WIKI_MCP_AUTH_TOKEN;
  const mcpReadToken = parsed.mcp?.readToken ?? process.env.WIKI_MCP_READ_TOKEN;
  const mcpWriteToken = parsed.mcp?.writeToken ?? process.env.WIKI_MCP_WRITE_TOKEN;

  const config: AppConfig = {
    wikiRoot,
    configPath,
    preset: parsed.preset,
    language: parsed.language ?? 'fr',
    mcp: {
      ...(mcpAccessKey ? { accessKey: mcpAccessKey } : {}),
      ...(mcpReadToken ? { readToken: mcpReadToken } : {}),
      ...(mcpWriteToken ? { writeToken: mcpWriteToken } : {}),
      ...(mcpTls ? { tls: mcpTls } : {}),
    },
    serve: {
      tls: serveTls,
    },
    llm: {
      provider,
      model: parsed.llm?.model ?? 'gpt-5-mini',
      apiKey,
      baseUrl,
      temperature: parsed.llm?.temperature ?? 0.1,
      timeoutMs: parsed.llm?.timeoutMs ?? 600000,
      numCtx: parsed.llm?.numCtx,
      flashAttention: parsed.llm?.flashAttention,
      kvCacheType: parsed.llm?.kvCacheType,
    },
    limits: {
      requestsPerMinute: parsed.limits?.requestsPerMinute ?? 10,
      dailyInputTokens: parsed.limits?.dailyInputTokens,
      maxInFlightRequests: parsed.limits?.maxInFlightRequests ?? 3,
      maxInputTokensPerCall: parsed.limits?.maxInputTokensPerCall ?? 50000,
      targetInputTokensPerCall: parsed.limits?.targetInputTokensPerCall ?? 40000,
      maxProfileChars: parsed.limits?.maxProfileChars ?? 4000,
    },
    build: {
      refreshOnIngest: parsed.build?.refreshOnIngest ?? true,
      slotBatchSize: parsed.build?.slotBatchSize,
      maxBuildContextChars: parsed.build?.maxBuildContextChars ?? 24000,
    },
    retrieval: {
      maxContextFiles: parsed.retrieval?.maxContextFiles ?? 5,
      maxChunksPerPage: parsed.retrieval?.maxChunksPerPage ?? 2,
      maxChunkChars: parsed.retrieval?.maxChunkChars ?? 3000,
      maxSourceChars: parsed.retrieval?.maxSourceChars ?? 8000,
      buildStrategy: parsed.retrieval?.buildStrategy ?? 'bm25',
      vector: {
        enabled: parsed.retrieval?.vector?.enabled ?? false,
        baseUrl: vectorBaseUrl,
        apiKey: vectorApiKey,
        requestsPerMinute:
          parsed.retrieval?.vector?.requestsPerMinute ??
          parsed.limits?.requestsPerMinute ??
          10,
        timeoutMs: parsed.retrieval?.vector?.timeoutMs ?? parsed.llm?.timeoutMs ?? 600000,
        embeddingModel: parsed.retrieval?.vector?.embeddingModel ?? 'BAAI/bge-m3',
        rerankEnabled: parsed.retrieval?.vector?.rerankEnabled ?? true,
        rerankerModel:
          parsed.retrieval?.vector?.rerankerModel ?? 'BAAI/bge-reranker-v2-m3',
        topK: parsed.retrieval?.vector?.topK ?? 48,
        rerankTopK: parsed.retrieval?.vector?.rerankTopK ?? 24,
        maxResults: parsed.retrieval?.vector?.maxResults ?? 6,
      },
    },
  };

  return {
    config,
    provenance: {
      preset: parsed.preset ? 'file' : 'default',
      language: sourceForPath(rawInput, presetInput, presetName, 'language'),
      'llm.provider': sourceForPath(rawInput, presetInput, presetName, 'llm.provider'),
      'llm.model': sourceForPath(rawInput, presetInput, presetName, 'llm.model'),
      'llm.apiKey': sourceForPath(rawInput, presetInput, presetName, 'llm.apiKey'),
      'llm.baseUrl': sourceForPath(rawInput, presetInput, presetName, 'llm.baseUrl'),
      'llm.temperature': sourceForPath(rawInput, presetInput, presetName, 'llm.temperature'),
      'llm.timeoutMs': sourceForPath(rawInput, presetInput, presetName, 'llm.timeoutMs'),
      'llm.numCtx': sourceForPath(rawInput, presetInput, presetName, 'llm.numCtx'),
      'llm.flashAttention': sourceForPath(rawInput, presetInput, presetName, 'llm.flashAttention'),
      'llm.kvCacheType': sourceForPath(rawInput, presetInput, presetName, 'llm.kvCacheType'),
      'limits.requestsPerMinute': sourceForPath(rawInput, presetInput, presetName, 'limits.requestsPerMinute'),
      'limits.maxInFlightRequests': sourceForPath(rawInput, presetInput, presetName, 'limits.maxInFlightRequests'),
      'limits.maxInputTokensPerCall': sourceForPath(rawInput, presetInput, presetName, 'limits.maxInputTokensPerCall'),
      'limits.targetInputTokensPerCall': sourceForPath(rawInput, presetInput, presetName, 'limits.targetInputTokensPerCall'),
      'limits.maxProfileChars': sourceForPath(rawInput, presetInput, presetName, 'limits.maxProfileChars'),
      'build.refreshOnIngest': sourceForPath(rawInput, presetInput, presetName, 'build.refreshOnIngest'),
      'build.slotBatchSize': sourceForPath(rawInput, presetInput, presetName, 'build.slotBatchSize'),
      'build.maxBuildContextChars': sourceForPath(rawInput, presetInput, presetName, 'build.maxBuildContextChars'),
      'retrieval.buildStrategy': sourceForPath(rawInput, presetInput, presetName, 'retrieval.buildStrategy'),
      'retrieval.maxContextFiles': sourceForPath(rawInput, presetInput, presetName, 'retrieval.maxContextFiles'),
      'retrieval.maxChunksPerPage': sourceForPath(rawInput, presetInput, presetName, 'retrieval.maxChunksPerPage'),
      'retrieval.maxChunkChars': sourceForPath(rawInput, presetInput, presetName, 'retrieval.maxChunkChars'),
      'retrieval.maxSourceChars': sourceForPath(rawInput, presetInput, presetName, 'retrieval.maxSourceChars'),
      'retrieval.vector.enabled': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.enabled'),
      'retrieval.vector.baseUrl': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.baseUrl'),
      'retrieval.vector.apiKey': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.apiKey'),
      'retrieval.vector.requestsPerMinute':
        pathHasOwnValue(rawInput, 'retrieval.vector.requestsPerMinute') ||
        pathHasOwnValue(presetInput, 'retrieval.vector.requestsPerMinute')
          ? sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.requestsPerMinute')
          : sourceForPath(rawInput, presetInput, presetName, 'limits.requestsPerMinute'),
      'retrieval.vector.timeoutMs': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.timeoutMs'),
      'retrieval.vector.embeddingModel': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.embeddingModel'),
      'retrieval.vector.rerankEnabled': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.rerankEnabled'),
      'retrieval.vector.rerankerModel': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.rerankerModel'),
      'retrieval.vector.topK': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.topK'),
      'retrieval.vector.rerankTopK': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.rerankTopK'),
      'retrieval.vector.maxResults': sourceForPath(rawInput, presetInput, presetName, 'retrieval.vector.maxResults'),
      'mcp.accessKey': mcpAccessKey && !parsed.mcp?.accessKey
        ? 'env'
        : sourceForPath(rawInput, presetInput, presetName, 'mcp.accessKey'),
      'mcp.tls.certPath': mcpCertPath
        ? 'env'
        : sourceForPath(rawInput, presetInput, presetName, 'mcp.tls.certPath'),
      'mcp.tls.keyPath': mcpKeyPath
        ? 'env'
        : sourceForPath(rawInput, presetInput, presetName, 'mcp.tls.keyPath'),
      'mcp.tls.caPath': mcpCaPath
        ? 'env'
        : sourceForPath(rawInput, presetInput, presetName, 'mcp.tls.caPath'),
    },
  };
}
