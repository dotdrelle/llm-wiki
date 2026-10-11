import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { handleChatRoutes } from '../src/serve/routes/chatRoutes.ts';

function recorder() {
  return {
    status: 0,
    body: '',
    writeHead(status: number) { this.status = status; },
    end(body = '') { this.body = body; },
    json() { return JSON.parse(this.body || '{}'); },
  };
}

function request(method: string, body?: unknown) {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method,
    headers: {},
  }) as unknown as IncomingMessage;
}

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

function deps(internalDir: string) {
  return {
    workspace: { paths: { internalDir } },
    sendJson: (res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void }, status: number, data: unknown) => {
      res.writeHead(status, {});
      res.end(JSON.stringify(data));
    },
  } as never;
}

describe('/api/system-prompt', () => {
  it('reads and writes the workspace .wiki/system-prompt.md the runtime injects', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sys-prompt-'));
    const internalDir = path.join(dir, '.wiki');

    const empty = recorder();
    await handleChatRoutes(request('GET'), empty as unknown as ServerResponse, '/api/system-prompt', deps(internalDir));
    expect(empty.json()).toEqual({ ok: true, content: '' });

    const saved = recorder();
    await handleChatRoutes(request('PUT', { content: '  Answer tersely.  ' }), saved as unknown as ServerResponse, '/api/system-prompt', deps(internalDir));
    expect(saved.status).toBe(200);
    expect(saved.json().content).toBe('Answer tersely.');
    expect(await readFile(path.join(internalDir, 'system-prompt.md'), 'utf8')).toBe('Answer tersely.\n');

    const refused = recorder();
    await handleChatRoutes(request('PUT', { content: 'x'.repeat(20001) }), refused as unknown as ServerResponse, '/api/system-prompt', deps(internalDir));
    expect(refused.status).toBe(413);
    expect(await readFile(path.join(internalDir, 'system-prompt.md'), 'utf8')).toBe('Answer tersely.\n');
  });
});
