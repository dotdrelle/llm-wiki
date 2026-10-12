/**
 * Tchap bridge card in the Connectors view (agent-connectors' `connectors_tchap_*`).
 *
 * It reads `connectors_tchap_status` (read-only) and words the agent's
 * `phase` — the agent reads the raw fields once, the ShellUI line and this
 * card only map the phase, so they cannot disagree. Hidden when Tchap was
 * never set up, is disabled or the connectors agent is unreachable; a stopped
 * bridge or a failed sign-in stays visible with its error. Its buttons are
 * Donna turns in agent mode, never direct tool calls.
 */
export const TCHAP_CARD_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');
  style.textContent='.tchap-card{max-width:520px;background:var(--card-grad),var(--panel-soft);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;font:12px/1.45 var(--font-sans);color:var(--text)}.tchap-card-head{display:flex;align-items:center;gap:8px}.tchap-card-head strong{font-size:13px}.tchap-state{margin-left:auto;font:700 10px var(--font-sans);border:1px solid var(--border);border-radius:99px;padding:3px 8px;color:var(--muted)}.tchap-state.ok{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}.tchap-state.warn{color:var(--warn)}.tchap-row{display:flex;gap:8px;min-width:0}.tchap-row span:first-child{color:var(--muted);flex:0 0 74px}.tchap-row span:last-child{min-width:0;overflow-wrap:anywhere}.tchap-error{color:var(--warn);overflow-wrap:anywhere}.tchap-actions{display:flex;gap:6px;flex-wrap:wrap}.tchap-actions button{padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:600 11px var(--font-sans);cursor:pointer}.tchap-actions button:hover{border-color:var(--accent);color:var(--accent)}';
  document.head.append(style);
  const PHASE={
    signin_pending:['Sign-in pending','warn'],signin_failed:['Sign-in failed','warn'],signed_out:['Not signed in','warn'],
    no_forum:['No forum',''],awaiting_activation:['Awaiting /activate','warn'],active:['Active','ok'],paused:['Paused','warn'],stopped:['Stopped','warn'],
  };
  const SIGNED_IN=['no_forum','awaiting_activation','active','paused','stopped'];
  function row(label,value){return '<div class="tchap-row"><span>'+esc(label)+'</span><span>'+esc(value)+'</span></div>';}
  function button(label,action){return '<button type="button" onclick="'+action+'()">'+esc(label)+'</button>';}
  window.tchapAttachForum=()=>submitAgentSuggestion('Connect Tchap: list my Tchap forums and attach the one I choose to this workspace.');
  window.tchapDetachForum=()=>submitAgentSuggestion('Detach this workspace from its Tchap forum.');
  window.renderTchapCard=async function(){
    const host=document.getElementById('tchap-section');
    const card=document.getElementById('tchap-card');
    if(!host||!card) return;
    const workspace=window.__WIKI_CONFIG__?.workspaceName;
    let status=null;
    try{
      if(workspace) status=JSON.parse(await callMCPTool('connectors_tchap_status',{workspace},{trackActivity:false}));
    }catch{status=null;}
    const [label,tone]=PHASE[status?.phase]||[];
    // Never set up, disabled, or no connectors agent: no card at all.
    if(!status||status.ok===false||!label){host.hidden=true;return;}
    const signedIn=SIGNED_IN.includes(status.phase);
    let html='<div class="tchap-card-head"><strong>Tchap</strong><span class="tchap-state '+tone+'">'+esc(label)+'</span></div>';
    if(status.account) html+=row('Account',status.account);
    if(status.phase==='signin_pending') html+='<div>Open '+esc(status.pending?.verificationUri||'')+' and confirm the code <strong>'+esc(status.pending?.userCode||'')+'</strong>.</div>';
    if(status.forum) html+=row('Forum',status.forum);
    if(status.forum&&Array.isArray(status.allowedUsers)) html+=row('Allowed',status.allowedUsers.join(', '));
    if(status.phase==='no_forum') html+='<div>No forum for this workspace yet.</div>';
    if(status.phase==='awaiting_activation') html+='<div>Type <code>/activate</code> in the forum to switch the bridge on.</div>';
    if(status.phase==='signed_out'&&status.forum) html+='<div>The bridge is stopped until you sign in again.</div>';
    const error=status.lastError||status.pending?.error;
    if(error) html+='<div class="tchap-error">Last error: '+esc(error)+'</div>';
    const actions=!signedIn?button('Sign in again','tchapAttachForum')
      :status.forum?button('Change forum','tchapAttachForum')+button('Detach forum','tchapDetachForum')
        :button('Attach a forum','tchapAttachForum');
    card.innerHTML=html+'<div class="tchap-actions">'+actions+'</div>';
    host.hidden=false;
  };
})();
`;
