import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';

function chatScripts(): string[] {
  return [...CHAT_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('chat html', () => {
  it('embeds syntactically valid scripts', () => {
    const scripts = chatScripts();

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new vm.Script(script)).not.toThrow();
    }
  });

  it('opens production status panel when production tools return data', () => {
    const [script] = chatScripts();

    expect(script).toContain('updateProductionFromPayload(data,{open:true,poll:false});');
    expect(script).toContain(
      'updateProductionFromPayload(data,{open:true,poll:!productionTerminal(data.job?.status)});',
    );
  });
});
