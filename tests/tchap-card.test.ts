import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import { TCHAP_CARD_SCRIPT } from '../src/chat/runtime/tchapCardScript.ts';

type FakeNode = { hidden: boolean; innerHTML: string };

/** Run the card script against the two nodes it uses and a scripted connectors_tchap_status. */
function mount(status: unknown) {
  const section: FakeNode = { hidden: true, innerHTML: '' };
  const card: FakeNode = { hidden: false, innerHTML: '' };
  const document = {
    head: { append: () => {} },
    createElement: () => ({ textContent: '' }),
    getElementById: (id: string) => (id === 'tchap-section' ? section : id === 'tchap-card' ? card : null),
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
  new Function('document', 'window', 'callMCPTool', 'esc', 'submitAgentSuggestion', TCHAP_CARD_SCRIPT)(
    document, window, callMCPTool, esc, (text: string) => submitted.push(text),
  );
  return {
    render: () => (window.renderTchapCard as () => Promise<void>)(),
    attach: () => (window.tchapAttachForum as () => void)(),
    section,
    card,
    calls,
    submitted,
  };
}

describe('Tchap card in the Connectors view', () => {
  it('stays hidden while Tchap was never set up, is disabled or unreachable', async () => {
    for (const status of [{ ok: true, phase: 'not_set_up' }, { ok: true, phase: 'disabled' }, { ok: false, error: 'x' }, new Error('Unknown tool')]) {
      const page = mount(status);
      await page.render();
      expect(page.section.hidden).toBe(true);
      expect(page.card.innerHTML).toBe('');
    }
  });

  it('shows the account, the forum and its state once signed in', async () => {
    const page = mount({
      ok: true, phase: 'awaiting_activation', account: '@me:agent.example', forum: 'Donna-demo (#Donna-demo:agent.example)',
      allowedUsers: ['@me:agent.example'],
    });
    await page.render();
    expect(page.section.hidden).toBe(false);
    expect(page.card.innerHTML).toContain('Awaiting /activate');
    expect(page.card.innerHTML).toContain('Donna-demo (#Donna-demo:agent.example)');
    expect(page.card.innerHTML).toContain('Detach forum');
    expect(page.calls).toEqual([['connectors_tchap_status', { workspace: 'demo' }]]);
  });

  it('offers to attach a forum when the workspace has none', async () => {
    const page = mount({ ok: true, phase: 'no_forum', account: '@me:agent.example' });
    await page.render();
    expect(page.card.innerHTML).toContain('No forum for this workspace yet.');
    expect(page.card.innerHTML).toContain('Attach a forum');
  });

  it('shows a stopped bridge instead of hiding it when the session ended', async () => {
    const page = mount({ ok: true, phase: 'signed_out', forum: 'Donna-demo', lastError: 'tchap_reauthorization_required' });
    await page.render();
    expect(page.section.hidden).toBe(false);
    expect(page.card.innerHTML).toContain('Not signed in');
    expect(page.card.innerHTML).toContain('tchap_reauthorization_required');
    expect(page.card.innerHTML).toContain('Sign in again');
  });

  it('shows a pending sign-in code', async () => {
    const page = mount({ ok: true, phase: 'signin_pending', pending: { userCode: 'ABCD-1234', verificationUri: 'https://auth.example/link' } });
    await page.render();
    expect(page.card.innerHTML).toContain('Sign-in pending');
    expect(page.card.innerHTML).toContain('ABCD-1234');
  });

  it('acts through a Donna turn in agent mode, never a direct tool call', async () => {
    const page = mount({ ok: true, phase: 'no_forum', account: '@me:agent.example' });
    await page.render();
    page.attach();
    expect(page.submitted).toEqual(['Connect Tchap: list my Tchap forums and attach the one I choose to this workspace.']);
    expect(page.calls.map(([name]) => name)).toEqual(['connectors_tchap_status']);
    expect(TCHAP_CARD_SCRIPT).not.toContain('connectors_tchap_connect');
  });

  it('has its section in the Connectors view and is rendered when the view opens', () => {
    expect(CHAT_HTML).toContain('id="tchap-section" hidden');
    expect(CHAT_HTML).toContain('window.renderTchapCard=async function');
    expect(CHAT_HTML).toContain('  renderTchapCard();');
    expect(CHAT_HTML).toContain('function submitAgentSuggestion(text, {hideQuestion=false}={}) {');
  });
});
