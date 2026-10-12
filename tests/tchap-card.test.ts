import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import { TCHAP_CARD_SCRIPT } from '../src/chat/runtime/tchapCardScript.ts';

type FakeNode = { id?: string; className?: string; hidden?: boolean; innerHTML: string; textContent?: string };

/** Run the card script against a minimal DOM and a scripted connectors_tchap_status. */
function mount(status: unknown) {
  const card: FakeNode = { id: 'tchap-card', innerHTML: '' };
  let section: FakeNode | undefined;
  const view = {
    querySelectorAll: () => [],
    insertBefore: (node: FakeNode) => { section = node; },
  };
  const document = {
    head: { append: () => {} },
    createElement: (): FakeNode => ({ innerHTML: '' }),
    getElementById: (id: string) => (id === 'connectors-view' ? view : id === 'tchap-card' ? card : null),
  };
  const calls: Array<[string, unknown]> = [];
  const submitted: string[] = [];
  const window: Record<string, unknown> = { __WIKI_CONFIG__: { workspaceName: 'demo' } };
  const callMCPTool = async (name: string, args: unknown) => {
    calls.push([name, args]);
    if (status instanceof Error) throw status;
    return JSON.stringify(status);
  };
  const esc = (value: unknown) => String(value).replace(/</g, '&lt;');
  const run = new Function(
    'document', 'window', 'callMCPTool', 'esc', 'submitSuggestion', 'updateAgentModeUI', 'showChatView',
    `let agentMode=false;\n${TCHAP_CARD_SCRIPT}\nreturn { agentMode: () => agentMode };`,
  );
  const scope = run(document, window, callMCPTool, esc, (text: string) => submitted.push(text), () => {}, () => {}) as { agentMode: () => boolean };
  return {
    render: () => (window.renderTchapCard as () => Promise<void>)(),
    attach: () => (window.tchapAttachForum as () => void)(),
    section: () => section,
    card,
    calls,
    submitted,
    agentMode: scope.agentMode,
  };
}

describe('Tchap card in the Connectors view', () => {
  it('shows a stopped bridge instead of hiding it when the session ended', async () => {
    const page = mount({ ok: true, connected: false, forum: 'Donna-demo', bridge: 'active', lastError: 'tchap_reauthorization_required' });
    await page.render();
    expect(page.section()?.hidden).toBe(false);
    expect(page.card.innerHTML).toContain('Not signed in');
    expect(page.card.innerHTML).toContain('tchap_reauthorization_required');
    expect(page.card.innerHTML).toContain('Sign in again');
  });

  it('shows a pending sign-in code', async () => {
    const page = mount({ ok: true, connected: false, pending: { userCode: 'ABCD-1234', verificationUri: 'https://auth.example/link' } });
    await page.render();
    expect(page.card.innerHTML).toContain('Sign-in pending');
    expect(page.card.innerHTML).toContain('ABCD-1234');
  });

  it('stays hidden while Tchap was never set up, is disabled or unreachable', async () => {
    for (const status of [{ ok: true, connected: false }, { ok: false, error: 'bridge_not_configured' }, new Error('Unknown tool')]) {
      const page = mount(status);
      await page.render();
      expect(page.section()?.hidden).toBe(true);
      expect(page.card.innerHTML).toBe('');
    }
  });

  it('shows the account, the forum and its state once signed in', async () => {
    const page = mount({
      ok: true, connected: true, account: '@me:agent.example', forum: 'Donna-demo (#Donna-demo:agent.example)',
      bridge: 'awaiting_activation', running: true, allowedUsers: ['@me:agent.example'],
    });
    await page.render();
    expect(page.section()?.hidden).toBe(false);
    expect(page.card.innerHTML).toContain('Awaiting /activate');
    expect(page.card.innerHTML).toContain('Donna-demo (#Donna-demo:agent.example)');
    expect(page.card.innerHTML).toContain('Detach forum');
    expect(page.calls).toEqual([['connectors_tchap_status', { workspace: 'demo' }]]);
  });

  it('offers to attach a forum when the workspace has none', async () => {
    const page = mount({ ok: true, connected: true, account: '@me:agent.example', running: false });
    await page.render();
    expect(page.card.innerHTML).toContain('No forum for this workspace yet.');
    expect(page.card.innerHTML).toContain('Attach a forum');
  });

  it('acts through a Donna turn in agent mode, never a direct tool call', async () => {
    const page = mount({ ok: true, connected: true, account: '@me:agent.example' });
    await page.render();
    page.attach();
    expect(page.agentMode()).toBe(true);
    expect(page.submitted).toEqual(['Connect Tchap: list my Tchap forums and attach the one I choose to this workspace.']);
    expect(page.calls.map(([name]) => name)).toEqual(['connectors_tchap_status']);
    expect(TCHAP_CARD_SCRIPT).not.toContain('connectors_tchap_connect');
  });

  it('is part of the chat page and rendered when the Connectors view opens', () => {
    expect(CHAT_HTML).toContain('window.renderTchapCard=async function');
    expect(CHAT_HTML).toContain('window.renderTchapCard?.();');
  });
});
