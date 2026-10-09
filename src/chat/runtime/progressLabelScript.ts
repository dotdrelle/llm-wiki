/**
 * What the `>_` line says while Donna works — the turn's waiting bubble and a
 * run's live line alike.
 *
 * Both used to show the LAST event that carried text, whatever it was: the
 * model meter (`model: run call 2 · 0.3 s · failed`), raw engine traces
 * (`trace: llm:end label=… durationMs=…`) and the agent loop's iteration
 * counter against its safety cap (`[2/80] synthesizing…`) replaced the one
 * line the reader can act on. The line is now an allow-list: a wiki search, a
 * tool and its main arguments, what the wiki search found, "Thinking…" while a
 * model call runs, each with the seconds it has taken (the long silent gap
 * between the search and the answer), "Writing the answer…", and the failures that change the answer.
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
  // The pre-search's own result, worded by the manager (wikiPresearch.js).
  if(/^Wiki search: /.test(msg)) return msg.length>110?msg.slice(0,110)+'…':msg;
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
// Every step shows how long it has lasted (after 2 s): a wiki search, a tool
// call or a model call can each take a while, and a line that does not move
// reads as stuck. One timer for every visible step; the seconds are counted
// here, so a long call has a pulse without any event. A failure is a result,
// not a step in flight: it gets no counter.
let progressStepTimer=null;
function renderProgressStep(span) {
  const label=span.dataset.stepLabel||'';
  const seconds=Math.floor((Date.now()-Number(span.dataset.stepSince))/1000);
  span.textContent=seconds>=2&&!/ failed\\b/.test(label)?label+' '+seconds+'s':label;
}
function tickProgressSteps() {
  const spans=[...document.querySelectorAll('.runtime-thinking span[data-step-since]')].filter(span=>span.isConnected);
  spans.forEach(renderProgressStep);
  if(!spans.length&&progressStepTimer){ clearInterval(progressStepTimer); progressStepTimer=null; }
}
function setProgressText(span, text) {
  if(!span||!text) return;
  // What the wiki search found would be replaced at once by the model call
  // that reads it: it is carried into that "Thinking…" instead.
  const found=text.match(/^Wiki search: (.+)$/);
  if(found) span.dataset.searchFound=found[1];
  else if(text!==PROGRESS_THINKING) delete span.dataset.searchFound;
  const label=text===PROGRESS_THINKING&&span.dataset.searchFound?'Thinking over '+span.dataset.searchFound+'…':text;
  // The same step repeated (two model calls in a row) keeps counting.
  if(span.dataset.stepLabel!==label){ span.dataset.stepLabel=label; span.dataset.stepSince=String(Date.now()); }
  renderProgressStep(span);
  if(!progressStepTimer) progressStepTimer=setInterval(tickProgressSteps,1000);
}`;
