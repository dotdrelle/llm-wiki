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
});
