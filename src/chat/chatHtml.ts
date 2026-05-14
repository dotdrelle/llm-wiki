import { WIKI_CSS_VARS, WIKI_FONT_STACK, WIKI_MONO_STACK } from './theme.ts';

const CHAT_COMPONENT_CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans);background:var(--bg);color:var(--text);height:100vh;display:flex;overflow:hidden}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

/* SIDEBAR */
#sidebar{width:300px;min-width:300px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;transition:width .3s,min-width .3s}
#sidebar.collapsed{width:0;min-width:0}
.sb-logo{padding:18px 16px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px}
.sb-logo-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:800;flex-shrink:0}
.sb-logo-text{font-size:16px;font-weight:800;letter-spacing:-.3px}
.sb-logo-sub{font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:1px}
.sb-scroll{flex:1;overflow-y:auto;padding-bottom:12px}
.sec-label{font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);padding:16px 16px 8px;display:flex;align-items:center;justify-content:space-between}
.sec-label button{background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted2);font-size:11px;padding:2px 8px;cursor:pointer;font-family:var(--font-sans);font-weight:600;transition:border-color .2s,color .2s}
.sec-label button:hover{border-color:var(--accent);color:var(--accent)}
.api-block{padding:0 12px 4px;display:flex;flex-direction:column;gap:7px}
.field label{display:block;font-size:10px;color:var(--muted);margin-bottom:4px;font-weight:600;letter-spacing:.5px}
input,select{width:100%;background:var(--panel-soft);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--font-mono);font-size:12px;padding:7px 10px;outline:none;transition:border-color .2s}
input:focus,select:focus{border-color:var(--accent)}
input[type=password]{letter-spacing:3px}
.secret-wrap{position:relative;display:flex;align-items:center}
.secret-wrap input{padding-right:56px}
.secret-actions{position:absolute;right:6px;display:flex;gap:4px}
.secret-btn{background:none;border:none;color:var(--muted);cursor:pointer;padding:4px 5px;border-radius:5px;line-height:0;transition:color .2s;display:flex;align-items:center}
.secret-btn:hover{color:var(--text)}
.secret-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.key-saved{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--ok);font-family:var(--font-mono);opacity:0;transition:opacity .3s}
.key-saved.show{opacity:1}
.key-saved::before{content:'●';font-size:7px}
.row2{display:flex;gap:6px}
.row2 .field{flex:1}

/* MCP CARDS */
.mcp-cards{padding:0 12px;display:flex;flex-direction:column;gap:8px}
.mcp-card{background:var(--panel-soft);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .2s}
.mcp-card.active{border-color:rgba(79,126,255,.35)}
.mcp-card.error{border-color:rgba(240,107,107,.3)}
.mcp-card-head{display:flex;align-items:center;gap:8px;padding:9px 10px}
.mcp-toggle{position:relative;width:32px;height:18px;flex-shrink:0;cursor:pointer}
.mcp-toggle input{opacity:0;width:0;height:0;position:absolute}
.mcp-toggle-track{position:absolute;inset:0;background:var(--panel-deep);border:1px solid var(--border);border-radius:99px;transition:background .2s,border-color .2s}
.mcp-toggle input:checked ~ .mcp-toggle-track{background:rgba(79,126,255,.3);border-color:var(--accent)}
.mcp-toggle-thumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--muted);transition:transform .2s,background .2s}
.mcp-toggle input:checked ~ .mcp-toggle-track .mcp-toggle-thumb{transform:translateX(14px);background:var(--accent)}
.mcp-name-input{flex:1;font-size:11px;padding:4px 7px;background:transparent;border:1px solid transparent;border-radius:6px;font-family:var(--font-sans);font-weight:700;transition:border-color .2s;color:var(--text)}
.mcp-name-input:focus{border-color:var(--border)}
.mcp-badge{font-size:9px;font-family:var(--font-mono);font-weight:500;padding:2px 7px;border-radius:99px;flex-shrink:0}
.mcp-badge.ok{background:rgba(45,212,160,.12);color:var(--ok)}
.mcp-badge.err{background:rgba(240,107,107,.12);color:var(--err)}
.mcp-badge.loading{background:rgba(245,200,66,.1);color:var(--warn)}
.mcp-badge.off{background:var(--panel-deep);color:var(--muted)}
.mcp-url-row{display:flex;align-items:center;gap:6px;padding:0 10px 6px}
.mcp-bearer-row{display:flex;align-items:center;gap:6px;padding:0 10px 9px}
.mcp-url-row input{font-size:11px;padding:5px 8px}
.btn-icon{background:none;border:1px solid var(--border);border-radius:7px;color:var(--muted);cursor:pointer;padding:4px 8px;font-size:12px;flex-shrink:0;transition:all .2s;font-family:var(--font-mono)}
.btn-icon:hover{border-color:var(--accent);color:var(--accent)}
.btn-del:hover{border-color:var(--err) !important;color:var(--err) !important}
.mcp-tools{border-top:1px solid var(--border)}
.mcp-tools-head{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;user-select:none;font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;transition:color .2s}
.mcp-tools-head:hover{color:var(--text)}
.mcp-tools-chevron{font-size:10px;transition:transform .2s;display:inline-block}
.mcp-tools-body{padding:0 10px 8px;display:flex;flex-direction:column;gap:5px}
.mcp-tools-body.collapsed{display:none}
.tool-row{display:flex;align-items:flex-start;gap:7px;padding:5px 8px;background:var(--panel-deep);border-radius:7px;font-size:11px;font-family:var(--font-mono)}
.tool-dot{width:5px;height:5px;border-radius:50%;background:var(--ok);margin-top:4px;flex-shrink:0}
.tool-name-t{color:var(--text);font-weight:500}
.tool-desc-t{color:var(--muted);font-size:10px;margin-top:1px}

/* MAIN */
#main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
#topbar{padding:12px 18px;border-bottom:1px solid var(--border);background:var(--panel);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tb-toggle{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:5px;border-radius:7px;line-height:1;transition:all .2s}
.tb-toggle:hover{color:var(--text);background:var(--panel-soft)}
.tb-model{font-family:var(--font-mono);font-size:11px;color:var(--muted2);background:var(--panel-soft);border:1px solid var(--border);padding:4px 10px;border-radius:99px}
.tb-mcps{display:flex;gap:5px;flex-wrap:wrap}
.tb-mcp-pill{font-size:10px;font-family:var(--font-mono);font-weight:500;padding:3px 8px;border-radius:99px;background:rgba(79,126,255,.12);border:1px solid rgba(79,126,255,.25);color:var(--accent)}
.tb-clear{margin-left:auto;background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);padding:5px 12px;cursor:pointer;font-size:12px;font-family:var(--font-sans);font-weight:600;transition:all .2s}
.tb-clear:hover{border-color:var(--err);color:var(--err)}

/* MESSAGES */
#messages{flex:1;overflow-y:auto;padding:24px 20px;display:flex;flex-direction:column;gap:18px}
.msg{display:flex;gap:12px;animation:fadeUp .25s ease}
.msg.user{flex-direction:row-reverse}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.av{width:32px;height:32px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.av.u{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff}
.av.a{background:var(--panel-soft);border:1px solid var(--border);color:var(--accent)}
.bubble{max-width:66%;padding:11px 14px;font-size:14px;line-height:1.7;border-radius:13px;white-space:pre-wrap;word-break:break-word}
.msg.user .bubble{background:linear-gradient(135deg,rgba(79,126,255,.2),rgba(157,125,245,.15));border:1px solid rgba(79,126,255,.28);border-bottom-right-radius:3px}
.msg.assistant .bubble{background:var(--panel-soft);border:1px solid var(--border);border-bottom-left-radius:3px;white-space:normal}
.bubble p{margin:0 0 .6em}.bubble p:last-child{margin:0}
.bubble h1,.bubble h2,.bubble h3,.bubble h4{font-weight:700;margin:.8em 0 .3em;line-height:1.3}
.bubble h1{font-size:1.15em}.bubble h2{font-size:1.05em}.bubble h3,.bubble h4{font-size:.95em}
.bubble ul,.bubble ol{padding-left:1.4em;margin:.3em 0 .6em}.bubble li{margin:.2em 0}
.bubble code{font-family:var(--font-mono);font-size:.88em;background:var(--panel-deep);padding:1px 5px;border-radius:4px}
.bubble pre{background:var(--panel-deep);border-radius:8px;padding:10px 12px;margin:.5em 0;overflow-x:auto}
.bubble pre code{background:none;padding:0;font-size:.85em}
.bubble blockquote{border-left:3px solid var(--border);margin:.4em 0;padding:.2em .8em;color:var(--muted)}
.bubble table{border-collapse:collapse;margin:.5em 0;font-size:.9em}
.bubble th,.bubble td{border:1px solid var(--border);padding:4px 9px}
.bubble th{background:var(--panel-deep);font-weight:600}
.bubble a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.stream-cursor::after{content:'▋';animation:blink .8s step-end infinite;color:var(--accent);margin-left:1px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.tc-block{margin-top:10px;background:#090d18;border:1px solid #1a2a45;border-radius:9px;overflow:hidden;font-family:var(--font-mono);font-size:12px}
.tc-head{display:flex;align-items:center;gap:7px;padding:7px 11px;background:rgba(15,30,60,.6);border-bottom:1px solid #1a2a45;cursor:pointer;user-select:none}
.tc-src{font-size:9px;color:var(--muted);font-style:italic}
.tc-fn{color:#7ba7ff;font-weight:500;font-size:11px}
.tc-st{margin-left:auto;font-size:10px}
.tc-st.run{color:var(--warn);animation:pulse 1s infinite}
.tc-st.ok{color:var(--ok)}
.tc-st.er{color:var(--err)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.tc-body{padding:9px 11px}
.tc-lbl{font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.tc-body pre{color:#8ab4f8;white-space:pre-wrap;word-break:break-all;font-size:11px}
.tc-body.hidden{display:none}
.typing{display:flex;align-items:center;gap:4px;padding:3px 0}
.typing span{width:5px;height:5px;border-radius:50%;background:var(--muted);animation:boing .8s infinite}
.typing span:nth-child(2){animation-delay:.15s}
.typing span:nth-child(3){animation-delay:.3s}
@keyframes boing{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
#empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted)}
#empty .em-icon{font-size:36px;opacity:.6}
#empty h2{font-size:17px;font-weight:800;color:var(--muted2)}
#empty p{font-size:12px;text-align:center;max-width:260px;line-height:1.7;color:var(--muted)}

/* INPUT */
#input-wrap{padding:14px 18px;border-top:1px solid var(--border);background:var(--panel)}
.input-box{display:flex;align-items:flex-end;gap:9px;background:var(--panel-soft);border:1px solid var(--border);border-radius:13px;padding:9px 11px;transition:border-color .2s}
.input-box:focus-within{border-color:var(--accent)}
#chat-input{flex:1;background:none;border:none;color:var(--text);font-family:var(--font-sans);font-size:14px;resize:none;max-height:130px;overflow-y:auto;line-height:1.55;outline:none}
#chat-input::placeholder{color:var(--muted)}
#send-btn{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:9px;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s,transform .2s}
#send-btn:hover{opacity:.85;transform:scale(1.06)}
#send-btn:disabled{opacity:.35;cursor:not-allowed;transform:none}
#send-btn svg{width:15px;height:15px;fill:#fff}
.input-hint{font-size:10px;color:var(--muted);text-align:center;margin-top:6px}
#notif{position:fixed;bottom:18px;right:18px;padding:10px 16px;border-radius:9px;font-size:12px;font-weight:600;opacity:0;transform:translateY(6px);transition:all .25s;pointer-events:none;z-index:999}
#notif.show{opacity:1;transform:translateY(0)}
#notif.s{background:rgba(45,212,160,.12);border:1px solid var(--ok);color:var(--ok)}
#notif.e{background:rgba(240,107,107,.12);border:1px solid var(--err);color:var(--err)}
hr.divider{border:none;border-top:1px solid var(--border);margin:8px 12px}`;

const CHAT_BODY = `<aside id="sidebar">
  <div class="sb-logo">
    <div class="sb-logo-mark">M</div>
    <div>
      <div class="sb-logo-text">MCP Chat</div>
      <div class="sb-logo-sub">multi-server</div>
    </div>
  </div>
  <div class="sb-scroll">
    <div class="sec-label">Configuration LLM</div>
    <div class="api-block">
      <div class="field">
        <label>Base URL</label>
        <input id="base-url" type="text" placeholder="http://localhost:11434/v1" onchange="saveConfig()">
      </div>
      <div class="field">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <label style="margin:0">Clé API</label>
          <span class="key-saved" id="llm-saved">enregistrée</span>
        </div>
        <div class="secret-wrap">
          <input id="api-key" type="password" placeholder="sk-… (vide pour Ollama)" autocomplete="off" onchange="saveConfig()">
          <div class="secret-actions">
            <button class="secret-btn" id="reveal-btn-apikey" onclick="toggleReveal('api-key',this)" title="Afficher/masquer">
              <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label>Modèle</label>
          <input id="model-name" type="text" placeholder="gpt-4o" oninput="syncModel()" onchange="saveConfig()">
        </div>
        <div class="field">
          <label>Temp.</label>
          <input id="temperature" type="number" value="0.7" min="0" max="2" step="0.1" onchange="saveConfig()">
        </div>
      </div>
    </div>
    <hr class="divider">
    <div class="sec-label">
      Serveurs MCP
      <button onclick="addServer()">+ Ajouter</button>
    </div>
    <div class="mcp-cards" id="mcp-cards"></div>
  </div>
</aside>

<div id="main">
  <div id="topbar">
    <a class="tb-back" href="/">← Wiki</a><button class="tb-toggle" onclick="toggleSidebar()">☰</button>
    <span class="tb-model" id="model-badge">gpt-4o</span>
    <div class="tb-mcps" id="tb-mcps"></div>
    <button class="tb-clear" onclick="clearChat()">Effacer</button>
  </div>
  <div id="messages">
    <div id="empty">
      <div class="em-icon">⬡</div>
      <h2>MCP Chat</h2>
      <p>Activez un serveur MCP, puis démarrez la conversation.</p>
    </div>
  </div>
  <div id="input-wrap">
    <div class="input-box">
      <textarea id="chat-input" rows="1" placeholder="Votre message…"
        oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
      <button id="send-btn" onclick="sendMessage()">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
    <div class="input-hint">Entrée pour envoyer · Shift+Entrée pour saut de ligne</div>
  </div>
</div>

<div id="notif"></div>

<script>
let servers = [];
let messages = [];
let isStreaming = false;
let sidebarOpen = true;
let nextId = 1;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderMd(t) { try { return typeof marked!=='undefined' ? marked.parse(t||'') : esc(t||''); } catch { return esc(t||''); } }

function notify(msg, type='s') {
  const el=$('notif'); el.textContent=msg; el.className=\`show \${type}\`;
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3200);
}

function autoResize(ta) { ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px'; }
function handleKey(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }
function toggleSidebar() { sidebarOpen=!sidebarOpen; $('sidebar').classList.toggle('collapsed',!sidebarOpen); }
function syncModel() { $('model-badge').textContent=$('model-name').value||'modèle'; }

function buildLLMHeaders() {
  const key=$('api-key').value.trim();
  const h={'Content-Type':'application/json'};
  if(key) h['Authorization']=\`Bearer \${key}\`;
  return h;
}

function renderTopPills() {
  $('tb-mcps').innerHTML = servers
    .filter(s=>s.enabled&&s.status==='ok')
    .map(s=>\`<span class="tb-mcp-pill" title="\${esc(s.url)}">\${esc(s.name)} <span style="opacity:.6">(\${s.tools.length})</span></span>\`)
    .join('');
}

function addServer(name='', url='', bearer='') {
  const id=nextId++;
  servers.push({id, name:name||\`MCP \${id}\`, url, bearer, sessionId:null, enabled:false, status:'off', tools:[]});
  renderCards(); saveServers();
}

function removeServer(id) {
  servers=servers.filter(s=>s.id!==id);
  renderCards(); renderTopPills(); saveServers();
}

function renderCards() {
  const el=$('mcp-cards');
  if(!servers.length) {
    el.innerHTML='<div style="padding:0 4px;font-size:12px;color:var(--muted)">Aucun serveur. Cliquez "+ Ajouter".</div>';
    return;
  }
  el.innerHTML=servers.map(s=>cardHTML(s)).join('');
}

function cardHTML(s) {
  const badgeClass={ok:'ok',err:'err',loading:'loading',off:'off'}[s.status]||'off';
  const badgeLabel={ok:\`\${s.tools.length} outils\`,err:'erreur',loading:'…',off:'off'}[s.status]||'off';

  const toolsHTML = (s.status==='ok'&&s.tools.length)
    ? \`<div class="mcp-tools">
        <div class="mcp-tools-head" onclick="toggleTools(\${s.id})">
          <span>\${s.tools.length} outil\${s.tools.length>1?'s':''}</span>
          <span class="mcp-tools-chevron" id="tools-chevron-\${s.id}">▸</span>
        </div>
        <div class="mcp-tools-body collapsed" id="tools-body-\${s.id}">\${s.tools.map(t=>\`
          <div class="tool-row">
            <div class="tool-dot"></div>
            <div>
              <div class="tool-name-t">\${esc(t.name)}</div>
              \${t.description?\`<div class="tool-desc-t">\${esc(t.description.slice(0,60))}\${t.description.length>60?'…':''}</div>\`:''}
            </div>
          </div>\`).join('')}
        </div>
      </div>\` : '';

  const activeClass = s.enabled&&s.status==='ok' ? 'active' : s.status==='err' ? 'error' : '';

  return \`<div class="mcp-card \${activeClass}" id="card-\${s.id}">
    <div class="mcp-card-head">
      <label class="mcp-toggle">
        <input type="checkbox" \${s.enabled?'checked':''} onchange="toggleServer(\${s.id},this.checked)">
        <div class="mcp-toggle-track"><div class="mcp-toggle-thumb"></div></div>
      </label>
      <input class="mcp-name-input" type="text" value="\${esc(s.name)}" placeholder="Nom"
        onchange="servers.find(x=>x.id==\${s.id}).name=this.value;renderTopPills();saveServers()">
      <span class="mcp-badge \${badgeClass}">\${badgeLabel}</span>
    </div>
    <div class="mcp-url-row">
      <input type="text" value="\${esc(s.url)}" placeholder="http://localhost:3000/mcp/"
        onchange="servers.find(x=>x.id==\${s.id}).url=this.value;saveServers()" style="flex:1">
      <button class="btn-icon" onclick="connectServer(\${s.id})" title="Connecter">&#x21BB;</button>
      <button class="btn-icon btn-del" onclick="removeServer(\${s.id})" title="Supprimer">&#x2715;</button>
    </div>
    <div class="mcp-bearer-row">
      <div class="secret-wrap" style="flex:1">
        <input type="password" value="\${esc(s.bearer||'')}" placeholder="Token Bearer (optionnel)"
          autocomplete="off" style="padding-right:34px;font-size:11px"
          onchange="servers.find(x=>x.id==\${s.id}).bearer=this.value;saveServers()">
        <div class="secret-actions">
          <button class="secret-btn" onclick="toggleReveal(this.closest('.secret-wrap').querySelector('input'),this)" title="Afficher/masquer">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      \${s.bearer ? '<span class="key-saved show" style="flex-shrink:0">token &#x2713;</span>' : '<span style="font-size:10px;color:var(--muted);flex-shrink:0;font-family:var(--font-mono)">no auth</span>'}
    </div>
    \${toolsHTML}
  </div>\`;
}

async function toggleServer(id, checked) {
  const s=servers.find(x=>x.id===id); if(!s) return;
  s.enabled=checked;
  if(checked && s.status!=='ok') { await connectServer(id); }
  else { renderCards(); renderTopPills(); saveServers(); }
}

// ── MCP JSON-RPC over Streamable HTTP ──────────────────────────────────────

async function readSSE(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '', result = null;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    const lines = buf.split('\\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const d = line.slice(6).trim();
        if (d && d !== '[DONE]') { try { result = JSON.parse(d); } catch {} }
      }
    }
  }
  return result;
}

function mcpProxyUrl(server) {
  return \`/api/mcp?url=\${encodeURIComponent(server.url)}\`;
}

async function mcpRPC(server, method, params) {
  const body = {jsonrpc: '2.0', id: Date.now(), method};
  if (params !== undefined) body.params = params;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (server.bearer?.trim()) headers['Authorization'] = \`Bearer \${server.bearer.trim()}\`;
  if (server.sessionId) headers['Mcp-Session-Id'] = server.sessionId;
  const res = await fetch(mcpProxyUrl(server), {method: 'POST', headers, body: JSON.stringify(body)});
  const sid = res.headers.get('Mcp-Session-Id');
  if (sid) server.sessionId = sid;
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) return await readSSE(res);
  return await res.json();
}

async function mcpNotify(server, method, params) {
  const body = {jsonrpc: '2.0', method};
  if (params !== undefined) body.params = params;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (server.bearer?.trim()) headers['Authorization'] = \`Bearer \${server.bearer.trim()}\`;
  if (server.sessionId) headers['Mcp-Session-Id'] = server.sessionId;
  await fetch(mcpProxyUrl(server), {method: 'POST', headers, body: JSON.stringify(body)}).catch(() => {});
}

async function connectServer(id) {
  const s=servers.find(x=>x.id===id); if(!s) return;
  if(!s.url) { notify('URL manquante','e'); return; }
  s.status='loading'; s.sessionId=null; renderCards();
  try {
    // Poignée de main MCP
    const initResp = await mcpRPC(s, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {name: 'MCPChat', version: '1.0'}
    });
    if (initResp?.error) throw new Error(initResp.error.message || 'initialize échoué');
    await mcpNotify(s, 'notifications/initialized', {});

    // Récupération des outils
    const toolsResp = await mcpRPC(s, 'tools/list');
    if (toolsResp?.error) throw new Error(toolsResp.error.message || 'tools/list échoué');
    s.tools = toolsResp?.result?.tools || [];
    s.status='ok'; s.enabled=true;
    notify(\`✓ \${s.name} : \${s.tools.length} outil(s)\`);
  } catch(err) {
    s.status='err'; s.enabled=false;
    notify(\`\${s.name} : \${err.message}\`, 'e');
  }
  renderCards(); renderTopPills(); saveServers();
}

async function callMCPTool(name, args) {
  const server=findServerForTool(name);
  if(!server) throw new Error(\`Aucun serveur MCP actif pour "\${name}"\`);
  const resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
  if (resp?.error) throw new Error(resp.error.message || 'Erreur tool call');
  const content = resp?.result?.content || [];
  return content.map(c => c.text ?? JSON.stringify(c)).join('\\n') || JSON.stringify(resp?.result || {});
}

// ── Outils actifs ───────────────────────────────────────────────────────────

function getActiveTools() {
  const out=[];
  for(const s of servers) {
    if(!s.enabled||s.status!=='ok') continue;
    for(const t of s.tools) out.push({...t, _server:s});
  }
  return out;
}

function findServerForTool(name) {
  for(const s of servers)
    if(s.enabled&&s.status==='ok'&&s.tools.some(t=>t.name===name)) return s;
  return null;
}

// ── Chat ────────────────────────────────────────────────────────────────────

function clearChat() {
  messages=[];
  $('messages').innerHTML=\`<div id="empty"><div class="em-icon">⧡</div><h2>MCP Chat</h2><p>Activez un serveur MCP, puis démarrez la conversation.</p></div>\`;
}

function removeEmpty() { $('empty')?.remove(); }

function appendMsg(role, content, toolCalls=null) {
  removeEmpty();
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className=\`msg \${role}\`;
  const av=role==='user'?'<div class="av u">Vous</div>':'<div class="av a">IA</div>';
  const tc=toolCalls?.length ? toolCalls.map((c,i)=>tcBlockHTML(c,i)).join('') : '';
  const bodyHtml=role==='assistant' ? renderMd(content||'') : esc(content||'');
  div.innerHTML=\`\${av}<div class="bubble">\${bodyHtml}\${tc}</div>\`;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function tcBlockHTML(tc, fallbackIdx) {
  const idx = tc._domIdx !== undefined ? tc._domIdx : fallbackIdx;
  const fn=tc.function?.name||tc.name||'?';
  let args='{}';
  try{args=JSON.stringify(JSON.parse(tc.function?.arguments||'{}'),null,2);}catch{args=tc.function?.arguments||'{}';}
  const server=findServerForTool(fn);
  const src=server?\`<span class="tc-src">\${esc(server.name)}</span>\`:'';
  return \`<div class="tc-block" id="tc-\${idx}">
    <div class="tc-head" onclick="toggleTC(\${idx})">
      <span style="color:var(--accent);font-size:11px">⚙</span>
      \${src}
      <span class="tc-fn">\${esc(fn)}</span>
      <span class="tc-st run" id="tc-st-\${idx}">running…</span>
    </div>
    <div class="tc-body" id="tc-body-\${idx}">
      <div class="tc-lbl">Arguments</div>
      <pre>\${esc(args)}</pre>
    </div>
  </div>\`;
}

function updateTC(idx, result, ok) {
  const st=$(\`tc-st-\${idx}\`), body=$(\`tc-body-\${idx}\`);
  if(st){st.textContent=ok?'✓ ok':'✗ erreur';st.className=\`tc-st \${ok?'ok':'er'}\`;}
  if(body){
    const val=typeof result==='string'?result:JSON.stringify(result,null,2);
    body.innerHTML+=\`<div class="tc-lbl" style="margin-top:8px">Résultat</div><pre style="color:\${ok?'var(--ok)':'var(--err)'}">\${esc(val)}</pre>\`;
  }
}

function toggleTC(idx) { $(\`tc-body-\${idx}\`)?.classList.toggle('hidden'); }

function toggleTools(id) {
  const body=$(\`tools-body-\${id}\`), chevron=$(\`tools-chevron-\${id}\`);
  if(!body) return;
  const collapsed=body.classList.toggle('collapsed');
  if(chevron) chevron.textContent=collapsed?'▸':'▾';
}

function createStreamBubble() {
  removeEmpty();
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className='msg assistant';
  div.innerHTML='<div class="av a">IA</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function setStreamContent(div, text, extra='') {
  const bubble=div.querySelector('.bubble');
  if(!bubble) return;
  bubble.innerHTML=(text ? renderMd(text) : '<div class="typing"><span></span><span></span><span></span></div>')+extra;
  $('messages').scrollTop=$('messages').scrollHeight;
}

async function fetchStream(url, headers, body, onDelta) {
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,stream:true})});
  if(!res.ok) throw new Error(\`API \${res.status}: \${await res.text()}\`);
  const reader=res.body.getReader();
  const dec=new TextDecoder();
  let buf='', content='', tcAccum={};
  for(;;) {
    const {done,value}=await reader.read();
    if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\\n');
    buf=lines.pop();
    for(const line of lines) {
      if(!line.startsWith('data: ')) continue;
      const d=line.slice(6).trim();
      if(!d||d==='[DONE]') continue;
      let chunk; try{chunk=JSON.parse(d);}catch{continue;}
      const delta=chunk.choices?.[0]?.delta;
      if(!delta) continue;
      if(delta.content){content+=delta.content; onDelta(content);}
      if(delta.tool_calls) for(const tc of delta.tool_calls) {
        const i=tc.index??0;
        if(!tcAccum[i]) tcAccum[i]={id:'',name:'',arguments:''};
        if(tc.id) tcAccum[i].id+=tc.id;
        if(tc.function?.name) tcAccum[i].name+=tc.function.name;
        if(tc.function?.arguments) tcAccum[i].arguments+=tc.function.arguments;
      }
    }
  }
  const toolCalls=Object.keys(tcAccum).length
    ? Object.values(tcAccum).map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:t.arguments}}))
    : null;
  return {content,toolCalls};
}

async function sendMessage() {
  if(isStreaming) return;
  const input=$('chat-input');
  const text=input.value.trim();
  if(!text) return;
  const model=$('model-name').value.trim()||'gpt-4o';
  const temp=parseFloat($('temperature').value)||0.7;
  const useProxy=!!(window.__WIKI_CONFIG__);
  if(!useProxy && !$('base-url').value.trim()){notify('Entrez une Base URL','e');return;}

  input.value=''; input.style.height='auto';
  isStreaming=true; $('send-btn').disabled=true;
  messages.push({role:'user',content:text});
  appendMsg('user',text);

  let tcIdx=Date.now();
  const MAX_TURNS=12;
  let turn=0;
  const activeTools=getActiveTools();
  const toolsPayload=activeTools.length ? activeTools.map(t=>({
    type:'function',
    function:{name:t.name,description:t.description||'',parameters:t.inputSchema||t.parameters||{type:'object',properties:{}}}
  })) : undefined;
  const llmUrl=useProxy ? '/api/chat' : \`\${$('base-url').value.trim().replace(/\\/$/, '')}/v1/chat/completions\`;
  const llmHeaders=useProxy ? {'Content-Type':'application/json'} : buildLLMHeaders();

  let streamDiv=null;
  try {
    while(turn<MAX_TURNS) {
      turn++;
      const reqBody={model,temperature:temp,messages,...(toolsPayload?{tools:toolsPayload,tool_choice:'auto'}:{})};
      streamDiv=createStreamBubble();
      const {content,toolCalls}=await fetchStream(llmUrl,llmHeaders,reqBody,t=>setStreamContent(streamDiv,t));

      if(toolCalls?.length) {
        const tcBlocks=toolCalls.map((tc,i)=>tcBlockHTML({...tc,_domIdx:tcIdx+i},tcIdx+i)).join('');
        setStreamContent(streamDiv,content,tcBlocks);
        messages.push({role:'assistant',content:content||null,tool_calls:toolCalls.map((tc,i)=>({...tc,_domIdx:tcIdx+i}))});
        const toolResults=await Promise.all(toolCalls.map(async (tc,i)=>{
          const domIdx=tcIdx+i;
          const fn=tc.function?.name;
          let args={}; try{args=JSON.parse(tc.function?.arguments||'{}');}catch{}
          try {
            const r=await callMCPTool(fn,args);
            updateTC(domIdx,r,true);
            return {tool_call_id:tc.id,role:'tool',name:fn,content:r};
          } catch(e) {
            updateTC(domIdx,e.message,false);
            return {tool_call_id:tc.id,role:'tool',name:fn,content:\`Erreur: \${e.message}\`};
          }
        }));
        tcIdx+=toolCalls.length;
        messages.push(...toolResults);
        streamDiv=null;
        continue;
      }

      setStreamContent(streamDiv,content);
      messages.push({role:'assistant',content});
      break;
    }
    if(turn>=MAX_TURNS) appendMsg('assistant',\`⚠ Limite de chaînage atteinte (\${MAX_TURNS} tours).\`);
  } catch(err) {
    streamDiv?.remove();
    appendMsg('assistant',\`⚠ Erreur: \${err.message}\`);
    notify(err.message,'e');
  } finally {
    isStreaming=false; $('send-btn').disabled=false;
  }
}

// ── Champs secrets ──────────────────────────────────────────────────────────

const SVG_EYE     = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>\`;
const SVG_EYE_OFF = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\`;

function toggleReveal(inputOrId, btn) {
  const inp = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
  const isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? SVG_EYE_OFF : SVG_EYE;
  if (isHidden) {
    clearTimeout(inp._hideTimer);
    inp._hideTimer = setTimeout(() => { inp.type='password'; btn.innerHTML=SVG_EYE; }, 8000);
  }
}

function flashSaved(id) {
  const el=$(id); if(!el) return;
  el.classList.add('show');
}

function saveConfig() {
  const cfg = {
    baseUrl: $('base-url').value,
    apiKey:  $('api-key').value,
    model:   $('model-name').value,
    temp:    $('temperature').value,
  };
  localStorage.setItem('mcpchat_config', JSON.stringify(cfg));
  if (cfg.apiKey) flashSaved('llm-saved');
}

// ── LocalStorage (user-added servers only) ──────────────────────────────────

const LS = {USER_SERVERS: 'mcpchat_user_servers'};

function saveServers() {
  const data = servers.map(({id,name,url,bearer,enabled}) => ({id,name,url,bearer:bearer||'',enabled}));
  localStorage.setItem(LS.USER_SERVERS, JSON.stringify(data));
}

function loadConfig() {
  const wc = window.__WIKI_CONFIG__;
  if (wc) {
    // Docker/proxy mode: show server credentials as read-only
    if (wc.model) $('model-name').value = wc.model;
    if (wc.temperature) $('temperature').value = String(wc.temperature);
    if (wc.baseUrl) { $('base-url').value = wc.baseUrl; $('base-url').readOnly = true; $('base-url').style.opacity = '.7'; }
    if (wc.apiKey)  { $('api-key').value = wc.apiKey;   $('api-key').readOnly = true;  $('api-key').style.opacity = '.7'; flashSaved('llm-saved'); }
  } else {
    // CLI mode: load from localStorage
    try {
      const cfg = JSON.parse(localStorage.getItem('mcpchat_config')||'{}');
      if (cfg.baseUrl) $('base-url').value = cfg.baseUrl;
      if (cfg.apiKey)  { $('api-key').value = cfg.apiKey; flashSaved('llm-saved'); }
      if (cfg.model)   $('model-name').value = cfg.model;
      if (cfg.temp)    $('temperature').value = cfg.temp;
    } catch {}
  }
  syncModel();
}

function loadServers() {
  const defaults = window.__WIKI_CONFIG__?.mcpServers || [];
  try {
    const saved = JSON.parse(localStorage.getItem(LS.USER_SERVERS)||'[]');
    // Discard stale data that used old proxy-path URLs (/api/mcp/*)
    const isStale = saved.some(s => typeof s.url === 'string' && s.url.startsWith('/api/mcp'));
    if (saved.length && !isStale) {
      for (const s of saved) {
        // In proxy mode, always use the server-injected URL/bearer for known servers
        // to avoid stale localhost URLs looping back to the serve container
        const override = defaults.find(d => d.name === s.name);
        const url = override ? override.url : s.url;
        const bearer = override ? (override.bearer||'') : (s.bearer||'');
        servers.push({...s, url, bearer, sessionId:null, status:'off', tools:[]});
        if(s.id >= nextId) nextId = s.id + 1;
      }
      renderCards();
      return;
    }
  } catch {}
  // No saved state (or stale) — seed from server config
  for (const s of defaults) addServer(s.name, s.url, s.bearer||'');
}

// ── Init ────────────────────────────────────────────────────────────────────
loadConfig();
loadServers();
</script>`;

export const CHAT_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Chat</title>
<style>
${WIKI_CSS_VARS}
:root {
  --font-sans: ${WIKI_FONT_STACK};
  --font-mono: ${WIKI_MONO_STACK};
  --panel-deep: #e2e8f0;
  --accent2: var(--link);
  --muted2: var(--muted);
  --ok:   #1a8a5a;
  --err:  #c0392b;
  --warn: #c7a800;
}
@media (prefers-color-scheme: dark) {
  :root {
    --panel-deep: #1a2330;
    --ok:   #2dd4a0;
    --err:  #f06b6b;
    --warn: #f5c842;
  }
}
.tb-back {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  transition: border-color .2s, color .2s;
}
.tb-back:hover { border-color: var(--accent); color: var(--accent); }
${CHAT_COMPONENT_CSS}
</style>
<script src="/assets/marked.min.js"></script>
</head>
<body>
${CHAT_BODY}
</body>
</html>`;
