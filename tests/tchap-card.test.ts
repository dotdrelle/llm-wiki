import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import { AGENT_CONNECTORS_CARD_SCRIPT } from '../src/chat/runtime/agentConnectorsCardScript.ts';

type FakeNode = { innerHTML: string };

/**
 * Run the connectors card script against its host and its two status slots,
 * with scripted `connectors_*_status` answers. The card always renders: a
 * broken or disconnected connector is a state to read, not a section to hide.
 */
function mount({
  tchap,
  google = { status: 'not_configured', ok: true },
  workspaceName = 'demo',
}: {
  tchap: unknown;
  google?: unknown;
  workspaceName?: string | null;
}) {
  const host: FakeNode = { innerHTML: '' };
  const googleSlot: FakeNode = { innerHTML: '' };
  const tchapSlot: FakeNode = { innerHTML: '' };
  const document = {
    head: { append: () => {} },
    createElement: () => ({ textContent: '' }),
    getElementById: (id: string) => (
      id === 'agent-connector-cards' ? host
        : id === 'agent-connector-google-status' ? googleSlot
          : id === 'agent-connector-tchap-status' ? tchapSlot
            : null
    ),
  };
  const calls: Array<[string, unknown]> = [];
  const commands: string[] = [];
  const agentTurns: string[] = [];
  const window: Record<string, unknown> = { __WIKI_CONFIG__: { workspaceName } };
  const callMCPTool = async (name: string, args: unknown) => {
    calls.push([name, args]);
    if (name === 'connectors_google_status') {
      if (google instanceof Error) throw google;
      return JSON.stringify(google);
    }
    if (tchap instanceof Error) throw tchap;
    return JSON.stringify(tchap);
  };
  const esc = (value: unknown) => String(value).replace(/</g, '&lt;');
  new Function(
    'document', 'window', 'callMCPTool', 'esc', 'submitSuggestion', 'submitAgentSuggestion',
    AGENT_CONNECTORS_CARD_SCRIPT,
  )(
    document, window, callMCPTool, esc,
    (text: string) => commands.push(text),
    (text: string) => agentTurns.push(text),
  );
  return {
    render: () => (window.renderAgentConnectorCards as () => Promise<void>)(),
    attach: () => (window.tchapAttachForum as () => void)(),
    detach: () => (window.tchapDetachForum as () => void)(),
    hostHtml: () => host.innerHTML,
    tchapHtml: () => tchapSlot.innerHTML,
    calls,
    commands,
    agentTurns,
  };
}

describe('Tchap card in the Connectors view', () => {
  it('renders an explicit state for every phase instead of leaving the slot empty', async () => {
    for (const [status, expected] of [
      [{ ok: true, phase: 'not_set_up' }, 'Not connected'],
      [{ ok: true, phase: 'disabled' }, 'Disabled'],
      [{ ok: true, phase: 'paused' }, 'Paused'],
    ] as const) {
      const page = mount({ tchap: status });
      await page.render();
      expect(page.tchapHtml()).toContain(expected);
    }
    const unreadable = mount({ tchap: { ok: false, error: 'connectors agent is down' } });
    await unreadable.render();
    expect(unreadable.tchapHtml()).toContain('Unavailable');
    expect(unreadable.tchapHtml()).toContain('connectors agent is down');
    expect(unreadable.tchapHtml()).toContain('Retry');
    // A thrown read is a failure to read, said plainly, once.
    const thrown = mount({ tchap: new Error('Unknown tool') });
    await thrown.render();
    expect(thrown.tchapHtml()).toContain('Unavailable');
    expect(thrown.tchapHtml()).toContain('Unknown tool');
    expect(thrown.calls.filter(([name]) => name === 'connectors_tchap_status')).toHaveLength(1);
    // An unknown phase is re-read once, then named rather than invented.
    const unknown = mount({ tchap: { ok: true, phase: 'weird' } });
    await unknown.render();
    expect(unknown.tchapHtml()).toContain('Unknown Tchap status phase: weird.');
    expect(unknown.calls.filter(([name]) => name === 'connectors_tchap_status')).toHaveLength(2);
  });

  it('shows the account, the forum and its state once signed in', async () => {
    const page = mount({
      tchap: {
        ok: true, phase: 'awaiting_activation', account: '@me:agent.example',
        forum: 'Donna-demo (#Donna-demo:agent.example)', allowedUsers: ['@me:agent.example'],
      },
    });
    await page.render();
    expect(page.tchapHtml()).toContain('Awaiting activation');
    expect(page.tchapHtml()).toContain('@me:agent.example');
    expect(page.tchapHtml()).toContain('Donna-demo (#Donna-demo:agent.example)');
    expect(page.tchapHtml()).toContain('Allowed');
    expect(page.tchapHtml()).toContain('Change forum');
    expect(page.tchapHtml()).toContain('Detach forum');
    expect(page.calls.filter(([name]) => name === 'connectors_tchap_status')).toEqual([
      ['connectors_tchap_status', { workspace: 'demo' }],
    ]);
  });

  it('attaches a forum through the connector authorization, never a direct tool call', async () => {
    const page = mount({ tchap: { ok: true, phase: 'no_forum', account: '@me:agent.example' } });
    await page.render();
    expect(page.tchapHtml()).toContain('No forum for this workspace');
    expect(page.tchapHtml()).toContain('Attach a forum');
    page.attach();
    expect(page.commands).toEqual(['/connector auth tchap']);
    expect(AGENT_CONNECTORS_CARD_SCRIPT).not.toContain('connectors_tchap_connect');
    expect(page.calls.every(([name]) => name.endsWith('_status'))).toBe(true);
  });

  it('detaches through a Donna turn, and never calls a mutating connector tool', async () => {
    const page = mount({ tchap: { ok: true, phase: 'active', forum: 'Donna-demo (#Donna-demo:agent.example)' } });
    await page.render();
    expect(page.tchapHtml()).toContain('Connected');
    page.detach();
    expect(page.agentTurns).toEqual(['Detach this workspace from its Tchap forum.']);
    expect(AGENT_CONNECTORS_CARD_SCRIPT).not.toContain('connectors_tchap_disconnect');
  });

  it('shows the sign-in link and code while a sign-in is pending, with no actions', async () => {
    const page = mount({
      tchap: {
        ok: true, phase: 'signin_pending',
        pending: { verificationUri: 'https://tchap.example/device', userCode: 'ABCD-1234' },
      },
    });
    await page.render();
    expect(page.tchapHtml()).toContain('Sign-in pending');
    expect(page.tchapHtml()).toContain('https://tchap.example/device');
    expect(page.tchapHtml()).toContain('ABCD-1234');
    expect(page.tchapHtml()).not.toContain('<button');
  });

  it('keeps the forum of a stopped bridge so signing in again targets the same room', async () => {
    const page = mount({
      tchap: {
        ok: true, phase: 'signed_out', roomId: '#Donna-demo:agent.example',
        forum: 'Donna-demo (#Donna-demo:agent.example)',
      },
    });
    await page.render();
    expect(page.tchapHtml()).toContain('Not signed in');
    expect(page.tchapHtml()).toContain('The bridge is stopped until you sign in again.');
    expect(page.tchapHtml()).toContain('Connect Tchap');
    page.attach();
    expect(page.commands).toEqual(['/connector auth tchap #Donna-demo:agent.example']);
  });

  it('asks for a workspace instead of guessing one', async () => {
    const page = mount({ tchap: { ok: true, phase: 'active' }, workspaceName: null });
    await page.render();
    expect(page.hostHtml()).toContain('No workspace');
    expect(page.calls).toEqual([]);
  });

  it('has its section in the Connectors view and is rendered when the view opens', () => {
    expect(CHAT_HTML).toContain('class="agent-connector-grid" id="agent-connector-cards"');
    expect(CHAT_HTML).toContain('window.renderAgentConnectorCards=async function');
    expect(CHAT_HTML).toContain("/chat/connectors') renderAgentConnectorCards();");
    expect(CHAT_HTML).toContain('onclick="renderAgentConnectorCards()"');
    expect(CHAT_HTML).toContain('window.tchapDetachForum=()=>submitAgentSuggestion(');
    expect(CHAT_HTML).toContain('function submitAgentSuggestion(text, {hideQuestion=false}={}) {');
  });
});
