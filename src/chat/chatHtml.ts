import { WIKI_CSS_VARS, WIKI_FONT_STACK, WIKI_MONO_STACK } from './theme.ts';

const CHAT_COMPONENT_CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans);background:var(--bg);color:var(--text);height:100vh;display:flex;overflow:hidden}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

/* APP NAV */
#app-nav{position:fixed;top:0;left:0;right:0;height:44px;z-index:1000;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;padding:0 12px}
.app-nav-btn,.app-nav-link{height:30px;min-width:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--muted);text-decoration:none;cursor:pointer;font-family:var(--font-sans);font-size:12px;font-weight:800;line-height:1;transition:border-color .2s,color .2s,background .2s}
.app-nav-btn:hover,.app-nav-link:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.app-nav-link{padding:0 10px;gap:6px}
.app-nav-title{min-width:0;font-size:13px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.app-nav-spacer{flex:1}

/* SIDEBAR */
#sidebar{width:300px;min-width:300px;height:calc(100vh - 44px);margin-top:44px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;transition:width .3s,min-width .3s}
#sidebar.collapsed{width:0;min-width:0}
.sb-logo{padding:18px 16px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px}
.sb-logo-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:800;flex-shrink:0}
.sb-logo-main{min-width:0;flex:1}
.sb-logo-text{font-size:16px;font-weight:800;letter-spacing:-.3px}
.sb-logo-sub{font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:1px}
.sb-scroll{flex:1;min-height:0;display:grid;grid-template-rows:minmax(96px,var(--history-pane-height,38%)) 10px minmax(180px,1fr);overflow:hidden}
.sb-pane{min-height:0;overflow-y:auto;padding-bottom:12px}
.sb-pane.history-pane{padding-bottom:8px}
.sb-resizer{height:10px;cursor:row-resize;display:flex;align-items:center;justify-content:center;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--panel);touch-action:none}
.sb-resizer:hover,.sb-resizer.dragging{background:var(--panel-soft)}
.sb-resizer::before{content:'';width:34px;height:3px;border-radius:99px;background:var(--border)}
.sb-resizer:hover::before,.sb-resizer.dragging::before{background:var(--muted)}
.sec-label{font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);padding:16px 16px 8px;display:flex;align-items:center;justify-content:space-between}
.sec-label button{background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted2);font-size:11px;padding:2px 8px;cursor:pointer;font-family:var(--font-sans);font-weight:600;transition:border-color .2s,color .2s}
.sec-label button:hover{border-color:var(--accent);color:var(--accent)}
.history-list{padding:0 12px;display:flex;flex-direction:column;gap:5px}
.history-empty{padding:8px 4px;color:var(--muted);font-size:12px;line-height:1.4}
.history-item{display:flex;align-items:center;gap:7px;border:1px solid transparent;border-radius:9px;padding:7px 8px;background:transparent;color:var(--text);cursor:pointer;text-align:left;transition:background .2s,border-color .2s}
.history-item:hover,.history-item.active{background:var(--panel-soft);border-color:var(--border)}
.history-main{min-width:0;flex:1}
.history-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.history-meta{margin-top:2px;font-size:10px;color:var(--muted);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.history-delete{display:none;background:none;border:none;color:var(--muted);cursor:pointer;border-radius:6px;padding:3px 5px;font-size:12px}
.history-item:hover .history-delete{display:block}
.history-delete:hover{color:var(--err);background:rgba(240,107,107,.08)}
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
.sb-link{display:flex;align-items:center;justify-content:space-between;margin:4px 12px 0;padding:9px 10px;border:1px solid var(--border);border-radius:9px;background:var(--panel-soft);color:var(--text);text-decoration:none;font-size:12px;font-weight:700;transition:border-color .2s,color .2s,background .2s}
.sb-link:hover,.sb-link.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.sb-link span{font-family:var(--font-mono);font-size:10px;color:var(--muted)}

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
#main{flex:1;height:calc(100vh - 44px);margin-top:44px;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
#topbar{padding:12px 18px;border-bottom:1px solid var(--border);background:var(--panel);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tb-model{font-family:var(--font-mono);font-size:11px;color:var(--muted2);background:var(--panel-soft);border:1px solid var(--border);padding:4px 10px;border-radius:99px}
.tb-mcps{display:flex;gap:5px;flex-wrap:wrap}
.tb-mcp-pill{font-size:10px;font-family:var(--font-mono);font-weight:500;padding:3px 8px;border-radius:99px;background:rgba(79,126,255,.12);border:1px solid rgba(79,126,255,.25);color:var(--accent)}
.tb-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.tb-clear,.tb-system{background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);padding:5px 12px;cursor:pointer;font-size:12px;font-family:var(--font-sans);font-weight:600;transition:all .2s}
.tb-clear:hover{border-color:var(--err);color:var(--err)}
.tb-system:hover,.tb-system.active{border-color:var(--accent);color:var(--accent)}
.tb-production{background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);padding:5px 12px;cursor:pointer;font-size:12px;font-family:var(--font-sans);font-weight:600;transition:all .2s;display:none}
.tb-production.visible{display:inline-flex;align-items:center;gap:6px}
.tb-production:hover,.tb-production.active{border-color:var(--accent);color:var(--accent)}
.tb-production-dot{width:7px;height:7px;border-radius:50%;background:var(--muted)}
.tb-production-dot.running{background:var(--warn);animation:pulse 1s infinite}
.tb-production-dot.done{background:var(--ok)}
.tb-production-dot.failed,.tb-production-dot.cancelled{background:var(--err)}
body.connectors-mode #messages,body.connectors-mode #input-wrap{display:none}
body.connectors-mode #connectors-view{display:block}
body:not(.connectors-mode) #connectors-view{display:none}
.connectors-view{flex:1;min-height:0;overflow:auto;padding:28px clamp(18px,4vw,48px)}
.connectors-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 auto 18px;max-width:1120px}
.connectors-title h1{font-size:22px;line-height:1.2;margin:0;color:var(--text)}
.connectors-title p{font-size:13px;line-height:1.45;margin:5px 0 0;color:var(--muted);max-width:620px}
.connectors-add{border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);padding:8px 12px;cursor:pointer;font-family:var(--font-sans);font-size:12px;font-weight:700}
.connectors-add:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.connectors-section{max-width:1120px;margin:0 auto 28px}
.connectors-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
.connectors-section-title h2{font-size:16px;line-height:1.25;margin:0;color:var(--text)}
.connectors-section-title p{font-size:12px;line-height:1.45;margin:4px 0 0;color:var(--muted);max-width:640px}
.connectors-grid{max-width:1120px;margin:0 auto}
.connectors-grid .mcp-cards{padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.connectors-grid .mcp-card{min-width:0}
.skills-manager-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.skill-manager-card{border:1px solid var(--border);border-radius:10px;background:var(--panel-soft);padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.skill-manager-name{font-family:var(--font-mono);font-size:13px;font-weight:800;color:var(--accent)}
.skill-manager-desc{font-size:12px;color:var(--muted);line-height:1.45}
.skill-manager-params{display:flex;flex-wrap:wrap;gap:4px}
.skill-manager-param{font-family:var(--font-mono);font-size:10px;color:var(--text);border:1px solid var(--border);border-radius:99px;background:var(--panel);padding:2px 7px}
.skill-manager-preview{font-family:var(--font-mono);font-size:11px;line-height:1.45;color:var(--muted2);white-space:pre-wrap;max-height:64px;overflow:hidden;border-left:2px solid var(--border);padding-left:8px}
.skill-manager-actions{display:flex;gap:7px;margin-top:auto;padding-top:6px;border-top:1px solid var(--border)}
.skill-manager-btn{border:1px solid var(--border);border-radius:7px;background:var(--panel);color:var(--text);padding:6px 9px;cursor:pointer;font-family:var(--font-sans);font-size:11px;font-weight:700}
.skill-manager-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.skill-manager-btn.del:hover{border-color:var(--err);color:var(--err);background:rgba(240,107,107,.08)}
.skill-empty{border:1px dashed var(--border);border-radius:10px;color:var(--muted);font-size:12px;line-height:1.5;padding:16px;background:var(--panel-soft)}
.skill-editor{margin-top:12px;border:1px solid var(--border);border-radius:12px;background:var(--panel);padding:14px;display:none;flex-direction:column;gap:10px}
.skill-editor.open{display:flex}
.skill-editor-title{font-size:13px;font-weight:800;color:var(--text)}
.skill-editor-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.skill-editor label{display:block;font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.skill-editor input,.skill-editor textarea{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--text);font-family:var(--font-sans);font-size:12px;padding:8px;outline:none}
.skill-editor textarea{min-height:130px;resize:vertical;font-family:var(--font-mono);line-height:1.5}
.skill-editor input:focus,.skill-editor textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.skill-editor-actions{display:flex;justify-content:flex-end;gap:8px}
@media (max-width: 720px){.skill-editor-row{grid-template-columns:1fr}.connectors-section-head{flex-direction:column}}

/* MESSAGES */
#messages{flex:1;overflow-y:auto;padding:28px clamp(16px,4vw,48px) 22px;display:flex;flex-direction:column;gap:22px;align-items:center}
.msg{width:min(820px,100%);display:flex;gap:12px;animation:fadeUp .25s ease}
.msg.user{justify-content:flex-end}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.av{width:30px;height:30px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.av.u{display:none}
.av.a{display:none}
.msg-content{min-width:0;display:flex;flex-direction:column;gap:6px}
.msg.assistant .msg-content{flex:1}
.msg.user .msg-content{align-items:flex-end}
.bubble{font-size:14px;line-height:1.72;word-break:break-word}
.msg.user .bubble{width:max-content;max-width:min(30vw,460px);background:transparent;border:0;border-radius:0;padding:4px 0;white-space:pre-wrap;text-align:left}
.msg.assistant .bubble{flex:1;min-width:0;padding:2px 0;white-space:normal}
.msg-actions{display:flex;gap:6px;opacity:.45;transition:opacity .2s}
.msg:hover .msg-actions{opacity:1}
.msg-action{background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;font-family:var(--font-sans);font-weight:600;padding:2px 0}
.msg-action:hover{color:var(--accent)}
.trace-card{width:min(820px,100%);background:var(--panel-soft);border:1px solid var(--border);border-radius:14px;padding:10px 12px;animation:fadeUp .25s ease}
.trace-card.empty{display:none}
.trace-head{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;user-select:none}
.trace-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;font-weight:800;color:var(--text)}
.trace-meta{font-size:11px;color:var(--muted);font-weight:600;white-space:nowrap}
.trace-chevron{font-family:var(--font-mono);font-size:11px;color:var(--muted)}
.trace-body{padding-top:10px}
.trace-body.collapsed{display:none}
.trace-flow{display:flex;align-items:center;gap:7px;overflow-x:auto;padding:2px 0 4px}
.trace-tile{position:relative;flex:0 0 auto;max-width:180px;border:1px solid var(--border);background:var(--panel);border-radius:13px;padding:7px 10px;cursor:default}
.trace-tile.tool{background:rgba(79,126,255,.08);border-color:rgba(79,126,255,.22);cursor:pointer}
.trace-tile.internal{background:rgba(127,127,127,.06);border-style:dashed}
.trace-tile.error{background:rgba(240,107,107,.08);border-color:rgba(240,107,107,.24)}
.trace-tile.final{background:rgba(45,212,160,.08);border-color:rgba(45,212,160,.24)}
.trace-k{font-family:var(--font-mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.trace-v{margin-top:2px;font-size:12px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trace-s{margin-top:1px;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trace-link{flex:0 0 auto;width:18px;height:1px;background:var(--border);position:relative}
.trace-link::after{content:'';position:absolute;right:0;top:-3px;border-left:5px solid var(--border);border-top:3.5px solid transparent;border-bottom:3.5px solid transparent}
@media (max-width: 720px){.msg.user .bubble{width:max-content;max-width:min(80vw,100%)}.trace-flow{align-items:stretch;flex-direction:column}.trace-link{width:1px;height:16px;margin-left:18px}.trace-link::after{right:-3px;top:auto;bottom:0;border-left:3.5px solid transparent;border-right:3.5px solid transparent;border-top:5px solid var(--border);border-bottom:0}.trace-tile{max-width:100%}}
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
.bubble .instruction-ref{color:var(--warn);font-family:var(--font-mono);font-size:.92em;background:rgba(199,168,0,.08);border:1px solid rgba(199,168,0,.22);border-radius:5px;padding:1px 5px;white-space:nowrap}
.stream-cursor::after{content:'▋';animation:blink .8s step-end infinite;color:var(--accent);margin-left:1px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.tc-block{margin-top:12px;background:var(--panel-soft);border:1px solid var(--border);border-radius:12px;overflow:hidden;font-family:var(--font-mono);font-size:12px}
.tc-head{display:flex;align-items:center;gap:7px;padding:9px 12px;background:var(--panel);border-bottom:1px solid var(--border);cursor:pointer;user-select:none}
.tc-src{font-size:9px;color:var(--muted);font-style:italic}
.tc-fn{color:var(--accent);font-weight:700;font-size:11px}
.tc-status{margin-left:auto;display:flex;align-items:center;gap:8px}
.tc-st{font-size:12px;line-height:1}
.tc-st.run{color:var(--warn);animation:pulse 1s infinite}
.tc-st.ok{color:var(--ok)}
.tc-st.er{color:var(--err)}
.tc-expand{color:var(--muted);font-family:var(--font-mono);font-size:12px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.tc-body{padding:10px 12px}
.tc-body.args-collapsed .tc-args{display:none}
.tc-args-toggle{background:none;border:none;color:var(--muted);cursor:pointer;font-family:var(--font-sans);font-size:11px;font-weight:700;padding:0}
.tc-args-toggle:hover{color:var(--accent)}
.tc-lbl{font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.tc-body pre{background:var(--panel);border:1px solid var(--border);border-radius:9px;color:var(--text);white-space:pre-wrap;word-break:break-word;font-size:11px;max-height:220px;overflow:auto}
.tc-body.hidden{display:none}
.tc-summary{display:flex;flex-direction:column;gap:8px}
.tc-summary-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--text);font-family:var(--font-sans);font-size:12px;font-weight:700}
.tc-pill{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:99px;padding:2px 7px;color:var(--muted);font-family:var(--font-mono);font-size:10px;font-weight:500}
.tc-list{display:flex;flex-direction:column;gap:6px}
.tc-item{background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:8px 10px;font-family:var(--font-sans)}
.tc-item-title{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px;font-weight:700;color:var(--text)}
.tc-item-path{font-family:var(--font-mono);font-size:10px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-doc-btn{display:inline-flex;max-width:100%;align-items:center;gap:5px;background:none;border:none;color:var(--accent);font:inherit;cursor:pointer;padding:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-doc-btn:hover{text-decoration:underline;text-underline-offset:2px}
.tc-doc-chip-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.tc-doc-chip{display:inline-flex;max-width:100%;align-items:center;border:1px solid var(--border);border-radius:99px;background:var(--panel-soft);color:var(--accent);font-family:var(--font-mono);font-size:10px;padding:3px 7px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-doc-chip:hover{border-color:var(--accent)}
.tc-item-meta{margin-top:3px;color:var(--muted);font-size:11px}
.tc-item-excerpt{margin-top:5px;color:var(--muted2);font-size:12px;line-height:1.45;white-space:pre-wrap}
.tc-raw{margin-top:8px}
.tc-raw summary{cursor:pointer;color:var(--muted);font-family:var(--font-sans);font-size:11px;font-weight:600}
.tc-raw pre{margin-top:6px}
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
#input-wrap{padding:12px 18px 14px;background:linear-gradient(to top,var(--panel) 82%,rgba(255,255,255,0));display:flex;flex-direction:column;align-items:center}
.input-box{position:relative;width:min(900px,100%);display:flex;align-items:flex-end;gap:10px;background:var(--panel-soft);border:1px solid var(--border);border-radius:24px;padding:12px 12px 12px 18px;box-shadow:0 8px 24px rgba(0,0,0,.05);transition:border-color .2s,box-shadow .2s}
.skill-ac{position:absolute;bottom:calc(100% + 8px);left:0;right:0;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.14);overflow:hidden;display:none;z-index:200;max-height:300px;overflow-y:auto}
.skill-ac.open{display:block}
.skill-ac-item{display:flex;align-items:flex-start;gap:9px;padding:10px 14px;cursor:pointer;transition:background .12s;border-bottom:1px solid var(--border)}
.skill-ac-item:last-child{border-bottom:0}
.skill-ac-item:hover,.skill-ac-item.focused{background:var(--panel-soft)}
.skill-ac-slash{font-family:var(--font-mono);font-size:14px;font-weight:800;color:var(--accent);flex-shrink:0;padding-top:1px}
.skill-ac-info{min-width:0}
.skill-ac-name{font-size:13px;font-weight:700;color:var(--text)}
.skill-ac-desc{font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px}
.input-box:focus-within{border-color:rgba(127,127,127,.45);box-shadow:0 10px 30px rgba(0,0,0,.08)}
#chat-input{flex:1;background:none;border:none;color:var(--text);font-family:var(--font-sans);font-size:15px;resize:none;max-height:180px;overflow-y:auto;line-height:1.55;outline:none;padding:4px 0}
#chat-input::placeholder{color:var(--muted)}
#send-btn{background:var(--text);border:none;border-radius:50%;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s,transform .2s,background .2s;color:var(--bg)}
#send-btn:hover{opacity:.82;transform:scale(1.04)}
#send-btn.is-stop{background:var(--text)}
#send-btn svg{width:16px;height:16px;fill:currentColor}
.input-hint{font-size:10px;color:var(--muted);text-align:center;margin-top:7px}
#notif{position:fixed;bottom:18px;right:18px;padding:10px 16px;border-radius:9px;font-size:12px;font-weight:600;opacity:0;transform:translateY(6px);transition:all .25s;pointer-events:none;z-index:999}
#notif.show{opacity:1;transform:translateY(0)}
#notif.s{background:rgba(45,212,160,.12);border:1px solid var(--ok);color:var(--ok)}
#notif.e{background:rgba(240,107,107,.12);border:1px solid var(--err);color:var(--err)}
.doc-modal{position:fixed;inset:0;z-index:998;display:none}
.doc-modal.open{display:block}
.doc-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px)}
.doc-panel{position:absolute;inset:42px max(28px,calc((100vw - 980px)/2));background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden}
.doc-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--panel)}
.doc-title{min-width:0;flex:1;font-family:var(--font-mono);font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc-open{color:var(--accent);font-size:12px;font-weight:700;text-decoration:none}
.doc-close{width:30px;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--muted);cursor:pointer;font-size:16px;line-height:1}
.doc-close:hover{color:var(--err);border-color:var(--err)}
.doc-content{flex:1;overflow:auto;padding:24px 30px}
.doc-content .article{max-width:820px;margin:0 auto}
.doc-content h1,.doc-content h2,.doc-content h3{line-height:1.25;margin:1em 0 .45em}
.doc-content h1:first-child,.doc-content h2:first-child,.doc-content h3:first-child{margin-top:0}
.doc-content p{line-height:1.7;margin:.55em 0}
.doc-content ul,.doc-content ol{padding-left:1.4em;margin:.55em 0}
.doc-content code{font-family:var(--font-mono);background:var(--panel-soft);border:1px solid var(--border);border-radius:5px;padding:1px 5px}
.doc-content pre{overflow:auto;background:var(--panel-soft);border:1px solid var(--border);border-radius:9px;padding:12px}
.prompt-drawer{position:fixed;inset:0;z-index:997;pointer-events:none}
.prompt-drawer.open{pointer-events:auto}
.prompt-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.22);opacity:0;transition:opacity .2s}
.prompt-drawer.open .prompt-backdrop{opacity:1}
.prompt-panel{position:absolute;top:0;right:0;height:100%;width:min(460px,calc(100vw - 18px));background:var(--panel);border-left:1px solid var(--border);transform:translateX(100%);transition:transform .24s ease;display:flex;flex-direction:column}
.prompt-drawer.open .prompt-panel{transform:translateX(0)}
.prompt-head{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid var(--border)}
.prompt-title{flex:1;min-width:0}
.prompt-title h2{font-size:15px;line-height:1.2;margin:0}
.prompt-title p{font-size:11px;color:var(--muted);line-height:1.4;margin:3px 0 0}
.prompt-close{width:30px;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--muted);cursor:pointer;font-size:16px;line-height:1}
.prompt-close:hover{color:var(--err);border-color:var(--err)}
.prompt-body{flex:1;display:flex;flex-direction:column;gap:10px;padding:14px 16px;min-height:0}
#system-prompt{flex:1;width:100%;min-height:260px;resize:none;background:var(--panel-soft);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:var(--font-mono);font-size:12px;line-height:1.5;padding:12px;outline:none}
#system-prompt:focus{border-color:var(--accent)}
.prompt-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
.prompt-actions button{background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);cursor:pointer;padding:7px 10px;font-size:12px;font-family:var(--font-sans);font-weight:600;transition:all .2s}
.prompt-actions button:hover{border-color:var(--accent);color:var(--accent)}
.production-drawer{position:fixed;inset:0;z-index:996;pointer-events:none}
.production-drawer.open{pointer-events:none}
.production-panel{position:absolute;top:0;right:0;height:100%;width:min(420px,calc(100vw - 18px));background:var(--panel);border-left:1px solid var(--border);transform:translateX(100%);transition:transform .24s ease;display:flex;flex-direction:column}
.production-drawer.open .production-panel{transform:translateX(0);pointer-events:auto}
.production-head{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid var(--border)}
.production-title{flex:1;min-width:0}
.production-title h2{font-size:15px;line-height:1.2;margin:0}
.production-title p{font-size:11px;color:var(--muted);line-height:1.4;margin:3px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.production-close{width:30px;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--muted);cursor:pointer;font-size:16px;line-height:1}
.production-close:hover{color:var(--err);border-color:var(--err)}
.production-body{flex:1;min-height:0;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.prod-empty{color:var(--muted);font-size:13px;line-height:1.55;padding:10px 0}
.prod-card{border:1px solid var(--border);border-radius:12px;background:var(--panel-soft);padding:12px}
.prod-status-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.prod-main{min-width:0}
.prod-kind{font-size:13px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prod-sub{margin-top:3px;font-size:11px;color:var(--muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prod-badge{font-family:var(--font-mono);font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.prod-badge.running,.prod-badge.queued{border-color:rgba(245,200,66,.35);color:var(--warn);background:rgba(245,200,66,.08)}
.prod-badge.done{border-color:rgba(45,212,160,.35);color:var(--ok);background:rgba(45,212,160,.08)}
.prod-badge.failed,.prod-badge.cancelled{border-color:rgba(240,107,107,.35);color:var(--err);background:rgba(240,107,107,.08)}
.prod-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.prod-metric{border:1px solid var(--border);border-radius:9px;background:var(--panel);padding:7px 8px}
.prod-metric-k{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
.prod-metric-v{font-size:12px;color:var(--text);font-family:var(--font-mono);margin-top:2px}
.prod-progress{margin-top:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel);padding:9px}
.prod-progress-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}
.prod-progress-label{min-width:0;font-size:12px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prod-progress-percent{font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap}
.prod-progress-track{height:7px;border-radius:99px;background:var(--panel-deep);overflow:hidden}
.prod-progress-bar{height:100%;width:0;background:var(--accent);border-radius:99px;transition:width .25s ease}
.prod-progress-detail{margin-top:7px;color:var(--muted);font-size:11px;line-height:1.45}
.prod-steps{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.prod-step{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:9px;background:var(--panel);padding:7px 8px}
.prod-step-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0}
.prod-step-dot.running{background:var(--warn);animation:pulse 1s infinite}
.prod-step-dot.done{background:var(--ok)}
.prod-step-dot.failed,.prod-step-dot.cancelled{background:var(--err)}
.prod-step-main{min-width:0;flex:1}
.prod-step-name{font-size:12px;font-weight:800;color:var(--text)}
.prod-step-meta{font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:1px}
.prod-details{border:1px solid var(--border);border-radius:10px;background:var(--panel-soft);overflow:hidden}
.prod-details summary{cursor:pointer;user-select:none;padding:9px 11px;font-size:12px;font-weight:800;color:var(--text);list-style:none;display:flex;justify-content:space-between;gap:10px}
.prod-details summary::-webkit-details-marker{display:none}
.prod-details summary::after{content:'▸';font-family:var(--font-mono);color:var(--muted)}
.prod-details[open] summary::after{content:'▾'}
.prod-details-body{border-top:1px solid var(--border);padding:10px 11px}
.prod-code{font-family:var(--font-mono);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:9px;max-height:260px;overflow:auto}
.prod-log-line{display:block;color:var(--text)}
.prod-log-line.muted{color:var(--muted)}
@media (max-width: 720px){.doc-panel{inset:14px}.doc-content{padding:18px}}
hr.divider{border:none;border-top:1px solid var(--border);margin:8px 12px}`;

const CHAT_BODY = `<nav id="app-nav" aria-label="Navigation application">
  <button class="app-nav-btn" type="button" onclick="appBack()" title="Retour" aria-label="Retour">‹</button>
  <a class="app-nav-link" href="/" title="Retour au wiki" aria-label="Retour au wiki">Wiki</a>
  <button class="app-nav-btn" type="button" onclick="toggleSidebar()" title="Afficher ou masquer la sidebar" aria-label="Afficher ou masquer la sidebar">☰</button>
  <div class="app-nav-title">MCP Chat</div>
  <div class="app-nav-spacer"></div>
</nav>

<aside id="sidebar">
  <div class="sb-logo">
    <div class="sb-logo-mark">M</div>
    <div class="sb-logo-main">
      <div class="sb-logo-text">MCP Chat</div>
      <div class="sb-logo-sub">multi-server</div>
    </div>
  </div>
  <div class="sb-scroll" id="sidebar-split">
    <div class="sb-pane history-pane" id="history-pane">
      <div class="sec-label">
        Discussions
        <button onclick="newConversation()">+ Nouveau</button>
      </div>
      <div class="history-list" id="history-list">
        <div class="history-empty">Aucun historique.</div>
      </div>
    </div>
    <div class="sb-resizer" id="sidebar-resizer" title="Redimensionner les panneaux"></div>
    <div class="sb-pane config-pane" id="config-pane">
      <div class="sec-label">Connecteurs</div>
      <a class="sb-link" id="connectors-link" href="/chat/connectors" onclick="showConnectorsView(event)">Connecteurs <span>MCP & skills</span></a>
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
    </div>
  </div>
</aside>

<div id="main">
  <div id="topbar">
    <span class="tb-model" id="model-badge">gpt-4o</span>
    <div class="tb-mcps" id="tb-mcps"></div>
    <div class="tb-actions">
      <button class="tb-production" id="production-panel-btn" onclick="toggleProductionPanel()" title="Suivi production">
        <span class="tb-production-dot" id="production-panel-dot"></span>
        <span>Production</span>
      </button>
      <button class="tb-system" id="system-drawer-btn" onclick="toggleSystemPrompt()">Instructions système</button>
      <button class="tb-clear" onclick="clearChat()">Effacer</button>
    </div>
  </div>
  <div class="connectors-view" id="connectors-view">
    <div class="connectors-head">
      <div class="connectors-title">
        <h1>Connecteurs</h1>
        <p>Activez les endpoints MCP et préparez vos skills réutilisables pour le chat.</p>
      </div>
    </div>
    <section class="connectors-section">
      <div class="connectors-section-head">
        <div class="connectors-section-title">
          <h2>Connecteurs MCP</h2>
          <p>Activez les connecteurs disponibles, ajoutez vos endpoints MCP, puis revenez au chat pour utiliser leurs outils.</p>
        </div>
        <button class="connectors-add" type="button" onclick="addServer()">+ Ajouter</button>
      </div>
      <div class="connectors-grid">
        <div class="mcp-cards" id="mcp-cards"></div>
      </div>
    </section>
    <section class="connectors-section">
      <div class="connectors-section-head">
        <div class="connectors-section-title">
          <h2>Skills</h2>
          <p>Créez des instructions préparées, puis insérez-les dans le chat avec <strong>/</strong>.</p>
        </div>
        <button class="connectors-add" type="button" onclick="openSkillEditor()">+ Nouveau skill</button>
      </div>
      <div id="skills-manager-list"></div>
      <div class="skill-editor" id="skill-editor">
        <div class="skill-editor-title" id="skill-editor-title">Nouveau skill</div>
        <div class="skill-editor-row">
          <div>
            <label for="skill-name">Nom</label>
            <input id="skill-name" type="text" placeholder="pipeline" autocomplete="off">
          </div>
          <div>
            <label for="skill-params">Paramètres</label>
            <input id="skill-params" type="text" placeholder="space, template">
          </div>
        </div>
        <div>
          <label for="skill-desc">Description</label>
          <input id="skill-desc" type="text" placeholder="Lance le pipeline complet via l'agent production">
        </div>
        <div>
          <label for="skill-body">Corps du skill</label>
          <textarea id="skill-body" placeholder="Vérifie le statut, puis lance le job demandé..."></textarea>
        </div>
        <div class="skill-editor-actions">
          <button class="skill-manager-btn" type="button" onclick="closeSkillEditor()">Annuler</button>
          <button class="skill-manager-btn" type="button" onclick="saveSkillFromEditor()">Enregistrer</button>
        </div>
      </div>
    </section>
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
      <div class="skill-ac" id="skill-ac"></div>
      <textarea id="chat-input" rows="1" placeholder="Votre message… (/ pour les skills)"
        oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
      <button id="send-btn" onclick="handleSendButton()" title="Envoyer">
        <svg viewBox="0 0 24 24"><path d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z"/></svg>
      </button>
    </div>
    <div class="input-hint">Entrée pour envoyer · Shift+Entrée pour saut de ligne</div>
  </div>
</div>

<div id="notif"></div>
<div class="prompt-drawer" id="system-prompt-drawer" aria-hidden="true">
  <div class="prompt-backdrop" onclick="closeSystemPrompt()"></div>
  <aside class="prompt-panel" aria-label="Instructions système">
    <div class="prompt-head">
      <div class="prompt-title">
        <h2>Instructions système</h2>
        <p>Injectées au modèle à chaque appel, sans apparaître dans l'historique.</p>
      </div>
      <button class="prompt-close" type="button" onclick="closeSystemPrompt()" title="Fermer">×</button>
    </div>
    <div class="prompt-body">
      <textarea id="system-prompt" spellcheck="false" onchange="saveSystemPrompt()" oninput="saveSystemPrompt()"></textarea>
      <div class="prompt-actions">
        <button type="button" onclick="resetSystemPrompt()">Réinitialiser</button>
      </div>
    </div>
  </aside>
</div>
<div class="production-drawer" id="production-drawer" aria-hidden="true">
  <aside class="production-panel" aria-label="Suivi production">
    <div class="production-head">
      <div class="production-title">
        <h2>Production</h2>
        <p id="production-subtitle">Aucun job suivi.</p>
      </div>
      <button class="production-close" type="button" onclick="toggleProductionPanel(false)" title="Fermer">×</button>
    </div>
    <div class="production-body" id="production-body"></div>
  </aside>
</div>
<div class="doc-modal" id="doc-modal" aria-hidden="true">
  <div class="doc-backdrop" onclick="closeLocalDoc()"></div>
  <section class="doc-panel" role="dialog" aria-modal="true" aria-labelledby="doc-title">
    <div class="doc-head">
      <div class="doc-title" id="doc-title">Document</div>
      <a class="doc-open" id="doc-open" href="#" target="_blank" rel="noopener">Ouvrir</a>
      <button class="doc-close" type="button" onclick="closeLocalDoc()" title="Fermer">×</button>
    </div>
    <div class="doc-content" id="doc-content"></div>
  </section>
</div>

<script>
let servers = [];
let messages = [];
let isStreaming = false;
let sidebarOpen = true;
let nextId = 1;
let streamAbortController = null;
let currentConversationId = null;
let historySummaries = [];
let historySaveTimer = null;
let conversationDirty = false;
let historyLoadSeq = 0;
let skillsCache = null;
let skillAcIdx = -1;
let skillAcItems = [];
let skillEditingName = null;
const SKILL_AC_LIMIT = 8;
let productionState = {
  jobId: null,
  job: null,
  progress: null,
  logs: [],
  command: '',
  traceFile: '',
  pollTimer: null,
  countdownTimer: null,
  lastUpdatedAt: null,
};
const DEFAULT_SYSTEM_PROMPT = \`Tu es un assistant connecté à des serveurs MCP.

Quand des outils MCP sont disponibles, utilise-les si la réponse dépend d'informations externes, récentes, privées, locales ou vérifiables par ces outils.

Après chaque résultat d'outil:
- analyse si le résultat suffit pour répondre;
- si le résultat est incomplet, ambigu, tronqué ou seulement exploratoire, appelle un autre outil pertinent avant de répondre;
- ne prétends pas avoir lu une source complète si l'outil n'a retourné qu'un extrait ou une liste de candidats.
- formule les requêtes d'outil en langage naturel; n'utilise pas d'opérateurs de moteur de recherche comme OR ou site: sauf si l'outil le demande explicitement.
- demande peu de résultats au départ (5 à 10) et augmente seulement si la couverture est insuffisante.

Règles spécifiques llm-wiki:
- Pour les questions de synthèse, architecture, analyse fonctionnelle, audit ou comparaison, commence par wiki_collect_context quand il est disponible.
- Utilise readPages comme preuve principale.
- Les candidateResults et excerpts servent à identifier les pages candidates, pas à établir seuls une réponse complète.
- Si readPages est vide, tronqué ou insuffisant, appelle wiki_read_page, wiki_read_pages, wiki_search_context ou wiki_read_ingested_source pour compléter.
- Signale les limites de couverture si les résultats sont insuffisants ou tronqués.

Si plusieurs serveurs MCP sont actifs, choisis les outils selon le domaine de la question.\`;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderInstructionRefs(html) {
  return String(html||'').replace(/\\[\\[([^\\]\\n]+)\\]\\]/g,(_,label)=>\`<span class="instruction-ref">[[\${esc(label.trim())}]]</span>\`);
}
function renderMd(t) { try { return renderInstructionRefs(typeof marked!=='undefined' ? marked.parse(t||'') : esc(t||'')); } catch { return renderInstructionRefs(esc(t||'')); } }
const SIDEBAR_SPLIT_KEY = 'mcpchat_sidebar_history_height';

function languageInstruction() {
  const lang = window.__WIKI_CONFIG__?.language;
  if (!lang || lang === 'en') return '';
  return \`Language: write all responses in \${lang}.\`;
}
function notify(msg, type='s') {
  const el=$('notif'); el.textContent=msg; el.className=\`show \${type}\`;
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3200);
}
function appBack() {
  if(history.length>1) history.back();
  else location.assign('/');
}

function autoResize(ta) {
  ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px';
  const val=ta.value;
  if(val.startsWith('/')&&!/\\s/.test(val)){
    fetchSkillsAc().then(()=>showSkillAc(val.slice(1)));
  } else { hideSkillAc(); }
}
function handleKey(e) {
  if($('skill-ac').classList.contains('open')){
    if(e.key==='ArrowDown'){e.preventDefault();skillAcIdx=Math.min(skillAcIdx+1,skillAcItems.length-1);updateSkillAcFocus();return;}
    if(e.key==='ArrowUp'){e.preventDefault();skillAcIdx=Math.max(skillAcIdx-1,-1);updateSkillAcFocus();return;}
    if(e.key==='Tab'||(e.key==='Enter'&&skillAcIdx>=0)){e.preventDefault();selectSkillAc(skillAcIdx>=0?skillAcIdx:0);return;}
    if(e.key==='Escape'){e.preventDefault();hideSkillAc();return;}
  }
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}
}
async function fetchSkillsAc(force=false){
  if(skillsCache!==null&&!force)return;
  try{
    const r=await fetch('/api/skills');
    skillsCache=r.ok ? await r.json() : [];
  }catch{skillsCache=[];}
}
function showSkillAc(filter){
  const el=$('skill-ac');
  const normalized=String(filter||'').toLowerCase();
  const filtered=(skillsCache||[])
    .filter(s=>String(s.name||'').toLowerCase().startsWith(normalized))
    .slice(0,SKILL_AC_LIMIT);
  skillAcItems=filtered;
  if(!filtered.length){hideSkillAc();return;}
  skillAcIdx=-1;
  el.innerHTML=filtered.map((s,i)=>\`<div class="skill-ac-item" data-idx="\${i}" onclick="selectSkillAc(\${i})" onmouseenter="skillAcIdx=\${i};updateSkillAcFocus()"><div class="skill-ac-slash">/</div><div class="skill-ac-info"><div class="skill-ac-name">\${esc(s.name)}</div>\${s.description?'<div class="skill-ac-desc">'+esc(s.description)+'</div>':''}</div></div>\`).join('');
  el.classList.add('open');
}
function hideSkillAc(){$('skill-ac').classList.remove('open');skillAcIdx=-1;skillAcItems=[];}
function updateSkillAcFocus(){$('skill-ac').querySelectorAll('.skill-ac-item').forEach((el,i)=>el.classList.toggle('focused',i===skillAcIdx));}
function selectSkillAc(idx){
  const skill=skillAcItems[idx];
  if(!skill)return;
  const ta=$('chat-input');
  ta.value='/' + skill.name;
  ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,130)+'px';
  hideSkillAc();
  ta.focus();
  if(skill.params&&skill.params.length){
    notify('Paramètres attendus : '+skill.params.map(p=>'{'+p+'}').join(', '),'s');
  }
}

function renderSkillsManager() {
  const el=$('skills-manager-list');
  if(!el) return;
  if(skillsCache===null) {
    el.innerHTML='<div class="skill-empty">Chargement des skills...</div>';
    fetchSkillsAc().then(renderSkillsManager);
    return;
  }
  const skills=skillsCache||[];
  if(!skills.length) {
    el.innerHTML='<div class="skill-empty">Aucun skill. Créez un premier skill pour le rendre disponible avec / dans le chat.</div>';
    return;
  }
  el.innerHTML=\`<div class="skills-manager-grid">\${skills.map((s,i)=>\`
    <div class="skill-manager-card">
      <div class="skill-manager-name">/\${esc(s.name||'')}</div>
      \${s.description?\`<div class="skill-manager-desc">\${esc(s.description)}</div>\`:''}
      \${Array.isArray(s.params)&&s.params.length?\`<div class="skill-manager-params">\${s.params.map(p=>\`<span class="skill-manager-param">{\${esc(p)}}</span>\`).join('')}</div>\`:''}
      \${s.body?\`<div class="skill-manager-preview">\${esc(String(s.body).slice(0,180))}\${String(s.body).length>180?'...':''}</div>\`:''}
      <div class="skill-manager-actions">
        <button class="skill-manager-btn" type="button" onclick="openSkillEditor(\${i})">Modifier</button>
        <button class="skill-manager-btn del" type="button" onclick="deleteSkillFromManager(\${i})">Supprimer</button>
      </div>
    </div>\`).join('')}</div>\`;
}

function openSkillEditor(idx=null) {
  const skill=Number.isInteger(idx) ? (skillsCache||[])[idx] : null;
  skillEditingName=skill?.name||null;
  $('skill-editor-title').textContent=skill ? \`Modifier /\${skill.name}\` : 'Nouveau skill';
  $('skill-name').value=skill?.name||'';
  $('skill-name').disabled=!!skill;
  $('skill-desc').value=skill?.description||'';
  $('skill-params').value=Array.isArray(skill?.params) ? skill.params.join(', ') : '';
  $('skill-body').value=skill?.body||'';
  $('skill-editor').classList.add('open');
  (skill ? $('skill-body') : $('skill-name')).focus();
}

function closeSkillEditor() {
  skillEditingName=null;
  $('skill-editor')?.classList.remove('open');
}

async function saveSkillFromEditor() {
  const name=(skillEditingName||$('skill-name').value).trim();
  const description=$('skill-desc').value.trim();
  const params=$('skill-params').value.split(',').map(p=>p.trim()).filter(Boolean);
  const body=$('skill-body').value;
  if(!name){notify('Le nom du skill est requis.','e');return;}
  if(!body.trim()){notify('Le corps du skill est requis.','e');return;}
  try {
    const r=await fetch('/api/skills/'+encodeURIComponent(name),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({description,params,body}),
    });
    if(!r.ok) {
      let msg='Enregistrement impossible';
      try{msg=(await r.json()).error||msg;}catch{}
      throw new Error(msg);
    }
    closeSkillEditor();
    await fetchSkillsAc(true);
    renderSkillsManager();
    notify('Skill enregistré');
  } catch(e) {
    notify(e.message||String(e),'e');
  }
}

async function deleteSkillFromManager(idx) {
  const skill=(skillsCache||[])[idx];
  if(!skill) return;
  if(!confirm(\`Supprimer le skill /\${skill.name} ?\`)) return;
  try {
    const r=await fetch('/api/skills/'+encodeURIComponent(skill.name),{method:'DELETE'});
    if(!r.ok) throw new Error('Suppression impossible');
    await fetchSkillsAc(true);
    renderSkillsManager();
    notify('Skill supprimé');
  } catch(e) {
    notify(e.message||String(e),'e');
  }
}
function toggleSidebar() { sidebarOpen=!sidebarOpen; $('sidebar').classList.toggle('collapsed',!sidebarOpen); }
function syncModel() { $('model-badge').textContent=$('model-name').value||'modèle'; }

function clampSidebarSplit(height) {
  const split=$('sidebar-split');
  if(!split) return height;
  const total=split.clientHeight;
  const minTop=96;
  const minBottom=180;
  return Math.max(minTop, Math.min(height, total-minBottom-10));
}

function setSidebarSplitHeight(height, persist=false) {
  const split=$('sidebar-split');
  if(!split) return;
  const clamped=clampSidebarSplit(height);
  split.style.setProperty('--history-pane-height', clamped+'px');
  if(persist) localStorage.setItem(SIDEBAR_SPLIT_KEY, String(Math.round(clamped)));
}

function initSidebarSplitter() {
  const split=$('sidebar-split'), handle=$('sidebar-resizer');
  if(!split || !handle) return;
  const saved=Number(localStorage.getItem(SIDEBAR_SPLIT_KEY));
  if(Number.isFinite(saved) && saved>0) setSidebarSplitHeight(saved);

  let dragging=false;
  const move=e=>{
    if(!dragging) return;
    const rect=split.getBoundingClientRect();
    setSidebarSplitHeight(e.clientY-rect.top,true);
  };
  const up=()=>{
    if(!dragging) return;
    dragging=false;
    handle.classList.remove('dragging');
    document.body.style.cursor='';
    document.body.style.userSelect='';
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
  };
  handle.addEventListener('pointerdown',e=>{
    dragging=true;
    handle.classList.add('dragging');
    document.body.style.cursor='row-resize';
    document.body.style.userSelect='none';
    handle.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    e.preventDefault();
  });
  window.addEventListener('resize',()=>{
    const current=parseFloat(getComputedStyle(split).getPropertyValue('--history-pane-height'));
    if(Number.isFinite(current)) setSidebarSplitHeight(current);
  });
}

function setSendButtonStreaming(streaming) {
  const btn=$('send-btn');
  if(!btn) return;
  btn.classList.toggle('is-stop',streaming);
  btn.title=streaming?'Arrêter':'Envoyer';
  btn.innerHTML=streaming
    ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z"/></svg>';
}

function handleSendButton() {
  if(isStreaming) stopStreaming();
  else sendMessage();
}

function stopStreaming() {
  streamAbortController?.abort();
}

function toggleSystemPrompt() {
  const drawer=$('system-prompt-drawer'), btn=$('system-drawer-btn');
  const open=!drawer.classList.contains('open');
  drawer.classList.toggle('open',open);
  drawer.setAttribute('aria-hidden',open?'false':'true');
  btn?.classList.toggle('active',open);
  if(open) setTimeout(()=>$('system-prompt')?.focus(),50);
}

function closeSystemPrompt() {
  const drawer=$('system-prompt-drawer'), btn=$('system-drawer-btn');
  drawer?.classList.remove('open');
  drawer?.setAttribute('aria-hidden','true');
  btn?.classList.remove('active');
}

function saveSystemPrompt() {
  localStorage.setItem(storageKey('mcpchat_system_prompt'), $('system-prompt').value);
}

function resetSystemPrompt() {
  $('system-prompt').value = DEFAULT_SYSTEM_PROMPT;
  saveSystemPrompt();
  notify('Instructions réinitialisées');
}

function currentSystemPrompt() {
  return ($('system-prompt')?.value || '').trim();
}

function newConversationId() {
  return \`conv_\${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}_\${Math.random().toString(36).slice(2,8)}\`;
}

function titleFromMessages(sourceMessages=messages) {
  const firstUser=sourceMessages.find(m=>m.role==='user' && m.content);
  const text=String(firstUser?.displayContent || firstUser?.content || 'Nouvelle discussion').replace(/\\s+/g,' ').trim();
  return text.length>54 ? text.slice(0,53).trimEnd()+'…' : text;
}

function activeServerSnapshot() {
  return servers.map(s=>({
    name:s.name,
    url:s.url,
    enabled:!!s.enabled,
    status:s.status,
    toolCount:Array.isArray(s.tools)?s.tools.length:0,
  }));
}

function collectToolHistory(sourceMessages=messages) {
  const out=[];
  for(const msg of sourceMessages) {
    if(Array.isArray(msg.tool_calls)) out.push(...msg.tool_calls.map(tc=>({type:'call',name:tc.function?.name||tc.name||'',id:tc.id||''})));
    if(msg.role==='tool') out.push({type:'result',name:msg.name||'',toolCallId:msg.tool_call_id||''});
  }
  return out;
}

function buildConversationPayload(snapshot={}) {
  const now=new Date().toISOString();
  const id=snapshot.id || currentConversationId || newConversationId();
  const sourceMessages=Array.isArray(snapshot.messages) ? snapshot.messages : messages;
  const existing=historySummaries.find(c=>c.id===id);
  return {
    id,
    title: titleFromMessages(sourceMessages),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    systemPrompt: snapshot.systemPrompt ?? currentSystemPrompt(),
    mcpServers: snapshot.mcpServers ?? activeServerSnapshot(),
    messages: sourceMessages,
    toolCalls: snapshot.toolCalls ?? collectToolHistory(sourceMessages),
    traceHtml: snapshot.traceHtml ?? [...document.querySelectorAll('.trace-card')].map(el=>el.outerHTML),
    messageHtml: snapshot.messageHtml ?? $('messages')?.innerHTML ?? '',
  };
}

async function persistConversationPayload(payload) {
  const method=historySummaries.some(c=>c.id===payload.id) ? 'PUT' : 'POST';
  const url=method==='PUT' ? \`/api/chat/history/\${encodeURIComponent(payload.id)}\` : '/api/chat/history';
  await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  await loadHistory();
}

async function saveCurrentConversation({immediate=false, force=false}={}) {
  if(!messages.length) return;
  if(!force && !conversationDirty) return;
  if(historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer=null;
  }
  const run=async()=>{
    try {
      const payload=buildConversationPayload();
      currentConversationId=payload.id;
      await persistConversationPayload(payload);
      conversationDirty=false;
    } catch(e) {
      console.warn('chat history save failed', e);
    }
  };
  if(immediate) await run();
  else historySaveTimer=setTimeout(run,500);
}

function scheduleConversationSave() {
  conversationDirty=true;
  saveCurrentConversation().catch(()=>{});
}

function historyMeta(item) {
  const date=new Date(item.updatedAt);
  const when=Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const tools=item.toolCallCount ? \` · \${item.toolCallCount} outil\${item.toolCallCount>1?'s':''}\` : '';
  return \`\${when}\${tools}\`;
}

function renderHistory() {
  const el=$('history-list');
  if(!el) return;
  if(!historySummaries.length) {
    el.innerHTML='<div class="history-empty">Aucun historique.</div>';
    return;
  }
  el.innerHTML=historySummaries.map(item=>\`
    <button class="history-item \${item.id===currentConversationId?'active':''}" onclick="loadConversation('\${esc(item.id)}')">
      <div class="history-main">
        <div class="history-title">\${esc(item.title||'Nouvelle discussion')}</div>
        <div class="history-meta">\${esc(historyMeta(item))}</div>
      </div>
      <span class="history-delete" onclick="deleteConversation(event,'\${esc(item.id)}')" title="Supprimer">×</span>
    </button>
  \`).join('');
}

async function loadHistory() {
  try {
    const res=await fetch('/api/chat/history');
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    historySummaries=await res.json();
    renderHistory();
  } catch(e) {
    console.warn('chat history load failed', e);
  }
}

function setEmptyChat() {
  $('messages').innerHTML=\`<div id="empty"><div class="em-icon">⬡</div><h2>MCP Chat</h2><p>Activez un serveur MCP, puis démarrez la conversation.</p></div>\`;
}

async function newConversation() {
  showChatView();
  if(messages.length) await saveCurrentConversation({immediate:true});
  currentConversationId=null;
  messages=[];
  conversationDirty=false;
  resetProductionState();
  setEmptyChat();
  renderHistory();
  $('chat-input')?.focus();
}

async function loadConversation(id) {
  showChatView();
  if(isStreaming) stopStreaming();
  const seq=++historyLoadSeq;
  const previousId=currentConversationId;
  if(previousId===id) {
    renderHistory();
  } else {
    const previousSnapshot=conversationDirty && previousId && messages.length
      ? buildConversationPayload({
          id:previousId,
          messages:messages.slice(),
          systemPrompt:currentSystemPrompt(),
          mcpServers:activeServerSnapshot(),
          toolCalls:collectToolHistory(messages),
          traceHtml:[...document.querySelectorAll('.trace-card')].map(el=>el.outerHTML),
          messageHtml:$('messages')?.innerHTML || '',
        })
      : null;
    currentConversationId=id;
    renderHistory();
    if(previousSnapshot) {
      try {
        await persistConversationPayload(previousSnapshot);
      } catch(e) {
        console.warn('chat history save failed', e);
      }
    }
  }
  try {
    const res=await fetch(\`/api/chat/history/\${encodeURIComponent(id)}\`);
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const conv=await res.json();
    if(seq!==historyLoadSeq) return;
    currentConversationId=conv.id;
    messages=Array.isArray(conv.messages) ? conv.messages : [];
    conversationDirty=false;
    if(conv.systemPrompt && $('system-prompt')) {
      $('system-prompt').value=conv.systemPrompt;
      saveSystemPrompt();
    }
    $('messages').innerHTML=conv.messageHtml || '';
    if(!$('messages').innerHTML.trim()) setEmptyChat();
    recoverProductionStateFromMessages();
    renderHistory();
    $('messages').scrollTop=$('messages').scrollHeight;
  } catch(e) {
    notify(\`Historique: \${e.message}\`,'e');
  }
}

async function deleteConversation(event, id) {
  event.stopPropagation();
  try {
    const res=await fetch(\`/api/chat/history/\${encodeURIComponent(id)}\`,{method:'DELETE'});
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    if(currentConversationId===id) {
      currentConversationId=null;
      messages=[];
      setEmptyChat();
    }
    await loadHistory();
  } catch(e) {
    notify(\`Suppression impossible: \${e.message}\`,'e');
  }
}

function buildLLMHeaders() {
  const key=$('api-key').value.trim();
  const h={'Content-Type':'application/json'};
  if(key) h['Authorization']=\`Bearer \${key}\`;
  return h;
}

function renderTopPills() {
  const el=$('tb-mcps');
  if(!el) return;
  el.innerHTML = servers
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
  if(!el) return;
  if(!servers.length) {
    el.innerHTML='<div style="padding:0 4px;font-size:12px;color:var(--muted)">Aucun serveur. Cliquez "+ Ajouter".</div>';
    return;
  }
  el.innerHTML=servers.map(s=>cardHTML(s)).join('');
}

function initPageMode() {
  const path=location.pathname.replace(/\\/+$/,'') || '/chat';
  const isConnectors=path==='/chat/connectors';
  document.body.classList.toggle('connectors-mode',isConnectors);
  $('connectors-link')?.classList.toggle('active',isConnectors);
  if(isConnectors) { renderCards(); renderSkillsManager(); }
}

function showConnectorsView(event) {
  event?.preventDefault();
  document.body.classList.add('connectors-mode');
  $('connectors-link')?.classList.add('active');
  renderCards();
  renderSkillsManager();
  if(location.pathname.replace(/\\/+$/,'')!=='/chat/connectors') {
    history.pushState(null,'','/chat/connectors');
  }
}

function showChatView() {
  document.body.classList.remove('connectors-mode');
  $('connectors-link')?.classList.remove('active');
  if(location.pathname.replace(/\\/+$/,'')==='/chat/connectors') {
    history.pushState(null,'','/chat');
  }
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
        <input type="checkbox" \${s.enabled&&s.status==='ok'?'checked':''} onchange="toggleServer(\${s.id},this.checked)">
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
      \${s.bearer
        ? '<span class="key-saved show" style="flex-shrink:0">token &#x2713;</span>'
        : s.injected
          ? '<span class="key-saved show" style="flex-shrink:0">token serveur &#x2713;</span>'
          : '<span style="font-size:10px;color:var(--muted);flex-shrink:0;font-family:var(--font-mono)">no auth</span>'}
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
  if (!res.ok) {
    const raw=await res.text().catch(()=>'');
    const authUrl=extractOAuthUrl(res,raw);
    if(authUrl) {
      openOAuthWindow(authUrl,server);
      throw new Error(\`Authentification requise pour \${server.name}. La page OAuth a été ouverte hors du chat.\`);
    }
    throw new Error(raw ? \`HTTP \${res.status}: \${raw.slice(0,180)}\` : \`HTTP \${res.status}\`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) return await readSSE(res);
  return await res.json();
}

function extractOAuthUrl(response, raw) {
  const candidates=[
    response.headers.get('location'),
    response.headers.get('www-authenticate'),
    raw,
  ].filter(Boolean).join('\\n');
  try {
    const data=raw ? JSON.parse(raw) : null;
    const direct=data?.authorizationUrl||data?.authorization_url||data?.authUrl||data?.auth_url||data?.url||data?.loginUrl||data?.login_url;
    if(typeof direct==='string' && /^https?:\\/\\//i.test(direct)) return direct;
  } catch {}
  const resourceMatch=candidates.match(/resource_metadata="?([^",\\s]+)"?/i);
  if(resourceMatch?.[1] && /^https?:\\/\\//i.test(resourceMatch[1])) return resourceMatch[1];
  const authMatch=candidates.match(/authorization_uri="?([^",\\s]+)"?/i) || candidates.match(/authorization_url="?([^",\\s]+)"?/i);
  if(authMatch?.[1] && /^https?:\\/\\//i.test(authMatch[1])) return authMatch[1];
  const urlMatch=candidates.match(/https?:\\/\\/[^\\s"'<>]+/i);
  return urlMatch?.[0] || '';
}

function openOAuthWindow(url, server) {
  const popup=window.open(url,'mcp-oauth','width=980,height=780');
  if(popup) {
    try { popup.opener=null; } catch {}
    notify(\`Auth OAuth ouverte pour \${server.name}. Revenez ici puis reconnectez le connecteur.\`);
  } else {
    notify(\`Popup bloquée pour \${server.name}. Ouvrez l'autorisation depuis le navigateur.\`,'e');
  }
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

// ── Suivi production ────────────────────────────────────────────────────────

function productionTerminal(status) {
  return ['done','failed','cancelled'].includes(String(status||''));
}

function isProductionPanelOpen() {
  return $('production-drawer')?.classList.contains('open') || false;
}

function shouldShowProductionButton(job) {
  const status=String(job?.status||'');
  if(isProductionPanelOpen()) return true;
  if(job && productionTerminal(status)) return false;
  return !!(productionState.jobId||job);
}

function parseProductionJSON(result) {
  const data=parseToolJSON(result);
  return data && typeof data==='object' ? data : null;
}

function resetProductionState() {
  if(productionState.pollTimer) clearTimeout(productionState.pollTimer);
  if(productionState.countdownTimer) clearInterval(productionState.countdownTimer);
  productionState={jobId:null,job:null,progress:null,logs:[],command:'',traceFile:'',pollTimer:null,countdownTimer:null,lastUpdatedAt:null};
  renderProductionPanel();
}

function extractProductionDetails(lines) {
  const out={command:'',traceFile:''};
  for(const line of lines||[]) {
    const cmd=String(line).match(/^\\[cmd\\]\\s+cwd=.*?\\s+(node\\s+.+)$/);
    if(cmd) out.command=cmd[1];
    const trace=String(line).match(/Trace file:\\s*(.+)$/);
    if(trace) out.traceFile=trace[1].trim();
  }
  return out;
}

function formatDuration(seconds) {
  const s=Math.max(0,Math.floor(Number(seconds)||0));
  const m=Math.floor(s/60), r=s%60;
  if(m<1) return \`\${r}s\`;
  const h=Math.floor(m/60), mm=m%60;
  return h ? \`\${h}h \${String(mm).padStart(2,'0')}m\` : \`\${m}m \${String(r).padStart(2,'0')}s\`;
}

function retryRemainingSeconds(progress) {
  const retryAt=progress?.retryAt ? Date.parse(progress.retryAt) : NaN;
  if(Number.isFinite(retryAt)) return Math.max(0,Math.ceil((retryAt-Date.now())/1000));
  const waitMs=Number(progress?.waitMs);
  const lastAt=progress?.lastEventAt ? Date.parse(progress.lastEventAt) : NaN;
  if(Number.isFinite(waitMs)&&Number.isFinite(lastAt)) return Math.max(0,Math.ceil((lastAt+waitMs-Date.now())/1000));
  return null;
}

function formatCountdown(seconds) {
  if(seconds===null) return '';
  const s=Math.max(0,Math.floor(seconds));
  const m=Math.floor(s/60), r=s%60;
  return m ? \`\${m}m \${String(r).padStart(2,'0')}s\` : \`\${r}s\`;
}

function syncProductionCountdown(progress) {
  const remaining=retryRemainingSeconds(progress);
  if(remaining!==null && remaining>0 && !productionState.countdownTimer) {
    productionState.countdownTimer=setInterval(()=>renderProductionPanel(),1000);
  }
  if((remaining===null || remaining<=0 || productionTerminal(productionState.job?.status)) && productionState.countdownTimer) {
    clearInterval(productionState.countdownTimer);
    productionState.countdownTimer=null;
  }
  return remaining;
}

function productionTargetLabel(job) {
  const templates=Array.isArray(job?.templates) ? job.templates : [];
  const deliverables=Array.isArray(job?.deliverables) ? job.deliverables : [];
  const targets=[...templates,...deliverables].filter(Boolean);
  if(targets.length) return targets.join(', ');
  return job?.jobId || 'job';
}

function productionStatusLabel(status) {
  const map={queued:'en attente',running:'en cours',done:'terminé',failed:'échec',cancelled:'annulé'};
  return map[status] || status || 'inconnu';
}

function setProductionPanelVisible(visible) {
  const drawer=$('production-drawer'), btn=$('production-panel-btn');
  if(!drawer) return;
  drawer.classList.toggle('open',!!visible);
  drawer.setAttribute('aria-hidden',visible?'false':'true');
  btn?.classList.toggle('active',!!visible);
}

function toggleProductionPanel(force) {
  const drawer=$('production-drawer');
  const next=typeof force==='boolean' ? force : !drawer?.classList.contains('open');
  setProductionPanelVisible(next);
  renderProductionPanel();
  if(next && productionState.jobId) pollProductionJob({immediate:true});
}

function renderProductionPanel() {
  const btn=$('production-panel-btn'), dot=$('production-panel-dot'), body=$('production-body'), subtitle=$('production-subtitle');
  const job=productionState.job;
  const progress=productionState.progress || {};
  const openDetails=new Set([...document.querySelectorAll('#production-body details.prod-details[open]')].map(d=>d.dataset.detail));
  if(btn) btn.classList.toggle('visible',shouldShowProductionButton(job));
  const status=String(job?.status||'');
  if(dot) dot.className=\`tb-production-dot \${esc(status)}\`;
  if(subtitle) subtitle.textContent=job ? \`\${productionStatusLabel(status)} · \${productionTargetLabel(job)}\` : 'Aucun job suivi.';
  if(!body) return;
  if(!job) {
    body.innerHTML=productionState.jobId
      ? \`<div class="prod-empty">Job \${esc(productionState.jobId)} détecté. Chargement du statut…</div>\`
      : '<div class="prod-empty">Aucun job production suivi dans cette discussion. Lance un build/export/polish ou demande un statut pour rouvrir ce panneau.</div>';
    return;
  }
  const steps=Array.isArray(job.steps) ? job.steps : [];
  const logs=productionState.logs||[];
  const details=extractProductionDetails([...(job.logTail||[]),...logs]);
  const command=productionState.command || details.command || '';
  const traceFile=productionState.traceFile || details.traceFile || '';
  const logHtml=logs.length
    ? logs.map(l=>\`<span class="prod-log-line \${String(l).trim()?'':'muted'}">\${esc(l)}</span>\`).join('')
    : '<span class="prod-log-line muted">Aucun log chargé.</span>';
  const percent=Number.isFinite(Number(progress.percent)) ? Math.max(0,Math.min(100,Number(progress.percent))) : null;
  const retrySeconds=syncProductionCountdown(progress);
  const retryText=retrySeconds!==null && retrySeconds>0 ? \`reprise dans \${formatCountdown(retrySeconds)}\` : null;
  const progressLabel=progress.label || productionTargetLabel(job);
  const sourceCount=Number(progress.sourceCount);
  const sourceIndex=Number(progress.sourceIndex);
  const sourceDoneCount=Number(progress.sourceDoneCount);
  const sourceProgress=Number.isFinite(sourceCount) && sourceCount>0
    ? Number.isFinite(sourceIndex)
      ? \`fichier \${Math.min(sourceCount,sourceIndex+1)}/\${sourceCount}\`
      : Number.isFinite(sourceDoneCount)
        ? \`\${Math.min(sourceCount,sourceDoneCount)}/\${sourceCount} fichiers traités\`
        : \`\${sourceCount} fichier\${sourceCount>1?'s':''}\`
    : null;
  const progressDetail=[
    progress.source ? \`fichier \${String(progress.source).split('/').pop()}\` : null,
    sourceProgress,
    progress.detail,
    progress.batchCount ? \`batch \${Number(progress.batchIndex ?? 0)+1}/\${progress.batchCount}\` : null,
    progress.instructionCount ? \`\${progress.instructionCount} instruction\${progress.instructionCount>1?'s':''}\` : null,
    retryText,
    progress.lastEvent ? \`dernier: \${progress.lastEvent}\` : null,
  ].filter(Boolean).join(' · ');
  body.innerHTML=\`
    <div class="prod-card">
      <div class="prod-status-row">
        <div class="prod-main">
          <div class="prod-kind">\${esc(job.type||'production')} · \${esc(productionTargetLabel(job))}</div>
          <div class="prod-sub">\${esc(job.jobId||'')}</div>
        </div>
        <div class="prod-badge \${esc(status)}">\${esc(productionStatusLabel(status))}</div>
      </div>
      <div class="prod-metrics">
        <div class="prod-metric"><div class="prod-metric-k">Durée</div><div class="prod-metric-v">\${esc(formatDuration(job.durationSeconds))}</div></div>
        <div class="prod-metric"><div class="prod-metric-k">Exit</div><div class="prod-metric-v">\${job.exitCode===null||job.exitCode===undefined?'—':esc(job.exitCode)}</div></div>
      </div>
      <div class="prod-progress">
        <div class="prod-progress-top">
          <div class="prod-progress-label">\${esc(progressLabel)}</div>
          <div class="prod-progress-percent">\${percent===null?'—':Math.round(percent)+'%'}</div>
        </div>
        <div class="prod-progress-track"><div class="prod-progress-bar" style="width:\${percent===null?0:percent}%"></div></div>
        <div class="prod-progress-detail">\${esc(progressDetail || 'Progression détaillée non disponible.')}</div>
      </div>
      <div class="prod-steps">\${steps.map(step=>\`
        <div class="prod-step">
          <span class="prod-step-dot \${esc(step.status||'')}"></span>
          <div class="prod-step-main">
            <div class="prod-step-name">\${esc(step.name||'step')}</div>
            <div class="prod-step-meta">\${esc(productionStatusLabel(step.status))}\${step.exitCode!==undefined?\` · exit \${esc(step.exitCode)}\`:''}</div>
          </div>
        </div>\`).join('')}</div>
    </div>
    <details class="prod-details" data-detail="command" open><summary>Commande courante</summary><div class="prod-details-body"><div class="prod-code">\${esc(command||'Commande non détectée pour le moment.')}</div></div></details>
    <details class="prod-details" data-detail="logs"><summary>Derniers logs</summary><div class="prod-details-body"><div class="prod-code">\${logHtml}</div></div></details>
    <div class="prod-card"><div class="prod-kind">Trace file</div><div class="prod-sub">\${esc(traceFile||'Trace file non détecté pour le moment.')}</div></div>
    \${job.error?\`<div class="prod-card"><div class="prod-kind" style="color:var(--err)">Erreur</div><div class="prod-sub">\${esc(job.error)}</div></div>\`:''}
  \`;
  for(const detail of openDetails) {
    const el=[...body.querySelectorAll('details.prod-details')].find(d=>d.dataset.detail===detail);
    if(el) el.open=true;
  }
}

function updateProductionFromPayload(payload, {open=false, poll=false}={}) {
  if(!payload) return;
  if(payload.jobId && !payload.job) productionState.jobId=payload.jobId;
  if(payload.job) {
    productionState.job=payload.job;
    productionState.jobId=payload.job.jobId || productionState.jobId;
    const details=extractProductionDetails(payload.logTail||[]);
    if(details.command) productionState.command=details.command;
    if(details.traceFile) productionState.traceFile=details.traceFile;
  }
  if(payload.progress) {
    productionState.progress=payload.progress;
    if(payload.progress.traceFile) productionState.traceFile=payload.progress.traceFile;
  }
  if(Array.isArray(payload.tail)) {
    productionState.logs=payload.tail;
    const details=extractProductionDetails(payload.tail);
    if(details.command) productionState.command=details.command;
    if(details.traceFile) productionState.traceFile=details.traceFile;
  }
  if(Array.isArray(payload.logTail) && !productionState.logs.length) {
    productionState.logs=payload.logTail;
  }
  productionState.lastUpdatedAt=new Date().toISOString();
  renderProductionPanel();
  if(open) setProductionPanelVisible(true);
  if(poll && productionState.jobId) startProductionPolling();
}

function handleProductionToolResult(fn, args, result, ok) {
  if(!String(fn||'').startsWith('production_')) return;
  const data=parseProductionJSON(result);
  if(!ok || !data) return;
  if(fn==='production_start_job' && data.jobId) {
    updateProductionFromPayload(data,{open:true,poll:false});
    pollProductionJob({immediate:true});
  }
  else if(fn==='production_job_status') updateProductionFromPayload(data,{open:true,poll:!productionTerminal(data.job?.status)});
  else if(fn==='production_job_logs') updateProductionFromPayload(data,{open:true,poll:false});
  else if(fn==='production_cancel_job') updateProductionFromPayload(data,{open:true,poll:false});
  else if(fn==='production_list_jobs' && Array.isArray(data.jobs) && data.jobs[0] && !productionState.jobId) {
    productionState.jobId=data.jobs[0].jobId;
    renderProductionPanel();
    setProductionPanelVisible(true);
  }
}

function startProductionPolling() {
  if(productionState.pollTimer) clearTimeout(productionState.pollTimer);
  productionState.pollTimer=setTimeout(()=>pollProductionJob(),4200);
}

async function pollProductionJob({immediate=false}={}) {
  if(!productionState.jobId) return;
  if(productionState.pollTimer) {
    clearTimeout(productionState.pollTimer);
    productionState.pollTimer=null;
  }
  try {
    const statusText=await callMCPTool('production_job_status',{jobId:productionState.jobId});
    updateProductionFromPayload(parseProductionJSON(statusText),{open:false,poll:false});
    const logsText=await callMCPTool('production_job_logs',{jobId:productionState.jobId,tail:120});
    updateProductionFromPayload(parseProductionJSON(logsText),{open:false,poll:false});
    await refreshProductionTraceProgress();
  } catch(e) {
    console.warn('production polling failed', e);
  }
  renderProductionPanel();
  if(!productionTerminal(productionState.job?.status)) startProductionPolling();
}

async function refreshProductionTraceProgress() {
  const traceFile=productionState.traceFile || productionState.progress?.traceFile;
  if(!traceFile) return;
  try {
    const res=await fetch(\`/api/production/trace?path=\${encodeURIComponent(traceFile)}\`);
    if(!res.ok) return;
    const trace=await res.json();
    if(!trace?.ok) return;
    productionState.progress={
      ...(productionState.progress||{}),
      traceFile,
      lastEvent:trace.lastEvent || productionState.progress?.lastEvent,
      lastEventAt:trace.lastEventAt || productionState.progress?.lastEventAt,
      waitMs:trace.waitMs,
      retryAt:trace.retryAt,
      detail:trace.lastEvent==='provider:throttle'
        ? 'Quota fournisseur atteint, reprise en attente'
        : productionState.progress?.detail,
    };
    renderProductionPanel();
  } catch(e) {
    console.warn('production trace refresh failed', e);
  }
}

function recoverProductionStateFromMessages() {
  resetProductionState();
  for(const msg of messages) {
    if(msg.role!=='tool' || !String(msg.name||'').startsWith('production_')) continue;
    handleProductionToolResult(msg.name,{},msg.content,true);
  }
  renderProductionPanel();
  if(productionState.jobId && !productionTerminal(productionState.job?.status)) startProductionPolling();
}

// ── Chat ────────────────────────────────────────────────────────────────────

function clearChat() {
  messages=[];
  currentConversationId=null;
  setEmptyChat();
  renderHistory();
}

function removeEmpty() { $('empty')?.remove(); }

function findSkillByName(name) {
  const wanted=String(name||'').toLowerCase();
  return (skillsCache||[]).find(s=>String(s.name||'').toLowerCase()===wanted) || null;
}

async function resolveSkillInvocation(text) {
  const match=/^\\/([A-Za-z0-9_-]+)(?:\\s+([\\s\\S]*))?$/.exec(String(text||'').trim());
  if(!match) return {displayText:text,sendText:text,skill:null};
  await fetchSkillsAc();
  const skill=findSkillByName(match[1]);
  if(!skill) return {displayText:text,sendText:text,skill:null};

  const args=String(match[2]||'').trim().split(/\\s+/).filter(Boolean);
  let body=String(skill.body||'').trim();
  if(Array.isArray(skill.params)) {
    for(const [i,param] of skill.params.entries()) {
      const value=args[i] || '';
      body=body.replaceAll(\`{\${param}}\`, value);
    }
  }
  if(!body) return {displayText:text,sendText:text,skill:null};
  return {
    displayText:text,
    sendText:body,
    skill:{name:skill.name,params:Array.isArray(skill.params)?skill.params:[]},
  };
}

function requestMessagesForLLM(sourceMessages) {
  return sourceMessages.map((msg)=>{
    if(msg.role==='user') return {role:'user',content:msg.content};
    if(msg.role==='assistant') {
      const out={role:'assistant',content:msg.content ?? null};
      if(Array.isArray(msg.tool_calls)) out.tool_calls=msg.tool_calls;
      return out;
    }
    if(msg.role==='tool') return {role:'tool',tool_call_id:msg.tool_call_id,name:msg.name,content:msg.content};
    return msg;
  });
}

async function copyMessage(btn) {
  const msg=btn.closest('.msg');
  const text=msg?.dataset.copy || msg?.querySelector('.bubble')?.innerText || '';
  if(!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent='Copié';
    setTimeout(()=>btn.textContent='Copier',1200);
  } catch {
    notify('Copie impossible','e');
  }
}

function appendMsg(role, content, toolCalls=null) {
  removeEmpty();
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className=\`msg \${role}\`;
  div.dataset.copy=content||'';
  const av=role==='user'?'<div class="av u">Vous</div>':'';
  const tc=toolCalls?.length ? toolCalls.map((c,i)=>tcBlockHTML(c,i)).join('') : '';
  const bodyHtml=role==='assistant' ? renderMd(content||'') : esc(content||'');
  div.innerHTML=\`\${av}<div class="msg-content"><div class="bubble">\${bodyHtml}\${tc}</div><div class="msg-actions"><button class="msg-action" onclick="copyMessage(this)">Copier</button></div></div>\`;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function createTraceCard() {
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className='trace-card empty';
  div.innerHTML='<div class="trace-head" onclick="toggleTrace(this)"><div class="trace-title"><span>Chaînage MCP</span><span class="trace-meta">0 appel</span></div><span class="trace-chevron">▾</span></div><div class="trace-body"><div class="trace-flow"></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return {el:div,steps:[]};
}

function toggleTrace(head) {
  const body=head.parentElement.querySelector('.trace-body');
  const chev=head.querySelector('.trace-chevron');
  const collapsed=body.classList.toggle('collapsed');
  if(chev) chev.textContent=collapsed?'▸':'▾';
}

function traceStepHTML(step) {
  const cls=['trace-tile',step.type,step.ok===false?'error':''].filter(Boolean).join(' ');
  const click=step.targetId ? \` onclick="scrollToTool('\${esc(step.targetId)}')"\` : '';
  return \`<div class="\${cls}"\${click}>
    <div class="trace-k">\${esc(step.kind)}</div>
    <div class="trace-v">\${esc(step.title)}</div>
    \${step.summary?\`<div class="trace-s">\${esc(step.summary)}</div>\`:''}
  </div>\`;
}

function renderTrace(trace) {
  if(!trace?.el) return;
  const flow=trace.el.querySelector('.trace-flow');
  const meta=trace.el.querySelector('.trace-meta');
  const toolCount=trace.steps.filter(s=>s.type==='tool').length;
  if(meta) meta.textContent=\`\${toolCount} appel\${toolCount>1?'s':''} · \${trace.steps.length} étape\${trace.steps.length>1?'s':''}\`;
  flow.innerHTML=trace.steps.map((s,i)=>traceStepHTML(s)+(i<trace.steps.length-1?'<div class="trace-link"></div>':'')).join('');
}

function addTraceStep(trace, step) {
  if(!trace) return;
  trace.steps.push(step);
  if(step.type==='tool') trace.el?.classList.remove('empty');
  renderTrace(trace);
}

function updateTraceStep(trace, targetId, patch) {
  if(!trace) return;
  const step=trace.steps.find(s=>s.targetId===targetId);
  if(step) Object.assign(step,patch);
  renderTrace(trace);
}

function scrollToTool(id) {
  const el=$(id);
  if(!el) return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  el.style.outline='2px solid var(--accent)';
  el.style.outlineOffset='2px';
  setTimeout(()=>{el.style.outline='';el.style.outlineOffset='';},1200);
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
      <span style="color:var(--accent);font-size:11px">⌁</span>
      \${src}
      <span class="tc-fn">\${esc(fn)}</span>
      <span class="tc-status"><span class="tc-st run" id="tc-st-\${idx}">…</span><span class="tc-expand" id="tc-exp-\${idx}">▾</span></span>
    </div>
    <div class="tc-body args-collapsed" id="tc-body-\${idx}">
      <button class="tc-args-toggle" type="button" onclick="toggleTCArgs(event,\${idx})">Afficher les arguments</button>
      <div class="tc-args">
        <div class="tc-lbl" style="margin-top:8px">Arguments</div>
        <pre>\${esc(args)}</pre>
      </div>
    </div>
  </div>\`;
}

function parseToolJSON(result) {
  if(typeof result !== 'string') return result;
  try { return JSON.parse(result); } catch { return null; }
}

function shortText(value, max=180) {
  const text=String(value||'').replace(/\\s+/g,' ').trim();
  return text.length>max ? text.slice(0,max-1).trimEnd()+'…' : text;
}

function uniqueCount(values) {
  return new Set((values||[]).filter(Boolean)).size;
}

function localDocHref(path) {
  const clean=String(path||'').trim().replace(/^\\/+/, '');
  if(!clean) return null;
  if(
    clean.startsWith('wiki/') ||
    clean.startsWith('templates/') ||
    clean.startsWith('deliverables/') ||
    clean.startsWith('build-context/') ||
    clean.startsWith('raw/ingested/')
  ) return '/' + clean;
  return null;
}

function docButtonHTML(path, label=path, chip=false) {
  const href=localDocHref(path);
  if(!href) return esc(label||path||'');
  const cls=chip?'tc-doc-chip':'tc-doc-btn';
  return \`<button type="button" class="\${cls}" onclick='openLocalDoc(\${JSON.stringify(href)},\${JSON.stringify(path)})' title="\${esc(path)}">\${esc(label||path)} ↗</button>\`;
}

function docChipRowHTML(paths, limit=3) {
  const unique=[...new Set((paths||[]).filter(p=>localDocHref(p)))];
  if(!unique.length) return '';
  const shown=unique.slice(0,limit);
  return \`<div class="tc-doc-chip-row">\${shown.map(p=>docButtonHTML(p,p,true)).join('')}\${unique.length>shown.length?\`<span class="tc-item-meta">+\${unique.length-shown.length}</span>\`:''}</div>\`;
}

function wikiResultItemHTML(item) {
  const title=(item.headingPath&&item.headingPath.length) ? item.headingPath.join(' / ') : item.path;
  const citeCount=uniqueCount(item.citations);
  const relatedCount=uniqueCount(item.relatedPaths);
  const meta=[
    item.type,
    typeof item.score==='number' ? \`score \${Math.round(item.score*100)/100}\` : null,
    citeCount ? \`\${citeCount} citation\${citeCount>1?'s':''}\` : null,
    relatedCount ? \`\${relatedCount} lien\${relatedCount>1?'s':''}\` : null,
  ].filter(Boolean).join(' · ');
  return \`<div class="tc-item">
    <div class="tc-item-title"><span>\${esc(title)}</span></div>
    <div class="tc-item-path">\${docButtonHTML(item.path)}</div>
    \${meta?\`<div class="tc-item-meta">\${esc(meta)}</div>\`:''}
    \${item.excerpt?\`<div class="tc-item-excerpt">\${esc(shortText(item.excerpt,220))}</div>\`:''}
    \${docChipRowHTML([...(item.relatedPaths||[]),...(item.citations||[])])}
  </div>\`;
}

async function openLocalDoc(href, label) {
  const modal=$('doc-modal'), title=$('doc-title'), content=$('doc-content'), open=$('doc-open');
  if(!modal||!content) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  title.textContent=label||href;
  open.href=href;
  content.innerHTML='<div class="typing"><span></span><span></span><span></span></div>';
  try {
    const res=await fetch(href,{headers:{Accept:'text/html'}});
    if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const text=await res.text();
    const doc=new DOMParser().parseFromString(text,'text/html');
    const article=doc.querySelector('article.article');
    content.innerHTML=article ? \`<article class="article">\${article.innerHTML}</article>\` : \`<article class="article">\${renderMd(text)}</article>\`;
  } catch(e) {
    content.innerHTML=\`<article class="article"><p style="color:var(--err)">Impossible de charger \${esc(label||href)}: \${esc(e.message)}</p></article>\`;
  }
}

function closeLocalDoc() {
  const modal=$('doc-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden','true');
}

function toolResultSummaryHTML(result, ok) {
  const raw=typeof result==='string'?result:JSON.stringify(result,null,2);
  if(!ok) {
    return \`<div class="tc-summary"><div class="tc-summary-head">Erreur tool</div><pre style="color:var(--err)">\${esc(raw)}</pre></div>\`;
  }
  const data=parseToolJSON(result);

  if(data?.results && Array.isArray(data.results)) {
    const shown=data.results.slice(0,6);
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>\${data.results.length} résultat\${data.results.length>1?'s':''}</span>
        <span class="tc-pill">search</span>
      </div>
      <div class="tc-list">\${shown.map(wikiResultItemHTML).join('')}</div>
      \${data.results.length>shown.length?\`<div class="tc-item-meta">+\${data.results.length-shown.length} autres résultats masqués</div>\`:''}
      <details class="tc-raw"><summary>JSON brut</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pages=Array.isArray(data.readPages) ? data.readPages : [];
    const shown=data.candidateResults.slice(0,5);
    const pagePaths=(data.readPagePaths||pages.map(p=>p.path)).filter(Boolean);
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>Contexte collecté</span>
        <span class="tc-pill">\${coverage.readPageCount ?? pagePaths.length} page\${(coverage.readPageCount ?? pagePaths.length)>1?'s':''} lue\${(coverage.readPageCount ?? pagePaths.length)>1?'s':''}</span>
        <span class="tc-pill">\${coverage.candidateCount ?? data.candidateResults.length} candidat\${(coverage.candidateCount ?? data.candidateResults.length)>1?'s':''}</span>
        \${coverage.truncatedPageCount?\`<span class="tc-pill">\${coverage.truncatedPageCount} tronquée\${coverage.truncatedPageCount>1?'s':''}</span>\`:''}
      </div>
      \${pagePaths.length?\`<div class="tc-item"><div class="tc-item-meta">Pages ouvertes</div><div class="tc-doc-chip-row">\${pagePaths.slice(0,8).map(p=>docButtonHTML(p,p,true)).join('')}\${pagePaths.length>8?'<span class="tc-item-meta">…</span>':''}</div></div>\`:''}
      <div class="tc-list">\${shown.map(wikiResultItemHTML).join('')}</div>
      <details class="tc-raw"><summary>JSON brut</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.pages && Array.isArray(data.pages)) {
    const shown=data.pages.slice(0,6);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${data.pages.length} page\${data.pages.length>1?'s':''}</span><span class="tc-pill">read</span></div>
      <div class="tc-list">\${shown.map(p=>\`<div class="tc-item">
        <div class="tc-item-title"><span>\${docButtonHTML(p.path,p.path||'page')}</span></div>
        <div class="tc-item-meta">\${p.found?'trouvée':'introuvable'}\${p.truncated?' · tronquée':''}</div>
        \${p.content?\`<div class="tc-item-excerpt">\${esc(shortText(p.content,260))}</div>\`:''}
        \${p.error?\`<div class="tc-item-excerpt">\${esc(p.error)}</div>\`:''}
      </div>\`).join('')}</div>
      <details class="tc-raw"><summary>JSON brut</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  return \`<div class="tc-summary">
    <div class="tc-summary-head"><span>Résultat</span></div>
    <pre>\${esc(shortText(raw,1800))}</pre>
    \${raw.length>1800?\`<details class="tc-raw"><summary>Voir tout</summary><pre>\${esc(raw)}</pre></details>\`:''}
  </div>\`;
}

function toolResultTraceSummary(result, ok) {
  if(!ok) return 'erreur';
  const data=parseToolJSON(result);
  if(data?.results && Array.isArray(data.results)) return \`\${data.results.length} résultat\${data.results.length>1?'s':''}\`;
  if(data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pages=coverage.readPageCount ?? (Array.isArray(data.readPages)?data.readPages.length:0);
    const candidates=coverage.candidateCount ?? data.candidateResults.length;
    return \`\${candidates} candidat\${candidates>1?'s':''} · \${pages} page\${pages>1?'s':''}\`;
  }
  if(data?.pages && Array.isArray(data.pages)) return \`\${data.pages.length} page\${data.pages.length>1?'s':''}\`;
  const text=typeof result==='string'?result:JSON.stringify(result);
  return shortText(text,70);
}

function derivedTraceStepsForTool(fn, result, ok, targetId) {
  if(!ok) return [];
  const data=parseToolJSON(result);
  if(fn==='wiki_collect_context' && data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pagePaths=(data.readPagePaths || (Array.isArray(data.readPages) ? data.readPages.map(p=>p.path) : [])).filter(Boolean);
    const steps=[];
    const readCount=coverage.readPageCount ?? pagePaths.length;
    if(readCount>0) {
      steps.push({
        type:'internal',
        kind:'Interne',
        title:'readPages',
        summary:\`\${readCount} page\${readCount>1?'s':''} lue\${readCount>1?'s':''}\`,
        targetId,
      });
    }
    const truncated=coverage.truncatedPageCount ?? 0;
    if(truncated>0) {
      steps.push({
        type:'internal',
        kind:'Couverture',
        title:'pages tronquées',
        summary:\`\${truncated} page\${truncated>1?'s':''}\`,
        targetId,
        ok:false,
      });
    }
    const rawCount=coverage.notReadRawSourceCount ?? (data.notReadRawSources?.length || 0);
    if(rawCount>0) {
      steps.push({
        type:'internal',
        kind:'Références',
        title:'raw non lues',
        summary:\`\${rawCount} source\${rawCount>1?'s':''}\`,
        targetId,
      });
    }
    return steps;
  }
  if(fn==='wiki_search_context' && data?.results && Array.isArray(data.results)) {
    const wikiCount=data.results.filter(r=>String(r.path||'').startsWith('wiki/')).length;
    return wikiCount ? [{
      type:'internal',
      kind:'Candidats',
      title:'pages candidates',
      summary:\`\${wikiCount} page\${wikiCount>1?'s':''}\`,
      targetId,
    }] : [];
  }
  if((fn==='wiki_read_pages' || fn==='wiki_read_page') && data?.pages && Array.isArray(data.pages)) {
    const found=data.pages.filter(p=>p.found).length;
    return [{
      type:'internal',
      kind:'Lecture',
      title:'pages ouvertes',
      summary:\`\${found}/\${data.pages.length} trouvée\${found>1?'s':''}\`,
      targetId,
    }];
  }
  return [];
}

function updateTC(idx, result, ok) {
  const st=$(\`tc-st-\${idx}\`), body=$(\`tc-body-\${idx}\`);
  if(st){st.textContent=ok?'✓':'!';st.className=\`tc-st \${ok?'ok':'er'}\`;}
  if(body){
    body.innerHTML+=\`<div class="tc-lbl" style="margin-top:8px">Résultat</div>\${toolResultSummaryHTML(result,ok)}\`;
    body.classList.add('hidden');
    const exp=$(\`tc-exp-\${idx}\`);
    if(exp) exp.textContent='▸';
  }
}

function toggleTC(idx) {
  const body=$(\`tc-body-\${idx}\`);
  const exp=$(\`tc-exp-\${idx}\`);
  if(!body) return;
  const hidden=body.classList.toggle('hidden');
  if(exp) exp.textContent=hidden?'▸':'▾';
}

function toggleTCArgs(event, idx) {
  event.stopPropagation();
  const body=$(\`tc-body-\${idx}\`);
  if(!body) return;
  const collapsed=body.classList.toggle('args-collapsed');
  event.currentTarget.textContent=collapsed?'Afficher les arguments':'Masquer les arguments';
}

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
  div.innerHTML='<div class="msg-content"><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div><div class="msg-actions"><button class="msg-action" onclick="copyMessage(this)">Copier</button></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function setStreamContent(div, text, extra='') {
  const bubble=div.querySelector('.bubble');
  if(!bubble) return;
  div.dataset.copy=text||'';
  const main=text ? renderMd(text) : (extra ? '' : '<div class="typing"><span></span><span></span><span></span></div>');
  bubble.innerHTML=main+extra;
  $('messages').scrollTop=$('messages').scrollHeight;
}

async function fetchStream(url, headers, body, onDelta, signal) {
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,stream:true}),signal});
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
  const resolved=await resolveSkillInvocation(text);
  const model=$('model-name').value.trim()||'gpt-4o';
  const parsedTemp=parseFloat($('temperature').value);
  const temp=Number.isFinite(parsedTemp) ? parsedTemp : 0.7;
  const useProxy=!!(window.__WIKI_CONFIG__);
  if(!useProxy && !$('base-url').value.trim()){notify('Entrez une Base URL','e');return;}

  input.value=''; input.style.height='auto';
  isStreaming=true; setSendButtonStreaming(true);
  streamAbortController = new AbortController();
  if(!currentConversationId) currentConversationId=newConversationId();
  messages.push({
    role:'user',
    content:resolved.sendText,
    ...(resolved.displayText!==resolved.sendText?{displayContent:resolved.displayText}:{}),
    ...(resolved.skill?{skill:resolved.skill}:{}),
  });
  appendMsg('user',resolved.displayText);
  scheduleConversationSave();
  const runTrace=createTraceCard();

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
      const systemPrompt=currentSystemPrompt();
      const langLine=languageInstruction();
      const sysContent=[systemPrompt,langLine].filter(Boolean).join('\\n\\n');
      const cleanMessages=requestMessagesForLLM(messages);
      const reqMessages=sysContent ? [{role:'system',content:sysContent},...cleanMessages] : cleanMessages;
      const reqBody={model,temperature:temp,messages:reqMessages,...(toolsPayload?{tools:toolsPayload,tool_choice:'auto'}:{})};
      streamDiv=createStreamBubble();
      const {content,toolCalls}=await fetchStream(llmUrl,llmHeaders,reqBody,t=>setStreamContent(streamDiv,t),streamAbortController.signal);
      if(streamAbortController.signal.aborted) break;

      if(toolCalls?.length) {
        const tcWithIdx=toolCalls.map((tc,i)=>({...tc,_domIdx:tcIdx+i}));
        const tcBlocks=tcWithIdx.map((tc,i)=>tcBlockHTML(tc,i)).join('');
        setStreamContent(streamDiv,content,tcBlocks);
        messages.push({role:'assistant',content:content||null,tool_calls:tcWithIdx.map(({_domIdx,...tc})=>tc)});
        for(const tc of tcWithIdx) {
          const fn=tc.function?.name||'?';
          const server=findServerForTool(fn);
          addTraceStep(runTrace,{
            type:'tool',
            kind:server?.name||'MCP',
            title:fn,
            summary:'appel en cours',
            targetId:\`tc-\${tc._domIdx}\`,
          });
        }
        const toolResults=await Promise.all(tcWithIdx.map(async (tc)=>{
          const domIdx=tc._domIdx;
          const fn=tc.function?.name;
          let args={}; try{args=JSON.parse(tc.function?.arguments||'{}');}catch{}
          try {
            const r=await callMCPTool(fn,args);
            updateTC(domIdx,r,true);
            handleProductionToolResult(fn,args,r,true);
            updateTraceStep(runTrace,\`tc-\${domIdx}\`,{summary:toolResultTraceSummary(r,true),ok:true});
            for(const step of derivedTraceStepsForTool(fn,r,true,\`tc-\${domIdx}\`)) addTraceStep(runTrace,step);
            return {tool_call_id:tc.id,role:'tool',name:fn,content:r};
          } catch(e) {
            updateTC(domIdx,e.message,false);
            handleProductionToolResult(fn,args,e.message,false);
            updateTraceStep(runTrace,\`tc-\${domIdx}\`,{summary:e.message,ok:false});
            return {tool_call_id:tc.id,role:'tool',name:fn,content:\`Erreur: \${e.message}\`};
          }
        }));
        tcIdx+=toolCalls.length;
        messages.push(...toolResults);
        conversationDirty=true;
        await saveCurrentConversation({immediate:true});
        streamDiv=null;
        if(streamAbortController.signal.aborted) break;
        continue;
      }

      setStreamContent(streamDiv,content);
      messages.push({role:'assistant',content});
      conversationDirty=true;
      await saveCurrentConversation({immediate:true});
      break;
    }
    if(turn>=MAX_TURNS) {
      appendMsg('assistant',\`⚠ Limite de chaînage atteinte (\${MAX_TURNS} tours).\`);
      await saveCurrentConversation({immediate:true});
    }
  } catch(err) {
    if(err.name==='AbortError') {
      if(streamDiv) {
        const partial=streamDiv.dataset.copy || 'Réponse arrêtée.';
        setStreamContent(streamDiv,partial);
        streamDiv.dataset.copy=partial;
        messages.push({role:'assistant',content:partial});
      } else {
        appendMsg('assistant','Réponse arrêtée.');
        messages.push({role:'assistant',content:'Réponse arrêtée.'});
      }
      conversationDirty=true;
      await saveCurrentConversation({immediate:true});
    } else {
      streamDiv?.remove();
      appendMsg('assistant',\`⚠ Erreur: \${err.message}\`);
      notify(err.message,'e');
      await saveCurrentConversation({immediate:true});
    }
  } finally {
    isStreaming=false;
    streamAbortController=null;
    setSendButtonStreaming(false);
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
  localStorage.setItem(storageKey('mcpchat_config'), JSON.stringify(cfg));
  if (cfg.apiKey) flashSaved('llm-saved');
}

// ── LocalStorage (user-added servers only) ──────────────────────────────────

function storageKey(key) {
  const scope = window.__WIKI_CONFIG__?.storageScope;
  return scope ? \`\${key}:\${scope}\` : key;
}

const LS = {USER_SERVERS: storageKey('mcpchat_user_servers')};

function saveServers() {
  const defaults = window.__WIKI_CONFIG__?.mcpServers || [];
  const data = servers.map(({id,name,url,bearer,enabled,status}) => {
    const injected = defaults.some(d => d.name === name);
    return {id,name,url,bearer:injected?'':(bearer||''),enabled:enabled&&status==='ok'};
  });
  localStorage.setItem(LS.USER_SERVERS, JSON.stringify(data));
}

async function restoreEnabledServers() {
  const toRestore=servers.filter(s=>s.enabled);
  if(!toRestore.length) {
    renderCards();
    renderTopPills();
    return;
  }
  renderCards();
  for(const server of toRestore) {
    await connectServer(server.id);
  }
}

function loadConfig() {
  const wc = window.__WIKI_CONFIG__;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey('mcpchat_config'))||'{}');
  } catch {}
  if (wc) {
    // Docker/proxy mode: /api/chat uses the server-side .wikirc.yaml config.
    // Do not reuse browser overrides from another workspace.
    if (wc.model) $('model-name').value = wc.model;
    if (wc.temperature !== undefined) $('temperature').value = String(wc.temperature);
    if (wc.baseUrl) { $('base-url').value = wc.baseUrl; $('base-url').readOnly = true; $('base-url').style.opacity = '.7'; }
    if (wc.apiKey)  { $('api-key').value = wc.apiKey;   $('api-key').readOnly = true;  $('api-key').style.opacity = '.7'; flashSaved('llm-saved'); }
  } else {
    // CLI mode: load from localStorage
    if (saved.baseUrl) $('base-url').value = saved.baseUrl;
    if (saved.apiKey)  { $('api-key').value = saved.apiKey; flashSaved('llm-saved'); }
    if (saved.model)   $('model-name').value = saved.model;
    if (saved.temp !== undefined) $('temperature').value = saved.temp;
  }
  $('system-prompt').value = localStorage.getItem(storageKey('mcpchat_system_prompt')) ?? DEFAULT_SYSTEM_PROMPT;
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
        const injected = !!override;
        servers.push({...s, url, bearer, injected, enabled:!!s.enabled, sessionId:null, status:'off', tools:[]});
        if(s.id >= nextId) nextId = s.id + 1;
      }
      renderCards();
      return;
    }
  } catch {}
  // No saved state (or stale) — seed from server config
  for (const s of defaults) {
    const id=nextId++;
    servers.push({id, name:s.name, url:s.url, bearer:s.bearer||'', injected:true, sessionId:null, enabled:false, status:'off', tools:[]});
  }
  renderCards(); saveServers();
}

// ── Init ────────────────────────────────────────────────────────────────────
loadConfig();
loadServers();
initPageMode();
loadHistory();
initSidebarSplitter();
renderProductionPanel();
restoreEnabledServers();
fetchSkillsAc();
window.addEventListener('popstate', initPageMode);
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
${CHAT_COMPONENT_CSS}
</style>
<script src="/assets/marked.min.js"></script>
</head>
<body>
${CHAT_BODY}
</body>
</html>`;
