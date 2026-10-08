import { describe, expect, it } from 'vitest';
import { RUN_LIVE_LINE_SCRIPT } from '../src/chat/runtime/runLiveLineScript.ts';

// A run launched from a turn (a skill, a queued request) used to leave the chat
// silent after "queued, progress will be reported": the run now has its own
// live ">_" line, one step at a time.
function load(state: unknown, conversationId = 'conv-1') {
  return new Function('runtimeState', 'currentConversationId', 'runtimeProgressLabel', 'runStripDetail',
    `${RUN_LIVE_LINE_SCRIPT}\nreturn { runLiveLineActive, runLiveLineLabel, runLiveLineStatusLabel };`)(
    state, conversationId,
    (event: { type: string; payload?: { message?: string } }) => (event.type === 'runtime_log' ? String(event.payload?.message ?? '') : event.type === 'assistant_delta' ? 'Writing the answer…' : ''),
    (progress: { detail?: string }) => progress.detail ?? '',
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
    expect(runLiveLineLabel({ type: 'tool_call_started', payload: { name: 'wiki.template_read' } })).toBe('Calling wiki.template_read');
    expect(runLiveLineLabel({ type: 'activity_upserted', payload: { activity: { progress: { label: 'Ingest a.md', detail: 'LLM running', percent: 37.4 } } } }))
      .toBe('Ingest a.md · LLM running · 37%');
    expect(runLiveLineLabel({ type: 'runtime_log', payload: { message: 'scheduler: dispatching 1 task' } })).toBe('scheduler: dispatching 1 task');
    expect(runLiveLineLabel({ type: 'assistant_delta', payload: {} })).toBe('');
  });
});
