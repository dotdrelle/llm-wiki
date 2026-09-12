import type { IncomingMessage, ServerResponse } from 'node:http';

/*
 Serve-side TOTP gate. The manager runtime is the authority: serve never sees
 the TOTP secret. It asks `GET /login/status` (public) whether the gate is on,
 forwards the 6-digit code to `POST /login/verify` when the user logs in, and
 validates the `wiki_session` cookie through `GET /session/verify` (bearer,
 server-to-server) with a 30 s memo so a normal page load costs one round trip.

 Fail-closed: when the runtime is unreachable and no memoized session is
 still warm, protected routes answer a clear "session service unavailable"
 page instead of opening the app.
 */

export const SESSION_COOKIE = 'wiki_session';
const STATUS_CACHE_MS = 60_000;
const VERIFY_MEMO_MS = 30_000;

export type TotpGateDeps = {
  runtimeBaseUrl: () => string | null;
  runtimeAuthHeaders: () => Record<string, string>;
  sendJson: (res: ServerResponse, status: number, data: unknown) => void;
  wantsHtml: (req: IncomingMessage) => boolean;
  requestIsTls: (req: IncomingMessage) => boolean;
  sessionTtlMs?: () => number;
};

let cachedStatus: { enabled: boolean | null; checkedAt: number } | null = null;
const verifyMemo = new Map<string, { ok: boolean; at: number; expiresAt?: number }>();

/*
 Clears the status cache and the verification memo. Tests call it between
 cases; production never needs it (the caches expire on their own).
 */
export function resetTotpGateCaches(): void {
  cachedStatus = null;
  verifyMemo.clear();
}

function readCookies(req: IncomingMessage): Record<string, string> {
  const raw = String(req.headers.cookie ?? '');
  const cookies: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export function sessionCookie(req: IncomingMessage): string | null {
  return readCookies(req)[SESSION_COOKIE] || null;
}

async function fetchStatus(base: string): Promise<{ enabled: boolean | null } | null> {
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/login/status`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { enabled?: unknown };
    return { enabled: typeof payload.enabled === 'boolean' ? payload.enabled : null };
  } catch {
    return null;
  }
}

async function statusWithCache(base: string): Promise<{ enabled: boolean | null; reachable: boolean }> {
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.checkedAt < STATUS_CACHE_MS) {
    return { enabled: cachedStatus.enabled, reachable: true };
  }
  const status = await fetchStatus(base);
  if (!status) return { enabled: null, reachable: false };
  cachedStatus = { enabled: status.enabled, checkedAt: now };
  return { enabled: status.enabled, reachable: true };
}

async function verifyToken(base: string, token: string): Promise<{ ok: boolean; expiresAt?: number; authBlocked?: boolean }> {
  const memoized = verifyMemo.get(token);
  if (memoized && Date.now() - memoized.at < VERIFY_MEMO_MS) return { ok: memoized.ok, expiresAt: memoized.expiresAt };
  try {
    const response = await fetch(
      `${base.replace(/\/+$/, '')}/session/verify?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    // 401 here is NOT "invalid session" — the endpoint is public and never
    // answers 401 for a bad token; it means a proxy/bearer misconfiguration
    // in front of the runtime. Treat it as a broken door, not a wrong key,
    // so the user gets an explanation instead of a login loop.
    if (response.status === 401 || response.status === 403) {
      verifyMemo.delete(token);
      return { ok: false, authBlocked: true };
    }
    if (!response.ok) {
      verifyMemo.delete(token);
      return { ok: false };
    }
    const payload = (await response.json()) as { ok?: boolean; expiresAt?: unknown };
    if (payload.ok === true) {
      const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined;
      verifyMemo.set(token, { ok: true, at: Date.now(), expiresAt });
      return { ok: true, expiresAt };
    }
    verifyMemo.delete(token);
    return { ok: false };
  } catch {
    // Unreachable: a previously verified token may still ride its memo.
    return { ok: Boolean(memoized?.ok), expiresAt: memoized?.expiresAt };
  }
}

function hasWarmMemo(): boolean {
  const now = Date.now();
  for (const entry of verifyMemo.values()) {
    if (entry.ok && now - entry.at < VERIFY_MEMO_MS) return true;
  }
  return false;
}

function htmlResponse(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function loginPageHtml({ error = null, tls = false }: { error?: string | null; tls?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wikiLLM — login</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f4f5f7; color: #1c1f26; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  @media (prefers-color-scheme: dark) { body { background: #12141a; color: #e7e9ee; } }
  .box { width: 100%; max-width: 360px; padding: 1.2rem; }
  .brand { display: flex; align-items: center; gap: .5rem; margin-bottom: 1rem; }
  .brand-mark { width: 2rem; height: 2rem; border-radius: 8px; background: #2563eb; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; }
  .brand-name { font-weight: 700; font-size: 1.05rem; }
  .card { background: #fff; border: 1px solid #d9dce3; border-radius: 12px; padding: 1.1rem 1.2rem; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  @media (prefers-color-scheme: dark) { .card { background: #1b1e26; border-color: #333843; } }
  h2 { margin: 0 0 .5rem; font-size: 1rem; }
  p { margin: 0 0 .8rem; font-size: .85rem; line-height: 1.45; }
  .hint { color: #6b7280; font-size: .78rem; }
  form { display: flex; gap: .5rem; }
  input[type="text"] { flex: 1; min-width: 0; font: inherit; font-size: 1.15rem; letter-spacing: .35em; text-align: center; padding: .55rem .4rem; border: 1px solid #c9cdd6; border-radius: 8px; background: #fff; color: inherit; }
  @media (prefers-color-scheme: dark) { input[type="text"] { background: #12141a; border-color: #3a3f4b; } }
  input[type="text"]:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
  button { font: inherit; font-weight: 700; padding: .55rem 1rem; border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }
  button:hover { background: #1d4fd7; }
  button:disabled { opacity: .55; cursor: default; }
  .error { color: #dc2626; font-size: .8rem; margin-top: .6rem; }
</style>
</head>
<body>
<div class="box">
  <div class="brand"><span class="brand-mark">W</span><span class="brand-name">wikiLLM</span></div>
  <div class="card">
    <h2>Two-step login</h2>
    <p>Enter the 6-digit code from your authenticator app.</p>
    <p class="hint">First login? Run <code>wiki-manager login</code> on the machine that hosts the manager — it opens the enrollment page with the QR code.</p>
    <form id="login-form" autocomplete="off">
      <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" aria-label="Verification code" autofocus required>
      <button type="submit" id="submit">Verify</button>
    </form>
    <p class="error" id="error"${error ? '' : ' hidden'}>${escapeHtml(error ?? '')}</p>
  </div>
  <p class="hint">Sessions are valid for the ShellUI and serve, ${tls ? '' : 'do not use over an untrusted network without TLS, '}and expire after 12 hours of inactivity.</p>
</div>
<script>
(function () {
  // Session handoff from the ShellUI's /openui: the token rides in the URL
  // fragment, which the browser never sends to the server. Exchange it for the
  // cookie here, then drop it from the address bar before anything else runs.
  var handoff = (/(?:^|[#&])t=([^&]+)/.exec(window.location.hash || '') || [])[1];
  if (handoff) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: decodeURIComponent(handoff) })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (response.ok && payload.ok) window.location.assign('/');
      });
    }).catch(function () {
      // Fall through to the manual code form below.
    });
  }
  var form = document.getElementById('login-form');
  var input = document.getElementById('code');
  var submit = document.getElementById('submit');
  var error = document.getElementById('error');
  input.addEventListener('input', function () {
    input.value = input.value.replace(/\\D/g, '').slice(0, 6);
  });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var code = input.value.replace(/\\D/g, '');
    if (code.length !== 6) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      var response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      });
      var payload = await response.json().catch(function () { return {}; });
      if (response.ok && payload.ok) {
        window.location.assign('/');
      } else {
        error.textContent = payload.error || 'Verification failed.';
        error.hidden = false;
        input.value = '';
        input.focus();
      }
    } catch (err) {
      error.textContent = 'The login service is not answering.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}

function setSessionCookie(res: ServerResponse, token: string, expiresAt: number, deps: TotpGateDeps, req: IncomingMessage): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  const secure = deps.requestIsTls(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

function clearSessionCookie(res: ServerResponse, deps: TotpGateDeps, req: IncomingMessage): void {
  const secure = deps.requestIsTls(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

/*
 The one entry point serve.ts calls before dispatching anything else.
 Returns true when the request has been fully handled here.
 */
export async function totpLoginGuard(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: TotpGateDeps,
): Promise<boolean> {
  const base = deps.runtimeBaseUrl();
  if (!base) return false;

  if (urlPath === '/login' && req.method === 'GET') {
    const status = await statusWithCache(base);
    const token = sessionCookie(req);
    if (status.reachable && status.enabled && token && (await verifyToken(base, token)).ok) {
      redirect(res, '/');
      return true;
    }
    htmlResponse(res, 200, loginPageHtml({ tls: deps.requestIsTls(req) }));
    return true;
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    let body: { code?: unknown } = {};
    try {
      body = JSON.parse(await readBody(req)) as { code?: unknown };
    } catch {
      body = {};
    }
    const status = await statusWithCache(base);
    if (status.reachable && status.enabled === false) {
      deps.sendJson(res, 400, { ok: false, error: 'TOTP login is disabled on this manager.' });
      return true;
    }

    // Session handoff from the ShellUI's `/openui`: the caller already holds a
    // valid session token for this host (the ShellUI logged in on it), so
    // presenting it is equivalent to entering the code. It must NOT mint a new
    // session — we set the cookie with the SAME token. `/openui` puts the
    // token in the URL fragment, never the request line, so it stays out of
    // server logs and proxies.
    const handoff = typeof (body as { token?: unknown })?.token === 'string'
      ? String((body as { token?: unknown }).token).trim()
      : '';
    if (handoff) {
      const check = await verifyToken(base, handoff);
      if (check.ok) {
        const expiresAt = check.expiresAt ?? Date.now() + 12 * 60 * 60 * 1000;
        verifyMemo.set(handoff, { ok: true, at: Date.now(), expiresAt });
        setSessionCookie(res, handoff, expiresAt, deps, req);
        deps.sendJson(res, 200, { ok: true, expiresAt });
        return true;
      }
      deps.sendJson(res, 401, { ok: false, error: 'Session handoff rejected.' });
      return true;
    }

    try {
      const upstream = await fetch(`${base.replace(/\/+$/, '')}/login/verify`, {
        method: 'POST',
        headers: { ...deps.runtimeAuthHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ code: String(body?.code ?? '') }),
        signal: AbortSignal.timeout(5000),
      });
      const payload = (await upstream.json().catch(() => ({}))) as { ok?: boolean; token?: string; expiresAt?: number; error?: string };
      if (upstream.ok && payload.ok === true && payload.token) {
        verifyMemo.set(payload.token, { ok: true, at: Date.now() });
        setSessionCookie(res, payload.token, Number(payload.expiresAt ?? Date.now() + 60_000), deps, req);
        deps.sendJson(res, 200, { ok: true, expiresAt: payload.expiresAt ?? null });
        return true;
      }
      deps.sendJson(res, 401, { ok: false, error: payload.error ?? 'Verification failed.' });
    } catch {
      deps.sendJson(res, 503, { ok: false, error: 'Session service unavailable.' });
    }
    return true;
  }

  if (urlPath === '/api/logout' && req.method === 'POST') {
    const token = sessionCookie(req);
    if (token) {
      try {
        await fetch(`${base.replace(/\/+$/, '')}/logout`, {
          method: 'POST',
          headers: { ...deps.runtimeAuthHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // Revocation is best-effort: the cookie still goes away here.
      }
      verifyMemo.delete(token);
    }
    clearSessionCookie(res, deps, req);
    deps.sendJson(res, 200, { ok: true });
    return true;
  }

  const status = await statusWithCache(base);
  if (status.reachable && status.enabled === false) return false;
  if (!status.reachable && !hasWarmMemo()) {
    const message = 'The session service is not answering — start the manager runtime and reload.';
    if (deps.wantsHtml(req)) {
      htmlResponse(res, 503, loginPageHtml({ error: message, tls: deps.requestIsTls(req) }));
    } else {
      deps.sendJson(res, 503, { ok: false, error: message });
    }
    return true;
  }

  const token = sessionCookie(req);
  if (token) {
    const check = await verifyToken(base, token);
    if (check.ok) return false;
    if (check.authBlocked) {
      const message = 'The session check is blocked (the runtime answered 401/403). Check the runtime URL and its authentication setup.';
      if (deps.wantsHtml(req)) {
        htmlResponse(res, 503, loginPageHtml({ error: message, tls: deps.requestIsTls(req) }));
      } else {
        deps.sendJson(res, 503, { ok: false, error: message });
      }
      return true;
    }
  }

  if (deps.wantsHtml(req)) {
    redirect(res, '/login');
  } else {
    deps.sendJson(res, 401, { ok: false, error: 'Session required.' });
  }
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}
