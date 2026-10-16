/** Workspace-scoped status for integrations exposed by agent-connectors. */
export const AGENT_CONNECTORS_CARD_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');
  style.textContent='.agent-connector-grid{display:flex;flex-wrap:wrap;gap:10px}.agent-connector-slot{flex:1 1 240px;min-width:0}.agent-connector-card{height:100%;box-sizing:border-box;background:var(--card-grad),var(--panel-soft);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;font:12px/1.45 var(--font-sans);color:var(--text)}.agent-connector-head{display:flex;align-items:center;gap:8px}.agent-connector-head strong{font-size:13px}.agent-connector-state{margin-left:auto;font:700 10px var(--font-sans);border:1px solid var(--border);border-radius:99px;padding:3px 8px;color:var(--muted);white-space:nowrap}.agent-connector-state.ok{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}.agent-connector-state.warn{color:var(--warn)}.agent-connector-state.error{color:var(--err)}.agent-connector-row{display:flex;gap:8px;min-width:0}.agent-connector-row span:first-child{color:var(--muted);flex:0 0 74px}.agent-connector-row span:last-child{min-width:0;overflow-wrap:anywhere}.agent-connector-error{color:var(--warn);overflow-wrap:anywhere}.agent-connector-actions{display:flex;gap:6px;flex-wrap:wrap}.agent-connector-actions button{padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:600 11px var(--font-sans);cursor:pointer}.agent-connector-actions button:hover{border-color:var(--accent);color:var(--accent)}';
  document.head.append(style);
  let renderSequence=0;
  const PHASE={
    not_set_up:['Not connected','warn'],disabled:['Disabled','warn'],signin_pending:['Sign-in pending','warn'],signin_failed:['Sign-in failed','warn'],signed_out:['Not signed in','warn'],
    no_forum:['No forum for this workspace','warn'],awaiting_activation:['Awaiting activation','warn'],active:['Connected','ok'],paused:['Paused','warn'],stopped:['Stopped','warn'],
  };
  const SIGNED_IN=['no_forum','awaiting_activation','active','paused','stopped'];
  let tchapForumForAuth='';
  function row(label,value){return '<div class="agent-connector-row"><span>'+esc(label)+'</span><span>'+esc(value)+'</span></div>';}
  function card(name,label,tone,body,actions=''){
    return '<article class="agent-connector-card"><div class="agent-connector-head"><strong>'+esc(name)+'</strong><span class="agent-connector-state '+tone+'">'+esc(label)+'</span></div>'+body+(actions?'<div class="agent-connector-actions">'+actions+'</div>':'')+'</article>';
  }
  function action(label,connector,grants=''){
    return '<button type="button" onclick="startConnectorAuthorization(\''+connector+'\',\''+grants+'\')">'+esc(label)+'</button>';
  }
  function readStatus(tool,workspace){
    const request=()=>callMCPTool(tool,{workspace},{trackActivity:false,timeoutMs:12000}).then(JSON.parse);
    return request().then(async result=>{
      const phase=String(result?.phase||'');
      if(tool==='connectors_tchap_status'&&!result?.error&&!PHASE[phase]) return request();
      return result;
    });
  }
  function statusSlot(id,content){return '<div class="agent-connector-slot" id="'+id+'">'+content+'</div>';}
  function googleCard(result){
    if(!result||result.error) return card('Gmail','Unavailable','error','<div class="agent-connector-error">'+esc(result?.error||'The connectors agent did not return a status.')+'</div>');
    if(result.status==='configured'){
      const grants=Array.isArray(result.grants)?result.grants:[];
      const missing=Array.isArray(result.missingGrants)?result.missingGrants:['read','send','modify'].filter(grant=>!grants.includes(grant));
      const requestable=missing.filter(grant=>['read','send','modify'].includes(grant)&&!(result.sendEnabled===false&&grant==='send'));
      return card('Gmail','Connected','ok',
        (grants.length?row('Access',grants.join(', ')):'<div>Authorized for this workspace.</div>')+
        (result.sendEnabled===false?'<div>Sending is disabled in this deployment.</div>':''),
        requestable.length?action('Add missing access','google',requestable.join(' ')):'');
    }
    if(result.status==='not_configured'&&result.ok===true)
      return card('Gmail','Not connected','warn','<div>No Gmail authorization is stored for this workspace.</div>',action('Authorize Gmail','google'));
    if(result.status==='not_configured')
      return card('Gmail','Not configured','warn','<div>Gmail authorization is not configured in this connectors deployment.</div>');
    const reason=result.reason||result.error||'The connectors agent could not read the Gmail authorization.';
    const repair=['google_reauthorization_required','google_refresh_token_missing'].includes(result.reason)
      ?action('Renew authorization','google'):'';
    return card('Gmail','Unavailable','error','<div class="agent-connector-error">'+esc(reason)+'</div>',repair);
  }
  function tchapCard(result){
    const retry='<button type="button" onclick="renderAgentConnectorCards()">Retry</button>';
    if(!result||result.error) return card('Tchap','Unavailable','error','<div class="agent-connector-error">'+esc(result?.error||'The connectors agent did not return a status.')+'</div>',retry);
    const phase=String(result.phase||'');
    const state=PHASE[phase];
    if(result.ok===false||!state) return card('Tchap','Unavailable','error','<div class="agent-connector-error">'+esc(result.error||(phase?'Unknown Tchap status phase: '+phase+'.':'The Tchap status response did not include a phase.'))+'</div>',retry);
    const needsReauthorization=['signed_out','stopped'].includes(phase)&&result.lastError==='tchap_reauthorization_required';
    tchapForumForAuth=['signed_out','signin_failed'].includes(phase)||needsReauthorization?String(result.roomId||result.forum||''):'';
    const [label,tone]=state;
    const signedIn=SIGNED_IN.includes(phase);
    let body='';
    if(result.account) body+=row('Account',result.account);
    if(phase==='signin_pending') body+='<div>Open '+esc(result.pending?.verificationUri||'')+' and confirm the code <strong>'+esc(result.pending?.userCode||'')+'</strong>.</div>';
    if(result.forum) body+=row('Forum',result.forum);
    if(result.forum&&Array.isArray(result.allowedUsers)) body+=row('Allowed',result.allowedUsers.join(', '));
    if(phase==='not_set_up') body+='<div>Tchap has not been set up yet.</div>';
    if(phase==='disabled') body+='<div>Tchap is disabled in this deployment.</div>';
    if(phase==='no_forum') body+='<div>No forum is attached to this workspace.</div>';
    if(phase==='awaiting_activation') body+='<div>Type <code>/activate</code> in the forum to switch the bridge on.</div>';
    if(phase==='signed_out'&&result.forum) body+='<div>The bridge is stopped until you sign in again.</div>';
    if(needsReauthorization) body+='<div>The Tchap session ended. Sign in again to restart this bridge.</div>';
    const error=result.lastError||result.pending?.error;
    if(error) body+='<div class="agent-connector-error">Last error: '+esc(error)+'</div>';
    const actions=phase==='disabled'||phase==='signin_pending'?'':needsReauthorization?'<button type="button" onclick="tchapAttachForum()">Reconnect Tchap</button>':!signedIn?'<button type="button" onclick="tchapAttachForum()">Connect Tchap</button>'
      :result.forum?'<button type="button" onclick="tchapAttachForum()">Change forum</button><button type="button" onclick="tchapDetachForum()">Detach forum</button>'
        :'<button type="button" onclick="tchapAttachForum()">Attach a forum</button>';
    return card('Tchap',label,tone,body,actions);
  }
  window.startConnectorAuthorization=(connector,grants='')=>submitSuggestion('/connector auth '+connector+(grants?' '+grants:''));
  window.tchapAttachForum=()=>window.startConnectorAuthorization('tchap',tchapForumForAuth);
  window.tchapDetachForum=()=>submitAgentSuggestion('Detach this workspace from its Tchap forum.');
  window.renderAgentConnectorCards=async function(){
    const host=document.getElementById('agent-connector-cards');
    if(!host) return;
    const sequence=++renderSequence;
    const workspace=window.__WIKI_CONFIG__?.workspaceName;
    if(!workspace){
      host.innerHTML=card('Gmail','No workspace','warn','<div>Select a workspace to check its connection.</div>')+card('Tchap','No workspace','warn','<div>Select a workspace to check its connection.</div>');
      return;
    }
    const googleId='agent-connector-google-status',tchapId='agent-connector-tchap-status';
    host.innerHTML=statusSlot(googleId,card('Gmail','Checking…','','<div>Reading workspace authorization.</div>'))+
      statusSlot(tchapId,card('Tchap','Checking…','','<div>Reading workspace bridge status.</div>'));
    const update=async(id,tool,render,name)=>{
      try{
        const result=await readStatus(tool,workspace);
        if(sequence!==renderSequence)return;
        const slot=document.getElementById(id);
        if(slot)slot.innerHTML=render(result);
      }catch(error){
        if(sequence!==renderSequence)return;
        const slot=document.getElementById(id);
        if(slot)slot.innerHTML=card(name,'Unavailable','error',
          '<div class="agent-connector-error">'+esc(error?.message||String(error||'Status request failed.'))+'</div>',
          '<button type="button" onclick="renderAgentConnectorCards()">Retry</button>');
      }
    };
    await Promise.all([
      update(googleId,'connectors_google_status',googleCard,'Gmail'),
      update(tchapId,'connectors_tchap_status',tchapCard,'Tchap'),
    ]);
  };
})();
`;
