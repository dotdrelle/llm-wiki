import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRuntimeRoutes } from '../src/serve/routes/runtimeRoutes.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime routes', () => {
  it('proxies run approval to the workspace-scoped runtime endpoint', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ approved: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const req = Readable.from([JSON.stringify({ scope: 'run', runId: 'run-1' })]);
    Object.assign(req, { method: 'POST' });
    const response = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
      writeHead(status: number, headers: Record<string, string>) {
        this.status = status;
        this.headers = headers;
      },
      end(body = '') {
        this.body = body;
      },
    };

    const handled = await handleRuntimeRoutes(
      req as never,
      response as never,
      '/api/runtime/approve',
      {
        runtimePathForWorkspace: (pathname) => `${pathname}?workspace=docs`,
        workspaceNameFromEnv: () => 'docs',
        proxyDeps: {
          runtimeUrl: () => 'http://runtime.test',
          runtimeToken: () => 'secret',
          readRequestBuffer: async (stream) => {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            return Buffer.concat(chunks);
          },
          sendJson(res, status, data) {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          },
        },
      },
    );

    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime.test/approve?workspace=docs',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ scope: 'run', runId: 'run-1' });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ approved: true });
  });
});
