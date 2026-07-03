export const OBSERVER_TOOLS_SCRIPT = `function isPossiblyTruncatedToolResult(data, raw='') {
  const text=String(raw||'');
  if(/\\b(stdout_tail|stderr_tail|tail|truncated)\\b/i.test(text)) return true;
  if(data && typeof data==='object') {
    if(data.truncated === true || data.isTruncated === true) return true;
    if(data.coverage?.truncatedPageCount > 0) return true;
    if(data.stdout_tail || data.stderr_tail) return true;
  }
  return false;
}

function scalarSummaryBits(data, limit=5) {
  if(!data || typeof data!=='object' || Array.isArray(data)) return [];
  return Object.entries(data)
    .filter(([,value])=>value===null || ['string','number','boolean'].includes(typeof value))
    .slice(0,limit)
    .map(([key,value])=>\`\${key}: \${shortText(value,80)}\`);
}

function observerResultSummary(r) {
  const raw=typeof r.content==='string' ? r.content : JSON.stringify(r.content,null,2);
  const data=parseToolJSON(r.content);
  const warnings=isPossiblyTruncatedToolResult(data,raw)
    ? ['result may be partial/truncated']
    : [];
  if(data?.job || data?.jobId || (data?.jobs && Array.isArray(data.jobs))) {
    return [productionToolSummary([r]),...warnings].filter(Boolean).join('\\n');
  }
  if(data?.sources && Array.isArray(data.sources)) {
    const sourceLines=data.sources.slice(0,12).map((source,i)=>{
      const name=source?.name || source?.id || source?.source || source?.path || source?.url || \`source \${i+1}\`;
      const meta=[source?.type,source?.status,source?.path,source?.url].filter(Boolean).map(v=>shortText(v,70)).join(' · ');
      return \`- \${name}\${meta ? \` — \${meta}\` : ''}\`;
    });
    const more=data.sources.length>sourceLines.length ? [\`- +\${data.sources.length-sourceLines.length} more source(s)\`] : [];
    const header=\`\${data.sources.length} CME source\${data.sources.length>1?'s':''} configured.\`;
    return [header,...sourceLines,...more,...warnings].join('\\n');
  }
  if(Array.isArray(data)) {
    const shown=data.slice(0,8).map((item)=>\`- \${shortText(typeof item==='object' ? JSON.stringify(item) : item,140)}\`);
    return [\`\${data.length} item\${data.length>1?'s':''}.\`,...shown,...warnings].join('\\n');
  }
  if(data && typeof data==='object') {
    const bits=scalarSummaryBits(data,6);
    const arrayBits=Object.entries(data)
      .filter(([,value])=>Array.isArray(value))
      .slice(0,4)
      .map(([key,value])=>\`\${key}: \${value.length}\`);
    const lines=[...bits,...arrayBits].map(bit=>\`- \${bit}\`);
    return [\`\${r.name}: \${toolResultTraceSummary(r.content,true)}\`,...lines,...warnings].filter(Boolean).join('\\n');
  }
  return \`\${r.name}: \${shortText(raw,500)}\${warnings.length ? \`\\n- \${warnings[0]}\` : ''}\`;
}

function mcpToolDefinition(name, server=null) {
  const owner=server||findServerForTool(name);
  return owner?.tools?.find(tool=>tool.name===name)||null;
}

function isObserverToolName(name, server=null) {
  const fn=String(name||'');
  const annotations=mcpToolDefinition(fn,server)?.annotations;
  if(annotations?.readOnlyHint===true && annotations?.destructiveHint!==true) return true;
  if(annotations?.readOnlyHint===false || annotations?.destructiveHint===true) return false;
  return /(?:^|_)(status|list|logs?|history|trace|summary|stats)$/i.test(fn) ||
    /(?:^|_)list_/i.test(fn) ||
    /(?:^|_)(?:get|read|show|describe|inspect|check|search|find|query|fetch)(?:_|$)/i.test(fn);
}

function observerToolLoopSummary(toolResults, repeated=false) {
  const names=[...new Set((toolResults||[]).map(r=>r.name).filter(Boolean))];
  const prefix=repeated
    ? 'Observation chain stopped after repeated status/list calls.'
    : 'Observation complete.';
  const details=(toolResults||[]).map(observerResultSummary).filter(Boolean);
  return [prefix,names.length?\`Tools: \${names.join(', ')}\`:null,...details]
    .filter(Boolean)
    .join('\\n');
}

function observerStatusBadgeClass(status) {
  const v=String(status||'').toLowerCase().replace(/[\\s_-]/g,'');
  if(/^(ok|configured|connected|done|success|complete|converted)$/.test(v)) return 'ok';
  if(/^(notconfigured|missing|disconnected|failed|error)$/.test(v)) return 'fail';
  if(/^(running|active|starting|started)$/.test(v)) return 'run';
  if(/^(queued|pending|waiting)$/.test(v)) return 'queue';
  if(/^(stored|partial|warning)$/.test(v)) return 'warn';
  return '';
}
function mcpObjectCardHTML(toolName, data, {raw=''}={}) {
  const status=data.status||data.state||data.connectionStatus||null;
  const actionRequired=data.action_required||data.actionRequired||null;
  const error=data.error||data.errorMessage||null;
  const skip=new Set(['status','state','action_required','actionRequired','error','errorMessage','_activity']);
  const kvRows=Object.entries(data)
    .filter(([k,v])=>!skip.has(k)&&v!==null&&v!==undefined&&typeof v!=='object')
    .slice(0,14)
    .map(([k,v])=>\`<span class="obs-k">\${esc(k)}</span><span class="obs-v">\${esc(String(v))}</span>\`)
    .join('');
  const complexRows=Object.entries(data)
    .filter(([k,v])=>!skip.has(k)&&v!==null&&typeof v==='object')
    .slice(0,4)
    .map(([k,v])=>{
      const count=Array.isArray(v)?v.length:Object.keys(v||{}).length;
      return \`<span class="obs-list-item" title="\${esc(JSON.stringify(v))}">\${esc(k)}: \${count} \${Array.isArray(v)?'items':'fields'}</span>\`;
    })
    .join('');
  const badgeHtml=status?\`<span class="obs-badge \${observerStatusBadgeClass(status)}">\${esc(status)}</span>\`:'';
  const actionHtml=actionRequired?\`<div class="obs-action-hint">⚡ \${esc(actionRequired)}</div>\`:'';
  const errorHtml=error?\`<div class="obs-error-hint">\${esc(String(error))}</div>\`:'';
  const rawHtml=raw?\`<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>\`:'';
  return \`<div class="obs-card"><div class="obs-card-head"><span class="obs-tool-name">\${esc(toolName)}</span>\${badgeHtml}</div>\${kvRows?\`<div class="obs-kv-grid">\${kvRows}</div>\`:''}\${complexRows?\`<div class="obs-list">\${complexRows}</div>\`:''}\${actionHtml}\${errorHtml}\${rawHtml}</div>\`;
}
function observerResultHTML(r) {
  const data=parseToolJSON(r.content);
  const name=r.name||'tool';
  if(data?.job||data?.jobId||(data?.jobs&&Array.isArray(data.jobs))) return renderMd(observerResultSummary(r));
  if(data&&typeof data==='object'&&!Array.isArray(data)) return mcpObjectCardHTML(name,data);
  if(Array.isArray(data)&&data.length>0) {
    const items=data.slice(0,10);
    const extra=data.length>items.length?\`<span class="obs-list-item" style="color:var(--muted)">+\${data.length-items.length} more</span>\`:'';
    const rows=items.map(item=>\`<span class="obs-list-item">\${esc(typeof item==='object'?JSON.stringify(item):String(item))}</span>\`).join('');
    return \`<div class="obs-card"><div class="obs-card-head"><span class="obs-tool-name">\${esc(name)}</span><span class="obs-badge ok">\${data.length} items</span></div><div class="obs-list">\${rows}\${extra}</div></div>\`;
  }
  return renderMd(observerResultSummary(r));
}
function observerToolLoopHTML(toolResults, repeated=false) {
  const chip=repeated
    ? 'Observation chain stopped'
    : 'Observation complete';
  const cards=(toolResults||[]).map(observerResultHTML).join('');
  return \`<div class="obs-wrap"><div class="obs-chip">\${chip}</div>\${cards}</div>\`;
}

function toolResultsFallback(toolResults) {
  if(!toolResults?.length) return null;
  const isProd=toolResults.every(r=>isProductionToolName(r.name));
  const text=isProd?productionToolSummary(toolResults):observerToolLoopSummary(toolResults,false);
  const html=isProd?renderMd(text):observerToolLoopHTML(toolResults,false);
  return {text,html};
}

function shouldStopAfterProductionTools(toolCalls) {
  if(!toolCalls?.length || !toolCalls.every(tc=>isProductionToolName(toolCallFunctionName(tc)))) return false;
  return toolCalls.some(tc=>[
    'production_start_job',
    'production_job_status',
    'production_job_logs',
    'production_cancel_job',
  ].includes(toolCallFunctionName(tc)));
}`;
