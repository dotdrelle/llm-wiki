/**
 * The live `>_` line of a run, in the chat.
 *
 * A turn shows its last step in its waiting bubble, but a run launched from a
 * turn — a skill, a queued request — outlives it: the turn ended on "queued,
 * progress will be reported" and the chat then stayed silent until the
 * outcome. This line follows the active run of the open conversation, one
 * step at a time (each replaces the previous one: a live indicator, never a
 * list — the full trail stays in Activity → Logs), says when the run waits
 * for the user's approval, and disappears when the run ends. It never shows
 * while a turn's own bubble is up, so one thing at a time speaks.
 */
// Starts on a newline: it is concatenated right after RUN_STRIP_SCRIPT.
export const RUN_LIVE_LINE_SCRIPT = `
let runLiveLineEl=null;
function runLiveLineActive() {
  const status=String(runtimeState?.status||'').toLowerCase();
  if(!runtimeState||!(runtimeState.running===true||['running','pending_approval','waiting'].includes(status))) return false;
  // Only the run of the open conversation: a run another thread launched
  // speaks in that thread.
  const item=(Array.isArray(runtimeState.controlQueue)?runtimeState.controlQueue:[]).find(entry=>entry&&entry.status==='running');
  return !item||!item.conversationId||item.conversationId===currentConversationId;
}
function runLiveLineStatusLabel() {
  return String(runtimeState?.status||'').toLowerCase()==='pending_approval'?'Waiting for your approval — nothing runs before it.':'';
}
function syncRunLiveLine() {
  const show=runLiveLineActive()&&!pendingRuntimeStatusEls.length;
  if(!show){ if(runLiveLineEl){ runLiveLineEl.remove(); runLiveLineEl=null; } return; }
  const wrap=$('messages');
  if(!wrap) return;
  if(!runLiveLineEl||!runLiveLineEl.isConnected){
    runLiveLineEl=document.createElement('div');
    runLiveLineEl.className='msg assistant run-live-line';
    runLiveLineEl.innerHTML='<div class="msg-content"><div class="bubble"><div class="runtime-thinking"><div class="typing">>_</div><span>Run started…</span></div></div></div>';
  }
  // Always the last line of the thread: an announcement that arrives during
  // the run lands above it.
  if(wrap.lastElementChild!==runLiveLineEl){ wrap.appendChild(runLiveLineEl); wrap.scrollTop=wrap.scrollHeight; }
  const waiting=runLiveLineStatusLabel();
  if(waiting) setRunLiveLine(waiting);
}
function setRunLiveLine(text) {
  setProgressText(runLiveLineEl?.querySelector('.runtime-thinking span'),text);
}
// The agent's business line, compacted for one line: "Step 1/1" counts
// nothing, and "LLM running" is what a running ingest always does.
function runLiveLineActivityText(progress) {
  const parts=[String(progress.label||'').trim(),runStripDetail(progress,null),runStripPercent(progress.percent)]
    .join(' · ').split(' · ').map(part=>part.trim())
    .filter(part=>part&&!/^Step 1\\/1$/i.test(part)&&!/^LLM running\\b/i.test(part));
  const text=parts.join(' · ');
  return text.length>120?text.slice(0,120)+'…':text;
}
// The run's own steps: what the turn bubble reads (runtime logs, progress
// notes) plus the two events only a run carries — a tool it calls and the
// business line its agent publishes (document, counters, percent).
function runLiveLineLabel(event) {
  const type=event&&event.type;
  const p=(event&&event.payload)||{};
  if(type==='tool_call_started'&&p.name) {
    const summary=String(p.summary||'').trim();
    return progressToolLabel(String(p.name)+(summary&&summary!=='calling...'?' ('+summary+')':''));
  }
  if(type==='activity_upserted') return runLiveLineActivityText(p.activity?.progress||{});
  const label=runtimeProgressLabel(event);
  return label==='Writing the answer…'?'':label;
}
function noteRunLiveEvent(event) {
  if(!runLiveLineEl||!runLiveLineEl.isConnected) return;
  const label=runLiveLineStatusLabel()||runLiveLineLabel(event);
  if(label) setRunLiveLine(label);
}`;
