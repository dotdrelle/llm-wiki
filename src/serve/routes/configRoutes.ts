import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../../types.ts';
import { proxyRuntimeJson, type RuntimeProxyDeps } from '../proxy/runtimeProxy.ts';

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
      override: {
        model: typeof body.model === 'string' ? body.model : undefined,
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      },
    });
    return true;
  }
  deps.sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}
