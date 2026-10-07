import { describe, expect, it } from 'vitest';
import { RUN_STRIP_SCRIPT } from '../src/chat/runtime/runStripScript.ts';
import { ACTIVITY_PANEL_SCRIPT } from '../src/chat/runtime/activityPanelScript.ts';

// Pull named function declarations out of the browser scripts.
function grab(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} not found`);
}
const code = ['runStripTokenText', 'runStripDetail', 'runStripPercent'].map((n) => grab(RUN_STRIP_SCRIPT, n)).join('\n')
  + grab(ACTIVITY_PANEL_SCRIPT, 'runtimeActivityLineHTML');
const { runStripDetail, runtimeActivityLineHTML } = new Function('esc', 'normalizeActivityStatus',
  `${code};return {runStripDetail,runtimeActivityLineHTML}`)((s: unknown) => String(s), (s: unknown) => s) as {
  runStripDetail: (p: unknown, u: unknown) => string;
  runtimeActivityLineHTML: (line: unknown) => string;
};

describe('run strip and Activity panel describe a run the same way', () => {
  const progress = {
    label: 'Build templates/notes/basic-note.md', detail: 'Batch 1/1 · LLM running',
    batch: { index: 1, total: 1 }, batchIndex: 0, batchCount: 1,
    processing: { instructionCount: 4 }, taskIndex: 1, taskTotal: 1, stepIndex: 1, stepTotal: 1, percent: 25,
  };

  it('keeps the agent batch sentence and never adds a second, off-by-one counter', () => {
    expect(runStripDetail(progress, null)).toBe('Task 1/1 · Step 1/1 · Batch 1/1 · LLM running · 4 instructions');
  });

  it('shows the same document label and figures in the Activity line', () => {
    const html = runtimeActivityLineHTML({ status: 'running', label: 'Build basic-note.md', progress });
    expect(html).toContain('<span class="act-line-label">Build templates/notes/basic-note.md</span>');
    expect(html).toContain(`running · ${runStripDetail(progress, null)} · 25%`);
    expect(html).not.toContain('batch 2/1');
  });

  it('counts batches 1-based from the agent, or from the 0-based trace index', () => {
    expect(runStripDetail({ batch: { index: 2, total: 3 }, batchIndex: 1, batchCount: 3 }, null)).toBe('Batch 2/3');
    expect(runStripDetail({ batchIndex: 1, batchCount: 3 }, null)).toBe('Batch 2/3');
  });

  it('reports the live extraction processes instead of the lagging source cursor', () => {
    const live = { sourceIndex: 0, sourceCount: 8, sourceStates: { 'a.md': 'done', 'b.md': 'running', 'c.md': 'running' } };
    expect(runStripDetail(live, null)).toBe('Sources 2 running · 1 done / 8');
    // Without the per-file states, the 1-based cursor stays the fallback.
    expect(runStripDetail({ sourceIndex: 0, sourceCount: 8 }, null)).toBe('Source 1/8');
  });
});

describe('the run strip is shown for a run, never for a turn or a leftover', () => {
  const helpers = ['isActivityActive', 'normalizeActivityStatus'].map((n) => grab(ACTIVITY_PANEL_SCRIPT, n)).join('\n');
  const active = (state: unknown) => new Function('runtimeState', `${helpers}\n${grab(RUN_STRIP_SCRIPT, 'runIsActive')};return runIsActive();`)(state) as boolean;

  it('hides once the run is over, even if its last activity poll still said running at 100%', () => {
    expect(active({ status: 'done', activities: [{ status: 'running', terminal: false, progress: { percent: 100 } }] })).toBe(false);
    expect(active({ status: 'idle', activities: [{ status: 'running', terminal: false, progress: { percent: 40 } }] })).toBe(false);
  });

  it('shows for a running or approval-waiting run and a queued chain', () => {
    expect(active({ status: 'running' })).toBe(true);
    expect(active({ status: 'pending_approval' })).toBe(true);
    expect(active({ status: 'waiting' })).toBe(true);
    expect(active({ status: 'idle', skillChains: [{ status: 'queued' }] })).toBe(true);
  });

  it('stays hidden with no runtime state (a chat turn awaiting its answer)', () => {
    expect(active(null)).toBe(false);
  });
});
