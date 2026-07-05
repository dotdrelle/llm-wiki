import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import packageJson from '../package.json' with { type: 'json' };

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

  it('keeps production updates inside the trace chain', () => {
    const [script] = chatScripts();

    expect(script).toContain('updateProductionFromPayload(data,{open:false,poll:false});');
    expect(script).toContain(
      'updateProductionFromPayload(data,{open:false,poll:!recover && !productionTerminal(data.job?.status)});',
    );
    expect(script).toContain('function renderProductionTrace()');
    expect(script).not.toContain('function renderProductionPanel()');
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
    expect(CHAT_HTML).toContain('height:calc(100vh - 44px);margin-top:44px;');
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
    expect(script).toContain("const ACT_VIEW_KEY=storageKey('llm-wiki-chat:activity-view');");
    expect(script).toContain('function runtimeWorkflowGraphData()');
    expect(script).toContain('runtimeState?.workflow||{}');
    expect(script).toContain('function renderRuntimeWorkflowGraph()');
    expect(script).toContain('function renderRuntimeWorkflowInspector()');
    expect(script).toContain('function showExecutionView(event)');
    expect(script).toContain("if(activityView==='graph')");
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

  it('offers setup discovery from the empty chat and activity panel', () => {
    const [script] = chatScripts();

    expect(CHAT_HTML).toContain('Start setup guide');
    expect(CHAT_HTML).toContain('Fill workspace profile');
    expect(CHAT_HTML).toContain('Get contextual tips');
    expect(CHAT_HTML).toContain("onclick=\"submitSuggestion('/guide')\"");
    expect(CHAT_HTML).toContain('onclick="submitSuggestion(getTipsPrompt())"');
    expect(CHAT_HTML).toContain('empty-tile wide');
    expect(script).not.toContain('function maybeAutoStartGuide');
    expect(script).toContain('function applyWorkspaceTitle');
    expect(script).toContain('function applySetupGuideHighlight');
    expect(script).toContain('function getTipsPrompt');
    expect(script).toContain('available read-only tools');
    expect(script).toContain('active connectors');
    expect(script).toContain('actual state you found');
    expect(script).toContain("submitSuggestion('/guide')");
    expect(script).toContain("tile.classList.toggle('needs-setup'");
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

    expect(script).toContain('function connectRuntimePanel()');
    expect(script).toContain("fetch('/api/runtime/state',{cache:'no-store'})");
    expect(script).toContain("new EventSource('/api/runtime/events')");
    expect(script).toContain('if(runtimeFetchPending) return;');
    expect(script).toContain("runningBeforeFetch?'/api/runtime/control':'/api/runtime/run'");
    expect(script).toContain("fetch('/api/runtime/cancel'");
    expect(script).toContain('function toggleAgentMode()');
    expect(script).toContain('function runtimeTaskPanelHTML()');
    expect(script).toContain('const workflowNodes=Array.isArray(runtimeState.workflow?.nodes)?runtimeState.workflow.nodes:null;');
    expect(script).toContain("const workflowTasks=workflowNodes?.filter(node=>node.type==='task')||null;");
    expect(script).toContain("const workflowActivities=workflowNodes?.filter(node=>node.type==='activity')||null;");
    expect(script).toContain("const workflowQueue=workflowNodes?.filter(node=>node.type==='queue')||null;");
    expect(script).toContain("Runtime activity");
  });

  it('renders the active runtime run card with inspect and cancel controls', () => {
    const [script] = chatScripts();

    expect(script).toContain('function runtimeRunCardHTML(plan,activities)');
    expect(script).toContain('Run — ${esc(title)}');
    expect(script).toContain('data-run-id="${esc(runId)}"');
    expect(script).toContain('data-turn-id="${esc(turnId)}"');
    expect(script).toContain('data-workspace="${esc(workspace)}"');
    expect(script).toContain('onclick="askRuntimeStatus(${jsArg(runId||title)})">Inspecter</button>');
    expect(script).toContain('onclick="cancelRuntimeRun()">Annuler</button>');
    expect(script).toContain('const runCard=runtimeRunCardHTML(plan,activities);');
  });

  it('sends agent-mode messages through the runtime control lane while a run is active', () => {
    const [script] = chatScripts();

    expect(script).not.toContain("notify('Runtime is already running.'");
    expect(script).toContain("runningBeforeFetch?'/api/runtime/control':'/api/runtime/run'");
    expect(script).toContain("body:runningBeforeFetch?controlBody:JSON.stringify({input:text})");
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
    expect(CHAT_HTML).toContain('.main-resizer{width:6px;cursor:col-resize;');
    expect(CHAT_HTML).toContain('<div class="main-resizer" id="main-resizer"></div>');
    expect(script).toContain("const MAIN_SPLIT_KEY = 'mcpchat_sidebar_width';");
    expect(script).toContain('function initMainSplitter()');
    expect(script).toContain('const setSidebarW=(width, persist=false)=>');
    expect(script).toContain('const clamped=Math.max(180, Math.min(width, window.innerWidth-320));');
    expect(script).toContain("sidebar.style.setProperty('--sidebar-w', clamped+'px');");
    expect(script).toContain('const move=e=>setSidebarW(e.clientX, true);');
    expect(script).toContain("localStorage.setItem(MAIN_SPLIT_KEY, String(Math.round(clamped)));");
    expect(script).toContain('initMainSplitter();');
  });
});
