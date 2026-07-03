export const PRODUCTION_STATE_SCRIPT = `// ── Suivi production ────────────────────────────────────────────────────────

function productionTerminal(status) {
  return ['done','failed','cancelled'].includes(String(status||''));
}

function parseProductionJSON(result) {
  const data=parseToolJSON(result);
  return data && typeof data==='object' ? data : null;
}

function resetProductionState() {
  if(productionState.pollTimer) clearTimeout(productionState.pollTimer);
  if(productionState.countdownTimer) clearInterval(productionState.countdownTimer);
  productionState={jobId:null,job:null,progress:null,logs:[],command:'',traceFile:'',trace:null,pollTimer:null,countdownTimer:null,lastUpdatedAt:null,notifiedTerminalJobIds:new Set()};
  renderProductionTrace();
}

function extractProductionDetails(lines) {
  const out={command:'',traceFile:''};
  for(const line of lines||[]) {
    const cmd=String(line).match(/^\\[cmd\\]\\s+cwd=.*?\\s+(node\\s+.+)$/);
    if(cmd) out.command=cmd[1];
    const trace=String(line).match(/Trace file:\\s*(.+)$/);
    if(trace) out.traceFile=trace[1].trim();
  }
  return out;
}

function formatDuration(seconds) {
  const s=Math.max(0,Math.floor(Number(seconds)||0));
  const m=Math.floor(s/60), r=s%60;
  if(m<1) return \`\${r}s\`;
  const h=Math.floor(m/60), mm=m%60;
  return h ? \`\${h}h \${String(mm).padStart(2,'0')}m\` : \`\${m}m \${String(r).padStart(2,'0')}s\`;
}

function retryRemainingSeconds(progress) {
  const retryAt=progress?.retryAt ? Date.parse(progress.retryAt) : NaN;
  if(Number.isFinite(retryAt)) return Math.max(0,Math.ceil((retryAt-Date.now())/1000));
  const waitMs=Number(progress?.waitMs);
  const lastAt=progress?.lastEventAt ? Date.parse(progress.lastEventAt) : NaN;
  if(Number.isFinite(waitMs)&&Number.isFinite(lastAt)) return Math.max(0,Math.ceil((lastAt+waitMs-Date.now())/1000));
  return null;
}

function formatCountdown(seconds) {
  if(seconds===null) return '';
  const s=Math.max(0,Math.floor(seconds));
  const m=Math.floor(s/60), r=s%60;
  return m ? \`\${m}m \${String(r).padStart(2,'0')}s\` : \`\${r}s\`;
}

function syncProductionCountdown(progress) {
  const remaining=retryRemainingSeconds(progress);
  if(remaining!==null && remaining>0 && !productionState.countdownTimer) {
    productionState.countdownTimer=setInterval(()=>renderProductionTrace(),1000);
  }
  if((remaining===null || remaining<=0 || productionTerminal(productionState.job?.status)) && productionState.countdownTimer) {
    clearInterval(productionState.countdownTimer);
    productionState.countdownTimer=null;
  }
  return remaining;
}

function productionTargetLabel(job) {
  const templates=Array.isArray(job?.templates) ? job.templates : [];
  const deliverables=Array.isArray(job?.deliverables) ? job.deliverables : [];
  const targets=[...templates,...deliverables].filter(Boolean);
  if(targets.length) return targets.join(', ');
  return job?.jobId || 'job';
}

function productionStatusLabel(status) {
  const map={queued:'pending',running:'running',done:'done',failed:'failed',cancelled:'cancelled'};
  return map[status] || status || 'unknown';
}

function isProductionToolName(name) {
  return String(name||'').startsWith('production_');
}

function toolCallFunctionName(tc) {
  return String(tc?.function?.name || tc?.name || '');
}

function toolCallArgsObject(tc) {
  try { return JSON.parse(tc?.function?.arguments || '{}'); } catch { return {}; }
}

function stableToolArgsKey(value) {
  if(Array.isArray(value)) return '['+value.map(stableToolArgsKey).join(',')+']';
  if(value && typeof value==='object') {
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableToolArgsKey(value[k])).join(',')+'}';
  }
  return JSON.stringify(value);
}

function toolCallRepeatKey(tc) {
  return \`\${toolCallFunctionName(tc)}:\${stableToolArgsKey(toolCallArgsObject(tc))}\`;
}`;
