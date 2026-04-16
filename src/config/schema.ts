import { z } from 'zod';
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OPENAI_BASE_URL } from './defaults.ts';
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
  const type =
    candidate.type ?? candidate.action ?? candidate.operation ?? candidate.op ?? candidate.kind;
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

  return {
    ...candidate,
    type,
    path: typeof path === 'string' ? path.trim() : path,
    content: typeof content === 'string' ? content : content,
  };
}

const llmSchema = z
  .object({
    provider: z.enum(['openai', 'ollama', 'openai-compatible']).default('openai'),
    model: z.string().min(1).default('gpt-4.1-mini'),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    temperature: z.number().min(0).max(2).default(0.1),
  })
  .default({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    temperature: 0.1,
  });

const buildSchema = z
  .object({
    refreshOnIngest: z.boolean().default(true),
  })
  .default({
    refreshOnIngest: true,
  });

const retrievalSchema = z
  .object({
    maxContextFiles: z.number().int().min(1).max(24).default(8),
  })
  .default({
    maxContextFiles: 8,
  });

export const rawConfigSchema = z.object({
  wikiRoot: z.string().optional(),
  llm: llmSchema.optional(),
  build: buildSchema.optional(),
  retrieval: retrievalSchema.optional(),
});

export const wikiOperationSchema = z.preprocess(
  normalizeWikiOperation,
  z.object({
    type: z.preprocess(normalizeOperationType, z.enum(['create', 'update', 'delete'])),
    path: z.string().min(1),
    content: z.string().optional(),
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
      operations: candidate.operations ?? candidate.changes ?? candidate.patches ?? candidate.files,
    };
  },
  z.object({
    summary: z.string().default('Ingest completed.'),
    operations: z.array(wikiOperationSchema).default([]),
  }),
);

export const deliverableResponseSchema = z.object({
  replacements: z.array(
    z.object({
      id: z.string().min(1),
      content: z.string().min(1),
    }),
  ),
});

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
      outputHash: z.string().min(1),
      outputRelativePath: z.string().min(1),
    }),
  ),
});

export function resolveConfig(input: unknown, wikiRoot: string, configPath?: string): AppConfig {
  const parsed = rawConfigSchema.parse(input ?? {});
  const provider = parsed.llm?.provider ?? 'openai';

  const baseUrl =
    parsed.llm?.baseUrl ??
    (provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_OPENAI_BASE_URL);

  if (provider === 'openai-compatible' && !parsed.llm?.baseUrl) {
    throw new Error('Provider "openai-compatible" requires llm.baseUrl in .wikirc.yaml.');
  }

  const apiKey =
    parsed.llm?.apiKey ??
    (provider === 'openai' ? process.env.OPENAI_API_KEY : undefined) ??
    (provider === 'ollama' ? 'ollama' : undefined);

  return {
    wikiRoot,
    configPath,
    llm: {
      provider,
      model: parsed.llm?.model ?? 'gpt-4.1-mini',
      apiKey,
      baseUrl,
      temperature: parsed.llm?.temperature ?? 0.1,
    },
    build: {
      refreshOnIngest: parsed.build?.refreshOnIngest ?? true,
    },
    retrieval: {
      maxContextFiles: parsed.retrieval?.maxContextFiles ?? 8,
    },
  };
}
