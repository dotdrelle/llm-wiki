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
    expect(html).toContain('Concurrent tasks: 1 / 8');
    expect(html).toContain('LLM calls per ingestion: limit 6');
    expect(html).toContain('1 ingestion task processes 3 input files.');
    expect(html).toContain('Agent recommended: 8 · Agent maximum: 8 · Manager cap: 8');
    expect(html).not.toContain('max ×');
  });

  it('announces an unavailable limit and omits ingestion settings for builds', () => {
    const ingestion = { workflow: { nodes: [task('running')] } };
    expect(summary(ingestion)).toContain('LLM calls per ingestion: limit not reported');
    expect(summary({ workflow: { nodes: [{ ...task('running'), raw: { operation: 'build' } }] } }))
      .not.toContain('LLM calls per ingestion');
  });
});
