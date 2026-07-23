import type { IncomingMessage, ServerResponse } from 'node:http';
import { proxyRuntimeJson, type RuntimeProxyDeps } from '../proxy/runtimeProxy.ts';
import { proxyRuntimeEvents } from '../sse/runtimeEvents.ts';

export type RuntimeRoutesDeps = {
  proxyDeps: RuntimeProxyDeps;
  runtimePathForWorkspace: (pathname: string) => string;
  workspaceNameFromEnv: () => string | null;
};

export async function handleRuntimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: RuntimeRoutesDeps,
): Promise<boolean> {
  if (urlPath === '/api/runtime/state' && req.method === 'GET') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/state'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/health' && req.method === 'GET') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/health'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/events' && req.method === 'GET') {
    await proxyRuntimeEvents(req, res, deps.runtimePathForWorkspace('/events/stream'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/run' && req.method === 'POST') {
    const wsName = deps.workspaceNameFromEnv();
    await proxyRuntimeJson(req, res, '/run', deps.proxyDeps, wsName ? { workspace: wsName } : undefined);
    return true;
  }
  if (urlPath === '/api/runtime/turn' && req.method === 'POST') {
    const wsName = deps.workspaceNameFromEnv();
    await proxyRuntimeJson(req, res, '/turn', deps.proxyDeps, wsName ? { workspace: wsName } : undefined);
    return true;
  }
  if (urlPath === '/api/runtime/cancel' && req.method === 'POST') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/cancel'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/approve' && req.method === 'POST') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/approve'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/reset' && req.method === 'POST') {
    const killPath = deps.runtimePathForWorkspace('/kill');
    await proxyRuntimeJson(req, res, `${killPath}${killPath.includes('?') ? '&' : '?'}purge=true`, deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/control' && (req.method === 'GET' || req.method === 'POST')) {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/control'), deps.proxyDeps);
    return true;
  }
  return false;
}
