import { CHAT_STYLE } from './styles/chatStyles.ts';
import { PRODUCTION_STATE_SCRIPT } from './workflow/productionStateScript.ts';
import { PRODUCTION_TRACE_SCRIPT } from './workflow/productionTraceScript.ts';
import { OBSERVER_TOOLS_SCRIPT } from './views/observerToolsScript.ts';
import { MCP_CONNECTOR_SCRIPT } from './runtime/mcpConnectorScript.ts';
import { CONFIG_SCRIPT } from './config/configScript.ts';
import { ACTIVITY_PANEL_SCRIPT } from './runtime/activityPanelScript.ts';
import { RUNTIME_GRAPH_SCRIPT } from './runtime/runtimeGraphScript.ts';
import { CHAT_MARKUP, EMPTY_CHAT_HTML } from './views/chatView.ts';
import { HELP_PANEL_SCRIPT } from './views/helpPanelScript.ts';
import { WIKI_PANEL_SCRIPT } from './views/wikiPanelScript.ts';
const CHAT_BODY = `${CHAT_MARKUP}\n\n<script>\nlet servers = [];
let messages = [];
let isStreaming = false;
let sidebarOpen = true;
let nextId = 1;
let streamAbortController = null;
let currentConversationId = null;
const THEME_KEY='llm-wiki:theme';
function applyTheme(theme,persist=true) {
  const selected=theme==='dark'?'dark':'light';
  document.documentElement.classList.toggle('theme-dark',selected==='dark');
  document.documentElement.classList.toggle('theme-light',selected==='light');
  const button=document.getElementById('theme-toggle');
  if(button) {
    button.textContent=selected==='light'?'☾':'☀';
    button.title=selected==='light'?'Switch to dark theme':'Switch to light theme';
  }
  if(persist) localStorage.setItem(THEME_KEY,selected);
}
function toggleTheme() { applyTheme(document.documentElement.classList.contains('theme-dark')?'light':'dark'); }
applyTheme(localStorage.getItem(THEME_KEY)||localStorage.getItem('llm-wiki:graph:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
window.addEventListener('storage',event=>{if(event.key===THEME_KEY&&event.newValue)applyTheme(event.newValue,false)});
let historySummaries = [];
let historySaveTimer = null;
let conversationDirty = false;
let historyLoadSeq = 0;
let clearChatSeq = 0;
let skillsCache = null;
let skillAcIdx = -1;
let skillAcItems = [];
let skillEditingName = null;
const SKILL_AC_LIMIT = 8;
let productionState = {
  jobId: null,
  job: null,
  progress: null,
  logs: [],
  command: '',
  traceFile: '',
  trace: null,
  pollTimer: null,
  countdownTimer: null,
  lastUpdatedAt: null,
  notifiedTerminalJobIds: new Set(),
};
let runtimeLogFilter = '';
function runtimeLogMatchesFilter(line, filter) {
  const query=String(filter||'').trim().toLowerCase();
  if(!query) return true;
  const text=String(line||'').toLowerCase();
  return query.split(/\\s+/).filter(Boolean).every(token=>text.includes(token));
}
function filteredRuntimeLogs(logs) {
  return (Array.isArray(logs)?logs:[]).map(String).filter(line=>runtimeLogMatchesFilter(line,runtimeLogFilter));
}
function setRuntimeLogFilter(value) {
  runtimeLogFilter=String(value||'');
  // Update ONLY the log list in place: a full renderActivities() recreates
  // the filter input on every keystroke, which threw the focus away after
  // the first typed letter.
  const list=document.getElementById('runtime-log-list');
  if(list){ list.outerHTML=runtimeLogListHTML(); scrollRuntimeLogToEnd(); }
  else renderActivities?.();
  renderRuntimeWorkflowInspector?.();
}
function runtimeLogLineHTML(line) {
  // Colorize the leading HH:MM:SS so entries are scannable.
  return esc(line).replace(/^(\\d{2}:\\d{2}:\\d{2})/,'<span class="rt-log-time">$1</span>');
}
function essentialRuntimeLogEntries(logs) {
  const entries=[];
  const seen=new Set();
  for(const raw of Array.isArray(logs)?logs:[]) {
    const line=String(raw||'').trim();
    if(!line||/\\btrace:|AGENT_STATUS|source-path=|idempotency|attempt[-_:]/i.test(line)) continue;
    const time=line.match(/^(\\d{2}:\\d{2}:\\d{2})/)?.[1]||'';
    let text=line.replace(/^\\d{2}:\\d{2}:\\d{2}\\s*/,'').trim();
    if(/^Task started:\\s*[a-f0-9-]{16,}/i.test(text)) continue;
    if(/^activity:/i.test(text)) {
      text=text.replace(/^activity:\\s*/i,'').replace(/^Production:\\s*/i,'');
      text=text.replace(/\\s*·\\s*(?:last stage|trace):.*$/i,'');
      text=text.replace(/\\s*\\([^)]*(?:step|run|ingest)[^)]*\\)/gi,'');
      text=text.replace(/ingest_apply/gi,'Ingestion').replace(/ingest[-_ ]complete/gi,'Ingestion complete');
    }
    text=text
      .replace(/[a-f0-9]{8}-[a-f0-9-]{20,}/gi,'')
      .replace(/\\b(?:runId|turnId|taskId|attemptId)[:=]\\S+/gi,'')
      .replace(/\\s+·\\s+·/g,' ·')
      .replace(/\\s{2,}/g,' ')
      .trim();
    if(!text||text.length<3) continue;
    const important=/run\\b|approval|approb|plan\\b|activity|ingest|build|export|polish|done|complete|failed|error|cancel|running|queued|started/i.test(text);
    if(!important) continue;
    const key=text.toLowerCase().replace(/\\d+%/g,'%');
    if(seen.has(key)) continue;
    seen.add(key);
    const tone=/failed|error|cancel/i.test(text)?'error':/done|complete|success/i.test(text)?'success':/approval|approb|waiting/i.test(text)?'warning':/running|started/i.test(text)?'running':'info';
    entries.push({time,text,tone});
  }
  return entries;
}
function essentialRuntimeLogHTML() {
  const entries=essentialRuntimeLogEntries(runtimeState?.logs).slice(-60).reverse();
  if(!entries.length) return '<div class="runtime-journal empty">No essential run event yet.</div>';
  return \`<div class="runtime-journal">\${entries.map(entry=>\`<div class="runtime-journal-entry \${entry.tone}"><time>\${esc(entry.time||'—')}</time><span>\${esc(entry.text)}</span></div>\`).join('')}</div>\`;
}
function runtimeLogListHTML() {
  const entries=essentialRuntimeLogEntries(filteredRuntimeLogs(runtimeState.logs)).slice(-100).reverse();
  return entries.length
    ? \`<div class="runtime-journal" id="runtime-log-list">\${entries.map(entry=>\`<div class="runtime-journal-entry \${entry.tone}"><time>\${esc(entry.time||'—')}</time><span>\${esc(entry.text)}</span></div>\`).join('')}</div>\`
    : '<div class="runtime-journal empty" id="runtime-log-list">No matching essential run events.</div>';
}
function scrollRuntimeLogToEnd() {
  // Descending order: the latest entries are at the TOP of the capped list.
  const list=document.getElementById('runtime-log-list');
  if(list) list.scrollTop=0;
}
const DEFAULT_SYSTEM_PROMPT = \`You are an assistant connected to MCP servers.

When MCP tools are available, use them if the answer depends on external, recent, private, local, or tool-verifiable information.

After each tool result:
- assess whether the result is sufficient to answer;
- if the result is incomplete, ambiguous, truncated, or only exploratory, call another relevant tool before responding;
- status, list, and logs tools are observational: after one observational result, answer from it instead of chaining more observational calls unless the user explicitly asked to monitor or compare several statuses;
- do not claim to have read a complete source if the tool only returned an excerpt or a list of candidates;
- phrase tool queries in natural language; do not use search engine operators like OR or site: unless the tool explicitly requires them;
- request a small number of results initially (5 to 10) and increase only if coverage is insufficient.

llm-wiki specific rules:
- For synthesis, architecture, functional analysis, audit, or comparison questions, start with wiki_collect_context when it is available.
- Use readPages as the primary evidence.
- candidateResults and excerpts identify candidate pages — they are not sufficient alone to establish a complete answer.
- If readPages is empty, truncated, or insufficient, call wiki_read_page, wiki_read_pages, wiki_search_context, or wiki_read_ingested_source to improve coverage.
- Report coverage limitations when results are insufficient or truncated.

When multiple MCP servers are active, choose tools based on the domain of the question.

## Workspace Profile

The workspace profile is stored in .wiki/profile.md, next to the workspace system prompt.

Use it to adapt your behavior to the user and the workspace.

When the user asks to remember, persist, summarize, or update durable profile-related information, update .wiki/profile.md via the profile_update tool.

Keep the profile concise. If it becomes too long, summarize it into the ## Summary section.

Do not store secrets, credentials, API keys, passwords, temporary facts, or unnecessary private information.\`;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const jsArg = value => esc(JSON.stringify(value));
function renderInstructionRefs(html) {
  return String(html||'').replace(/\\[\\[([^\\]\\n]+)\\]\\]/g,(_,label)=>\`<span class="instruction-ref">[[\${esc(label.trim())}]]</span>\`);
}
function renderMd(t) {
  try {
    let html = typeof marked!=='undefined' ? marked.parse(t||'') : esc(t||'');
    html = String(html).split('<table').join('<div class="table-wrap"><table').split('</table>').join('</table></div>');
    return renderInstructionRefs(html);
  } catch { return renderInstructionRefs(esc(t||'')); }
}
const SIDEBAR_SPLIT_KEY = 'mcpchat_sidebar_history_height';
const MAIN_SPLIT_KEY = 'mcpchat_sidebar_width';
const SIDEBAR_OPEN_KEY = 'mcpchat_sidebar_open';
const traceRegistry = new Map();
let nextTraceId = 1;
const MCP_STALE_SESSION_MS = 5 * 60 * 1000;
const MCP_REQUEST_TIMEOUT_MS = 60 * 1000;
function chatModeToolsNotice() {
  return \`Chat mode (offline fallback): the wiki-manager runtime is not reachable, so no MCP tools or connectors are available in this conversation and no live state can be checked. If the answer requires a connector's live config, status, recent jobs, or wiki content, say plainly that it cannot be checked while the runtime is offline — do not guess or give a bare label as an answer.\`;
}
function languageInstruction() {
  const lang = window.__WIKI_CONFIG__?.language;
  if (!lang || lang === 'en') return '';
  let label = lang;
  try { label = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang; } catch {}
  return \`IMPORTANT: always answer in the configured language: \${lang} (\${label}). After a tool call, translate and summarize the useful information in that language; keep another language only for proper nouns, paths, commands, code, and exact quotations.\`;
}
function notify(msg, type='s') {
  const el=$('notif'); el.textContent=msg; el.className=\`show \${type}\`;
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3200);
}
${ACTIVITY_PANEL_SCRIPT}
${RUNTIME_GRAPH_SCRIPT}
${HELP_PANEL_SCRIPT}

function runtimeTime(value,fallback=Date.now()) {
  if(value==null) return fallback;
  const parsed=typeof value==='number'?value:Date.parse(String(value));
  return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
}
function runtimeTaskPanelHTML(view='plan') {
  if(!runtimeState) {
    if(window.__WIKI_CONFIG__?.runtime?.enabled) return '<div class="runtime-status">Runtime connecting...</div>';
    return '';
  }
  const workflowNodes=Array.isArray(runtimeState.workflow?.nodes)?runtimeState.workflow.nodes:null;
  const workflowTasks=workflowNodes?.filter(node=>node.type==='task')||null;
  const workflowActivities=workflowNodes?.filter(node=>node.type==='activity')||null;
  const workflowQueue=workflowNodes?.filter(node=>node.type==='queue')||null;
  const plan=workflowTasks
    ? workflowTasks.map((node,index)=>({...(node.raw||{}),step:node.step||index+1,description:node.description||node.label,status:node.status,activityKey:node.activityKey}))
    : Array.isArray(runtimeState.plan)?runtimeState.plan:[];
  const activities=workflowActivities
    ? workflowActivities.map(node=>({...(node.raw||{}),key:node.key,label:node.label,status:node.status,terminal:['done','failed','cancelled'].includes(String(node.status)),progress:node.progress}))
    : Array.isArray(runtimeState.activities)?runtimeState.activities:[];
  const queue=workflowQueue
    ? workflowQueue.map(node=>({...(node.raw||{}),id:node.itemId||node.id,label:node.label,status:node.status}))
    : Array.isArray(runtimeState.queue)?runtimeState.queue:[];
  const activitySummary=runtimeState.workflow?.activity||null;
  const activityLines=Array.isArray(activitySummary?.lines)?activitySummary.lines:[];
  const initialSynthesis=Array.isArray(activitySummary?.initialSynthesis)?activitySummary.initialSynthesis:[];
  const logs=filteredRuntimeLogs(runtimeState.logs);
  const runStartedAt=runtimeTime(runtimeState.startedAt||runtimeState.createdAt||runtimeState.updatedAt);
  const runUpdatedAt=runtimeTime(runtimeState.finishedAt||runtimeState.completedAt||runtimeState.updatedAt,runStartedAt);
  const status=\`<div class="runtime-status">Runtime \${runtimeConnected?'connected':'disconnected'} · \${esc(runtimeState.status||'idle')}</div>\`;
  const runCard=runtimeRunCardHTML(plan,activities,runtimeState.workflow?.progress);
  const planCards=[...plan].reverse().map((step,index)=>actCardHTML({
    id:'runtime-plan-'+(step.id||step.step||index),
    kind:'runtime-plan',
    source:'runtime',
    remoteId:step.id||step.step||index,
    statusTarget:step.id||step.step||\`plan step \${index+1}\`,
    label:step.description||step.label||'Plan step',
    detail:'Plan step '+(step.step||index+1),
    status:normalizeActivityStatus(step.status,activityTerminalStatus(step.status)),
    terminal:activityTerminalStatus(step.status),
    plan:{steps:[{label:step.description||step.label||'Step'}]},
    progress:{stepIndex:1,detail:step.status||''},
    startedAt:runtimeTime(step.startedAt||step.createdAt,runStartedAt),
    updatedAt:runtimeTime(step.finishedAt||step.completedAt||step.updatedAt,runUpdatedAt),
  })).join('');
  const activityCards=(activityLines.length?[...activityLines].reverse().map((line,index)=>({
    id:'runtime-agg-'+(line.id||index),
    kind:'runtime-activity',
    source:'runtime',
    statusTarget:line.id||line.label||\`activity \${index+1}\`,
    label:line.label||'Runtime activity',
    detail:'',
    status:normalizeActivityStatus(line.status||'running',false),
    progress:line.progress||null,
    startedAt:runStartedAt,
    updatedAt:runUpdatedAt,
  })):[...activities].reverse().map((activity,index)=>runtimeActivityToCard(activity,index,runStartedAt,runUpdatedAt))).map(actCardHTML).join('');
  const queueCards=[...queue].reverse().map((item,index)=>actCardHTML({
    id:'runtime-queue-'+(item.id||index),
    kind:'runtime-queue',
    source:'runtime',
    remoteId:item.id||item.jobId||index,
    statusTarget:item.id||item.jobId||item.label||item.tool||\`queue item \${index+1}\`,
    label:item.label||item.tool||item.type||'Queued task',
    detail:item.dependsOn||item.depends_on||item.status||'waiting',
    status:normalizeActivityStatus(item.status||'queued',activityTerminalStatus(item.status)),
    terminal:activityTerminalStatus(item.status),
    startedAt:runtimeTime(item.startedAt||item.createdAt,runStartedAt),
    updatedAt:runtimeTime(item.finishedAt||item.completedAt||item.updatedAt,runUpdatedAt),
  })).join('');
  const logFilters=\`<div class="runtime-log-filters"><input id="runtime-log-filter" value="\${esc(runtimeLogFilter)}" oninput="setRuntimeLogFilter(this.value)" placeholder="Filter essential run events…"></div>\`;
  const logsHtml=logFilters+runtimeLogListHTML();
  const synthesisHtml=initialSynthesis.length?\`<div class="act-section-head"><span class="act-section-title">Initial synthesis</span></div><div class="runtime-log">\${esc(initialSynthesis.join('\\n'))}</div>\`:'';
  if(view==='runtime') return activityCards;
  if(view==='logs') return logsHtml;
  const runSummary=runtimeWorkflowSummaryHTML();
  const planHTML=planCards?\`<div class="act-section-head"><span class="act-section-title">Plan</span></div>\${planCards}\`:'';
  const queueHTML=queueCards?\`<div class="act-section-head"><span class="act-section-title">Queue</span></div>\${queueCards}\`:'';
  return status+runSummary+runCard+synthesisHtml+planHTML+queueHTML;
}

function runtimeRunCardHTML(plan,activities,progress=null) {
  if(!runtimeIsRunning()) return '';
  const doneCount=plan.filter(step=>String(step.status||'').toLowerCase()==='done').length;
  const runningStep=plan.find(step=>String(step.status||'').toLowerCase()==='running');
  const title=runtimeState?.summary || runningStep?.description || activities.find(activity=>isActivityActive(normalizeActivityStatus(activity.status,activity.terminal)))?.label || 'Runtime run';
  const runId=runtimeState?.runId || runtimeState?.currentRunId || activities.find(activity=>activity.runId)?.runId || '';
  const turnId=runtimeState?.turnId || activities.find(activity=>activity.turnId)?.turnId || '';
  const workspace=runtimeState?.workspace || window.__WIKI_CONFIG__?.workspaceName || '';
  const percent=Number.isFinite(Number(progress?.percent))?\`\${Math.round(Number(progress.percent))}%\`:null;
  const meta=[
    plan.length?\`\${doneCount} task\${doneCount>1?'s':''} done\`:null,
    runId?\`runId: \${runId}\`:null,
    turnId?\`turnId: \${turnId}\`:null,
    workspace?\`workspace: \${workspace}\`:null,
  ].filter(Boolean).join(' · ');
  const progressLabel=\`Running\${percent?' · '+percent:''}\`;
  return \`<div class="act-card running" data-run-id="\${esc(runId)}" data-turn-id="\${esc(turnId)}" data-workspace="\${esc(workspace)}"><div class="act-card-head"><span class="act-card-icon">▶</span><div class="act-card-info"><div class="act-card-name">Run — \${esc(title)}</div><div class="act-card-meta"><span class="run-progress">\${esc(progressLabel)}</span>\${meta?' · '+esc(meta):''}</div></div><span class="act-badge running">Running</span></div><div class="act-actions"><button class="act-btn" type="button" onclick="askRuntimeStatus(\${jsArg(runId||title)})">Inspect</button><button class="act-btn del" type="button" onclick="cancelRuntimeRun()">Cancel</button></div></div>\`;
}

function runtimeActivityToCard(activity,index=0,runStartedAt=Date.now(),runUpdatedAt=runStartedAt) {
  const started=runtimeTime(activity.startedAt||activity.createdAt||activity.updatedAt,runStartedAt);
  const updated=runtimeTime(activity.finishedAt||activity.completedAt||activity.endedAt||activity.updatedAt,runUpdatedAt);
  const progress=activity.progress||{};
  const structuredDetail=[
    progress.detail,
    progress.batch?.total&&!/batch/i.test(String(progress.detail||''))?\`Batch \${progress.batch.index}/\${progress.batch.total}\`:null,
    progress.throttling?.active?(progress.throttling.retryAt?\`Throttled · retry \${progress.throttling.retryAt}\`:progress.throttling.waitMs?\`Throttled · wait \${progress.throttling.waitMs}ms\`:'Throttled'):null,
    progress.processing?.instructionCount!=null?\`\${progress.processing.instructionCount} instructions\`:null,
  ].filter(Boolean).join(' · ');
  return {
    id:'runtime-act-'+(activity.key||activity.id||index),
    remoteId:activity.id||activity.key||'',
    statusTarget:activity.id||activity.key||activity.label||\`runtime activity \${index+1}\`,
    kind:'runtime',
    source:activity.source||'runtime',
    sourceLabel:activity.source||'Runtime',
    tool:activity.tool||activity.poll?.tool||'runtime',
    label:activity.label||activity.id||'Runtime activity',
    detail:structuredDetail||activity.status||'',
    status:normalizeActivityStatus(activity.status,activity.terminal),
    progress:activity.progress||null,
    plan:activity.plan||null,
    poll:null,
    error:activity.error||null,
    terminal:Boolean(activity.terminal),
    startedAt:started,
    updatedAt:updated,
  };
}

function scrollMessagesToBottom() {
  const wrap=$('messages');
  if(wrap) wrap.scrollTop=wrap.scrollHeight;
}

// Bumped on every fetch that starts, and on every direct SSE 'state' push
// (the authoritative, already-in-order source). A run's final "done" state
// can arrive over SSE while an older /api/runtime/state fetch — kicked off
// mid-stream by one of many agent_event bursts a long streamed reply
// produces — is still in flight; without this guard, that stale fetch
// resolving afterward silently overwrites the fresh "done" state with a
// "running" snapshot from a moment before completion, and the run looks
// stuck in progress forever even though it already finished.
let runtimeStateSeq=0;
function applyRuntimeState(state) {
  runtimeState=state;
  runtimeConnected=true;
  const conversationChanged=mergeRuntimeConversation();
  renderActivities();
  updateActivityBadge();
  updateApprovalBanner();
  updateAgentModeUI();
  // Scroll after renderActivities(), not before: opening/resizing the
  // Activity panel can reflow the chat column's width and change wrapped
  // text height, which would make an earlier scrollTop assignment stale.
  if(conversationChanged) scrollMessagesToBottom();
}

async function fetchRuntimeState() {
  if(!window.__WIKI_CONFIG__?.runtime?.enabled) return;
  const seq=++runtimeStateSeq;
  const res=await fetch('/api/runtime/state',{cache:'no-store'});
  if(!res.ok) throw new Error('runtime unavailable');
  const data=await res.json();
  if(seq!==runtimeStateSeq) return;
  applyRuntimeState(data);
}

function connectRuntimePanel() {
  if(!window.__WIKI_CONFIG__?.runtime?.enabled) return;
  fetchRuntimeState().catch(()=>{runtimeConnected=false;renderActivities();});
  const events=new EventSource('/api/runtime/events');
  events.addEventListener('state',(event)=>{
    try {
      runtimeStateSeq++;
      applyRuntimeState(JSON.parse(event.data));
    } catch {}
  });
  events.addEventListener('agent_event',()=>{
    if(runtimeFetchPending) return;
    runtimeFetchPending=true;
    setTimeout(()=>{
      runtimeFetchPending=false;
      fetchRuntimeState().catch(()=>{runtimeConnected=false;renderActivities();});
    },200);
  });
  events.onerror=()=>{runtimeConnected=false;renderActivities();updateAgentModeUI();};
}

function updateMsgBubble(el,role,content) {
  el.dataset.copy=content||'';
  const bubble=el.querySelector('.bubble');
  if(bubble) bubble.innerHTML=role==='assistant'?renderMd(content||''):esc(content||'');
}

// Merges Donna's actual replies (and any user turns not already shown, e.g.
// history restored after a reload) into the visible chat thread. Without
// this, Agent mode only ever showed the one-off "Runtime run accepted"
// acknowledgment — the real conversation lived in runtimeState.conversation
// but nothing ever read it.
function mergeRuntimeConversation() {
  const conversation=Array.isArray(runtimeState?.conversation)?runtimeState.conversation:[];
  if(!conversation.length) return false;
  if(runtimeConversationOffset===null) {
    // First runtime state after page load normally contains the complete
    // persisted workspace log. Treat it as the baseline. If the user managed
    // to submit before that first state arrived, anchor on the newest matching
    // pending user turn so that turn (and its reply) still appears.
    if(pendingRuntimeUserRefs.length) {
      const wanted=String(pendingRuntimeUserRefs[0]?.message?.content??'');
      let match=-1;
      for(let i=conversation.length-1;i>=0;i--) {
        if(conversation[i]?.role==='user'&&String(conversation[i]?.content??'')===wanted) { match=i; break; }
      }
      runtimeConversationOffset=match>=0?match:conversation.length;
    } else {
      runtimeConversationOffset=conversation.length;
      return false;
    }
  }
  let changed=false;
  // Only the *last* already-synced entry can still change in place (the
  // server only ever mutates its conversation array's last entry — finalizing
  // a streaming placeholder — or appends; everything before that is settled),
  // so re-scanning from 0 every call would re-compare unchanging history for
  // nothing on every ~200ms poll during a long streamed reply. Indexed off
  // runtimeConversationOffset directly (no .slice()) so this doesn't copy the
  // whole unconsumed tail on every poll.
  const visibleLength=conversation.length-runtimeConversationOffset;
  for(let i=Math.max(0,runtimeConversationRefs.length-1);i<visibleLength;i++) {
    const raw=conversation[runtimeConversationOffset+i];
    const role=raw.role;
    const content=String(raw.content??'');
    if(i<runtimeConversationRefs.length) {
      const ref=runtimeConversationRefs[i];
      if(ref.message.content!==content) {
        // Only the first transition from empty to non-empty content marks a
        // streaming reply actually materializing. Without the wasEmpty guard,
        // every later poll that revisits this same (already-answered) last
        // entry would re-satisfy this check and shift/remove a *different*
        // pending status bubble queued by a later, still-unanswered request.
        const wasEmpty=!ref.message.content;
        ref.message.content=content;
        updateMsgBubble(ref.el,role,content);
        changed=true;
        if(role==='assistant'&&content&&wasEmpty&&pendingRuntimeStatusEls.length) {
          pendingRuntimeStatusEls.shift()?.remove();
        }
      }
      continue;
    }
    if(role==='assistant'&&content&&pendingRuntimeStatusEls.length) {
      pendingRuntimeStatusEls.shift()?.remove();
      changed=true;
    }
    if(role==='user' && pendingRuntimeUserRefs.length) {
      // FIFO: the server processes user turns in submission order, so the
      // oldest unconfirmed local push always corresponds to the oldest
      // unconsumed server-side user entry at this position.
      runtimeConversationRefs.push(pendingRuntimeUserRefs.shift());
      continue;
    }
    const message={role,content};
    messages.push(message);
    const el=appendMsg(role,content);
    runtimeConversationRefs.push({message,el});
    changed=true;
  }
  if(changed) scheduleConversationSave();
  return changed;
}

function openDocumentUpload() {
  $('doc-upload-input')?.click();
}
function formatBytes(bytes) {
  const value=Number(bytes);
  if(!Number.isFinite(value)||value<0) return null;
  const units=['B','KB','MB','GB'];
  let size=value;
  let unit=0;
  while(size>=1024&&unit<units.length-1) { size/=1024; unit++; }
  return \`\${size.toFixed(unit===0?0:1)} \${units[unit]}\`;
}
function uploadOutputLabel(outputPath) {
  const text=String(outputPath||'');
  const marker='/raw/untracked/';
  const index=text.indexOf(marker);
  if(index!==-1) return \`raw/untracked/\${text.slice(index+marker.length)}\`;
  return text;
}
function uploadMethodLabel(method) {
  const labels={
    'pdf-text': 'PDF text extraction',
    'pdf-ocr': 'PDF OCR',
    'image-ocr': 'Image OCR',
    'docx-xml': 'DOCX text extraction',
    'libreoffice-pdf': 'Office conversion',
    'text': 'Text import',
  };
  return labels[method]||method||null;
}
function uploadDocumentRequest(form,onUploaded) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST','/api/upload');
    xhr.upload.addEventListener('load',()=>onUploaded?.());
    xhr.addEventListener('load',()=>{
      let data;
      try { data=JSON.parse(xhr.responseText||'{}'); }
      catch { data={ok:false,error:'Invalid upload response'}; }
      if(xhr.status<200||xhr.status>=300||data.ok===false) {
        reject(new Error(data.error||\`HTTP \${xhr.status}\`));
        return;
      }
      resolve(data);
    });
    xhr.addEventListener('error',()=>reject(new Error('Document upload failed')));
    xhr.addEventListener('abort',()=>reject(new Error('Document upload cancelled')));
    xhr.send(form);
  });
}
const UPLOAD_ALLOWED_EXTENSIONS=['txt','md','pdf','xls','xlsx','doc','docx','ppt','pptx','odt','odp'];
async function uploadSelectedDocument(input) {
  const file=input?.files?.[0];
  if(!file) return;
  input.value='';
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(!UPLOAD_ALLOWED_EXTENSIONS.includes(ext)) {
    notify('Unsupported file type: .'+ext+' — allowed: '+UPLOAD_ALLOWED_EXTENSIONS.join(', '),'e');
    return;
  }
  const actId='upload-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  upsertActivity({id:actId,kind:'upload',label:file.name,filename:file.name,bytes:file.size,status:'running',startedAt:Date.now()});
  openActivityPanel();
  try {
    const form=new FormData();
    form.append('file',file,file.name);
    const data=await uploadDocumentRequest(form,()=>{
      upsertActivity({id:actId,phase:'conversion'});
    });
    const upload=data.upload||{};
    upsertActivity({id:actId,status:upload.status||'stored',outputPath:upload.outputPath||null,method:upload.method||null,uploadId:upload.id||null,error:upload.error||null});
    if(upload.status==='converted'&&upload.outputPath) addPageContext(uploadOutputLabel(upload.outputPath));
    notify(upload.status==='converted'?'Document converted':'Document stored');
  } catch(err) {
    upsertActivity({id:actId,status:'failed',error:err?.message||String(err)});
    notify(err?.message||String(err),'e');
  }
}
function appBack() {
  if(history.length>1) history.back();
  else location.assign('/');
}

function autoResize(ta) {
  ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,180)+'px';
  const val=ta.value;
  if(val.startsWith('/')&&!/\\s/.test(val)){
    fetchSkillsAc().then(()=>showSkillAc(val.slice(1)));
  } else { hideSkillAc(); }
}
function handleKey(e) {
  if($('skill-ac').classList.contains('open')){
    if(e.key==='ArrowDown'){e.preventDefault();skillAcIdx=Math.min(skillAcIdx+1,skillAcItems.length-1);updateSkillAcFocus();return;}
    if(e.key==='ArrowUp'){e.preventDefault();skillAcIdx=Math.max(skillAcIdx-1,-1);updateSkillAcFocus();return;}
    if(e.key==='Tab'||(e.key==='Enter'&&skillAcIdx>=0)){e.preventDefault();selectSkillAc(skillAcIdx>=0?skillAcIdx:0);return;}
    if(e.key==='Escape'){e.preventDefault();hideSkillAc();return;}
  }
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}
}
async function fetchSkillsAc(force=false){
  if(skillsCache!==null&&!force)return;
  try{
    const r=await fetch('/api/skills');
    skillsCache=r.ok ? await r.json() : [];
  }catch{skillsCache=[];}
}
function showSkillAc(filter){
  const el=$('skill-ac');
  const normalized=String(filter||'').toLowerCase();
  const builtins=[{name:'connector',description:'List connectors or authorize one: /connector auth google',params:['list | auth google']}];
  const filtered=[...builtins,...(skillsCache||[]).filter(s=>s.name!=='connector')]
    .filter(s=>String(s.name||'').toLowerCase().startsWith(normalized))
    .slice(0,SKILL_AC_LIMIT);
  skillAcItems=filtered;
  if(!filtered.length){hideSkillAc();return;}
  skillAcIdx=-1;
  el.innerHTML=filtered.map((s,i)=>\`<div class="skill-ac-item" data-idx="\${i}" onclick="selectSkillAc(\${i})" onmouseenter="skillAcIdx=\${i};updateSkillAcFocus()"><div class="skill-ac-slash">/</div><div class="skill-ac-info"><div class="skill-ac-name">\${esc(s.name)}</div>\${s.description?'<div class="skill-ac-desc">'+esc(s.description)+'</div>':''}</div></div>\`).join('');
  el.classList.add('open');
}
function hideSkillAc(){$('skill-ac').classList.remove('open');skillAcIdx=-1;skillAcItems=[];}
function updateSkillAcFocus(){$('skill-ac').querySelectorAll('.skill-ac-item').forEach((el,i)=>el.classList.toggle('focused',i===skillAcIdx));}
function selectSkillAc(idx){
  const skill=skillAcItems[idx];
  if(!skill)return;
  const ta=$('chat-input');
  ta.value='/' + skill.name;
  ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,130)+'px';
  hideSkillAc();
  ta.focus();
  if(skill.params&&skill.params.length){
    notify('Expected parameters: '+skill.params.map(p=>'{'+p+'}').join(', '),'s');
  }
}

function submitSuggestion(text) {
  showChatView();
  const ta=$('chat-input');
  if(!ta || isStreaming) return;
  ta.value=String(text||'');
  autoResize(ta);
  sendMessage();
}

function renderSkillsManager() {
  const el=$('skills-manager-list');
  if(!el) return;
  if(skillsCache===null) {
    el.innerHTML='<div class="skill-empty">Loading skills...</div>';
    fetchSkillsAc().then(renderSkillsManager);
    return;
  }
  const skills=skillsCache||[];
  if(!skills.length) {
    el.innerHTML='<div class="skill-empty">No skills. Create your first skill to make it available with / in chat.</div>';
    return;
  }
  el.innerHTML=\`<div class="skills-manager-grid">\${skills.map((s,i)=>\`
    <div class="skill-manager-card">
      <div class="skill-manager-name">/\${esc(s.name||'')}</div>
      \${s.description?\`<div class="skill-manager-desc">\${esc(s.description)}</div>\`:''}
      \${Array.isArray(s.params)&&s.params.length?\`<div class="skill-manager-params">\${s.params.map(p=>\`<span class="skill-manager-param">{\${esc(p)}}</span>\`).join('')}</div>\`:''}
      \${s.body?\`<div class="skill-manager-preview">\${esc(String(s.body).slice(0,180))}\${String(s.body).length>180?'...':''}</div>\`:''}
      <div class="skill-manager-actions">
        <button class="skill-manager-btn" type="button" onclick="openSkillEditor(\${i})">Edit</button>
        <button class="skill-manager-btn del" type="button" onclick="deleteSkillFromManager(\${i})">Delete</button>
      </div>
    </div>\`).join('')}</div>\`;
}

function openSkillEditor(idx=null) {
  const skill=Number.isInteger(idx) ? (skillsCache||[])[idx] : null;
  skillEditingName=skill?.name||null;
  $('skill-editor-title').textContent=skill ? \`Edit /\${skill.name}\` : 'New skill';
  $('skill-name').value=skill?.name||'';
  $('skill-name').disabled=!!skill;
  $('skill-desc').value=skill?.description||'';
  $('skill-params').value=Array.isArray(skill?.params) ? skill.params.join(', ') : '';
  $('skill-body').value=skill?.body||'';
  $('skill-editor').classList.add('open');
  (skill ? $('skill-body') : $('skill-name')).focus();
}

function closeSkillEditor() {
  skillEditingName=null;
  $('skill-editor')?.classList.remove('open');
}

async function saveSkillFromEditor() {
  const name=(skillEditingName||$('skill-name').value).trim();
  const description=$('skill-desc').value.trim();
  const params=$('skill-params').value.split(',').map(p=>p.trim()).filter(Boolean);
  const body=$('skill-body').value;
  if(!name){notify('Skill name is required.','e');return;}
  if(!body.trim()){notify('Skill body is required.','e');return;}
  try {
    const r=await fetch('/api/skills/'+encodeURIComponent(name),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({description,params,body}),
    });
    if(!r.ok) {
      let msg='Save failed';
      try{msg=(await r.json()).error||msg;}catch{}
      throw new Error(msg);
    }
    closeSkillEditor();
    await fetchSkillsAc(true);
    renderSkillsManager();
    notify('Skill saved');
  } catch(e) {
    notify(e.message||String(e),'e');
  }
}

async function deleteSkillFromManager(idx) {
  const skill=(skillsCache||[])[idx];
  if(!skill) return;
  if(!confirm(\`Delete skill /\${skill.name}?\`)) return;
  try {
    const r=await fetch('/api/skills/'+encodeURIComponent(skill.name),{method:'DELETE'});
    if(!r.ok) throw new Error('Deletion failed');
    await fetchSkillsAc(true);
    renderSkillsManager();
    notify('Skill deleted');
  } catch(e) {
    notify(e.message||String(e),'e');
  }
}
function applySidebarOpen(open, persist=false) {
  sidebarOpen=Boolean(open);
  $('sidebar')?.classList.toggle('collapsed',!sidebarOpen);
  const button=$('sidebar-toggle');
  if(button) {
    const label=sidebarOpen?'Collapse left panel':'Expand left panel';
    button.title=label;
    button.setAttribute('aria-label',label);
    button.setAttribute('aria-expanded',String(sidebarOpen));
  }
  if(persist) localStorage.setItem(SIDEBAR_OPEN_KEY,sidebarOpen?'1':'0');
}
function toggleSidebar() { applySidebarOpen(!sidebarOpen,true); }
function syncModel() { $('model-badge').textContent=$('model-name').value||'model'; }

function clampSidebarSplit(height) {
  const split=$('sidebar-split');
  if(!split) return height;
  const total=split.clientHeight;
  const minTop=96;
  const minBottom=180;
  return Math.max(minTop, Math.min(height, total-minBottom-10));
}

function setSidebarSplitHeight(height, persist=false) {
  const split=$('sidebar-split');
  if(!split) return;
  const clamped=clampSidebarSplit(height);
  split.style.setProperty('--history-pane-height', clamped+'px');
  if(persist) localStorage.setItem(SIDEBAR_SPLIT_KEY, String(Math.round(clamped)));
}

function initSidebarSplitter() {
  const split=$('sidebar-split'), handle=$('sidebar-resizer');
  if(!split || !handle) return;
  const saved=Number(localStorage.getItem(SIDEBAR_SPLIT_KEY));
  if(Number.isFinite(saved) && saved>0) setSidebarSplitHeight(saved);

  let dragging=false;
  const move=e=>{
    if(!dragging) return;
    const rect=split.getBoundingClientRect();
    setSidebarSplitHeight(e.clientY-rect.top,true);
  };
  const up=()=>{
    if(!dragging) return;
    dragging=false;
    handle.classList.remove('dragging');
    document.body.style.cursor='';
    document.body.style.userSelect='';
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
  };
  handle.addEventListener('pointerdown',e=>{
    dragging=true;
    handle.classList.add('dragging');
    document.body.style.cursor='row-resize';
    document.body.style.userSelect='none';
    handle.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    e.preventDefault();
  });
  window.addEventListener('resize',()=>{
    const current=parseFloat(getComputedStyle(split).getPropertyValue('--history-pane-height'));
    if(Number.isFinite(current)) setSidebarSplitHeight(current);
  });
}

function initMainSplitter() {
  const sidebar=$('sidebar'), handle=$('main-resizer');
  if(!sidebar || !handle) return;

  applySidebarOpen(localStorage.getItem(SIDEBAR_OPEN_KEY)!=='0');

  const setSidebarW=(width, persist=false)=>{
    const clamped=Math.max(180, Math.min(width, window.innerWidth-320));
    sidebar.style.setProperty('--sidebar-w', clamped+'px');
    if(persist) localStorage.setItem(MAIN_SPLIT_KEY, String(Math.round(clamped)));
  };

  const saved=Number(localStorage.getItem(MAIN_SPLIT_KEY));
  if(Number.isFinite(saved) && saved>0) setSidebarW(saved);

  handle.addEventListener('pointerdown',e=>{
    if(e.target.closest?.('#sidebar-toggle')) return;
    handle.classList.add('dragging');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    handle.setPointerCapture?.(e.pointerId);
    const move=e=>setSidebarW(e.clientX, true);
    const up=()=>{
      handle.classList.remove('dragging');
      document.body.style.cursor='';
      document.body.style.userSelect='';
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    e.preventDefault();
  });
}

function setSendButtonStreaming(streaming) {
  const btn=$('send-btn');
  if(!btn) return;
  btn.classList.toggle('is-stop',streaming);
  btn.title=streaming?'Stop':'Send';
  btn.innerHTML=streaming
    ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z"/></svg>';
}

function runtimeEnabled() {
  return Boolean(window.__WIKI_CONFIG__?.runtime?.enabled);
}

function runtimeIsRunning() {
  return String(runtimeState?.status||'').toLowerCase()==='running';
}

function updateAgentModeUI() {
  const btn=$('agent-mode-btn');
  if(btn) {
    btn.classList.toggle('active',agentMode);
    btn.classList.toggle('disabled',!runtimeEnabled());
    btn.title=runtimeEnabled()
      ? (agentMode?'Agent mode: prompts run through wiki-manager runtime':'Chat mode: prompts run locally in serve')
      : 'Runtime not configured';
  }
  $('input-box')?.classList.toggle('agent-on',agentMode);
  refreshPageContextChip();
  if(!isStreaming) {
    setSendButtonStreaming(false);
  }
}

function toggleAgentMode() {
  if(!runtimeEnabled()) {
    notify('Runtime is not configured.','e');
    return;
  }
  agentMode=!agentMode;
  updateAgentModeUI();
  notify(agentMode?'Agent mode on':'Chat mode on');
}

function handleSendButton() {
  if(isStreaming) stopStreaming();
  else sendMessage();
}

function stopStreaming() {
  streamAbortController?.abort();
}

async function cancelRuntimeRun() {
  if(!runtimeEnabled()) return;
  try {
    const res=await fetch('/api/runtime/cancel',{method:'POST'});
    if(!res.ok) throw new Error('runtime cancel failed');
    notify('Runtime cancel requested');
    await fetchRuntimeState().catch(()=>{});
  } catch(e) {
    notify(e?.message||String(e),'e');
  }
}
// Approval grants are authoritative. Task statuses can legitimately lag just
// after a run-scoped grant, so combining both sources kept the banner visible
// even though approval had succeeded. Plan statuses are only a legacy fallback
// for runtime snapshots that do not expose an approvals array.
function pendingApprovalCount() {
  if(!runtimeState) return 0;
  if(Array.isArray(runtimeState.approvals)) {
    return runtimeState.approvals.filter(a=>String(a.status||'').toLowerCase()==='pending_approval').length;
  }
  const tasks=Array.isArray(runtimeState.plan)
    ? runtimeState.plan.filter(t=>['pending_approval','waiting_approval'].includes(String(t.status||'').toLowerCase())).length
    : 0;
  return tasks;
}
function updateApprovalBanner() {
  const banner=$('approval-banner');
  const count=pendingApprovalCount();
  if(!banner) return;
  if(count>0) {
    const label=$('approval-banner-text');
    if(label) label.textContent=count+' tâche(s) mutante(s) en attente d\\'approbation avant exécution.';
    banner.hidden=false;
  } else {
    banner.hidden=true;
  }
}
async function approveRuntimeRun() {
  if(!runtimeEnabled()) return;
  const buttons=[...document.querySelectorAll('#approval-banner .approval-btn.approve')];
  buttons.forEach(button=>{ button.disabled=true; });
  try {
    const runId=runtimeState?.runId||runtimeState?.currentRunId||null;
    const res=await fetch('/api/runtime/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'run',...(runId?{runId}:{})})});
    if(!res.ok&&res.status!==202) throw new Error('approval failed ('+res.status+')');
    const result=await res.json().catch(()=>({approved:true}));
    if(result?.approved===false) throw new Error(result?.reason||'approval not granted');
    if(Array.isArray(runtimeState?.approvals)) {
      runtimeState.approvals=runtimeState.approvals.map(approval=>
        (!runId||!approval.runId||approval.runId===runId)&&String(approval.status||'').toLowerCase()==='pending_approval'
          ? {...approval,status:'approved'}
          : approval,
      );
    }
    updateApprovalBanner();
    notify('Approbation accordée');
    await fetchRuntimeState().catch(()=>{});
  } catch(e) {
    notify(e?.message||String(e),'e');
  } finally {
    buttons.forEach(button=>{ button.disabled=false; });
  }
}
function rejectRuntimeRun() {
  if(!runtimeEnabled()) return;
  if(!confirm('Rejeter l\\'approbation ? Cela annule le run en cours.')) return;
  cancelRuntimeRun();
}

function toggleSystemPrompt() {
  const drawer=$('system-prompt-drawer'), btn=$('system-drawer-btn');
  const open=!drawer.classList.contains('open');
  drawer.classList.toggle('open',open);
  drawer.setAttribute('aria-hidden',open?'false':'true');
  btn?.classList.toggle('active',open);
  if(open) setTimeout(()=>$('system-prompt')?.focus(),50);
}

function closeSystemPrompt() {
  const drawer=$('system-prompt-drawer'), btn=$('system-drawer-btn');
  drawer?.classList.remove('open');
  drawer?.setAttribute('aria-hidden','true');
  btn?.classList.remove('active');
}

function saveSystemPrompt() {
  localStorage.setItem(storageKey('mcpchat_system_prompt'), $('system-prompt').value);
}

function resetSystemPrompt() {
  $('system-prompt').value = DEFAULT_SYSTEM_PROMPT;
  saveSystemPrompt();
  notify('Instructions reset');
}

function currentSystemPrompt() {
  return ($('system-prompt')?.value || '').trim();
}

function newConversationId() {
  return \`conv_\${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}_\${Math.random().toString(36).slice(2,8)}\`;
}

function titleFromMessages(sourceMessages=messages) {
  const firstUser=sourceMessages.find(m=>m.role==='user' && m.content);
  const text=String(firstUser?.displayContent || firstUser?.content || 'New conversation').replace(/\\s+/g,' ').trim();
  return text.length>54 ? text.slice(0,53).trimEnd()+'…' : text;
}

function activeServerSnapshot() {
  return servers.map(s=>({
    name:s.name,
    url:s.url,
    enabled:!!s.enabled,
    status:s.status,
    toolCount:Array.isArray(s.tools)?s.tools.length:0,
  }));
}

function buildConversationPayload(snapshot={}) {
  const now=new Date().toISOString();
  const id=snapshot.id || currentConversationId || newConversationId();
  const sourceMessages=Array.isArray(snapshot.messages) ? snapshot.messages : messages;
  const existing=historySummaries.find(c=>c.id===id);
  return {
    id,
    title: titleFromMessages(sourceMessages),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    systemPrompt: snapshot.systemPrompt ?? currentSystemPrompt(),
    mcpServers: snapshot.mcpServers ?? activeServerSnapshot(),
    messages: sourceMessages,
    traceHtml: snapshot.traceHtml ?? [...document.querySelectorAll('.trace-card')].map(el=>el.outerHTML),
    messageHtml: snapshot.messageHtml ?? $('messages')?.innerHTML ?? '',
  };
}

async function persistConversationPayload(payload) {
  const method=historySummaries.some(c=>c.id===payload.id) ? 'PUT' : 'POST';
  const url=method==='PUT' ? \`/api/chat/history/\${encodeURIComponent(payload.id)}\` : '/api/chat/history';
  await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  await loadHistory();
}

async function saveCurrentConversation({immediate=false, force=false}={}) {
  if(!messages.length) return;
  if(!force && !conversationDirty) return;
  if(historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer=null;
  }
  const run=async()=>{
    try {
      const payload=buildConversationPayload();
      currentConversationId=payload.id;
      await persistConversationPayload(payload);
      conversationDirty=false;
    } catch(e) {
      console.warn('chat history save failed', e);
    }
  };
  if(immediate) await run();
  else historySaveTimer=setTimeout(run,500);
}

function scheduleConversationSave() {
  conversationDirty=true;
  saveCurrentConversation().catch(()=>{});
}

function historyMeta(item) {
  const date=new Date(item.updatedAt);
  const when=Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const tools=item.toolCallCount ? \` · \${item.toolCallCount} tool\${item.toolCallCount>1?'s':''}\` : '';
  return \`\${when}\${tools}\`;
}

function renderHistory() {
  const el=$('history-list');
  if(!el) return;
  if(!historySummaries.length) {
    el.innerHTML='<div class="history-empty">No history.</div>';
    return;
  }
  el.innerHTML=historySummaries.map(item=>\`
    <button class="history-item \${item.id===currentConversationId?'active':''}" onclick="loadConversation('\${esc(item.id)}')">
      <div class="history-main">
        <div class="history-title">\${esc(item.title||'New conversation')}</div>
        <div class="history-meta">\${esc(historyMeta(item))}</div>
      </div>
      <span class="history-delete" onclick="deleteConversation(event,'\${esc(item.id)}')" title="Delete">×</span>
    </button>
  \`).join('');
}

async function loadHistory() {
  try {
    const res=await fetch('/api/chat/history');
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    historySummaries=await res.json();
    renderHistory();
    return true;
  } catch(e) {
    console.warn('chat history load failed', e);
    return false;
  }
}

function setEmptyChat() {
  $('messages').innerHTML=\`${EMPTY_CHAT_HTML}\`;
}

async function newConversation() {
  showChatView();
  if(messages.length) await saveCurrentConversation({immediate:true});
  currentConversationId=null;
  messages=[];
  resetRuntimeConversationTracking();
  conversationDirty=false;
  resetProductionState();
  setEmptyChat();
  renderHistory();
  $('chat-input')?.focus();
}

async function loadConversation(id) {
  showChatView();
  if(isStreaming) stopStreaming();
  const seq=++historyLoadSeq;
  const previousId=currentConversationId;
  if(previousId===id) {
    renderHistory();
  } else {
    const previousSnapshot=conversationDirty && previousId && messages.length
      ? buildConversationPayload({
          id:previousId,
          messages:messages.slice(),
          systemPrompt:currentSystemPrompt(),
          mcpServers:activeServerSnapshot(),
          traceHtml:[...document.querySelectorAll('.trace-card')].map(el=>el.outerHTML),
          messageHtml:$('messages')?.innerHTML || '',
        })
      : null;
    currentConversationId=id;
    renderHistory();
    if(previousSnapshot) {
      try {
        await persistConversationPayload(previousSnapshot);
      } catch(e) {
        console.warn('chat history save failed', e);
      }
    }
  }
  try {
    const res=await fetch(\`/api/chat/history/\${encodeURIComponent(id)}\`);
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const conv=await res.json();
    if(seq!==historyLoadSeq) return;
    currentConversationId=conv.id;
    messages=Array.isArray(conv.messages) ? conv.messages : [];
    resetRuntimeConversationTracking();
    conversationDirty=false;
    if(conv.systemPrompt && $('system-prompt')) {
      $('system-prompt').value=conv.systemPrompt;
      saveSystemPrompt();
    }
    $('messages').innerHTML=conv.messageHtml || '';
    if(!$('messages').innerHTML.trim()) setEmptyChat();
    recoverProductionStateFromMessages();
    renderHistory();
    $('messages').scrollTop=$('messages').scrollHeight;
  } catch(e) {
    notify(\`History: \${e.message}\`,'e');
  }
}

async function deleteConversation(event, id) {
  event.stopPropagation();
  try {
    const res=await fetch(\`/api/chat/history/\${encodeURIComponent(id)}\`,{method:'DELETE'});
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    if(currentConversationId===id) {
      currentConversationId=null;
      messages=[];
      resetRuntimeConversationTracking();
      setEmptyChat();
    }
    await loadHistory();
  } catch(e) {
    notify(\`Deletion failed: \${e.message}\`,'e');
  }
}

function buildLLMHeaders() {
  const key=$('api-key').value.trim();
  const h={'Content-Type':'application/json'};
  if(key) h['Authorization']=\`Bearer \${key}\`;
  return h;
}

function buildProxyLLMHeaders() {
  const h={'Content-Type':'application/json'};
  const yaml=window.__WIKI_CONFIG__||{};
  const baseUrl=$('base-url').value.trim();
  const apiKey=$('api-key').value.trim();
  if(baseUrl && baseUrl!==yaml.baseUrl) h['X-LLM-Wiki-LLM-Base-Url']=baseUrl;
  if(apiKey && apiKey!==yaml.apiKey) h['X-LLM-Wiki-LLM-API-Key']=apiKey;
  return h;
}

function renderTopPills() {
  const el=$('tb-mcps');
  if(!el) return;
  el.innerHTML = servers
    .filter(s=>s.enabled&&s.status==='ok')
    .map(s=>\`<span class="tb-mcp-pill" title="\${esc(s.url)}">\${esc(s.name)} <span style="opacity:.6">(\${s.tools.length})</span></span>\`)
    .join('');
}

function addServer(name='', url='', bearer='') {
  const id=nextId++;
  servers.push({id, name:name||\`MCP \${id}\`, url, bearer, sessionId:null, enabled:false, status:'off', tools:[]});
  renderCards(); saveServers();
}

function removeServer(id) {
  if(!confirm('Delete this connector?')) return;
  servers=servers.filter(s=>s.id!==id);
  renderCards(); renderTopPills(); saveServers();
}

function renderCards() {
  const el=$('mcp-cards');
  if(!el) return;
  if(!servers.length) {
    el.innerHTML='<div style="padding:0 4px;font-size:12px;color:var(--muted)">No server. Click &quot;+ Add&quot;.</div>';
    return;
  }
  el.innerHTML=servers.map(s=>cardHTML(s)).join('');
}

// initPageMode / showChatView / showConnectorsView / showExecutionView live in
// wikiPanelScript.ts with the shell tab logic (single owner of view switching).

function cardHTML(s) {
  const badgeClass={ok:'ok',err:'err',loading:'loading',off:'off'}[s.status]||'off';
  const badgeLabel={ok:\`\${s.tools.length} tools\`,err:'error',loading:'…',off:'off'}[s.status]||'off';

  const toolsHTML = (s.status==='ok'&&s.tools.length)
    ? \`<div class="mcp-tools">
        <div class="mcp-tools-head" onclick="toggleTools(\${s.id})">
          <span>\${s.tools.length} tool\${s.tools.length>1?'s':''}</span>
          <span class="mcp-tools-chevron" id="tools-chevron-\${s.id}">▸</span>
        </div>
        <div class="mcp-tools-body collapsed" id="tools-body-\${s.id}">\${s.tools.map(t=>\`
          <div class="tool-row">
            <div class="tool-dot"></div>
            <div>
              <div class="tool-name-t">\${esc(t.name)}</div>
              \${t.description?\`<div class="tool-desc-t">\${esc(t.description.slice(0,60))}\${t.description.length>60?'…':''}</div>\`:''}
            </div>
          </div>\`).join('')}
        </div>
      </div>\` : '';

  const activeClass = s.enabled&&s.status==='ok' ? 'active' : s.status==='err' ? 'error' : '';

  return \`<div class="mcp-card \${activeClass}" id="card-\${s.id}">
    <div class="mcp-card-head">
      <label class="mcp-toggle">
        <input type="checkbox" \${s.enabled&&s.status==='ok'?'checked':''} onchange="toggleServer(\${s.id},this.checked)">
        <div class="mcp-toggle-track"><div class="mcp-toggle-thumb"></div></div>
      </label>
      <input class="mcp-name-input" type="text" value="\${esc(s.name)}" placeholder="Name"
        onchange="servers.find(x=>x.id==\${s.id}).name=this.value;renderTopPills();saveServers()">
      <span class="mcp-badge \${badgeClass}">\${badgeLabel}</span>
    </div>
    <div class="mcp-url-row">
      <input type="text" value="\${esc(s.url)}" placeholder="http://localhost:3000/mcp/"
        onchange="servers.find(x=>x.id==\${s.id}).url=this.value;saveServers()" style="flex:1">
      <button class="btn-icon" onclick="connectServer(\${s.id})" title="Connect">&#x21BB;</button>
      <button class="btn-icon btn-del" onclick="removeServer(\${s.id})" title="Remove">&#x2715;</button>
    </div>
    <div class="mcp-bearer-row">
      <div class="secret-wrap" style="flex:1">
        <input type="password" value="\${esc(s.bearer||'')}" placeholder="Bearer token (optional)"
          autocomplete="off" style="padding-right:34px;font-size:11px"
          onchange="(function(el,id){const sv=servers.find(x=>x.id==id);if(!sv)return;sv.bearer=el.value;saveServers();if(sv.url)connectServer(id);})(this,\${s.id})">
        <div class="secret-actions">
          <button class="secret-btn" onclick="toggleReveal(this.closest('.secret-wrap').querySelector('input'),this)" title="Show/hide">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      \${s.bearer
        ? (s.status==='err'
          ? '<span class="key-saved show" style="flex-shrink:0;background:rgba(192,57,43,.12);color:var(--err)">token &#x2717;</span>'
          : '<span class="key-saved show" style="flex-shrink:0">token &#x2713;</span>')
        : s.injected
          ? '<span class="key-saved show" style="flex-shrink:0">server token &#x2713;</span>'
          : '<span style="font-size:10px;color:var(--muted);flex-shrink:0;font-family:var(--font-mono)">no auth</span>'}
    </div>
    \${toolsHTML}
  </div>\`;
}

async function toggleServer(id, checked) {
  const s=servers.find(x=>x.id===id); if(!s) return;
  s.enabled=checked;
  if(checked && s.status!=='ok') { await connectServer(id); }
  else { renderCards(); renderTopPills(); saveServers(); }
}

${MCP_CONNECTOR_SCRIPT}

${PRODUCTION_STATE_SCRIPT}

${OBSERVER_TOOLS_SCRIPT}

${PRODUCTION_TRACE_SCRIPT}

// ── Chat ────────────────────────────────────────────────────────────────────

async function clearChat() {
  clearChatSeq++;
  if(isStreaming) stopStreaming();
  if(historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer=null;
  }
  const id=currentConversationId;
  messages=[];
  resetRuntimeConversationTracking();
  conversationDirty=false;
  resetProductionState();
  setEmptyChat();
  if(id) {
    try {
      const existing=historySummaries.find(c=>c.id===id);
      await persistConversationPayload({
        id,
        title:'New conversation',
        createdAt:existing?.createdAt || new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        systemPrompt:currentSystemPrompt(),
        mcpServers:activeServerSnapshot(),
        messages:[],
        traceHtml:[],
        messageHtml:'',
      });
      currentConversationId=id;
    } catch(e) {
      notify(\`Clear failed: \${e.message}\`,'e');
    }
  } else {
    renderHistory();
  }
}

function removeEmpty() { $('empty')?.remove(); }

function findSkillByName(name) {
  const wanted=String(name||'').toLowerCase();
  return (skillsCache||[]).find(s=>String(s.name||'').toLowerCase()===wanted) || null;
}

async function resolveSkillInvocation(text) {
  const match=/^\\/([A-Za-z0-9_-]+)(?:\\s+([\\s\\S]*))?$/.exec(String(text||'').trim());
  if(!match) return {displayText:text,sendText:text,skill:null};
  await fetchSkillsAc();
  const skill=findSkillByName(match[1]);
  if(!skill) return {displayText:text,sendText:text,skill:null};

  const args=String(match[2]||'').trim().split(/\\s+/).filter(Boolean);
  let body=String(skill.body||'').trim();
  if(Array.isArray(skill.params)) {
    for(const [i,param] of skill.params.entries()) {
      const value=args[i] || '';
      body=body.replaceAll(\`{\${param}}\`, value);
    }
  }
  if(!body) return {displayText:text,sendText:text,skill:null};
  return {
    displayText:text,
    sendText:body,
    skill:{name:skill.name,params:Array.isArray(skill.params)?skill.params:[]},
  };
}

function requestMessagesForLLM(sourceMessages) {
  return sourceMessages.flatMap((msg)=>{
    if(msg.role==='user') return {role:'user',content:msg.content};
    if(msg.role==='assistant') return {role:'assistant',content:msg.content ?? ''};
    return msg;
  });
}

async function copyMessage(btn) {
  const msg=btn.closest('.msg');
  const text=msg?.dataset.copy || msg?.querySelector('.bubble')?.innerText || '';
  if(!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent='Copied';
    setTimeout(()=>btn.textContent='Copy',1200);
  } catch {
    notify('Copy failed','e');
  }
}

function appendMsg(role, content, {html=false,plainText=null}={}) {
  removeEmpty();
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className=\`msg \${role}\`;
  div.dataset.copy=plainText??content??'';
  const av=role==='user'?'<div class="av u">You</div>':'';
  const bodyHtml=html ? (content||'') : (role==='assistant' ? renderMd(content||'') : esc(content||''));
  div.innerHTML=\`\${av}<div class="msg-content"><div class="bubble">\${bodyHtml}</div><div class="msg-actions"><button class="msg-action" onclick="copyMessage(this)">Copy</button></div></div>\`;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function runtimeChoiceHTML(text, choices=[]) {
  const items=Array.isArray(choices)&&choices.length ? choices : [
    {intent:'observe',label:'Ask about this run'},
    {intent:'mutate',label:'Propose a change'},
    {intent:'enqueue',label:'Queue future run'},
  ];
  return \`<div>\${renderMd(text)}<div class="runtime-choice-row">\${items.map(choice=>{
    const intent=choice.intent||choice.action||'converse';
    return \`<button class="act-btn" type="button" onclick="sendRuntimeControlChoice(\${jsArg(intent)},\${jsArg(text)})">\${esc(choice.label||intent)}</button>\`;
  }).join('')}</div></div>\`;
}

function createTraceCard() {
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className='trace-card empty';
  const traceId=\`trace-\${nextTraceId++}\`;
  div.dataset.traceId=traceId;
  const title='Agent orchestration';
  div.innerHTML=\`<div class="trace-head" onclick="toggleTrace(this)"><div class="trace-title"><span>\${title}</span><span class="trace-meta">0 call</span></div><span class="trace-chevron">▾</span></div><div class="trace-body"><div class="trace-flow"></div><div class="trace-detail-wrap"></div></div>\`;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  const trace={id:traceId,el:div,steps:[],selectedStepId:null};
  traceRegistry.set(traceId,trace);
  return trace;
}

function createChatAgentProjection() {
  return {chain:[],activities:{},plan:null,status:'idle',summary:null};
}

function createChatAgentEvent(type, {origin='system', payload={}}={}) {
  return {
    id:\`\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,10)}\`,
    ts:new Date().toISOString(),
    type,
    origin,
    payload,
  };
}

function dispatchChatAgentEvent(trace, type, {origin='system', payload={}}={}) {
  if(!trace) return null;
  const event=createChatAgentEvent(type,{origin,payload});
  trace.agentProjection ||= createChatAgentProjection();
  applyChatAgentEvent(trace.agentProjection,event);
  trace.steps=trace.agentProjection.chain;
  if(!trace._hasVisibleSteps && trace.steps.some(s=>s.type==='tool' || s.type==='production')) {
    trace._hasVisibleSteps=true;
    trace.el?.classList.remove('empty');
  }
  renderTrace(trace);
  return event;
}

function applyChatAgentEvent(state, event) {
  const p=event.payload||{};
  if(event.type==='run_started') {
    state.status='running';
    state.chain=[];
    state.activities={};
    state.plan=null;
    state.summary=null;
    return;
  }
  if(event.type==='tool_call_started') {
    upsertChatTraceStep(state,{
      type:'tool',
      status:'running',
      kind:p.kind||'MCP',
      title:p.name||'tool',
      summary:p.summary||'calling...',
      targetId:p.targetId||p.callId,
      compactKey:p.compactKey||'',
      assistantText:p.assistantText||'',
    });
    return;
  }
  if(event.type==='tool_call_result') {
    const targetId=p.targetId||p.callId;
    const step=state.chain.find(s=>s.targetId===targetId);
    if(!step) return;
    const ok=p.ok!==false;
    const baseSummary=toolResultTraceSummary(p.result,ok);
    Object.assign(step,{
      status:ok?'done':'failed',
      summary:Number(step.callCount)>1 ? \`\${baseSummary} · ×\${step.callCount}\` : baseSummary,
      ok,
      resultHtml:toolResultSummaryHTML(p.result,ok,p.name||step.title),
      assistantText:p.assistantText||step.assistantText||'',
    });
    return;
  }
  if(event.type==='trace_step_upsert') {
    upsertChatTraceStep(state,p.step||{});
    return;
  }
  if(event.type==='activity_upserted') {
    const activity=p.activity||null;
    if(activity?.key) state.activities[activity.key]=activity;
    return;
  }
  if(event.type==='run_summary') {
    state.summary=String(p.content||'');
    return;
  }
  if(event.type==='run_done') state.status='done';
  if(event.type==='run_error') state.status='error';
}

function upsertChatTraceStep(state, rawStep) {
  const step={...rawStep};
  if(step.compactKey) {
    const existing=state.chain.find(s=>s.compactKey===step.compactKey);
    if(existing) {
      Object.assign(existing,step,{
        id:existing.id,
        callCount:(Number(existing.callCount)||1)+1,
        firstTargetId:existing.firstTargetId || existing.targetId,
      });
      return existing;
    }
    step.callCount=1;
    state.chain.push(step);
    return step;
  }
  const key=step.id || step.targetId;
  const existing=key ? state.chain.find(s=>s.id===key || s.targetId===key) : null;
  if(existing) {
    Object.assign(existing,step,{id:existing.id});
    return existing;
  }
  state.chain.push(step);
  return step;
}

function hydrateTraceCard(card) {
  if(!card) return null;
  let traceId=card.dataset.traceId;
  if(!traceId) {
    traceId=\`trace-\${nextTraceId++}\`;
    card.dataset.traceId=traceId;
  }
  const steps=Array.from(card.querySelectorAll('.trace-flow .trace-tile')).map((tile,i)=>{
    const onclick=tile.getAttribute('onclick') || '';
    const stepId=onclick.match(/toggleTraceStep\\('[^']+','([^']+)'\\)/)?.[1] || \`step-\${traceId}-\${i}\`;
    const classes=Array.from(tile.classList || []);
    const type=classes.find(c=>['tool','production','internal','final'].includes(c)) || 'internal';
    const status=classes.find(c=>['queued','running','done','failed','cancelled'].includes(c)) || '';
    return {
      id:stepId,
      type,
      status,
      kind:tile.querySelector('.trace-k')?.textContent || '',
      title:tile.querySelector('.trace-v')?.textContent || '',
      summary:tile.querySelector('.trace-s')?.textContent || '',
      ok:!classes.includes('error'),
    };
  });
  const active=steps.find((_,i)=>card.querySelectorAll('.trace-flow .trace-tile')[i]?.classList.contains('active'));
  const trace={id:traceId,el:card,steps,selectedStepId:active?.id || null};
  traceRegistry.set(traceId,trace);
  return trace;
}

function toggleTrace(head) {
  const body=head.parentElement.querySelector('.trace-body');
  const chev=head.querySelector('.trace-chevron');
  const collapsed=body.classList.toggle('collapsed');
  if(chev) chev.textContent=collapsed?'▸':'▾';
}

function traceStepHTML(trace, step) {
  if(!step.id) step.id=\`step-\${trace.id}-\${trace.steps.indexOf(step)}\`;
  const active=trace.selectedStepId===step.id;
  const cls=['trace-tile',step.type,step.status,active?'active':'',step.ok===false?'error':''].filter(Boolean).join(' ');
  const clickable=step.detail || step.resultHtml || step.targetId;
  const click=clickable ? \` onclick="toggleTraceStep('\${esc(trace.id)}','\${esc(step.id)}')"\` : '';
  return \`<button class="\${cls}" type="button"\${click}>
    <div class="trace-k">\${esc(step.kind)}</div>
    <div class="trace-v">\${esc(step.title)}</div>
    \${step.summary?\`<div class="trace-s">\${esc(step.summary)}</div>\`:''}
  </button>\`;
}

function traceDetailHTML(step) {
  if(!step) return '';
  const d=step.detail;
  if(!d && step.resultHtml) {
    return \`<div class="trace-detail">
      <div class="trace-detail-head">
        <div class="trace-detail-title">\${esc(step.title || 'tool')}</div>
        <div class="trace-detail-meta">\${esc(step.summary || '')}</div>
      </div>
      \${step.assistantText?\`<div class="trace-detail-line">\${esc(step.assistantText)}</div>\`:''}
      <div class="trace-tool-result">\${step.resultHtml}</div>
    </div>\`;
  }
  if(!d) return '';
  const exit=d.exitCode===null || d.exitCode===undefined ? '—' : d.exitCode;
  const percent=d.percent===null || d.percent===undefined ? '—' : \`\${Math.round(Number(d.percent))}%\`;
  return \`<div class="trace-detail">
    <div class="trace-detail-head">
      <div class="trace-detail-title">\${esc(d.title || step.title || 'production')}</div>
      <div class="trace-detail-meta">\${esc(productionStatusLabel(d.status || step.status))}</div>
    </div>
    <div class="trace-detail-grid">
      <div class="trace-detail-cell"><div class="trace-detail-k">Duration</div><div class="trace-detail-v">\${esc(d.duration || '—')}</div></div>
      <div class="trace-detail-cell"><div class="trace-detail-k">Exit</div><div class="trace-detail-v">\${esc(exit)}</div></div>
      <div class="trace-detail-cell"><div class="trace-detail-k">Progress</div><div class="trace-detail-v">\${esc(percent)}</div></div>
    </div>
    \${d.detail?\`<div class="trace-detail-line">\${esc(d.detail)}</div>\`:''}
    \${d.command?\`<div class="trace-detail-line"><strong>Command</strong> · \${esc(d.command)}</div>\`:''}
    \${d.traceFile?\`<div class="trace-detail-line"><strong>Trace</strong> · \${esc(d.traceFile)}</div>\`:''}
    \${d.error?\`<div class="trace-detail-line" style="color:var(--err)">\${esc(d.error)}</div>\`:''}
    \${d.logs?\`<div class="trace-detail-log">\${esc(d.logs)}</div>\`:''}
  </div>\`;
}

function traceOpenDetails(container) {
  return Array.from(container?.querySelectorAll('details') || [])
    .map((el,i)=>el.open ? i : -1)
    .filter(i=>i>=0);
}

function restoreTraceOpenDetails(container, openIndexes) {
  if(!container || !Array.isArray(openIndexes) || !openIndexes.length) return;
  const details=Array.from(container.querySelectorAll('details'));
  openIndexes.forEach(i=>{ if(details[i]) details[i].open=true; });
}

function rememberTraceDetailState(trace) {
  const detailWrap=trace?.el?.querySelector('.trace-detail-wrap');
  const selected=trace?.steps?.find(s=>s.id===trace.selectedStepId);
  if(!detailWrap || !selected) return;
  selected.openDetailIndexes=traceOpenDetails(detailWrap);
}

function renderTrace(trace) {
  if(!trace?.el) return;
  rememberTraceDetailState(trace);
  const flow=trace.el.querySelector('.trace-flow');
  const detailWrap=trace.el.querySelector('.trace-detail-wrap');
  const meta=trace.el.querySelector('.trace-meta');
  const toolCount=trace.steps
    .filter(s=>s.type==='tool')
    .reduce((count,s)=>count+(Number(s.callCount)||1),0);
  if(meta) meta.textContent=\`\${toolCount} call\${toolCount>1?'s':''} · \${trace.steps.length} step\${trace.steps.length>1?'s':''}\`;
  flow.innerHTML=trace.steps.map((s,i)=>traceStepHTML(trace,s)+(i<trace.steps.length-1?'<div class="trace-link"></div>':'')).join('');
  const selected=trace.steps.find(s=>s.id===trace.selectedStepId);
  if(detailWrap) {
    detailWrap.innerHTML=traceDetailHTML(selected);
    restoreTraceOpenDetails(detailWrap, selected?.openDetailIndexes);
  }
}

function compactTraceKeyForTool(fn, server) {
  const name=String(fn||'');
  if(isObserverToolName(name)) return (server?.id || server?.name || 'MCP')+':'+name;
  return '';
}

function toggleTraceStep(traceId, stepId) {
  const trace=traceRegistry.get(traceId);
  if(!trace) return;
  const step=trace.steps.find(s=>s.id===stepId);
  if(!step) return;
  if(step.detail || step.resultHtml) {
    rememberTraceDetailState(trace);
    trace.selectedStepId = trace.selectedStepId===stepId ? null : stepId;
    renderTrace(trace);
    return;
  }
  if(step.targetId) scrollToTool(step.targetId);
}

function scrollToTool(id) {
  const el=$(id);
  if(!el) return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  el.style.outline='2px solid var(--accent)';
  el.style.outlineOffset='2px';
  setTimeout(()=>{el.style.outline='';el.style.outlineOffset='';},1200);
}

function parseToolJSON(result) {
  if(typeof result !== 'string') return result;
  const raw=result.trim();
  if(!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const candidates=[];
  const fenced=raw.match(/\\x60{3}(?:json)?\\s*([\\s\\S]*?)\\x60{3}/i);
  if(fenced?.[1]) candidates.push(fenced[1].trim());
  const startIndexes=[raw.indexOf('{'),raw.indexOf('[')].filter(index=>index>=0).sort((a,b)=>a-b);
  if(startIndexes.length) {
    const start=startIndexes[0];
    const opening=raw[start];
    const closing=opening==='{'?'}':']';
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<raw.length;i++) {
      const ch=raw[i];
      if(quoted) {
        if(escaped) escaped=false;
        else if(ch==='\\\\') escaped=true;
        else if(ch==='"') quoted=false;
        continue;
      }
      if(ch==='"') { quoted=true; continue; }
      if(ch===opening) depth++;
      if(ch===closing && --depth===0) {
        candidates.push(raw.slice(start,i+1));
        break;
      }
    }
  }
  for(const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

function shortText(value, max=180) {
  const text=shortTextValue(value).replace(/\\s+/g,' ').trim();
  return text.length>max ? text.slice(0,max-1).trimEnd()+'…' : text;
}

function shortTextValue(value) {
  if(value===null||value===undefined) return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean') return String(value);
  if(Array.isArray(value)) return value.map(shortTextValue).filter(Boolean).join(', ');
  if(typeof value==='object') {
    return Object.entries(value)
      .map(([key,item])=>key+': '+shortTextValue(item))
      .filter(Boolean)
      .join(', ');
  }
  return String(value);
}

function uniqueCount(values) {
  return new Set((values||[]).filter(Boolean)).size;
}

function localDocHref(path) {
  let clean=String(path||'').trim();
  if(/^https?:\\/\\//i.test(clean)) {
    try {
      const url=new URL(clean, window.location.href);
      if(url.origin!==window.location.origin) return null;
      clean=url.pathname;
    } catch {
      return null;
    }
  }
  clean=clean.replace(/^\\/+/, '').replace(/#.*$/, '');
  if(!clean) return null;
  if(
    clean.startsWith('wiki/') ||
    clean.startsWith('templates/') ||
    clean.startsWith('deliverables/') ||
    clean.startsWith('build-context/') ||
    clean.startsWith('raw/ingested/')
  ) return '/' + clean;
  return null;
}

function docButtonHTML(path, label=path, chip=false) {
  const href=localDocHref(path);
  if(!href) return esc(label||path||'');
  const cls=chip?'tc-doc-chip':'tc-doc-btn';
  return \`<button type="button" class="\${cls}" onclick='openLocalDoc(\${JSON.stringify(href)},\${JSON.stringify(path)})' title="\${esc(path)}">\${esc(label||path)} ↗</button>\`;
}

function docChipRowHTML(paths, limit=3) {
  const unique=[...new Set((paths||[]).filter(p=>localDocHref(p)))];
  if(!unique.length) return '';
  const shown=unique.slice(0,limit);
  return \`<div class="tc-doc-chip-row">\${shown.map(p=>docButtonHTML(p,p,true)).join('')}\${unique.length>shown.length?\`<span class="tc-item-meta">+\${unique.length-shown.length}</span>\`:''}</div>\`;
}

function jsonPreviewValue(value) {
  if(value===null || value===undefined) return '—';
  if(typeof value==='string' || typeof value==='number' || typeof value==='boolean') return String(value);
  if(Array.isArray(value)) return \`\${value.length} item\${value.length>1?'s':''}\`;
  if(typeof value==='object') return \`\${Object.keys(value).length} field\${Object.keys(value).length>1?'s':''}\`;
  return String(value);
}

function flatJsonColumns(rows) {
  const keys=[];
  for(const row of rows) {
    if(!row || typeof row!=='object' || Array.isArray(row)) return [];
    for(const key of Object.keys(row)) {
      const value=row[key];
      if(value && typeof value==='object') continue;
      if(!keys.includes(key)) keys.push(key);
      if(keys.length>=5) return keys;
    }
  }
  return keys;
}

function genericJsonTableHTML(rows) {
  const cols=flatJsonColumns(rows);
  if(!cols.length) return '';
  const shown=rows.slice(0,8);
  return \`<div class="tc-json-table-wrap"><table class="tc-json-table"><thead><tr>\${cols.map(c=>\`<th>\${esc(c)}</th>\`).join('')}</tr></thead><tbody>\${shown.map(row=>\`<tr>\${cols.map(c=>\`<td>\${esc(shortText(jsonPreviewValue(row?.[c]),90))}</td>\`).join('')}</tr>\`).join('')}</tbody></table></div>\${rows.length>shown.length?\`<div class="tc-item-meta">+\${rows.length-shown.length} more rows</div>\`:''}\`;
}

function genericJsonObjectHTML(obj) {
  const entries=Object.entries(obj||{});
  const shown=entries.slice(0,12);
  return \`<div class="trace-detail-grid">\${shown.map(([key,value])=>\`<div class="trace-detail-cell"><div class="trace-detail-k">\${esc(key)}</div><div class="trace-detail-v">\${esc(shortText(jsonPreviewValue(value),110))}</div></div>\`).join('')}</div>\${entries.length>shown.length?\`<div class="tc-item-meta">+\${entries.length-shown.length} more fields</div>\`:''}\`;
}

function genericJsonArraySectionHTML(key, rows) {
  const table=genericJsonTableHTML(rows);
  return \`<div class="tc-item">
    <div class="tc-item-meta">\${esc(key)} · \${rows.length} item\${rows.length>1?'s':''}</div>
    \${table || \`<div class="tc-list">\${rows.slice(0,8).map(item=>\`<div class="tc-item"><div class="tc-item-title"><span>\${esc(shortText(jsonPreviewValue(item),140))}</span></div></div>\`).join('')}</div>\`}
  </div>\`;
}

function genericJsonSummaryHTML(data, raw, toolName='MCP') {
  if(!data) return '';
  if(Array.isArray(data)) {
    const table=genericJsonTableHTML(data);
    return \`<div class="tc-summary"><div class="tc-summary-head"><span>\${data.length} item\${data.length>1?'s':''}</span><span class="tc-pill">array</span></div>\${table || \`<div class="tc-list">\${data.slice(0,10).map(item=>\`<div class="tc-item"><div class="tc-item-title"><span>\${esc(shortText(jsonPreviewValue(item),140))}</span></div></div>\`).join('')}</div>\`}<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details></div>\`;
  }
  if(typeof data==='object') {
    if(data.status!==undefined||data.state!==undefined||data.connectionStatus!==undefined||data.action_required!==undefined||data.actionRequired!==undefined) {
      return mcpObjectCardHTML(toolName||'MCP result',data,{raw});
    }
    const entries=Object.entries(data);
    const arrayEntry=entries.length===1 && Array.isArray(entries[0][1]) ? entries[0] : null;
    if(arrayEntry) {
      const [key,rows]=arrayEntry;
      const table=genericJsonTableHTML(rows);
      return \`<div class="tc-summary"><div class="tc-summary-head"><span>\${esc(key)}</span><span class="tc-pill">\${rows.length} item\${rows.length>1?'s':''}</span></div>\${table || \`<div class="tc-list">\${rows.slice(0,10).map(item=>\`<div class="tc-item"><div class="tc-item-title"><span>\${esc(shortText(jsonPreviewValue(item),140))}</span></div></div>\`).join('')}</div>\`}<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details></div>\`;
    }
    const arrayEntries=entries.filter(([,value])=>Array.isArray(value));
    if(arrayEntries.length>1) {
      const scalarEntries=entries
        .filter(([,value])=>!Array.isArray(value) && (value===null || typeof value!=='object'))
        .slice(0,4);
      const total=arrayEntries.reduce((sum,[,rows])=>sum+rows.length,0);
      return \`<div class="tc-summary">
        <div class="tc-summary-head">
          <span>\${total} item\${total>1?'s':''}</span>
          \${arrayEntries.slice(0,4).map(([key,rows])=>\`<span class="tc-pill">\${esc(key)}: \${rows.length}</span>\`).join('')}
        </div>
        \${scalarEntries.length?genericJsonObjectHTML(Object.fromEntries(scalarEntries)):''}
        \${arrayEntries.slice(0,4).map(([key,rows])=>genericJsonArraySectionHTML(key,rows)).join('')}
        \${arrayEntries.length>4?\`<div class="tc-item-meta">+\${arrayEntries.length-4} more sections</div>\`:''}
        <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
      </div>\`;
    }
    return \`<div class="tc-summary"><div class="tc-summary-head"><span>Structured result</span><span class="tc-pill">\${entries.length} field\${entries.length>1?'s':''}</span></div>\${genericJsonObjectHTML(data)}<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details></div>\`;
  }
  return '';
}

function productionTemplatesSummaryHTML(data, raw) {
  if(!Array.isArray(data?.templates)) return '';
  const templates=data.templates;
  const unmatched=Array.isArray(data.unmatchedDeliverables) ? data.unmatchedDeliverables : [];
  const shown=templates.slice(0,10);
  return \`<div class="tc-summary">
    <div class="tc-summary-head">
      <span>\${templates.length} template\${templates.length>1?'s':''}</span>
      <span class="tc-pill">\${esc(data.workspace||'workspace')}</span>
      \${unmatched.length?\`<span class="tc-pill">\${unmatched.length} unmatched</span>\`:''}
    </div>
    <div class="tc-list">\${shown.map(t=>\`<div class="tc-item">
      <div class="tc-item-title"><span>\${docButtonHTML(t.templatePath||\`templates/\${t.template}\`,t.template||t.templatePath||'template')}</span></div>
      <div class="tc-item-meta">Deliverable: \${docButtonHTML(t.deliverablePath||\`deliverables/\${t.deliverable}\`,t.deliverable||t.deliverablePath||'deliverable')}</div>
      <div class="tc-doc-chip-row"><span class="tc-pill">\${t.deliverableExists?'exists':'missing'}</span></div>
    </div>\`).join('')}</div>
    \${templates.length>shown.length?\`<div class="tc-item-meta">+\${templates.length-shown.length} more templates</div>\`:''}
    \${unmatched.length?\`<div class="tc-item">
      <div class="tc-item-meta">Unmatched deliverables</div>
      <div class="tc-doc-chip-row">\${unmatched.slice(0,8).map(d=>docButtonHTML(d.deliverablePath,d.deliverable||d.deliverablePath,true)).join('')}\${unmatched.length>8?\`<span class="tc-item-meta">+\${unmatched.length-8} more</span>\`:''}</div>
    </div>\`:''}
    <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
  </div>\`;
}

function wikiResultItemHTML(item) {
  const title=(item.headingPath&&item.headingPath.length) ? item.headingPath.join(' / ') : item.path;
  const citeCount=uniqueCount(item.citations);
  const relatedCount=uniqueCount(item.relatedPaths);
  const meta=[
    item.type,
    typeof item.score==='number' ? \`score \${Math.round(item.score*100)/100}\` : null,
    citeCount ? \`\${citeCount} citation\${citeCount>1?'s':''}\` : null,
    relatedCount ? \`\${relatedCount} lien\${relatedCount>1?'s':''}\` : null,
  ].filter(Boolean).join(' · ');
  return \`<div class="tc-item">
    <div class="tc-item-title"><span>\${esc(title)}</span></div>
    <div class="tc-item-path">\${docButtonHTML(item.path)}</div>
    \${meta?\`<div class="tc-item-meta">\${esc(meta)}</div>\`:''}
    \${item.excerpt?\`<div class="tc-item-excerpt">\${esc(shortText(item.excerpt,220))}</div>\`:''}
    \${docChipRowHTML([...(item.relatedPaths||[]),...(item.citations||[])])}
  </div>\`;
}

async function openLocalDoc(href, label) {
  const modal=$('doc-modal'), title=$('doc-title'), content=$('doc-content'), open=$('doc-open');
  if(!modal||!content) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  title.textContent=label||href;
  open.href=href;
  content.innerHTML='<div class="typing"><span></span><span></span><span></span></div>';
  try {
    const res=await fetch(href,{headers:{Accept:'text/html'}});
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const text=await res.text();
    const doc=new DOMParser().parseFromString(text,'text/html');
    const article=doc.querySelector('article.article');
    content.innerHTML=article ? \`<article class="article">\${article.innerHTML}</article>\` : \`<article class="article">\${renderMd(text)}</article>\`;
  } catch(e) {
    content.innerHTML=\`<article class="article"><p style="color:var(--err)">Failed to load \${esc(label||href)}: \${esc(e.message)}</p></article>\`;
  }
}

function closeLocalDoc() {
  const modal=$('doc-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden','true');
}

function showErrModal(title, msg) {
  const modal=$('err-modal'); if(!modal) return;
  $('err-modal-title').textContent=title;
  $('err-modal-msg').textContent=msg;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
}
function closeErrModal() {
  const modal=$('err-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden','true');
}
function mcpConnectErrorMessage(err) {
  const raw=err?.message||String(err);
  try {
    const m=raw.match(/HTTP \\d+: ([{].+[}])/s);
    if(m) {
      const body=JSON.parse(m[1]);
      const detail=body.error||body.message||'';
      if(/fetch failed|connexion refus|econnrefused|service non d/i.test(detail))
        return 'MCP service unreachable — check that the server is running.';
      if(detail) return detail;
    }
  } catch {}
  if(/fetch failed|failed to fetch|econnrefused/i.test(raw))
    return 'MCP service unreachable — check that the server is running.';
  return raw;
}

function toolResultSummaryHTML(result, ok, toolName='MCP') {
  const raw=typeof result==='string'?result:JSON.stringify(result,null,2);
  if(!ok) {
    return \`<div class="tc-summary"><div class="tc-summary-head">Tool error</div><pre style="color:var(--err)">\${esc(raw)}</pre></div>\`;
  }
  const data=parseToolJSON(result);

  if(data?.results && Array.isArray(data.results)) {
    const shown=data.results.slice(0,6);
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>\${data.results.length} result\${data.results.length>1?'s':''}</span>
        <span class="tc-pill">search</span>
      </div>
      <div class="tc-list">\${shown.map(wikiResultItemHTML).join('')}</div>
      \${data.results.length>shown.length?\`<div class="tc-item-meta">+\${data.results.length-shown.length} more results hidden</div>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pages=Array.isArray(data.readPages) ? data.readPages : [];
    const shown=data.candidateResults.slice(0,5);
    const pagePaths=(data.readPagePaths||pages.map(p=>p.path)).filter(Boolean);
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>Collected context</span>
        <span class="tc-pill">\${coverage.readPageCount ?? pagePaths.length} page\${(coverage.readPageCount ?? pagePaths.length)>1?'s':''} read</span>
        <span class="tc-pill">\${coverage.candidateCount ?? data.candidateResults.length} candidate\${(coverage.candidateCount ?? data.candidateResults.length)>1?'s':''}</span>
        \${coverage.truncatedPageCount?\`<span class="tc-pill">\${coverage.truncatedPageCount} truncated</span>\`:''}
      </div>
      \${pagePaths.length?\`<div class="tc-item"><div class="tc-item-meta">Opened pages</div><div class="tc-doc-chip-row">\${pagePaths.slice(0,8).map(p=>docButtonHTML(p,p,true)).join('')}\${pagePaths.length>8?'<span class="tc-item-meta">…</span>':''}</div></div>\`:''}
      <div class="tc-list">\${shown.map(wikiResultItemHTML).join('')}</div>
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.pages && Array.isArray(data.pages)) {
    const shown=data.pages.slice(0,6);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${data.pages.length} page\${data.pages.length>1?'s':''}</span><span class="tc-pill">read</span></div>
      <div class="tc-list">\${shown.map(p=>\`<div class="tc-item">
        <div class="tc-item-title"><span>\${docButtonHTML(p.path,p.path||'page')}</span></div>
        <div class="tc-item-meta">\${p.found?'found':'not found'}\${p.truncated?' · truncated':''}</div>
        \${p.content?\`<div class="tc-item-excerpt">\${esc(shortText(p.content,260))}</div>\`:''}
        \${p.error?\`<div class="tc-item-excerpt">\${esc(p.error)}</div>\`:''}
      </div>\`).join('')}</div>
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.jobs && Array.isArray(data.jobs)) {
    const shown=data.jobs.slice(0,8);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${data.jobs.length} production job\${data.jobs.length>1?'s':''}</span><span class="tc-pill">\${esc(data.workspace||'workspace')}</span></div>
      <div class="tc-list">\${shown.map(job=>\`<div class="tc-item">
        <div class="tc-item-title"><span>\${esc(job.type||'production')} · \${esc(productionStatusLabel(job.status))}</span></div>
        <div class="tc-item-meta">\${esc(job.jobId||'')}\${job.error?\` · \${esc(job.error)}\`:''}</div>
        \${Array.isArray(job.producedFiles)&&job.producedFiles.length?\`<div class="tc-doc-chip-row">\${job.producedFiles.slice(0,5).map(p=>docButtonHTML(p,p,true)).join('')}</div>\`:''}
      </div>\`).join('')}</div>
      \${data.jobs.length>shown.length?\`<div class="tc-item-meta">+\${data.jobs.length-shown.length} more jobs</div>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  const productionTemplates=productionTemplatesSummaryHTML(data, raw);
  if(productionTemplates) return productionTemplates;

  if(data?.sources && Array.isArray(data.sources)) {
    const shown=data.sources.slice(0,12);
    const tail=data.stdout_tail || data.stderr_tail || data.tail || '';
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>\${data.sources.length} source\${data.sources.length>1?'s':''}</span>
        <span class="tc-pill">CME</span>
        \${isPossiblyTruncatedToolResult(data,raw)?'<span class="tc-pill">partial/tail</span>':''}
      </div>
      <div class="tc-list">\${shown.map((source,i)=>\`
        <div class="tc-item">
          <div class="tc-item-title"><span>\${esc(source?.name || source?.id || source?.source || \`source \${i+1}\`)}</span></div>
          <div class="tc-item-meta">\${esc([source?.type,source?.status,source?.path,source?.url].filter(Boolean).join(' · '))}</div>
          \${source?.description || source?.summary ? \`<div class="tc-item-excerpt">\${esc(source.description || source.summary)}</div>\` : ''}
        </div>\`).join('')}</div>
      \${data.sources.length>shown.length?\`<div class="tc-item-meta">+\${data.sources.length-shown.length} more sources</div>\`:''}
      \${tail?\`<details class="tc-raw"><summary>Output tail</summary><pre>\${esc(String(tail))}</pre></details>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.job || data?.jobId) {
    const job=data.job || data;
    const status=String(job.status||data.status||'');
    const terminal=productionTerminal(status);
    const produced=Array.isArray(job.producedFiles) ? job.producedFiles : (Array.isArray(data.producedFiles) ? data.producedFiles : []);
    const duration=job.durationSeconds===null || job.durationSeconds===undefined ? '' : \`<span class="tc-pill">\${esc(formatDuration(job.durationSeconds))}</span>\`;
    const exit=job.exitCode===null || job.exitCode===undefined ? '' : \`<span class="tc-pill">exit \${esc(job.exitCode)}</span>\`;
    const progress=data.progress?.percent ?? job.progress?.percent;
    const progressPill=Number.isFinite(Number(progress)) ? \`<span class="tc-pill">\${Math.round(Number(progress))}%</span>\` : '';
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>Production \${esc(productionStatusLabel(status))}</span>
        \${job.jobId?\`<span class="tc-pill">\${esc(job.jobId)}</span>\`:''}
        \${terminal?\`<span class="tc-pill">\${esc(status)}</span>\`:''}
        \${duration}\${exit}\${progressPill}
      </div>
      \${produced.length?\`<div class="tc-item"><div class="tc-item-meta">\${produced.length} produced file\${produced.length>1?'s':''}</div><div class="tc-doc-chip-row">\${produced.slice(0,10).map(p=>docButtonHTML(p,p,true)).join('')}\${produced.length>10?'<span class="tc-item-meta">…</span>':''}</div></div>\`:''}
      <div class="tc-item-meta">Details, logs and timing in agent orchestration.</div>
      \${job.error?\`<div class="tc-item-excerpt" style="color:var(--err)">\${esc(job.error)}</div>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  const genericJson=genericJsonSummaryHTML(data, raw, toolName);
  if(genericJson) return genericJson;

  // newline-separated path list (wiki_list_pages format: "path/to/page.md [type]")
  const lines=raw.split('\\n').map(l=>l.trim()).filter(Boolean);
  if(lines.length>0 && lines.every(l=>/\\[\\w+\\]$/.test(l))) {
    const byType={};
    for(const l of lines) {
      const m=l.match(/^(.+)\\s+\\[(\\w+)\\]$/);
      if(!m) continue;
      const [,p,t]=m;
      (byType[t]=byType[t]||[]).push(p);
    }
    const groups=Object.entries(byType);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${lines.length} item\${lines.length>1?'s':''}</span>\${groups.map(([t])=>\`<span class="tc-pill">\${esc(t)}</span>\`).join('')}</div>
      \${groups.map(([t,ps])=>\`<div class="tc-item">
        <div class="tc-item-meta">\${esc(t)}</div>
        <div class="tc-doc-chip-row">\${ps.slice(0,12).map(p=>docButtonHTML(p,p,true)).join('')}\${ps.length>12?\`<span class="tc-item-meta">+\${ps.length-12} more</span>\`:''}</div>
      </div>\`).join('')}
    </div>\`;
  }

  return \`<div class="tc-summary">
    <div class="tc-summary-head"><span>Result</span></div>
    <pre>\${esc(raw.length>1800?raw.slice(0,1799)+'…':raw)}</pre>
    \${raw.length>1800?\`<details class="tc-raw"><summary>Show all</summary><pre>\${esc(raw)}</pre></details>\`:''}
  </div>\`;
}

function toolResultTraceSummary(result, ok) {
  if(!ok) return 'error';
  const data=parseToolJSON(result);
  if(data && typeof data==='object' && !Array.isArray(data)) {
    const status=data.status||data.state||data.connectionStatus;
    if(status) {
      const action=data.action_required||data.actionRequired;
      return [String(status),action?shortText(action,45):null].filter(Boolean).join(' · ');
    }
  }
  if(data?.results && Array.isArray(data.results)) return \`\${data.results.length} result\${data.results.length>1?'s':''}\`;
  if(data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pages=coverage.readPageCount ?? (Array.isArray(data.readPages)?data.readPages.length:0);
    const candidates=coverage.candidateCount ?? data.candidateResults.length;
    return \`\${candidates} candidate\${candidates>1?'s':''} · \${pages} page\${pages>1?'s':''}\`;
  }
  if(data?.pages && Array.isArray(data.pages)) return \`\${data.pages.length} page\${data.pages.length>1?'s':''}\`;
  if(data?.sources && Array.isArray(data.sources)) {
    const tail=isPossiblyTruncatedToolResult(data,typeof result==='string'?result:JSON.stringify(result));
    return \`\${data.sources.length} source\${data.sources.length>1?'s':''}\${tail?' · partial/tail':''}\`;
  }
  if(data?.jobs && Array.isArray(data.jobs)) return \`\${data.jobs.length} production job\${data.jobs.length>1?'s':''}\`;
  if(data?.job || data?.jobId) {
    const job=data.job || data;
    const produced=Array.isArray(job.producedFiles) ? job.producedFiles : (Array.isArray(data.producedFiles) ? data.producedFiles : []);
    const bits=[\`production \${productionStatusLabel(job.status||data.status)}\`];
    if(produced.length) bits.push(\`\${produced.length} file\${produced.length>1?'s':''}\`);
    if(job.durationSeconds!==null && job.durationSeconds!==undefined) bits.push(formatDuration(job.durationSeconds));
    return bits.join(' · ');
  }
  if(Array.isArray(data)) return \`\${data.length} item\${data.length>1?'s':''}\`;
  if(data && typeof data==='object') {
    const entries=Object.entries(data);
    const arrayEntry=entries.length===1 && Array.isArray(entries[0][1]) ? entries[0] : null;
    if(arrayEntry) return \`\${arrayEntry[1].length} \${arrayEntry[0]}\`;
    const arrayEntries=entries.filter(([,value])=>Array.isArray(value));
    if(arrayEntries.length>1) {
      const total=arrayEntries.reduce((sum,[,rows])=>sum+rows.length,0);
      return \`\${total} item\${total>1?'s':''} · \${arrayEntries.map(([key,rows])=>\`\${key} \${rows.length}\`).slice(0,2).join(' · ')}\`;
    }
    return \`\${entries.length} field\${entries.length>1?'s':''}\`;
  }
  const text=typeof result==='string'?result:JSON.stringify(result);
  return shortText(text,70);
}

function derivedTraceStepsForTool(fn, result, ok, targetId) {
  if(!ok) return [];
  const data=parseToolJSON(result);
  if(fn==='wiki_collect_context' && data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pagePaths=(data.readPagePaths || (Array.isArray(data.readPages) ? data.readPages.map(p=>p.path) : [])).filter(Boolean);
    const steps=[];
    const readCount=coverage.readPageCount ?? pagePaths.length;
    if(readCount>0) {
      steps.push({
        type:'internal',
        kind:'Internal',
        title:'readPages',
        summary:\`\${readCount} page\${readCount>1?'s':''} read\`,
        targetId,
      });
    }
    const truncated=coverage.truncatedPageCount ?? 0;
    if(truncated>0) {
      steps.push({
        type:'internal',
        kind:'Coverage',
        title:'truncated pages',
        summary:\`\${truncated} page\${truncated>1?'s':''}\`,
        targetId,
        ok:false,
      });
    }
    const rawCount=coverage.notReadRawSourceCount ?? (data.notReadRawSources?.length || 0);
    if(rawCount>0) {
      steps.push({
        type:'internal',
        kind:'References',
        title:'unread raw',
        summary:\`\${rawCount} source\${rawCount>1?'s':''}\`,
        targetId,
      });
    }
    return steps;
  }
  if(fn==='wiki_search_context' && data?.results && Array.isArray(data.results)) {
    const wikiCount=data.results.filter(r=>String(r.path||'').startsWith('wiki/')).length;
    return wikiCount ? [{
      type:'internal',
      kind:'Candidates',
      title:'candidate pages',
      summary:\`\${wikiCount} page\${wikiCount>1?'s':''}\`,
      targetId,
    }] : [];
  }
  if((fn==='wiki_read_pages' || fn==='wiki_read_page') && data?.pages && Array.isArray(data.pages)) {
    const found=data.pages.filter(p=>p.found).length;
    return [{
      type:'internal',
      kind:'Reading',
      title:'opened pages',
      summary:\`\${found}/\${data.pages.length} found\`,
      targetId,
    }];
  }
  return [];
}

function toggleTools(id) {
  const body=$(\`tools-body-\${id}\`), chevron=$(\`tools-chevron-\${id}\`);
  if(!body) return;
  const collapsed=body.classList.toggle('collapsed');
  if(chevron) chevron.textContent=collapsed?'▸':'▾';
}

function createStreamBubble() {
  removeEmpty();
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className='msg assistant';
  div.innerHTML='<div class="msg-content"><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div><div class="msg-actions"><button class="msg-action" onclick="copyMessage(this)">Copy</button></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function createRuntimeThinkingBubble(text='Request received · Donna is preparing the response and plan…') {
  const div=createStreamBubble();
  const bubble=div.querySelector('.bubble');
  if(bubble) bubble.innerHTML=\`<div class="runtime-thinking"><div class="typing"><span></span><span></span><span></span></div><span>\${esc(text)}</span></div>\`;
  return div;
}

function removeStreamBubble(div) {
  if(!div) return;
  div.remove();
}

function keepOrReplaceStatusBubble(currentDiv, text, statusDiv) {
  const value=String(text||'').trim();
  if(!value) {
    removeStreamBubble(currentDiv);
    return statusDiv || null;
  }
  if(statusDiv && statusDiv!==currentDiv && statusDiv.isConnected) {
    setStreamContent(statusDiv,value);
    removeStreamBubble(currentDiv);
    return statusDiv;
  }
  setStreamContent(currentDiv,value);
  return currentDiv;
}

function publishAssistantOutput(content, statusDiv, opts={}) {
  if(statusDiv && statusDiv.isConnected) {
    setStreamContent(statusDiv,content,'',opts);
    return statusDiv;
  }
  return appendMsg('assistant',content,opts);
}

function setStreamContent(div, text, extra='', {html=false,plainText=null}={}) {
  const bubble=div.querySelector('.bubble');
  if(!bubble) return;
  div.dataset.copy=plainText??text??'';
  const main=html ? (text||'') : (text ? renderMd(text) : (extra ? '' : '<div class="typing"><span></span><span></span><span></span></div>'));
  bubble.innerHTML=main+extra;
  $('messages').scrollTop=$('messages').scrollHeight;
}

async function fetchStream(url, headers, body, onDelta, signal) {
  let res;
  try {
    res=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,stream:true}),signal});
  } catch(e) {
    const detail=e instanceof Error ? e.message : String(e);
    throw new Error(\`Chat server unreachable. Check that the wiki server is running. \${detail}\`);
  }
  if(!res.ok) {
    const raw=await res.text();
    let message=raw;
    try {
      const parsed=JSON.parse(raw);
      const normalize=(value)=>{
        if(value==null) return '';
        if(typeof value==='string') return value;
        if(typeof value.message==='string') return value.message;
        try { return JSON.stringify(value); } catch { return String(value); }
      };
      message=[normalize(parsed.error),normalize(parsed.hint)].filter(Boolean).join('\\n');
    } catch {}
    if(res.status===502) {
      const detail=message ? \`\\n\${message}\` : '';
      message=\`LLM unreachable. Check that the LLM service is running and the Base URL is reachable.\${detail}\`;
    } else if(res.status===400 && /INVALID_LLM_BASE_URL|Invalid URL/i.test(message)) {
      message='Invalid LLM configuration. Check the Base URL in chat settings.';
    }
    throw new Error(\`API \${res.status}: \${message||res.statusText}\`);
  }
  const reader=res.body.getReader();
  const dec=new TextDecoder();
  let buf='', content='';
  for(;;) {
    const {done,value}=await reader.read();
    if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\\n');
    buf=lines.pop();
    for(const line of lines) {
      if(!line.startsWith('data: ')) continue;
      const d=line.slice(6).trim();
      if(!d||d==='[DONE]') continue;
      let chunk; try{chunk=JSON.parse(d);}catch{continue;}
      const delta=chunk.choices?.[0]?.delta;
      if(!delta) continue;
      if(delta.content){content+=delta.content; onDelta(content);}
    }
  }
  return {content};
}

function extractProfilePreference(text) {
  const match=String(text||'').trim().match(/^\\s*(?:ajoute|ajouter|note|noter|retiens|retenir|m[ée]morise|m[ée]moriser|souviens-toi|souviens|enregistre|enregistrer|remember|save|persist)\\b\\s+(.+?)\\s*$/i);
  if(!match) return null;
  const preference=String(match[1]||'').replace(/^(?:(?:dans|sur|a|à)\\s+)?(?:mon|ma|le|la|ce|cette)?\\s*(?:profil|profile)\\s+(?:que\\s+)?/i,'').replace(/^que\\s+/i,'').trim().replace(/[.。]\\s*$/,'');
  return preference.length>=3 ? preference : null;
}

async function tryProfilePreferenceUpdate(input,text) {
  if(!window.__WIKI_CONFIG__) return false;
  const preference=extractProfilePreference(text);
  if(!preference) return false;
  input.value=''; input.style.height='auto';
  if(!currentConversationId) currentConversationId=newConversationId();
  messages.push({role:'user',content:text});
  appendMsg('user',text);
  scheduleConversationSave();
  try {
    const res=await fetch('/api/profile/preference',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({preference})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||res.statusText||'Profile update failed');
    const message=data.message||'Profil mis à jour.';
    messages.push({role:'assistant',content:message});
    appendMsg('assistant',message);
    conversationDirty=true;
    await saveCurrentConversation({immediate:true});
    notify(data.changed===false?'Profil déjà à jour':'Profil mis à jour');
  } catch(err) {
    const message=\`Profil non modifié : \${err?.message||String(err)}\`;
    messages.push({role:'assistant',content:message});
    appendMsg('assistant',message);
    conversationDirty=true;
    await saveCurrentConversation({immediate:true});
    notify(message,'e');
  }
  return true;
}

async function tryConnectorCommand(input,text) {
  const match=String(text||'').trim().match(/^\\/connectors?(?:\\s+(.*))?$/i);
  if(!match) return false;
  const args=String(match[1]||'list').trim().split(/\\s+/).filter(Boolean);
  const action=String(args[0]||'list').toLowerCase();
  input.value=''; input.style.height='auto'; hideSkillAc();
  if(!currentConversationId) currentConversationId=newConversationId();
  messages.push({role:'user',content:text});
  appendMsg('user',text);
  scheduleConversationSave();
  const reply=async(message,isError=false)=>{
    messages.push({role:'assistant',content:message});
    appendMsg('assistant',message);
    conversationDirty=true;
    await saveCurrentConversation({immediate:true});
    if(isError) notify(message,'e');
  };
  if(action==='list'&&args.length===1) {
    try {
      const workspace=window.__WIKI_CONFIG__?.workspaceName;
      if(!workspace) throw new Error('No active workspace');
      const response=await callMCPTool('connectors_google_status',{workspace},{trackActivity:false});
      const payload=JSON.parse(response);
      const status=payload?.status==='configured'?'authorized':'not authorized';
      await reply(\`google (Gmail read-only): \${status}\`);
    } catch(err) {
      await reply(\`google (Gmail read-only): unavailable (\${err?.message||String(err)})\`,true);
    }
    return true;
  }
  if(action==='auth'&&args.length===2&&['google','gmail'].includes(String(args[1]).toLowerCase())) {
    // Open synchronously so browser popup blockers do not reject the window
    // after the OAuth-start network round trip.
    const popup=window.open('about:blank','connector-google-oauth','width=980,height=780');
    try {
      const response=await fetch('/api/connectors/google/oauth/start',{
        method:'POST',
        headers:{'content-type':'application/json','x-llm-wiki-oauth':'1'},
        body:JSON.stringify({instanceId:'google-1'}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload?.ok!==true||typeof payload.authorizationUrl!=='string') {
        throw new Error(payload?.error||response.statusText||'Google authorization could not start');
      }
      if(popup) {
        popup.location.replace(payload.authorizationUrl);
        try { popup.opener=null; } catch {}
        await reply('Google authorization opened in a new window. Return here after approval, then run /connector list.');
      } else {
        await reply(\`Popup blocked. Open this URL to authorize Google:\\n\${payload.authorizationUrl}\`);
      }
    } catch(err) {
      if(popup) popup.close();
      await reply(\`Google authorization could not start (\${err?.message||String(err)}).\`,true);
    }
    return true;
  }
  await reply('Usage: /connector list or /connector auth google',true);
  return true;
}

async function sendMessage() {
  if(isStreaming) return;
  const input=$('chat-input');
  const text=input.value.trim();
  const displayOverride=input.dataset.displayText||'';
  const forceChat=input.dataset.forceChat==='1';
  const hideQuestion=input.dataset.hideQuestion==='1';
  delete input.dataset.displayText; delete input.dataset.forceChat; delete input.dataset.hideQuestion;
  if(!text) return;
  if(await tryConnectorCommand(input,text)) return;
  if(await tryProfilePreferenceUpdate(input,text)) return;
  if(agentMode&&!forceChat) {
    await sendRuntimeAgentMessage(input,text,{displayText:displayOverride||text,hideQuestion});
    return;
  }
  // Chat mode: when the runtime is up, delegate to its READ-ONLY turn
  // (mode:'chat') so Donna gets the chatAccess read tools — no local tool loop
  // to duplicate. Only when there is no runtime do we fall back to the
  // tool-less local LLM proxy below.
  if(runtimeEnabled()) {
    await sendRuntimeAgentMessage(input,text,{mode:'chat',displayText:displayOverride||text,hideQuestion});
    return;
  }
  const resolved=await resolveSkillInvocation(text);
  if(displayOverride) resolved.displayText=displayOverride;
  const model=$('model-name').value.trim()||'gpt-4o';
  const parsedTemp=parseFloat($('temperature').value);
  const temp=Number.isFinite(parsedTemp) ? parsedTemp : 0.7;
  const useProxy=!!(window.__WIKI_CONFIG__);
  if(!useProxy && !$('base-url').value.trim()){notify('Enter a Base URL','e');return;}

  input.value=''; input.style.height='auto';
  isStreaming=true; setSendButtonStreaming(true);
  streamAbortController = new AbortController();
  if(!currentConversationId) currentConversationId=newConversationId();
  messages.push({
    role:'user',
    content:resolved.sendText,
    ...(resolved.displayText!==resolved.sendText?{displayContent:resolved.displayText}:{}),
    ...(resolved.skill?{skill:resolved.skill}:{}),
  });
  appendMsg('user',resolved.displayText);
  scheduleConversationSave();

  const llmUrl=useProxy ? '/api/chat' : \`\${$('base-url').value.trim().replace(/\\/$/, '')}/v1/chat/completions\`;
  const llmHeaders=useProxy ? buildProxyLLMHeaders() : buildLLMHeaders();

  let streamDiv=null;
  let streamText='';
  let streamFinalized=false;
  let streamMessagePersisted=false;
  const streamClearSeq=clearChatSeq;
  try {
    const systemPrompt=currentSystemPrompt();
    const langLine=languageInstruction();
    const toolsNotice=chatModeToolsNotice();
    const sysContent=[systemPrompt,toolsNotice,langLine].filter(Boolean).join('\\n\\n');
    const cleanMessages=requestMessagesForLLM(messages);
    const reqMessages=sysContent ? [{role:'system',content:sysContent},...cleanMessages] : cleanMessages;
    const reqBody={model,temperature:temp,messages:reqMessages};
    streamDiv=createStreamBubble();
    const {content}=await fetchStream(llmUrl,llmHeaders,reqBody,t=>{
      streamText=t;
      setStreamContent(streamDiv,t);
    },streamAbortController.signal);
    if(streamAbortController.signal.aborted) return;
    streamText=content;
    const finalContent=String(content||'').trim() ? content : 'No response.';
    setStreamContent(streamDiv,finalContent);
    streamFinalized=true;
    messages.push({role:'assistant',content:finalContent});
    streamMessagePersisted=true;
    conversationDirty=true;
    await saveCurrentConversation({immediate:true});
  } catch(err) {
    if(streamClearSeq!==clearChatSeq) return;
    if(err.name==='AbortError') {
      if(streamDiv) {
        const partial=streamDiv.dataset.copy || 'Response stopped.';
        setStreamContent(streamDiv,partial);
        streamText=partial;
        streamFinalized=true;
        streamDiv.dataset.copy=partial;
        messages.push({role:'assistant',content:partial});
        streamMessagePersisted=true;
      } else {
        const stopped='Response stopped.';
        appendMsg('assistant',stopped);
        messages.push({role:'assistant',content:stopped});
      }
      conversationDirty=true;
      await saveCurrentConversation({immediate:true});
    } else {
      if(streamDiv) {
        const errorText=streamText || \`Error: \${err.message}\`;
        setStreamContent(streamDiv,errorText);
        streamText=errorText;
        streamFinalized=true;
        messages.push({role:'assistant',content:errorText});
        streamMessagePersisted=true;
      } else {
        appendMsg('assistant',\`Error: \${err.message}\`);
      }
      notify(err.message,'e');
      conversationDirty=true;
      await saveCurrentConversation({immediate:true});
    }
  } finally {
    if(streamDiv && !streamFinalized && streamClearSeq===clearChatSeq) {
      const finalText=streamText || (streamAbortController?.signal.aborted ? 'Response stopped.' : '');
      setStreamContent(streamDiv,finalText);
      if(finalText && !streamMessagePersisted) {
        messages.push({role:'assistant',content:finalText});
        conversationDirty=true;
        await saveCurrentConversation({immediate:true});
      }
    }
    isStreaming=false;
    streamAbortController=null;
    setSendButtonStreaming(false);
  }
}

async function sendRuntimeAgentMessage(input,text,{mode,displayText=text,hideQuestion=false}={}) {
  if(!runtimeEnabled()) {
    notify('Runtime is not configured.','e');
    return;
  }
  input.value='';
  input.style.height='auto';
  if(!currentConversationId) currentConversationId=newConversationId();
  const userMessage={role:'user',content:text,...(displayText!==text?{displayContent:displayText}:{})};
  messages.push(userMessage);
  const userEl=appendMsg('user',displayText);
  if(hideQuestion) userEl.classList.add('msg-hidden');
  const statusEl=createRuntimeThinkingBubble(mode==='chat'?'Thinking...':undefined);
  pendingRuntimeStatusEls.push(statusEl);
  // The /state merge consumes this reference instead of appending a duplicate.
  pendingRuntimeUserRefs.push({message:userMessage,el:userEl});
  try {
    const controlBody=JSON.stringify({action:'message',input:text});
    // Read runtimeIsRunning() fresh before and after the request (not hoisted
    // to one shared value): an SSE update can flip it while the fetch below
    // is in flight, and the 409 fallback exists specifically to catch that.
    const runningBeforeFetch=runtimeIsRunning();
    const readOnlyChat=mode==='chat';
    const openWikiPages=readOnlyChat?activePageContexts():[];
    const doTurnFetch=()=>fetch(runningBeforeFetch&&!readOnlyChat?'/api/runtime/control':'/api/runtime/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:runningBeforeFetch&&!readOnlyChat?controlBody:JSON.stringify({input:text,...(mode?{mode}:{}),...(openWikiPages.length?{context:{openWikiPages}}:{})})});
    let res=await doTurnFetch();
    // Transient 503 (host runtime booting/restarting): wait, then replay once.
    if(res.status===503&&(notify('Runtime unavailable — waiting for it to come back…','i'),await waitForRuntimeReady(30000))) res=await doTurnFetch();
    if(!readOnlyChat&&res.status===409&&!runtimeIsRunning()) {
      res=await fetch('/api/runtime/control',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:controlBody,
      });
    }
    let data={};
    try { data=await res.json(); } catch {}
    if(!res.ok && data?.kind!=='ambiguous') {
      let message=res.statusText;
      message=data?.error||data?.message||message;
      throw new Error(\`Runtime \${res.status}: \${message}\`);
    }
    const reply=data?.explanation
      || (data?.kind==='mutate'?'Plan change recorded as a proposal. It is not applied automatically yet.'
        : data?.kind==='enqueue'?'Request queued for a future run.'
          : data?.kind==='ambiguous'?'I am not sure whether this is a question, a change to this run, or a future run. Choose explicitly in the runtime controls.'
            : 'Runtime request accepted. Follow progress in Activity.');
    // A conversational /turn does not imply that a run started. If Donna
    // delegates, the runtime SSE stream will publish the actual run state.
    runtimeState={...(runtimeState||{}),status:data?.status ?? runtimeState?.status ?? 'idle'};
    runtimeConnected=true;
    if(data?.kind!=='turn') {
      if(statusEl) {
        statusEl.remove();
        pendingRuntimeStatusEls=pendingRuntimeStatusEls.filter(el=>el!==statusEl);
      }
      messages.push({role:'assistant',content:reply});
      if(data?.kind==='ambiguous') appendMsg('assistant',runtimeChoiceHTML(text,data.choices),{html:true,plainText:reply});
      else appendMsg('assistant',reply);
    }
    scheduleConversationSave();
    renderActivities();
    updateActivityBadge();
    updateAgentModeUI();
    fetchRuntimeState().catch(()=>{});
  } catch(e) {
    if(statusEl) {
      statusEl.remove();
      pendingRuntimeStatusEls=pendingRuntimeStatusEls.filter(el=>el!==statusEl);
    }
    const errorText=\`No LLM response: \${e?.message||String(e)}\`;
    // A failed runtime turn previously left only a transient notification and
    // a pending user reference. The next state merge could then replay old
    // history around it. Make the failure a real assistant message and retire
    // the pending marker immediately.
    const pendingIndex=pendingRuntimeUserRefs.findIndex(ref=>ref.message===userMessage);
    if(pendingIndex>=0) pendingRuntimeUserRefs.splice(pendingIndex,1);
    messages.push({role:'assistant',content:errorText});
    appendMsg('assistant',errorText);
    conversationDirty=true;
    await saveCurrentConversation({immediate:true});
    notify(errorText,'e');
  }
}

async function sendRuntimeControlChoice(intent,text) {
  if(!runtimeEnabled()) {
    notify('Runtime is not configured.','e');
    return;
  }
  try {
    const res=await fetch('/api/runtime/control',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:intent==='enqueue'?'enqueue':'message',intent,input:text}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data?.error||data?.message||\`Runtime \${res.status}\`);
    const reply=data?.explanation
      || (data?.kind==='enqueue'?'Request queued for a future run.'
        : data?.kind==='mutate'?'Plan change recorded as a proposal. It is not applied automatically yet.'
          : data?.kind==='observe'?'Runtime status refreshed.'
            : 'Runtime control accepted.');
    messages.push({role:'assistant',content:reply});
    appendMsg('assistant',reply);
    scheduleConversationSave();
    fetchRuntimeState().catch(()=>{});
    renderActivities();
    updateActivityBadge();
  } catch(e) {
    notify(e?.message||String(e),'e');
  }
}

// ── Champs secrets ──────────────────────────────────────────────────────────

${CONFIG_SCRIPT}

${WIKI_PANEL_SCRIPT}

// ── Init ────────────────────────────────────────────────────────────────────
async function initChat() {
  applyWorkspaceTitle();
  loadConfig();
  await loadConfigProfiles();
  loadServers();
  initPageMode();
  initShellTabs();
  await loadHistory();
  initSidebarSplitter();
  initMainSplitter();
  renderProductionTrace();
  updateAgentModeUI();
  await Promise.all([restoreEnabledServers(),fetchSkillsAc()]);
  window.addEventListener('popstate', initPageMode);
}
initChat();
</script>`;

export const CHAT_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Donna</title>
<script>try{const t=localStorage.getItem('llm-wiki:theme')||localStorage.getItem('llm-wiki:graph:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.classList.add('theme-'+(t==='dark'?'dark':'light'))}catch{}</script>
${CHAT_STYLE}
<script src="/assets/marked.min.js"></script>
<script src="/assets/d3.min.js"></script>
</head>
<body>
${CHAT_BODY}
</body>
</html>`;
