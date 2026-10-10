import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import { TIME_FORMAT_SCRIPT } from '../src/chat/runtime/timeFormatScript.ts';

// The manager journals every model call of a run or a turn ("model: …"). The
// Logs tab keeps only "essential" lines, and a turn's line carries none of
// the keywords that make a line essential: the filter must keep it, or the
// bottleneck stays invisible exactly where it is looked for.
describe('model meter lines in the Logs tab', () => {
  const start = CHAT_HTML.indexOf('function essentialRuntimeLogEntries(logs) {');
  const end = CHAT_HTML.indexOf('\n}\n', start) + 2;
  const essential = new Function(`${TIME_FORMAT_SCRIPT}\n${CHAT_HTML.slice(start, end)}\nreturn essentialRuntimeLogEntries;`)() as (logs: string[]) => Array<{ text: string }>;

  it('keeps every model call line, of a turn as well as a run', () => {
    const texts = essential([
      '15:07:21 model: turn call 1 · 5.3 s · with tools · in 4120 / out 310 tokens · asked 3 tool call(s)',
      '15:07:50 model: turn call 2 · 18.6 s · with tools · in 9100 / out 2310 tokens',
      '15:07:51 model: turn total 2 call(s) · 23.9 s · longest call 2 (18.6 s)',
    ]).map((entry) => entry.text);
    expect(texts).toHaveLength(3);
    expect(texts[1]).toContain('18.6 s');
  });
});
