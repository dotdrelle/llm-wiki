import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from '../../utils/path.ts';
import { HistoryService, commitHistorySafely } from '../../services/historyService.ts';
import { applyOkfFrontmatter } from '../../okf/frontmatter.ts';
import type { WorkspaceService } from '../../services/workspaceService.ts';
import { layout } from '../html/wikiHtml.ts';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The agent-curate review surface (lot 1): proposals written by the manager
 * into `.wiki/agent-proposals/` from the gateway's worktree runs, read here.
 *
 * The MERGE is the approval: applying a proposal writes the changed wiki
 * pages through the engine's own machinery (atomic, history-committed) and
 * removes the git worktree the agent edited on. Rejecting removes the
 * worktree and the proposal, leaving the wiki untouched. The gateway never
 * writes the workspace; this endpoint is the only place a proposal becomes
 * content.
 */
export type AgentProposalRoutesDeps = {
  rootDir: string;
  workspace: WorkspaceService;
  historyConfig: unknown;
  isRunActive?: () => Promise<boolean>;
  sendJson: (
    res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void },
    status: number,
    data: unknown,
  ) => void;
  sendGzippedHtml: (
    req: IncomingMessage,
    res: ServerResponse,
    html: string,
    headers?: Record<string, string>,
    status?: number,
  ) => Promise<void>;
};

const PROPOSALS_DIRNAME = '.wiki/agent-proposals';
const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

function proposalsDir(rootDir: string): string {
  return path.join(rootDir, PROPOSALS_DIRNAME);
}

type ProposalRecord = {
  id: string;
  runId: string;
  workspace: string;
  branch: string;
  worktreePath: string;
  worktreeRelativePath: string;
  createdAt: string;
  justification: string;
  objections?: Array<{ severity: string; statement: string }>;
  changedFiles: Array<{ status: string; path: string }>;
  changes: Array<{ path: string; status: string; content: string | null }>;
  diff: string;
};

async function listProposals(rootDir: string): Promise<Array<{ record: ProposalRecord; file: string }>> {
  try {
    const files = (await readdir(proposalsDir(rootDir))).filter((name) => name.endsWith('.json'));
    const records: Array<{ record: ProposalRecord; file: string }> = [];
    for (const file of files) {
      try {
        const raw = await readFile(path.join(proposalsDir(rootDir), file), 'utf8');
        const record = JSON.parse(raw) as ProposalRecord;
        if (record && typeof record.id === 'string' && Array.isArray(record.changes)) {
          records.push({ record, file });
        }
      } catch {
        // A truncated or malformed record is skipped, not fatal.
      }
    }
    return records.sort((a, b) => String(b.record.createdAt ?? '').localeCompare(String(a.record.createdAt ?? '')));
  } catch {
    return [];
  }
}

async function readProposal(rootDir: string, id: string): Promise<ProposalRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    const raw = await readFile(path.join(proposalsDir(rootDir), `${id}.json`), 'utf8');
    const record = JSON.parse(raw) as ProposalRecord;
    return record && typeof record.id === 'string' ? record : null;
  } catch {
    return null;
  }
}

// The only paths a merge may write: the wiki corpus. The proposal travels
// from a different process (the gateway) — treat it as untrusted.
function mergeableChange(rootDir: string, change: { path: string; status: string; content: string | null }): boolean {
  const value = String(change?.path ?? '');
  if (!value.startsWith('wiki/') || value.includes('..')) return false;
  try {
    const absolute = resolveInside(rootDir, value);
    const rel = path.relative(rootDir, absolute).split(path.sep).join('/');
    if (rel !== value) return false;
    if (change.status === 'D') return true;
    return typeof change.content === 'string';
  } catch {
    return false;
  }
}

function cleanupWorktree(rootDir: string, record: ProposalRecord): void {
  const relativePath = String(record.worktreeRelativePath ?? '');
  if (!relativePath || relativePath.includes('..') || relativePath.startsWith('/')) return;
  const branch = String(record.branch ?? '');
  const worktreeAbsolute = path.join(rootDir, relativePath);
  if (!worktreeAbsolute.startsWith(path.join(rootDir, '.wiki', 'agent-worktrees'))) return;
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreeAbsolute], { cwd: rootDir, stdio: 'ignore' });
  } catch {
    // The worktree may already be gone (hand cleanup, crashed run).
  }
  if (/^agent\/[a-zA-Z0-9._-]+$/.test(branch)) {
    try {
      execFileSync('git', ['branch', '-D', branch], { cwd: rootDir, stdio: 'ignore' });
    } catch {
      // A merged or never-pushed branch is not an error here.
    }
  }
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: rootDir, stdio: 'ignore' });
  } catch {
    // Pruning is bookkeeping, never the operation itself.
  }
}

async function removeProposalFile(rootDir: string, id: string): Promise<void> {
  if (!SAFE_ID.test(id)) return;
  await unlink(path.join(proposalsDir(rootDir), `${id}.json`)).catch(() => {});
}

function renderProposalList(records: Array<{ record: ProposalRecord }>): string {
  const items = records.length
    ? records.map(({ record }) => {
        const files = record.changedFiles.length;
        const label = record.changedFiles.slice(0, 3).map((entry) => entry.path).join(', ');
        return `<li class="proposal-card"><a class="proposal-link" href="/agent-proposals/${encodeURIComponent(record.id)}"><span class="proposal-id">${escapeHtml(record.id)}</span><span class="proposal-meta">${files} file(s) · ${escapeHtml(record.createdAt ?? '')}</span><span class="proposal-files">${escapeHtml(label)}${files > 3 ? ' …' : ''}</span></a></li>`;
      }).join('\n')
    : '<li class="proposal-empty">No pending agent proposals. When a curation run (agent.curate) completes, its diff waits here for a merge or a reject.</li>';
  return `<main class="content"><article class="article"><h1>Agent proposals</h1><p class="proposal-lede">Each proposal is a git branch an agent edited. Merging writes the changes into the wiki and commits them; rejecting discards the branch. Nothing else touches the workspace.</p><ul class="proposal-list">${items}</ul></article></main>`;
}

function renderProposalDetail(record: ProposalRecord): string {
  const files = record.changedFiles
    .map((entry) => `<li class="proposal-file"><span class="proposal-status proposal-status-${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>${escapeHtml(entry.path)}</li>`)
    .join('\n');
  const justification = record.justification
    ? `<h2>Why</h2><p class="proposal-why">${escapeHtml(record.justification)}</p>`
    : '';
  const objections = Array.isArray(record.objections) && record.objections.length > 0
    ? `<h2>Unresolved objections</h2><ul class="proposal-objections">${record.objections
        .map((entry) => `<li class="proposal-objection proposal-objection-${escapeHtml(String(entry?.severity ?? 'non-blocking'))}"><span class="proposal-objection-severity">${escapeHtml(String(entry?.severity ?? 'non-blocking'))}</span>${escapeHtml(String(entry?.statement ?? ''))}</li>`)
        .join('\n')}</ul>`
    : '';
  const diff = escapeHtml(record.diff || '(no diff)');
  const actions = `<form class="proposal-actions" method="post" action="/api/agent-proposals/${encodeURIComponent(record.id)}/merge"><button class="action-button" type="submit">Merge into the wiki</button></form><form class="proposal-actions" method="post" action="/api/agent-proposals/${encodeURIComponent(record.id)}/reject"><button class="action-link" type="submit">Reject &amp; discard the branch</button></form>`;
  return `<main class="content"><article class="article"><h1>Proposal ${escapeHtml(record.id)}</h1><p class="proposal-lede">${escapeHtml(record.createdAt ?? '')} · branch ${escapeHtml(record.branch)} · workspace ${escapeHtml(record.workspace)}</p>${actions}${justification}${objections}<h2>Changed files</h2><ul class="proposal-files">${files}</ul><h2>Diff</h2><pre class="proposal-diff">${diff}</pre>${actions}</article></main>`;
}

function proposalPageCss(): string {
  return `<style>
.proposal-list{list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
.proposal-card{border:1px solid var(--border);border-radius:10px;background:var(--panel)}
.proposal-link{display:grid;gap:.15rem;padding:.7rem .9rem;text-decoration:none;color:var(--text)}
.proposal-id{font-weight:780;color:var(--accent);font-family:var(--font-mono);font-size:.82rem}
.proposal-meta,.proposal-files{font-size:.78rem;color:var(--muted)}
.proposal-lede{color:var(--muted);font-size:.9rem}
.proposal-why{white-space:pre-wrap;font-size:.9rem;line-height:1.6;border-left:3px solid var(--accent);padding:.3rem .8rem;background:var(--panel-soft);border-radius:0 8px 8px 0}
.proposal-objections{list-style:none;margin:0;padding:0;display:grid;gap:.3rem}
.proposal-objection{display:flex;gap:.5rem;align-items:baseline;font-size:.85rem;padding:.35rem .6rem;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft)}
.proposal-objection-severity{font-family:var(--font-mono);font-size:.7rem;font-weight:800;text-transform:uppercase}
.proposal-objection-blocking{color:var(--err);border-color:color-mix(in srgb,var(--err) 40%,var(--border))}
.proposal-objection-non-blocking{color:#f59e0b;border-color:color-mix(in srgb,#f59e0b 40%,var(--border))}
.proposal-actions{display:inline-block;margin:.4rem .6rem .4rem 0}
.proposal-files{list-style:none;margin:0;padding:0;display:grid;gap:.2rem}
.proposal-status{display:inline-block;min-width:1.4rem;margin-right:.5rem;padding:.05rem .35rem;border-radius:4px;font-family:var(--font-mono);font-size:.72rem;text-align:center}
.proposal-status-M{background:var(--accent-soft);color:var(--accent)}
.proposal-status-A{background:color-mix(in srgb,#22c55e 18%,transparent);color:#22c55e}
.proposal-status-D{background:color-mix(in srgb,var(--err) 16%,transparent);color:var(--err)}
.proposal-diff{background:var(--panel-deep,#0d1420);border:1px solid var(--border);border-radius:10px;padding:1rem;overflow-x:auto;font-family:var(--font-mono);font-size:.8rem;line-height:1.45;white-space:pre}
.proposal-empty{border:1px dashed var(--border);border-radius:10px;padding:1rem;color:var(--muted);font-size:.85rem}
</style>`;
}

export async function handleAgentProposalRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: AgentProposalRoutesDeps,
): Promise<boolean> {
  const { rootDir, sendJson, sendGzippedHtml, isRunActive } = deps;
  if (urlPath === '/agent-proposals' && req.method === 'GET') {
    const records = await listProposals(rootDir);
    return sendGzippedHtml(
      req,
      res,
      layout('Agent proposals', renderProposalList(records) + proposalPageCss()),
    ).then(() => true);
  }

  const detailMatch = /^\/agent-proposals\/([^/]+)$/.exec(urlPath);
  if (detailMatch && req.method === 'GET') {
    const record = await readProposal(rootDir, detailMatch[1] ?? '');
    if (!record) {
      sendJson(res, 404, { ok: false, error: 'proposal not found' });
      return true;
    }
    return sendGzippedHtml(
      req,
      res,
      layout(`Proposal ${record.id}`, renderProposalDetail(record) + proposalPageCss()),
    ).then(() => true);
  }

  const apiMatch = /^\/api\/agent-proposals\/([^/]+)(\/(merge|reject))?$/.exec(urlPath);
  if (!apiMatch && urlPath !== '/api/agent-proposals') return false;
  const id = apiMatch?.[1] ?? '';
  const action = apiMatch?.[2]?.replace(/^\//, '') ?? '';

  if (!id) {
    const records = await listProposals(rootDir);
    sendJson(res, 200, {
      proposals: records.map(({ record }) => ({
        id: record.id,
        workspace: record.workspace,
        createdAt: record.createdAt,
        branch: record.branch,
        changedFiles: record.changedFiles,
      })),
    });
    return true;
  }

  if (action === 'merge' && req.method === 'POST') {
    if (await isRunActive?.()) {
      sendJson(res, 409, { ok: false, error: 'a run is active — try again once it finishes' });
      return true;
    }
    const record = await readProposal(rootDir, id);
    if (!record) {
      sendJson(res, 404, { ok: false, error: 'proposal not found' });
      return true;
    }
    // The merge IS the approval, and it is what OKF v0.2 records: every
    // merged page gains a `verified` decision and moves to `stable` —
    // additively, a hand-set key always wins.
    const mergedAt = new Date().toISOString();
    const operations = record.changes
      .filter((change) => mergeableChange(rootDir, change))
      .map((change) => {
        if (change.status === 'D') {
          return { type: 'delete' as const, path: change.path, content: '' };
        }
        return {
          type: 'update' as const,
          path: change.path,
          content: applyOkfFrontmatter(change.content ?? '', {
            verified: [{ by: 'human:merge', at: mergedAt }],
            status: 'stable',
          }),
        };
      });
    if (operations.length === 0) {
      sendJson(res, 400, { ok: false, error: 'the proposal carries no mergeable wiki change' });
      return true;
    }
    try {
      await deps.workspace.applyWikiOperations(operations);
      const history = new HistoryService(rootDir, deps.historyConfig as never);
      await commitHistorySafely(history, {
        command: 'page',
        message: `agent-curate: ${id}`,
        scope: operations.map((operation) => operation.path),
      });
      cleanupWorktree(rootDir, record);
      await removeProposalFile(rootDir, id);
      sendJson(res, 200, { ok: true, merged: operations.length, files: operations.map((operation) => operation.path) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (action === 'reject' && req.method === 'POST') {
    if (await isRunActive?.()) {
      sendJson(res, 409, { ok: false, error: 'a run is active — try again once it finishes' });
      return true;
    }
    const record = await readProposal(rootDir, id);
    if (!record) {
      sendJson(res, 404, { ok: false, error: 'proposal not found' });
      return true;
    }
    cleanupWorktree(rootDir, record);
    await removeProposalFile(rootDir, id);
    sendJson(res, 200, { ok: true, rejected: id });
    return true;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
  return true;
}

// Re-exported for tests: the directory name is a contract between the manager
// (writer) and serve (reader).
export { PROPOSALS_DIRNAME, listProposals, readProposal };
