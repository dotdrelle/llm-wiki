import { loadConfigDetails } from '../config/loadConfig.ts';
import type { EffectiveConfigDetails } from '../config/schema.ts';

function redact(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  return value.length <= 8 ? '<set>' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function effectiveConfigObject(details: EffectiveConfigDetails): Record<string, unknown> {
  const { config } = details;
  return {
    configPath: config.configPath ?? null,
    wikiRoot: config.wikiRoot,
    preset: config.preset ?? null,
    language: config.language,
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey ? redact(config.llm.apiKey) : null,
      apiKeyEnv: config.llm.apiKeyEnv ?? null,
      baseUrl: config.llm.baseUrl,
      temperature: config.llm.temperature,
      timeoutMs: config.llm.timeoutMs,
      numCtx: config.llm.numCtx ?? null,
      flashAttention: config.llm.flashAttention ?? null,
      kvCacheType: config.llm.kvCacheType ?? null,
    },
    limits: config.limits,
    build: config.build,
    retrieval: {
      maxContextFiles: config.retrieval.maxContextFiles,
      maxChunksPerPage: config.retrieval.maxChunksPerPage,
      maxChunkChars: config.retrieval.maxChunkChars,
      maxSourceChars: config.retrieval.maxSourceChars,
      buildStrategy: config.retrieval.buildStrategy,
      vector: {
        enabled: config.retrieval.vector.enabled,
        baseUrl: config.retrieval.vector.baseUrl,
        apiKey: config.retrieval.vector.apiKey
          ? redact(config.retrieval.vector.apiKey)
          : null,
        apiKeyEnv: config.retrieval.vector.apiKeyEnv ?? null,
        requestsPerMinute: config.retrieval.vector.requestsPerMinute,
        timeoutMs: config.retrieval.vector.timeoutMs,
        embeddingModel: config.retrieval.vector.embeddingModel,
        rerankEnabled: config.retrieval.vector.rerankEnabled,
        rerankerModel: config.retrieval.vector.rerankerModel,
        topK: config.retrieval.vector.topK,
        rerankTopK: config.retrieval.vector.rerankTopK,
        maxResults: config.retrieval.vector.maxResults,
      },
    },
    mcp: {
      accessKey: config.mcp.accessKey ? redact(config.mcp.accessKey) : null,
      readToken: config.mcp.readToken ? redact(config.mcp.readToken) : null,
      writeToken: config.mcp.writeToken ? redact(config.mcp.writeToken) : null,
      tls: config.mcp.tls ?? null,
    },
    serve: config.serve ?? null,
  };
}

function printProvenance(details: EffectiveConfigDetails): void {
  console.log('\nProvenance');
  for (const [key, source] of Object.entries(details.provenance).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${key}: ${source}`);
  }
}

export default async function configCmd(options: { effective?: boolean; json?: boolean }) {
  if (!options.effective) {
    console.log('Use `wiki config --effective` to print the merged configuration.');
    return;
  }

  const details = await loadConfigDetails(process.cwd());
  const effective = effectiveConfigObject(details);
  if (options.json) {
    console.log(JSON.stringify({ effective, provenance: details.provenance }, null, 2));
    return;
  }

  console.log(JSON.stringify(effective, null, 2));
  printProvenance(details);
}
