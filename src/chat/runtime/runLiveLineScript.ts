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
// The run's last step, kept apart from the element: leaving the conversation
// removes the line, and coming back recreated it on "Run started…" until the
// next event — minutes, during a long model call.
let runLiveLineLast=null;
function runLiveLineRunId() {
  return runtimeState?.runId||runtimeState?.currentRunId||null;
}
// No step seen yet in this page: start from the running activity the state
// already carries.
function runLiveLineSeedLabel() {
  const activities=Array.isArray(runtimeState?.activities)?runtimeState.activities:[];
  const running=activities.find(activity=>isActivityActive(normalizeActivityStatus(activity.status,activity.terminal)));
  return running?runLiveLineActivityText(running.progress||{}):'';
}
function runLiveLineActive() {
  const status=String(runtimeState?.status||'').toLowerCase();
  if(!runtimeState||!(runtimeState.running===true||['running','pending_approval','waiting'].includes(status))) return false;
  // Only the run of the open conversation: a run another thread launched
  // speaks in that thread. The run's own record says which thread that is —
  // reading only the control queue missed every run Donna delegated directly,
  // which then spoke in every conversation. A run that belongs to no thread
  // (a proactive review, the legacy: fallback) is shown in the open one.
  const runId=runtimeState.runId||runtimeState.currentRunId||null;
  const run=runId&&Array.isArray(runtimeState.runs)?runtimeState.runs.find(entry=>entry&&entry.id===runId):null;
  const item=(Array.isArray(runtimeState.controlQueue)?runtimeState.controlQueue:[]).find(entry=>entry&&entry.status==='running');
  const owner=run?.conversationId||item?.conversationId||null;
  return !owner||String(owner).startsWith('legacy:')||owner===currentConversationId;
}
function runLiveLineStatusLabel() {
  if(String(runtimeState?.status||'').toLowerCase()!=='pending_approval') return '';
  const runId=runLiveLineRunId();
  const approval=(Array.isArray(runtimeState?.approvals)?runtimeState.approvals:[]).find(item=>
    item?.status==='pending_approval'&&(!item.runId||!runId||item.runId===runId)
  );
  const reason=String(approval?.reason||'');
  return approval&&!approval.taskId&&/^Approve .+ before it runs\\.$/.test(reason)
    ?'Waiting for your approval to start this run.'
    :'Waiting for your approval for the pending mutation.';
}
function runLiveLineTurnBubbles() {
  return [...pendingRuntimeStatusEls,...armedReplyStatusEls].filter(el=>
    el?.isConnected&&(!el._conversationId||!currentConversationId||el._conversationId===currentConversationId)
  );
}
// A waiting bubble no pending turn owns any more (a skill turn's bubble that
// took the run's first "0%" and was never cleared) is an orphan: it would sit
// in the thread with its seconds still counting. Swept only while no turn is
// in flight, so a live turn's bubble can never be taken for one.
function removeOrphanWaitingBubbles(wrap) {
  if(pendingRuntimeStatusEls.length||armedReplyStatusEls.length) return;
  wrap?.querySelectorAll('.runtime-thinking').forEach(el=>{
    const msg=el.closest('.msg');
    if(msg&&msg!==runLiveLineEl&&!pendingRuntimeStatusEls.includes(msg)&&!armedReplyStatusEls.includes(msg)) msg.remove();
  });
}
function syncRunLiveLine() {
  removeOrphanWaitingBubbles($('messages'));
  const waiting=runLiveLineStatusLabel();
  const turnBubbles=runLiveLineTurnBubbles();
  turnBubbles.forEach(el=>setRuntimeApprovalWait(el,waiting));
  // An active turn already owns a Thinking bubble. Reuse it for approval
  // waits too, instead of adding a second typing row below Donna's narration.
  const show=runLiveLineActive()&&turnBubbles.length===0;
  if(!show){ if(runLiveLineEl){ runLiveLineEl.remove(); runLiveLineEl=null; } $('messages')?.querySelectorAll('.run-live-line').forEach(el=>el.remove()); return; }
  const wrap=$('messages');
  if(!wrap) return;
  if(!runLiveLineEl||!runLiveLineEl.isConnected){
    runLiveLineEl=document.createElement('div');
    runLiveLineEl.className='msg assistant run-live-line';
    runLiveLineEl.innerHTML='<div class="msg-content"><div class="bubble"><div class="runtime-thinking"><div class="typing">>_</div><span>Run started…</span></div></div></div>';
    const span=runLiveLineEl.querySelector('.runtime-thinking span');
    const last=runLiveLineLast&&runLiveLineLast.runId===runLiveLineRunId()?runLiveLineLast:null;
    const restored=last?.label||runLiveLineSeedLabel();
    if(restored) {
      setProgressText(span,restored);
      // The step keeps counting from when it began, not from the return.
      if(last){ span.dataset.stepSince=String(last.since); renderProgressStep(span); }
    }
  }
  // One live line only: a stray copy (restored with an old conversation, or
  // left by a re-render) would sit there as a frozen ">_ Run started…".
  wrap.querySelectorAll('.run-live-line').forEach(el=>{ if(el!==runLiveLineEl) el.remove(); });
  // Always the last line of the thread: an announcement that arrives during
  // the run lands above it.
  if(wrap.lastElementChild!==runLiveLineEl){ wrap.appendChild(runLiveLineEl); wrap.scrollTop=wrap.scrollHeight; }
  if(waiting) setRunLiveLine(waiting);
}
function setRunLiveLine(text) {
  setProgressText(runLiveLineEl?.querySelector('.runtime-thinking span'),text);
}
// The agent's business line, compacted (two lines at most): "Step 1/1" counts
// nothing, and "LLM running" is what a running ingest always does.
function runLiveLineActivityText(progress) {
  const parts=[String(progress.label||'').trim(),runStripDetail(progress,null),runStripPercent(progress.percent)]
    .join(' · ').split(' · ').map(part=>part.trim())
    .filter(part=>part&&!/^Step 1\\/1$/i.test(part)&&!/^LLM running\\b/i.test(part));
  const text=parts.join(' · ');
  return text.length>PROGRESS_LINE_MAX?text.slice(0,PROGRESS_LINE_MAX)+'…':text;
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
  const label=runLiveLineStatusLabel()||runLiveLineLabel(event);
  if(!label) return;
  // Remembered even while the line is not shown (another conversation open).
  if(runLiveLineLast?.label!==label||runLiveLineLast?.runId!==runLiveLineRunId()) runLiveLineLast={runId:runLiveLineRunId(),label,since:Date.now()};
  if(runLiveLineEl&&runLiveLineEl.isConnected) setRunLiveLine(label);
}`;
