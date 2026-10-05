/** Durable workspace activity, independent from Donna's conversation/run. */
export const MAINTENANCE_PANEL_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');style.textContent='.maintenance-panel{position:fixed;inset:70px 16px 110px auto;width:min(520px,90vw);z-index:120;background:var(--panel-bg,#172033);color:var(--text,#eee);border:1px solid #64748b;border-radius:12px;padding:16px;overflow:auto;box-shadow:0 10px 40px #0008}.maintenance-banner{position:fixed;bottom:110px;right:16px;max-width:min(360px,calc(100vw - 32px));z-index:115;background:#7c4a03;color:white;border-radius:8px;padding:8px}.maintenance-toast{position:fixed;right:16px;bottom:160px;z-index:116;max-width:360px;background:#243348;color:white;border:1px solid #64748b;border-radius:10px;padding:12px}.maintenance-panel button{margin:4px;padding:6px}.maintenance-panel article{border-top:1px solid #64748b;padding:8px 0}.maintenance-launch{position:fixed;right:16px;top:10px;z-index:114}';document.head.append(style);
  const launch=document.createElement('button');launch.className='maintenance-launch';launch.textContent='Maintenance';launch.onclick=()=>open();document.body.append(launch);
  const banner=document.createElement('button');banner.className='maintenance-banner';banner.hidden=true;banner.onclick=()=>{if(stale){historyOffset=0;stale=false;poll().then(open);}else open();};document.body.append(banner);
  const panel=document.createElement('section');panel.className='maintenance-panel';panel.hidden=true;panel.setAttribute('aria-label','Maintenance history');document.body.append(panel);
  let state=null,loading=false,toast=null,lastSeq=null,historyOffset=0,connected=false,stale=false;const key='wiki-maintenance-seen:'+location.host;
  try{lastSeq=Number(localStorage.getItem(key)||0);}catch{lastSeq=0;}
  function node(tag,text,parent){const el=document.createElement(tag);if(text!=null)el.textContent=text;parent.append(el);return el;}
  function button(text,parent,fn){const el=node('button',text,parent);el.onclick=fn;return el;}
  function seen(){const seq=state?.events?.at(-1)?.seq??0;lastSeq=Math.max(lastSeq??0,seq);try{localStorage.setItem(key,String(lastSeq));}catch{}if(toast){toast.remove();toast=null;}}
  async function command(body){try{const res=await fetch('/api/runtime/maintenance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Action failed');await poll();}catch(e){node('p','Maintenance: '+e.message,panel);panel.hidden=false;}}
  function open(){panel.hidden=false;render();seen();}
  // "Ask Donna" never sends anything: it opens the chat with the facts in the
  // composer, and the reader asks (the conversational-action rule).
  function askDonna(facts){panel.hidden=true;historyOffset=0;if(typeof showChatView==='function')showChatView();const ta=document.getElementById('chat-input');if(!ta)return;ta.value='About this maintenance activity:\n'+facts+'\n\nMy question: ';if(typeof autoResize==='function')autoResize(ta);ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
  function render(){if(!state)return;panel.replaceChildren();node('h2','Maintenance',panel);button('Close',panel,()=>{panel.hidden=true;seen();historyOffset=0;poll();});
    node('p',state.error||(!state.enabled?'Disabled':state.paused?'Paused':'Active — independent of Donna’s current run'),panel);
    // Turning maintenance on grants a standing mandate: a human decision, confirmed.
    button(state.enabled?'Disable':'Enable for this workspace',panel,async()=>{
      if(!state.enabled){const text='Maintenance will keep this workspace up to date on its own: sync, ingest, rebuilds, index, builds and updates of existing exports. It asks you first for new sources and export updates, and it uses your LLM provider. Turn it on?';
        const ok=typeof confirmAction==='function'?await confirmAction({title:'Turn on automatic maintenance',message:text,confirmLabel:'Turn on'}):window.confirm(text);if(!ok)return;}
      command({command:state.enabled?'disable':'enable'});});
    if(state.enabled){    button(state.paused?'Resume':'Pause',panel,()=>command({command:state.paused?'resume':'pause'}));button('Stop',panel,()=>command({command:'stop'}));}
    const pending=state.requests.filter(r=>r.status==='pending');node('h3','Decisions ('+pending.length+')',panel);
    for(const r of pending){const row=node('article',null,panel);const text=node('p',r.candidate?.summary||r.action,row);text.title='Request '+r.id+' · version '+r.version;button('Approve',row,()=>command({command:'decide',id:r.id,version:r.version,approved:true}));button('Refuse',row,()=>command({command:'decide',id:r.id,version:r.version,approved:false}));button('Ask Donna',row,()=>askDonna('Pending decision: '+(r.candidate?.summary||r.action)));}
    // The Maintenance thread: one entry per cycle, the agent's own summary first,
    // then what was done; routine work and decisions outside a cycle follow.
    const events=state.events.slice(-300);const strip=(m)=>String(m||'').replace(/^Maintenance:\s*/,'');
    node('h3','Maintenance thread',panel);
    for(const c of state.cycles.slice(0,10)){
      const entry=node('details',null,panel);entry.open=c===state.cycles[0];
      node('summary',(c.at?new Date(c.at).toLocaleString():'')+' — cycle '+c.status,entry);
      const own=events.filter(e=>e.cycleId===c.id);const summary=own.filter(e=>e.kind==='summary').at(-1);
      if(summary)node('p',strip(summary.message),entry).className='maintenance-summary';
      for(const e of own.filter(e=>e.kind!=='summary'))node('p',strip(e.message),entry);
      if(!own.length)node('p','No action recorded for this cycle on this history page.',entry);
      button('Ask Donna about this cycle',entry,()=>askDonna(['Cycle of '+(c.at?new Date(c.at).toLocaleString():'')+' — '+c.status,...own.map(e=>strip(e.message))].join('\n').slice(0,4000)));
    }
    const shown=new Set(state.cycles.slice(0,10).map(c=>c.id));const loose=events.filter(e=>!shown.has(e.cycleId)).slice(-60).reverse();
    if(loose.length){node('h3','Routine work and decisions',panel);for(const e of loose){const row=node('article',null,panel);node('small',e.at?new Date(e.at).toLocaleString():'',row);node('p',strip(e.message),row);}}
    if(state.history){if(state.history.retentionDays)node('p','Logs retained for '+state.history.retentionDays+' rolling days.',panel);node('p','Saved history — page '+(Math.floor(state.history.offset/state.history.limit)+1)+'. All pending decisions remain visible.',panel);if(historyOffset>0)button('Newer history',panel,()=>{historyOffset=Math.max(0,historyOffset-state.history.limit);poll();});if(state.history.hasMore)button('Older history',panel,()=>{historyOffset+=state.history.limit;poll();});}
    const history=state.requests.filter(r=>r.status!=='pending');if(history.length){const d=node('details',null,panel);node('summary','Decision history',d);for(const r of history)node('p',(r.candidate?.summary||r.action)+' — '+r.status,d);}
  }
  function notify(events){if(!events.length)return;if(toast)toast.remove();toast=node('aside',null,document.body);toast.className='maintenance-toast';node('p',events.length===1?events[0].message:'Maintenance: '+events.length+' updates. Open the history to review them.',toast);button('Open',toast,open);button('Stop',toast,()=>command({command:'stop'}));button('Dismiss',toast,seen);if(events.every(e=>!['failure','decision','proposal'].includes(e.kind)))setTimeout(()=>{toast?.remove();toast=null;},9000);}
  let reconcileTimer=null;function scheduleReconcile(){if(reconcileTimer)clearInterval(reconcileTimer);reconcileTimer=setInterval(poll,connected?60000:5000);}
  const collections=['requests','reservations','cycles','events'];
  function applyUpdate(update){
    if(update.kind==='snapshot'){if(historyOffset>0&&state){state.stream={epoch:update.epoch,revision:update.revision};stale=true;banner.hidden=false;banner.textContent='New maintenance activity — return to current history';return;}state={...update.snapshot,stream:{epoch:update.epoch,revision:update.revision}};stale=false;return;}
    if(!state?.stream||state.stream.epoch!==update.epoch||state.stream.revision!==update.baseRevision){if(state?.stream?.epoch===update.epoch&&update.revision<=state.stream.revision)return;throw new Error('Maintenance update gap');}
    if(historyOffset>0){stale=true;banner.hidden=false;banner.textContent='New maintenance activity — return to current history';state.stream.revision=update.revision;return;}
    const fresh=update.delta.rows?.events?.upserts?.filter(e=>e.seq>lastSeq)??[];
    Object.assign(state,update.delta.fields);
    for(const [name,patch] of Object.entries(update.delta.rows??{})){
      if(!collections.includes(name))throw new Error('Unknown maintenance collection');
      const rows=new Map((state[name]??[]).map(row=>[String(name==='events'?row.seq:row.id),row]));for(const id of patch.removed)rows.delete(String(id));for(const row of patch.upserts)rows.set(String(name==='events'?row.seq:row.id),row);state[name]=patch.order?patch.order.map(id=>rows.get(String(id))).filter(Boolean):[...rows.values()];
    }
    state.stream={epoch:update.epoch,revision:update.revision};if(fresh.length&&!panel.hidden)seen();else if(fresh.length){notify(fresh);lastSeq=Math.max(lastSeq??0,fresh.at(-1).seq);try{localStorage.setItem(key,String(lastSeq));}catch{}}
    banner.hidden=!state.requests.some(r=>r.status==='pending');banner.textContent='Maintenance: '+state.requests.filter(r=>r.status==='pending').length+' decision(s) — Review / Approve / Refuse';launch.hidden=!!state.requests.some(r=>r.status==='pending');launch.textContent='Maintenance'+(state.paused?' · paused':'');if(!panel.hidden)render();
  }
  window.addEventListener('llmwiki:maintenance-update',event=>{try{if(state&&event.detail.workspace&&state.workspace&&event.detail.workspace!==state.workspace)return;applyUpdate(event.detail);}catch{poll();}});
  window.addEventListener('llmwiki:maintenance-connection',event=>{connected=event.detail?.connected===true;scheduleReconcile();});
  async function poll(){if(loading)return;loading=true;try{const response=await fetch('/api/runtime/maintenance?historyOffset='+historyOffset,{cache:'no-store'});if(!response.ok)throw new Error('Maintenance status unavailable');const incoming=await response.json();if(!(state?.stream&&incoming.stream&&state.stream.epoch===incoming.stream.epoch&&incoming.stream.revision<state.stream.revision))state=incoming;const pending=state.requests.filter(r=>r.status==='pending');banner.hidden=!pending.length;banner.textContent='Maintenance: '+pending.length+' decision(s) — Review / Approve / Refuse';launch.hidden=!!pending.length;launch.textContent='Maintenance'+(state.paused?' · paused':'');
    if(!panel.hidden){render();seen();}else{const fresh=state.events.filter(e=>e.seq>lastSeq);if(fresh.length){notify(fresh);lastSeq=fresh.at(-1).seq;}}
  }catch(e){launch.title=e.message;if(!panel.hidden){panel.replaceChildren();node('p',e.message+' — reconnect to retrieve saved decisions and logs.',panel);}}finally{loading=false;}}
  poll();scheduleReconcile();
})();
`;
