/** Durable workspace activity, independent from Donna's conversation/run. */
export const MAINTENANCE_PANEL_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');style.textContent='#workspace-status-bar{position:fixed;z-index:116;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));min-height:38px;max-height:118px;resize:vertical;overflow:auto;box-sizing:border-box;background:var(--panel);color:var(--text);border-top:1px solid color-mix(in srgb,var(--border) 28%,transparent);box-shadow:0 -2px 10px rgba(0,0,0,.06);font:11px/1.3 var(--font-sans)}#workspace-status-bar[hidden]{display:none}body.workspace-status-visible #sidebar,body.workspace-status-visible .main-resizer,body.workspace-status-visible #main,body.workspace-status-visible #right-rail{height:calc(100vh - var(--workspace-status-height,38px))!important}.workspace-status-section{display:flex;align-items:center;gap:7px;min-width:0;padding:5px 10px;overflow:auto}.workspace-status-section+.workspace-status-section{border-left:1px solid color-mix(in srgb,var(--border) 22%,transparent)}.workspace-status-section .approval-banner-text{font-size:10px!important;line-height:1.2!important}.workspace-status-section #approval-banner button{font-size:9px!important;padding:3px 6px!important}.workspace-status-section #run-strip,.workspace-status-section #approval-banner{position:static!important;inset:auto!important;left:auto!important;top:auto!important;bottom:auto!important;transform:none!important;width:auto!important;max-width:none!important;min-width:0;flex:1;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;border:0!important;border-radius:0!important;background:transparent!important;padding:0!important;margin:0!important;font-size:11px!important}.workspace-status-section #run-strip .run-strip-spinner{width:9px;height:9px;margin-top:3px}.workspace-status-section #run-strip{align-items:flex-start}.workspace-status-section #run-strip .run-strip-lines{gap:1px}.workspace-status-section #run-strip .run-strip-stop,.workspace-status-section #run-strip .run-strip-open{font-size:10px;padding:2px 7px;margin-top:1px}.workspace-status-section #approval-banner{display:flex!important}.workspace-status-section #approval-banner[hidden]{display:none!important}.workspace-status-maintenance{align-items:center}.maintenance-banner{display:none!important}.maintenance-toast{position:static;display:flex;align-items:center;gap:6px;min-width:0;max-height:5.5em;overflow:auto;box-sizing:border-box;border:0;border-radius:0;padding:0;background:transparent;box-shadow:none}.maintenance-toast[hidden]{display:none}.maintenance-toast-message{flex:1;min-width:0;max-height:4.2em;overflow:auto;overflow-wrap:anywhere;font:10px/1.3 var(--font-sans)}.maintenance-toast-actions{display:flex;align-items:center;gap:3px;flex:0 0 auto}.maintenance-toast .maintenance-action{margin:0;padding:2px 5px;font-size:9px;white-space:nowrap}.maintenance-pending{border:0;background:none;color:var(--accent);font:600 10px var(--font-sans);cursor:pointer;white-space:nowrap}.maintenance-state{margin-left:auto;padding-right:4px;color:var(--muted);font:700 10px var(--font-sans)}.activity-subtab-maintenance .maintenance-content{font:12px/1.4 var(--font-sans);color:var(--text)}.activity-subtab-maintenance h3{font:750 13px/1.3 var(--font-sans);margin:8px 0 4px}.activity-subtab-maintenance .maintenance-thread-heading{margin-top:16px}.activity-subtab-maintenance p{font:400 12px/1.4 var(--font-sans);margin:3px 0 6px}.activity-subtab-maintenance summary{font:500 12px/1.4 var(--font-sans);cursor:pointer}.activity-subtab-maintenance small{font-size:10px;color:var(--muted)}.maintenance-action{margin:3px 4px 3px 0;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:600 10px var(--font-sans);cursor:pointer}.maintenance-action:hover,.maintenance-action.selected{border-color:var(--accent);color:var(--accent)}.maintenance-mode-row{display:flex;align-items:center;gap:6px;margin:8px 0;color:var(--muted);font:600 11px var(--font-sans)}.maintenance-mode-switch{display:inline-flex;align-items:center;gap:7px;margin:0;padding:4px 7px;border:1px solid var(--border);border-radius:999px;background:var(--panel-soft);color:var(--text);font:700 10px var(--font-sans);cursor:pointer}.maintenance-mode-track{position:relative;display:inline-block;width:29px;height:16px;border-radius:999px;background:var(--muted);transition:background .15s}.maintenance-mode-thumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--panel);transition:transform .15s}.maintenance-mode-switch[aria-checked=true] .maintenance-mode-track{background:var(--accent)}.maintenance-mode-switch[aria-checked=true] .maintenance-mode-thumb{transform:translateX(13px)}.maintenance-proposals-action{display:block;box-sizing:border-box;width:100%;margin:0 0 10px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:650 10px var(--font-sans);text-align:center;text-decoration:none}.maintenance-proposals-action:hover{border-color:var(--accent);color:var(--accent)}.activity-subtab-maintenance article{border-top:1px solid var(--border);padding:7px 0}.activity-subtab-maintenance .maintenance-summary:not(.maintenance-markdown){white-space:pre-wrap}@media(max-width:700px){#workspace-status-bar{grid-template-columns:1fr;max-height:35vh}.workspace-status-section+.workspace-status-section{border-left:0;border-top:1px solid color-mix(in srgb,var(--border) 22%,transparent)}}';document.head.append(style);
  const statusBar=document.createElement('aside');statusBar.id='workspace-status-bar';statusBar.hidden=true;statusBar.setAttribute('aria-label','Workspace status');const statusSections=['maintenance','run','approval'].map(name=>{const section=document.createElement('div');section.className='workspace-status-section workspace-status-'+name;section.dataset.status=name;statusBar.append(section);return section;});document.body.append(statusBar);new ResizeObserver(()=>{if(!statusBar.hidden)document.body.style.setProperty('--workspace-status-height',Math.ceil(statusBar.getBoundingClientRect().height)+'px');}).observe(statusBar);
  function mountStatusBar(){const run=document.getElementById('run-strip'),approval=document.getElementById('approval-banner');if(run&&run.parentElement!==statusSections[1])statusSections[1].append(run);if(approval&&approval.parentElement!==statusSections[2])statusSections[2].append(approval);if(run&&!run.__statusObserver){run.__statusObserver=new MutationObserver(refreshStatusBar);run.__statusObserver.observe(run,{attributes:true,childList:true,subtree:true});}if(approval&&!approval.__statusObserver){approval.__statusObserver=new MutationObserver(refreshStatusBar);approval.__statusObserver.observe(approval,{attributes:true,childList:true,subtree:true});}refreshStatusBar();}
  function refreshStatusBar(){const run=statusSections[1]?.querySelector('#run-strip'),approval=statusSections[2]?.querySelector('#approval-banner'),maintenance=statusSections[0];if(!maintenance)return;const pending=window.getMaintenancePendingCount?.()||0;statusBar.hidden=!(run&&!run.hidden||approval&&!approval.hidden||pending>0||toast&&!toast.hidden);document.body.classList.toggle('workspace-status-visible',!statusBar.hidden);if(!statusBar.hidden)document.body.style.setProperty('--workspace-status-height',Math.ceil(statusBar.getBoundingClientRect().height)+'px');}
  const banner=document.createElement('button');banner.className='maintenance-pending';banner.hidden=true;banner.onclick=()=>{if(stale){historyOffset=0;stale=false;poll().then(open);}else open();};statusSections[0].append(banner);
  // The run graph draws what maintenance executes (runtimeGraphScript.ts).
  window.getMaintenanceRunning=()=>Array.isArray(state?.running)?state.running:[];
  function graphChanged(){try{if(typeof renderRuntimeWorkflowCanvas==='function')renderRuntimeWorkflowCanvas();}catch{}}
  let state=null,loading=false,toast=null,lastSeq=null,lastNotifiedSeq=null,hasUnread=false,historyOffset=0,connected=false,stale=false;const key='wiki-maintenance-seen:'+location.host;
  window.getMaintenancePendingCount=()=>state?.requests?.filter(r=>r.status==='pending').length??0;
  window.hasMaintenanceUpdates=()=>hasUnread||window.getMaintenancePendingCount()>0;
  mountStatusBar();
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
  function seen(){const seq=state?.events?.at(-1)?.seq??0;lastSeq=Math.max(lastSeq??0,seq);lastNotifiedSeq=Math.max(lastNotifiedSeq??0,lastSeq);hasUnread=false;try{localStorage.setItem(key,String(lastSeq));}catch{}if(toast){toast.remove();toast=null;}updateMaintenanceBadges();refreshStatusBar();}
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
  function maintenanceRecordLine(e,strip){const time=e.at?new Date(e.at).toLocaleTimeString():'';const message=strip(e.message);const detail=e.detail&&!message.includes(String(e.detail))?' (detail: '+String(e.detail).slice(0,400)+')':'';return '- '+time+' '+(e.kind||'event')+': '+message+detail;}
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
    for(const r of pending){const row=node('article',null,panel);const text=node('p',r.candidate?.summary||r.action,row);text.title='Request '+r.id+' · version '+r.version;button('Approve',row,()=>command({command:'decide',id:r.id,version:r.version,approved:true}));button('Refuse',row,()=>command({command:'decide',id:r.id,version:r.version,approved:false}));button('Ask Donna',row,()=>askDonna({question:'Explain this pending maintenance decision: what it would do, why maintenance proposes it, and what approving or refusing it changes.',label:'Explain the pending decision: '+(r.candidate?.summary||r.action),records:['Pending decision: '+(r.candidate?.summary||r.action),'Action: '+r.action+(r.target?' on '+r.target:'')]}));}
    // The Maintenance thread: one entry per cycle, the agent's own summary first,
    // then what was done; routine work and decisions outside a cycle follow.
    const events=state.events.slice(-300);const strip=(m)=>String(m||'').replace(/^Maintenance:\s*/,'');
    const threadHeading=node('h3','Maintenance thread',panel);threadHeading.className='maintenance-thread-heading';
    for(const c of state.cycles.slice(0,10)){
      const entry=node('details',null,panel);entry.open=c===state.cycles[0];
      node('summary',(c.at?new Date(c.at).toLocaleString():'')+' — cycle '+c.status,entry);
      const own=events.filter(e=>e.cycleId===c.id);const summary=own.filter(e=>e.kind==='summary').at(-1);
      if(summary)maintenanceMarkdown(entry,strip(summary.message),'maintenance-summary maintenance-markdown');
      for(const e of maintenanceActivityRows(own.filter(e=>e.kind!=='summary')))appendMaintenanceActivityRow(entry,e,strip);
      if(!own.length)node('p','No action recorded for this cycle on this history page.',entry);
      // Routine work runs outside the cycle (sync, doctor, mail) but is what
      // usually explains it: the records of the 15 minutes around it travel too.
      const around=events.filter(e=>e.cycleId!==c.id&&e.at&&c.at&&Math.abs(Date.parse(e.at)-Date.parse(c.at))<=15*60_000);
      const when=c.at?new Date(c.at).toLocaleString():'';
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
    const time=node('small',event.at?new Date(event.at).toLocaleString():'',row);time.className='maintenance-log-time';
    const message=maintenanceMarkdown(row,strip(event.message).replace(/^(?:Done|Failed|Cancelled|Maintenance):\s*/i,''),'maintenance-log-message maintenance-markdown');
    const status=node('b',maintenanceActivityStatus(event),row);status.className='maintenance-log-status';
  }
  function notify(events){if(!events.length)return;if(toast)toast.remove();toast=node('aside',null,statusSections[0]);toast.className='maintenance-toast';maintenanceMarkdown(toast,events.length===1?events[0].message:'Maintenance: '+events.length+' updates. Open the history to review them.','maintenance-toast-message maintenance-markdown');const actions=node('div',null,toast);actions.className='maintenance-toast-actions';button('Open',actions,open);if(events.some(e=>['failure','decision','proposal'].includes(e.kind)))button('Stop',actions,()=>command({command:'stop'}));button('Dismiss',actions,seen);refreshStatusBar();if(events.every(e=>!['failure','decision','proposal'].includes(e.kind)))setTimeout(()=>{toast?.remove();toast=null;refreshStatusBar();},9000);}
  let reconcileTimer=null;function scheduleReconcile(){if(reconcileTimer)clearInterval(reconcileTimer);reconcileTimer=setInterval(poll,connected?60000:5000);}
  const collections=['requests','reservations','cycles','events'];
  function applyUpdate(update){
    if(update.kind==='snapshot'){if(historyOffset>0&&state){state.stream={epoch:update.epoch,revision:update.revision};stale=true;hasUnread=true;updateMaintenanceBadges();banner.hidden=false;banner.textContent='Maintenance · New activity — view';refreshStatusBar();return;}state={...update.snapshot,stream:{epoch:update.epoch,revision:update.revision}};stale=false;updateMaintenanceBadges();graphChanged();return;}
    if(!state?.stream||state.stream.epoch!==update.epoch||state.stream.revision!==update.baseRevision){if(state?.stream?.epoch===update.epoch&&update.revision<=state.stream.revision)return;throw new Error('Maintenance update gap');}
    if(historyOffset>0){stale=true;hasUnread=true;updateMaintenanceBadges();banner.hidden=false;banner.textContent='Maintenance · New activity — view';refreshStatusBar();state.stream.revision=update.revision;return;}
    const fresh=update.delta.rows?.events?.upserts?.filter(e=>e.seq>lastSeq)??[];
    const unnotified=fresh.filter(e=>e.seq>lastNotifiedSeq);
    Object.assign(state,update.delta.fields);
    for(const [name,patch] of Object.entries(update.delta.rows??{})){
      if(!collections.includes(name))throw new Error('Unknown maintenance collection');
      const rows=new Map((state[name]??[]).map(row=>[String(name==='events'?row.seq:row.id),row]));for(const id of patch.removed)rows.delete(String(id));for(const row of patch.upserts)rows.set(String(name==='events'?row.seq:row.id),row);state[name]=patch.order?patch.order.map(id=>rows.get(String(id))).filter(Boolean):[...rows.values()];
    }
    state.stream={epoch:update.epoch,revision:update.revision};if(fresh.length&&maintenanceIsVisible())seen();else if(fresh.length){hasUnread=true;if(unnotified.length)notify(unnotified);lastNotifiedSeq=Math.max(lastNotifiedSeq??0,fresh.at(-1).seq);}
    updateMaintenanceBadges();
    const pendingCount=state.requests.filter(r=>r.status==='pending').length;banner.hidden=!pendingCount;banner.textContent='Maintenance · '+pendingCount+' decision'+(pendingCount===1?'':'s')+' — Review';refreshStatusBar();if(activeTarget?.isConnected)render(activeTarget);
  }
  window.addEventListener('llmwiki:maintenance-update',event=>{try{if(state&&event.detail.workspace&&state.workspace&&event.detail.workspace!==state.workspace)return;applyUpdate(event.detail);}catch{poll();}});
  window.addEventListener('llmwiki:maintenance-connection',event=>{connected=event.detail?.connected===true;scheduleReconcile();});
  async function poll(){if(loading)return;loading=true;try{const response=await fetch('/api/runtime/maintenance?historyOffset='+historyOffset,{cache:'no-store'});if(!response.ok)throw new Error('Maintenance status unavailable');const incoming=await response.json();if(!(state?.stream&&incoming.stream&&state.stream.epoch===incoming.stream.epoch&&incoming.stream.revision<state.stream.revision))state=incoming;graphChanged();const pending=state.requests.filter(r=>r.status==='pending');banner.hidden=!pending.length;banner.textContent='Maintenance · '+pending.length+' decision'+(pending.length===1?'':'s')+' — Review';refreshStatusBar();
    const fresh=state.events.filter(e=>e.seq>lastSeq);const unnotified=fresh.filter(e=>e.seq>lastNotifiedSeq);
    if(maintenanceIsVisible())seen();else if(fresh.length){hasUnread=true;if(unnotified.length)notify(unnotified);lastNotifiedSeq=Math.max(lastNotifiedSeq??0,fresh.at(-1).seq);}
    updateMaintenanceBadges();if(activeTarget?.isConnected)render(activeTarget);
  }catch(e){if(activeTarget?.isConnected){activeTarget.replaceChildren();node('p',e.message+' — reconnect to retrieve saved decisions and logs.',activeTarget);}}finally{loading=false;}}
  window.renderMaintenancePanel=render;
  window.clearMaintenanceHistory=clearHistory;
  poll();scheduleReconcile();
})();
`;
