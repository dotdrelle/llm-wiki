import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import packageJson from '../package.json' with { type: 'json' };

function chatScripts(): string[] {
  const scripts = [...CHAT_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  );
  const mainIndex = scripts.findIndex((script) => script.includes('let servers = [];'));
  if (mainIndex > 0) scripts.unshift(...scripts.splice(mainIndex, 1));
  return scripts;
}

describe('chat html', () => {
  it('embeds syntactically valid scripts', () => {
    const scripts = chatScripts();

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new vm.Script(script)).not.toThrow();
    }
  });

  it('shares the selected color theme with the graph', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('id="theme-toggle"');
    expect(script).toContain("const THEME_KEY='llm-wiki:theme';");
    expect(script).toContain("localStorage.getItem('llm-wiki:graph:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')");
    expect(script).toContain('event.key===THEME_KEY&&event.newValue');
    expect(script).toContain("document.documentElement.classList.toggle('theme-dark'");
  });

  it('keeps production updates inside the trace chain', () => {
    const [script] = chatScripts();

    expect(script).toContain('updateProductionFromPayload(data,{open:false,poll:false});');
    expect(script).toContain(
      'updateProductionFromPayload(data,{open:false,poll:!recover && !productionTerminal(data.job?.status)});',
    );
    expect(script).toContain('function renderProductionTrace()');
    expect(script).not.toContain('function renderProductionPanel()');
  });

  it('renders runtime log filters without hard tail slicing', () => {
    const [script] = chatScripts();

    expect(script).toContain('function filteredRuntimeLogs(logs)');
    expect(script).toContain('placeholder="Filter run group task agent file attempt capability error"');
    expect(script).toContain('const logs=filteredRuntimeLogs(runtimeState.logs);');
    expect(script).toContain('const logs=filteredRuntimeLogs(runtimeState?.logs);');
    expect(script).not.toContain('runtimeState.logs.slice(-5)');
    expect(script).not.toContain('runtimeState.logs.slice(-6)');
    expect(script).not.toContain('runtimeState.logs.slice(-8)');
  });

  it('finalizes streaming bubbles on abort or errors', () => {
    const [script] = chatScripts();

    expect(script).toContain('let streamFinalized=false;');
    expect(script).toContain('const normalize=(value)=>');
    expect(script).toContain('message=[normalize(parsed.error),normalize(parsed.hint)].filter(Boolean).join');
    expect(script).toContain('Chat server unreachable. Check that the wiki server is running.');
    expect(script).toContain('LLM unreachable. Check that the LLM service is running and the Base URL is reachable.');
    expect(script).toContain('Invalid LLM configuration. Check the Base URL in chat settings.');
    expect(script).toContain("const partial=streamDiv.dataset.copy || 'Response stopped.';");
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
    expect(script).toContain('let runtimeConversationOffset=null;');
    expect(script).toContain('runtimeConversationOffset=Array.isArray(runtimeState?.conversation)');
    expect(script).toContain('const visibleLength=conversation.length-runtimeConversationOffset;');
  });

  it('renders a durable assistant error when a runtime LLM turn fails', () => {
    const [script] = chatScripts();

    expect(script).toContain('No LLM response:');
    expect(script).toContain('pendingRuntimeUserRefs.splice(pendingIndex,1)');
    expect(script).toContain("messages.push({role:'assistant',content:errorText})");
    expect(script).toContain('await saveCurrentConversation({immediate:true})');
  });

  it('confirms before deleting a connector', () => {
    const [script] = chatScripts();

    expect(script).toContain("if(!confirm('Delete this connector?')) return;");
  });

  it('keeps production tool result cards compact', () => {
    const [script] = chatScripts();

    expect(script).toContain('Production ${esc(productionStatusLabel(status))}');
    expect(script).toContain('Details, logs and timing in agent orchestration.');
    expect(script).toContain('produced file');
    expect(script).toContain('const produced=Array.isArray(job.producedFiles)');
    expect(script).not.toContain('<summary>Console</summary>');
  });

  it('renders generic JSON results as structured cards', () => {
    const [script] = chatScripts();

    expect(script).toContain("function genericJsonSummaryHTML(data, raw, toolName='MCP')");
    expect(script).toContain('function genericJsonTableHTML(rows)');
    expect(script).toContain('function genericJsonObjectHTML(obj)');
    expect(script).toContain('function genericJsonArraySectionHTML(key, rows)');
    expect(script).toContain('const arrayEntries=entries.filter(([,value])=>Array.isArray(value));');
    expect(script).toContain('function productionTemplatesSummaryHTML(data, raw)');
    expect(script).toContain('const productionTemplates=productionTemplatesSummaryHTML(data, raw);');
    expect(script).toContain('Unmatched deliverables');
    expect(script).toContain('tc-json-table');
    expect(script).toContain('Structured result');
  });

  it('wraps and constrains preformatted tool summaries', () => {
    expect(CHAT_HTML).toContain('.tc-body pre,.tc-summary pre{');
    expect(CHAT_HTML).toContain('white-space:pre-wrap;word-break:break-word;');
    expect(CHAT_HTML).toContain('max-height:220px;overflow:auto');
    expect(CHAT_HTML).toContain('.tc-summary{display:flex;flex-direction:column;gap:8px;min-width:0}');
  });

  it('routes document uploads to the activity panel', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('#activity-panel{');
    expect(CHAT_HTML).toContain('.act-card{');
    expect(script).toContain('function uploadDocumentRequest(form,onUploaded)');
    expect(script).toContain('function upsertActivity(item)');
    expect(script).toContain('function renderActivities()');
    expect(script).toContain("kind:'upload'");
    expect(script).toContain("const ACT_STORE_KEY=storageKey('llm-wiki-chat:activities');");
    expect(script).toContain("upsertActivity({id:actId,phase:'conversion'});");
    expect(script).toContain("function isActivityActive(status){return status==='running'||status==='queued';}");
    expect(script).toContain("if(!isActivityActive(item.status)) return item;");
    expect(CHAT_HTML).toContain('#activity-panel{order:2;width:360px;min-width:360px;height:100vh;');
    expect(script).not.toContain('function buildUploadCardHTML');
    expect(script).not.toContain('function buildUploadResultCardHTML');
    expect(script).not.toContain("actElapsed(item)<2");
  });

  it('exposes runtime activity list and graph views backed by workflow data', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('id="act-view-list"');
    expect(CHAT_HTML).toContain('id="act-view-graph"');
    expect(CHAT_HTML).toContain('id="execution-view"');
    expect(CHAT_HTML).toContain('id="runtime-graph-center"');
    expect(CHAT_HTML).toContain('body.execution-mode #execution-view{display:flex}');
    expect(CHAT_HTML).toContain('<script src="/assets/d3.min.js"></script>');
    expect(script).toContain('function runtimeWorkflowGraphData()');
    expect(script).toContain('runtimeState?.workflow||{}');
    expect(script).toContain('function renderRuntimeWorkflowGraph()');
    expect(script).toContain('function renderRuntimeWorkflowInspector()');
    expect(script).toContain('function showExecutionView(event)');
    expect(script).toContain("if(activityView==='graph')");
  });

  it('keeps the right rail on the document edge and opens one side panel after it', () => {
    expect(CHAT_HTML).toContain('id="activity-panel"');
    expect(CHAT_HTML).toContain('id="help-panel"');
    expect(CHAT_HTML).toContain('#right-rail{order:3;');
    expect(CHAT_HTML).toContain('#help-panel{order:2;');
    expect(CHAT_HTML).toContain('#help-panel{order:2;width:360px;min-width:360px;height:100vh;');
    expect(CHAT_HTML).toContain('#help-panel.closed{width:0;min-width:0}');
    expect(CHAT_HTML).toContain("if(wasClosed) $('activity-panel')?.classList.add('closed');");
    expect(CHAT_HTML).toContain("if(panel.classList.contains('closed')) $('help-panel')?.classList.add('closed');");
  });

  it('scrolls a long expanded plan without compressing initial synthesis', () => {
    expect(CHAT_HTML).toContain('.act-body>*{flex-shrink:0}');
    expect(CHAT_HTML).toContain('.act-body{flex:1;overflow-y:auto;');
  });

  it('splits Activity List into four internally scrollable sub-tabs', () => {
    expect(CHAT_HTML).toContain("const labels={plan:'Plan',local:'Direct agents',runtime:'Runtime activity',logs:'Logs'}");
    expect(CHAT_HTML).toContain('.activity-subtab-content{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain');
    expect(CHAT_HTML).toContain("function setActivityListTab(tab)");
    expect(CHAT_HTML).toContain('.activity-subtab-logs .runtime-log{flex:1;min-height:0;max-height:none}');
    expect(CHAT_HTML).not.toContain('runtime-section-toggle');
    expect(CHAT_HTML).toContain('onclick="clearActivityTab(\'${activityListTab}\')">Clear</button>');
    expect(CHAT_HTML).toContain('onclick="clearAllActivityTabs()"');
    expect(CHAT_HTML).toContain("['plan','local','runtime','logs'].forEach(tab=>clearActivityTab(tab,{render:false}))");
    expect(CHAT_HTML).toContain('onclick="resetRuntimePlan()">Reset plan</button>');
    expect(CHAT_HTML).toContain("fetch('/api/runtime/reset',{method:'POST'})");
  });

  it('sends Activity status through Donna while displaying a concise chat prompt', () => {
    const script = chatScripts().join('\n');
    expect(script).toContain("input.dataset.displayText=display;");
    expect(script).toContain("input.dataset.forceChat='1';");
    expect(script).toContain("input.dataset.hideQuestion='1';");
    expect(script).toContain('Présente clairement le statut de la cible');
    expect(script).toContain("sendRuntimeAgentMessage(input,text,{mode:'chat',displayText:displayOverride||text,hideQuestion})");
    expect(script).toContain("if(hideQuestion) userEl.classList.add('msg-hidden')");
    expect(script).not.toContain("messages.push({role:'assistant',content:answer})");
  });

  it('focuses PLAN and runtime activity status requests on their selected item', () => {
    const script = chatScripts().join('\n');
    expect(script).toContain("focusedPlan=plan.find(item=>matches(item,['id','step','description','label']))");
    expect(script).toContain("focusedActivity=activities.find(item=>matches(item,['id','key','label','tool']))");
    expect(script).toContain("focusedKind=focusedPlan?'Plan task':focusedActivity?'Runtime activity'");
    expect(script).toContain('Commence par cette tâche ou activité précise');
  });

  it('always resets the Activity panel to List when leaving Execution view for Chat', () => {
    const [script] = chatScripts();
    const showChatViewSource = script.match(/function showChatView\(\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';

    // Regression: entering Execution view forces activityView='graph' in
    // memory, but showChatView() never reset it nor re-rendered — the
    // Activity panel kept showing its execution-mode graph+inspector layout
    // squeezed into the normal sidebar after clicking back to Chat.
    expect(showChatViewSource).toContain("activityView='list';");
    expect(showChatViewSource).toContain('renderActivities();');
    // The List/Graph choice must never survive a page reload either — it
    // used to be read back from localStorage on init, which left a 'graph'
    // pick from a previous session silently reopening as the cramped inline
    // graph+inspector layout on every subsequent load.
    expect(script).not.toContain('ACT_VIEW_KEY');
    expect(script).toContain("let activityView='list';");
  });

  it('boots the root shell with the wiki index in the central frame', () => {
    const script = chatScripts().join('\n');
    expect(script).toContain("(path === '/' || location.hash.startsWith('#wiki='))");
    expect(script).toContain("setCenterWiki(wikiHashPath() || '/')");
    expect(script).toContain("if (loadedPath !== target) frame.setAttribute('src', target)");
  });

  it('shows the central wiki frame for sidebar-driven graph navigation', () => {
    const script = chatScripts().join('\n');
    expect(script).toContain("data.type === 'llmwiki:navigate'");
    expect(script).toContain('setCenterWiki(href);');
  });

  it('keeps the three right rail controls aligned at the top in wiki mode', () => {
    expect(CHAT_HTML).toContain('body.center-wiki #right-rail{padding-top:10px}');
  });

  it('ships one shell-level command palette fed by /api/pages', () => {
    expect(CHAT_HTML).toContain('id="cmdk-backdrop"');
    const [script] = chatScripts();
    expect(script).toContain("fetch('/api/pages')");
    expect(script).toContain("if (item.type === 'conv') { loadConversation(item.id); return; }");
    expect(script).toContain("data.type === 'llmwiki:palette'");
  });

  it('lays out the split view as a wiki|resizer|chat grid gated on center-wiki', () => {
    expect(CHAT_HTML).toContain('body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #main{display:grid');
    expect(CHAT_HTML).toContain('id="wiki-split-resizer"');
    expect(CHAT_HTML).toContain('onclick="toggleSplitWiki()"');
    expect(CHAT_HTML).toContain('body.iframe-drag iframe{pointer-events:none}');
    const [script] = chatScripts();
    expect(script).toContain("shellStore(SHELL_SPLIT_KEY, splitWikiEnabled() ? '0' : '1');");
    expect(script).toContain('if (splitWikiEnabled() && window.innerWidth >= 900');
  });

  it('applies the saved or system theme before iframe and shell paint', () => {
    expect(CHAT_HTML).toContain("matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'");
    expect(CHAT_HTML).toContain('#wiki-view iframe{display:block;width:100%;height:100%;border:0;background:var(--bg)}');
    expect(CHAT_HTML).toContain('#wiki-side-host iframe{display:block;width:100%;height:100%;border:0;background:var(--bg)}');
  });

  it('renders draggable colored workflow bubbles with fit zoom and a relation legend', () => {
    const [script] = chatScripts();

    expect(script).toContain('bubble.style.fill=runtimeWorkflowColor(node)');
    expect(script).not.toContain("setAttribute('fill',runtimeWorkflowColor");
    expect(script).toContain('window.d3.drag()');
    expect(script).toContain(".on('drag',event=>");
    expect(script).toContain('window.d3.zoom().scaleExtent([.25,3])');
    expect(script).toContain('runtimeWorkflowZoomTransform=event.transform');
    expect(script).toContain('runtimeWorkflowZoomTransform||(nodes.length?runtimeWorkflowFitTransform(nodes):null)');
    expect(script).toContain('function computeRuntimeWorkflowLayeredLayout(nodes,relations)');
    expect(script).toContain('function aggregateRuntimeWorkflowNodes(nodes,relations)');
    expect(script).toContain('runtimeWorkflowUserSelected?selectedWorkflowNodeId:null');
    expect(script).toContain('runtimeWorkflowLabelPrefix(nodes)');
    expect(script).toContain("setAttribute('class','runtime-graph-lane')");
    expect(CHAT_HTML).toContain('.runtime-graph-lane{');
    expect(CHAT_HTML).toContain('class="runtime-graph-legend"');
    expect(CHAT_HTML).toContain('Other / cancelled');
    expect(CHAT_HTML).toContain('Running / task');
    expect(CHAT_HTML).toContain('.runtime-graph-node circle{stroke:var(--panel);stroke-width:3;');
    expect(CHAT_HTML).toContain('onclick="resetRuntimeWorkflowGraph()"');
    expect(CHAT_HTML).toContain('onclick="fitRuntimeWorkflowGraph()"');
    expect(CHAT_HTML).toContain('runtimeWorkflowNodePositions.set(node.id');
  });

  it('offers runtime-backed config profile switching without page reload', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('id="profile-picker"');
    expect(CHAT_HTML).toContain('/api/config/profiles');
    expect(CHAT_HTML).toContain('/api/config/use');
    expect(script).toContain('function loadConfigProfiles()');
    expect(script).toContain('function switchConfigProfile(profile)');
    expect(script).toContain('applyServerConfig(data.config)');
    expect(script).not.toContain('window.location.reload()');
  });

  it('places the profile picker in the sidebar next to Reset, showing only the profile name', () => {
    const [script] = chatScripts();

    // Lives in the LLM section header, alongside Reset — not the topbar.
    expect(CHAT_HTML).toContain(
      '<div class="sec-label">LLM<div class="sec-label-actions"><select class="tb-profile-select" id="profile-picker"',
    );
    expect(CHAT_HTML).not.toContain('id="profile-picker-wrap"');
    // The backing .wikirc file is a hover title, not part of the visible option label.
    expect(script).toContain(
      "select.innerHTML=profiles.map(profile=>`<option value=\"${esc(profile.name)}\"${profile.fileName?` title=\"${esc(profile.fileName)}\"`:''}>${esc(profile.name)}</option>`).join('');",
    );
  });

  it('never lets a stale local override win over the active .wikirc profile config', () => {
    const [script] = chatScripts();
    const loadConfigSource = script.match(/function loadConfig\(\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';

    // Regression: this used to unconditionally re-apply localStorage's saved
    // values *after* setting fields from window.__WIKI_CONFIG__ (the active
    // profile), even in proxy mode — silently reverting to a stale
    // baseUrl/apiKey/model that buildProxyLLMHeaders() would then send as an
    // override header, hijacking the actual outbound LLM request regardless
    // of which profile was selected.
    const wcBranch = loadConfigSource.match(/if \(wc\) \{([\s\S]*?)\} else \{/)?.[1] ?? '';
    expect(wcBranch).not.toContain('saved.');
    // Guards against the duplicated post-if/else block reappearing: each of
    // these reads must appear exactly once (inside the else/CLI-mode branch),
    // not a second time unconditionally after the if/else. A count check is
    // robust to reformatting, unlike slicing on an exact brace/indent pattern.
    for (const line of [
      "if (saved.baseUrl) $('base-url').value = saved.baseUrl;",
      "if (saved.apiKey)  { $('api-key').value = saved.apiKey; flashSaved('llm-saved'); }",
      "if (saved.model)   $('model-name').value = saved.model;",
      "if (saved.temp !== undefined) $('temperature').value = saved.temp;",
    ]) {
      expect(loadConfigSource.split(line).length - 1).toBe(1);
    }
  });

  it('clears any stale local LLM override when a profile switch succeeds', () => {
    const [script] = chatScripts();
    const switchSource = script.match(/async function switchConfigProfile\(profile\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';

    expect(switchSource).toContain("localStorage.removeItem(storageKey('mcpchat_config'));");
  });

  it('handles explicit profile updates before chat or agent runtime routing', () => {
    expect(CHAT_HTML).toContain('tryProfilePreferenceUpdate(input,text)');
    expect(CHAT_HTML).toContain('/api/profile/preference');
    expect(CHAT_HTML.indexOf('tryProfilePreferenceUpdate(input,text)')).toBeLessThan(
      CHAT_HTML.indexOf('if(agentMode&&!forceChat)'),
    );
  });

  it('offers setup discovery from the empty chat and activity panel', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('Help &amp; documentation');
    expect(CHAT_HTML).toContain('Fill workspace profile');
    expect(CHAT_HTML).not.toContain('Get contextual tips');
    expect(CHAT_HTML).toContain('onclick="toggleHelpPanel()"');
    expect(CHAT_HTML).not.toContain('getTipsPrompt');
    // Both remaining tiles are regular grid cells so they sit side by side on
    // one row (no full-width 'wide' tile pushing one to its own line).
    expect(CHAT_HTML).not.toContain('empty-tile wide');
    expect(CHAT_HTML).toContain('id="help-panel"');
    expect(script).not.toContain('function maybeAutoStartGuide');
    expect(script).not.toContain("submitSuggestion('/guide')");
    expect(script).not.toContain('function applySetupGuideHighlight');
    expect(script).toContain('function applyWorkspaceTitle');
    expect(script).toContain('const label = String(wsName).toUpperCase();');
    expect(script).not.toContain('Donna (\\${wsName})');
    expect(script).toContain('function toggleHelpPanel');
    expect(script).not.toContain('function getTipsPrompt');
  });

  it('tracks actionable and asynchronous MCP calls in the activity panel', () => {
    const [script] = chatScripts();

    expect(script).toContain('function shouldTrackMcpTool(tool,server=null)');
    expect(script).toContain('definition?.annotations?.readOnlyHint===false');
    expect(script).toContain('function ingestMcpActivityResult(tool,args,server,result');
    expect(script).toContain('const contract=data?._activity;');
    expect(script).toContain('function scheduleActivityPoll(item)');
    expect(script).toContain("callMCPTool(item.poll.tool,item.poll.args||{},{trackActivity:false})");
    expect(script).toContain("mailer_send_email:args.dryRun?");
    expect(script).toContain("cme_export_run:'Confluence export'");
    expect(script).toContain("production_start_job:'Production job'");
    expect(script).toContain('async function callMCPTool(name, args, {trackActivity=true}={})');
    expect(script).toContain('const seenMeta=new Set([cardTitle.trim().toLowerCase()]);');
    expect(script).toContain('if(!normalized||seenMeta.has(normalized)) return false;');
    expect(script).toContain("progress.throttling?.active?");
    expect(script).toContain("progress.processing?.instructionCount!=null");
  });

  it('keeps local chat conversational without sending MCP tools to the browser LLM loop', () => {
    const [script] = chatScripts();
    const sendSource = script.match(/async function sendMessage\(\) \{[\s\S]*?\n\}\n\nasync function sendRuntimeAgentMessage/)?.[0] ?? '';

    expect(CHAT_HTML).not.toContain('mcpClientScript');
    expect(script).toContain(
      `clientInfo: {name: 'WikiChatConnector', version: '${packageJson.version}'}`,
    );
    expect(script).toContain('function preferredServerNameForTool(name)');
    expect(script).toContain("const prefix=text.split('_',1)[0];");
    expect(script).toContain('if(prefix && servers.some(s=>s.name===prefix)) return prefix;');
    expect(script).toContain("const owner=servers.find(s=>s.name===preferred&&s.enabled&&s.status==='ok'&&s.tools.some(t=>t.name===name));");
    expect(sendSource).toContain('const reqBody={model,temperature:temp,messages:reqMessages};');
    expect(sendSource).not.toContain('tool_choice');
    expect(sendSource).not.toContain('toolsPayload');
    expect(sendSource).not.toContain('callMCPTool(fn,args)');
    expect(sendSource).not.toContain('while(turn<MAX_TURNS)');
    expect(script).not.toContain('delta.tool_calls');
    expect(script).not.toContain('tool_call_id');
    expect(script).not.toContain('tool_calls');
  });

  it('presents MCP calls as agent orchestration and records activities from agent contracts', () => {
    const [script] = chatScripts();

    expect(script).toContain("const title='Agent orchestration';");
    expect(script).not.toContain('MCP chain');
    expect(script).toContain('upsertActivity(activityFromContract(contract,{...existing,...fallback,id}));');
    const ingestSource = script.match(/function ingestMcpActivityResult\(tool,args,server,result,[\s\S]*?\n\}\nfunction scheduleActivityPoll/)?.[0] ?? '';
    expect(ingestSource).not.toContain('openActivityPanel();');
    const callSource = script.match(/async function callMCPTool\(name, args,[\s\S]*?\n\}\n\n\/\/ ── Active tools/)?.[0] ?? '';
    expect(callSource).not.toContain('openActivityPanel();');
  });

  it('uses a plain fallback when local chat returns no final text', () => {
    const [script] = chatScripts();
    const sendSource = script.match(/async function sendMessage\(\) \{[\s\S]*?\n\}\n\nasync function sendRuntimeAgentMessage/)?.[0] ?? '';

    expect(script).toContain('function toolResultsFallback(toolResults)');
    expect(script).toContain('const isProd=toolResults.every(r=>isProductionToolName(r.name));');
    expect(sendSource).toContain("const finalContent=String(content||'').trim() ? content : 'No response.';");
    expect(sendSource).not.toContain('toolResultsFallback(lastToolResults)');
    expect(sendSource).not.toContain('let lastToolResults=[];');
  });

  it('migrates saved injected MCP server aliases to current serve defaults', () => {
    const [script] = chatScripts();

    expect(script).toContain("sName.startsWith('agent-')");
    expect(script).toContain("sName.slice('agent-'.length)");
    expect(script).toContain('const sName=String(s?.name||');
    expect(script).toContain('const name = override ? override.name : s.name;');
    expect(script).toContain('if(seen.has(name)) { dirty=true; continue; }');
    expect(script).toContain('if(seen.has(s.name)) continue;');
    expect(script).toContain('if(dirty) saveServers();');
  });

  it('probes server-injected MCP connectors on startup', () => {
    const [script] = chatScripts();

    expect(script).toContain("injected:true, enabled:true, status:'off'");
    expect(script).toContain('enabled:override ? true : !!s.enabled');
    expect(script).toContain('servers.filter(s=>s.enabled)');
    expect(script).toContain('connectServer(server.id,{silent:true})');
    expect(script).toContain('async function connectServer(id,{silent=false}={})');
    expect(script).toContain('if(!silent) notify');
    expect(script).toContain('if(!silent) showErrModal');
  });

  it('uses a generic MCP presentation contract across activity, chain and chat', () => {
    const [script] = chatScripts();

    expect(script).toContain('function mcpToolDefinition(name, server=null)');
    expect(script).toContain('annotations?.readOnlyHint===true');
    expect(script).toContain('annotations?.readOnlyHint===false');
    expect(script).toContain('function mcpObjectCardHTML(toolName, data');
    expect(script).toContain("mcpObjectCardHTML(toolName||'MCP result',data,{raw})");
    expect(script).toContain('resultHtml:toolResultSummaryHTML(p.result,ok,p.name||step.title)');
    expect(script).toContain('sourceLabel:server.name');
    expect(script).not.toContain('publishAssistantOutput(observerToolLoopHTML(toolResults),statusDiv,{html:true,plainText:summary})');
    expect(script).not.toContain('publishAssistantOutput(observerToolLoopHTML([],true),statusDiv,{html:true,plainText:summary})');
  });

  it('accepts JSON returned directly, in a markdown fence or inside an MCP envelope', () => {
    const [script] = chatScripts();

    expect(script).toContain("const fenced=raw.match(/\\x60{3}(?:json)?\\s*([\\s\\S]*?)\\x60{3}/i);");
    expect(script).toContain("const startIndexes=[raw.indexOf('{'),raw.indexOf('[')]");
    expect(script).toContain('candidates.push(raw.slice(start,i+1));');

    const source = script.match(/function parseToolJSON\(result\) \{[\s\S]*?\n\}\n\nfunction shortText/)?.[0]
      .replace(/\n\nfunction shortText$/, '');
    expect(source).toBeTruthy();
    const context: Record<string, unknown> = {};
    vm.runInNewContext(`${source};this.parseToolJSON=parseToolJSON;`, context);
    const parseToolJSON = context.parseToolJSON as (value: string) => unknown;

    expect(parseToolJSON('{"status":"configured"}')).toEqual({ status: 'configured' });
    expect(parseToolJSON('```json\n{"status":"running"}\n```')).toEqual({ status: 'running' });
    expect(parseToolJSON('MCP result:\n{"status":"done"}\nEnd.')).toEqual({ status: 'done' });
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

    expect(script).toContain("production job${data.jobs.length>1?'s':''}");

    expect(script).toContain("if(data?.jobs && Array.isArray(data.jobs))");
  });

  it('reconnects stale MCP sessions before retrying tool calls', () => {
    const [script] = chatScripts();

    expect(script).toContain('function isMcpSessionOrNetworkFailure');
    expect(script).toContain('async function reconnectMCPServer(server)');
    expect(script).toContain('const MCP_STALE_SESSION_MS = 5 * 60 * 1000;');
    expect(script).toContain('const MCP_REQUEST_TIMEOUT_MS = 60 * 1000;');
    expect(script).toContain('function mcpSessionIsStale(server)');
    expect(script).toContain('if(mcpSessionIsStale(server))');
    expect(script).toContain("notify(`${server.name}: reconnecting MCP...`);");
    expect(script).toContain("resp = await mcpRPC(server, 'tools/call', {name, arguments: args});");
    expect(script).toContain('MCP timeout after');
  });

  it('keeps production summaries for runtime traces without local LLM chaining', () => {
    const [script] = chatScripts();
    const sendSource = script.match(/async function sendMessage\(\) \{[\s\S]*?\n\}\n\nasync function sendRuntimeAgentMessage/)?.[0] ?? '';

    expect(script).toContain('function productionToolSummary(toolResults)');
    expect(script).toContain('function handleProductionToolResult(fn, args, result, ok, {recover=false}={})');
    expect(script).toContain('if(!recover) pollProductionJob({immediate:true});');
    expect(script).toContain('poll:!recover && !productionTerminal(data.job?.status)');
    expect(script).toContain('function isProductionToolName(name)');
    expect(script).toContain('function shouldStopAfterProductionTools(toolCalls)');
    expect(script).toContain("'production_start_job'");
    expect(script).toContain("'production_job_status'");
    expect(script).not.toContain('function chatLanguageIsFrench()');
    expect(script).not.toContain('function chatText(en, fr)');
    expect(script).toContain('return productionTerminalChatSummary(latestJob);');
    expect(script).toContain('productionState.notifiedTerminalJobIds.add(jobId);');
    expect(sendSource).not.toContain('if(shouldStopAfterProductionTools(tcWithIdx))');
    expect(sendSource).not.toContain('const summary=productionToolSummary(toolResults);');
    expect(script).toContain('Tracking in agent orchestration.');
    expect(script).not.toContain("Le suivi est dans l\\'orchestration agentique.");
  });

  it('does not keep a browser-side LLM chaining limit', () => {
    const [script] = chatScripts();
    const sendSource = script.match(/async function sendMessage\(\) \{[\s\S]*?\n\}\n\nasync function sendRuntimeAgentMessage/)?.[0] ?? '';

    expect(sendSource).not.toContain('MAX_TURNS');
    expect(sendSource).not.toContain('completedWithoutLimit');
  });

  it('drops legacy tool messages before sending local chat context', () => {
    const [script] = chatScripts();

    expect(script).toContain('function requestMessagesForLLM(sourceMessages)');
    expect(script).toContain("if(msg.role==='assistant') return {role:'assistant',content:msg.content ?? ''};");
    expect(script).not.toContain('preserveTailToolExchange');
    expect(script).not.toContain("if(msg.role==='tool')");
    expect(script).not.toContain('tool_call_id');
    expect(script).not.toContain('tool_calls');
  });

  it('posts a chat message when a production job reaches a terminal state', () => {
    const [script] = chatScripts();

    expect(script).toContain('notifiedTerminalJobIds: new Set()');
    expect(script).toContain('async function notifyProductionTerminalInChat()');
    expect(script).toContain('Production completed');
    expect(script).toContain("messages.slice(-8).some(m=>m?.role==='assistant' && m?.content===summary)");
    expect(script).toContain('handleProductionToolResult(msg.name,{},msg.content,true,{recover:true});');
    expect(script).not.toContain('if(productionState.jobId && !productionTerminal(productionState.job?.status)) startProductionPolling();');
    expect(script).not.toContain('Fichiers produits:');
    expect(script).toContain('if(productionTerminal(productionState.job?.status)) await notifyProductionTerminalInChat();');
  });

  it('renders production details inline in the trace card', () => {
    expect(CHAT_HTML).toContain('.trace-flow{display:flex;align-items:stretch;gap:7px;row-gap:8px;flex-wrap:wrap;');
    expect(CHAT_HTML).toContain('.trace-v{margin-top:2px;font-size:12px;font-weight:800;color:var(--text);overflow-wrap:anywhere;white-space:normal}');
    expect(CHAT_HTML).toContain('.trace-detail-title{min-width:0;');
    expect(CHAT_HTML).toContain('.trace-tile.running,.trace-tile.done,.trace-tile.failed,.trace-tile.cancelled{padding-right:10px}');
    expect(CHAT_HTML).toContain(".trace-tile.running::before{content:'';position:absolute;top:-4px;right:7px;");
    expect(CHAT_HTML).toContain('overflow-wrap:anywhere');
    expect(CHAT_HTML).toContain('function toggleTraceStep(traceId, stepId)');
    expect(CHAT_HTML).not.toContain('production-drawer');
  });

  it('keeps chained tool output in a single trace card instead of stacked chat cards', () => {
    const [script] = chatScripts();
    const sendSource = script.match(/async function sendMessage\(\) \{[\s\S]*?\n\}\n\nasync function sendRuntimeAgentMessage/)?.[0] ?? '';

    expect(script).toContain('function dispatchChatAgentEvent(trace, type');
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'tool_call_started'");
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'tool_call_result'");
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'trace_step_upsert'");
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'run_summary'");
    expect(script).toContain('function removeStreamBubble(div)');
    expect(sendSource).not.toContain('removeStreamBubble(streamDiv);');
    expect(script).not.toContain("payload:{callId:tc.id,targetId:`tc-${domIdx}`,name:fn,ok:true,result:r");
    expect(script).toContain('const clickable=step.detail || step.resultHtml || step.targetId;');
    expect(script).toContain('if(step.detail || step.resultHtml)');
    expect(script).toContain('function hydrateTraceCard(card)');
    expect(script).toContain('productionState.trace=hydrateTraceCard(traceCards[traceCards.length-1]);');
    expect(script).toContain('function rememberTraceDetailState(trace)');
    expect(script).toContain('restoreTraceOpenDetails(detailWrap, selected?.openDetailIndexes);');
    expect(script).not.toContain('setStreamContent(streamDiv,content,tcBlocks);');
    expect(script).not.toContain('const tcBlocks=tcWithIdx.map');
  });

  it('drives serve trace state through agent events', () => {
    const [script] = chatScripts();
    const sendSource = script.match(/async function sendMessage\(\) \{[\s\S]*?\n\}\n\nasync function sendRuntimeAgentMessage/)?.[0] ?? '';

    expect(script).toContain('function createChatAgentProjection()');
    expect(script).toContain('function createChatAgentEvent(type');
    expect(script).toContain('function applyChatAgentEvent(state, event)');
    expect(script).toContain("if(event.type==='run_started')");
    expect(script).toContain('state.activities={};');
    expect(script).toContain("if(event.type==='activity_upserted')");
    expect(script).toContain("dispatchChatAgentEvent(trace,'trace_step_upsert'");
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'run_started'");
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'run_done'");
    expect(sendSource).not.toContain("dispatchChatAgentEvent(runTrace,'run_error'");
  });

  it('connects the activity panel to the manager runtime when configured', () => {
    const [script] = chatScripts();

    expect(script).toContain('let agentMode=false;');
    expect(script).not.toContain("storageKey('llm-wiki-chat:agent-mode')");
    expect(script).not.toContain('localStorage.setItem(AGENT_MODE_KEY');
    expect(script).toContain('function connectRuntimePanel()');
    expect(script).toContain("fetch('/api/runtime/state',{cache:'no-store'})");
    expect(script).toContain("new EventSource('/api/runtime/events')");
    expect(script).toContain('if(runtimeFetchPending) return;');
    expect(script).toContain("runningBeforeFetch&&!readOnlyChat?'/api/runtime/control':'/api/runtime/turn'");
    expect(script).toContain("if(data?.kind!=='turn')");
    expect(script).not.toContain('Runtime run accepted. Follow progress in Activity.');
    expect(script).toContain("fetch('/api/runtime/cancel'");
    expect(script).toContain('function toggleAgentMode()');
    expect(script).toContain("function runtimeTaskPanelHTML(view='plan')");
    expect(script).toContain('const workflowNodes=Array.isArray(runtimeState.workflow?.nodes)?runtimeState.workflow.nodes:null;');
    expect(script).toContain("const workflowTasks=workflowNodes?.filter(node=>node.type==='task')||null;");
    expect(script).toContain("const workflowActivities=workflowNodes?.filter(node=>node.type==='activity')||null;");
    expect(script).toContain("const workflowQueue=workflowNodes?.filter(node=>node.type==='queue')||null;");
    expect(script).toContain('const activitySummary=runtimeState.workflow?.activity||null;');
    expect(script).toContain('const activityLines=Array.isArray(activitySummary?.lines)?activitySummary.lines:[];');
    expect(script).toContain('const initialSynthesis=Array.isArray(activitySummary?.initialSynthesis)?activitySummary.initialSynthesis:[];');
    expect(script).toContain('const sourceNodes=Array.isArray(graph.visibleNodes)&&graph.visibleNodes.length?graph.visibleNodes:workflow.nodes;');
    expect(script).toContain("Runtime activity");
  });

  it('renders the active runtime run card with inspect and cancel controls', () => {
    const [script] = chatScripts();

    expect(script).toContain('function runtimeRunCardHTML(plan,activities,progress=null)');
    expect(script).toContain('Run — ${esc(title)}');
    expect(script).toContain('data-run-id="${esc(runId)}"');
    expect(script).toContain('data-turn-id="${esc(turnId)}"');
    expect(script).toContain('data-workspace="${esc(workspace)}"');
    expect(script).toContain('onclick="askRuntimeStatus(${jsArg(runId||title)})">Inspect</button>');
    expect(script).toContain('onclick="cancelRuntimeRun()">Cancel</button>');
    expect(script).toContain('const runCard=runtimeRunCardHTML(plan,activities,runtimeState.workflow?.progress);');
  });

  it('sends agent-mode messages through the runtime control lane while a run is active', () => {
    const [script] = chatScripts();

    expect(script).not.toContain("notify('Runtime is already running.'");
    expect(script).toContain("runningBeforeFetch&&!readOnlyChat?'/api/runtime/control':'/api/runtime/turn'");
    expect(script).toContain("body:runningBeforeFetch&&!readOnlyChat?controlBody:JSON.stringify({input:text,...(mode?{mode}:{}),...(openWikiPages.length?{context:{openWikiPages}}:{})})");
    expect(script).toContain("const readOnlyChat=mode==='chat'");
    expect(script).toContain("sendRuntimeAgentMessage(input,text,{mode:'chat',displayText:displayOverride||text,hideQuestion})");
    expect(script).toContain("function createRuntimeThinkingBubble(text='Request received · Donna is preparing the response and plan…')");
    expect(script).toContain("const statusEl=createRuntimeThinkingBubble(mode==='chat'?'Thinking...':undefined)");
    expect(script).toContain("if(role==='assistant'&&content&&pendingRuntimeStatusEls.length)");
    expect(script).toContain("data?.kind==='ambiguous'");
    expect(script).toContain('function handleSendButton()');
    expect(script).not.toContain('if(agentMode && runtimeIsRunning())');
    expect(script).toContain('function runtimeChoiceHTML(text, choices=[])');
    expect(script).toContain('function sendRuntimeControlChoice(intent,text)');
    expect(script).toContain("body:JSON.stringify({action:intent==='enqueue'?'enqueue':'message',intent,input:text})");
  });

  it('supports resizing the main sidebar split', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain(
      '#sidebar{width:var(--sidebar-w,300px);min-width:var(--sidebar-w,300px);',
    );
    expect(CHAT_HTML).toContain('#sidebar.collapsed{width:0;min-width:0}');
    expect(CHAT_HTML).toContain('.main-resizer{position:relative;width:6px;cursor:col-resize;');
    expect(CHAT_HTML).toContain('<div class="main-resizer" id="main-resizer">');
    expect(script).toContain("const MAIN_SPLIT_KEY = 'mcpchat_sidebar_width';");
    expect(script).toContain('function initMainSplitter()');
    expect(script).toContain('const setSidebarW=(width, persist=false)=>');
    expect(script).toContain('const clamped=Math.max(180, Math.min(width, window.innerWidth-320));');
    expect(script).toContain("sidebar.style.setProperty('--sidebar-w', clamped+'px');");
    expect(script).toContain('const move=e=>setSidebarW(e.clientX, true);');
    expect(script).toContain("localStorage.setItem(MAIN_SPLIT_KEY, String(Math.round(clamped)));");
    expect(script).toContain('initMainSplitter();');
  });

  it('can collapse and expand the Wiki/Donna sidebar', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('id="sidebar-toggle"');
    expect(CHAT_HTML).toContain('aria-label="Collapse left panel"');
    expect(CHAT_HTML).toContain('.sidebar-toggle{');
    expect(script).toContain("const SIDEBAR_OPEN_KEY = 'mcpchat_sidebar_open';");
    expect(script).toContain('function applySidebarOpen(open, persist=false)');
    expect(script).toContain("localStorage.getItem(SIDEBAR_OPEN_KEY)!=='0'");
    expect(script).toContain('function toggleSidebar() { applySidebarOpen(!sidebarOpen,true); }');
  });
});
