import { z } from 'zod';
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
} from './defaults.ts';
import type { AppConfig } from '../types.ts';

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
    slotBatchSize: z.number().int().min(1).max(50).default(3),
    maxBuildContextChars: z.number().int().min(1000).default(12000),
  })
  .default({
    refreshOnIngest: true,
    slotBatchSize: 3,
    maxBuildContextChars: 12000,
  });

const retrievalSchema = z
  .object({
    maxContextFiles: z.number().int().min(1).max(24).default(5),
    maxChunksPerPage: z.number().int().min(1).max(10).default(2),
    maxChunkChars: z.number().int().min(200).default(3000),
    maxSourceChars: z.number().int().min(500).default(8000),
  })
  .default({
    maxContextFiles: 5,
    maxChunksPerPage: 2,
    maxChunkChars: 3000,
    maxSourceChars: 8000,
  });

const mcpSchema = z
  .object({
    accessKey: z.string().min(1).optional(),
  })
  .default({});

export const rawConfigSchema = z.object({
  wikiRoot: z.string().optional(),
  llm: llmSchema.optional(),
  build: buildSchema.optional(),
  retrieval: retrievalSchema.optional(),
  mcp: mcpSchema.optional(),
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
  const parsed = rawConfigSchema.parse(input ?? {});
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
    (provider === 'openai' ? process.env.OPENAI_API_KEY : undefined) ??
    (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : undefined) ??
    (provider === 'ollama' ? 'ollama' : undefined);

  return {
    wikiRoot,
    configPath,
    mcp: {
      accessKey: parsed.mcp?.accessKey,
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
    build: {
      refreshOnIngest: parsed.build?.refreshOnIngest ?? true,
      slotBatchSize: parsed.build?.slotBatchSize ?? 3,
      maxBuildContextChars: parsed.build?.maxBuildContextChars ?? 12000,
    },
    retrieval: {
      maxContextFiles: parsed.retrieval?.maxContextFiles ?? 5,
      maxChunksPerPage: parsed.retrieval?.maxChunksPerPage ?? 2,
      maxChunkChars: parsed.retrieval?.maxChunkChars ?? 3000,
      maxSourceChars: parsed.retrieval?.maxSourceChars ?? 8000,
    },
  };
}
