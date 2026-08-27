export const SKILL_CHAINS_SCRIPT = `function skillChainsHTML() {
  const chains=Array.isArray(runtimeState?.skillChains)?runtimeState.skillChains:[];
  const visible=chains.filter(chain=>chain.status!=='done');
  if(!visible.length) return '';
  const statusLabel={running:'Running',queued:'Queued',failed:'Failed',cancelled:'Cancelled',incomplete:'Incomplete'};
  const blocks=visible.map(chain=>{
    const steps=(chain.steps||[]).map(step=>{
      const reason=step.skipReason?\` · \${esc(step.skipReason)}\`:'';
      // The running step carries the runId of the run currently driving it, so
      // the chain is visibly tied to the run shown in the Plan tab.
      const run=(chain.status==='running'&&step.status==='running'&&step.runId)?\` · run \${esc(step.runId)}\`:'';
      return \`<div class="chain-step chain-\${esc(step.status)}"><span class="chain-symbol">\${esc(step.symbol||'○')}</span><span class="chain-label">\${esc(step.label||'')}</span><span class="chain-status">\${esc(step.status)}\${run}\${reason}</span></div>\`;
    }).join('');
    const selection=chain.selectionLabel?\` · \${esc(chain.selectionLabel)}\`:'';
    const headStatus=statusLabel[chain.status]||esc(chain.status||'');
    const live=chain.status==='running'?'<span class="chain-live">●</span>':'';
    return \`<div class="chain-block"><div class="chain-head"><span class="chain-title">\${esc(chain.skillName||'skill')}\${selection}</span>\${live}<span class="chain-count">\${chain.steps.length} step\${chain.steps.length>1?'s':''}</span><span class="chain-head-status chain-head-status-\${esc(chain.status||'')}">\${headStatus}</span></div>\${steps}</div>\`;
  }).join('');
  return blocks;
}`;
