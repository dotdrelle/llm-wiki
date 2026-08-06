import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { CONFIG_SCRIPT } from '../src/chat/config/configScript.ts';
import { CHAT_MARKUP } from '../src/chat/views/chatView.ts';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';

const CHAT_SCRIPT = CHAT_HTML;

/*
 These scripts ship to the browser as strings: no typecheck, no DOM here.
 Assertions therefore target the source, and stay narrow — one per
 invariant, named after the symptom it keeps from coming back.
*/

describe('LLM profile switching', () => {
  it('reconnects MCP servers instead of only redrawing them', () => {
    // loadServers() rebuilds the cards with status 'off' and no session.
    // Without restoreEnabledServers(), a profile switch left every MCP
    // disconnected: the badges still showed the tool count from the
    // previous handshake while /chat had nothing left to call, and only a
    // page reload restored the situation.
    const body = CONFIG_SCRIPT.slice(
      CONFIG_SCRIPT.indexOf('async function switchConfigProfile'),
      CONFIG_SCRIPT.indexOf('// ── LocalStorage'),
    );
    assert.ok(body.length > 0, 'switchConfigProfile must exist');
    assert.match(body, /loadServers\(\);/);
    assert.match(body, /await restoreEnabledServers\(\);/);
    assert.ok(
      body.indexOf('loadServers();') < body.indexOf('await restoreEnabledServers();'),
      'reconnection must follow card reconstruction',
    );
  });
});

describe('LLM config reset', () => {
  const body = CONFIG_SCRIPT.slice(
    CONFIG_SCRIPT.indexOf('async function resetYamlConfig'),
    CONFIG_SCRIPT.indexOf('function applyServerConfig'),
  );

  it('replays the active profile when the runtime allows it', () => {
    // The workaround found in QA — creating a second .wikirc and switching
    // to it — worked because switching goes through the server-side
    // authoritative path. Reset borrows the same one.
    assert.match(body, /await switchConfigProfile\(activeProfile\)/);
    assert.match(body, /runtime\?\.enabled/);
  });

  it('reconnects and probes, even without a runtime', () => {
    assert.match(body, /await restoreEnabledServers\(\);/);
    assert.equal((body.match(/await probeLlmEndpoint\(\)/g) ?? []).length, 2);
  });

  it('says what the probe answers instead of staying silent', () => {
    // Rewriting the fields without checking anything made an unreachable
    // workspace look fixed: the same screen as a healthy workspace.
    const probe = CONFIG_SCRIPT.slice(CONFIG_SCRIPT.indexOf('async function probeLlmEndpoint'));
    assert.match(probe, /\/api\/llm\/probe/);
    assert.match(probe, /data\?\.ok===false/);
    assert.match(probe, /data\?\.warning/);
  });
});

describe('temperature', () => {
  it('is gone from the panel', () => {
    assert.doesNotMatch(CHAT_MARKUP, /id="temperature"/);
    assert.doesNotMatch(CONFIG_SCRIPT, /\$\('temperature'\)/);
  });

  it('comes from the active profile, and is omitted when absent', () => {
    // Behind a gateway, some models refuse the parameter: not sending it is
    // the only correct answer, not an invented 0.7.
    assert.doesNotMatch(CONFIG_SCRIPT, /temperature:Number\(/);
  });
});

describe('runtime waiting bubble', () => {
  it('can never outlive a lost event', () => {
    // "Request received · Donna is preparing…" with spinning dots stayed on
    // screen indefinitely whenever a turn published no assistant message.
    // The cause was fixed on the runtime side; this is the safety net.
    assert.match(CHAT_SCRIPT, /const RUNTIME_THINKING_TIMEOUT_MS=\d+/);
    assert.match(CHAT_SCRIPT, /No response received from the runtime after/);
  });

  it('cancels its timer wherever it disappears', () => {
    // A safety net that outlives what it watches would lay an error message
    // over a reply that already arrived.
    assert.doesNotMatch(CHAT_SCRIPT, /pendingRuntimeStatusEls\.shift\(\)\?\.remove\(\)/);
    assert.doesNotMatch(CHAT_SCRIPT, /\n\s+statusEl\.remove\(\);/);
    assert.match(CHAT_SCRIPT, /function clearRuntimeThinkingBubble\(div\)/);
    assert.match(CHAT_SCRIPT, /clearTimeout\(div\._runtimeTimeout\)/);
  });
});
