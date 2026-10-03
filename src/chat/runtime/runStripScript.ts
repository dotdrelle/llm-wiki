export const RUN_STRIP_SCRIPT = `// The run strip mirrors the ShellUI Activity panel, not just its headline:
// the current DOCUMENT/step as the primary label (the activity's own
// progress.label, exactly what the Shell displays for an aggregated line),
// then the live figures the direct wiki CLI already exports - step/source/
// task/batch counters, the detail and the tokens - on the sub-line. Never a
// raw tool id. When no aggregated line exists, the running plan step stands
// in; otherwise "Working...".
function runStripTokenText(progress, fallback) {
  const format=(value)=>new Intl.NumberFormat().format(Number(value)||0);
  const input=Number(progress?.inputTokens);
  const output=Number(progress?.outputTokens);
  if(Number.isFinite(input)||Number.isFinite(output)) {
    return \`\${Number.isFinite(input)?format(input):'—'} in · \${Number.isFinite(output)?format(output):'—'} out\`;
  }
  const usage=fallback;
  if(usage&&(usage.inputKnown||usage.outputKnown)) {
    return \`\${usage.inputKnown?format(usage.inputTokens):'—'} in · \${usage.outputKnown?format(usage.outputTokens):'—'} out\`;
  }
  return null;
}
// Port of the ShellUI's activityDetailText: the same counters and detail, in
// the same order, so the two surfaces never describe a run differently.
function runStripDetail(progress, usage) {
  const p=progress||{};
  const counter=(index,count,label)=>{
    const i=Number(index), c=Number(count);
    return Number.isFinite(i)&&Number.isFinite(c)&&c>0?\`\${label} \${Math.max(1,i)}/\${c}\`:null;
  };
  const stepCounter=counter(p.stepIndex,p.stepTotal,'Step');
  const taskCounter=counter(p.taskIndex,p.taskTotal,'Task');
  const sourceCounter=counter(p.sourceIndex,p.sourceCount,'Source');
  // One batch counter, never two. The agent's batch.index is already 1-based;
  // the trace's batchIndex is 0-based. A detail that already says "Batch N/M"
  // (the agent's own sentence, e.g. "Batch 1/2 · LLM running") is kept whole
  // and no counter is added beside it — the strip used to drop that detail and
  // the Activity panel to add "batch 2/1" next to it.
  const detailHasBatch=/\\bbatch\\s+\\d+\\/\\d+/i.test(String(p.detail||''));
  const batchCounter=detailHasBatch?null:(p.batch?.total
    ? counter(p.batch.index,p.batch.total,'Batch')
    : counter(Number(p.batchIndex)+1,p.batchCount,'Batch'));
  const batchDetail=p.detail;
  const instructions=Number(p.instructionCount??p.processing?.instructionCount);
  const stabilize=(p.stabilizeKept!=null||p.stabilizeMerged!=null)
    ? \`kept \${p.stabilizeKept??0}, merged \${p.stabilizeMerged??0}, inserted \${p.stabilizeInserted??0}, removed \${p.stabilizeRemoved??0}\`
    : null;
  const values=[
    taskCounter,
    stepCounter,
    sourceCounter,
    batchCounter,
    batchDetail,
    instructions>0?\`\${instructions} instruction\${instructions>1?'s':''}\`:null,
    stabilize,
    p.currentStep||p.step||p.phase,
    runStripTokenText(p,usage),
  ].map(value=>String(value??'').trim()).filter(Boolean);
  return [...new Set(values)].join(' · ');
}
function runtimeStripLines() {
  const usage=runtimeState?.workflow?.usage;
  const lines=runtimeState?.workflow?.activity?.lines;
  if(Array.isArray(lines)&&lines.length) {
    const active=lines.filter(line=>isActivityActive(normalizeActivityStatus(line.status,false)));
    return (active.length?active:lines).slice(-2).map((line)=>{
      const progress=line.progress||{};
      const document=String(progress.label||'').trim();
      return {
        label: document||String(line.label||line.id||''),
        percent: progress.percent,
        detail: runStripDetail(progress,usage),
      };
    });
  }
  const plan=Array.isArray(runtimeState?.plan)?runtimeState.plan:[];
  const running=plan.find(step=>String(step.status||'').toLowerCase()==='running');
  if(running) return [{label:String(running.description||running.label||running.status||''), percent:null, detail:''}];
  return [];
}
// Number(null) and Number('') are both 0, so "no percentage" rendered a pinned
// 0% badge for the whole run — and the plan-step fallback line always carries
// percent:null, which is the common case. Absent is absent.
function runStripPercent(value) {
  if(value==null||value==='') return '';
  const percent=Number(value);
  return Number.isFinite(percent)?Math.round(percent)+'%':'';
}
function setRunStripLine(lineId,percentId,label,percent) {
  const line=$(lineId), badge=$(percentId);
  if(line) line.textContent=label||'';
  if(badge) {
    const value=runStripPercent(percent);
    badge.textContent=value;
    badge.hidden=!value;
  }
}
function runIsActive() {
  if(isStreaming||pendingRuntimeStatusEls.length>0) return true;
  if(!runtimeState) return false;
  const status=String(runtimeState.status||'').toLowerCase();
  if(status==='running'||status==='pending_approval') return true;
  const activities=Array.isArray(runtimeState.activities)?runtimeState.activities:[];
  if(activities.some(activity=>isActivityActive(normalizeActivityStatus(activity.status,activity.terminal)))) return true;
  const chains=Array.isArray(runtimeState.skillChains)?runtimeState.skillChains:[];
  return chains.some(chain=>chain.status==='running'||chain.status==='queued');
}
// Deterministic control verbs stay buttons (root rule: cancel/enqueue/approve
// never go through a Donna turn). Stop is chain-scoped on the runtime side: it
// cancels the current run and skips the rest of ITS skill chain, leaving the
// unrelated queued requests alone — each of those has its own Cancel in Plan.
async function stopRuntimeRunFromStrip() {
  if(!runtimeEnabled()) return;
  if(!(await confirmAction({title:'Stop the run',message:'Stop the current run? Its remaining chain steps are skipped; other queued requests stay in the queue.',confirmLabel:'Stop',danger:true}))) return;
  const button=document.querySelector('#run-strip .run-strip-stop');
  if(button) button.disabled=true;
  try { await cancelRuntimeRun(); } finally { if(button) button.disabled=false; }
}
// One queued (not yet started) control request, by id: the runtime's
// cancel_item also skips the later steps of that item's own chain.
async function cancelQueuedRuntimeItem(itemId) {
  if(!runtimeEnabled()||!itemId) return;
  if(!(await confirmAction({title:'Cancel queued request',message:'Remove this request from the queue? It has not started yet.',confirmLabel:'Cancel request',danger:true}))) return;
  try {
    const res=await fetch('/api/runtime/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel_item',itemId})});
    const payload=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(payload?.error||'Queue cancel failed ('+res.status+')');
    notify(payload?.cancelled===false?'That request had already left the queue.':'Queued request cancelled');
    await fetchRuntimeState().catch(()=>{});
  } catch(e) { notify(e?.message||String(e),'e'); }
}
function updateRunStrip() {
  const strip=$('run-strip');
  if(!strip) return;
  const active=runIsActive();
  document.body.classList.toggle('run-active',active);
  if(!active) { strip.hidden=true; return; }
  strip.hidden=false;
  restoreRunStripPosition();
  placeRunStripDefault(strip);
  const lines=runtimeStripLines();
  const first=lines[0]||{};
  const overall=runtimeState?.workflow?.progress?.percent;
  setRunStripLine(
    'run-strip-text','run-strip-percent',
    first.label||'Working…',
    first.percent!=null?first.percent:(lines.length?'':overall),
  );
  // The sub-line carries the current activity's live figures (counters,
  // detail, tokens). With no such detail it falls back to a second concurrent
  // activity, then to nothing. It also carries the external runtime's
  // heartbeat: a run whose model is thinking without calling a tool otherwise
  // reads as frozen, and the beat is the only thing that proves it is not.
  const second=lines[1];
  const beatAt=Date.parse(String(runtimeState?.lastHeartbeatAt||''))||0;
  const beat=beatAt?('alive '+Math.max(0,Math.round((Date.now()-beatAt)/1000))+'s ago'):'';
  const detail=[first.detail||second?.label||'',beat].filter(Boolean).join(' · ');
  const subLine=$('run-strip-sub-line');
  if(subLine) {
    subLine.hidden=!detail;
    if(detail) setRunStripLine('run-strip-sub-text','run-strip-sub-percent', detail, first.detail?null:second?.percent);
  }
}
// The strip is an overlay at the BOTTOM centre by default, just above the
// composer when one is shown (--run-strip-bottom), but the reader decides where
// it lives: a pointer drag moves it. The centering transform is dropped on
// first grab (left/top become px) and the box is clamped to the viewport so it
// can never be dragged off-screen. Buttons keep their own click: the drag
// starts only outside them. The position is persisted, so a view switch or a
// fresh document load puts the strip back where the reader left it; a
// double-click returns it to the default place.
//
// The key is versioned: the former 'run-strip-position' could hold 0,0 — a
// restore run before the window or the strip had a size clamped every saved
// position into the top-left corner, and the resize handler saved it back.
const RUN_STRIP_POSITION_KEY='run-strip-position-v2';
function saveRunStripPosition(strip) {
  if(!strip||!strip.style.left) return;
  const left=parseFloat(strip.style.left);
  const top=parseFloat(strip.style.top);
  if(!Number.isFinite(left)||!Number.isFinite(top)) return;
  try { localStorage.setItem(RUN_STRIP_POSITION_KEY,JSON.stringify({left,top})); } catch {}
}
function resetRunStripPosition(strip) {
  if(!strip) return;
  strip.style.left='';
  strip.style.top='';
  strip.style.bottom='';
  strip.style.transform='';
  try { localStorage.removeItem(RUN_STRIP_POSITION_KEY); } catch {}
  placeRunStripDefault(strip);
}
// Bottom centre, lifted above whatever already occupies the bottom while it is
// displayed — the composer, and the approval banner a pending run shows above
// it — so the strip never covers the input, its buttons or Approve/Reject.
function placeRunStripDefault(strip) {
  if(!strip||strip.style.left) return;
  let highest=window.innerHeight;
  for(const id of ['input-wrap','approval-banner']) {
    const el=$(id);
    if(!el||el.hidden||el.offsetParent===null&&getComputedStyle(el).position!=='fixed') continue;
    const rect=el.getBoundingClientRect();
    if(rect.height>0&&rect.top>0) highest=Math.min(highest,rect.top);
  }
  const lift=highest<window.innerHeight?Math.round(window.innerHeight-highest+10):16;
  strip.style.setProperty('--run-strip-bottom',Math.max(16,lift)+'px');
}
function restoreRunStripPosition() {
  const strip=$('run-strip');
  if(!strip||strip.__posRestored) return;
  const rect=strip.getBoundingClientRect();
  // Not laid out yet (window or strip without a size): clamping now would pin
  // the saved position to 0,0. Try again on the next update.
  if(window.innerWidth<=0||window.innerHeight<=0||rect.width<=0||rect.height<=0) return;
  strip.__posRestored=true;
  let pos=null;
  try {
    const raw=localStorage.getItem(RUN_STRIP_POSITION_KEY);
    if(raw) pos=JSON.parse(raw);
  } catch {}
  if(!pos||typeof pos.left!=='number'||typeof pos.top!=='number') return;
  const maxX=Math.max(0,window.innerWidth-rect.width);
  const maxY=Math.max(0,window.innerHeight-rect.height);
  strip.style.transform='none';
  strip.style.bottom='auto';
  strip.style.left=Math.max(0,Math.min(maxX,pos.left))+'px';
  strip.style.top=Math.max(0,Math.min(maxY,pos.top))+'px';
}
function initRunStripDrag() {
  const strip=$('run-strip');
  if(!strip||strip.__dragReady) return;
  strip.__dragReady=true;
  let drag=null;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  strip.addEventListener('pointerdown',(event)=>{
    if(event.button!==0) return;
    if(event.target.closest('button')) return;
    const rect=strip.getBoundingClientRect();
    strip.style.transform='none';
    strip.style.bottom='auto';
    strip.style.left=Math.round(rect.left)+'px';
    strip.style.top=Math.round(rect.top)+'px';
    drag={dx:event.clientX-rect.left,dy:event.clientY-rect.top};
    strip.classList.add('dragging');
    try{strip.setPointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  });
  strip.addEventListener('pointermove',(event)=>{
    if(!drag) return;
    const rect=strip.getBoundingClientRect();
    const maxX=Math.max(0,window.innerWidth-rect.width);
    const maxY=Math.max(0,window.innerHeight-rect.height);
    strip.style.left=clamp(event.clientX-drag.dx,0,maxX)+'px';
    strip.style.top=clamp(event.clientY-drag.dy,0,maxY)+'px';
  });
  const release=(event)=>{
    if(!drag) return;
    drag=null;
    strip.classList.remove('dragging');
    try{strip.releasePointerCapture(event.pointerId);}catch{}
    saveRunStripPosition(strip);
  };
  strip.addEventListener('pointerup',release);
  strip.addEventListener('dblclick',(event)=>{
    if(event.target.closest('button')) return;
    resetRunStripPosition(strip);
  });
  strip.addEventListener('pointercancel',release);
  // A window resize can leave the strip out of reach after it was dragged.
  window.addEventListener('resize',()=>{
    if(!strip.style.left) { placeRunStripDefault(strip); return; }
    if(window.innerWidth<=0||window.innerHeight<=0) return;
    const rect=strip.getBoundingClientRect();
    strip.style.left=clamp(rect.left,0,Math.max(0,window.innerWidth-rect.width))+'px';
    strip.style.top=clamp(rect.top,0,Math.max(0,window.innerHeight-rect.height))+'px';
    saveRunStripPosition(strip);
  });
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initRunStripDrag);
else initRunStripDrag();
`;
