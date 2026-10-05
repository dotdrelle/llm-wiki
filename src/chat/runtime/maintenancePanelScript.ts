/** Durable workspace activity, independent from Donna's conversation/run. */
export const MAINTENANCE_PANEL_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');style.textContent='.maintenance-panel{position:fixed;inset:70px 16px 110px auto;width:min(520px,90vw);z-index:120;background:var(--panel-bg,#172033);color:var(--text,#eee);border:1px solid #64748b;border-radius:12px;padding:16px;overflow:auto;box-shadow:0 10px 40px #0008}.maintenance-banner{position:fixed;bottom:110px;right:16px;max-width:min(360px,calc(100vw - 32px));z-index:115;background:#7c4a03;color:white;border-radius:8px;padding:8px}.maintenance-toast{position:fixed;right:16px;bottom:160px;z-index:116;max-width:360px;background:#243348;color:white;border:1px solid #64748b;border-radius:10px;padding:12px}.maintenance-panel button{margin:4px;padding:6px}.maintenance-panel article{border-top:1px solid #64748b;padding:8px 0}.maintenance-launch{position:fixed;right:16px;top:10px;z-index:114}';document.head.append(style);
  const launch=document.createElement('button');launch.className='maintenance-launch';launch.textContent='Maintenance';launch.onclick=()=>open();document.body.append(launch);
  const banner=document.createElement('button');banner.className='maintenance-banner';banner.hidden=true;banner.onclick=()=>open();document.body.append(banner);
  const panel=document.createElement('section');panel.className='maintenance-panel';panel.hidden=true;panel.setAttribute('aria-label','Maintenance history');document.body.append(panel);
  let state=null,loading=false,toast=null,lastSeq=null;const key='wiki-maintenance-seen:'+location.host;
  try{lastSeq=Number(localStorage.getItem(key)||0);}catch{lastSeq=0;}
  function node(tag,text,parent){const el=document.createElement(tag);if(text!=null)el.textContent=text;parent.append(el);return el;}
  function button(text,parent,fn){const el=node('button',text,parent);el.onclick=fn;return el;}
  function seen(){const seq=state?.events?.at(-1)?.seq??0;lastSeq=seq;try{localStorage.setItem(key,String(seq));}catch{}if(toast){toast.remove();toast=null;}}
  async function command(body){try{const res=await fetch('/api/runtime/maintenance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Action failed');await poll();}catch(e){node('p','Maintenance: '+e.message,panel);panel.hidden=false;}}
  function open(){panel.hidden=false;render();seen();}
  function render(){if(!state)return;panel.replaceChildren();node('h2','Maintenance',panel);button('Close',panel,()=>{panel.hidden=true;seen();});
    node('p',state.error||(!state.enabled?'Disabled':state.paused?'Paused':'Active — independent of Donna’s current run'),panel);
    button(state.paused?'Resume':'Pause',panel,()=>command({command:state.paused?'resume':'pause'}));button('Stop',panel,()=>command({command:'stop'}));
    const pending=state.requests.filter(r=>r.status==='pending');node('h3','Decisions ('+pending.length+')',panel);
    for(const r of pending){const row=node('article',null,panel);const text=node('p',r.candidate?.summary||r.action,row);text.title='Request '+r.id+' · version '+r.version;button('Approve',row,()=>command({command:'decide',id:r.id,version:r.version,approved:true}));button('Refuse',row,()=>command({command:'decide',id:r.id,version:r.version,approved:false}));}
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
      if(!own.length)node('p','No action recorded for this cycle.',entry);
    }
    const shown=new Set(state.cycles.slice(0,10).map(c=>c.id));const loose=events.filter(e=>!shown.has(e.cycleId)).slice(-60).reverse();
    if(loose.length){node('h3','Routine work and decisions',panel);for(const e of loose){const row=node('article',null,panel);node('small',e.at?new Date(e.at).toLocaleString():'',row);node('p',strip(e.message),row);}}
    const history=state.requests.filter(r=>r.status!=='pending');if(history.length){const d=node('details',null,panel);node('summary','Decision history',d);for(const r of history)node('p',(r.candidate?.summary||r.action)+' — '+r.status,d);}
  }
  function notify(events){if(!events.length)return;if(toast)toast.remove();toast=node('aside',null,document.body);toast.className='maintenance-toast';node('p',events.length===1?events[0].message:'Maintenance: '+events.length+' updates. Open the history to review them.',toast);button('Open',toast,open);button('Stop',toast,()=>command({command:'stop'}));button('Dismiss',toast,seen);if(events.every(e=>!['failure','decision','proposal'].includes(e.kind)))setTimeout(()=>{toast?.remove();toast=null;},9000);}
  async function poll(){if(loading)return;loading=true;try{const response=await fetch('/api/runtime/maintenance',{cache:'no-store'});if(!response.ok)throw new Error('Maintenance status unavailable');state=await response.json();const pending=state.requests.filter(r=>r.status==='pending');banner.hidden=!pending.length;banner.textContent='Maintenance: '+pending.length+' decision(s) — Review / Approve / Refuse';launch.hidden=!!pending.length;launch.textContent='Maintenance'+(state.paused?' · paused':'');
    if(!panel.hidden){render();seen();}else{const fresh=state.events.filter(e=>e.seq>lastSeq);if(fresh.length){notify(fresh);lastSeq=fresh.at(-1).seq;}}
  }catch(e){launch.title=e.message;if(!panel.hidden){panel.replaceChildren();node('p',e.message+' — reconnect to retrieve saved decisions and logs.',panel);}}finally{loading=false;}}
  poll();setInterval(poll,5000);
})();
`;
