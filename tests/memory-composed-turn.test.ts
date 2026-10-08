import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';

// juno: the Maintenance panel's "Ask Donna" composed a hidden question with a
// system instruction and records; memory extraction mined that instruction
// into a durable "convention". A hidden, interface-composed turn is flagged so
// the runtime never treats it as the user's words.
describe('interface-composed turns and workspace memory', () => {
  it('sends a hidden question with extractMemory:false', () => {
    expect(CHAT_HTML).toContain('...(hideQuestion?{extractMemory:false}:{})');
    expect(CHAT_HTML).toContain("input.dataset.hideQuestion='1'");
  });
});
