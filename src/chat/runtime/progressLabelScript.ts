/**
 * What the `>_` line says while Donna works — the turn's waiting bubble and a
 * run's live line alike.
 *
 * Both used to show the LAST event that carried text, whatever it was: the
 * model meter (`model: run call 2 · 0.3 s · failed`), raw engine traces
 * (`trace: llm:end label=… durationMs=…`) and the agent loop's iteration
 * counter against its safety cap (`[2/80] synthesizing…`) replaced the one
 * line the reader can act on. The line is now an allow-list: a wiki search, a
 * tool and its main arguments, "Thinking…" while a model call runs (with the
 * seconds it has taken — the long silent gap between the search and the
 * answer), "Writing the answer…", and the failures that change the answer.
 * Everything else returns '' and leaves the line alone; the full trail stays
 * in Activity → Logs. Tool names stay data (no per-tool verb catalogue, see
 * the manager's progressNotes.js), and the line stays in English like the
 * rest of the interface.
 *
 * An event that belongs to another conversation never speaks here: a turn
 * still running in a chat the reader left must not write into the bubble of
 * the chat they opened with "+ New chat".
 */
// Starts on a newline: it is concatenated into the chat script.
export const PROGRESS_LABEL_SCRIPT = `
const PROGRESS_THINKING='Thinking…';
function progressEventInThread(event, conversationId) {
  const id=event&&event.conversationId;
  return !id||!conversationId||id===conversationId;
}
// "wiki.wiki_search_context (question=…)" → "wiki · wiki_search_context (question=…)".
function progressToolLabel(text) {
  const compact=String(text||'').replace(/\\s+/g,' ').replace(/…$/,'').trim();
  if(!compact) return '';
  const label=compact.replace(/^([\\w-]+)[.](\\S)/,'$1 · $2');
  return label.length>110?label.slice(0,110)+'…':label;
}
function progressMessageLabel(message) {
  const msg=String(message||'').replace(/\\s+/g,' ').trim();
  if(!msg) return '';
  if(/^Donna Searching/i.test(msg)) return 'Searching the wiki…';
  if(/^Wiki pre-search failed/i.test(msg)) return 'Wiki search failed — answering without it';
  if(/streaming (?:final|direct) answer/i.test(msg)) return 'Writing the answer…';
  if(/^Chat: condensed/i.test(msg)) return 'Condensing the pages read…';
  if(/^Chat: consulting|^Agent: planning next action|^Agent: classified input|^\\[\\d+\\/\\d+\\] synthesizing/i.test(msg)) return PROGRESS_THINKING;
  if(/^Agent: .*retrying/i.test(msg)) return 'Retrying…';
  let match=msg.match(/^Chat: (\\w+) (workspace memory|same-workspace conversation)/i);
  if(match) return (match[2].toLowerCase()==='workspace memory'?'memory':'conversation')+' · '+match[1];
  match=msg.match(/^Chat: read (.+)$/i);
  if(match) return progressToolLabel(match[1]);
  // The agent loop's own tool notes (progressNotes.js).
  match=msg.match(/^Using (.+)$/);
  if(match) return progressToolLabel(match[1]);
  if(/^\\S+ failed[.:]/.test(msg)) return msg.length>110?msg.slice(0,110)+'…':msg;
  // A tool returned: the model reads it next.
  if(/^\\S+ done[.:]/.test(msg)) return PROGRESS_THINKING;
  if(/waiting for (?:the )?(?:workspace|production) lock/i.test(msg)) return 'Waiting for the workspace lock…';
  return '';
}
function runtimeProgressLabel(event) {
  const type=event&&event.type;
  const p=(event&&event.payload)||{};
  if(type==='assistant_message'||type==='assistant_delta') return 'Writing the answer…';
  if(type==='assistant_progress'||type==='runtime_log') return progressMessageLabel(p.message);
  return '';
}
// One timer for every visible "Thinking…": the seconds are counted here, so
// the gap a model call leaves has a pulse without any event.
let progressThinkingTimer=null;
function renderProgressThinking(span) {
  const since=Number(span.dataset.thinkingSince);
  const seconds=Math.floor((Date.now()-since)/1000);
  span.textContent=seconds>=2?PROGRESS_THINKING+' '+seconds+'s':PROGRESS_THINKING;
}
function tickProgressThinking() {
  const spans=[...document.querySelectorAll('.runtime-thinking span[data-thinking-since]')];
  spans.forEach(renderProgressThinking);
  if(!spans.length&&progressThinkingTimer){ clearInterval(progressThinkingTimer); progressThinkingTimer=null; }
}
function setProgressText(span, text) {
  if(!span||!text) return;
  if(text===PROGRESS_THINKING) {
    if(!span.dataset.thinkingSince) span.dataset.thinkingSince=String(Date.now());
    renderProgressThinking(span);
    if(!progressThinkingTimer) progressThinkingTimer=setInterval(tickProgressThinking,1000);
    return;
  }
  delete span.dataset.thinkingSince;
  span.textContent=text;
}`;
