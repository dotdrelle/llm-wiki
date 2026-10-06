/** Durable workspace activity, independent from Donna's conversation/run. */
export const MAINTENANCE_PANEL_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');style.textContent='.maintenance-banner{position:fixed;bottom:110px;right:16px;max-width:min(360px,calc(100vw - 32px));z-index:115;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px}.maintenance-toast{position:fixed;left:16px;right:16px;bottom:12px;z-index:116;min-height:42px;max-height:118px;resize:vertical;overflow:auto;box-sizing:border-box;display:flex;align-items:center;gap:12px;background:var(--panel);color:var(--text);border:1px solid color-mix(in srgb,var(--border) 28%,transparent);border-radius:10px;padding:7px 10px;box-shadow:0 2px 10px rgba(0,0,0,.08)}.maintenance-toast-message{flex:1;min-width:0;max-height:5.6em;overflow:auto;overflow-wrap:anywhere;font:12px/1.4 var(--font-sans)}.maintenance-toast-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex:0 0 auto}.maintenance-toast .maintenance-action{margin:0;white-space:nowrap}.maintenance-state{margin-left:auto;padding-right:4px;color:var(--muted);font:700 10px var(--font-sans)}.activity-subtab-maintenance .maintenance-content{font:12px/1.4 var(--font-sans);color:var(--text)}.activity-subtab-maintenance h3{font:750 13px/1.3 var(--font-sans);margin:8px 0 4px}.activity-subtab-maintenance .maintenance-thread-heading{margin-top:16px}.activity-subtab-maintenance p{font:400 12px/1.4 var(--font-sans);margin:3px 0 6px}.activity-subtab-maintenance summary{font:500 12px/1.4 var(--font-sans);cursor:pointer}.activity-subtab-maintenance small{font-size:10px;color:var(--muted)}.maintenance-action{margin:3px 4px 3px 0;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:600 10px var(--font-sans);cursor:pointer}.maintenance-action:hover,.maintenance-action.selected{border-color:var(--accent);color:var(--accent)}.maintenance-mode-row{display:flex;align-items:center;gap:6px;margin:8px 0;color:var(--muted);font:600 11px var(--font-sans)}.maintenance-mode-row .maintenance-action{margin:0}.activity-subtab-maintenance article{border-top:1px solid var(--border);padding:7px 0}.activity-subtab-maintenance .maintenance-summary{white-space:pre-wrap}';document.head.append(style);
  const banner=document.createElement('button');banner.className='maintenance-banner';banner.hidden=true;banner.onclick=()=>{if(stale){historyOffset=0;stale=false;poll().then(open);}else open();};document.body.append(banner);
  let state=null,loading=false,toast=null,lastSeq=null,historyOffset=0,connected=false,stale=false;const key='wiki-maintenance-seen:'+location.host;
  window.getMaintenancePendingCount=()=>state?.requests?.filter(r=>r.status==='pending').length??0;
  function updateMaintenanceBadges(){const count=window.getMaintenancePendingCount();const tab=document.getElementById('activity-tab-maintenance');if(tab)tab.textContent='Maintenance · '+count;if(typeof updateActivityBadge==='function')updateActivityBadge();}
  try{lastSeq=Number(localStorage.getItem(key)||0);}catch{lastSeq=0;}
  function node(tag,text,parent){const el=document.createElement(tag);if(text!=null)el.textContent=text;parent.append(el);return el;}
  function button(text,parent,fn){const el=node('button',text,parent);el.className='maintenance-action';el.onclick=fn;return el;}
  function seen(){const seq=state?.events?.at(-1)?.seq??0;lastSeq=Math.max(lastSeq??0,seq);try{localStorage.setItem(key,String(lastSeq));}catch{}if(toast){toast.remove();toast=null;}}
  let activeTarget=null;
  async function command(body){try{const res=await fetch('/api/runtime/maintenance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Action failed');await poll();}catch(e){if(activeTarget)node('p','Maintenance: '+e.message,activeTarget);}}
  function open(){historyOffset=0;stale=false;if(typeof openActivityPanel==='function')openActivityPanel();if(typeof setActivityListTab==='function')setActivityListTab('maintenance');seen();}
  async function clearHistory(){const message='Clear maintenance event logs and finished cycle history? Pending decisions will remain.';const confirmed=typeof confirmAction==='function'?await confirmAction({title:'Clear maintenance history',message,confirmLabel:'Clear'}):window.confirm(message);if(confirmed){historyOffset=0;stale=false;await command({command:'clear'});}}
  window.handleMaintenanceSlashCommand=(text)=>{const match=String(text||'').match(/^\/maintenance(?:\s+([a-z-]+))?(?:\s+([a-z-]+))?/i);if(!match)return false;const action=(match[1]||'status').toLowerCase();if(action==='status'||action==='history'){open();return true;}if(action==='mode'){open();if(['auto','human'].includes(String(match[2]||'').toLowerCase()))void command({command:'mode',mode:String(match[2]).toLowerCase()});else notify([{kind:'failure',message:'Usage: /maintenance mode auto|human'}]);return true;}if(['enable','disable','pause','resume','stop'].includes(action)){open();void command({command:action});return true;}open();return true;};
  // "Ask Donna" never sends anything: it opens the chat with the facts in the
  // composer, and the reader asks (the conversational-action rule).
  function askDonna(facts){historyOffset=0;if(typeof showChatView==='function')showChatView();const ta=document.getElementById('chat-input');if(!ta)return;ta.value='About this maintenance activity:\n'+facts+'\n\nMy question: ';if(typeof autoResize==='function')autoResize(ta);ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
  function render(panel){if(!state||!panel)return;activeTarget=panel;panel.replaceChildren();const badge=panel.closest('.activity-subtab-content')?.querySelector('.maintenance-state');if(badge)badge.textContent=state.error?'Error':!state.enabled?'Disabled':state.paused?'Paused':'Active';
    const policy=node('details',null,panel);node('summary','Build window',policy);
    const window=state.buildSchedule;node('p','Build window: '+(window?(window.start+'–'+window.end+' ('+window.timezone+')'):'not set; automatic builds wait'),policy);
    const modeRow=node('div',null,panel);modeRow.className='maintenance-mode-row';
    node('span','Approval mode',modeRow);
    for(const mode of ['auto','human']){const choice=button(mode==='auto'?'Auto':'Human',modeRow,()=>{if(state.mode!==mode)command({command:'mode',mode});});choice.classList.toggle('selected',state.mode===mode);choice.setAttribute('aria-pressed',String(state.mode===mode));}
    const controls=node('div',null,panel);controls.className='maintenance-control-row';
    if(state.enabled){button(state.paused?'Resume':'Pause',controls,()=>command({command:state.paused?'resume':'pause'}));button('Stop',controls,()=>command({command:'stop'}));button('Disable',controls,()=>command({command:'disable'}));}
    else button('Enable',controls,async()=>{const text='Maintenance will keep this workspace up to date on its own. Enable it?';const ok=typeof confirmAction==='function'?await confirmAction({title:'Enable maintenance',message:text,confirmLabel:'Enable'}):window.confirm(text);if(ok)command({command:'enable'});});
    const pending=state.requests.filter(r=>r.status==='pending');node('h3','Decisions ('+pending.length+')',panel);
    for(const r of pending){const row=node('article',null,panel);const text=node('p',r.candidate?.summary||r.action,row);text.title='Request '+r.id+' · version '+r.version;button('Approve',row,()=>command({command:'decide',id:r.id,version:r.version,approved:true}));button('Refuse',row,()=>command({command:'decide',id:r.id,version:r.version,approved:false}));button('Ask Donna',row,()=>askDonna('Pending decision: '+(r.candidate?.summary||r.action)));}
    // The Maintenance thread: one entry per cycle, the agent's own summary first,
    // then what was done; routine work and decisions outside a cycle follow.
    const events=state.events.slice(-300);const strip=(m)=>String(m||'').replace(/^Maintenance:\s*/,'');
    const threadHeading=node('h3','Maintenance thread',panel);threadHeading.className='maintenance-thread-heading';
    for(const c of state.cycles.slice(0,10)){
      const entry=node('details',null,panel);entry.open=c===state.cycles[0];
      node('summary',(c.at?new Date(c.at).toLocaleString():'')+' — cycle '+c.status,entry);
      const own=events.filter(e=>e.cycleId===c.id);const summary=own.filter(e=>e.kind==='summary').at(-1);
      if(summary)node('p',strip(summary.message),entry).className='maintenance-summary';
      for(const e of maintenanceActivityRows(own.filter(e=>e.kind!=='summary')))appendMaintenanceActivityRow(entry,e,strip);
      if(!own.length)node('p','No action recorded for this cycle on this history page.',entry);
      button('Ask Donna about this cycle',entry,()=>askDonna(['Cycle of '+(c.at?new Date(c.at).toLocaleString():'')+' — '+c.status,...own.map(e=>strip(e.message))].join('\n').slice(0,4000)));
    }
    const shown=new Set(state.cycles.slice(0,10).map(c=>c.id));const loose=events.filter(e=>!shown.has(e.cycleId)).slice(-60).reverse();
    if(loose.length){node('h3','Routine work and decisions',panel);for(const e of maintenanceActivityRows(loose))appendMaintenanceActivityRow(panel,e,strip);}
    if(state.history){if(state.history.retentionDays)node('p','Logs retained for '+state.history.retentionDays+' rolling days.',panel);node('p','Saved history — page '+(Math.floor(state.history.offset/state.history.limit)+1)+'. All pending decisions remain visible.',panel);if(historyOffset>0)button('Newer history',panel,()=>{historyOffset=Math.max(0,historyOffset-state.history.limit);poll();});if(state.history.hasMore)button('Older history',panel,()=>{historyOffset+=state.history.limit;poll();});}
    const history=state.requests.filter(r=>r.status!=='pending');if(history.length){const d=node('details',null,panel);node('summary','Decision history',d);for(const r of history)node('p',(r.candidate?.summary||r.action)+' — '+r.status,d);}
  }
  function maintenanceActivityRows(events){
    const grouped=new Map();
    for(const event of events){const key=event.action?String(event.cycleId||'')+'|'+event.action+'|'+String(event.target||''):String(event.seq);grouped.set(key,event);}
    return [...grouped.values()].sort((a,b)=>(Number(b.seq)||0)-(Number(a.seq)||0));
  }
  function maintenanceActivityStatus(event){
    if(event.kind==='action_started')return event.action==='sync'?'checking':'pending';
    if(event.kind==='waiting')return 'pending';
    if(event.kind==='action_done')return event.action==='doctor'?'checked':'done';
    if(event.kind==='failure')return 'failed';
    if(event.kind==='interrupted')return 'cancelled';
    return String(event.kind||'info').replaceAll('_',' ');
  }
  function appendMaintenanceActivityRow(parent,event,strip){
    const row=node('div',null,parent);row.className='maintenance-log-row status-'+maintenanceActivityStatus(event).replaceAll(' ','-');
    const time=node('small',event.at?new Date(event.at).toLocaleString():'',row);time.className='maintenance-log-time';
    const message=node('span',strip(event.message).replace(/^(?:Done|Failed|Cancelled|Maintenance):\s*/i,''),row);message.className='maintenance-log-message';
    const status=node('b',maintenanceActivityStatus(event),row);status.className='maintenance-log-status';
  }
  function notify(events){if(!events.length)return;if(toast)toast.remove();toast=node('aside',null,document.body);toast.className='maintenance-toast';const message=node('div',events.length===1?events[0].message:'Maintenance: '+events.length+' updates. Open the history to review them.',toast);message.className='maintenance-toast-message';const actions=node('div',null,toast);actions.className='maintenance-toast-actions';button('Open',actions,open);button('Stop',actions,()=>command({command:'stop'}));button('Dismiss',actions,seen);if(events.every(e=>!['failure','decision','proposal'].includes(e.kind)))setTimeout(()=>{toast?.remove();toast=null;},9000);}
  let reconcileTimer=null;function scheduleReconcile(){if(reconcileTimer)clearInterval(reconcileTimer);reconcileTimer=setInterval(poll,connected?60000:5000);}
  const collections=['requests','reservations','cycles','events'];
  function applyUpdate(update){
    if(update.kind==='snapshot'){if(historyOffset>0&&state){state.stream={epoch:update.epoch,revision:update.revision};stale=true;banner.hidden=false;banner.textContent='New maintenance activity — return to current history';return;}state={...update.snapshot,stream:{epoch:update.epoch,revision:update.revision}};stale=false;updateMaintenanceBadges();return;}
    if(!state?.stream||state.stream.epoch!==update.epoch||state.stream.revision!==update.baseRevision){if(state?.stream?.epoch===update.epoch&&update.revision<=state.stream.revision)return;throw new Error('Maintenance update gap');}
    if(historyOffset>0){stale=true;banner.hidden=false;banner.textContent='New maintenance activity — return to current history';state.stream.revision=update.revision;return;}
    const fresh=update.delta.rows?.events?.upserts?.filter(e=>e.seq>lastSeq)??[];
    Object.assign(state,update.delta.fields);
    for(const [name,patch] of Object.entries(update.delta.rows??{})){
      if(!collections.includes(name))throw new Error('Unknown maintenance collection');
      const rows=new Map((state[name]??[]).map(row=>[String(name==='events'?row.seq:row.id),row]));for(const id of patch.removed)rows.delete(String(id));for(const row of patch.upserts)rows.set(String(name==='events'?row.seq:row.id),row);state[name]=patch.order?patch.order.map(id=>rows.get(String(id))).filter(Boolean):[...rows.values()];
    }
    state.stream={epoch:update.epoch,revision:update.revision};if(fresh.length&&activeTarget?.isConnected)seen();else if(fresh.length){notify(fresh);lastSeq=Math.max(lastSeq??0,fresh.at(-1).seq);try{localStorage.setItem(key,String(lastSeq));}catch{}}
    updateMaintenanceBadges();
    banner.hidden=!state.requests.some(r=>r.status==='pending');banner.textContent='Maintenance: '+state.requests.filter(r=>r.status==='pending').length+' decision(s) — Review / Approve / Refuse';if(activeTarget?.isConnected)render(activeTarget);
  }
  window.addEventListener('llmwiki:maintenance-update',event=>{try{if(state&&event.detail.workspace&&state.workspace&&event.detail.workspace!==state.workspace)return;applyUpdate(event.detail);}catch{poll();}});
  window.addEventListener('llmwiki:maintenance-connection',event=>{connected=event.detail?.connected===true;scheduleReconcile();});
  async function poll(){if(loading)return;loading=true;try{const response=await fetch('/api/runtime/maintenance?historyOffset='+historyOffset,{cache:'no-store'});if(!response.ok)throw new Error('Maintenance status unavailable');const incoming=await response.json();if(!(state?.stream&&incoming.stream&&state.stream.epoch===incoming.stream.epoch&&incoming.stream.revision<state.stream.revision))state=incoming;const pending=state.requests.filter(r=>r.status==='pending');banner.hidden=!pending.length;banner.textContent='Maintenance: '+pending.length+' decision(s) — Review / Approve / Refuse';
    updateMaintenanceBadges();if(activeTarget?.isConnected){render(activeTarget);seen();}else{const fresh=state.events.filter(e=>e.seq>lastSeq);if(fresh.length){notify(fresh);lastSeq=fresh.at(-1).seq;}}
  }catch(e){if(activeTarget?.isConnected){activeTarget.replaceChildren();node('p',e.message+' — reconnect to retrieve saved decisions and logs.',activeTarget);}}finally{loading=false;}}
  window.renderMaintenancePanel=render;
  window.clearMaintenanceHistory=clearHistory;
  poll();scheduleReconcile();
})();
`;
