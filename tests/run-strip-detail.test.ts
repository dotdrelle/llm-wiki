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
});
