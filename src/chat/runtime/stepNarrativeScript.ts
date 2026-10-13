export const STEP_NARRATIVE_SCRIPT = `/* ── Donna's account of the steps ─────────────────────────────────────── */
// runtimeState.stepNarratives: the steps of the latest runs and action turns,
// worded by the model in the workspace language (manager
// runtime/stepNarrator.js). The text is Donna's, so nothing here adds a word
// of its own: no heading, only a state mark per line. Without a narrative the
// Plan tab keeps showing the steps as data, as before.
function threadStepNarratives() {
  const all=Array.isArray(runtimeState?.stepNarratives)?runtimeState.stepNarratives:[];
  return all.filter(entry=>!entry.conversationId||entry.conversationId===currentConversationId).slice(-3).reverse();
}
function narratedRunIds() {
  return new Set(threadStepNarratives().map(entry=>entry.runId).filter(Boolean));
}
function stepNarrativeHTML() {
  const entries=threadStepNarratives();
  if(!entries.length) return '';
  return entries.map(entry=>\`<div class="step-narrative\${entry.final?' final':''}" data-scope="\${esc(entry.scope)}">\${entry.lines.map(line=>{
    const status=line.state==='failed'?'failed':line.state==='running'&&!entry.final?'running':'done';
    return \`<div class="act-line \${status}"><span class="act-line-dot"></span><span class="act-line-text"><span class="act-line-label">\${esc(line.text)}</span></span></div>\`;
  }).join('')}</div>\`).join('<div class="act-section-rule"></div>');
}
`;
