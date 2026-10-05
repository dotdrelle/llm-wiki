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
  if (urlPath === '/api/runtime/maintenance' && ['GET','POST'].includes(req.method ?? '')) {
    const offset = new URL(req.url ?? '/', 'http://localhost').searchParams.get('historyOffset');
    const target = deps.runtimePathForWorkspace('/maintenance');
    await proxyRuntimeJson(req, res, target + (offset === null ? '' : `${target.includes('?') ? '&' : '?'}historyOffset=${encodeURIComponent(offset)}`), deps.proxyDeps);
    return true;
  }
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
  // Redo: drop everything the runtime recorded after one conversation entry.
  // Workspace-scoped like /cancel and /approve — the runtime rejects the call
  // outright while a run is active.
  if (urlPath === '/api/runtime/conversation/truncate' && req.method === 'POST') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/conversation/truncate'), deps.proxyDeps);
    return true;
  }
  // Compact: mark everything said so far as forgotten for future turns
  // (conversationSeed), without deleting the event log — unlike truncate
  // above. Same workspace-scoped, run-active-refusing shape.
  if (urlPath === '/api/runtime/conversation/compact' && req.method === 'POST') {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/conversation/compact'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/memory/facts' && (req.method === 'GET' || req.method === 'POST')) {
    // The workspace path already carries `?workspace=`: the caller's query
    // joins it with `&`, never a second `?`.
    const target = deps.runtimePathForWorkspace('/memory/facts');
    const query = req.method === 'GET' ? new URL(req.url ?? '/', 'http://localhost').search.replace(/^\?/, '') : '';
    await proxyRuntimeJson(req, res, query ? `${target}${target.includes('?') ? '&' : '?'}${query}` : target, deps.proxyDeps);
    return true;
  }
  const memoryPath = urlPath.match(/^\/api\/runtime\/memory\/(facts\/[^/]+|history\/[^/]+)$/);
  if (memoryPath && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
    const target = deps.runtimePathForWorkspace(`/memory/${memoryPath[1]}`);
    await proxyRuntimeJson(req, res, target, deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/control' && (req.method === 'GET' || req.method === 'POST')) {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/control'), deps.proxyDeps);
    return true;
  }
  if (urlPath === '/api/runtime/mcp/endpoints' && (req.method === 'GET' || req.method === 'POST')) {
    await proxyRuntimeJson(req, res, deps.runtimePathForWorkspace('/mcp/endpoints'), deps.proxyDeps);
    return true;
  }
  return false;
}
