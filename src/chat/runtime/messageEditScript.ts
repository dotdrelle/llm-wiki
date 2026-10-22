export const MESSAGE_EDIT_SCRIPT = `/* ── Delete an answer, /clear, cleared logs ─────────────────────────── */
// Delete ONE of Donna's answers. The runtime derives the conversation from its
// event log, so the entry is removed there first — otherwise the next /state
// merge would put it back, and Donna would still be told it on later turns.
// A workspace-level entry (no thread) is only hidden from this view.
function runtimeAnswerTarget(msg,text) {
  const refIndex=runtimeConversationRefs.findIndex(ref=>ref.el===msg);
  if(refIndex>=0) {
    const ref=runtimeConversationRefs[refIndex];
    if(ref.conversationId!==currentConversationId) return {ref,refIndex,index:null};
    const before=runtimeConversationRefs.slice(0,refIndex).filter(r=>r.conversationId===currentConversationId).length;
    return {ref,refIndex,index:(runtimeConversationStrictOffset??0)+before,content:ref.message.content,turnId:ref.turnId??ref.message.turnId??null};
  }
  // A reopened conversation: its answers precede the merge baseline. Match by
  // text, and by rank among identical answers when there are several.
  const thread=currentRuntimeConversation(true)||[];
  const candidates=thread.map((entry,i)=>entry?.role==='assistant'&&String(entry.content??'')===text?i:-1).filter(i=>i>=0);
  const same=[...document.querySelectorAll('#messages .msg.assistant')].filter(el=>(el.dataset.copy||'')===text);
  const rank=same.indexOf(msg);
  const index=candidates.length===1?candidates[0]:candidates.length===same.length&&rank>=0?candidates[rank]:null;
  return {ref:null,refIndex:-1,index,content:text,turnId:index!==null?thread[index]?.turnId??null:null,beforeBaseline:index!==null};
}
function localMessageFor(msg,text) {
  const same=[...document.querySelectorAll('#messages .msg.assistant')].filter(el=>(el.dataset.copy||'')===text);
  const local=messages.filter(m=>m.role==='assistant'&&String(m.content??'')===text);
  return local[Math.min(same.indexOf(msg),local.length-1)]??null;
}
async function deleteAnswer(btn) {
  const msg=btn.closest('.msg');
  if(!msg) return;
  if(isStreaming&&!msg.nextElementSibling) { notify('Wait for this answer to finish before deleting it','e'); return; }
  const text=msg.dataset.copy||'';
  const target=runtimeEnabled()?runtimeAnswerTarget(msg,text):{ref:null,refIndex:-1,index:null};
  if(target.index!==null) {
    try {
      const res=await fetch('/api/runtime/conversation/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:target.index,conversationId:currentConversationId,content:target.content,...(target.turnId?{turnId:target.turnId}:{})})});
      const data=await res.json().catch(()=>({}));
      if(data?.removed!==true) {
        notify(data?.reason==='run_active'?'Wait for this answer to finish before deleting it':'This answer could not be deleted','e');
        return;
      }
    } catch(err) { notify(err?.message||String(err),'e'); return; }
    // Keep the local runtime copy aligned until the next state arrives: a merge
    // against the stale array would rewrite the following bubbles.
    const all=Array.isArray(runtimeState?.conversation)?runtimeState.conversation:[];
    let seen=-1;
    const at=target.turnId
      ?all.findIndex(entry=>entry?.turnId===target.turnId&&String(entry?.content??'')===String(target.content??''))
      :all.findIndex(entry=>entry?.conversationId===currentConversationId&&++seen===target.index);
    if(at>=0) all.splice(at,1);
    if(target.ref) runtimeConversationRefs.splice(target.refIndex,1);
    else if(target.beforeBaseline&&runtimeConversationOffset!==null) {
      runtimeConversationOffset=Math.max(0,runtimeConversationOffset-1);
      if(runtimeConversationStrictOffset!==null) runtimeConversationStrictOffset=Math.max(0,runtimeConversationStrictOffset-1);
    }
  } else if(target.ref) {
    // Not this thread's: keep the slot so later entries stay aligned.
    target.ref.el=null;
  }
  const message=target.ref?.message??localMessageFor(msg,text);
  const at=message?messages.indexOf(message):-1;
  if(at>=0) messages.splice(at,1);
  msg.remove();
  if(!messages.length) { await clearChat(); return; }
  updateMemoryGauge();
  conversationDirty=true;
  await saveCurrentConversation({immediate:true,force:true});
}

// /clear empties this conversation, like the ShellUI's. /clear --all also
// resets the workspace runtime (the confirmed Reset plan) and the Activity
// panel. Both are interface commands: they never reach Donna, who could only
// talk about them.
// "—all"/"–all" count as --all: macOS turns a typed "--" into a dash. Any
// other variant is refused here rather than guessed at — a typo must neither
// wipe the conversation nor reach Donna, who could only talk about it.
async function handleClearCommand(text) {
  const parsed=/^\\/clear(?:\\s+(?:--?|[\u2013\u2014])(all))?\\s*$/i.exec(String(text).trim());
  if(!parsed) { notify('Unknown command. Use /clear, or /clear --all to also reset the workspace runtime.','e'); return false; }
  if(!parsed[1]) { await clearChat(); return true; }
  const confirmed=await confirmAction({title:'Clear everything',message:'Clear this conversation and the Activity panel, and reset the workspace runtime: active work stops and the plan, activities, logs and queue are purged.',confirmLabel:'Clear all',danger:true});
  if(!confirmed) return false;
  if(runtimeEnabled()) {
    try {
      const res=await fetch('/api/runtime/reset',{method:'POST'});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||'Runtime reset failed');
      await fetchRuntimeState();
    } catch(err) { notify(err?.message||String(err),'e'); }
  }
  activityClearedFingerprints.plan=null;
  runtimeLogsClearedMark=null;
  clearActivityTab('local',{render:false});
  await clearChat();
  renderActivities(); updateActivityBadge();
  notify('Conversation and workspace runtime cleared');
  return true;
}

// Clearing the logs is a boundary, not a snapshot: the lines present at that
// moment stay hidden in the Logs tab AND the run graph's journal, while every
// later line shows. Hiding the snapshot until it changed brought the whole
// log back with the next line, and the journal never honoured it at all.
let runtimeLogsClearedMark=null;
function markRuntimeLogsCleared() {
  const logs=Array.isArray(runtimeState?.logs)?runtimeState.logs:[];
  runtimeLogsClearedMark=logs.length?String(logs[logs.length-1]):null;
  agentProgressLog=[];
  clientDiagnostics=[];
}
function visibleRuntimeLogs(logs) {
  const list=Array.isArray(logs)?logs:[];
  if(runtimeLogsClearedMark===null) return list;
  const at=list.map(String).lastIndexOf(runtimeLogsClearedMark);
  return at>=0?list.slice(at+1):list;
}
`;
