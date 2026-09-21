import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
  // The manager persists under a sanitized file name (':' → '_'), so the test
  // writes the same shape a real taskId produces.
  const file = String(record.id).replace(/[^a-zA-Z0-9._-]/g, '_');
  writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(record, null, 2));
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

  it('opens and merges a real taskId proposal, whose id carries ":"', async () => {
    // A proposal id is `<runId>:<slug>`; the file is stored sanitized. Reading
    // the id as a SAFE_ID without ':' made every real proposal a 404 — the
    // review page opened on `{"ok":false,"error":"proposal not found"}` and no
    // merge or reject could ever find its record.
    const id = '21ad9866-6805-4b06-95a4-942f93ec5c64:run-80c13bad-1404-412e-9fd1-11c8aa3af8a4';
    writeProposal(rootDir, {
      id,
      runId: '21ad9866-6805-4b06-95a4-942f93ec5c64',
      workspace: 'acpi',
      branch: 'agent/gateway-1',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-1',
      createdAt: '2026-09-21T14:17:55.783Z',
      changedFiles: [{ status: 'M', path: 'wiki/concepts/produit/a.md' }],
      changes: [{ path: 'wiki/concepts/produit/a.md', status: 'M', content: '# A\n' }],
      diff: 'x',
    });
    const deps = makeDeps(rootDir);
    const detail = fakeRes();
    await handleAgentProposalRoutes(
      fakeReq('GET', `/agent-proposals/${encodeURIComponent(id)}`),
      detail.res,
      `/agent-proposals/${id}`,
      deps,
    );
    expect(deps.sendGzippedHtml).toHaveBeenCalledTimes(1);

    const merge = fakeRes();
    await handleAgentProposalRoutes(
      fakeReq('POST', `/api/agent-proposals/${encodeURIComponent(id)}/merge`),
      merge.res,
      `/api/agent-proposals/${id}/merge`,
      deps,
    );
    expect(merge.status()).toBe(200);
    expect(merge.body().ok).toBe(true);
    expect(deps.workspace.applyWikiOperations).toHaveBeenCalledTimes(1);
    const safeFile = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    expect(existsSync(path.join(rootDir, '.wiki', 'agent-proposals', `${safeFile}.json`))).toBe(false);
  });

  it('renders an HTML not-found page for a missing proposal, never raw JSON', async () => {
    const deps = makeDeps(rootDir);
    const { res } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('GET', '/agent-proposals/gone'), res, '/agent-proposals/gone', deps);

    expect(deps.sendGzippedHtml).toHaveBeenCalledTimes(1);
    const call = (deps.sendGzippedHtml as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[2])).toContain('Proposal not found');
    expect(call[4]).toBe(404);
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

  it('refuses a merge with an unresolved citation in provenance mode, keeping the proposal', async () => {
    process.env.WIKI_PROVENANCE_MODE = '1';
    try {
      writeProposal(rootDir, {
        id: 't-prov',
        workspace: 'demo',
        branch: 'agent/gateway-9',
        worktreeRelativePath: '.wiki/agent-worktrees/gateway-9',
        createdAt: '2026-09-09T10:00:00.000Z',
        changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
        changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '---\ntype: product\nsources: []\n---\n\n# A\n\n[src: wiki/sources/missing.md]\n' }],
        diff: 'x',
      });
      const deps = makeDeps(rootDir);
      const { res, body, status } = fakeRes();

      await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t-prov/merge'), res, '/api/agent-proposals/t-prov/merge', deps);

      expect(status()).toBe(422);
      expect(body().error).toBe('provenance_invalid');
      expect(deps.workspace.applyWikiOperations).not.toHaveBeenCalled();
      expect(existsSync(path.join(rootDir, '.wiki', 'agent-proposals', 't-prov.json'))).toBe(true);
    } finally {
      delete process.env.WIKI_PROVENANCE_MODE;
    }
  });

  it('recomputes sources: on merge, dropping a declared source the body never reaches', async () => {
    process.env.WIKI_PROVENANCE_MODE = '1';
    try {
      writeProposal(rootDir, {
        id: 't-derive',
        workspace: 'demo',
        branch: 'agent/gateway-10',
        worktreeRelativePath: '.wiki/agent-worktrees/gateway-10',
        createdAt: '2026-09-09T10:00:00.000Z',
        changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
        changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '---\ntype: product\nsources:\n  - path: raw/ingested/x.md\n  - path: raw/ingested/phantom.md\n---\n\n# A\n\n[src: raw/ingested/x.md#Coûts]\n' }],
        diff: 'x',
      });
      const deps = makeDeps(rootDir);
      const { res, body } = fakeRes();

      await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t-derive/merge'), res, '/api/agent-proposals/t-derive/merge', deps);

      expect(body().ok).toBe(true);
      const applied = (deps.workspace.applyWikiOperations as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(applied[0].content).toContain('raw/ingested/x.md');
      expect(applied[0].content).not.toContain('phantom.md');
    } finally {
      delete process.env.WIKI_PROVENANCE_MODE;
    }
  });

  it('shows the provenance prevalidation on the review page', async () => {
    process.env.WIKI_PROVENANCE_MODE = '1';
    try {
      writeProposal(rootDir, {
        id: 't-prev',
        workspace: 'demo',
        branch: 'agent/gateway-11',
        worktreeRelativePath: '.wiki/agent-worktrees/gateway-11',
        createdAt: '2026-09-09T10:00:00.000Z',
        changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
        changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '---\ntype: product\nsources: []\n---\n\n# A\n\n[src: raw/ingested/x.md]\n' }],
        diff: 'x',
      });
      const deps = makeDeps(rootDir);
      const { res } = fakeRes();

      await handleAgentProposalRoutes(fakeReq('GET', '/agent-proposals/t-prev'), res, '/agent-proposals/t-prev', deps);

      const html = String((deps.sendGzippedHtml as ReturnType<typeof vi.fn>).mock.calls[0][2]);
      expect(html).toContain('Provenance prevalidation');
      expect(html).toContain('unanchored');
    } finally {
      delete process.env.WIKI_PROVENANCE_MODE;
    }
  });

  it('is routed before handleWikiRoutes, whose fallback treats any unmatched path as a wiki document and 404s it', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../src/commands/serve.ts'),
      'utf8',
    );
    const proposalCallIndex = source.indexOf('handleAgentProposalRoutes(req, res, urlPath');
    const wikiCallIndex = source.indexOf('handleWikiRoutes(req, res, urlPath');
    expect(proposalCallIndex).toBeGreaterThan(-1);
    expect(wikiCallIndex).toBeGreaterThan(-1);
    expect(proposalCallIndex).toBeLessThan(wikiCallIndex);
  });
});
