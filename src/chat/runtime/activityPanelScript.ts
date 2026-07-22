export const ACTIVITY_PANEL_SCRIPT = `/* ── Activity Panel ─────────────────────────────────────────────────── */
const ACT_STORE_KEY=storageKey('llm-wiki-chat:activities');
const ACT_PANEL_KEY=storageKey('llm-wiki-chat:activity-panel-open');
let _activities=[];
let _actTimer=null;
let runtimeState=null;
let runtimeConnected=false;
let runtimeFetchPending=false;
// Index-aligned with runtimeState.conversation — see mergeRuntimeConversation
// in chatHtml.ts. Not just a length count: a turn can finalize a streaming
// placeholder in place (text-before-tool-calls case) without the runtime
// conversation array growing, and a length-based diff would miss that.
let runtimeConversationRefs=[];
// Index in the runtime's workspace-wide event conversation at which the
// current browser conversation starts. The runtime log intentionally survives
// browser clears; this cursor prevents that older log from being replayed into
// a new/cleared/local history entry.
let runtimeConversationOffset=null;
// FIFO queue, not a single slot: sending a second message before the first
// is confirmed by the merge (e.g. a busy/streaming run delays the fetch that
// would have consumed it) must not silently drop the first entry's pending
// marker, or it gets appended a second time as an unmatched "new" turn.
let pendingRuntimeUserRefs=[];
// Transient acknowledgements for accepted Agent turns. They are DOM-only:
// the real runtime assistant event replaces them and only that real reply is
// persisted in conversation history.
let pendingRuntimeStatusEls=[];
// Single reset entry point for the pair above — call this at every local
// conversation boundary (new/load/delete/clear), not just some of them:
// stale index-aligned refs reused against a fresh messages array is a real
// bug, not just a style issue, so this must not be re-inlined per call site.
function resetRuntimeConversationTracking() {
  runtimeConversationRefs=[];
  runtimeConversationOffset=Array.isArray(runtimeState?.conversation)
    ? runtimeState.conversation.length
    : null;
  pendingRuntimeUserRefs=[];
  pendingRuntimeStatusEls.forEach(el=>el?.remove());
  pendingRuntimeStatusEls=[];
}
// Agent mode is deliberately session-only: every fresh serve page starts in
// local chat mode, even if an older release persisted an Agent preference.
let agentMode=false;
// Never persisted across page loads: always start on 'list' — a 'graph'
// choice from a previous session left the Activity panel opening straight
// into the cramped inline graph+inspector layout on every subsequent load,
// which read as broken rather than a deliberate default.
let activityView='list';
let activityListTab='plan';
const activityClearedFingerprints={plan:null,runtime:null,logs:null};
let selectedWorkflowNodeId=null;
const _activityPollTimers=new Map();
function isActivityActive(status){return status==='running'||status==='queued';}
function clearPollTimer(id){const t=_activityPollTimers.get(id);if(t)clearTimeout(t);_activityPollTimers.delete(id);}

function activityTerminalStatus(status) {
  return ['done','success','completed','complete','converted','stored','failed','error','cancelled','canceled'].includes(String(status||'').toLowerCase());
}
function normalizeActivityStatus(status, terminal=false) {
  const value=String(status||'').toLowerCase();
  if(['done','success','completed','complete','converted'].includes(value)) return 'done';
  if(value==='stored') return 'stored';
  if(['failed','error'].includes(value)) return 'failed';
  if(['cancelled','canceled'].includes(value)) return 'cancelled';
  if(['queued','pending','starting'].includes(value)) return 'queued';
  if(value==='running'||!terminal) return 'running';
  return value||'done';
}
function activitySourceLabel(source) {
  const labels={production:'Production',cme:'CME',documents:'Documents',mailer:'Mailer'};
  return labels[source]||source||'MCP';
}
function activityToolLabel(tool,args={}) {
  const labels={
    production_start_job:'Production job',
    production_cancel_job:'Cancel production',
    cme_export_run:'Confluence export',
    cme_export_cancel:'Cancel Confluence export',
    cme_setup:'Configure CME',
    cme_source_add:'Add Confluence source',
    cme_source_remove:'Remove Confluence source',
    documents_convert_to_markdown:'Document conversion',
    mailer_send_email:args.dryRun?'Email preview':'Send email',
  };
  return labels[tool]||String(tool||'MCP action').replace(/_/g,' ');
}
function activitySourceForTool(tool,server) {
  const prefix=String(tool||'').split('_')[0];
  if(['production','cme','documents','mailer'].includes(prefix)) return prefix;
  return String(server?.name||prefix||'mcp').toLowerCase();
}
function shouldTrackMcpTool(tool,server=null) {
  const definition=mcpToolDefinition(tool,server);
  if(isObserverToolName(tool,server)) return false;
  if(definition?.annotations?.readOnlyHint===false||definition?.annotations?.destructiveHint===true) return true;
  return /(?:^|_)(?:start|run|send|create|add|remove|delete|update|setup|configure|convert|cancel|import|export|ingest|build|polish)(?:_|$)/i.test(String(tool||''));
}
function activityArgsSummary(tool,args={}) {
  if(String(tool).startsWith('mailer_')) return [args.to,args.subject].filter(Boolean).join(' · ');
  if(String(tool).startsWith('cme_')) return [args.source_name||args.name,args.workspace].filter(Boolean).join(' · ');
  if(String(tool).startsWith('production_')) return [args.type,...(args.steps||[])].filter(Boolean).join(' · ');
  if(String(tool).startsWith('documents_')) return args.filename||args.filePath||'';
  return Object.entries(args||{})
    .filter(([,value])=>value!==null&&value!==undefined&&['string','number','boolean'].includes(typeof value))
    .slice(0,3)
    .map(([key,value])=>key+': '+shortText(value,60))
    .join(' · ');
}
function activityResultSummary(data,raw='') {
  if(!data||typeof data!=='object') return shortText(raw,180);
  const status=data.status||data.state||data.result||null;
  return [
    status?String(status):null,
    data.messageId?'messageId: '+data.messageId:null,
    data.dryRun===true?'Preview only':null,
    data.outputPath?uploadOutputLabel(data.outputPath):null,
    data.message||data.summary||data.detail,
  ].filter(Boolean).join(' · ')||shortText(raw,180);
}
function activityFromContract(contract, fallback={}) {
  const terminal=contract?.terminal===true||activityTerminalStatus(contract?.status);
  return {
    ...fallback,
    remoteId:String(contract?.id||fallback.remoteId||fallback.id||''),
    source:String(contract?.source||fallback.source||'mcp'),
    kind:String(contract?.kind||fallback.kind||'mcp'),
    label:String(contract?.label||fallback.label||activitySourceLabel(contract?.source)),
    status:normalizeActivityStatus(contract?.status,terminal),
    progress:contract?.progress||fallback.progress||null,
    plan:contract?.plan||fallback.plan||null,
    poll:terminal?null:(contract?.poll||fallback.poll||null),
    error:contract?.error||fallback.error||null,
    terminal,
    startedAt:contract?.startedAt||fallback.startedAt||Date.now(),
    updatedAt:Date.now(),
  };
}
function activityByRemoteId(remoteId,source) {
  return _activities.find(item=>item.remoteId===String(remoteId)&&(!source||item.source===source));
}
function ingestMcpActivityResult(tool,args,server,result,{activityId=null,error=null}={}) {
  const raw=typeof result==='string'?result:JSON.stringify(result??{});
  const data=parseToolJSON(result);
  const contract=data?._activity;
  const source=activitySourceForTool(tool,server);
  const existing=(contract?.id&&activityByRemoteId(contract.id,contract.source||source))
    ||(activityId&&_activities.find(item=>item.id===activityId));
  const id=existing?.id||activityId||'mcp-'+source+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const fallback={
    id,kind:'mcp',source,sourceLabel:server?.name||activitySourceLabel(source),tool,args,
    label:activityToolLabel(tool,args),
    detail:activityArgsSummary(tool,args),
    status:error?'failed':'done',
    error:error?String(error):null,
    resultSummary:error?null:activityResultSummary(data,raw),
    startedAt:existing?.startedAt||Date.now(),
  };
  if(contract) {
    upsertActivity(activityFromContract(contract,{...existing,...fallback,id}));
    return id;
  }
  if(existing||shouldTrackMcpTool(tool,server)||error) {
    const failed=error||data?.ok===false;
    upsertActivity({
      ...existing,...fallback,id,
      status:failed?'failed':'done',
      error:error?String(error):(data?.error||null),
      terminal:true,
      poll:null,
    });
  }
  return id;
}
function scheduleActivityPoll(item) {
  if(!item?.poll?.tool||item.terminal||activityTerminalStatus(item.status)) return;
  if(item.source==='production') return;
  if(_activityPollTimers.has(item.id)) return;
  const delay=Math.max(750,Number(item.poll.intervalMs)||2500);
  const timer=setTimeout(async()=>{
    _activityPollTimers.delete(item.id);
    try {
      const result=await callMCPTool(item.poll.tool,item.poll.args||{},{trackActivity:false});
      ingestMcpActivityResult(item.poll.tool,item.poll.args||{},findServerForTool(item.poll.tool),result,{activityId:item.id});
    } catch(error) {
      upsertActivity({...item,status:'failed',terminal:true,poll:null,error:error?.message||String(error)});
    }
  },delay);
  _activityPollTimers.set(item.id,timer);
}

function loadActivities() {
  try { _activities=JSON.parse(localStorage.getItem(ACT_STORE_KEY)||'[]'); } catch { _activities=[]; }
  let changed=false;
  _activities=_activities.map(item=>{
    if(!isActivityActive(item.status)) return item;
    if(item.poll?.tool) return item;
    changed=true;
    return {...item,status:'failed',error:item.error||'Interrupted by page reload. Retry the conversion if available.',updatedAt:Date.now()};
  });
  if(changed) saveActivities();
}
function saveActivities() {
  const keep=_activities.slice(-60);
  _activities=keep;
  try { localStorage.setItem(ACT_STORE_KEY,JSON.stringify(keep)); } catch {}
}
function upsertActivity(item) {
  const idx=_activities.findIndex(a=>a.id===item.id);
  let merged;
  if(idx>=0) { merged={..._activities[idx],...item,updatedAt:Date.now()}; _activities[idx]=merged; }
  else { merged={...item,updatedAt:Date.now(),startedAt:item.startedAt||Date.now()}; _activities.push(merged); }
  saveActivities();
  renderActivities();
  updateActivityBadge();
  if(isActivityActive(merged.status)&&!_actTimer) _actTimer=setInterval(renderActivities,1000);
  if(!isActivityActive(merged.status)){const anyRunning=_activities.some(a=>isActivityActive(a.status));if(!anyRunning){clearInterval(_actTimer);_actTimer=null;}}
  scheduleActivityPoll(merged);
}
function dismissActivity(id) {
  clearPollTimer(id);
  _activities=_activities.filter(a=>a.id!==id);
  saveActivities(); renderActivities(); updateActivityBadge();
}
function activityTabFingerprint(tab) {
  if(!runtimeState) return 'empty';
  if(tab==='plan') return JSON.stringify([runtimeState.runId,runtimeState.currentRunId,runtimeState.plan,runtimeState.queue,runtimeState.workflow?.nodes?.filter(node=>node.type==='task'||node.type==='queue')]);
  if(tab==='runtime') return JSON.stringify([runtimeState.runId,runtimeState.currentRunId,runtimeState.activities,runtimeState.workflow?.activity,runtimeState.workflow?.nodes?.filter(node=>node.type==='activity')]);
  if(tab==='logs') return JSON.stringify(runtimeState.logs||[]);
  return '';
}
function activityTabWasCleared(tab) {
  const fingerprint=activityClearedFingerprints[tab];
  return fingerprint!==null&&fingerprint===activityTabFingerprint(tab);
}
function clearActivityTab(tab,{render=true}={}) {
  if(tab==='local') {
    _activities.forEach(item=>clearPollTimer(item.id));
    _activities=[];
    saveActivities();
  } else if(['plan','runtime','logs'].includes(tab)) {
    activityClearedFingerprints[tab]=activityTabFingerprint(tab);
  }
  if(render) { renderActivities(); updateActivityBadge(); }
}
function clearAllActivityTabs() {
  ['plan','local','runtime','logs'].forEach(tab=>clearActivityTab(tab,{render:false}));
  renderActivities(); updateActivityBadge();
}
async function resetRuntimePlan() {
  if(!runtimeEnabled()) { notify('Runtime is not configured.','e'); return; }
  if(!confirm('Reset the current plan? This stops active work and clears the runtime plan, activities, logs and queue for this workspace.')) return;
  try {
    const res=await fetch('/api/runtime/reset',{method:'POST'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Runtime plan reset failed');
    activityClearedFingerprints.plan=null;
    activityClearedFingerprints.runtime=null;
    activityClearedFingerprints.logs=null;
    await fetchRuntimeState();
    notify('Runtime plan reset');
  } catch(err) {
    notify(err?.message||String(err),'e');
  }
}
function actElapsed(item) {
  const started=Number(item.startedAt)||Date.now();
  const finished=!isActivityActive(item.status)
    ? Number(item.finishedAt||item.completedAt||item.endedAt||item.updatedAt)||Date.now()
    : Date.now();
  return Math.max(0,Math.round((finished-started)/1000));
}
function actUploadSteps(item) {
  const st=item.status;
  const storeRunning=st==='running'&&item.phase!=='conversion';
  if(st==='running') return [
    {state:storeRunning?'running':'done',label:'Storage',val:storeRunning?'running...':'ok'},
    {state:storeRunning?'pending':'running',label:'Conversion',val:storeRunning?'–':'running...'},
    {state:'pending',label:'Write Markdown',val:'–'},
  ];
  if(st==='converted') return [
    {state:'done',label:'Storage',val:'ok'},
    {state:'done',label:'Conversion',val:item.method||'ok'},
    {state:'done',label:'Write Markdown',val:'ok'},
  ];
  if(st==='stored') return [
    {state:'done',label:'Storage',val:'ok'},
    {state:'pending',label:'Conversion',val:'no agent'},
    {state:'pending',label:'Write Markdown',val:'–'},
  ];
  return [
    {state:'done',label:'Storage',val:'ok'},
    {state:'failed',label:'Conversion',val:'failed'},
    {state:'pending',label:'Write Markdown',val:'–'},
  ];
}
const ACT_CARD_BADGES={running:'Running',done:'Done',stored:'Stored',cancelled:'Cancelled',failed:'Failed'};
function actCardHTML(item) {
  const running=isActivityActive(item.status);
  const converted=item.status==='converted';
  const stored=item.status==='stored';
  const elapsed=actElapsed(item);
  const size=formatBytes(item.bytes);
  const meta=[size,elapsed>0?elapsed+'s':null].filter(Boolean).join(' · ');
  const done=item.status==='done';
  const badge=item.error?'failed':running?'running':(converted||done)?'done':stored?'stored':item.status==='cancelled'?'cancelled':'failed';
  const badgeLabel=ACT_CARD_BADGES[badge];
  const steps=item.kind==='upload'?actUploadSteps(item):activityPlanSteps(item);
  const stepsHtml=steps.map(s=>\`<div class="act-step \${s.state}"><span class="act-step-dot"></span><span class="act-step-label">\${esc(s.label)}</span><span class="act-step-val">\${esc(s.val)}</span></div>\`).join('');
  const output=item.outputPath?uploadOutputLabel(item.outputPath):(item.resultSummary||null);
  const outputHtml=output?\`<div class="act-output" title="\${esc(output)}" onclick="copyText(\${esc(JSON.stringify(output))})">\${esc(output)}</div>\`:'';
  const errorHtml=item.error?\`<div class="act-error">\${esc(item.error)}</div>\`:'';
  const runtimeCard=String(item.kind||'').startsWith('runtime');
  const retryHtml=(item.status==='stored'||item.status==='failed')&&item.uploadId
    ?\`<button class="act-btn" onclick="retryConvert(\${esc(JSON.stringify(item.uploadId))},\${esc(JSON.stringify(item.id))})">Retry</button>\`
    :'';
  const statusHtml=runtimeCard?\`<button class="act-btn" onclick="askRuntimeStatus(\${esc(JSON.stringify(item.statusTarget||item.remoteId||item.id))})">Status</button>\`:'';
  const dismissHtml=runtimeCard?'':\`<button class="act-btn del" onclick="dismissActivity(\${esc(JSON.stringify(item.id))})">Dismiss</button>\`;
  const hint=converted?\`<div class="act-card-meta">Ready · run ingest to integrate.</div>\`
    :stored?\`<div class="act-card-meta">Stored, no conversion agent.</div>\`
    :'';
  const icon={production:'⚙',cme:'⇄',documents:'📄',mailer:'✉'}[item.source]||(item.kind==='upload'?'📄':'⌁');
  const cardTitle=String(item.label||item.filename||'-');
  const sourceMeta=item.source&&item.kind!=='upload'?(item.sourceLabel||activitySourceLabel(item.source)):null;
  const seenMeta=new Set([cardTitle.trim().toLowerCase()]);
  const fullMeta=[sourceMeta,item.detail,meta].filter(value=>{
    const normalized=String(value||'').trim().toLowerCase();
    if(!normalized||seenMeta.has(normalized)) return false;
    seenMeta.add(normalized);
    return true;
  }).join(' · ');
  return \`<div class="act-card \${running?'running':''}" data-act-id="\${esc(item.id)}">
<div class="act-card-head"><span class="act-card-icon">\${icon}</span><div class="act-card-info"><div class="act-card-name">\${esc(cardTitle)}</div>\${fullMeta?\`<div class="act-card-meta">\${esc(fullMeta)}</div>\`:''}</div><span class="act-badge \${badge}">\${badgeLabel}</span></div>
\${stepsHtml?\`<div class="act-steps">\${stepsHtml}</div>\`:''}
\${outputHtml}\${errorHtml}\${hint}
\${retryHtml||statusHtml||dismissHtml?\`<div class="act-actions">\${retryHtml}\${statusHtml}\${dismissHtml}</div>\`:''}
</div>\`;
}
function activityPlanSteps(item) {
  const planSteps=Array.isArray(item.plan?.steps)?item.plan.steps:[];
  const progress=item.progress||{};
  if(planSteps.length) {
    const stepId=String(progress.stepId||'');
    const matchedIndex=stepId?planSteps.findIndex(step=>String(step.id||step.name||'')===stepId):-1;
    const activeIndex=matchedIndex>=0?matchedIndex:Math.max(0,Number(progress.stepIndex||1)-1);
    return planSteps.map((step,index)=>({
      state:item.status==='failed'&&index===activeIndex?'failed':index<activeIndex?'done':index===activeIndex&&!item.terminal?'running':item.terminal&&item.status==='done'?'done':'pending',
      label:step.label||step.name||step.id||'Step '+(index+1),
      val:index===activeIndex
        ? (progress.detail||(progress.percent!==undefined?String(Math.round(Number(progress.percent)||0))+'%':''))
        : '',
    }));
  }
  if(item.progress) return [{
    state:item.status==='failed'?'failed':item.terminal?'done':'running',
    label:progress.step||progress.stepId||activityToolLabel(item.tool,item.args),
    val:progress.detail||(progress.percent!==undefined?String(Math.round(Number(progress.percent)||0))+'%':''),
  }];
  return [];
}
function renderActivities() {
  const el=$('activity-body');
  if(!el) return;
  syncActivityViewTabs();
  el.classList.toggle('activity-list-mode',activityView==='list');
  if(activityView==='graph') {
    // The graph view owns the DOM now: drop the list-render fingerprint so
    // switching back to list mode always redraws instead of being skipped.
    el.__renderedHTML=null;
    const center=$('runtime-graph-center');
    if(document.body.classList.contains('execution-mode')&&center) {
      center.innerHTML=runtimeWorkflowGraphCenterHTML();
      el.innerHTML=runtimeWorkflowInspectorHTML();
    } else {
      if(center) center.innerHTML='';
      el.innerHTML=runtimeWorkflowGraphHTML();
    }
    requestAnimationFrame(renderRuntimeWorkflowGraph);
    return;
  }
  const center=$('runtime-graph-center');
  if(center&&!document.body.classList.contains('execution-mode')) center.innerHTML='';
  const rev=[..._activities].reverse();
  const uploads=rev.filter(a=>a.kind==='upload');
  const mcp=rev.filter(a=>a.kind!=='upload');
  const section=(title,items)=>items.length?\`<div class="act-section-head"><span class="act-section-title">\${title}</span></div>\${items.map(actCardHTML).join('')}\`:'';
  const localHTML=section('Uploads',uploads)+section('MCP',mcp);
  const panes={
    plan:activityTabWasCleared('plan')?'':runtimeTaskPanelHTML('plan'),
    runtime:activityTabWasCleared('runtime')?'':runtimeTaskPanelHTML('runtime'),
    logs:activityTabWasCleared('logs')?'':runtimeTaskPanelHTML('logs'),
    local:localHTML,
  };
  const labels={plan:'Plan',local:'Direct agents',runtime:'Runtime activity',logs:'Logs'};
  const localTabState=uploads.some(item=>item.error||item.status==='failed')?'has-error':uploads.some(item=>isActivityActive(item.status))?'has-running':'';
  const tabs=Object.entries(labels).map(([key,label])=>\`<button class="activity-subtab \${activityListTab===key?'active':''} \${key==='local'?localTabState:''}" type="button" onclick="setActivityListTab('\${key}')">\${label}</button>\`).join('');
  const empty=\`<div class="act-empty">No \${labels[activityListTab].toLowerCase()} yet.</div>\`;
  const resetPlan=activityListTab==='plan'?'<button class="activity-subtab-reset" type="button" onclick="resetRuntimePlan()">Reset plan</button>':'';
  const toolbar=\`<div class="activity-subtab-toolbar"><span class="activity-subtab-toolbar-title">\${labels[activityListTab]}</span><span class="activity-subtab-actions">\${resetPlan}<button class="activity-subtab-clear" type="button" onclick="clearActivityTab('\${activityListTab}')">Clear</button></span></div>\`;
  const html=\`<div class="activity-subtabs" role="tablist" aria-label="Activity list sections">\${tabs}</div><div class="activity-subtab-content activity-subtab-\${activityListTab}">\${toolbar}\${panes[activityListTab]||empty}</div>\`;
  // The panel re-renders every second while a run is active; replacing
  // innerHTML unconditionally reset the scroll position each tick, making it
  // impossible to scroll through past plan items or events during a run.
  // Skip the DOM write when nothing changed, and otherwise restore the
  // reader's position — pinning to the newest entries only when the reader
  // was already there. Tab switches render fresh (no cross-tab restore).
  const sameTab=el.__renderedTab===activityListTab;
  el.__renderedTab=activityListTab;
  if(el.__renderedHTML===html&&sameTab) return finishActivityRender();
  const scroller=el.querySelector('.activity-subtab-content');
  const scrollerTop=sameTab&&scroller?scroller.scrollTop:0;
  const log=document.getElementById('runtime-log-list');
  const logTop=sameTab&&log?log.scrollTop:0;
  el.innerHTML=html;
  el.__renderedHTML=html;
  const nextScroller=el.querySelector('.activity-subtab-content');
  if(nextScroller&&scrollerTop>0) nextScroller.scrollTop=scrollerTop;
  const nextLog=document.getElementById('runtime-log-list');
  // Newest-first log: stay pinned to the top only if the reader was there.
  if(nextLog) nextLog.scrollTop=logTop<40?0:logTop;
  return finishActivityRender();
}
function finishActivityRender() {
  const runtimeRunning=Array.isArray(runtimeState?.activities)
    ? runtimeState.activities.some(a=>isActivityActive(normalizeActivityStatus(a.status,a.terminal)))
    : false;
  const anyRunning=_activities.some(a=>isActivityActive(a.status))||runtimeRunning;
  if(anyRunning&&!_actTimer) _actTimer=setInterval(renderActivities,1000);
  if(!anyRunning&&_actTimer){clearInterval(_actTimer);_actTimer=null;}
}
function setActivityListTab(tab) {
  if(!['plan','runtime','logs','local'].includes(tab)) return;
  activityListTab=tab;
  renderActivities();
}
function updateActivityBadge() {
  const runtimeCount=Array.isArray(runtimeState?.activities)?runtimeState.activities.filter(a=>isActivityActive(normalizeActivityStatus(a.status,a.terminal))).length:0;
  const count=_activities.filter(a=>isActivityActive(a.status)).length+runtimeCount;
  const railBadge=$('rail-act-badge');
  if(railBadge) {
    railBadge.textContent=count>0?String(count):'';
    railBadge.classList.toggle('show',count>0);
  }
  const panelOpen=!$('activity-panel')?.classList.contains('closed');
  const railBtn=$('activity-toggle');
  if(railBtn) {
    railBtn.classList.toggle('active',panelOpen);
    railBtn.setAttribute('aria-expanded',panelOpen?'true':'false');
  }
}
function toggleActivityPanel() {
  const panel=$('activity-panel');
  if(!panel) return;
  if(panel.classList.contains('closed')) $('help-panel')?.classList.add('closed');
  const opening=panel.classList.toggle('closed');
  try { localStorage.setItem(ACT_PANEL_KEY,opening?'0':'1'); } catch {}
  updateActivityBadge();
}
function openActivityPanel() {
  const panel=$('activity-panel');
  if(!panel) return;
  panel.classList.remove('closed');
  try { localStorage.setItem(ACT_PANEL_KEY,'1'); } catch {}
  updateActivityBadge();
}
function setActivityView(view) {
  activityView=view==='graph'?'graph':'list';
  if(activityView==='graph'&&!document.body.classList.contains('execution-mode')) {
    document.body.classList.remove('connectors-mode');
    document.body.classList.add('execution-mode');
    if(location.pathname.replace(/\\/+$/,'')!=='/chat/execution') history.pushState(null,'','/chat/execution');
  } else if(activityView==='list'&&document.body.classList.contains('execution-mode')) {
    showChatView();
    return;
  }
  renderActivities();
}
function syncActivityViewTabs() {
  $('act-view-list')?.classList.toggle('active',activityView==='list');
  $('act-view-graph')?.classList.toggle('active',activityView==='graph');
}
function copyText(text) {
  navigator.clipboard?.writeText(text).then(()=>notify('Copied')).catch(()=>notify(text));
}
function runtimeStatusMarkdown(target) {
  const id=String(target||'current run').trim()||'current run';
  if(!runtimeState) return \`No runtime state available for \${id}.\`;
  const plan=Array.isArray(runtimeState.plan)?runtimeState.plan:[];
  const activities=Array.isArray(runtimeState.activities)?runtimeState.activities:[];
  const queue=Array.isArray(runtimeState.queue)?runtimeState.queue:[];
  const logs=filteredRuntimeLogs(runtimeState.logs);
  const line=(label,value)=>\`- \${label}: \${value||'-'}\`;
  const matches=(item,fields)=>fields.some(field=>String(item?.[field]||'')===id);
  const focusedPlan=plan.find(item=>matches(item,['id','step','description','label']));
  const focusedActivity=activities.find(item=>matches(item,['id','key','label','tool']));
  const focusedQueue=queue.find(item=>matches(item,['id','jobId','label','tool']));
  const focused=focusedPlan||focusedActivity||focusedQueue||null;
  const focusedKind=focusedPlan?'Plan task':focusedActivity?'Runtime activity':focusedQueue?'Queue item':null;
  const focusLines=focused?[focusedKind,line('Target',id),line('Status',focused.status),line('Label',focused.description||focused.label||focused.tool||focused.id),line('Progress',focused.progress?.detail||focused.progress?.step||focused.progress?.percent),line('Error',focused.error)].join('\\n'):line('Requested target',id+' (no exact structured match)');
  const planLines=plan.slice(0,8).map((step,index)=>line(\`Plan \${step.step||index+1}\`,\`\${step.status||'pending'} - \${step.description||step.label||step.id||'step'}\`));
  const activityLines=activities.slice(0,8).map((activity,index)=>line(activity.id||activity.key||\`Activity \${index+1}\`,\`\${activity.status||'-'} - \${activity.label||activity.tool||activity.source||'runtime'}\`));
  const queueLines=queue.slice(0,8).map((item,index)=>line(item.id||item.jobId||\`Queue \${index+1}\`,\`\${item.status||'waiting'} - \${item.label||item.tool||item.type||'task'}\`));
  return [
    \`Runtime status for \${id}\`,
    '',
    line('Runtime',runtimeState.status||'idle'),
    line('Connection',runtimeConnected?'connected':'disconnected'),
    '',
    focusLines,
    '',
    planLines.length?['Plan',...planLines].join('\\n'):'Plan\\n- No plan visible.',
    '',
    activityLines.length?['Activities',...activityLines].join('\\n'):'Activities\\n- No runtime activity visible.',
    '',
    queueLines.length?['Queue',...queueLines].join('\\n'):'Queue\\n- No pending items.',
    logs.length?['','Recent logs',...logs.map(log=>\`- \${log}\`)].join('\\n'):'',
  ].filter(Boolean).join('\\n');
}
function askRuntimeStatus(target) {
  const id=String(target||'current run').trim()||'current run';
  const display=\`Status of \${id}\`;
  const raw=runtimeStatusMarkdown(id);
  const prompt=\`Présente clairement le statut de la cible « \${id} » pour l'utilisateur. Commence par cette tâche ou activité précise, puis donne seulement le contexte global utile : progression, dépendances, blocages, éléments en attente et prochaine action recommandée. Ne confonds pas la cible avec les autres tâches et ne reproduis pas les logs bruts sauf s'ils expliquent un problème.\n\n\${raw}\`;
  showChatView();
  const input=$('chat-input');
  if(!input||isStreaming) return;
  input.value=prompt;
  input.dataset.displayText=display;
  input.dataset.forceChat='1';
  input.dataset.hideQuestion='1';
  sendMessage();
}
async function retryConvert(uploadId, actId) {
  upsertActivity({id:actId,status:'running',phase:'conversion',error:null,outputPath:null,startedAt:Date.now()});
  try {
    const res=await fetch(\`/api/uploads/\${encodeURIComponent(uploadId)}/convert\`,{method:'POST'});
    const data=await res.json().catch(()=>({ok:false,error:'Invalid response'}));
    if(!res.ok||data.ok===false) throw new Error(data.error||\`HTTP \${res.status}\`);
    const u=data.upload||{};
    upsertActivity({id:actId,status:u.status,outputPath:u.outputPath,method:u.method,error:u.error||null});
    if(u.status==='converted'&&u.outputPath) addPageContext(uploadOutputLabel(u.outputPath));
    notify(u.status==='converted'?'Converted':'Stored');
  } catch(err) {
    upsertActivity({id:actId,status:'failed',error:err?.message||String(err)});
    notify(err?.message||String(err),'e');
  }
}
(function initActivityPanel(){
  loadActivities();
  renderActivities();
  updateActivityBadge();
  try {
    const open=localStorage.getItem(ACT_PANEL_KEY)==='1';
    if(open) $('activity-panel')?.classList.remove('closed');
  } catch {}
  if(_activities.some(a=>isActivityActive(a.status))&&!_actTimer) _actTimer=setInterval(renderActivities,1000);
  _activities.forEach(scheduleActivityPoll);
  connectRuntimePanel();
})();
// The runtime is a host process that can lag behind the serve container
// (first boot, manager restart). A 503 on a turn is almost always transient:
// callers wait for /state to answer again, then replay the turn once,
// instead of surfacing a dead-end "No LLM response" error.
async function waitForRuntimeReady(timeoutMs){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    try {
      const res=await fetch('/api/runtime/state',{cache:'no-store'});
      if(res.ok) return true;
    } catch {}
    await new Promise(r=>setTimeout(r,2000));
  }
  return false;
}
/* ── end Activity Panel ─────────────────────────────────────────────── */`;
