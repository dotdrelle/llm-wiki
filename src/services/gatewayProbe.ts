import type { AppConfig } from '../types.ts';

/**
 * Sondage d'une AI gateway, pour `wiki doctor`.
 *
 * À la demande uniquement — jamais au fil des requêtes d'ingest ou de build.
 * Une gateway peut exposer des centaines de modèles et `/model/info` n'est pas
 * gratuit ; l'appeler en boucle transformerait un diagnostic en surcoût.
 */

export interface GatewayModel {
  name: string;
  /** `chat`, `embedding`, `rerank`, `image_generation`… selon la gateway. */
  mode?: string;
  /** Fenêtre de contexte déclarée, quand la gateway la publie. */
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface GatewayCatalog {
  models: GatewayModel[];
  byName: Map<string, GatewayModel>;
  /** Vrai si `/model/info` a répondu : les modes et fenêtres sont connus. */
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
 * Récupère le catalogue de la gateway.
 *
 * Dégradation gracieuse — jamais un défaut inventé en silence :
 *   1. `/model/info` : modes et fenêtres de contexte connus (`typed: true`) ;
 *   2. `/v1/models` : noms seulement (`typed: false`) — on sait quels modèles
 *      existent, pas ce qu'ils sont ;
 *   3. injoignable : `undefined`, et l'appelant le dit à l'utilisateur.
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
    // `/model/info` est propre à certaines gateways — son absence est normale,
    // pas une erreur. On tente la voie standard.
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
 * Vérifie que l'endpoint de rerank existe réellement.
 *
 * Une gateway peut très bien servir `/chat/completions` et `/embeddings` sans
 * `/rerank`. Sans ce sondage, l'absence ne se manifeste qu'au premier build,
 * sous la forme d'une erreur HTTP opaque très loin de sa cause.
 *
 * Le document envoyé est volontairement trivial : c'est un test d'existence,
 * pas de qualité.
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
    // 400 sur un modèle inconnu, 401/403 sur une clé : l'endpoint existe, le
    // problème est ailleurs. On ne conclut pas à son absence.
    return { status: 'unknown', detail: `HTTP ${res.status}` };
  } catch (error) {
    return {
      status: 'unknown',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
