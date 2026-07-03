import type { IncomingMessage, ServerResponse } from 'node:http';
import { runtimeHeaders, runtimeTarget, type RuntimeProxyDeps } from '../proxy/runtimeProxy.ts';

export async function proxyRuntimeEvents(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: RuntimeProxyDeps,
): Promise<void> {
  const target = runtimeTarget(deps, pathname);
  if (!target) {
    deps.sendJson(res, 503, { ok: false, error: 'runtime not configured' });
    return;
  }
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    const upstream = await fetch(target, {
      headers: {
        ...runtimeHeaders(deps),
        accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      deps.sendJson(res, upstream.status || 503, { ok: false, error: 'runtime stream unavailable' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch {
    if (!res.headersSent) deps.sendJson(res, 503, { ok: false, error: 'runtime unavailable' });
    else res.end();
  }
}
