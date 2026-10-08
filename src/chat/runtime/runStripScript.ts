export const RUN_STRIP_SCRIPT = `// The run's live figures read in Activity → Plan only (the floating strip is
// gone): the formatting the Plan tab shares, and the run/queue Cancel actions.
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
  // While the engine extracts several sources at once, sourceIndex (the source
  // being committed) lags far behind: the per-file states the production agent
  // reports are the live truth, the 1-based index stays the fallback for older
  // agents. Same source as the run graph's input nodes.
  const sourceStates=p.sourceStates&&typeof p.sourceStates==='object'?Object.values(p.sourceStates).map(String):null;
  const sourceStatesTotal=sourceStates?.length||0;
  const sourceTotal=Number(p.sourceCount)>0?Number(p.sourceCount):sourceStatesTotal;
  const sourceCounter=sourceStates&&sourceStatesTotal
    ? \`Sources \${sourceStates.filter(value=>value==='running').length} running\`
      +(sourceStates.some(value=>value==='done')?\` · \${sourceStates.filter(value=>value==='done').length} done\`:'')
      +\` / \${sourceTotal}\`
    : counter(p.sourceIndex,p.sourceCount,'Source');
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
// Number(null) and Number('') are both 0, so "no percentage" rendered a pinned
// 0% badge for the whole run — and the plan-step fallback line always carries
// percent:null, which is the common case. Absent is absent.
function runStripPercent(value) {
  if(value==null||value==='') return '';
  const percent=Number(value);
  return Number.isFinite(percent)?Math.round(percent)+'%':'';
}
// Deterministic control verbs stay buttons (root rule: cancel/enqueue/approve
// never go through a Donna turn). The run card's Cancel is chain-scoped on the
// runtime side: it cancels the current run, its agent jobs and the rest of ITS
// skill chain, leaving the unrelated queued requests alone — each of those has
// its own Cancel in Plan.
async function confirmCancelRuntimeRun(button) {
  if(!runtimeEnabled()) return;
  if(!(await confirmAction({title:'Cancel the run',message:'Cancel the current run? Its running job is stopped and its remaining chain steps are skipped; other queued requests stay in the queue.',confirmLabel:'Cancel run',danger:true}))) return;
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
`;
