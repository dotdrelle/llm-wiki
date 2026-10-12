/**
 * Tchap bridge card in the Connectors view (agent-connectors' `connectors_tchap_*`).
 *
 * Shown once Tchap has been set up: signed in, a sign-in pending, or a
 * bridge that STOPPED (session ended, forum kept) — a failure is shown, never
 * hidden. Never set up, disabled, or no connectors agent: no card at all. It reads `connectors_tchap_status` (a
 * read-only tool) and displays the account, this workspace's forum and its
 * bridge state. Its two buttons are Donna turns in agent mode, never direct
 * tool calls: attaching or detaching a forum is an action, and Donna owns it.
 */
export const TCHAP_CARD_SCRIPT = String.raw`
(()=>{
  const style=document.createElement('style');
  style.textContent='.tchap-card{max-width:520px;background:var(--card-grad),var(--panel-soft);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;font:12px/1.45 var(--font-sans);color:var(--text)}.tchap-card-head{display:flex;align-items:center;gap:8px}.tchap-card-head strong{font-size:13px}.tchap-state{margin-left:auto;font:700 10px var(--font-sans);border:1px solid var(--border);border-radius:99px;padding:3px 8px;color:var(--muted)}.tchap-state.ok{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}.tchap-state.warn{color:var(--warn)}.tchap-row{display:flex;gap:8px;min-width:0}.tchap-row span:first-child{color:var(--muted);flex:0 0 74px}.tchap-row span:last-child{min-width:0;overflow-wrap:anywhere}.tchap-error{color:var(--warn);overflow-wrap:anywhere}.tchap-actions{display:flex;gap:6px;flex-wrap:wrap}.tchap-actions button{padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--text);font:600 11px var(--font-sans);cursor:pointer}.tchap-actions button:hover{border-color:var(--accent);color:var(--accent)}';
  document.head.append(style);
  let section=null;
  function ensureSection(){
    if(section) return section;
    const view=document.getElementById('connectors-view');
    if(!view) return null;
    section=document.createElement('section');
    section.className='connectors-section';section.id='tchap-section';section.hidden=true;
    section.innerHTML='<div class="connectors-section-head"><div class="connectors-section-title"><h2>Tchap</h2><p>Talk to Donna from a Tchap forum on your phone. The Tchap sign-in serves every workspace; each workspace has its own forum.</p></div></div><div class="tchap-card" id="tchap-card"></div>';
    const skills=[...view.querySelectorAll('.connectors-section')].find((node)=>node.querySelector('#skills-manager-list'));
    view.insertBefore(section,skills||null);
    return section;
  }
  const STATE_LABEL={awaiting_activation:['Awaiting /activate','warn'],active:['Active','ok'],paused:['Paused','warn']};
  function row(label,value){return '<div class="tchap-row"><span>'+esc(label)+'</span><span>'+esc(value)+'</span></div>';}
  function askDonna(text){
    if(!agentMode){agentMode=true;updateAgentModeUI();}
    if(typeof showChatView==='function') showChatView();
    submitSuggestion(text);
  }
  window.tchapAttachForum=()=>askDonna('Connect Tchap: list my Tchap forums and attach the one I choose to this workspace.');
  window.tchapDetachForum=()=>askDonna('Detach this workspace from its Tchap forum.');
  window.renderTchapCard=async function(){
    const host=ensureSection();
    if(!host) return;
    const workspace=window.__WIKI_CONFIG__?.workspaceName;
    let status=null;
    try{
      if(workspace) status=JSON.parse(await callMCPTool('connectors_tchap_status',{workspace},{trackActivity:false}));
    }catch{status=null;}
    // Never set up, disabled, or no connectors agent: no card at all. A
    // session that ended keeps its forum and its error — that one is shown.
    const setUp=status&&status.ok!==false&&(status.connected||status.pending||status.lastError||status.forum);
    if(!setUp){host.hidden=true;return;}
    if(!status.connected){
      let body='<div class="tchap-card-head"><strong>Tchap</strong><span class="tchap-state warn">'+esc(status.pending&&!status.pending.error?'Sign-in pending':'Not signed in')+'</span></div>';
      if(status.pending&&status.pending.userCode) body+='<div>Open '+esc(status.pending.verificationUri||'')+' and confirm the code <strong>'+esc(status.pending.userCode)+'</strong>.</div>';
      if(status.forum) body+=row('Forum',status.forum)+'<div>The bridge is stopped until you sign in again.</div>';
      const error=status.lastError||(status.pending&&status.pending.error);
      if(error) body+='<div class="tchap-error">Last error: '+esc(error)+'</div>';
      body+='<div class="tchap-actions"><button type="button" onclick="tchapAttachForum()">Sign in again</button></div>';
      document.getElementById('tchap-card').innerHTML=body;
      host.hidden=false;
      return;
    }
    const [label,tone]=status.forum?(STATE_LABEL[status.bridge]||[String(status.bridge||'Unknown'),'']):['No forum',''];
    const running=status.forum&&!status.running?' (stopped)':'';
    let html='<div class="tchap-card-head"><strong>Tchap</strong><span class="tchap-state '+tone+'">'+esc(label+running)+'</span></div>';
    html+=row('Account',status.account||'');
    if(status.forum){
      html+=row('Forum',status.forum);
      if(Array.isArray(status.allowedUsers)) html+=row('Allowed',status.allowedUsers.join(', '));
      if(status.bridge==='awaiting_activation') html+='<div>Type <code>/activate</code> in the forum to switch the bridge on.</div>';
    }else{
      html+='<div>No forum for this workspace yet.</div>';
    }
    if(status.lastError) html+='<div class="tchap-error">Last error: '+esc(status.lastError)+'</div>';
    html+='<div class="tchap-actions">'+(status.forum
      ?'<button type="button" onclick="tchapAttachForum()">Change forum</button><button type="button" onclick="tchapDetachForum()">Detach forum</button>'
      :'<button type="button" onclick="tchapAttachForum()">Attach a forum</button>')+'</div>';
    document.getElementById('tchap-card').innerHTML=html;
    host.hidden=false;
  };
})();
`;
