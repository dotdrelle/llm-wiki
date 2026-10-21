export const SKILL_CHAINS_SCRIPT = `// Wall-clock end of a settled chain or card, hours and minutes (Logs keep seconds).
function activityClock(value) {
  return formatLocalTime(Number(value)||value,{seconds:false});
}
function skillChainsHTML() {
  const chains=Array.isArray(runtimeState?.skillChains)?runtimeState.skillChains:[];
  // A chain deleted before any step started is gone for the reader: nothing
  // ran, nothing was skipped. A chain stopped mid-way stays, to show the rest.
  const visible=chains.filter(chain=>chain.status!=='done'&&!(chain.steps||[]).every(step=>step.status==='cancelled'&&!step.runId));
  if(!visible.length) return '';
  const statusLabel={running:'Running',queued:'Queued',failed:'Failed',cancelled:'Cancelled',incomplete:'Incomplete',warning:'Warning'};
  const blocks=visible.map(chain=>{
    const steps=(chain.steps||[]).map(step=>{
      // A warning: the step is done, a check found a convention not met.
      const reason=step.skipReason?\` · \${esc(step.skipReason)}\`:step.warning?' · warning':'';
      const warningText=step.warning?\`<div class="chain-warning-text">\${esc(step.warning)}</div>\`:'';
      // The running step carries the runId of the run currently driving it, so
      // the chain is visibly tied to the run shown in the Plan tab.
      const run=(chain.status==='running'&&step.status==='running'&&step.runId)?\` · run \${esc(step.runId)}\`:'';
      return \`<div class="chain-step chain-\${esc(step.status)}\${step.warning?' chain-warning':''}"><span class="chain-symbol">\${esc(step.symbol||'○')}</span><span class="chain-label">\${esc(step.label||'')}</span><span class="chain-status">\${esc(step.status)}\${run}\${reason}</span></div>\${warningText}\`;
    }).join('');
    // A settled chain says when it ended, like the Queue cards.
    const ended=chain.status!=='running'&&chain.status!=='queued'&&chain.finishedAt?activityClock(chain.finishedAt):'';
    const headStatus=(statusLabel[chain.status]||esc(chain.status||''))+(ended?' · '+esc(ended):'');
    const live=chain.status==='running'?'<span class="chain-live">●</span>':'';
    return \`<div class="chain-block"><div class="chain-head"><span class="chain-title">\${esc(chain.skillName||'skill')}</span>\${live}<span class="chain-count">\${chain.steps.length} step\${chain.steps.length>1?'s':''}</span><span class="chain-head-status chain-head-status-\${esc(chain.status||'')}">\${headStatus}</span></div>\${steps}</div>\`;
  }).join('');
  return blocks;
}`;
