import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../../types.ts';
import { proxyRuntimeJson, type RuntimeProxyDeps } from '../proxy/runtimeProxy.ts';
import { fetchGatewayCatalog } from '../../services/gatewayProbe.ts';

type ConfigRoutesDeps = {
  config: AppConfig;
  proxyDeps: RuntimeProxyDeps;
  runtimePathForWorkspace: (pathname: string) => string;
  workspaceNameFromEnv: () => string | null;
  mirrorRuntimeConfig: (payload: unknown) => Promise<AppConfig>;
  readRequestBody: (req: IncomingMessage) => Promise<string>;
  sendJson: (
    res: {
      writeHead: (s: number, h: Record<string, string>) => void;
      end: (c?: string) => void;
    },
    status: number,
    data: unknown,
  ) => void;
};

export async function handleConfigRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: ConfigRoutesDeps,
): Promise<boolean> {
  if (urlPath === '/api/config/profiles' && req.method === 'GET') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/config/profiles'), deps.proxyDeps);
    return true;
  }

  if (urlPath === '/api/config/use' && req.method === 'POST') {
    const wsName = deps.workspaceNameFromEnv();
    await proxyRuntimeJson(
      req,
      res,
      deps.runtimePathForWorkspace('/config/use'),
      deps.proxyDeps,
      wsName ? { workspace: wsName } : undefined,
      async (parsed) => ({ ...(parsed as Record<string, unknown>), config: await deps.mirrorRuntimeConfig(parsed) }),
    );
    return true;
  }

  // Is the configured LLM endpoint actually reachable, right now?
  //
  // Reset used to rewrite the fields and stop there. A workspace whose endpoint
  // was unreachable therefore looked repaired — same values on screen as a
  // working one — while every request kept failing, and the only way to tell
  // was to send a message and read the error. This answers the question
  // directly, with a catalog read: no tokens spent, and the same call the
  // wizard and `doctor` already use to enumerate models.
  if (urlPath === '/api/llm/probe' && req.method === 'POST') {
    const started = Date.now();
    if (!deps.config.llm.baseUrl) {
      deps.sendJson(res, 200, { ok: false, reason: 'no-base-url', message: 'No LLM base URL configured.' });
      return true;
    }
    try {
      const catalog = await fetchGatewayCatalog(deps.config, 5000);
      if (!catalog) {
        deps.sendJson(res, 200, {
          ok: false,
          reason: 'unreachable',
          message: `No answer from ${deps.config.llm.baseUrl} — check the endpoint, the proxy and the CA bundle.`,
        });
        return true;
      }
      // A reachable endpoint that does not serve the configured model is a
      // different failure, and the one an operator is least likely to guess.
      const model = deps.config.llm.model;
      const known = model ? catalog.byName.has(model) : false;
      deps.sendJson(res, 200, {
        ok: true,
        models: catalog.models.length,
        elapsedMs: Date.now() - started,
        ...(model && !known
          ? { warning: `Reachable, but "${model}" is not in the ${catalog.models.length} models it serves.` }
          : {}),
      });
    } catch (err) {
      deps.sendJson(res, 200, {
        ok: false,
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (urlPath !== '/api/llm-config') return false;

  if (req.method === 'GET') {
    deps.sendJson(res, 200, {
      model: deps.config.llm.model,
      temperature: deps.config.llm.temperature,
      baseUrl: deps.config.llm.baseUrl,
      apiKey: deps.config.llm.apiKey ?? '',
    });
    return true;
  }
  if (req.method === 'PATCH') {
    const body = JSON.parse(await deps.readRequestBody(req) || '{}') as Record<string, unknown>;
    deps.sendJson(res, 200, {
      ok: true,
      // Temperature is deliberately absent: it belongs to the active .wikirc
      // profile and has no session-scoped form. It used to be echoed here and
      // carried a UI field, which suggested it could be overridden per session
      // — it could not, and nothing ever persisted it.
      override: {
        model: typeof body.model === 'string' ? body.model : undefined,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      },
    });
    return true;
  }
  deps.sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}
