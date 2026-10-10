/** Durable workspace activity, independent from Donna's conversation/run. */
export const MAINTENANCE_PANEL_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');style.textContent='#workspace-dock{position:fixed;z-index:116;right:48px;bottom:12px;width:min(calc(var(--dock-w,360px) - 16px),calc(100vw - 64px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;gap:8px;pointer-events:none;font:12px/1.35 var(--font-sans)}#workspace-dock[hidden]{display:none}#workspace-dock>*{pointer-events:auto}.workspace-dock-card{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--dock-bg,var(--panel));color:var(--text);box-shadow:var(--shadow)}.workspace-dock-card[hidden],.workspace-dock-card:empty{display:none}.maintenance-banner{display:none!important}.maintenance-toast{position:static;display:flex;flex-direction:column;gap:8px;min-width:0;max-height:40vh;overflow:auto;box-sizing:border-box;border:0;border-radius:0;padding:0;background:transparent;box-shadow:none}.maintenance-toast[hidden]{display:none}.maintenance-toast-message{min-width:0;overflow-wrap:anywhere;font:12px/1.4 var(--font-sans)}.maintenance-toast-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.maintenance-toast .maintenance-action{margin:0;padding:4px 10px;font-size:11px;white-space:nowrap}.maintenance-pending{border:0;background:none;color:var(--accent);font:600 10px var(--font-sans);cursor:pointer;white-space:nowrap}.maintenance-state{margin-left:auto;padding-right:4px;color:var(--muted);font:700 10px var(--font-sans)}.activity-subtab-maintenance .maintenance-content{font:12px/1.4 var(--font-sans);color:var(--text)}.activity-subtab-maintenance h3{font:750 13px/1.3 var(--font-sans);margin:8px 0 4px}.activity-subtab-maintenance .maintenance-thread-heading{margin-top:16px}.activity-subtab-maintenance p{font:400 12px/1.4 var(--font-sans);margin:3px 0 6px}.activity-subtab-maintenance summary{font:500 12px/1.4 var(--font-sans);cursor:pointer}.activity-subtab-maintenance small{font-size:10px;color:var(--muted)}.maintenance-action{margin:3px 4px 3px 0;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:600 10px var(--font-sans);cursor:pointer}.maintenance-action:hover,.maintenance-action.selected{border-color:var(--accent);color:var(--accent)}.maintenance-mode-row{display:flex;align-items:center;gap:6px;margin:8px 0;color:var(--muted);font:600 11px var(--font-sans)}.maintenance-mode-switch{display:inline-flex;align-items:center;gap:7px;margin:0;padding:4px 7px;border:1px solid var(--border);border-radius:999px;background:var(--panel-soft);color:var(--text);font:700 10px var(--font-sans);cursor:pointer}.maintenance-mode-track{position:relative;display:inline-block;width:29px;height:16px;border-radius:999px;background:var(--muted);transition:background .15s}.maintenance-mode-thumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--panel);transition:transform .15s}.maintenance-mode-switch[aria-checked=true] .maintenance-mode-track{background:var(--accent)}.maintenance-mode-switch[aria-checked=true] .maintenance-mode-thumb{transform:translateX(13px)}.maintenance-proposals-action{display:block;box-sizing:border-box;width:100%;margin:0 0 10px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:650 10px var(--font-sans);text-align:center;text-decoration:none}.maintenance-proposals-action:hover{border-color:var(--accent);color:var(--accent)}.activity-subtab-maintenance article{border-top:1px solid var(--border);padding:7px 0}.activity-subtab-maintenance .maintenance-summary:not(.maintenance-markdown){white-space:pre-wrap}';document.head.append(style);
  // Workspace-level demands float in one dock, bottom right, the width of the
  // Activity panel and above it: they outlive any view or panel state. The
  // run's own progress lives in Activity → Plan, not here.
  const dock=document.createElement('aside');dock.id='workspace-dock';dock.hidden=true;dock.setAttribute('aria-label','Workspace demands');const maintenanceCard=document.createElement('div');maintenanceCard.className='workspace-dock-card workspace-dock-maintenance';dock.append(maintenanceCard);document.body.append(dock);
  function mountDock(){const approval=document.getElementById('approval-banner');if(approval&&approval.parentElement!==dock)dock.append(approval);if(approval&&!approval.__dockObserver){approval.__dockObserver=new MutationObserver(refreshDock);approval.__dockObserver.observe(approval,{attributes:true,attributeFilter:['hidden']});}refreshDock();}
  function refreshDock(){const approval=document.getElementById('approval-banner');const pending=window.getMaintenancePendingCount?.()||0;maintenanceCard.hidden=!(pending>0||toast&&!toast.hidden);dock.hidden=!(approval&&!approval.hidden||!maintenanceCard.hidden);}
  const banner=document.createElement('button');banner.className='maintenance-pending';banner.hidden=true;banner.onclick=()=>{if(stale){historyOffset=0;stale=false;poll().then(open);}else open();};maintenanceCard.append(banner);
  // The run graph draws what maintenance executes (runtimeGraphScript.ts).
  window.getMaintenanceRunning=()=>Array.isArray(state?.running)?state.running:[];
  function graphChanged(){try{window.noteMaintenanceSidebarActivity?.(Array.isArray(state?.running)&&state.running.length>0);}catch{}try{if(typeof renderRuntimeWorkflowCanvas==='function')renderRuntimeWorkflowCanvas();}catch{}}
  let state=null,loading=false,toast=null,lastSeq=null,lastNotifiedSeq=null,hasUnread=false,historyOffset=0,connected=false,stale=false;const key='wiki-maintenance-seen:'+location.host;
  window.getMaintenancePendingCount=()=>state?.requests?.filter(r=>r.status==='pending').length??0;
  window.hasMaintenanceUpdates=()=>hasUnread||window.getMaintenancePendingCount()>0;
  mountDock();
  function updateMaintenanceBadges(){const tab=document.getElementById('activity-tab-maintenance');if(tab){tab.textContent='Maintenance';tab.classList.toggle('has-new',window.hasMaintenanceUpdates());}if(typeof updateActivityBadge==='function')updateActivityBadge();}
  try{lastSeq=Number(localStorage.getItem(key)||0);}catch{lastSeq=0;}lastNotifiedSeq=lastSeq;
  function node(tag,text,parent){const el=document.createElement(tag);if(text!=null)el.textContent=text;parent.append(el);return el;}
  function maintenanceMarkdown(parent,text,className='maintenance-markdown'){
    const host=node('div',null,parent);host.className=className;
    const source=String(text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const template=document.createElement('template');template.innerHTML=typeof renderMd==='function'?renderMd(source):source;
    const allowed=new Set(['P','BR','H1','H2','H3','H4','H5','H6','UL','OL','LI','STRONG','B','EM','I','CODE','PRE','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','HR','A','DIV']);
    for(const element of [...template.content.querySelectorAll('*')]){
      if(!allowed.has(element.tagName)){element.replaceWith(...element.childNodes);continue;}
      const href=element.tagName==='A'?element.getAttribute('href'):null;
      for(const attr of [...element.attributes])element.removeAttribute(attr.name);
      if(element.tagName==='DIV'&&element.parentElement===template.content)element.classList.add('table-wrap');
      if(element.tagName==='A'&&href&&/^(https?:|mailto:|\/|#)/i.test(href)){element.setAttribute('href',href);if(/^https?:/i.test(href)){element.setAttribute('target','_blank');element.setAttribute('rel','noopener noreferrer');}}
    }
    host.append(template.content);
    return host;
  }
  function button(text,parent,fn){const el=node('button',text,parent);el.className='maintenance-action';el.onclick=fn;return el;}
  function maintenanceIsVisible(){return Boolean(activeTarget?.isConnected&&!document.getElementById('activity-panel')?.classList.contains('closed')&&document.getElementById('activity-body')?.classList.contains('activity-list-mode')&&document.getElementById('activity-tab-maintenance')?.classList.contains('active'));}
  function seen(){const seq=state?.events?.at(-1)?.seq??0;lastSeq=Math.max(lastSeq??0,seq);lastNotifiedSeq=Math.max(lastNotifiedSeq??0,lastSeq);hasUnread=false;try{localStorage.setItem(key,String(lastSeq));}catch{}if(toast){toast.remove();toast=null;}updateMaintenanceBadges();refreshDock();}
  let activeTarget=null;
  async function command(body){try{const res=await fetch('/api/runtime/maintenance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Action failed');await poll();}catch(e){if(activeTarget)node('p','Maintenance: '+e.message,activeTarget);}}
  function open(){historyOffset=0;stale=false;if(typeof openActivityPanel==='function')openActivityPanel();if(typeof setActivityListTab==='function')setActivityListTab('maintenance');seen();}
  async function clearHistory({confirmed=false}={}){if(!confirmed){const message='Clear maintenance event logs and finished cycle history? Pending decisions will remain.';confirmed=typeof confirmAction==='function'?await confirmAction({title:'Clear maintenance history',message,confirmLabel:'Clear'}):window.confirm(message);}if(confirmed){historyOffset=0;stale=false;await command({command:'clear'});}}
  window.handleMaintenanceSlashCommand=(text)=>{const match=String(text||'').match(/^\/maintenance(?:\s+([a-z-]+))?(?:\s+([a-z-]+))?/i);if(!match)return false;const action=(match[1]||'status').toLowerCase();if(action==='status'||action==='history'){open();return true;}if(action==='mode'){open();if(['auto','human'].includes(String(match[2]||'').toLowerCase()))void command({command:'mode',mode:String(match[2]).toLowerCase()});else notify([{kind:'failure',message:'Usage: /maintenance mode auto|human'}]);return true;}if(['enable','disable','pause','resume','stop'].includes(action)){open();void command({command:action});return true;}open();return true;};
  // "Ask Donna" is one click: the button IS the question. Donna receives the
  // cycle's records — each with its error detail — plus the routine work around
  // it, and is told they are maintenance records, not wiki content. The thread
  // shows only a short label (hideQuestion), never the raw facts. Pre-filling
  // the composer left the reader to write the question, and "cycle failed" with
  // no cause made Donna search the wiki and answer that she did not know.
  function maintenanceRecordLine(e,strip){const time=e.at?formatLocalDateTime(e.at,{seconds:true}):'';const message=strip(e.message);const detail=e.detail&&!message.includes(String(e.detail))?' (detail: '+String(e.detail).slice(0,400)+')':'';return '- '+time+' '+(e.kind||'event')+': '+message+detail;}
  function askDonna({question,label,records}){historyOffset=0;if(typeof showChatView==='function')showChatView();const input=document.getElementById('chat-input');if(!input||(typeof isStreaming!=='undefined'&&isStreaming))return;
    input.value=[question,'Answer from the maintenance records below. They are system records from the Maintenance panel, not wiki pages: do not look for them in the wiki.','','<maintenance-records>',...records,'</maintenance-records>'].join('\n').slice(0,6000);
    input.dataset.displayText=label;input.dataset.forceChat='1';input.dataset.hideQuestion='1';
    if(typeof sendMessage==='function')sendMessage();}
  function render(panel){if(!state||!panel)return;activeTarget=panel;panel.replaceChildren();const badge=panel.closest('.activity-subtab-content')?.querySelector('.maintenance-state');if(badge)badge.textContent=state.error?'Error':!state.enabled?'Disabled':state.paused?'Paused':'Active';
    const build=state.buildSchedule;node('p','Build window: '+(build?(build.start+'–'+build.end+' ('+build.timezone+')'):'not set; automatic builds wait'),panel);
    const modeRow=node('div',null,panel);modeRow.className='maintenance-mode-row';
    node('span','Approval mode',modeRow);
    const switchTo=state.mode==='auto'?'human':'auto';
    const modeSwitch=button('',modeRow,()=>{if(state.mode!==switchTo)command({command:'mode',mode:switchTo});});
    modeSwitch.classList.add('maintenance-mode-switch');modeSwitch.setAttribute('role','switch');modeSwitch.setAttribute('aria-label','Maintenance approval mode');modeSwitch.setAttribute('aria-checked',String(state.mode==='human'));modeSwitch.title='Switch to '+(switchTo==='human'?'Human':'Auto')+' mode';
    const modeValue=node('span',state.mode==='auto'?'Auto':state.mode==='human'?'Human':'Custom',modeSwitch);modeValue.className='maintenance-mode-value';
    const track=node('span',null,modeSwitch);track.className='maintenance-mode-track';node('span',null,track).className='maintenance-mode-thumb';
    const controls=node('div',null,panel);controls.className='maintenance-control-row';
    if(state.enabled){const pauseBtn=button(state.paused?'Resume':'Pause',controls,()=>command({command:state.paused?'resume':'pause'}));pauseBtn.title=state.paused?'Resume automatic maintenance for this workspace.':'Pause maintenance: nothing new starts; the action already running finishes on its own.';const stopBtn=button('Stop now',controls,()=>command({command:'stop'}));stopBtn.title='Stop maintenance now: pauses it and cancels the running action and every in-flight job.';button('Disable',controls,()=>command({command:'disable'}));}
    else button('Enable',controls,async()=>{const text='Maintenance will keep this workspace up to date on its own. Enable it?';const ok=typeof confirmAction==='function'?await confirmAction({title:'Enable maintenance',message:text,confirmLabel:'Enable'}):window.confirm(text);if(ok)command({command:'enable'});});
    const proposals=node('a','Agent proposals',panel);proposals.className='maintenance-proposals-action';proposals.href='/agent-proposals';proposals.target='wiki-frame';
    const pending=state.requests.filter(r=>r.status==='pending');node('h3','Decisions ('+pending.length+')',panel);
    for(const r of pending){const row=node('article',null,panel);const text=node('p',r.candidate?.summary||r.action,row);text.title='Request '+r.id+' · version '+r.version;button('Approve',row,()=>command({command:'decide',id:r.id,version:r.version,approved:true})).classList.add('approve');button('Refuse',row,()=>command({command:'decide',id:r.id,version:r.version,approved:false}));button('Ask Donna',row,()=>askDonna({question:'Explain this pending maintenance decision: what it would do, why maintenance proposes it, and what approving or refusing it changes.',label:'Explain the pending decision: '+(r.candidate?.summary||r.action),records:['Pending decision: '+(r.candidate?.summary||r.action),'Action: '+r.action+(r.target?' on '+r.target:'')]}));}
    // The Maintenance thread: one entry per cycle, the agent's own summary first,
    // then what was done; routine work and decisions outside a cycle follow.
    const events=state.events.slice(-300);const strip=(m)=>String(m||'').replace(/^Maintenance:\s*/,'');
    const threadHeading=node('h3','Maintenance thread',panel);threadHeading.className='maintenance-thread-heading';
    for(const c of state.cycles.slice(0,10)){
      const entry=node('details',null,panel);entry.open=c===state.cycles[0];
      node('summary',(c.at?formatLocalDateTime(c.at,{seconds:true}):'')+' — cycle '+c.status,entry);
      const own=events.filter(e=>e.cycleId===c.id);const summary=own.filter(e=>e.kind==='summary').at(-1);
      if(summary)maintenanceMarkdown(entry,strip(summary.message),'maintenance-summary maintenance-markdown');
      for(const e of maintenanceActivityRows(own.filter(e=>e.kind!=='summary')))appendMaintenanceActivityRow(entry,e,strip);
      if(!own.length)node('p','No action recorded for this cycle on this history page.',entry);
      // Routine work runs outside the cycle (sync, doctor, mail) but is what
      // usually explains it: the records of the 15 minutes around it travel too.
      const around=events.filter(e=>e.cycleId!==c.id&&e.at&&c.at&&Math.abs(Date.parse(e.at)-Date.parse(c.at))<=15*60_000);
      const when=c.at?formatLocalDateTime(c.at,{seconds:true}):'';
      button('Ask Donna about this cycle',entry,()=>askDonna({question:'Explain this maintenance cycle: what happened, why it '+(c.status==='failed'?'failed':'ended as '+c.status)+', and what I should do about it.',label:'Explain the maintenance cycle of '+when,records:['Cycle of '+when+' — '+c.status,...[...own,...around].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))).map(e=>maintenanceRecordLine(e,strip))]}));
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
    const time=node('small',event.at?formatLocalDateTime(event.at,{seconds:true}):'',row);time.className='maintenance-log-time';
    const message=maintenanceMarkdown(row,strip(event.message).replace(/^(?:Done|Failed|Cancelled|Maintenance):\s*/i,''),'maintenance-log-message maintenance-markdown');
    const status=node('b',maintenanceActivityStatus(event),row);status.className='maintenance-log-status';
  }
  function notify(events){if(!events.length)return;if(toast)toast.remove();toast=node('aside',null,maintenanceCard);toast.className='maintenance-toast';maintenanceMarkdown(toast,events.length===1?events[0].message:'Maintenance: '+events.length+' updates. Open the history to review them.','maintenance-toast-message maintenance-markdown');const actions=node('div',null,toast);actions.className='maintenance-toast-actions';button('Open',actions,open);if(events.some(e=>['failure','decision','proposal'].includes(e.kind)))button('Stop',actions,()=>command({command:'stop'}));button('Dismiss',actions,seen);refreshDock();if(events.every(e=>!['failure','decision','proposal'].includes(e.kind)))setTimeout(()=>{toast?.remove();toast=null;refreshDock();},9000);}
  let reconcileTimer=null;function scheduleReconcile(){if(reconcileTimer)clearInterval(reconcileTimer);reconcileTimer=setInterval(poll,connected?60000:5000);}
  const collections=['requests','reservations','cycles','events'];
  function applyUpdate(update){
    if(update.kind==='snapshot'){if(historyOffset>0&&state){state.stream={epoch:update.epoch,revision:update.revision};stale=true;hasUnread=true;updateMaintenanceBadges();banner.hidden=false;banner.textContent='Maintenance · New activity — view';refreshDock();return;}state={...update.snapshot,stream:{epoch:update.epoch,revision:update.revision}};stale=false;updateMaintenanceBadges();graphChanged();return;}
    if(!state?.stream||state.stream.epoch!==update.epoch||state.stream.revision!==update.baseRevision){if(state?.stream?.epoch===update.epoch&&update.revision<=state.stream.revision)return;throw new Error('Maintenance update gap');}
    if(historyOffset>0){stale=true;hasUnread=true;updateMaintenanceBadges();banner.hidden=false;banner.textContent='Maintenance · New activity — view';refreshDock();state.stream.revision=update.revision;return;}
    const fresh=update.delta.rows?.events?.upserts?.filter(e=>e.seq>lastSeq)??[];
    const unnotified=fresh.filter(e=>e.seq>lastNotifiedSeq);
    Object.assign(state,update.delta.fields);
    for(const [name,patch] of Object.entries(update.delta.rows??{})){
      if(!collections.includes(name))throw new Error('Unknown maintenance collection');
      const rows=new Map((state[name]??[]).map(row=>[String(name==='events'?row.seq:row.id),row]));for(const id of patch.removed)rows.delete(String(id));for(const row of patch.upserts)rows.set(String(name==='events'?row.seq:row.id),row);state[name]=patch.order?patch.order.map(id=>rows.get(String(id))).filter(Boolean):[...rows.values()];
    }
    state.stream={epoch:update.epoch,revision:update.revision};if(fresh.length&&maintenanceIsVisible())seen();else if(fresh.length){hasUnread=true;if(unnotified.length)notify(unnotified);lastNotifiedSeq=Math.max(lastNotifiedSeq??0,fresh.at(-1).seq);}
    updateMaintenanceBadges();graphChanged();
    const pendingCount=state.requests.filter(r=>r.status==='pending').length;banner.hidden=!pendingCount;banner.textContent='Maintenance · '+pendingCount+' decision'+(pendingCount===1?'':'s')+' — Review';refreshDock();if(activeTarget?.isConnected)render(activeTarget);
  }
  window.addEventListener('llmwiki:maintenance-update',event=>{try{if(state&&event.detail.workspace&&state.workspace&&event.detail.workspace!==state.workspace)return;applyUpdate(event.detail);}catch{poll();}});
  window.addEventListener('llmwiki:maintenance-connection',event=>{connected=event.detail?.connected===true;scheduleReconcile();});
  async function poll(){if(loading)return;loading=true;try{const response=await fetch('/api/runtime/maintenance?historyOffset='+historyOffset,{cache:'no-store'});if(!response.ok)throw new Error('Maintenance status unavailable');const incoming=await response.json();if(!(state?.stream&&incoming.stream&&state.stream.epoch===incoming.stream.epoch&&incoming.stream.revision<state.stream.revision))state=incoming;graphChanged();const pending=state.requests.filter(r=>r.status==='pending');banner.hidden=!pending.length;banner.textContent='Maintenance · '+pending.length+' decision'+(pending.length===1?'':'s')+' — Review';refreshDock();
    const fresh=state.events.filter(e=>e.seq>lastSeq);const unnotified=fresh.filter(e=>e.seq>lastNotifiedSeq);
    if(maintenanceIsVisible())seen();else if(fresh.length){hasUnread=true;if(unnotified.length)notify(unnotified);lastNotifiedSeq=Math.max(lastNotifiedSeq??0,fresh.at(-1).seq);}
    updateMaintenanceBadges();if(activeTarget?.isConnected)render(activeTarget);
  }catch(e){if(activeTarget?.isConnected){activeTarget.replaceChildren();node('p',e.message+' — reconnect to retrieve saved decisions and logs.',activeTarget);}}finally{loading=false;}}
  window.renderMaintenancePanel=render;
  window.clearMaintenanceHistory=clearHistory;
  poll();scheduleReconcile();
})();
`;
