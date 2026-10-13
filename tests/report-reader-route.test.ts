import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { handleWikiRoutes } from '../src/serve/routes/wikiRoutes.ts';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-report-route-'));
  roots.push(root);
  await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
  await mkdir(path.join(root, '.wiki'), { recursive: true });
  await writeFile(path.join(root, '.wiki', 'system-prompt.md'), 'private instructions');
  await writeFile(path.join(root, 'raw', 'untracked', 'report.md.lock'), '# Report');
  return root;
}

async function getReport(rootDir: string, target: string) {
  const req = Object.assign(Readable.from([]), {
    method: 'GET',
    url: `/api/report?path=${encodeURIComponent(target)}`,
  }) as unknown as IncomingMessage;
  const res = {
    status: 0,
    body: '',
    writeHead(status: number) { this.status = status; },
    end(body = '') { this.body = body; },
  };
  await handleWikiRoutes(req, res as unknown as ServerResponse, '/api/report', {
    rootDir,
    sendJson(response: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body?: string) => void }, status: number, data: unknown) {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    },
  } as never);
  return { status: res.status, body: JSON.parse(res.body || '{}') };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('GET /api/report confinement', () => {
  it('serves a report from raw/untracked', async () => {
    const root = await fixture();
    const result = await getReport(root, 'raw/untracked/report.md.lock');
    expect(result.status).toBe(200);
    expect(result.body.markdown).toContain('# Report');
  });

  it('rejects traversal into another workspace Markdown file', async () => {
    const root = await fixture();
    const result = await getReport(root, 'raw/untracked/../../.wiki/system-prompt.md');
    expect(result.status).toBe(400);
    expect(result.body.markdown).toBeUndefined();
  });

  it('rejects a report symlink whose target leaves raw/untracked', async () => {
    const root = await fixture();
    await symlink(path.join(root, '.wiki', 'system-prompt.md'), path.join(root, 'raw', 'untracked', 'linked.md'));
    const result = await getReport(root, 'raw/untracked/linked.md');
    expect(result.status).toBe(400);
    expect(result.body.markdown).toBeUndefined();
  });
});
