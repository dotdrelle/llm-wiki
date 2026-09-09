import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkspaceService } from '../src/services/workspaceService.ts';

vi.mock('../src/services/historyService.ts', () => ({
  HistoryService: class { rootDir = ''; },
  commitHistorySafely: vi.fn(async () => ({ sha: null })),
}));

const { handleAgentProposalRoutes } = await import('../src/serve/routes/agentProposalRoutes.ts');

function fakeRes() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
  return {
    res: res as unknown as ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> },
    body() {
      return JSON.parse(String((res.end.mock.calls.at(-1)?.[0]) ?? '{}'));
    },
    status() {
      return Number(res.writeHead.mock.calls.at(-1)?.[0] ?? 0);
    },
  };
}

function fakeReq(method: string, urlPath: string): IncomingMessage {
  return { method, url: urlPath } as unknown as IncomingMessage;
}

function writeProposal(rootDir: string, record: Record<string, unknown>): void {
  const dir = path.join(rootDir, '.wiki', 'agent-proposals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${String(record.id)}.json`), JSON.stringify(record, null, 2));
}

function makeDeps(rootDir: string) {
  const deps = {
    rootDir,
    workspace: { applyWikiOperations: vi.fn(async () => undefined) } as unknown as WorkspaceService,
    historyConfig: null,
    isRunActive: vi.fn(async () => false),
    sendJson: (res: unknown, status: number, data: unknown) => {
      (res as { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void })
        .writeHead(status, { 'content-type': 'application/json' });
      (res as { end: (c?: string) => void }).end(JSON.stringify(data));
    },
    sendGzippedHtml: vi.fn(async () => undefined),
  };
  return deps;
}

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), 'agent-proposals-test-'));
});

describe('agent proposal review routes', () => {
  it('merges a proposal: applies wiki changes, commits, and removes the proposal', async () => {
    writeProposal(rootDir, {
      id: 't1',
      runId: 'r1',
      workspace: 'demo',
      branch: 'agent/gateway-1',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-1',
      createdAt: '2026-09-09T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
      changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '# A\nupdated\n' }],
      diff: '--- a/wiki/concepts/demo/a.md\n+++ b/wiki/concepts/demo/a.md\n@@ -1 +1 @@\n-# A\n+# A updated\n',
    });
    const deps = makeDeps(rootDir);
    const { res, body, status } = fakeRes();

    const handled = await handleAgentProposalRoutes(
      fakeReq('POST', '/api/agent-proposals/t1/merge'),
      res,
      '/api/agent-proposals/t1/merge',
      deps,
    );

    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body().ok).toBe(true);
    // The merge is the approval: OKF v0.2 records it on the merged page.
    const applied = (deps.workspace.applyWikiOperations as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(applied[0].type).toBe('update');
    expect(applied[0].path).toBe('wiki/concepts/demo/a.md');
    expect(applied[0].content).toContain('# A\nupdated\n');
    expect(applied[0].content).toContain('status: stable');
    expect(applied[0].content).toContain("by: 'human:merge'");
    expect(applied[0].content).toMatch(/at: '\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(path.join(rootDir, '.wiki', 'agent-proposals', 't1.json'))).toBe(false);
  });

  it('rejects a proposal without touching the wiki', async () => {
    writeProposal(rootDir, {
      id: 't2',
      workspace: 'demo',
      branch: 'agent/gateway-2',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-2',
      createdAt: '2026-09-09T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
      changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '# A' }],
      diff: 'x',
    });
    const deps = makeDeps(rootDir);
    const { res, body } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t2/reject'), res, '/api/agent-proposals/t2/reject', deps);

    expect(body().ok).toBe(true);
    expect(deps.workspace.applyWikiOperations).not.toHaveBeenCalled();
    expect(existsSync(path.join(rootDir, '.wiki', 'agent-proposals', 't2.json'))).toBe(false);
  });

  it('refuses to merge a proposal whose changes escape wiki/', async () => {
    writeProposal(rootDir, {
      id: 't3',
      workspace: 'demo',
      branch: 'agent/gateway-3',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-3',
      createdAt: '2026-09-09T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'templates/evil.md' }],
      changes: [{ path: 'templates/evil.md', status: 'M', content: 'evil' }],
      diff: 'x',
    });
    const deps = makeDeps(rootDir);
    const { res, body, status } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t3/merge'), res, '/api/agent-proposals/t3/merge', deps);

    expect(status()).toBe(400);
    expect(body().ok).toBe(false);
    expect(deps.workspace.applyWikiOperations).not.toHaveBeenCalled();
  });

  it('refuses merge and reject while a run is active', async () => {
    writeProposal(rootDir, {
      id: 't4',
      workspace: 'demo',
      branch: 'agent/gateway-4',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-4',
      createdAt: '2026-09-09T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'wiki/x.md' }],
      changes: [{ path: 'wiki/x.md', status: 'M', content: 'x' }],
      diff: 'x',
    });
    const deps = makeDeps(rootDir);
    deps.isRunActive = vi.fn(async () => true);
    const { res, status } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t4/merge'), res, '/api/agent-proposals/t4/merge', deps);
    expect(status()).toBe(409);
  });

  it('lists proposals through the API without their diffs', async () => {
    writeProposal(rootDir, {
      id: 't5',
      workspace: 'demo',
      branch: 'agent/gateway-5',
      createdAt: '2026-09-09T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'wiki/x.md' }],
      changes: [{ path: 'wiki/x.md', status: 'M', content: 'x' }],
      diff: 'secret diff',
    });
    const deps = makeDeps(rootDir);
    const { res, body } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('GET', '/api/agent-proposals'), res, '/api/agent-proposals', deps);

    expect(body().proposals).toHaveLength(1);
    expect(body().proposals[0].id).toBe('t5');
    expect(body().proposals[0].diff).toBeUndefined();
  });
});
