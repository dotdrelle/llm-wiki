export const PRODUCTION_TRACE_SCRIPT = `function productionProgressDetail(job, progress) {
  const sourceCount=Number(progress?.sourceCount);
  const sourceIndex=Number(progress?.sourceIndex);
  const sourceDoneCount=Number(progress?.sourceDoneCount);
  const retrySeconds=syncProductionCountdown(progress);
  const retryText=retrySeconds!==null && retrySeconds>0 ? \`retry in \${formatCountdown(retrySeconds)}\` : null;
  const sourceProgress=Number.isFinite(sourceCount) && sourceCount>0
    ? Number.isFinite(sourceIndex)
      ? \`file \${Math.min(sourceCount,sourceIndex+1)}/\${sourceCount}\`
      : Number.isFinite(sourceDoneCount)
        ? \`\${Math.min(sourceCount,sourceDoneCount)}/\${sourceCount} files processed\`
        : \`\${sourceCount} file\${sourceCount>1?'s':''}\`
    : null;
  return [
    progress?.source ? \`file \${String(progress.source).split('/').pop()}\` : null,
    sourceProgress,
    progress?.detail,
    progress?.batchCount ? \`batch \${Number(progress.batchIndex ?? 0)+1}/\${progress.batchCount}\` : null,
    progress?.instructionCount ? \`\${progress.instructionCount} instruction\${progress.instructionCount>1?'s':''}\` : null,
    retryText,
    progress?.lastEvent ? \`last: \${progress.lastEvent}\` : null,
    job?.error ? \`error: \${job.error}\` : null,
  ].filter(Boolean).join(' · ');
}

function productionStepDetail(step, job, progress) {
  const logs=productionState.logs||[];
  const details=extractProductionDetails([...(job?.logTail||[]),...logs]);
  const command=productionState.command || details.command || '';
  const traceFile=productionState.traceFile || details.traceFile || progress?.traceFile || '';
  const status=String(step?.status||job?.status||'');
  const percent=Number.isFinite(Number(progress?.percent)) ? Math.max(0,Math.min(100,Number(progress.percent))) : null;
  const logLines=logs.length ? logs.slice(-80).join('\\n') : 'No logs loaded.';
  return {
    title: progress?.phase || step?.name || job?.type || 'production',
    status,
    duration: formatDuration(step?.durationSeconds ?? job?.durationSeconds),
    exitCode: step?.exitCode ?? job?.exitCode,
    percent,
    detail: productionProgressDetail(job, progress || {}),
    command,
    traceFile,
    logs: logLines,
    error: job?.error || '',
  };
}

function renderProductionTrace() {
  const trace=productionState.trace;
  if(!trace) return;
  const job=productionState.job;
  const progress=productionState.progress || {};
  if(!job && !productionState.jobId) return;
  const steps=Array.isArray(job?.steps) && job.steps.length ? job.steps : [{name:job?.type||'production',status:job?.status||'queued'}];
  steps.forEach((step,index)=>{
    const id=\`prod-\${productionState.jobId||job?.jobId||'job'}-\${step.name||index}\`.replace(/[^a-zA-Z0-9_-]/g,'-');
    const detail=productionStepDetail(step,job,progress);
    const status=String(detail.status||'');
    const percentText=detail.percent===null ? '' : \` · \${Math.round(detail.percent)}%\`;
    const patch={
      id,
      type:'production',
      kind:'Production',
      title:progress?.phase||step.name||job?.type||'production',
      summary:\`\${productionStatusLabel(status)}\${percentText}\`,
      status,
      ok: status==='failed' || status==='cancelled' ? false : true,
      detail,
    };
    dispatchChatAgentEvent(trace,'trace_step_upsert',{
      origin:'poll',
      payload:{step:patch},
    });
  });
  if(!trace.selectedStepId) {
    const running=trace.steps.find(s=>s.type==='production' && ['running','queued'].includes(String(s.status||'')));
    if(running) trace.selectedStepId=running.id;
  }
}

function updateProductionFromPayload(payload, {open=false, poll=false}={}) {
  if(!payload) return;
  if(payload.jobId && !payload.job) productionState.jobId=payload.jobId;
  if(payload.job) {
    productionState.job=payload.job;
    if(Array.isArray(payload.producedFiles)) productionState.job.producedFiles=payload.producedFiles;
    productionState.jobId=payload.job.jobId || productionState.jobId;
    const details=extractProductionDetails(payload.logTail||[]);
    if(details.command) productionState.command=details.command;
    if(details.traceFile) productionState.traceFile=details.traceFile;
  }
  if(payload.progress) {
    productionState.progress=payload.progress;
    if(payload.progress.traceFile) productionState.traceFile=payload.progress.traceFile;
  }
  if(Array.isArray(payload.tail)) {
    productionState.logs=payload.tail;
    const details=extractProductionDetails(payload.tail);
    if(details.command) productionState.command=details.command;
    if(details.traceFile) productionState.traceFile=details.traceFile;
  }
  if(Array.isArray(payload.logTail) && !productionState.logs.length) {
    productionState.logs=payload.logTail;
  }
  productionState.lastUpdatedAt=new Date().toISOString();
  renderProductionTrace();
  if(poll && productionState.jobId) startProductionPolling();
}

function handleProductionToolResult(fn, args, result, ok, {recover=false}={}) {
  if(!String(fn||'').startsWith('production_')) return;
  const data=parseProductionJSON(result);
  if(!ok || !data) return;
  if(fn==='production_start_job' && data.jobId) {
    updateProductionFromPayload(data,{open:false,poll:false});
    if(!recover) pollProductionJob({immediate:true});
  }
  else if(fn==='production_job_status') updateProductionFromPayload(data,{open:false,poll:!recover && !productionTerminal(data.job?.status)});
  else if(fn==='production_job_logs') updateProductionFromPayload(data,{open:false,poll:false});
  else if(fn==='production_cancel_job') updateProductionFromPayload(data,{open:false,poll:false});
  else if(fn==='production_list_jobs' && Array.isArray(data.jobs) && data.jobs[0] && !productionState.jobId) {
    productionState.jobId=data.jobs[0].jobId;
    renderProductionTrace();
  }
}

function productionToolSummary(toolResults) {
  const parsed=toolResults.map(r=>parseProductionJSON(r.content)).filter(Boolean);
  const latestWithJob=[...parsed].reverse().find(d=>d.job);
  const latestJob=latestWithJob?.job;
  const started=[...parsed].reverse().find(d=>d.jobId && d.status);
  const busy=[...parsed].reverse().find(d=>d.error==='workspace_busy');
  const listed=[...parsed].reverse().find(d=>Array.isArray(d.jobs));
  if(busy) {
    return \`Production already running: job \${busy.activeJobId || 'active'}. Tracking in agent orchestration.\`;
  }
  if(latestJob) {
    if(productionTerminal(latestJob.status)) {
      const jobId=latestJob.jobId || latestWithJob.jobId || productionState.jobId;
      if(jobId) productionState.notifiedTerminalJobIds.add(jobId);
      return productionTerminalChatSummary(latestJob);
    }
    const status=productionStatusLabel(latestJob.status);
    const target=productionTargetLabel(latestJob);
    const progress=latestWithJob.progress?.percent;
    const progressText=Number.isFinite(Number(progress)) ? \` · \${Math.round(Number(progress))}%\` : '';
    const suffix=productionTerminal(latestJob.status)
      ? latestJob.status==='failed' && latestJob.error
        ? \` Error: \${latestJob.error}\`
        : ''
      : ' Tracking in agent orchestration.';
    return \`Production \${status}: \${target}\${progressText}.\${suffix}\`;
  }
  if(started) {
    return \`Production started: job \${started.jobId} (\${productionStatusLabel(started.status)}). Tracking in agent orchestration.\`;
  }
  if(listed) {
    return listed.jobs.length
      ? \`\${listed.jobs.length} production job\${listed.jobs.length>1?'s':''} found. Agent orchestration tracks the active job if available.\`
      : 'No recent production job.';
  }
  return 'Production action executed. Agent orchestration updated.';
}

function productionTerminalChatSummary(job) {
  const status=String(job?.status||'');
  const target=productionTargetLabel(job);
  const duration=job?.durationSeconds!==undefined
    ? \` in \${formatDuration(job.durationSeconds)}\`
    : '';
  if(status==='done') return \`Production completed: \${target}\${duration}.\`;
  if(status==='failed') return \`Production failed: \${target}\${duration}.\${job?.error?\` Error: \${job.error}\`:''}\`;
  if(status==='cancelled') return \`Production cancelled: \${target}\${duration}.\`;
  return \`Production \${productionStatusLabel(status)}: \${target}.\`;
}

async function notifyProductionTerminalInChat() {
  const job=productionState.job;
  const jobId=job?.jobId || productionState.jobId;
  if(!jobId || !productionTerminal(job?.status)) return;
  const summary=productionTerminalChatSummary(job);
  if(productionState.notifiedTerminalJobIds.has(jobId)) return;
  const alreadyInChat=messages.slice(-8).some(m=>m?.role==='assistant' && m?.content===summary);
  if(alreadyInChat) {
    productionState.notifiedTerminalJobIds.add(jobId);
    return;
  }
  productionState.notifiedTerminalJobIds.add(jobId);
  appendMsg('assistant',summary);
  messages.push({role:'assistant',content:summary});
  conversationDirty=true;
  await saveCurrentConversation({immediate:true});
}

function startProductionPolling() {
  if(productionState.pollTimer) clearTimeout(productionState.pollTimer);
  productionState.pollTimer=setTimeout(()=>pollProductionJob(),4200);
}

async function pollProductionJob({immediate=false}={}) {
  if(!productionState.jobId) return;
  if(productionState.pollTimer) {
    clearTimeout(productionState.pollTimer);
    productionState.pollTimer=null;
  }
  try {
    const statusText=await callMCPTool('production_job_status',{jobId:productionState.jobId});
    updateProductionFromPayload(parseProductionJSON(statusText),{open:false,poll:false});
    const logsText=await callMCPTool('production_job_logs',{jobId:productionState.jobId,tail:120});
    updateProductionFromPayload(parseProductionJSON(logsText),{open:false,poll:false});
    await refreshProductionTraceProgress();
  } catch(e) {
    console.warn('production polling failed', e);
  }
  renderProductionTrace();
  if(productionTerminal(productionState.job?.status)) await notifyProductionTerminalInChat();
  else startProductionPolling();
}

async function refreshProductionTraceProgress() {
  const traceFile=productionState.traceFile || productionState.progress?.traceFile;
  if(!traceFile) return;
  try {
    const res=await fetch(\`/api/production/trace?path=\${encodeURIComponent(traceFile)}\`);
    if(!res.ok) return;
    const trace=await res.json();
    if(!trace?.ok) return;
    productionState.progress={
      ...(productionState.progress||{}),
      traceFile,
      lastEvent:trace.lastEvent || productionState.progress?.lastEvent,
      lastEventAt:trace.lastEventAt || productionState.progress?.lastEventAt,
      waitMs:trace.waitMs,
      retryAt:trace.retryAt,
      detail:trace.lastEvent==='provider:throttle'
        ? 'Provider quota reached, retry pending'
        : productionState.progress?.detail,
    };
    renderProductionTrace();
  } catch(e) {
    console.warn('production trace refresh failed', e);
  }
}

function recoverProductionStateFromMessages() {
  resetProductionState();
  const traceCards=Array.from(document.querySelectorAll('.trace-card'));
  productionState.trace=hydrateTraceCard(traceCards[traceCards.length-1]);
  for(const msg of messages) {
    if(msg.role!=='tool' || !String(msg.name||'').startsWith('production_')) continue;
    handleProductionToolResult(msg.name,{},msg.content,true,{recover:true});
  }
  renderProductionTrace();
}`;
