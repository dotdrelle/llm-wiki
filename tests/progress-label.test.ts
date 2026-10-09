import { describe, expect, it } from 'vitest';
import { PROGRESS_LABEL_SCRIPT } from '../src/chat/runtime/progressLabelScript.ts';

// The ">_" line between "Searching" and the answer: an allow-list of steps,
// never the meter, a raw trace or the loop's iteration counter.
const { runtimeProgressLabel, progressEventInThread } = new Function(
  `${PROGRESS_LABEL_SCRIPT}\nreturn { runtimeProgressLabel, progressEventInThread };`,
)() as {
  runtimeProgressLabel: (event: unknown) => string;
  progressEventInThread: (event: unknown, conversationId: string | null | undefined) => boolean;
};
const log = (message: string) => runtimeProgressLabel({ type: 'runtime_log', payload: { message } });
const note = (message: string) => runtimeProgressLabel({ type: 'assistant_progress', payload: { message } });

describe('what the >_ line says during a turn', () => {
  it('names the steps of a chat turn', () => {
    expect(log('Donna Searching...')).toBe('Searching the wiki…');
    expect(log('Chat: consulting…')).toBe('Thinking…');
    expect(log('Chat: read tavily.search (query=inventaire DIROM)…')).toBe('tavily · search (query=inventaire DIROM)');
    expect(log('Chat: search workspace memory…')).toBe('memory · search');
    expect(log('Chat: read same-workspace conversation…')).toBe('conversation · read');
    expect(log('Chat: condensed the pages read to fit the input budget…')).toBe('Condensing the pages read…');
    expect(log('Wiki pre-search failed (timeout); answering without it.')).toBe('Wiki search failed — answering without it');
    expect(runtimeProgressLabel({ type: 'assistant_delta', payload: {} })).toBe('Writing the answer…');
  });

  it('names the steps of an agent turn', () => {
    expect(log('Agent: planning next action…')).toBe('Thinking…');
    expect(log('[2/80] synthesizing…')).toBe('Thinking…');
    expect(log('Agent: malformed tool call rejected; retrying…')).toBe('Retrying…');
    expect(note('Using wiki.wiki_read_page (path=wiki/a.md)…')).toBe('wiki · wiki_read_page (path=wiki/a.md)');
    expect(note('wiki.wiki_read_page done.')).toBe('Thinking…');
    expect(note('wiki.wiki_read_page failed: not found')).toBe('wiki.wiki_read_page failed: not found');
  });

  it('leaves the line alone for what belongs in Logs', () => {
    for (const message of [
      'model: turn call 2 · 0.3 s · with tools · failed',
      'model: turn · 3 calls · 21.4 s',
      'trace: llm:end label=ingest_taxo_sheet_dedup durationMs=6804',
      '[3/80] MCP wiki.wiki_read_page (path=wiki/a.md)',
      'memory: saved 1 fact',
    ]) expect(log(message)).toBe('');
  });

  it('keeps another conversation out of this one', () => {
    expect(progressEventInThread({ conversationId: 'a' }, 'a')).toBe(true);
    expect(progressEventInThread({ conversationId: 'a' }, 'b')).toBe(false);
    expect(progressEventInThread({ conversationId: null }, 'b')).toBe(true);
    expect(progressEventInThread({ conversationId: 'a' }, null)).toBe(true);
  });
});
