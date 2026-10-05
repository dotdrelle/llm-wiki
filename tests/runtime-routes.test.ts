import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRuntimeRoutes } from '../src/serve/routes/runtimeRoutes.ts';
import { submitHistoryRestoreToRuntime } from '../src/serve/proxy/runtimeProxy.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime routes', () => {
  it('submits queued restores as an unchanged structured capability plan', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ queued: true }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const response = {
      status: 0,
      body: '',
      writeHead(status: number) { this.status = status; },
      end(body = '') { this.body = body; },
    };

    await submitHistoryRestoreToRuntime(
      response as never,
      {
        runtimeUrl: () => 'http://runtime.test',
        runtimeToken: () => 'secret',
        readRequestBuffer: async () => Buffer.alloc(0),
        sendJson: () => undefined,
      },
      { run: 'abc123', intent: 'enqueue' },
      'docs',
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      input: 'Execute the supplied workspace.restore capability plan for run abc123. Do not infer or alter its arguments.',
      workspace: 'docs',
      intent: 'enqueue',
      capabilityPlan: {
        capability: 'workspace.restore',
        operation: 'restore',
        arguments: { run: 'abc123' },
        requireApproval: true,
      },
    });
    expect(response.status).toBe(202);
  });

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

  it('proxies a redo truncation to the workspace-scoped runtime endpoint', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ truncated: true, index: 4, removedEvents: 7 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const req = Readable.from([JSON.stringify({ index: 4 })]);
    Object.assign(req, { method: 'POST' });
    const response = {
      status: 0,
      body: '',
      writeHead(status: number) { this.status = status; },
      end(body = '') { this.body = body; },
    };

    const handled = await handleRuntimeRoutes(
      req as never,
      response as never,
      '/api/runtime/conversation/truncate',
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
    // Workspace-scoped like /cancel and /approve: a redo must never truncate
    // another workspace's conversation.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime.test/conversation/truncate?workspace=docs',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ index: 4 });
    expect(JSON.parse(response.body)).toEqual({ truncated: true, index: 4, removedEvents: 7 });
  });

  it('forwards the body of a memory DELETE, so the removal keeps its conversation', async () => {
    const { fetchMock, call } = memoryHarness();
    await call('DELETE', '/api/runtime/memory/facts/k1', JSON.stringify({ conversationId: 'conv-abc123' }));

    expect(fetchMock).toHaveBeenCalledWith('http://runtime.test/memory/facts/k1?workspace=docs', expect.objectContaining({ method: 'DELETE' }));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ conversationId: 'conv-abc123' });
  });

  it('joins a memory search query to the workspace query with "&", never a second "?"', async () => {
    const { fetchMock, call } = memoryHarness();
    await call('GET', '/api/runtime/memory/facts', '', '?q=budget&limit=3');
    await call('GET', '/api/runtime/memory/facts', '');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://runtime.test/memory/facts?workspace=docs&q=budget&limit=3');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://runtime.test/memory/facts?workspace=docs');
  });
});

function memoryHarness() {
  const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(
    JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);
  const call = async (method: string, path: string, body: string, search = '') => {
    const req = Readable.from(body ? [body] : []);
    Object.assign(req, { method, url: `${path}${search}` });
    const response = { status: 0, body: '', writeHead(status: number) { this.status = status; }, end(text = '') { this.body = text; } };
    return handleRuntimeRoutes(req as never, response as never, path, {
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
        sendJson(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); },
      },
    });
  };
  return { fetchMock, call };
}

it('keeps the workspace scope when proxying older maintenance history', async () => {
  const fetchMock=vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async()=>new Response(JSON.stringify({requests:[],history:{offset:100}}),{headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetchMock);
  const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/api/runtime/maintenance?historyOffset=100'});
  const res={writeHead(){},end(){}};
  const handled=await handleRuntimeRoutes(req as never,res as never,'/api/runtime/maintenance',{
    runtimePathForWorkspace:(pathname)=>pathname+'?workspace=docs',workspaceNameFromEnv:()=> 'docs',
    proxyDeps:{runtimeUrl:()=> 'http://runtime.test',runtimeToken:()=>null,readRequestBuffer:async()=>Buffer.alloc(0),sendJson:()=>undefined},
  });
  expect(handled).toBe(true);
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://runtime.test/maintenance?workspace=docs&historyOffset=100');
});
