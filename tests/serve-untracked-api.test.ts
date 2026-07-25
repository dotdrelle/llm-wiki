import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { handleUntrackedApi } from '../src/commands/serve.ts';

function responseRecorder() {
  return {
    status: 0,
    body: '',
    writeHead(status: number) {
      this.status = status;
    },
    end(body = '') {
      this.body = body;
    },
    json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

function deleteRequest() {
  return Object.assign(Readable.from([]), { method: 'DELETE', headers: {} }) as unknown as IncomingMessage;
}

function postRequest(payload: unknown) {
  return Object.assign(Readable.from([JSON.stringify(payload)]), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  }) as unknown as IncomingMessage;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-untracked-api-'));
  roots.push(root);
  return root;
}

describe('DELETE /api/untracked/*', () => {
  it('deletes the last pending file in a folder without reporting EISDIR', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'raw/untracked/connectors/google-1');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'message.md');
    await writeFile(file, '# Message\n', 'utf8');

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      deleteRequest(),
      res as unknown as ServerResponse,
      '/api/untracked/raw/untracked/connectors/google-1/message.md',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, kind: 'file' });
    // The now-empty parent folders are pruned, not left as dangling entries.
    await expect(stat(dir)).rejects.toThrow();
    await expect(stat(path.join(root, 'raw/untracked/connectors'))).rejects.toThrow();
    // raw/untracked itself is never pruned away.
    await expect(stat(path.join(root, 'raw/untracked'))).resolves.toBeDefined();
  });

  it('deletes a non-empty pending folder', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'raw/untracked/dirnctti');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'a.md'), '# A\n', 'utf8');
    await writeFile(path.join(dir, 'b.md'), '# B\n', 'utf8');

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      deleteRequest(),
      res as unknown as ServerResponse,
      '/api/untracked/raw/untracked/dirnctti',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, kind: 'folder' });
    await expect(stat(dir)).rejects.toThrow();
  });

  it('deletes an empty pending folder', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'raw/untracked/empty-folder');
    await mkdir(dir, { recursive: true });

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      deleteRequest(),
      res as unknown as ServerResponse,
      '/api/untracked/raw/untracked/empty-folder',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, kind: 'folder' });
    await expect(stat(dir)).rejects.toThrow();
  });
});

describe('POST /api/untracked/move', () => {
  it('moves a pending file into another folder', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'raw/untracked/source'), { recursive: true });
    await mkdir(path.join(root, 'raw/untracked/target'), { recursive: true });
    await writeFile(path.join(root, 'raw/untracked/source/doc.md'), '# Doc\n', 'utf8');

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      postRequest({ from: 'raw/untracked/source/doc.md', to: 'raw/untracked/target' }),
      res as unknown as ServerResponse,
      '/api/untracked/move',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, to: 'raw/untracked/target/doc.md', kind: 'file' });
    await expect(stat(path.join(root, 'raw/untracked/target/doc.md'))).resolves.toBeDefined();
    // The now-empty source folder is pruned.
    await expect(stat(path.join(root, 'raw/untracked/source'))).rejects.toThrow();
  });

  it('moves a pending folder to the panel root', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'raw/untracked/parent/child'), { recursive: true });
    await writeFile(path.join(root, 'raw/untracked/parent/child/doc.md'), '# Doc\n', 'utf8');

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      postRequest({ from: 'raw/untracked/parent/child', to: '' }),
      res as unknown as ServerResponse,
      '/api/untracked/move',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, to: 'raw/untracked/child', kind: 'folder' });
    await expect(readdir(path.join(root, 'raw/untracked/child'))).resolves.toContain('doc.md');
  });

  it('refuses to move a folder into itself or a descendant', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'raw/untracked/parent/child'), { recursive: true });

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      postRequest({ from: 'raw/untracked/parent', to: 'raw/untracked/parent/child' }),
      res as unknown as ServerResponse,
      '/api/untracked/move',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it('refuses to overwrite an existing destination', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'raw/untracked/a'), { recursive: true });
    await mkdir(path.join(root, 'raw/untracked/b'), { recursive: true });
    await writeFile(path.join(root, 'raw/untracked/a/doc.md'), '# A\n', 'utf8');
    await writeFile(path.join(root, 'raw/untracked/b/doc.md'), '# B (existing)\n', 'utf8');

    const res = responseRecorder();
    const handled = await handleUntrackedApi(
      root,
      postRequest({ from: 'raw/untracked/a/doc.md', to: 'raw/untracked/b' }),
      res as unknown as ServerResponse,
      '/api/untracked/move',
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(409);
    // The existing file at the destination was not clobbered.
    const kept = await readdir(path.join(root, 'raw/untracked/b'));
    expect(kept).toEqual(['doc.md']);
  });
});
