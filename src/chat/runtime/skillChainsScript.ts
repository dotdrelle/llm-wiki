export const SKILL_CHAINS_SCRIPT = `function skillChainsHTML() {
  const chains=Array.isArray(runtimeState?.skillChains)?runtimeState.skillChains:[];
  const visible=chains.filter(chain=>chain.status!=='done');
  if(!visible.length) return '';
  const blocks=visible.map(chain=>{
    const steps=(chain.steps||[]).map(step=>{
      const reason=step.skipReason?\` · \${esc(step.skipReason)}\`:'';
      return \`<div class="chain-step chain-\${esc(step.status)}"><span class="chain-symbol">\${esc(step.symbol||'○')}</span><span class="chain-label">\${esc(step.label||'')}</span><span class="chain-status">\${esc(step.status)}\${reason}</span></div>\`;
    }).join('');
    const selection=chain.selectionKind?\` · \${esc(chain.selectionKind)}\`:'';
    return \`<div class="chain-block"><div class="chain-head">\${esc(chain.skillName||'skill')}\${selection} · \${chain.steps.length} step\${chain.steps.length>1?'s':''}</div>\${steps}</div>\`;
  }).join('');
  return \`<div class="act-section-head"><span class="act-section-title">Chain</span></div>\${blocks}\`;
}`;
