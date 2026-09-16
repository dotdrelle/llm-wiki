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
`;
