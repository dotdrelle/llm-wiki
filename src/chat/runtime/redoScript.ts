export const REDO_SCRIPT = `/* ── Redo ───────────────────────────────────────────────────────────── */
// Re-ask one question after discarding everything it produced. Offered on user
// messages only: the action is about the message it sits on.
//
// The runtime derives its conversation from an event log rather than storing
// it, so removing the answers in the DOM alone would be undone by the next
// /state merge. The server-side truncation has to succeed first; only then is
// the local view rewound and the question resubmitted.
async function redoMessage(btn) {
  const msg=btn.closest('.msg');
  const text=msg?.dataset.copy||'';
  if(!text.trim()||isStreaming) return;
  const refIndex=runtimeConversationRefs.findIndex(ref=>ref.el===msg);
  if(refIndex>=0) {
    const res=await fetch('/api/runtime/conversation/truncate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:runtimeConversationOffset+refIndex})});
    const payload=await res.json().catch(()=>({}));
    if(payload?.truncated!==true) {
      notify(payload?.reason==='run_active'?'Cancel the running task before redoing':'Redo failed','e');
      return;
    }
    // Drop the refs from this message on, so the next poll appends the new
    // exchange instead of overwriting stale positions.
    const firstMessage=runtimeConversationRefs[refIndex]?.message;
    const messageIndex=firstMessage?messages.indexOf(firstMessage):-1;
    if(messageIndex>=0) messages.length=messageIndex;
    runtimeConversationRefs.length=refIndex;
  }
  // Remove the question and everything below it: resubmitting re-appends the
  // question, and keeping it would show it twice.
  let node=msg;
  while(node) { const next=node.nextElementSibling; node.remove(); node=next; }
  const input=$('chat-input');
  input.value=text;
  await sendMessage();
}
`;
