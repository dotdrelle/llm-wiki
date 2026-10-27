import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkspaceService } from '../src/services/workspaceService.ts';
import { WIKI_LAYOUT_SCRIPT } from '../src/serve/html/wikiLayoutScript.ts';

vi.mock('../src/services/historyService.ts', () => ({
  HistoryService: class { rootDir = ''; },
  commitHistorySafely: vi.fn(async () => ({ sha: null })),
}));

const { discardAgentProposal, handleAgentProposalRoutes, mergeAgentProposal } = await import('../src/serve/routes/agentProposalRoutes.ts');

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

function fakeReq(method: string, urlPath: string, accept?: string): IncomingMessage {
  return {
    method,
    url: urlPath,
    headers: accept ? { accept } : {},
  } as unknown as IncomingMessage;
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
    workspace: {
      applyWikiOperations: vi.fn(async () => undefined),
      listWikiPages: vi.fn(async () => []),
    } as unknown as WorkspaceService,
    historyConfig: null,
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

  it('automatically merges an authorized maintenance proposal idempotently and records the automatic approver', async () => {
    writeProposal(rootDir, {
      id: 'maintenance:auto-1',
      runId: 'maintenance-cycle',
      workspace: 'demo',
      branch: 'agent/gateway-auto',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-auto',
      createdAt: '2026-10-15T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
      changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '# A\ncorrected\n' }],
      diff: 'diff',
    });
    const deps = makeDeps(rootDir);
    const mergeDeps = { rootDir, workspace: deps.workspace, historyConfig: null };

    const first = await mergeAgentProposal(mergeDeps, 'maintenance:auto-1', { verifiedBy: 'maintenance:auto' });
    const second = await mergeAgentProposal(mergeDeps, 'maintenance:auto-1', { verifiedBy: 'maintenance:auto' });

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.verifiedBy).toBe('maintenance:auto');
    expect(second.body.alreadyMerged).toBe(true);
    expect((deps.workspace.applyWikiOperations as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const applied = (deps.workspace.applyWikiOperations as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(applied[0].content).toContain("by: 'maintenance:auto'");
    expect(existsSync(path.join(rootDir, '.wiki', 'agent-proposals', 'maintenance_auto-1.json'))).toBe(false);
  });

  it('cleans up a worktree the gateway registered under its own mount path, branch included', async () => {
    // The gateway container mounts the workspace at /workspaces/<name>; serve
    // and mcp-http do not, so git sees that worktree as foreign and refuses
    // `worktree remove`. The merge must still leave no directory nor branch.
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: rootDir, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(path.join(rootDir, 'README.md'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const worktree = path.join(rootDir, '.wiki', 'agent-worktrees', 'gateway-foreign');
    git('worktree', 'add', '-q', '-b', 'agent/gateway-foreign', worktree);
    writeFileSync(path.join(rootDir, '.git', 'worktrees', 'gateway-foreign', 'gitdir'), '/workspaces/demo/.wiki/agent-worktrees/gateway-foreign/.git\n');
    writeFileSync(path.join(worktree, '.git'), 'gitdir: /workspaces/demo/.git/worktrees/gateway-foreign\n');
    writeProposal(rootDir, {
      id: 'maintenance:foreign',
      runId: 'maintenance-cycle',
      workspace: 'demo',
      branch: 'agent/gateway-foreign',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-foreign',
      createdAt: '2026-10-27T10:00:00.000Z',
      changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
      changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '# A\ncorrected\n' }],
      diff: 'diff',
    });
    const deps = makeDeps(rootDir);

    const merged = await mergeAgentProposal({ rootDir, workspace: deps.workspace, historyConfig: null }, 'maintenance:foreign', { verifiedBy: 'maintenance:auto' });

    expect(merged.status).toBe(200);
    expect(existsSync(worktree)).toBe(false);
    expect(String(git('branch', '--list', 'agent/*'))).toBe('');
  });

  it('discards a proposal, its worktree and its branch without touching the wiki', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: rootDir, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(path.join(rootDir, 'README.md'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const worktree = path.join(rootDir, '.wiki', 'agent-worktrees', 'gateway-refused');
    git('worktree', 'add', '-q', '-b', 'agent/gateway-refused', worktree);
    writeProposal(rootDir, {
      id: 'maintenance:refused',
      branch: 'agent/gateway-refused',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-refused',
      changes: [{ path: 'wiki/sources/a.md', status: 'M', content: '# A\n' }],
    });
    const deps = makeDeps(rootDir);

    expect(await discardAgentProposal(rootDir, 'maintenance:refused')).toBe(true);
    expect(await discardAgentProposal(rootDir, 'maintenance:refused')).toBe(false);

    expect(existsSync(path.join(rootDir, '.wiki', 'agent-proposals', 'maintenance_refused.json'))).toBe(false);
    expect(existsSync(worktree)).toBe(false);
    expect(String(git('branch', '--list', 'agent/*'))).toBe('');
    expect((deps.workspace.applyWikiOperations as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('offers Donna an explanation of a proposal, its records inert in the page', async () => {
    writeProposal(rootDir, {
      id: 't-explain',
      workspace: 'demo',
      branch: 'agent/gateway-explain',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-explain',
      createdAt: '2026-10-27T10:00:00.000Z',
      justification: 'Fixed two fiches </script><img src=x onerror=alert(1)>',
      objections: [{ severity: 'blocking', statement: 'claim lacks a source' }],
      changedFiles: [{ status: 'M', path: 'wiki/sources/doc/a.md' }],
      changes: [{ path: 'wiki/sources/doc/a.md', status: 'M', content: '# A\n' }],
      diff: 'x',
    });
    const deps = makeDeps(rootDir);
    const { res } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('GET', '/agent-proposals/t-explain'), res, '/agent-proposals/t-explain', deps);

    const html = String((deps.sendGzippedHtml as ReturnType<typeof vi.fn>).mock.calls[0][2]);
    expect(html).toContain('data-explain-row hidden');
    const data = /<script type="application\/json" data-explain-records>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(data).not.toContain('<');
    const payload = JSON.parse(data);
    expect(payload.records).toEqual(expect.arrayContaining([
      expect.stringMatching(/^File Updated: .*wiki\/sources\/doc\/a\.md/),
      'Objection (blocking): claim lacks a source',
      expect.stringContaining('</script><img'),
    ]));
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
      workspace: 'atlas',
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
    // A production job writing the wiki refuses the merge, and says which.
    const locks = path.join(rootDir, '.wiki', 'production-jobs', 'locks', 'demo');
    const jobs = path.join(rootDir, '.wiki', 'production-jobs', 'jobs');
    mkdirSync(locks, { recursive: true });
    mkdirSync(jobs, { recursive: true });
    writeFileSync(path.join(locks, 'job-1.lock'), JSON.stringify({ workspace: 'demo', jobId: 'job-1', scopes: ['workspace-write'] }));
    writeFileSync(path.join(jobs, 'job-1.json'), JSON.stringify({ jobId: 'job-1', status: 'running', type: 'ingest', steps: ['ingest'] }));
    const { res, status, body } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t4/merge'), res, '/api/agent-proposals/t4/merge', deps);
    expect(status()).toBe(409);
    expect(JSON.stringify(body())).toContain('job-1');
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

  it('refuses a merge with an unresolved citation, keeping the proposal', async () => {
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
  });

  it('renders structured HTML diagnostics when a page-form merge is refused', async () => {
      writeProposal(rootDir, {
        id: 't-prov-html',
        workspace: 'demo',
        branch: 'agent/gateway-html',
        worktreeRelativePath: '.wiki/agent-worktrees/gateway-html',
        createdAt: '2026-09-09T10:00:00.000Z',
        changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
        changes: [{
          path: 'wiki/concepts/demo/a.md',
          status: 'M',
          content: '# A\n\n[src: raw/ingested/missing.md#section:Missing > Heading]\n',
        }],
        diff: 'x',
      });
      const deps = makeDeps(rootDir);
      const { res } = fakeRes();

      await handleAgentProposalRoutes(
        fakeReq('POST', '/agent-proposals/t-prov-html/merge', 'text/html'),
        res,
        '/agent-proposals/t-prov-html/merge',
        deps,
      );

      expect(deps.sendGzippedHtml).toHaveBeenCalledTimes(1);
      const call = (deps.sendGzippedHtml as ReturnType<typeof vi.fn>).mock.calls[0];
      const html = String(call[2]);
      expect(call[4]).toBe(422);
      expect(html).toContain('Provenance diagnostics');
      expect(html).toContain('Unresolved locator tokens');
      expect(html).toContain('section:Missing &gt; Heading');
      expect(html).not.toContain('&quot;ok&quot;');
      expect(deps.workspace.applyWikiOperations).not.toHaveBeenCalled();
  });

  it('recomputes sources: on merge, dropping a declared source the body never reaches', async () => {
      // The cited archive must exist for the anchor to resolve — the merge now
      // validates anchors, not just the closure.
      mkdirSync(path.join(rootDir, 'raw', 'ingested'), { recursive: true });
      writeFileSync(path.join(rootDir, 'raw', 'ingested', 'x.md'), '# X\n\n## Coûts\n\nA.\n');
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
  });

  it('materializes a catalogue token on merge instead of writing it raw', async () => {
      mkdirSync(path.join(rootDir, 'raw', 'ingested'), { recursive: true });
      writeFileSync(path.join(rootDir, 'raw', 'ingested', 'x.md'), '# X\n\n## Coûts\n\nA.\n');
      writeProposal(rootDir, {
        id: 't-token',
        workspace: 'demo',
        branch: 'agent/gateway-12',
        worktreeRelativePath: '.wiki/agent-worktrees/gateway-12',
        createdAt: '2026-09-09T10:00:00.000Z',
        changedFiles: [{ status: 'M', path: 'wiki/concepts/demo/a.md' }],
        changes: [{ path: 'wiki/concepts/demo/a.md', status: 'M', content: '---\ntype: product\nsources: []\n---\n\n# A\n\n[src: raw/ingested/x.md#section:X > Coûts]\n' }],
        diff: 'x',
      });
      const deps = makeDeps(rootDir);
      const { res, body } = fakeRes();

      await handleAgentProposalRoutes(fakeReq('POST', '/api/agent-proposals/t-token/merge'), res, '/api/agent-proposals/t-token/merge', deps);

      expect(body().ok).toBe(true);
      const applied = (deps.workspace.applyWikiOperations as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(applied[0].content).toContain('[src: raw/ingested/x.md#X > Coûts]');
      expect(applied[0].content).not.toContain('section:');
  });

  it('shows the provenance prevalidation on the review page', async () => {
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
      expect(html).toContain('missing');
  });

  it('renders proposal justification Markdown and serialized line breaks safely', async () => {
    writeProposal(rootDir, {
      id: 't-markdown',
      workspace: 'demo',
      branch: 'agent/gateway-markdown',
      worktreeRelativePath: '.wiki/agent-worktrees/gateway-markdown',
      createdAt: '2026-10-02T10:00:00.000Z',
      justification: [
        '## Proposed changes',
        '',
        '| File | Detail |',
        '| --- | --- |',
        '| `wiki/concepts/a.md` | first\\n- second<br>third |',
        '',
        '<script>alert(1)</script>',
      ].join('\n'),
      changedFiles: [{ status: 'M', path: 'wiki/concepts/a.md' }],
      changes: [{ path: 'wiki/concepts/a.md', status: 'M', content: '# A\n' }],
      diff: 'diff --git a/wiki/concepts/a.md b/wiki/concepts/a.md\n--- a/wiki/concepts/a.md\n+++ b/wiki/concepts/a.md\n@@ -1 +1 @@\n-old\n+new <img src=x onerror=alert(1)>',
    });
    const deps = makeDeps(rootDir);
    const { res } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('GET', '/agent-proposals/t-markdown'), res, '/agent-proposals/t-markdown', deps);

    const html = String((deps.sendGzippedHtml as ReturnType<typeof vi.fn>).mock.calls[0][2]);
    expect(html).toContain('<h1>Wiki curation proposal</h1>');
    expect(html).toContain('1 wiki page · A · 1 updated');
    expect(html).toContain('<summary>Technical details</summary>');
    expect(html).not.toContain('<h1>Proposal t-markdown</h1>');
    expect(html).toContain('<h2>Proposed changes</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('first<br>');
    expect(html).toContain('second<br>third');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('proposal-diff-file');
    expect(html).toContain('proposal-diff-remove');
    expect(html).toContain('proposal-diff-add');
    expect(html).toContain('new &lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('explains what the page is for and offers a curation launch the shell routes', async () => {
    const deps = makeDeps(rootDir);
    const { res } = fakeRes();

    await handleAgentProposalRoutes(fakeReq('GET', '/agent-proposals'), res, '/agent-proposals', deps);

    const html = String((deps.sendGzippedHtml as ReturnType<typeof vi.fn>).mock.calls[0][2]);
    // What a proposal is, what curation looks for, and what each decision does.
    expect(html).toContain('separate git branch');
    expect(html).toContain('duplicates');
    expect(html).toContain('Merge into the wiki');
    expect(html).toContain('Reject');
    expect(html).toContain('Human mode waits for review here; automatic maintenance merges only after the engine validates provenance.');
    // The launch button ships hidden and is revealed by the wiki layout inside
    // the chat shell; the page itself never calls the runtime.
    expect(html).toContain('data-curate-row hidden');
    expect(html).toContain('data-curate-launch');
    expect(WIKI_LAYOUT_SCRIPT).toContain("document.querySelector('[data-curate-launch]')");
    expect(WIKI_LAYOUT_SCRIPT).toContain("type: 'llmwiki:curate'");
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
