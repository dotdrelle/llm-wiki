import { describe, expect, it } from 'vitest';
import { PROGRESS_LABEL_SCRIPT } from '../src/chat/runtime/progressLabelScript.ts';
import { RUN_LIVE_LINE_SCRIPT } from '../src/chat/runtime/runLiveLineScript.ts';

// A run launched from a turn (a skill, a queued request) used to leave the chat
// silent after "queued, progress will be reported": the run now has its own
// live ">_" line, one step at a time.
function load(state: unknown, conversationId = 'conv-1') {
  return new Function('runtimeState', 'currentConversationId', 'runStripDetail', 'runStripPercent',
    `${PROGRESS_LABEL_SCRIPT}\n${RUN_LIVE_LINE_SCRIPT}\nreturn { runLiveLineActive, runLiveLineLabel, runLiveLineStatusLabel };`)(
    state, conversationId,
    (progress: { detail?: string }) => progress.detail ?? '',
    (value: unknown) => (value == null || value === '' ? '' : `${Math.round(Number(value))}%`),
  );
}

describe('live line of a run in the chat', () => {
  it('follows the active run of the open conversation only', () => {
    const running = (conversationId: string | null) => ({ status: 'running', running: true,
      controlQueue: [{ status: 'running', conversationId }] });
    expect(load(running('conv-1')).runLiveLineActive()).toBe(true);
    expect(load(running(null)).runLiveLineActive()).toBe(true);
    expect(load(running('conv-2')).runLiveLineActive()).toBe(false);
    expect(load({ status: 'done', running: false, controlQueue: [] }).runLiveLineActive()).toBe(false);
  });

  it('says it waits for the approval, then reads each step', () => {
    expect(load({ status: 'pending_approval' }).runLiveLineStatusLabel()).toMatch(/Waiting for your approval/);
    const { runLiveLineLabel } = load({ status: 'running' });
    expect(runLiveLineLabel({ type: 'tool_call_started', payload: { name: 'wiki.template_read', summary: 'calling...' } })).toBe('wiki · template_read');
    expect(runLiveLineLabel({ type: 'tool_call_started', payload: { name: 'wiki.wiki_read_page', summary: 'path=wiki/a.md' } }))
      .toBe('wiki · wiki_read_page (path=wiki/a.md)');
    expect(runLiveLineLabel({ type: 'activity_upserted', payload: { activity: { progress: { label: 'Ingest a.md', detail: 'Batch 1/2', percent: 37.4 } } } }))
      .toBe('Ingest a.md · Batch 1/2 · 37%');
    expect(runLiveLineLabel({ type: 'assistant_delta', payload: {} })).toBe('');
  });

  it('compacts the business line: no lone step, no "LLM running", no invented 0%', () => {
    const { runLiveLineLabel } = load({ status: 'running' });
    expect(runLiveLineLabel({ type: 'activity_upserted', payload: { activity: { progress: {
      label: 'Ingest juno.md +1', detail: 'Step 1/1 · Sources 3 running / 3 · LLM running …', percent: null } } } }))
      .toBe('Ingest juno.md +1 · Sources 3 running / 3');
  });

  it('keeps the meter, raw traces and scheduler lines out of the line', () => {
    const { runLiveLineLabel } = load({ status: 'running' });
    for (const message of [
      'model: run call 2 · 0.3 s · with tools · failed',
      'trace: llm:end label=ingest_taxo_sheet_dedup durationMs=6804',
      'scheduler: dispatching 1 task',
    ]) expect(runLiveLineLabel({ type: 'runtime_log', payload: { message } })).toBe('');
  });
});
