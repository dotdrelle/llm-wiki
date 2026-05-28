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

  it('does not auto-open production panel on tool results', () => {
    const [script] = chatScripts();

    expect(script).toContain('updateProductionFromPayload(data,{open:false,poll:false});');
    expect(script).toContain(
      'updateProductionFromPayload(data,{open:false,poll:!productionTerminal(data.job?.status)});',
    );
  });

  it('finalizes streaming bubbles on abort or errors', () => {
    const [script] = chatScripts();

    expect(script).toContain('let streamFinalized=false;');
    expect(script).toContain('message=[parsed.error,parsed.hint].filter(Boolean).join');
    expect(script).toContain("streamAbortController?.signal.aborted ? 'Réponse arrêtée.' : ''");
    expect(script).toContain('setStreamContent(streamDiv,finalText);');
  });

  it('persists clear chat to the active history entry', () => {
    const [script] = chatScripts();

    expect(script).toContain('async function clearChat()');
    expect(script).toContain('clearChatSeq++;');
    expect(script).toContain('if(streamClearSeq!==clearChatSeq) return;');
    expect(script).toContain("messages:[],");
    expect(script).toContain("messageHtml:'',");
    expect(script).toContain('await persistConversationPayload({');
  });

  it('confirms before deleting a connector', () => {
    const [script] = chatScripts();

    expect(script).toContain("if(!confirm('Supprimer ce connecteur ?')) return;");
  });

  it('summarizes production job terminal output and produced files', () => {
    const [script] = chatScripts();

    expect(script).toContain('Fichiers produits');
    expect(script).toContain('Production ${esc(productionStatusLabel(status))}');
    expect(script).toContain('<summary>Console</summary>');
  });

  it('supports runtime llm overrides and yaml reset', () => {
    const [script] = chatScripts();

    expect(script).toContain('function buildProxyLLMHeaders()');
    expect(script).toContain("h['X-LLM-Wiki-LLM-Base-Url']=baseUrl;");
    expect(script).toContain('async function resetYamlConfig()');
    expect(script).toContain("fetch('/api/llm-config',{cache:'no-store'})");
  });

  it('summarizes multiple production jobs', () => {
    const [script] = chatScripts();

    expect(script).toContain("job${data.jobs.length>1?'s':''} production");
    expect(script).toContain("if(data?.jobs && Array.isArray(data.jobs))");
  });

  it('reconnects stale MCP sessions before retrying tool calls', () => {
    const [script] = chatScripts();

    expect(script).toContain('function isMcpSessionOrNetworkFailure');
    expect(script).toContain('async function reconnectMCPServer(server)');
    expect(script).toContain("notify(`${server.name} : reconnexion MCP...`);");
    expect(script).toContain("resp = await mcpRPC(server, 'tools/call', {name, arguments: args});");
  });

  it('stops LLM chaining after production-only tool calls', () => {
    const [script] = chatScripts();

    expect(script).toContain('function productionToolSummary(toolResults)');
    expect(script).toContain("tcWithIdx.every(tc=>String(tc.function?.name||'').startsWith('production_'))");
    expect(script).toContain('const summary=productionToolSummary(toolResults);');
    expect(script).toContain('Le suivi continue dans le panneau Production.');
  });

  it('does not replay stale tool messages before a new user turn', () => {
    const [script] = chatScripts();

    expect(script).toContain('const preserveTailToolExchange=lastToolAssistantIndex>=0');
    expect(script).toContain("sourceMessages.slice(lastToolAssistantIndex+1).every((msg)=>msg.role==='tool')");
    expect(script).toContain("if(msg.role==='tool')");
    expect(script).toContain('idx>=preserveFrom');
  });

  it('posts a chat message when a production job reaches a terminal state', () => {
    const [script] = chatScripts();

    expect(script).toContain('notifiedTerminalJobIds: new Set()');
    expect(script).toContain('async function notifyProductionTerminalInChat()');
    expect(script).toContain('Production terminée');
    expect(script).toContain('Fichiers produits:');
    expect(script).toContain('if(productionTerminal(productionState.job?.status)) await notifyProductionTerminalInChat();');
  });

  it('lets long production progress labels wrap instead of truncating early', () => {
    expect(CHAT_HTML).toContain('.prod-progress-top{display:flex;align-items:flex-start;');
    expect(CHAT_HTML).toContain('.prod-progress-label{min-width:0;flex:1;');
    expect(CHAT_HTML).toContain('overflow-wrap:anywhere');
    expect(CHAT_HTML).not.toContain('.prod-progress-label{min-width:0;font-size:12px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
  });
});
