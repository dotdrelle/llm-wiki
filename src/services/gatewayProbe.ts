import type { AppConfig } from '../types.ts';

/**
 * Probing of an AI gateway, for `wiki doctor`.
 *
 * On demand only — never during ingest or build requests. A gateway can expose
 * hundreds of models and `/model/info` is not free; calling it in a loop would
 * turn a diagnostic into an extra cost.
 */

export interface GatewayModel {
  name: string;
  /** `chat`, `embedding`, `rerank`, `image_generation`… depending on the gateway. */
  mode?: string;
  /** Declared context window, when the gateway publishes it. */
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface GatewayCatalog {
  models: GatewayModel[];
  byName: Map<string, GatewayModel>;
  /** True if `/model/info` answered: modes and windows are known. */
  typed: boolean;
  source: 'model-info' | 'models';
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

async function getJson(
  url: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey ?? ''}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function rootOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Fetches the gateway catalog.
 *
 * Graceful degradation — never a silently invented default:
 *   1. `/model/info`: modes and context windows known (`typed: true`);
 *   2. `/v1/models`: names only (`typed: false`) — we know which models exist,
 *      not what they are;
 *   3. unreachable: `undefined`, and the caller tells the user.
 */
export async function fetchGatewayCatalog(
  config: AppConfig,
  timeoutMs = 5000,
): Promise<GatewayCatalog | undefined> {
  const root = rootOf(config.llm.baseUrl);
  const apiKey = config.llm.apiKey;

  try {
    const payload = (await getJson(`${root}/model/info`, apiKey, timeoutMs)) as {
      data?: Array<Record<string, unknown>>;
    };
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const models: GatewayModel[] = [];
    for (const item of items) {
      const info = (item.model_info ?? {}) as Record<string, unknown>;
      const name = item.model_name ?? item.id ?? info.id;
      if (typeof name !== 'string') continue;
      models.push({
        name,
        mode: typeof info.mode === 'string' ? info.mode : undefined,
        maxInputTokens: readPositiveInt(info.max_input_tokens),
        maxOutputTokens: readPositiveInt(info.max_output_tokens ?? info.max_tokens),
      });
    }
    if (models.length > 0) {
      return {
        models,
        byName: new Map(models.map((model) => [model.name, model])),
        typed: true,
        source: 'model-info',
      };
    }
  } catch {
    // `/model/info` is specific to some gateways — its absence is normal, not
    // an error. We try the standard path.
  }

  try {
    const payload = (await getJson(`${root}/v1/models`, apiKey, timeoutMs)) as {
      data?: Array<Record<string, unknown>>;
    };
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const models: GatewayModel[] = items
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
      .map((name) => ({ name }));
    if (models.length === 0) return undefined;
    return {
      models,
      byName: new Map(models.map((model) => [model.name, model])),
      typed: false,
      source: 'models',
    };
  } catch {
    return undefined;
  }
}

export type RerankProbe =
  | { status: 'ok' }
  | { status: 'unsupported'; detail: string }
  | { status: 'unknown'; detail: string };

/**
 * Verifies that the rerank endpoint actually exists.
 *
 * A gateway can very well serve `/chat/completions` and `/embeddings` without
 * `/rerank`. Without this probe, the absence only shows up at the first build,
 * as an opaque HTTP error very far from its cause.
 *
 * The document sent is deliberately trivial: it is an existence test, not a
 * quality test.
 */
export async function probeRerank(
  config: AppConfig,
  timeoutMs = 5000,
): Promise<RerankProbe> {
  const baseUrl = config.retrieval.vector.baseUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.retrieval.vector.apiKey
          ? { Authorization: `Bearer ${config.retrieval.vector.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: config.retrieval.vector.rerankerModel,
        query: 'ping',
        documents: ['pong'],
        top_n: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) return { status: 'ok' };
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return {
        status: 'unsupported',
        detail: `HTTP ${res.status} on POST /rerank`,
      };
    }
    // 400 on an unknown model, 401/403 on a key: the endpoint exists, the
    // problem is elsewhere. We do not conclude to its absence.
    return { status: 'unknown', detail: `HTTP ${res.status}` };
  } catch (error) {
    return {
      status: 'unknown',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
