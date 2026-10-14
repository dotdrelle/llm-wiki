import type { IncomingMessage, ServerResponse } from 'node:http';
import { runtimeHeaders, runtimeTarget, type RuntimeProxyDeps } from '../proxy/runtimeProxy.ts';

/** Three missed runtime pings (one every 15 s) mean the upstream is dead. */
export const RUNTIME_STREAM_IDLE_MS = 45_000;

export async function proxyRuntimeEvents(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: RuntimeProxyDeps,
  idleMs: number = RUNTIME_STREAM_IDLE_MS,
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
    // The runtime writes a frame on every stream at least every 15 s. After a
    // sleep the upstream socket can stay "established" while nothing will ever
    // arrive on it: the browser's EventSource to serve is healthy, so it never
    // reconnects, and the chat waits forever. A silent upstream is ended here,
    // which makes the browser reconnect through a fresh upstream.
    const reader = upstream.body.getReader();
    let idle: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), idleMs);
    };
    armIdle();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        res.write(Buffer.from(value));
      }
    } finally {
      if (idle) clearTimeout(idle);
    }
    res.end();
  } catch {
    if (!res.headersSent) deps.sendJson(res, 503, { ok: false, error: 'runtime unavailable' });
    else res.end();
  }
}
