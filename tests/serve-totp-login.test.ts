import { describe, expect, it, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { totpLoginGuard, sessionCookie, loginPageHtml, resetTotpGateCaches } from '../src/serve/routes/loginRoutes.ts';

/*
 Serve-side TOTP gate contract. The manager runtime is mocked through
 globalThis.fetch; the guard itself must behave: no gate without a runtime
 URL, open when disabled, redirect/401 without a session, cookie flows for
 login/logout, and fail-closed when the runtime stops answering.
 */

function fakeRequest({ method = 'GET', path = '/', accept = 'text/html', cookie = null, body = '' }: { method?: string; path?: string; accept?: string; cookie?: string | null; body?: string } = {}): IncomingMessage {
  const headers: Record<string, string> = { accept };
  if (cookie) headers.cookie = cookie;
  const listeners: Record<string, Array<(chunk?: unknown) => void>> = {};
  const req = {
    method,
    url: path,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    on(event: string, fn: (chunk?: unknown) => void) {
      (listeners[event] ??= []).push(fn);
      return req;
    },
    destroy() {},
  };
  queueMicrotask(() => {
    if (body) for (const fn of listeners.data ?? []) fn(body);
    for (const fn of listeners.end ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeResponse(): { res: ServerResponse; done: () => { status: number; body: string; headers: Record<string, string> } } {
  let status = 0;
  let body = '';
  const headers: Record<string, string> = {};
  const res = {
    writeHead(code: number, h?: Record<string, string>) {
      status = code;
      if (h) Object.assign(headers, h);
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return { res, done: () => ({ status, body, headers }) };
}

type FetchHandler = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function mockFetch(handler: FetchHandler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function deps(base: string | null) {
  return {
    runtimeBaseUrl: () => base,
    runtimeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    sendJson: (res: ServerResponse, status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    },
    wantsHtml: (req: IncomingMessage) => String(req.headers.accept ?? '').includes('text/html'),
    requestIsTls: () => false,
  };
}

describe('serve TOTP gate', () => {
  beforeEach(() => resetTotpGateCaches());

  it('stays open when no runtime URL is configured', async () => {
    const { res } = fakeResponse();
    const handled = await totpLoginGuard(fakeRequest(), res, '/', deps(null));
    expect(handled).toBe(false);
  });

  it('stays open when the runtime reports TOTP disabled', async () => {
    const restore = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, enabled: false, enrolled: false, sessionActive: false }),
    }));
    try {
      const { res } = fakeResponse();
      const handled = await totpLoginGuard(fakeRequest(), res, '/', deps('http://127.0.0.1:7788'));
      expect(handled).toBe(false);
    } finally {
      restore();
    }
  });

  it('redirects a browser without a session to /login', async () => {
    const restore = mockFetch(async (url) => {
      if (url.includes('/login/status')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true, enrolled: true, sessionActive: false }) };
      }
      if (url.includes('/session/verify')) {
        return { ok: true, status: 200, json: async () => ({ ok: false, reason: 'invalid_token' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(fakeRequest(), res, '/', deps('http://127.0.0.1:7788'));
      expect(handled).toBe(true);
      expect(done().status).toBe(302);
      expect(done().headers.Location).toBe('/login');
    } finally {
      restore();
    }
  });

  it('answers 401 to an API request without a session', async () => {
    const restore = mockFetch(async (url) => {
      if (url.includes('/login/status')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true, enrolled: true, sessionActive: false }) };
      }
      if (url.includes('/session/verify')) {
        return { ok: true, status: 200, json: async () => ({ ok: false, reason: 'invalid_token' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(fakeRequest({ accept: 'application/json' }), res, '/api/runtime/state', deps('http://127.0.0.1:7788'));
      expect(handled).toBe(true);
      expect(done().status).toBe(401);
    } finally {
      restore();
    }
  });

  it('lets a request with a verified session cookie through', async () => {
    const restore = mockFetch(async (url) => {
      if (url.includes('/login/status')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true, enrolled: true, sessionActive: true }) };
      }
      if (url.includes('/session/verify?token=good-token')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, ident: 'human', expiresAt: Date.now() + 3_600_000 }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const { res } = fakeResponse();
      const handled = await totpLoginGuard(
        fakeRequest({ cookie: 'wiki_session=good-token' }),

        res,
        '/',
        deps('http://127.0.0.1:7788'),
      );
      expect(handled).toBe(false);
    } finally {
      restore();
    }
  });

  it('fails closed with a clear page when the runtime stops answering', async () => {
    const restore = mockFetch(async () => {
      throw new Error('fetch failed');
    });
    try {
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(fakeRequest(), res, '/', deps('http://127.0.0.1:7788'));
      expect(handled).toBe(true);
      expect(done().status).toBe(503);
      expect(done().body).toContain('session service is not answering');
    } finally {
      restore();
    }
  });

  it('treats a 401 from the session check as a broken door, not a login loop', async () => {
    // The verify endpoint is public: a 401 there is a misconfiguration, never
    // "wrong session". Redirecting to /login would send the user in circles.
    const restore = mockFetch(async (url) => {
      if (url.includes('/login/status')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true, enrolled: true, sessionActive: true }) };
      }
      if (url.includes('/session/verify')) {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(
        fakeRequest({ cookie: 'wiki_session=some-token' }),
        res,
        '/',
        deps('http://127.0.0.1:7788'),
      );
      expect(handled).toBe(true);
      expect(done().status).toBe(503);
      expect(done().body).toContain('session check is blocked');
      expect(done().body).not.toContain('Location');
    } finally {
      restore();
    }
  });

  it('serves the login page and its API verification flow', async () => {
    const restore = mockFetch(async (url, init) => {
      if (url.includes('/login/status')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, enabled: true, enrolled: true, sessionActive: false }) };
      }
      if (url.includes('/login/verify')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.code === '123456') {
          return { ok: true, status: 200, json: async () => ({ ok: true, token: 'fresh-token', expiresAt: Date.now() + 3_600_000 }) };
        }
        return { ok: false, status: 401, json: async () => ({ ok: false, error: 'Invalid verification code.' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const page = fakeResponse();
      const pageHandled = await totpLoginGuard(fakeRequest({ path: '/login' }), page.res, '/login', deps('http://127.0.0.1:7788'));
      expect(pageHandled).toBe(true);
      expect(page.done().status).toBe(200);
      expect(page.done().body).toContain('Two-step login');

      const ok = fakeResponse();
      const okHandled = await totpLoginGuard(
        fakeRequest({ method: 'POST', path: '/api/login', accept: 'application/json', body: JSON.stringify({ code: '123456' }) }) as IncomingMessage,
        ok.res,
        '/api/login',
        deps('http://127.0.0.1:7788'),
      );
      expect(okHandled).toBe(true);
      expect(ok.done().status).toBe(200);
      expect(ok.done().headers['Set-Cookie']).toContain('wiki_session=fresh-token');
      expect(ok.done().headers['Set-Cookie']).toContain('HttpOnly');
      expect(ok.done().headers['Set-Cookie']).toContain('SameSite=Lax');

      const bad = fakeResponse();
      const badHandled = await totpLoginGuard(
        fakeRequest({ method: 'POST', path: '/api/login', accept: 'application/json', body: JSON.stringify({ code: '000000' }) }) as IncomingMessage,
        bad.res,
        '/api/login',
        deps('http://127.0.0.1:7788'),
      );
      expect(badHandled).toBe(true);
      expect(bad.done().status).toBe(401);
    } finally {
      restore();
    }
  });

  it('accepts a ShellUI session handoff: a valid token becomes the cookie, without minting a new session', async () => {
    const restore = mockFetch(async (url) => {
      if (url.includes('/session/verify?token=shell-token')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, ident: 'human', expiresAt: Date.now() + 3_600_000 }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(
        fakeRequest({ method: 'POST', path: '/api/login', accept: 'application/json', body: JSON.stringify({ token: 'shell-token' }) }) as IncomingMessage,
        res,
        '/api/login',
        deps('http://127.0.0.1:7788'),
      );
      expect(handled).toBe(true);
      expect(done().status).toBe(200);
      // The SAME token is set as the cookie — no new session is issued, so the
      // browser never invalidates the ShellUI's own session.
      expect(done().headers['Set-Cookie']).toContain('wiki_session=shell-token');
    } finally {
      restore();
    }
  });

  it('refuses a handoff whose token the runtime does not recognize', async () => {
    const restore = mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }));
    try {
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(
        fakeRequest({ method: 'POST', path: '/api/login', accept: 'application/json', body: JSON.stringify({ token: 'stale-token' }) }) as IncomingMessage,
        res,
        '/api/login',
        deps('http://127.0.0.1:7788'),
      );
      expect(handled).toBe(true);
      expect(done().status).toBe(401);
      expect(done().headers['Set-Cookie']).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('reads the session cookie and clears it on logout', async () => {
    const restore = mockFetch(async (url) => {
      if (url.includes('/logout')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const request = fakeRequest({ method: 'POST', path: '/api/logout', accept: 'application/json', cookie: 'wiki_session=bye-token' });
      expect(sessionCookie(request)).toBe('bye-token');
      const { res, done } = fakeResponse();
      const handled = await totpLoginGuard(request, res, '/api/logout', deps('http://127.0.0.1:7788'));
      expect(handled).toBe(true);
      expect(done().status).toBe(200);
      expect(done().headers['Set-Cookie']).toContain('Max-Age=0');
    } finally {
      restore();
    }
  });

  it('renders the login page without trusting injected errors', () => {
    const html = loginPageHtml({ error: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
