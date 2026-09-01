import type { IncomingMessage, ServerResponse } from 'node:http';

export type ConnectorsOAuthRouteDeps = {
  connectorUrl: () => string | null;
  oauthStartToken: () => string | null;
  workspaceName: () => string | null;
  readRequestBuffer: (req: IncomingMessage, maxBytes?: number) => Promise<Buffer>;
  sendJson: (
    res: ServerResponse,
    status: number,
    data: unknown,
  ) => void;
};

export async function handleConnectorsOAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: ConnectorsOAuthRouteDeps,
): Promise<boolean> {
  if (
    urlPath === '/api/connectors/google/oauth/start' &&
    req.method === 'POST'
  ) {
    if (req.headers['x-llm-wiki-oauth'] !== '1' || !sameOrigin(req)) {
      deps.sendJson(res, 403, { ok: false, error: 'forbidden' });
      return true;
    }
    const base = deps.connectorUrl();
    const token = deps.oauthStartToken();
    const workspace = deps.workspaceName();
    if (!base || !token || !workspace) {
      deps.sendJson(res, 503, {
        ok: false,
        error: 'connectors OAuth is not configured',
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      const raw = await deps.readRequestBuffer(req, 16_384);
      body = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      deps.sendJson(res, 400, { ok: false, error: 'invalid request' });
      return true;
    }
    const instanceId =
      typeof body.instanceId === 'string' && body.instanceId.trim()
        ? body.instanceId.trim()
        : 'google-1';
    // Send is part of the normal authorization: the connector both reads and
    // sends Gmail, so the default grants ask for both. When the deployment
    // disabled send (CONNECTORS_SEND_ENABLED=false) the agent refuses the
    // pair — fall back to read-only instead of failing the whole flow.
    const requestedGrants =
      Array.isArray(body.grants) &&
      body.grants.every((grant) => typeof grant === 'string')
        ? (body.grants as string[])
        : null;
    const returnTo = originFromRequest(req);
    const upstreamStart = (grants: string[]) =>
      fetch(`${base.replace(/\/+$/, '')}/oauth/google/start`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspace,
          instanceId,
          grants,
          ...(returnTo ? { returnTo } : {}),
        }),
      });
    const relay = (text: string, upstream: Response) => {
      res.writeHead(upstream.status, {
        'Content-Type':
          upstream.headers.get('content-type') ??
          'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
      return true;
    };
    try {
      const grants = requestedGrants ?? ['read', 'send'];
      const first = await upstreamStart(grants);
      const text = await first.text();
      if (requestedGrants === null && first.status === 409) {
        let payload: Record<string, unknown> | null = null;
        try {
          payload = JSON.parse(text) as Record<string, unknown>;
        } catch {
          payload = null;
        }
        if (payload?.error === 'send_capability_disabled') {
          const retry = await upstreamStart(['read']);
          const retryText = await retry.text();
          return relay(retryText, retry);
        }
      }
      return relay(text, first);
    } catch {
      deps.sendJson(res, 503, {
        ok: false,
        error: 'connectors agent unavailable',
      });
    }
    return true;
  }

  if (urlPath === '/oauth/google/callback' && req.method === 'GET') {
    const base = deps.connectorUrl();
    if (!base) {
      deps.sendJson(res, 503, {
        ok: false,
        error: 'connectors OAuth is not configured',
      });
      return true;
    }
    const rawUrl = req.url ?? '/oauth/google/callback';
    const queryIndex = rawUrl.indexOf('?');
    const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';
    try {
      // Preserve the raw callback query and never derive redirect_uri from
      // Host/X-Forwarded-*; the agent uses its configured public URL.
      const upstream = await fetch(
        `${base.replace(/\/+$/, '')}/oauth/google/callback${query}`,
        { method: 'GET' },
      );
      const body = await upstream.text();
      const headers: Record<string, string> = {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      };
      for (const name of ['content-security-policy', 'x-content-type-options']) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      res.writeHead(upstream.status, headers);
      res.end(body);
    } catch {
      res.writeHead(503, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Authorization unavailable</title>' +
          '<h1>Authorization unavailable</h1><p>Return to wikiLLM and try again.</p>',
      );
    }
    return true;
  }
  return false;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    if (`${parsed.host}` === host) return true;
    const [hostName, hostPort = ''] = host.split(':');
    return (
      ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
      ['localhost', '127.0.0.1'].includes(hostName ?? '') &&
      parsed.port === hostPort
    );
  } catch {
    return false;
  }
}

// The "back to the workspace" link on the connector's callback page points at
// this serve origin — the page the user started from. Built from the request
// itself (never from Host-agnostic state), honouring the proxy protocol when
// one is announced; the agent sanitizes it again before rendering.
function originFromRequest(req: IncomingMessage): string | null {
  const host = String(req.headers.host ?? '').trim();
  if (!host) return null;
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim();
  const proto = forwarded === 'https' ? 'https' : forwarded === 'http' ? 'http' : 'http';
  try {
    const url = new URL(`${proto}://${host}/`);
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}
