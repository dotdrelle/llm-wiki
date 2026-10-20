/**
 * Donna's run narration, as one zone under the live `>_`.
 *
 * A run's step narrations are conversation entries (`progress: true`, one per
 * finished step). Rendered as ordinary answers they stacked up in the thread
 * as messages of their own — "Exploration terminée.", "Revue effectuée.",
 * then "Thinking…" below them — when they are the narration of the work in
 * progress. They now live UNDER the live line that speaks for that work: the
 * turn's Thinking bubble, or the run's live line once the turn has handed
 * over. When that live element goes, its lines stay where they were, frozen
 * into a static narration block on its own background; a line that arrives
 * after the run ended (its final narration follows the outcome) joins the
 * block of its run instead of standing alone under the answer.
 *
 * The block never carries `.runtime-thinking`: that class marks what
 * `removeTransientMessages` drops from a saved conversation.
 */
export const NARRATION_CSS = `:root{--narration-bg:color-mix(in srgb,var(--panel-soft,var(--panel)) 78%,transparent);--narration-border:color-mix(in srgb,var(--border) 70%,transparent)}
.msg.assistant:has(> .msg-content > .bubble > .runtime-thinking) .bubble,.narration-block .bubble{background:var(--narration-bg);border:1px solid var(--narration-border);border-radius:10px;padding:8px 12px}
.narration-zone{display:flex;align-items:flex-start;gap:10px;color:var(--muted);font-size:13px;line-height:1.5}
.narration-mark{flex:none;font-family:var(--font-mono);font-size:13px;line-height:inherit;color:var(--muted)}
.narration-lines{display:flex;flex-direction:column;gap:2px;min-width:0}
.narration-lines:empty{display:none}
.narration-lines .msg.narration-line{width:auto;display:block;animation:none}
.narration-lines .narration-line .bubble{background:none!important;border:0!important;padding:0!important;color:var(--muted);font-size:13px;line-height:1.5}
.narration-lines .narration-line .bubble p{margin:0}
.narration-block:not(:has(.narration-line:not(.msg-empty):not([hidden]))){display:none}
`;

// Starts on a newline: it is concatenated after RUN_LIVE_LINE_SCRIPT.
export const NARRATION_BLOCK_SCRIPT = `
function narrationBlockEl(runId) {
  const block=document.createElement('div');
  block.className='msg assistant narration-block';
  if(runId) block.dataset.narrationRun=String(runId);
  block.innerHTML='<div class="msg-content"><div class="bubble"><div class="narration-zone"><div class="narration-mark">>_</div><div class="narration-lines"></div></div></div></div>';
  return block;
}
// The live element speaking for the work right now: this thread's waiting
// bubble, or the run's live line.
function narrationHost() {
  const bubbles=[...armedReplyStatusEls,...pendingRuntimeStatusEls].filter(el=>el?.isConnected
    &&(!el._conversationId||!currentConversationId||el._conversationId===currentConversationId));
  if(bubbles.length) return bubbles[bubbles.length-1];
  return runLiveLineEl&&runLiveLineEl.isConnected?runLiveLineEl:null;
}
// Lines sit under the title and above the live step, so the zone reads in
// order: "Thinking…", what is done, what is running.
function narrationHostLines(host) {
  let lines=host.querySelector('.narration-lines');
  if(lines) return lines;
  const copy=host.querySelector('.runtime-thinking-copy');
  if(!copy) return null;
  lines=document.createElement('div');
  lines.className='narration-lines';
  copy.insertBefore(lines,copy.lastElementChild);
  return lines;
}
function appendNarrationLine(content,runId=null) {
  removeEmpty();
  const wrap=$('messages');
  const el=document.createElement('div');
  el.className='msg assistant progress narration-line';
  if(runId) el.dataset.narrationRun=String(runId);
  el.dataset.copy=content||'';
  el.innerHTML='<div class="msg-content"><div class="bubble">'+renderMd(content||'')+'</div></div>';
  const host=narrationHost();
  const hostLines=host?narrationHostLines(host):null;
  if(hostLines) {
    if(runId&&host===runLiveLineEl) host.dataset.narrationRun=String(runId);
    hostLines.appendChild(el);
  } else {
    // A late line of a run already frozen joins that run's block.
    const own=runId?[...wrap.querySelectorAll('.narration-block')].reverse()
      .find(block=>block.dataset.narrationRun===String(runId)):null;
    let block=own||(wrap.lastElementChild?.classList.contains('narration-block')?wrap.lastElementChild:null);
    if(!block){ block=narrationBlockEl(runId); wrap.appendChild(block); }
    block.querySelector('.narration-lines').appendChild(el);
  }
  wrap.scrollTop=wrap.scrollHeight;
  return el;
}
// Before a live element goes, its lines stay in place as a static block —
// merged into the block right above when there is one.
function freezeNarrationHost(host) {
  const lines=[...(host?.querySelectorAll('.narration-lines > .narration-line')||[])];
  if(!lines.length||!host.parentNode) return;
  const previous=host.previousElementSibling;
  const block=previous?.classList.contains('narration-block')?previous:narrationBlockEl(host.dataset.narrationRun||lines[0].dataset.narrationRun);
  const list=block.querySelector('.narration-lines');
  lines.forEach(line=>list.appendChild(line));
  if(block!==previous) host.parentNode.insertBefore(block,host);
}
// Conversations saved before this zone carry loose progress messages:
// gather each run of consecutive ones into a block.
function groupLooseNarrations(root) {
  root?.querySelectorAll(':scope > .msg.assistant.progress:not(.narration-line)').forEach(msg=>{
    msg.classList.add('narration-line');
    msg.querySelector('.msg-actions')?.remove();
    const previous=msg.previousElementSibling;
    const block=previous?.classList.contains('narration-block')?previous:narrationBlockEl();
    if(block!==previous) msg.parentNode.insertBefore(block,msg);
    block.querySelector('.narration-lines').appendChild(msg);
  });
}`;
