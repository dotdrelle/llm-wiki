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
  const batchCounter=counter(p.batchIndex,p.batchCount,'Batch')
    || counter(Number(p.batchIndex)+1,p.batchCount,'Batch');
  const batchDetail=/^batch\\s+\\d+\\/\\d+/i.test(String(p.detail||''))?null:p.detail;
  const instructions=Number(p.instructionCount);
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
function updateRunStrip() {
  const strip=$('run-strip');
  if(!strip) return;
  const active=runIsActive();
  document.body.classList.toggle('run-active',active);
  if(!active) { strip.hidden=true; return; }
  strip.hidden=false;
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
`;
