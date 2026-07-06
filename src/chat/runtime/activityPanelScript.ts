export const ACTIVITY_PANEL_SCRIPT = `/* ── Activity Panel ─────────────────────────────────────────────────── */
const ACT_STORE_KEY=storageKey('llm-wiki-chat:activities');
const ACT_PANEL_KEY=storageKey('llm-wiki-chat:activity-panel-open');
const AGENT_MODE_KEY=storageKey('llm-wiki-chat:agent-mode');
const RUNTIME_SECTION_KEY_PREFIX='llm-wiki-chat:runtime-section:';
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
// FIFO queue, not a single slot: sending a second message before the first
// is confirmed by the merge (e.g. a busy/streaming run delays the fetch that
// would have consumed it) must not silently drop the first entry's pending
// marker, or it gets appended a second time as an unmatched "new" turn.
let pendingRuntimeUserRefs=[];
// Single reset entry point for the pair above — call this at every local
// conversation boundary (new/load/delete/clear), not just some of them:
// stale index-aligned refs reused against a fresh messages array is a real
// bug, not just a style issue, so this must not be re-inlined per call site.
function resetRuntimeConversationTracking() {
  runtimeConversationRefs=[];
  pendingRuntimeUserRefs=[];
}
let agentMode=localStorage.getItem(AGENT_MODE_KEY)==='1';
// Never persisted across page loads: always start on 'list' — a 'graph'
// choice from a previous session left the Activity panel opening straight
// into the cramped inline graph+inspector layout on every subsequent load,
// which read as broken rather than a deliberate default.
let activityView='list';
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
function dismissAllDone() {
  for(const item of _activities.filter(a=>!isActivityActive(a.status))) clearPollTimer(item.id);
  _activities=_activities.filter(a=>isActivityActive(a.status));
  saveActivities(); renderActivities(); updateActivityBadge();
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
  const badge=running?'running':(converted||done)?'done':stored?'stored':item.status==='cancelled'?'cancelled':'failed';
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
  const sourceMeta=item.source&&item.kind!=='upload'?(item.sourceLabel||activitySourceLabel(item.source)):null;
  const fullMeta=[sourceMeta,item.detail,meta].filter(Boolean).join(' · ');
  return \`<div class="act-card \${running?'running':''}" data-act-id="\${esc(item.id)}">
<div class="act-card-head"><span class="act-card-icon">\${icon}</span><div class="act-card-info"><div class="act-card-name">\${esc(item.label||item.filename||'-')}</div>\${fullMeta?\`<div class="act-card-meta">\${esc(fullMeta)}</div>\`:''}</div><span class="act-badge \${badge}">\${badgeLabel}</span></div>
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
  if(activityView==='graph') {
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
  if(!_activities.length&&!runtimeState){
    const guideBtn=findSkillByName('guide')?\`<br><button class="act-empty-btn" type="button" onclick="submitSuggestion('/guide')">Start setup guide</button>\`:'';
    el.innerHTML=\`<div class="act-empty">No activity yet.\${guideBtn}</div>\`;
    return;
  }
  const rev=[..._activities].reverse();
  const uploads=rev.filter(a=>a.kind==='upload');
  const mcp=rev.filter(a=>a.kind!=='upload');
  const hasDone=_activities.some(a=>!isActivityActive(a.status));
  const dismissBtn=hasDone?\`<button class="act-dismiss-all" onclick="dismissAllDone()">Clear all</button>\`:'';
  const section=(title,items)=>items.length?\`<div class="act-section-head"><span class="act-section-title">\${title}</span></div>\${items.map(actCardHTML).join('')}\`:'';
  el.innerHTML=runtimeTaskPanelHTML()
    +\`<div class="act-section-head"><span class="act-section-title">Local activity</span>\${dismissBtn}</div>\`
    +section('Uploads',uploads)
    +section('MCP',mcp);
  const runtimeRunning=Array.isArray(runtimeState?.activities)
    ? runtimeState.activities.some(a=>isActivityActive(normalizeActivityStatus(a.status,a.terminal)))
    : false;
  const anyRunning=_activities.some(a=>isActivityActive(a.status))||runtimeRunning;
  if(anyRunning&&!_actTimer) _actTimer=setInterval(renderActivities,1000);
  if(!anyRunning&&_actTimer){clearInterval(_actTimer);_actTimer=null;}
}
function updateActivityBadge() {
  const runtimeCount=Array.isArray(runtimeState?.activities)?runtimeState.activities.filter(a=>isActivityActive(normalizeActivityStatus(a.status,a.terminal))).length:0;
  const count=_activities.filter(a=>isActivityActive(a.status)).length+runtimeCount;
  const badge=$('tb-act-badge');
  if(!badge) return;
  badge.textContent=count>0?String(count):'';
  badge.classList.toggle('visible',count>0);
  const btn=$('tb-act-btn');
  if(btn) btn.classList.toggle('active',count>0||!$('activity-panel')?.classList.contains('closed'));
}
function toggleActivityPanel() {
  const panel=$('activity-panel');
  if(!panel) return;
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
  const logs=Array.isArray(runtimeState.logs)?runtimeState.logs.slice(-5):[];
  const line=(label,value)=>\`- \${label}: \${value||'-'}\`;
  const planLines=plan.slice(0,8).map((step,index)=>line(\`Plan \${step.step||index+1}\`,\`\${step.status||'pending'} - \${step.description||step.label||step.id||'step'}\`));
  const activityLines=activities.slice(0,8).map((activity,index)=>line(activity.id||activity.key||\`Activity \${index+1}\`,\`\${activity.status||'-'} - \${activity.label||activity.tool||activity.source||'runtime'}\`));
  const queueLines=queue.slice(0,8).map((item,index)=>line(item.id||item.jobId||\`Queue \${index+1}\`,\`\${item.status||'waiting'} - \${item.label||item.tool||item.type||'task'}\`));
  return [
    \`Runtime status for \${id}\`,
    '',
    line('Runtime',runtimeState.status||'idle'),
    line('Connection',runtimeConnected?'connected':'disconnected'),
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
  const prompt=\`Status of \${id}\`;
  const answer=runtimeStatusMarkdown(id);
  openActivityPanel();
  showChatView();
  if(!currentConversationId) currentConversationId=newConversationId();
  messages.push({role:'user',content:prompt});
  appendMsg('user',prompt);
  messages.push({role:'assistant',content:answer});
  appendMsg('assistant',answer);
  scheduleConversationSave();
}
function runtimeSectionCollapsed(name) {
  try { return localStorage.getItem(storageKey(RUNTIME_SECTION_KEY_PREFIX+name))==='1'; } catch { return false; }
}
function toggleRuntimeSection(name) {
  const collapsed=!runtimeSectionCollapsed(name);
  try { localStorage.setItem(storageKey(RUNTIME_SECTION_KEY_PREFIX+name),collapsed?'1':'0'); } catch {}
  renderActivities();
}
function runtimeSectionHTML(name,title,html) {
  if(!html) return '';
  const collapsed=runtimeSectionCollapsed(name);
  return \`<div class="act-section-head"><span class="act-section-title">\${esc(title)}</span><button class="runtime-section-toggle" type="button" onclick="toggleRuntimeSection('\${esc(name)}')">\${collapsed?'Expand':'Collapse'}</button></div><div class="\${collapsed?'runtime-section-collapsed':''}">\${html}</div>\`;
}
async function retryConvert(uploadId, actId) {
  upsertActivity({id:actId,status:'running',phase:'conversion',error:null,outputPath:null,startedAt:Date.now()});
  try {
    const res=await fetch(\`/api/uploads/\${encodeURIComponent(uploadId)}/convert\`,{method:'POST'});
    const data=await res.json().catch(()=>({ok:false,error:'Invalid response'}));
    if(!res.ok||data.ok===false) throw new Error(data.error||\`HTTP \${res.status}\`);
    const u=data.upload||{};
    upsertActivity({id:actId,status:u.status,outputPath:u.outputPath,method:u.method,error:u.error||null});
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
/* ── end Activity Panel ─────────────────────────────────────────────── */`;
