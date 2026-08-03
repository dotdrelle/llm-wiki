import type { IncomingMessage, ServerResponse } from 'node:http';

export type RuntimeProxyDeps = {
  runtimeUrl: () => string | null;
  runtimeToken: () => string | null;
  readRequestBuffer: (req: IncomingMessage, maxBytes?: number) => Promise<Buffer>;
  sendJson: (
    res: {
      writeHead: (s: number, h: Record<string, string>) => void;
      end: (c?: string) => void;
    },
    status: number,
    data: unknown,
  ) => void;
};

export function runtimeHeaders(deps: Pick<RuntimeProxyDeps, 'runtimeToken'>): Record<string, string> {
  const token = deps.runtimeToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function runtimeTarget(
  deps: Pick<RuntimeProxyDeps, 'runtimeUrl'>,
  pathname: string,
): string | null {
  const base = deps.runtimeUrl();
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}${pathname}`;
}

export async function proxyRuntimeJson(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: RuntimeProxyDeps,
  extra?: Record<string, unknown>,
  onSuccess?: (parsed: unknown) => Promise<unknown> | unknown,
): Promise<void> {
  const target = runtimeTarget(deps, pathname);
  if (!target) {
    deps.sendJson(res, 503, { ok: false, error: 'runtime not configured' });
    return;
  }
  let body = req.method === 'POST' ? await deps.readRequestBuffer(req, 1024 * 1024) : null;
  if (extra && body) {
    try {
      body = Buffer.from(JSON.stringify({ ...JSON.parse(body.toString()), ...extra }));
    } catch { /* malformed body - pass through as-is */ }
  }
  // A connection failure means the runtime process is not listening (host
  // runtime still booting, or the manager shell is not running). Nothing was
  // processed upstream, so retrying is safe — and absorbs the first-boot race
  // where the serve container is up before the host runtime accepts requests.
  let upstream: Response | undefined;
  for (let attempt = 0; attempt < 3 && !upstream; attempt += 1) {
    try {
      upstream = await fetch(target, {
        method: req.method ?? 'GET',
        headers: {
          ...runtimeHeaders(deps),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body && body.length > 0 ? body : undefined,
      });
    } catch {
      if (attempt < 2) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * (attempt + 1)));
      }
    }
  }
  if (!upstream) {
    deps.sendJson(res, 503, {
      ok: false,
      error: 'runtime unavailable — is wiki-manager running on the host?',
    });
    return;
  }
  try {
    let text = await upstream.text();
    if (onSuccess && upstream.ok && text) {
      const parsed = (() => { try { return JSON.parse(text); } catch { return undefined; } })();
      if (parsed !== undefined) {
        try {
          text = JSON.stringify(await onSuccess(parsed));
        } catch (err) {
          deps.sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          return;
        }
      }
    }
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(text);
  } catch {
    deps.sendJson(res, 503, { ok: false, error: 'runtime unavailable' });
  }
}

/** Submit a server-created JSON payload to the runtime without forwarding a client request body. */
export async function proxyRuntimePayload(
  res: ServerResponse,
  pathname: string,
  deps: RuntimeProxyDeps,
  payload: Record<string, unknown>,
): Promise<void> {
  const target = runtimeTarget(deps, pathname);
  if (!target) {
    deps.sendJson(res, 503, { ok: false, error: 'runtime not configured' });
    return;
  }
  let upstream: Response | undefined;
  for (let attempt = 0; attempt < 3 && !upstream; attempt += 1) {
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: { ...runtimeHeaders(deps), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * (attempt + 1)));
    }
  }
  if (!upstream) {
    deps.sendJson(res, 503, { ok: false, error: 'runtime unavailable — is wiki-manager running on the host?' });
    return;
  }
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
  res.end(await upstream.text());
}

export async function submitHistoryRestoreToRuntime(
  res: ServerResponse,
  deps: RuntimeProxyDeps,
  payload: { file?: string; run?: string; to?: string; dryRun?: boolean; intent?: string },
  workspace: string | null,
): Promise<void> {
  const target = payload.run
    ? `Execute the supplied workspace.restore capability plan for run ${payload.run}. Do not infer or alter its arguments.`
    : `Execute the supplied workspace.restore capability plan for file ${payload.file} at revision ${payload.to}. Do not infer or alter its arguments.`;
  await proxyRuntimePayload(res, '/run', deps, {
    input: target,
    ...(workspace ? { workspace } : {}),
    ...(payload.intent === 'enqueue' ? { intent: 'enqueue' } : {}),
    capabilityPlan: {
      capability: 'workspace.restore',
      operation: 'restore',
      arguments: payload.run
        ? { run: payload.run, ...(payload.dryRun ? { dryRun: true } : {}) }
        : { file: payload.file, to: payload.to, ...(payload.dryRun ? { dryRun: true } : {}) },
      requireApproval: true,
    },
  });
}
