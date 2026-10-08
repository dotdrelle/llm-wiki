import { describe, expect, it } from 'vitest';
import { RUNTIME_GRAPH_SCRIPT } from '../src/chat/runtime/runtimeGraphScript.ts';

// A TAXO ingest is one task over the whole batch: the graph hangs its input
// files off the expanded task instead of the per-file tasks that no longer exist.
function project(runtimeState: unknown) {
  const build = new Function(
    'runtimeState', 'isActivityActive', 'normalizeActivityStatus', 'selectedWorkflowNodeId',
    `${RUNTIME_GRAPH_SCRIPT}
     return (id) => { selectedWorkflowNodeId = id; runtimeWorkflowUserSelected = true; return runtimeWorkflowGraphData(); };`,
  );
  const open = build(
    runtimeState,
    (status: string) => status === 'running',
    (status: string) => status,
    null,
  );
  return open('phase:ingest');
}

const task = (status: string) => ({
  id: 'task:ingest-taxonomy', type: 'task', stepId: 'ingest-taxonomy', label: 'Ingest and organize 3 source file(s)', status,
  raw: {
    operation: 'ingest',
    inputRefs: [
      { type: 'file', ref: 'raw/untracked/Etude open source EPM.md' },
      { type: 'file', ref: 'raw/untracked/Comparaison Sécurité.md' },
    ],
    arguments: { inputs: ['raw/untracked/Etude open source EPM.md', 'raw/untracked/Synthèse.md'] },
  },
});

describe('runtime graph task inputs', () => {
  it('lists every input file of the expanded task, the one in progress running', () => {
    const { nodes, relations } = project({
      workflow: {
        nodes: [{ id: 'run:1', type: 'run', status: 'running' }, task('running')],
        activity: { lines: [{ status: 'running', progress: { label: 'Comparaison Sécurité.md · Section 1/2' } }] },
      },
    });
    const inputs = nodes.filter((node: { type: string }) => node.type === 'task_input');
    expect(inputs.map((node: { label: string; status: string }) => [node.label, node.status])).toEqual([
      ['Etude open source EPM.md', 'pending'],
      ['Comparaison Sécurité.md', 'running'],
      ['Synthèse.md', 'pending'],
    ]);
    const detail = nodes.find((node: { type: string }) => node.type === 'task_detail');
    expect(relations.filter((rel: { from: string; to: string }) => rel.to === detail.id && String(rel.from).startsWith('input:'))).toHaveLength(3);
  });

  it('colours each file from the per-file states the production agent reports', () => {
    const { nodes } = project({
      workflow: {
        nodes: [{ id: 'run:1', type: 'run', status: 'running' }, task('running')],
        activity: { lines: [{ status: 'running', progress: {
          label: 'Organize section sheets',
          sourceStates: { 'Etude open source EPM.md': 'done', 'Comparaison Sécurité.md': 'running', 'Synthèse.md': 'running' },
        } }] },
      },
    });
    const inputs = nodes.filter((node: { type: string }) => node.type === 'task_input');
    expect(inputs.map((node: { label: string; status: string }) => [node.label, node.status])).toEqual([
      ['Etude open source EPM.md', 'done'],
      ['Comparaison Sécurité.md', 'running'],
      ['Synthèse.md', 'running'],
    ]);
  });

  it('gives the files the task status once it settles', () => {
    const { nodes } = project({ workflow: { nodes: [{ id: 'run:1', type: 'run', status: 'done' }, task('done')] } });
    expect(nodes.filter((node: { type: string }) => node.type === 'task_input').every((node: { status: string }) => node.status === 'done')).toBe(true);
  });

  it('carries the live extraction processes on the ingestion phase, not just its one task', () => {
    const { nodes } = project({
      concurrency: { limit: 6 },
      ingestionLlmLimit: 4,
      workflow: {
        nodes: [{ id: 'run:1', type: 'run', status: 'running' }, task('running')],
        activity: { lines: [{ status: 'running', progress: {
          sourceStates: { 'Etude open source EPM.md': 'done', 'Comparaison Sécurité.md': 'running', 'Synthèse.md': 'running' },
        } }] },
      },
    });
    const phase = nodes.find((node: { type: string }) => node.type === 'task_group') as {
      currentParallel: number; sourceCounts: Record<string, number>; sourceTotal: number; sourceProcessLimit: number;
    };
    // One workspace-locked task, but the live extraction runs on three files.
    expect(phase.currentParallel).toBe(1);
    expect(phase.sourceCounts).toEqual({ done: 1, running: 2 });
    expect(phase.sourceTotal).toBe(3);
    expect(phase.sourceProcessLimit).toBe(4);
  });
});

// Execute the browser summary with a real workflow: input-file activity must
// not be confused with scheduler task concurrency or a live LLM-call count.
function summary(state: unknown) {
  return new Function('runtimeState', 'esc', 'formatRuntimeTokens', 'selectedWorkflowNodeId',
    `${RUNTIME_GRAPH_SCRIPT}\nreturn runtimeWorkflowSummaryParts().html;`)(
    state, (value: unknown) => String(value), () => '0 in / 0 out', null,
  );
}

describe('runtime concurrency summary', () => {
  it('keeps task capacity separate from the configured extraction limit', () => {
    const html = summary({
      concurrency: { limit: 8, agentRecommended: 8, agentMaximum: 8, ceiling: 8 },
      ingestionLlmLimit: 6,
      workflow: { nodes: [{ id: 'run:1', type: 'run', status: 'running' }, task('running')] },
    });
    // A single-task plan shows no task concurrency: "1 / 8" read as unused
    // capacity while the parallelism is the model calls inside the ingest.
    expect(html).not.toContain('Tasks:');
    expect(html).not.toContain('Concurrent tasks');
    expect(html).toContain('Files: 0/3 done · 0 in progress');
    expect(html).toContain('Model calls at once: up to 6');
    expect(html).not.toContain('max ×');
  });

  it('shows task concurrency only for a plan of several tasks', () => {
    const html = summary({
      concurrency: { limit: 4, agentRecommended: 4, agentMaximum: 8, ceiling: null },
      workflow: { nodes: [{ id: 'run:1', type: 'run', status: 'running' },
        { ...task('running'), id: 'task:a', raw: { operation: 'build' } },
        { ...task('pending'), id: 'task:b', raw: { operation: 'build' } }] },
    });
    expect(html).toMatch(/Tasks: 0\/2 done · \d+ running \(max 4 at once\)/);
    expect(html).toContain('Agent recommended: 4 · Agent maximum: 8 · Manager cap: unset');
    expect(html).not.toContain('Model calls at once');
  });

  it('announces an unavailable limit and omits ingestion settings for builds', () => {
    const ingestion = { workflow: { nodes: [task('running')] } };
    expect(summary(ingestion)).toContain('Model calls at once: limit not reported');
    expect(summary({ workflow: { nodes: [{ ...task('running'), raw: { operation: 'build' } }] } }))
      .not.toContain('Model calls at once');
  });
});

describe('runtime graph draws maintenance beside Donna', () => {
  const withMaintenance = (running: unknown[], state: unknown) => {
    (globalThis as { window?: unknown }).window = { getMaintenanceRunning: () => running };
    try {
      const build = new Function('runtimeState', 'isActivityActive', 'normalizeActivityStatus', 'selectedWorkflowNodeId',
        `${RUNTIME_GRAPH_SCRIPT}\n return runtimeWorkflowGraphData();`);
      return build(state, (s: string) => s === 'running', (s: string) => s, null);
    } finally { delete (globalThis as { window?: unknown }).window; }
  };
  const ingest = { id: 'm1', action: 'ingest', agent: 'production', summary: 'Ingest 2 new source(s)', progress: { label: 'Ingest a.md', sourceStates: { 'a.md': 'running', 'b.md': 'done' } } };

  it('keeps Donna\'s run and adds the maintenance tree with its live files', () => {
    const { nodes, relations } = withMaintenance([ingest], {
      status: 'running',
      workflow: { nodes: [{ id: 'run:1', type: 'run', status: 'running' }, task('running')] },
    });
    const runs = nodes.filter((n: { type: string }) => n.type === 'run').map((n: { id: string }) => n.id);
    expect(runs).toEqual(['run:1', 'maintenance']);
    const phase = nodes.find((n: { id: string }) => n.id === 'maintenance:m1');
    expect(phase.agents).toEqual(['production']);
    expect(phase.sourceCounts).toEqual({ running: 1, done: 1 });
    const files = nodes.filter((n: { type: string; detailId?: string }) => n.type === 'task_input' && n.detailId === 'maintenance:m1');
    expect(files.map((n: { label: string; status: string }) => [n.label, n.status])).toEqual([['a.md', 'running'], ['b.md', 'done']]);
    expect(relations.some((r: { from: string; to: string }) => r.from === 'maintenance:m1' && r.to === 'maintenance')).toBe(true);
  });

  it('draws nothing extra when maintenance is idle', () => {
    const { nodes } = withMaintenance([], { workflow: { nodes: [{ id: 'run:1', type: 'run', status: 'done' }] } });
    expect(nodes.some((n: { id: string }) => n.id === 'maintenance')).toBe(false);
  });
});
