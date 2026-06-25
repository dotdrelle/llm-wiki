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
.trace-flow{display:flex;align-items:stretch;gap:7px;row-gap:8px;flex-wrap:wrap;overflow-x:visible;padding:2px 0 4px}
.trace-tile{position:relative;flex:1 1 210px;min-width:180px;max-width:100%;border:1px solid var(--border);background:var(--panel);border-radius:13px;padding:7px 10px;cursor:default;text-align:left}
.trace-tile.tool{background:rgba(79,126,255,.08);border-color:rgba(79,126,255,.22);cursor:pointer}
.trace-tile.production{background:rgba(45,212,160,.07);border-color:rgba(45,212,160,.2);cursor:pointer}
.trace-tile.internal{background:rgba(127,127,127,.06);border-style:dashed}
.trace-tile.error{background:rgba(240,107,107,.08);border-color:rgba(240,107,107,.24)}
.trace-tile.final{background:rgba(45,212,160,.08);border-color:rgba(45,212,160,.24)}
.trace-tile.active{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.trace-tile.running,.trace-tile.done,.trace-tile.failed,.trace-tile.cancelled{padding-right:10px}
.trace-tile.running::before{content:'';position:absolute;top:-4px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--warn);animation:pulse 1s infinite;box-shadow:0 0 0 2px var(--bg)}
.trace-tile.done::before{content:'';position:absolute;top:-4px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 2px var(--bg)}
.trace-tile.failed::before,.trace-tile.cancelled::before{content:'';position:absolute;top:-4px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--err);box-shadow:0 0 0 2px var(--bg)}
.trace-k{font-family:var(--font-mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.trace-v{margin-top:2px;font-size:12px;font-weight:800;color:var(--text);overflow-wrap:anywhere;white-space:normal}
.trace-s{margin-top:1px;font-size:10px;line-height:1.35;color:var(--muted);overflow-wrap:anywhere;white-space:normal}
.trace-link{flex:0 0 auto;width:18px;height:1px;background:var(--border);position:relative}
.trace-link::after{content:'';position:absolute;right:0;top:-3px;border-left:5px solid var(--border);border-top:3.5px solid transparent;border-bottom:3.5px solid transparent}
.trace-detail{margin-top:10px;border:1px solid var(--border);border-radius:12px;background:var(--panel);padding:10px 11px}
.trace-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}
.trace-detail-title{min-width:0;font-size:13px;font-weight:850;color:var(--text);overflow-wrap:anywhere}
.trace-detail-meta{font-family:var(--font-mono);font-size:10px;color:var(--muted);overflow-wrap:anywhere;white-space:normal;text-align:right}
.trace-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:8px 0}
.trace-detail-cell{border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);padding:6px 8px;min-width:0}
.trace-detail-k{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.trace-detail-v{margin-top:2px;font-family:var(--font-mono);font-size:11px;color:var(--text);overflow-wrap:anywhere;white-space:normal}
.trace-detail-line{font-size:11px;line-height:1.45;color:var(--muted);overflow-wrap:anywhere}
.trace-detail-log{margin-top:8px;font-family:var(--font-mono);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--text);background:var(--panel-soft);border:1px solid var(--border);border-radius:8px;padding:8px;max-height:220px;overflow:auto}
.trace-tool-result{margin-top:8px}
@media (max-width: 720px){.msg.user .bubble{width:max-content;max-width:min(80vw,100%)}.trace-flow{align-items:stretch;flex-direction:column}.trace-link{width:1px;height:16px;margin-left:18px}.trace-link::after{right:-3px;top:auto;bottom:0;border-left:3.5px solid transparent;border-right:3.5px solid transparent;border-top:5px solid var(--border);border-bottom:0}.trace-tile{max-width:100%}.trace-detail-grid{grid-template-columns:1fr}}
.bubble p{margin:0 0 .6em}.bubble p:last-child{margin:0}
.bubble h1,.bubble h2,.bubble h3,.bubble h4{font-weight:700;margin:.8em 0 .3em;line-height:1.3}
.bubble h1{font-size:1.15em}.bubble h2{font-size:1.05em}.bubble h3,.bubble h4{font-size:.95em}
.bubble ul,.bubble ol{padding-left:1.4em;margin:.3em 0 .6em}.bubble li{margin:.2em 0}
.bubble code{font-family:var(--font-mono);font-size:.88em;background:var(--panel-deep);padding:1px 5px;border-radius:4px}
.bubble pre{background:var(--panel-deep);border-radius:8px;padding:10px 12px;margin:.5em 0;overflow-x:auto}
.bubble pre code{background:none;padding:0;font-size:.85em}
.bubble blockquote{border-left:3px solid var(--border);margin:.4em 0;padding:.2em .8em;color:var(--muted)}
.bubble .table-wrap{overflow-x:auto;max-width:100%;margin:.5em 0}
.bubble table{border-collapse:collapse;font-size:.9em;min-width:100%}
.bubble th,.bubble td{border:1px solid var(--border);padding:4px 9px;word-break:break-word;overflow-wrap:anywhere}
.bubble th{background:var(--panel-deep);font-weight:600;white-space:nowrap}
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
.tc-body pre,.tc-summary pre{background:var(--panel);border:1px solid var(--border);border-radius:9px;color:var(--text);white-space:pre-wrap;word-break:break-word;font-size:11px;max-height:220px;overflow:auto}
.tc-body.hidden{display:none}
.tc-summary{display:flex;flex-direction:column;gap:8px;min-width:0}
.tc-summary-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--text);font-family:var(--font-sans);font-size:12px;font-weight:700}
.tc-pill{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:99px;padding:2px 7px;color:var(--muted);font-family:var(--font-mono);font-size:10px;font-weight:500}
.tc-list{display:flex;flex-direction:column;gap:6px}
.tc-item{background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:8px 10px;font-family:var(--font-sans)}
.tc-item-title{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px;font-weight:700;color:var(--text);overflow-wrap:anywhere}
.tc-item-title span{min-width:0;overflow-wrap:anywhere}
.tc-item-path{font-family:var(--font-mono);font-size:10px;color:var(--accent);overflow-wrap:anywhere;white-space:normal}
.tc-doc-btn{display:inline;max-width:100%;background:none;border:none;color:var(--accent);font:inherit;cursor:pointer;padding:0;text-align:left;overflow-wrap:anywhere;white-space:normal}
.tc-doc-btn:hover{text-decoration:underline;text-underline-offset:2px}
.tc-doc-chip-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.tc-doc-chip{display:inline-flex;max-width:100%;align-items:center;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--accent);font-family:var(--font-mono);font-size:10px;line-height:1.35;padding:3px 7px;cursor:pointer;overflow-wrap:anywhere;white-space:normal;text-align:left}
.tc-doc-chip:hover{border-color:var(--accent)}
.tc-item-meta{margin-top:3px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.tc-item-excerpt{margin-top:5px;color:var(--muted2);font-size:12px;line-height:1.45;white-space:pre-wrap}
.tc-json-table-wrap{max-width:100%;overflow:auto}
.tc-json-table{width:100%;border-collapse:collapse;font-size:11px}
.tc-json-table th,.tc-json-table td{border:1px solid var(--border);padding:5px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:normal}
.tc-json-table th{background:var(--panel-soft);color:var(--muted);font-weight:700}
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
.attach-btn{background:transparent;border:1px solid var(--border);border-radius:50%;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted);transition:border-color .2s,color .2s,background .2s}
.attach-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--panel)}
.attach-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#send-btn{background:var(--text);border:none;border-radius:50%;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s,transform .2s,background .2s;color:var(--bg)}
#send-btn:hover{opacity:.82;transform:scale(1.04)}
#send-btn.is-stop{background:var(--text)}
#send-btn svg{width:16px;height:16px;fill:currentColor}
.input-hint{font-size:10px;color:var(--muted);text-align:center;margin-top:7px}
#notif{position:fixed;bottom:18px;right:18px;padding:10px 16px;border-radius:9px;font-size:12px;font-weight:600;opacity:0;transform:translateY(6px);transition:all .25s;pointer-events:none;z-index:999;box-shadow:0 4px 20px rgba(0,0,0,.22)}
#notif.show{opacity:1;transform:translateY(0)}
#notif.s{background:var(--panel);border:1px solid var(--ok);color:var(--ok)}
#notif.e{background:var(--panel);border:1px solid var(--err);color:var(--err)}
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
.prompt-drawer{position:fixed;top:44px;left:0;right:0;bottom:0;z-index:997;pointer-events:none}
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
.prod-progress-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:7px}
.prod-progress-label{min-width:0;flex:1;font-size:12px;font-weight:800;color:var(--text);line-height:1.35;overflow-wrap:anywhere}
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
.err-modal{position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center}
.err-modal.open{display:flex}
.err-modal .err-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px)}
.err-dialog{position:relative;background:var(--panel);border:1px solid rgba(240,107,107,.35);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);max-width:440px;width:calc(100% - 48px);padding:20px 22px}
.err-dialog-title{font-size:14px;font-weight:700;color:var(--err);margin:0 0 10px}
.err-dialog-msg{font-size:13px;line-height:1.55;color:var(--text);white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.err-dialog-foot{margin-top:16px;display:flex;justify-content:flex-end}
.err-dialog-foot button{background:var(--panel-soft);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:12px;padding:6px 14px;font-family:var(--font-sans)}
.err-dialog-foot button:hover{border-color:var(--accent);color:var(--accent)}
hr.divider{border:none;border-top:1px solid var(--border);margin:8px 12px}`;

const CHAT_BODY = `<nav id="app-nav" aria-label="Navigation application">
  <button class="app-nav-btn" type="button" onclick="toggleSidebar()" title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>
  <a class="app-nav-link" href="/" title="Back to wiki" aria-label="Back to wiki">Wiki</a>
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
        Conversations
        <button onclick="newConversation()">+ New</button>
      </div>
      <div class="history-list" id="history-list">
        <div class="history-empty">No history.</div>
      </div>
    </div>
    <div class="sb-resizer" id="sidebar-resizer" title="Redimensionner les panneaux"></div>
    <div class="sb-pane config-pane" id="config-pane">
      <div class="sec-label">Connectors</div>
      <a class="sb-link" id="connectors-link" href="/chat/connectors" onclick="showConnectorsView(event)"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/></svg> Connectors <span>MCP & skills</span></a>
      <div class="sec-label">LLM Config<button type="button" onclick="resetYamlConfig()">Reset</button></div>
      <div class="api-block">
        <div class="field">
          <label>Base URL</label>
          <input id="base-url" type="text" placeholder="http://localhost:11434/v1" onchange="saveConfig()">
        </div>
        <div class="field">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <label style="margin:0">API Key</label>
            <span class="key-saved" id="llm-saved">saved</span>
          </div>
          <div class="secret-wrap">
            <input id="api-key" type="password" placeholder="sk-… (leave empty for Ollama)" autocomplete="off" onchange="saveConfig()">
            <div class="secret-actions">
              <button class="secret-btn" id="reveal-btn-apikey" onclick="toggleReveal('api-key',this)" title="Show/hide">
                <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Model</label>
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
      <button class="tb-system" id="system-drawer-btn" onclick="toggleSystemPrompt()">System instructions</button>
      <button class="tb-clear" onclick="clearChat()">Clear</button>
    </div>
  </div>
  <div class="connectors-view" id="connectors-view">
    <div class="connectors-head">
      <div class="connectors-title">
        <h1>Connectors</h1>
        <p>Enable MCP endpoints and prepare your reusable skills for chat.</p>
      </div>
    </div>
    <section class="connectors-section">
      <div class="connectors-section-head">
        <div class="connectors-section-title">
          <h2>MCP Connectors</h2>
          <p>Enable available connectors, add your MCP endpoints, then return to chat to use their tools.</p>
        </div>
        <button class="connectors-add" type="button" onclick="addServer()">+ Add</button>
      </div>
      <div class="connectors-grid">
        <div class="mcp-cards" id="mcp-cards"></div>
      </div>
    </section>
    <section class="connectors-section">
      <div class="connectors-section-head">
        <div class="connectors-section-title">
          <h2>Skills</h2>
          <p>Create prepared prompts and insert them into chat with <strong>/</strong>.</p>
        </div>
        <button class="connectors-add" type="button" onclick="openSkillEditor()">+ New skill</button>
      </div>
      <div id="skills-manager-list"></div>
      <div class="skill-editor" id="skill-editor">
        <div class="skill-editor-title" id="skill-editor-title">New skill</div>
        <div class="skill-editor-row">
          <div>
            <label for="skill-name">Name</label>
            <input id="skill-name" type="text" placeholder="pipeline" autocomplete="off">
          </div>
          <div>
            <label for="skill-params">Parameters</label>
            <input id="skill-params" type="text" placeholder="space, template">
          </div>
        </div>
        <div>
          <label for="skill-desc">Description</label>
          <input id="skill-desc" type="text" placeholder="Run the full pipeline via the production agent">
        </div>
        <div>
          <label for="skill-body">Skill body</label>
          <textarea id="skill-body" placeholder="Check status, then run the requested job..."></textarea>
        </div>
        <div class="skill-editor-actions">
          <button class="skill-manager-btn" type="button" onclick="closeSkillEditor()">Cancel</button>
          <button class="skill-manager-btn" type="button" onclick="saveSkillFromEditor()">Save</button>
        </div>
      </div>
    </section>
  </div>
  <div id="messages">
    <div id="empty">
      <div class="em-icon">⬡</div>
      <h2>MCP Chat</h2>
      <p>Enable an MCP server, then start the conversation.</p>
    </div>
  </div>
  <div id="input-wrap">
    <div class="input-box">
      <div class="skill-ac" id="skill-ac"></div>
      <input id="doc-upload-input" type="file" hidden onchange="uploadSelectedDocument(this)">
      <textarea id="chat-input" rows="1" placeholder="Your message… (/ for skills)"
        oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
      <button class="attach-btn" type="button" onclick="openDocumentUpload()" title="Upload document" aria-label="Upload document">
        <svg viewBox="0 0 24 24"><path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7L9.2 18.2a2 2 0 0 1-2.8-2.8l9.2-9.2"/></svg>
      </button>
      <button id="send-btn" onclick="handleSendButton()" title="Envoyer">
        <svg viewBox="0 0 24 24"><path d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z"/></svg>
      </button>
    </div>
    <div class="input-hint">Enter to send · Shift+Enter for new line</div>
  </div>
</div>

<div id="notif"></div>
<div class="prompt-drawer" id="system-prompt-drawer" aria-hidden="true">
  <div class="prompt-backdrop" onclick="closeSystemPrompt()"></div>
  <aside class="prompt-panel" aria-label="System instructions">
    <div class="prompt-head">
      <div class="prompt-title">
        <h2>System instructions</h2>
        <p>Injected into the model on every call, without appearing in history.</p>
      </div>
      <button class="prompt-close" type="button" onclick="closeSystemPrompt()" title="Close">×</button>
    </div>
    <div class="prompt-body">
      <textarea id="system-prompt" spellcheck="false" onchange="saveSystemPrompt()" oninput="saveSystemPrompt()"></textarea>
      <div class="prompt-actions">
        <button type="button" onclick="resetSystemPrompt()">Reset</button>
      </div>
    </div>
  </aside>
</div>
<div class="doc-modal" id="doc-modal" aria-hidden="true">
  <div class="doc-backdrop" onclick="closeLocalDoc()"></div>
  <section class="doc-panel" role="dialog" aria-modal="true" aria-labelledby="doc-title">
    <div class="doc-head">
      <div class="doc-title" id="doc-title">Document</div>
      <a class="doc-open" id="doc-open" href="#" target="_blank" rel="noopener">Open</a>
      <button class="doc-close" type="button" onclick="closeLocalDoc()" title="Close">×</button>
    </div>
    <div class="doc-content" id="doc-content"></div>
  </section>
</div>
<div class="err-modal" id="err-modal" aria-hidden="true">
  <div class="err-backdrop" onclick="closeErrModal()"></div>
  <div class="err-dialog" role="dialog" aria-modal="true">
    <div class="err-dialog-title" id="err-modal-title">Error</div>
    <div class="err-dialog-msg" id="err-modal-msg"></div>
    <div class="err-dialog-foot"><button onclick="closeErrModal()">Close</button></div>
  </div>
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
let clearChatSeq = 0;
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
  trace: null,
  pollTimer: null,
  countdownTimer: null,
  lastUpdatedAt: null,
  notifiedTerminalJobIds: new Set(),
};
const DEFAULT_SYSTEM_PROMPT = \`You are an assistant connected to MCP servers.

When MCP tools are available, use them if the answer depends on external, recent, private, local, or tool-verifiable information.

After each tool result:
- assess whether the result is sufficient to answer;
- if the result is incomplete, ambiguous, truncated, or only exploratory, call another relevant tool before responding;
- status, list, and logs tools are observational: after one observational result, answer from it instead of chaining more observational calls unless the user explicitly asked to monitor or compare several statuses;
- do not claim to have read a complete source if the tool only returned an excerpt or a list of candidates;
- phrase tool queries in natural language; do not use search engine operators like OR or site: unless the tool explicitly requires them;
- request a small number of results initially (5 to 10) and increase only if coverage is insufficient.

llm-wiki specific rules:
- For synthesis, architecture, functional analysis, audit, or comparison questions, start with wiki_collect_context when it is available.
- Use readPages as the primary evidence.
- candidateResults and excerpts identify candidate pages — they are not sufficient alone to establish a complete answer.
- If readPages is empty, truncated, or insufficient, call wiki_read_page, wiki_read_pages, wiki_search_context, or wiki_read_ingested_source to improve coverage.
- Report coverage limitations when results are insufficient or truncated.

When multiple MCP servers are active, choose tools based on the domain of the question.

## Workspace Profile

The workspace profile is stored in .wiki/profile.md, next to the workspace system prompt.

Use it to adapt your behavior to the user and the workspace.

When the user asks to remember, persist, summarize, or update durable profile-related information, update .wiki/profile.md via the profile_update tool.

Keep the profile concise. If it becomes too long, summarize it into the ## Summary section.

Do not store secrets, credentials, API keys, passwords, temporary facts, or unnecessary private information.\`;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderInstructionRefs(html) {
  return String(html||'').replace(/\\[\\[([^\\]\\n]+)\\]\\]/g,(_,label)=>\`<span class="instruction-ref">[[\${esc(label.trim())}]]</span>\`);
}
function renderMd(t) {
  try {
    let html = typeof marked!=='undefined' ? marked.parse(t||'') : esc(t||'');
    html = String(html).split('<table').join('<div class="table-wrap"><table').split('</table>').join('</table></div>');
    return renderInstructionRefs(html);
  } catch { return renderInstructionRefs(esc(t||'')); }
}
const SIDEBAR_SPLIT_KEY = 'mcpchat_sidebar_history_height';
const traceRegistry = new Map();
let nextTraceId = 1;
const MCP_STALE_SESSION_MS = 5 * 60 * 1000;
const MCP_REQUEST_TIMEOUT_MS = 60 * 1000;

function languageInstruction() {
  const lang = window.__WIKI_CONFIG__?.language;
  if (!lang || lang === 'en') return '';
  let label = lang;
  try { label = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang; } catch {}
  return \`IMPORTANT: réponds toujours dans la langue configurée: \${lang} (\${label}). Après un appel d'outil, traduis et synthétise les informations utiles dans cette langue; ne conserve une autre langue que pour les noms propres, chemins, commandes, codes et citations exactes.\`;
}
function chatLanguageIsFrench() {
  return /^fr(?:-|$)/i.test(String(window.__WIKI_CONFIG__?.language || ''));
}
function chatText(en, fr) {
  return chatLanguageIsFrench() ? fr : en;
}
function notify(msg, type='s') {
  const el=$('notif'); el.textContent=msg; el.className=\`show \${type}\`;
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3200);
}
function openDocumentUpload() {
  $('doc-upload-input')?.click();
}
function formatBytes(bytes) {
  const value=Number(bytes);
  if(!Number.isFinite(value)||value<0) return null;
  const units=['B','KB','MB','GB'];
  let size=value;
  let unit=0;
  while(size>=1024&&unit<units.length-1) { size/=1024; unit++; }
  return \`\${size.toFixed(unit===0?0:1)} \${units[unit]}\`;
}
function uploadOutputLabel(outputPath) {
  const text=String(outputPath||'');
  const marker='/raw/untracked/';
  const index=text.indexOf(marker);
  if(index!==-1) return \`raw/untracked/\${text.slice(index+marker.length)}\`;
  return text;
}
function uploadMethodLabel(method) {
  const labels={
    'pdf-text': chatText('PDF text extraction','Extraction texte PDF'),
    'pdf-ocr': chatText('PDF OCR','OCR PDF'),
    'image-ocr': chatText('Image OCR','OCR image'),
    'docx-xml': chatText('DOCX text extraction','Extraction texte DOCX'),
    'libreoffice-pdf': chatText('Office conversion','Conversion Office'),
    'text': chatText('Text import','Import texte'),
  };
  return labels[method]||method||null;
}
function formatUploadProgressMessage(file, elapsedMs=0) {
  const elapsed=Math.max(0,Math.round(elapsedMs/1000));
  const size=formatBytes(file?.size);
  return [
    chatText('Document upload','Import de document'),
    '',
    \`\${chatText('File','Fichier')}: \${file?.name||'-'}\${size?\` (\${size})\`:''}\`,
    elapsed>0 ? \`\${chatText('Elapsed','Temps ecoule')}: \${elapsed}s\` : null,
    '',
    \`1. \${chatText('Store upload','Stockage')}: \${chatText('running','en cours')}\`,
    \`2. \${chatText('Convert','Conversion')}: \${chatText('pending','en attente')}\`,
    \`3. \${chatText('Write Markdown','Ecriture Markdown')}: \${chatText('pending','en attente')}\`,
    '',
    chatText(
      'Large files and OCR can take several minutes. Keep this tab open.',
      'Les gros fichiers et l OCR peuvent prendre plusieurs minutes. Gardez cet onglet ouvert.',
    ),
  ].filter(Boolean).join('\\n');
}
function formatUploadResultMessage(upload, fallbackFile, elapsedMs=0) {
  const converted=upload.status==='converted';
  const stored=upload.status==='stored';
  const failed=upload.status==='failed';
  const size=formatBytes(upload.bytes??fallbackFile?.size);
  const output=uploadOutputLabel(upload.outputPath);
  const method=uploadMethodLabel(upload.method);
  const elapsed=Math.max(0,Math.round(elapsedMs/1000));
  const status=converted
    ? chatText('Converted to Markdown','Converti en Markdown')
    : stored
      ? chatText('Stored, conversion pending','Stocke, conversion en attente')
      : failed
        ? chatText('Conversion failed','Conversion en echec')
        : upload.status||chatText('Unknown','Inconnu');
  return [
    chatText('Document ready','Document pret'),
    '',
    \`\${chatText('Status','Statut')}: \${status}\`,
    \`\${chatText('File','Fichier')}: \${upload.filename||fallbackFile?.name||'-'}\${size?\` (\${size})\`:''}\`,
    output ? \`\${chatText('Markdown','Markdown')}: \${output}\` : null,
    method ? \`\${chatText('Conversion','Conversion')}: \${method}\` : null,
    elapsed>0 ? \`\${chatText('Duration','Duree')}: \${elapsed}s\` : null,
    '',
    \`\${chatText('Upload id','Id upload')}: \${upload.id||'-'}\`,
    upload.error ? \`\${chatText('Note','Note')}: \${upload.error}\` : null,
    converted ? \`\\n\${chatText('Next step: run ingest to integrate this source into the wiki.','Suite: lancez ingest pour integrer cette source dans le wiki.')}\` : null,
  ].filter(Boolean).join('\\n');
}
async function uploadSelectedDocument(input) {
  const file=input?.files?.[0];
  if(!file) return;
  input.value='';
  const startedAt=Date.now();
  const status=appendMsg('assistant',formatUploadProgressMessage(file));
  const timer=setInterval(()=>setStreamContent(status,formatUploadProgressMessage(file,Date.now()-startedAt)),5000);
  try {
    const form=new FormData();
    form.append('file',file,file.name);
    const res=await fetch('/api/upload',{method:'POST',body:form});
    const data=await res.json().catch(()=>({ok:false,error:'Invalid upload response'}));
    if(!res.ok||data.ok===false) throw new Error(data.error||\`HTTP \${res.status}\`);
    const upload=data.upload||{};
    const converted=upload.status==='converted';
    setStreamContent(status,formatUploadResultMessage(upload,file,Date.now()-startedAt));
    notify(converted?'Document converted':'Document stored');
  } catch(err) {
    const message=err?.message||String(err);
    setStreamContent(status,[
      chatText('Document upload failed','Import de document en echec'),
      '',
      \`\${chatText('File','Fichier')}: \${file.name}\`,
      \`\${chatText('Error','Erreur')}: \${message}\`,
    ].join('\\n'));
    notify(message,'e');
  } finally {
    clearInterval(timer);
  }
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
    notify('Expected parameters: '+skill.params.map(p=>'{'+p+'}').join(', '),'s');
  }
}

function renderSkillsManager() {
  const el=$('skills-manager-list');
  if(!el) return;
  if(skillsCache===null) {
    el.innerHTML='<div class="skill-empty">Loading skills...</div>';
    fetchSkillsAc().then(renderSkillsManager);
    return;
  }
  const skills=skillsCache||[];
  if(!skills.length) {
    el.innerHTML='<div class="skill-empty">No skills. Create your first skill to make it available with / in chat.</div>';
    return;
  }
  el.innerHTML=\`<div class="skills-manager-grid">\${skills.map((s,i)=>\`
    <div class="skill-manager-card">
      <div class="skill-manager-name">/\${esc(s.name||'')}</div>
      \${s.description?\`<div class="skill-manager-desc">\${esc(s.description)}</div>\`:''}
      \${Array.isArray(s.params)&&s.params.length?\`<div class="skill-manager-params">\${s.params.map(p=>\`<span class="skill-manager-param">{\${esc(p)}}</span>\`).join('')}</div>\`:''}
      \${s.body?\`<div class="skill-manager-preview">\${esc(String(s.body).slice(0,180))}\${String(s.body).length>180?'...':''}</div>\`:''}
      <div class="skill-manager-actions">
        <button class="skill-manager-btn" type="button" onclick="openSkillEditor(\${i})">Edit</button>
        <button class="skill-manager-btn del" type="button" onclick="deleteSkillFromManager(\${i})">Delete</button>
      </div>
    </div>\`).join('')}</div>\`;
}

function openSkillEditor(idx=null) {
  const skill=Number.isInteger(idx) ? (skillsCache||[])[idx] : null;
  skillEditingName=skill?.name||null;
  $('skill-editor-title').textContent=skill ? \`Edit /\${skill.name}\` : 'New skill';
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
  if(!name){notify('Skill name is required.','e');return;}
  if(!body.trim()){notify('Skill body is required.','e');return;}
  try {
    const r=await fetch('/api/skills/'+encodeURIComponent(name),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({description,params,body}),
    });
    if(!r.ok) {
      let msg='Save failed';
      try{msg=(await r.json()).error||msg;}catch{}
      throw new Error(msg);
    }
    closeSkillEditor();
    await fetchSkillsAc(true);
    renderSkillsManager();
    notify('Skill saved');
  } catch(e) {
    notify(e.message||String(e),'e');
  }
}

async function deleteSkillFromManager(idx) {
  const skill=(skillsCache||[])[idx];
  if(!skill) return;
  if(!confirm(\`Delete skill /\${skill.name}?\`)) return;
  try {
    const r=await fetch('/api/skills/'+encodeURIComponent(skill.name),{method:'DELETE'});
    if(!r.ok) throw new Error('Deletion failed');
    await fetchSkillsAc(true);
    renderSkillsManager();
    notify('Skill deleted');
  } catch(e) {
    notify(e.message||String(e),'e');
  }
}
function toggleSidebar() { sidebarOpen=!sidebarOpen; $('sidebar').classList.toggle('collapsed',!sidebarOpen); }
function syncModel() { $('model-badge').textContent=$('model-name').value||'model'; }

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
  btn.title=streaming?'Stop':'Send';
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
  notify('Instructions reset');
}

function currentSystemPrompt() {
  return ($('system-prompt')?.value || '').trim();
}

function newConversationId() {
  return \`conv_\${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}_\${Math.random().toString(36).slice(2,8)}\`;
}

function titleFromMessages(sourceMessages=messages) {
  const firstUser=sourceMessages.find(m=>m.role==='user' && m.content);
  const text=String(firstUser?.displayContent || firstUser?.content || 'New conversation').replace(/\\s+/g,' ').trim();
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
  const tools=item.toolCallCount ? \` · \${item.toolCallCount} tool\${item.toolCallCount>1?'s':''}\` : '';
  return \`\${when}\${tools}\`;
}

function renderHistory() {
  const el=$('history-list');
  if(!el) return;
  if(!historySummaries.length) {
    el.innerHTML='<div class="history-empty">No history.</div>';
    return;
  }
  el.innerHTML=historySummaries.map(item=>\`
    <button class="history-item \${item.id===currentConversationId?'active':''}" onclick="loadConversation('\${esc(item.id)}')">
      <div class="history-main">
        <div class="history-title">\${esc(item.title||'New conversation')}</div>
        <div class="history-meta">\${esc(historyMeta(item))}</div>
      </div>
      <span class="history-delete" onclick="deleteConversation(event,'\${esc(item.id)}')" title="Delete">×</span>
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
  $('messages').innerHTML=\`<div id="empty"><div class="em-icon">⬡</div><h2>MCP Chat</h2><p>Enable an MCP server, then start the conversation.</p></div>\`;
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
    notify(\`History: \${e.message}\`,'e');
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
    notify(\`Deletion failed: \${e.message}\`,'e');
  }
}

function buildLLMHeaders() {
  const key=$('api-key').value.trim();
  const h={'Content-Type':'application/json'};
  if(key) h['Authorization']=\`Bearer \${key}\`;
  return h;
}

function buildProxyLLMHeaders() {
  const h={'Content-Type':'application/json'};
  const yaml=window.__WIKI_CONFIG__||{};
  const baseUrl=$('base-url').value.trim();
  const apiKey=$('api-key').value.trim();
  if(baseUrl && baseUrl!==yaml.baseUrl) h['X-LLM-Wiki-LLM-Base-Url']=baseUrl;
  if(apiKey && apiKey!==yaml.apiKey) h['X-LLM-Wiki-LLM-API-Key']=apiKey;
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
  if(!confirm('Delete this connector?')) return;
  servers=servers.filter(s=>s.id!==id);
  renderCards(); renderTopPills(); saveServers();
}

function renderCards() {
  const el=$('mcp-cards');
  if(!el) return;
  if(!servers.length) {
    el.innerHTML='<div style="padding:0 4px;font-size:12px;color:var(--muted)">No server. Click &quot;+ Add&quot;.</div>';
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
  const badgeLabel={ok:\`\${s.tools.length} tools\`,err:'error',loading:'…',off:'off'}[s.status]||'off';

  const toolsHTML = (s.status==='ok'&&s.tools.length)
    ? \`<div class="mcp-tools">
        <div class="mcp-tools-head" onclick="toggleTools(\${s.id})">
          <span>\${s.tools.length} tool\${s.tools.length>1?'s':''}</span>
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
      <input class="mcp-name-input" type="text" value="\${esc(s.name)}" placeholder="Name"
        onchange="servers.find(x=>x.id==\${s.id}).name=this.value;renderTopPills();saveServers()">
      <span class="mcp-badge \${badgeClass}">\${badgeLabel}</span>
    </div>
    <div class="mcp-url-row">
      <input type="text" value="\${esc(s.url)}" placeholder="http://localhost:3000/mcp/"
        onchange="servers.find(x=>x.id==\${s.id}).url=this.value;saveServers()" style="flex:1">
      <button class="btn-icon" onclick="connectServer(\${s.id})" title="Connect">&#x21BB;</button>
      <button class="btn-icon btn-del" onclick="removeServer(\${s.id})" title="Remove">&#x2715;</button>
    </div>
    <div class="mcp-bearer-row">
      <div class="secret-wrap" style="flex:1">
        <input type="password" value="\${esc(s.bearer||'')}" placeholder="Bearer token (optional)"
          autocomplete="off" style="padding-right:34px;font-size:11px"
          onchange="(function(el,id){const sv=servers.find(x=>x.id==id);if(!sv)return;sv.bearer=el.value;saveServers();if(sv.url)connectServer(id);})(this,\${s.id})">
        <div class="secret-actions">
          <button class="secret-btn" onclick="toggleReveal(this.closest('.secret-wrap').querySelector('input'),this)" title="Show/hide">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      \${s.bearer
        ? (s.status==='err'
          ? '<span class="key-saved show" style="flex-shrink:0;background:rgba(192,57,43,.12);color:var(--err)">token &#x2717;</span>'
          : '<span class="key-saved show" style="flex-shrink:0">token &#x2713;</span>')
        : s.injected
          ? '<span class="key-saved show" style="flex-shrink:0">server token &#x2713;</span>'
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(mcpProxyUrl(server), {method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal});
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) server.sessionId = sid;
    server.lastMcpActivityAt = Date.now();
    if (!res.ok) {
      const raw=await res.text().catch(()=>'');
      if(res.status===401) {
        const authUrl=extractOAuthUrl(res,raw);
        if(authUrl) {
          openOAuthWindow(authUrl,server);
          throw new Error(\`Authentication required for \${server.name}. The OAuth page has been opened outside of chat.\`);
        }
      }
      const err=new Error(raw ? \`HTTP \${res.status}: \${raw.slice(0,180)}\` : \`HTTP \${res.status}\`);
      err.status=res.status;
      err.raw=raw;
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('text/event-stream') ? await readSSE(res) : await res.json();
  } catch(err) {
    const e = new Error(err?.name==='AbortError' ? \`MCP timeout after \${Math.round(MCP_REQUEST_TIMEOUT_MS/1000)}s\` : (err?.message || String(err)));
    e.raw = e.message;
    e.status = err?.status;
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function mcpSessionIsStale(server) {
  if(!server?.sessionId) return false;
  const last=Number(server.lastMcpActivityAt || 0);
  return !last || Date.now() - last > MCP_STALE_SESSION_MS;
}

function isMcpSessionOrNetworkFailure(err) {
  const status=err?.status;
  const text=String(err?.raw || err?.message || err || '');
  return status===400 || status===404 || status===409 || status===410 || status===502 || status===503 ||
    /session|mcp-session-id|no valid session|not found|fetch failed|timeout|aborted|terminated|socket|econnreset|econnrefused|und_err/i.test(text);
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
    notify(\`OAuth auth opened for \${server.name}. Come back here then reconnect the connector.\`);
  } else {
    notify(\`Popup blocked for \${server.name}. Open the authorization from the browser.\`,'e');
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
  if(!s.url) { notify('Missing URL','e'); return; }
  s.status='loading'; s.sessionId=null; renderCards();
  try {
    await reconnectMCPServer(s);
    notify(\`✓ \${s.name}: \${s.tools.length} tool(s)\`);
  } catch(err) {
    s.status='err'; s.enabled=false;
    showErrModal(\`MCP connection — \${s.name}\`, mcpConnectErrorMessage(err));
  }
  renderCards(); renderTopPills(); saveServers();
}

async function reconnectMCPServer(server) {
  server.sessionId=null;
  const initResp = await mcpRPC(server, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {name: 'MCPChat', version: '1.0'}
  });
  if (initResp?.error) throw new Error(initResp.error.message || 'initialize failed');
  await mcpNotify(server, 'notifications/initialized', {});

  const toolsResp = await mcpRPC(server, 'tools/list');
  if (toolsResp?.error) throw new Error(toolsResp.error.message || 'tools/list failed');
  server.tools = toolsResp?.result?.tools || [];
  server.status='ok';
  server.enabled=true;
  server.lastMcpActivityAt=Date.now();
}

async function callMCPTool(name, args) {
  const server=findServerForTool(name);
  if(!server) throw new Error(\`No active MCP server for "\${name}"\`);
  let resp;
  try {
    if(mcpSessionIsStale(server)) {
      notify(\`\${server.name}: inactive MCP session, reconnecting...\`);
      await reconnectMCPServer(server);
      renderCards(); renderTopPills(); saveServers();
    }
    resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
  } catch(err) {
    if(!isMcpSessionOrNetworkFailure(err)) throw err;
    notify(\`\${server.name}: reconnecting MCP...\`);
    await reconnectMCPServer(server);
    renderCards(); renderTopPills(); saveServers();
    resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
  }
  if (resp?.error && isMcpSessionOrNetworkFailure(resp.error)) {
    notify(\`\${server.name}: expired MCP session, reconnecting...\`);
    await reconnectMCPServer(server);
    renderCards(); renderTopPills(); saveServers();
    resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
  }
  if (resp?.error) throw new Error(resp.error.message || 'Tool call error');
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

function parseProductionJSON(result) {
  const data=parseToolJSON(result);
  return data && typeof data==='object' ? data : null;
}

function resetProductionState() {
  if(productionState.pollTimer) clearTimeout(productionState.pollTimer);
  if(productionState.countdownTimer) clearInterval(productionState.countdownTimer);
  productionState={jobId:null,job:null,progress:null,logs:[],command:'',traceFile:'',trace:null,pollTimer:null,countdownTimer:null,lastUpdatedAt:null,notifiedTerminalJobIds:new Set()};
  renderProductionTrace();
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
    productionState.countdownTimer=setInterval(()=>renderProductionTrace(),1000);
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
  const map={queued:'pending',running:'running',done:'done',failed:'failed',cancelled:'cancelled'};
  return map[status] || status || 'unknown';
}

function productionChatStatusLabel(status) {
  if(!chatLanguageIsFrench()) return productionStatusLabel(status);
  const map={queued:'en attente',running:'en cours',done:'terminée',failed:'échouée',cancelled:'annulée'};
  return map[status] || status || 'inconnue';
}

function isProductionToolName(name) {
  return String(name||'').startsWith('production_');
}

function toolCallFunctionName(tc) {
  return String(tc?.function?.name || tc?.name || '');
}

function toolCallArgsObject(tc) {
  try { return JSON.parse(tc?.function?.arguments || '{}'); } catch { return {}; }
}

function stableToolArgsKey(value) {
  if(Array.isArray(value)) return '['+value.map(stableToolArgsKey).join(',')+']';
  if(value && typeof value==='object') {
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableToolArgsKey(value[k])).join(',')+'}';
  }
  return JSON.stringify(value);
}

function toolCallRepeatKey(tc) {
  return \`\${toolCallFunctionName(tc)}:\${stableToolArgsKey(toolCallArgsObject(tc))}\`;
}

function isPossiblyTruncatedToolResult(data, raw='') {
  const text=String(raw||'');
  if(/\\b(stdout_tail|stderr_tail|tail|truncated)\\b/i.test(text)) return true;
  if(data && typeof data==='object') {
    if(data.truncated === true || data.isTruncated === true) return true;
    if(data.coverage?.truncatedPageCount > 0) return true;
    if(data.stdout_tail || data.stderr_tail) return true;
  }
  return false;
}

function scalarSummaryBits(data, limit=5) {
  if(!data || typeof data!=='object' || Array.isArray(data)) return [];
  return Object.entries(data)
    .filter(([,value])=>value===null || ['string','number','boolean'].includes(typeof value))
    .slice(0,limit)
    .map(([key,value])=>\`\${key}: \${shortText(value,80)}\`);
}

function observerResultSummary(r) {
  const raw=typeof r.content==='string' ? r.content : JSON.stringify(r.content,null,2);
  const data=parseToolJSON(r.content);
  const warnings=isPossiblyTruncatedToolResult(data,raw)
    ? [chatText('result may be partial/truncated','résultat possiblement partiel/tronqué')]
    : [];
  if(data?.job || data?.jobId || (data?.jobs && Array.isArray(data.jobs))) {
    return [productionToolSummary([r]),...warnings].filter(Boolean).join('\\n');
  }
  if(data?.sources && Array.isArray(data.sources)) {
    const sourceLines=data.sources.slice(0,12).map((source,i)=>{
      const name=source?.name || source?.id || source?.source || source?.path || source?.url || \`source \${i+1}\`;
      const meta=[source?.type,source?.status,source?.path,source?.url].filter(Boolean).map(v=>shortText(v,70)).join(' · ');
      return \`- \${name}\${meta ? \` — \${meta}\` : ''}\`;
    });
    const more=data.sources.length>sourceLines.length ? [\`- +\${data.sources.length-sourceLines.length} \${chatText('more source(s)','source(s) en plus')}\`] : [];
    const header=chatLanguageIsFrench()
      ? \`\${data.sources.length} source\${data.sources.length>1?'s':''} CME configurée\${data.sources.length>1?'s':''}.\`
      : \`\${data.sources.length} CME source\${data.sources.length>1?'s':''} configured.\`;
    return [header,...sourceLines,...more,...warnings].join('\\n');
  }
  if(Array.isArray(data)) {
    const shown=data.slice(0,8).map((item)=>\`- \${shortText(typeof item==='object' ? JSON.stringify(item) : item,140)}\`);
    return [\`\${data.length} item\${data.length>1?'s':''}.\`,...shown,...warnings].join('\\n');
  }
  if(data && typeof data==='object') {
    const bits=scalarSummaryBits(data,6);
    const arrayBits=Object.entries(data)
      .filter(([,value])=>Array.isArray(value))
      .slice(0,4)
      .map(([key,value])=>\`\${key}: \${value.length}\`);
    const lines=[...bits,...arrayBits].map(bit=>\`- \${bit}\`);
    return [\`\${r.name}: \${toolResultTraceSummary(r.content,true)}\`,...lines,...warnings].filter(Boolean).join('\\n');
  }
  return \`\${r.name}: \${shortText(raw,500)}\${warnings.length ? \`\\n- \${warnings[0]}\` : ''}\`;
}

function isObserverToolName(name) {
  const fn=String(name||'');
  return /(?:^|_)(status|list|logs?|history|trace|summary|stats)$/i.test(fn) ||
    /(?:^|_)list_/i.test(fn) ||
    /^cme_(?:status|sources_list|export_status)$/i.test(fn) ||
    /^production_(?:list_jobs|job_status|job_logs)$/i.test(fn);
}

function observerToolLoopSummary(toolResults, repeated=false) {
  const names=[...new Set((toolResults||[]).map(r=>r.name).filter(Boolean))];
  const prefix=repeated
    ? chatText('Observation chain stopped after repeated status/list calls.','Chaînage d’observation arrêté après des appels status/list répétés.')
    : chatText('Observation complete.','Observation terminée.');
  const details=(toolResults||[]).map(observerResultSummary).filter(Boolean);
  return [prefix,names.length?\`\${chatText('Tools:','Outils :')} \${names.join(', ')}\`:null,...details]
    .filter(Boolean)
    .join('\\n');
}

function shouldStopAfterProductionTools(toolCalls) {
  if(!toolCalls?.length || !toolCalls.every(tc=>isProductionToolName(toolCallFunctionName(tc)))) return false;
  return toolCalls.some(tc=>[
    'production_start_job',
    'production_job_status',
    'production_job_logs',
    'production_cancel_job',
  ].includes(toolCallFunctionName(tc)));
}

function productionProgressDetail(job, progress) {
  const sourceCount=Number(progress?.sourceCount);
  const sourceIndex=Number(progress?.sourceIndex);
  const sourceDoneCount=Number(progress?.sourceDoneCount);
  const retrySeconds=syncProductionCountdown(progress);
  const retryText=retrySeconds!==null && retrySeconds>0 ? \`retry in \${formatCountdown(retrySeconds)}\` : null;
  const sourceProgress=Number.isFinite(sourceCount) && sourceCount>0
    ? Number.isFinite(sourceIndex)
      ? \`file \${Math.min(sourceCount,sourceIndex+1)}/\${sourceCount}\`
      : Number.isFinite(sourceDoneCount)
        ? \`\${Math.min(sourceCount,sourceDoneCount)}/\${sourceCount} files processed\`
        : \`\${sourceCount} file\${sourceCount>1?'s':''}\`
    : null;
  return [
    progress?.source ? \`file \${String(progress.source).split('/').pop()}\` : null,
    sourceProgress,
    progress?.detail,
    progress?.batchCount ? \`batch \${Number(progress.batchIndex ?? 0)+1}/\${progress.batchCount}\` : null,
    progress?.instructionCount ? \`\${progress.instructionCount} instruction\${progress.instructionCount>1?'s':''}\` : null,
    retryText,
    progress?.lastEvent ? \`last: \${progress.lastEvent}\` : null,
    job?.error ? \`error: \${job.error}\` : null,
  ].filter(Boolean).join(' · ');
}

function productionStepDetail(step, job, progress) {
  const logs=productionState.logs||[];
  const details=extractProductionDetails([...(job?.logTail||[]),...logs]);
  const command=productionState.command || details.command || '';
  const traceFile=productionState.traceFile || details.traceFile || progress?.traceFile || '';
  const status=String(step?.status||job?.status||'');
  const percent=Number.isFinite(Number(progress?.percent)) ? Math.max(0,Math.min(100,Number(progress.percent))) : null;
  const logLines=logs.length ? logs.slice(-80).join('\\n') : 'No logs loaded.';
  return {
    title: progress?.phase || step?.name || job?.type || 'production',
    status,
    duration: formatDuration(step?.durationSeconds ?? job?.durationSeconds),
    exitCode: step?.exitCode ?? job?.exitCode,
    percent,
    detail: productionProgressDetail(job, progress || {}),
    command,
    traceFile,
    logs: logLines,
    error: job?.error || '',
  };
}

function renderProductionTrace() {
  const trace=productionState.trace;
  if(!trace) return;
  const job=productionState.job;
  const progress=productionState.progress || {};
  if(!job && !productionState.jobId) return;
  const steps=Array.isArray(job?.steps) && job.steps.length ? job.steps : [{name:job?.type||'production',status:job?.status||'queued'}];
  steps.forEach((step,index)=>{
    const id=\`prod-\${productionState.jobId||job?.jobId||'job'}-\${step.name||index}\`.replace(/[^a-zA-Z0-9_-]/g,'-');
    const detail=productionStepDetail(step,job,progress);
    const status=String(detail.status||'');
    const percentText=detail.percent===null ? '' : \` · \${Math.round(detail.percent)}%\`;
    const patch={
      id,
      type:'production',
      kind:'Production',
      title:progress?.phase||step.name||job?.type||'production',
      summary:\`\${productionStatusLabel(status)}\${percentText}\`,
      status,
      ok: status==='failed' || status==='cancelled' ? false : true,
      detail,
    };
    dispatchChatAgentEvent(trace,'trace_step_upsert',{
      origin:'poll',
      payload:{step:patch},
    });
  });
  if(!trace.selectedStepId) {
    const running=trace.steps.find(s=>s.type==='production' && ['running','queued'].includes(String(s.status||'')));
    if(running) trace.selectedStepId=running.id;
  }
}

function updateProductionFromPayload(payload, {open=false, poll=false}={}) {
  if(!payload) return;
  if(payload.jobId && !payload.job) productionState.jobId=payload.jobId;
  if(payload.job) {
    productionState.job=payload.job;
    if(Array.isArray(payload.producedFiles)) productionState.job.producedFiles=payload.producedFiles;
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
  renderProductionTrace();
  if(poll && productionState.jobId) startProductionPolling();
}

function handleProductionToolResult(fn, args, result, ok, {recover=false}={}) {
  if(!String(fn||'').startsWith('production_')) return;
  const data=parseProductionJSON(result);
  if(!ok || !data) return;
  if(fn==='production_start_job' && data.jobId) {
    updateProductionFromPayload(data,{open:false,poll:false});
    if(!recover) pollProductionJob({immediate:true});
  }
  else if(fn==='production_job_status') updateProductionFromPayload(data,{open:false,poll:!recover && !productionTerminal(data.job?.status)});
  else if(fn==='production_job_logs') updateProductionFromPayload(data,{open:false,poll:false});
  else if(fn==='production_cancel_job') updateProductionFromPayload(data,{open:false,poll:false});
  else if(fn==='production_list_jobs' && Array.isArray(data.jobs) && data.jobs[0] && !productionState.jobId) {
    productionState.jobId=data.jobs[0].jobId;
    renderProductionTrace();
  }
}

function productionToolSummary(toolResults) {
  const parsed=toolResults.map(r=>parseProductionJSON(r.content)).filter(Boolean);
  const latestWithJob=[...parsed].reverse().find(d=>d.job);
  const latestJob=latestWithJob?.job;
  const started=[...parsed].reverse().find(d=>d.jobId && d.status);
  const busy=[...parsed].reverse().find(d=>d.error==='workspace_busy');
  const listed=[...parsed].reverse().find(d=>Array.isArray(d.jobs));
  if(busy) {
    return chatLanguageIsFrench()
      ? \`Production déjà en cours : job \${busy.activeJobId || 'actif'}. Le suivi est dans le chaînage.\`
      : \`Production already running: job \${busy.activeJobId || 'active'}. Tracking in the chain view.\`;
  }
  if(latestJob) {
    if(productionTerminal(latestJob.status)) {
      const jobId=latestJob.jobId || latestWithJob.jobId || productionState.jobId;
      if(jobId) productionState.notifiedTerminalJobIds.add(jobId);
      return productionTerminalChatSummary(latestJob);
    }
    const status=productionChatStatusLabel(latestJob.status);
    const target=productionTargetLabel(latestJob);
    const progress=latestWithJob.progress?.percent;
    const progressText=Number.isFinite(Number(progress)) ? \` · \${Math.round(Number(progress))}%\` : '';
    const suffix=productionTerminal(latestJob.status)
      ? latestJob.status==='failed' && latestJob.error
        ? chatLanguageIsFrench() ? \` Erreur : \${latestJob.error}\` : \` Error: \${latestJob.error}\`
        : ''
      : chatText(' Tracking in the chain view.',' Le suivi est dans le chaînage.');
    return \`Production \${status}: \${target}\${progressText}.\${suffix}\`;
  }
  if(started) {
    return chatLanguageIsFrench()
      ? \`Production démarrée : job \${started.jobId} (\${productionChatStatusLabel(started.status)}). Le suivi est dans le chaînage.\`
      : \`Production started: job \${started.jobId} (\${productionChatStatusLabel(started.status)}). Tracking in the chain view.\`;
  }
  if(listed) {
    if(chatLanguageIsFrench()) {
      return listed.jobs.length
        ? \`\${listed.jobs.length} job\${listed.jobs.length>1?'s':''} de production trouvé\${listed.jobs.length>1?'s':''}. Le chaînage suit le job actif s'il est disponible.\`
        : 'Aucun job de production récent.';
    }
    return listed.jobs.length
      ? \`\${listed.jobs.length} production job\${listed.jobs.length>1?'s':''} found. Chaining tracks the active job if available.\`
      : 'No recent production job.';
  }
  return chatText('Production action executed. Chaining updated.','Action de production exécutée. Chaînage mis à jour.');
}

function productionTerminalChatSummary(job) {
  const status=String(job?.status||'');
  const target=productionTargetLabel(job);
  const duration=job?.durationSeconds!==undefined
    ? chatLanguageIsFrench() ? \` en \${formatDuration(job.durationSeconds)}\` : \` in \${formatDuration(job.durationSeconds)}\`
    : '';
  if(chatLanguageIsFrench()) {
    if(status==='done') return \`Production terminée : \${target}\${duration}.\`;
    if(status==='failed') return \`Production échouée : \${target}\${duration}.\${job?.error?\` Erreur : \${job.error}\`:''}\`;
    if(status==='cancelled') return \`Production annulée : \${target}\${duration}.\`;
    return \`Production \${productionChatStatusLabel(status)} : \${target}.\`;
  }
  if(status==='done') return \`Production completed: \${target}\${duration}.\`;
  if(status==='failed') return \`Production failed: \${target}\${duration}.\${job?.error?\` Error: \${job.error}\`:''}\`;
  if(status==='cancelled') return \`Production cancelled: \${target}\${duration}.\`;
  return \`Production \${productionChatStatusLabel(status)}: \${target}.\`;
}

async function notifyProductionTerminalInChat() {
  const job=productionState.job;
  const jobId=job?.jobId || productionState.jobId;
  if(!jobId || !productionTerminal(job?.status)) return;
  const summary=productionTerminalChatSummary(job);
  if(productionState.notifiedTerminalJobIds.has(jobId)) return;
  const alreadyInChat=messages.slice(-8).some(m=>m?.role==='assistant' && m?.content===summary);
  if(alreadyInChat) {
    productionState.notifiedTerminalJobIds.add(jobId);
    return;
  }
  productionState.notifiedTerminalJobIds.add(jobId);
  appendMsg('assistant',summary);
  messages.push({role:'assistant',content:summary});
  conversationDirty=true;
  await saveCurrentConversation({immediate:true});
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
  renderProductionTrace();
  if(productionTerminal(productionState.job?.status)) await notifyProductionTerminalInChat();
  else startProductionPolling();
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
        ? 'Provider quota reached, retry pending'
        : productionState.progress?.detail,
    };
    renderProductionTrace();
  } catch(e) {
    console.warn('production trace refresh failed', e);
  }
}

function recoverProductionStateFromMessages() {
  resetProductionState();
  const traceCards=Array.from(document.querySelectorAll('.trace-card'));
  productionState.trace=hydrateTraceCard(traceCards[traceCards.length-1]);
  for(const msg of messages) {
    if(msg.role!=='tool' || !String(msg.name||'').startsWith('production_')) continue;
    handleProductionToolResult(msg.name,{},msg.content,true,{recover:true});
  }
  renderProductionTrace();
}

// ── Chat ────────────────────────────────────────────────────────────────────

async function clearChat() {
  clearChatSeq++;
  if(isStreaming) stopStreaming();
  if(historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer=null;
  }
  const id=currentConversationId;
  messages=[];
  conversationDirty=false;
  resetProductionState();
  setEmptyChat();
  if(id) {
    try {
      const existing=historySummaries.find(c=>c.id===id);
      await persistConversationPayload({
        id,
        title:'New conversation',
        createdAt:existing?.createdAt || new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        systemPrompt:currentSystemPrompt(),
        mcpServers:activeServerSnapshot(),
        messages:[],
        toolCalls:[],
        traceHtml:[],
        messageHtml:'',
      });
      currentConversationId=id;
    } catch(e) {
      notify(\`Clear failed: \${e.message}\`,'e');
    }
  } else {
    renderHistory();
  }
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
  const lastToolAssistantIndex=sourceMessages.findLastIndex?.(
    (msg)=>msg.role==='assistant'&&Array.isArray(msg.tool_calls)&&msg.tool_calls.length,
  ) ?? -1;
  const preserveTailToolExchange=lastToolAssistantIndex>=0 &&
    sourceMessages.slice(lastToolAssistantIndex+1).length>0 &&
    sourceMessages.slice(lastToolAssistantIndex+1).every((msg)=>msg.role==='tool');
  const preserveFrom=preserveTailToolExchange ? lastToolAssistantIndex : sourceMessages.length;
  return sourceMessages.flatMap((msg,idx)=>{
    if(msg.role==='user') return {role:'user',content:msg.content};
    if(msg.role==='assistant') {
      const out={role:'assistant',content:msg.content ?? ''};
      if(idx>=preserveFrom && Array.isArray(msg.tool_calls)) out.tool_calls=msg.tool_calls;
      return out;
    }
    if(msg.role==='tool') {
      return idx>=preserveFrom
        ? {role:'tool',tool_call_id:msg.tool_call_id,name:msg.name,content:msg.content}
        : [];
    }
    return msg;
  });
}

async function copyMessage(btn) {
  const msg=btn.closest('.msg');
  const text=msg?.dataset.copy || msg?.querySelector('.bubble')?.innerText || '';
  if(!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent='Copied';
    setTimeout(()=>btn.textContent='Copy',1200);
  } catch {
    notify('Copy failed','e');
  }
}

function appendMsg(role, content, toolCalls=null) {
  removeEmpty();
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className=\`msg \${role}\`;
  div.dataset.copy=content||'';
  const av=role==='user'?'<div class="av u">You</div>':'';
  const tc=toolCalls?.length ? toolCalls.map((c,i)=>tcBlockHTML(c,i)).join('') : '';
  const bodyHtml=role==='assistant' ? renderMd(content||'') : esc(content||'');
  div.innerHTML=\`\${av}<div class="msg-content"><div class="bubble">\${bodyHtml}\${tc}</div><div class="msg-actions"><button class="msg-action" onclick="copyMessage(this)">Copy</button></div></div>\`;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function createTraceCard() {
  const wrap=$('messages');
  const div=document.createElement('div');
  div.className='trace-card empty';
  const traceId=\`trace-\${nextTraceId++}\`;
  div.dataset.traceId=traceId;
  div.innerHTML='<div class="trace-head" onclick="toggleTrace(this)"><div class="trace-title"><span>MCP chain</span><span class="trace-meta">0 call</span></div><span class="trace-chevron">▾</span></div><div class="trace-body"><div class="trace-flow"></div><div class="trace-detail-wrap"></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  const trace={id:traceId,el:div,steps:[],selectedStepId:null};
  traceRegistry.set(traceId,trace);
  return trace;
}

function createChatAgentProjection() {
  return {chain:[],activities:{},plan:null,status:'idle',summary:null};
}

function createChatAgentEvent(type, {origin='system', payload={}}={}) {
  return {
    id:\`\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,10)}\`,
    ts:new Date().toISOString(),
    type,
    origin,
    payload,
  };
}

function dispatchChatAgentEvent(trace, type, {origin='system', payload={}}={}) {
  if(!trace) return null;
  const event=createChatAgentEvent(type,{origin,payload});
  trace.agentProjection ||= createChatAgentProjection();
  applyChatAgentEvent(trace.agentProjection,event);
  trace.steps=trace.agentProjection.chain;
  if(!trace._hasVisibleSteps && trace.steps.some(s=>s.type==='tool' || s.type==='production')) {
    trace._hasVisibleSteps=true;
    trace.el?.classList.remove('empty');
  }
  renderTrace(trace);
  return event;
}

function applyChatAgentEvent(state, event) {
  const p=event.payload||{};
  if(event.type==='run_started') {
    state.status='running';
    state.chain=[];
    state.activities={};
    state.plan=null;
    state.summary=null;
    return;
  }
  if(event.type==='tool_call_started') {
    upsertChatTraceStep(state,{
      type:'tool',
      status:'running',
      kind:p.kind||'MCP',
      title:p.name||'tool',
      summary:p.summary||'calling...',
      targetId:p.targetId||p.callId,
      compactKey:p.compactKey||'',
      assistantText:p.assistantText||'',
    });
    return;
  }
  if(event.type==='tool_call_result') {
    const targetId=p.targetId||p.callId;
    const step=state.chain.find(s=>s.targetId===targetId);
    if(!step) return;
    const ok=p.ok!==false;
    const baseSummary=toolResultTraceSummary(p.result,ok);
    Object.assign(step,{
      status:ok?'done':'failed',
      summary:Number(step.callCount)>1 ? \`\${baseSummary} · ×\${step.callCount}\` : baseSummary,
      ok,
      resultHtml:toolResultSummaryHTML(p.result,ok),
      assistantText:p.assistantText||step.assistantText||'',
    });
    return;
  }
  if(event.type==='trace_step_upsert') {
    upsertChatTraceStep(state,p.step||{});
    return;
  }
  if(event.type==='activity_upserted') {
    const activity=p.activity||null;
    if(activity?.key) state.activities[activity.key]=activity;
    return;
  }
  if(event.type==='run_summary') {
    state.summary=String(p.content||'');
    return;
  }
  if(event.type==='run_done') state.status='done';
  if(event.type==='run_error') state.status='error';
}

function upsertChatTraceStep(state, rawStep) {
  const step={...rawStep};
  if(step.compactKey) {
    const existing=state.chain.find(s=>s.compactKey===step.compactKey);
    if(existing) {
      Object.assign(existing,step,{
        id:existing.id,
        callCount:(Number(existing.callCount)||1)+1,
        firstTargetId:existing.firstTargetId || existing.targetId,
      });
      return existing;
    }
    step.callCount=1;
    state.chain.push(step);
    return step;
  }
  const key=step.id || step.targetId;
  const existing=key ? state.chain.find(s=>s.id===key || s.targetId===key) : null;
  if(existing) {
    Object.assign(existing,step,{id:existing.id});
    return existing;
  }
  state.chain.push(step);
  return step;
}

function hydrateTraceCard(card) {
  if(!card) return null;
  let traceId=card.dataset.traceId;
  if(!traceId) {
    traceId=\`trace-\${nextTraceId++}\`;
    card.dataset.traceId=traceId;
  }
  const steps=Array.from(card.querySelectorAll('.trace-flow .trace-tile')).map((tile,i)=>{
    const onclick=tile.getAttribute('onclick') || '';
    const stepId=onclick.match(/toggleTraceStep\\('[^']+','([^']+)'\\)/)?.[1] || \`step-\${traceId}-\${i}\`;
    const classes=Array.from(tile.classList || []);
    const type=classes.find(c=>['tool','production','internal','final'].includes(c)) || 'internal';
    const status=classes.find(c=>['queued','running','done','failed','cancelled'].includes(c)) || '';
    return {
      id:stepId,
      type,
      status,
      kind:tile.querySelector('.trace-k')?.textContent || '',
      title:tile.querySelector('.trace-v')?.textContent || '',
      summary:tile.querySelector('.trace-s')?.textContent || '',
      ok:!classes.includes('error'),
    };
  });
  const active=steps.find((_,i)=>card.querySelectorAll('.trace-flow .trace-tile')[i]?.classList.contains('active'));
  const trace={id:traceId,el:card,steps,selectedStepId:active?.id || null};
  traceRegistry.set(traceId,trace);
  return trace;
}

function toggleTrace(head) {
  const body=head.parentElement.querySelector('.trace-body');
  const chev=head.querySelector('.trace-chevron');
  const collapsed=body.classList.toggle('collapsed');
  if(chev) chev.textContent=collapsed?'▸':'▾';
}

function traceStepHTML(trace, step) {
  if(!step.id) step.id=\`step-\${trace.id}-\${trace.steps.indexOf(step)}\`;
  const active=trace.selectedStepId===step.id;
  const cls=['trace-tile',step.type,step.status,active?'active':'',step.ok===false?'error':''].filter(Boolean).join(' ');
  const clickable=step.detail || step.resultHtml || step.targetId;
  const click=clickable ? \` onclick="toggleTraceStep('\${esc(trace.id)}','\${esc(step.id)}')"\` : '';
  return \`<button class="\${cls}" type="button"\${click}>
    <div class="trace-k">\${esc(step.kind)}</div>
    <div class="trace-v">\${esc(step.title)}</div>
    \${step.summary?\`<div class="trace-s">\${esc(step.summary)}</div>\`:''}
  </button>\`;
}

function traceDetailHTML(step) {
  if(!step) return '';
  const d=step.detail;
  if(!d && step.resultHtml) {
    return \`<div class="trace-detail">
      <div class="trace-detail-head">
        <div class="trace-detail-title">\${esc(step.title || 'tool')}</div>
        <div class="trace-detail-meta">\${esc(step.summary || '')}</div>
      </div>
      \${step.assistantText?\`<div class="trace-detail-line">\${esc(step.assistantText)}</div>\`:''}
      <div class="trace-tool-result">\${step.resultHtml}</div>
    </div>\`;
  }
  if(!d) return '';
  const exit=d.exitCode===null || d.exitCode===undefined ? '—' : d.exitCode;
  const percent=d.percent===null || d.percent===undefined ? '—' : \`\${Math.round(Number(d.percent))}%\`;
  return \`<div class="trace-detail">
    <div class="trace-detail-head">
      <div class="trace-detail-title">\${esc(d.title || step.title || 'production')}</div>
      <div class="trace-detail-meta">\${esc(productionStatusLabel(d.status || step.status))}</div>
    </div>
    <div class="trace-detail-grid">
      <div class="trace-detail-cell"><div class="trace-detail-k">Duration</div><div class="trace-detail-v">\${esc(d.duration || '—')}</div></div>
      <div class="trace-detail-cell"><div class="trace-detail-k">Exit</div><div class="trace-detail-v">\${esc(exit)}</div></div>
      <div class="trace-detail-cell"><div class="trace-detail-k">Progress</div><div class="trace-detail-v">\${esc(percent)}</div></div>
    </div>
    \${d.detail?\`<div class="trace-detail-line">\${esc(d.detail)}</div>\`:''}
    \${d.command?\`<div class="trace-detail-line"><strong>Command</strong> · \${esc(d.command)}</div>\`:''}
    \${d.traceFile?\`<div class="trace-detail-line"><strong>Trace</strong> · \${esc(d.traceFile)}</div>\`:''}
    \${d.error?\`<div class="trace-detail-line" style="color:var(--err)">\${esc(d.error)}</div>\`:''}
    \${d.logs?\`<div class="trace-detail-log">\${esc(d.logs)}</div>\`:''}
  </div>\`;
}

function traceOpenDetails(container) {
  return Array.from(container?.querySelectorAll('details') || [])
    .map((el,i)=>el.open ? i : -1)
    .filter(i=>i>=0);
}

function restoreTraceOpenDetails(container, openIndexes) {
  if(!container || !Array.isArray(openIndexes) || !openIndexes.length) return;
  const details=Array.from(container.querySelectorAll('details'));
  openIndexes.forEach(i=>{ if(details[i]) details[i].open=true; });
}

function rememberTraceDetailState(trace) {
  const detailWrap=trace?.el?.querySelector('.trace-detail-wrap');
  const selected=trace?.steps?.find(s=>s.id===trace.selectedStepId);
  if(!detailWrap || !selected) return;
  selected.openDetailIndexes=traceOpenDetails(detailWrap);
}

function renderTrace(trace) {
  if(!trace?.el) return;
  rememberTraceDetailState(trace);
  const flow=trace.el.querySelector('.trace-flow');
  const detailWrap=trace.el.querySelector('.trace-detail-wrap');
  const meta=trace.el.querySelector('.trace-meta');
  const toolCount=trace.steps
    .filter(s=>s.type==='tool')
    .reduce((count,s)=>count+(Number(s.callCount)||1),0);
  if(meta) meta.textContent=\`\${toolCount} call\${toolCount>1?'s':''} · \${trace.steps.length} step\${trace.steps.length>1?'s':''}\`;
  flow.innerHTML=trace.steps.map((s,i)=>traceStepHTML(trace,s)+(i<trace.steps.length-1?'<div class="trace-link"></div>':'')).join('');
  const selected=trace.steps.find(s=>s.id===trace.selectedStepId);
  if(detailWrap) {
    detailWrap.innerHTML=traceDetailHTML(selected);
    restoreTraceOpenDetails(detailWrap, selected?.openDetailIndexes);
  }
}

function compactTraceKeyForTool(fn, server) {
  const name=String(fn||'');
  if(isObserverToolName(name)) return (server?.id || server?.name || 'MCP')+':'+name;
  return '';
}

function toggleTraceStep(traceId, stepId) {
  const trace=traceRegistry.get(traceId);
  if(!trace) return;
  const step=trace.steps.find(s=>s.id===stepId);
  if(!step) return;
  if(step.detail || step.resultHtml) {
    rememberTraceDetailState(trace);
    trace.selectedStepId = trace.selectedStepId===stepId ? null : stepId;
    renderTrace(trace);
    return;
  }
  if(step.targetId) scrollToTool(step.targetId);
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
      <button class="tc-args-toggle" type="button" onclick="toggleTCArgs(event,\${idx})">Show arguments</button>
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
  let clean=String(path||'').trim();
  if(/^https?:\\/\\//i.test(clean)) {
    try {
      const url=new URL(clean, window.location.href);
      if(url.origin!==window.location.origin) return null;
      clean=url.pathname;
    } catch {
      return null;
    }
  }
  clean=clean.replace(/^\\/+/, '').replace(/#.*$/, '');
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

function jsonPreviewValue(value) {
  if(value===null || value===undefined) return '—';
  if(typeof value==='string' || typeof value==='number' || typeof value==='boolean') return String(value);
  if(Array.isArray(value)) return \`\${value.length} item\${value.length>1?'s':''}\`;
  if(typeof value==='object') return \`\${Object.keys(value).length} field\${Object.keys(value).length>1?'s':''}\`;
  return String(value);
}

function flatJsonColumns(rows) {
  const keys=[];
  for(const row of rows) {
    if(!row || typeof row!=='object' || Array.isArray(row)) return [];
    for(const key of Object.keys(row)) {
      const value=row[key];
      if(value && typeof value==='object') continue;
      if(!keys.includes(key)) keys.push(key);
      if(keys.length>=5) return keys;
    }
  }
  return keys;
}

function genericJsonTableHTML(rows) {
  const cols=flatJsonColumns(rows);
  if(!cols.length) return '';
  const shown=rows.slice(0,8);
  return \`<div class="tc-json-table-wrap"><table class="tc-json-table"><thead><tr>\${cols.map(c=>\`<th>\${esc(c)}</th>\`).join('')}</tr></thead><tbody>\${shown.map(row=>\`<tr>\${cols.map(c=>\`<td>\${esc(shortText(jsonPreviewValue(row?.[c]),90))}</td>\`).join('')}</tr>\`).join('')}</tbody></table></div>\${rows.length>shown.length?\`<div class="tc-item-meta">+\${rows.length-shown.length} more rows</div>\`:''}\`;
}

function genericJsonObjectHTML(obj) {
  const entries=Object.entries(obj||{});
  const shown=entries.slice(0,12);
  return \`<div class="trace-detail-grid">\${shown.map(([key,value])=>\`<div class="trace-detail-cell"><div class="trace-detail-k">\${esc(key)}</div><div class="trace-detail-v">\${esc(shortText(jsonPreviewValue(value),110))}</div></div>\`).join('')}</div>\${entries.length>shown.length?\`<div class="tc-item-meta">+\${entries.length-shown.length} more fields</div>\`:''}\`;
}

function genericJsonArraySectionHTML(key, rows) {
  const table=genericJsonTableHTML(rows);
  return \`<div class="tc-item">
    <div class="tc-item-meta">\${esc(key)} · \${rows.length} item\${rows.length>1?'s':''}</div>
    \${table || \`<div class="tc-list">\${rows.slice(0,8).map(item=>\`<div class="tc-item"><div class="tc-item-title"><span>\${esc(shortText(jsonPreviewValue(item),140))}</span></div></div>\`).join('')}</div>\`}
  </div>\`;
}

function genericJsonSummaryHTML(data, raw) {
  if(!data) return '';
  if(Array.isArray(data)) {
    const table=genericJsonTableHTML(data);
    return \`<div class="tc-summary"><div class="tc-summary-head"><span>\${data.length} item\${data.length>1?'s':''}</span><span class="tc-pill">array</span></div>\${table || \`<div class="tc-list">\${data.slice(0,10).map(item=>\`<div class="tc-item"><div class="tc-item-title"><span>\${esc(shortText(jsonPreviewValue(item),140))}</span></div></div>\`).join('')}</div>\`}<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details></div>\`;
  }
  if(typeof data==='object') {
    const entries=Object.entries(data);
    const arrayEntry=entries.length===1 && Array.isArray(entries[0][1]) ? entries[0] : null;
    if(arrayEntry) {
      const [key,rows]=arrayEntry;
      const table=genericJsonTableHTML(rows);
      return \`<div class="tc-summary"><div class="tc-summary-head"><span>\${esc(key)}</span><span class="tc-pill">\${rows.length} item\${rows.length>1?'s':''}</span></div>\${table || \`<div class="tc-list">\${rows.slice(0,10).map(item=>\`<div class="tc-item"><div class="tc-item-title"><span>\${esc(shortText(jsonPreviewValue(item),140))}</span></div></div>\`).join('')}</div>\`}<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details></div>\`;
    }
    const arrayEntries=entries.filter(([,value])=>Array.isArray(value));
    if(arrayEntries.length>1) {
      const scalarEntries=entries
        .filter(([,value])=>!Array.isArray(value) && (value===null || typeof value!=='object'))
        .slice(0,4);
      const total=arrayEntries.reduce((sum,[,rows])=>sum+rows.length,0);
      return \`<div class="tc-summary">
        <div class="tc-summary-head">
          <span>\${total} item\${total>1?'s':''}</span>
          \${arrayEntries.slice(0,4).map(([key,rows])=>\`<span class="tc-pill">\${esc(key)}: \${rows.length}</span>\`).join('')}
        </div>
        \${scalarEntries.length?genericJsonObjectHTML(Object.fromEntries(scalarEntries)):''}
        \${arrayEntries.slice(0,4).map(([key,rows])=>genericJsonArraySectionHTML(key,rows)).join('')}
        \${arrayEntries.length>4?\`<div class="tc-item-meta">+\${arrayEntries.length-4} more sections</div>\`:''}
        <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
      </div>\`;
    }
    return \`<div class="tc-summary"><div class="tc-summary-head"><span>Structured result</span><span class="tc-pill">\${entries.length} field\${entries.length>1?'s':''}</span></div>\${genericJsonObjectHTML(data)}<details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details></div>\`;
  }
  return '';
}

function productionTemplatesSummaryHTML(data, raw) {
  if(!Array.isArray(data?.templates)) return '';
  const templates=data.templates;
  const unmatched=Array.isArray(data.unmatchedDeliverables) ? data.unmatchedDeliverables : [];
  const shown=templates.slice(0,10);
  return \`<div class="tc-summary">
    <div class="tc-summary-head">
      <span>\${templates.length} template\${templates.length>1?'s':''}</span>
      <span class="tc-pill">\${esc(data.workspace||'workspace')}</span>
      \${unmatched.length?\`<span class="tc-pill">\${unmatched.length} unmatched</span>\`:''}
    </div>
    <div class="tc-list">\${shown.map(t=>\`<div class="tc-item">
      <div class="tc-item-title"><span>\${docButtonHTML(t.templatePath||\`templates/\${t.template}\`,t.template||t.templatePath||'template')}</span></div>
      <div class="tc-item-meta">Deliverable: \${docButtonHTML(t.deliverablePath||\`deliverables/\${t.deliverable}\`,t.deliverable||t.deliverablePath||'deliverable')}</div>
      <div class="tc-doc-chip-row"><span class="tc-pill">\${t.deliverableExists?'exists':'missing'}</span></div>
    </div>\`).join('')}</div>
    \${templates.length>shown.length?\`<div class="tc-item-meta">+\${templates.length-shown.length} more templates</div>\`:''}
    \${unmatched.length?\`<div class="tc-item">
      <div class="tc-item-meta">Unmatched deliverables</div>
      <div class="tc-doc-chip-row">\${unmatched.slice(0,8).map(d=>docButtonHTML(d.deliverablePath,d.deliverable||d.deliverablePath,true)).join('')}\${unmatched.length>8?\`<span class="tc-item-meta">+\${unmatched.length-8} more</span>\`:''}</div>
    </div>\`:''}
    <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
  </div>\`;
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
    content.innerHTML=\`<article class="article"><p style="color:var(--err)">Failed to load \${esc(label||href)}: \${esc(e.message)}</p></article>\`;
  }
}

function closeLocalDoc() {
  const modal=$('doc-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden','true');
}

function showErrModal(title, msg) {
  const modal=$('err-modal'); if(!modal) return;
  $('err-modal-title').textContent=title;
  $('err-modal-msg').textContent=msg;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
}
function closeErrModal() {
  const modal=$('err-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden','true');
}
function mcpConnectErrorMessage(err) {
  const raw=err?.message||String(err);
  try {
    const m=raw.match(/HTTP \\d+: ([{].+[}])/s);
    if(m) {
      const body=JSON.parse(m[1]);
      const detail=body.error||body.message||'';
      if(/fetch failed|connexion refus|econnrefused|service non d/i.test(detail))
        return 'MCP service unreachable — check that the server is running.';
      if(detail) return detail;
    }
  } catch {}
  if(/fetch failed|failed to fetch|econnrefused/i.test(raw))
    return 'MCP service unreachable — check that the server is running.';
  return raw;
}

function toolResultSummaryHTML(result, ok) {
  const raw=typeof result==='string'?result:JSON.stringify(result,null,2);
  if(!ok) {
    return \`<div class="tc-summary"><div class="tc-summary-head">Tool error</div><pre style="color:var(--err)">\${esc(raw)}</pre></div>\`;
  }
  const data=parseToolJSON(result);

  if(data?.results && Array.isArray(data.results)) {
    const shown=data.results.slice(0,6);
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>\${data.results.length} result\${data.results.length>1?'s':''}</span>
        <span class="tc-pill">search</span>
      </div>
      <div class="tc-list">\${shown.map(wikiResultItemHTML).join('')}</div>
      \${data.results.length>shown.length?\`<div class="tc-item-meta">+\${data.results.length-shown.length} more results hidden</div>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pages=Array.isArray(data.readPages) ? data.readPages : [];
    const shown=data.candidateResults.slice(0,5);
    const pagePaths=(data.readPagePaths||pages.map(p=>p.path)).filter(Boolean);
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>Collected context</span>
        <span class="tc-pill">\${coverage.readPageCount ?? pagePaths.length} page\${(coverage.readPageCount ?? pagePaths.length)>1?'s':''} read</span>
        <span class="tc-pill">\${coverage.candidateCount ?? data.candidateResults.length} candidate\${(coverage.candidateCount ?? data.candidateResults.length)>1?'s':''}</span>
        \${coverage.truncatedPageCount?\`<span class="tc-pill">\${coverage.truncatedPageCount} truncated</span>\`:''}
      </div>
      \${pagePaths.length?\`<div class="tc-item"><div class="tc-item-meta">Opened pages</div><div class="tc-doc-chip-row">\${pagePaths.slice(0,8).map(p=>docButtonHTML(p,p,true)).join('')}\${pagePaths.length>8?'<span class="tc-item-meta">…</span>':''}</div></div>\`:''}
      <div class="tc-list">\${shown.map(wikiResultItemHTML).join('')}</div>
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.pages && Array.isArray(data.pages)) {
    const shown=data.pages.slice(0,6);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${data.pages.length} page\${data.pages.length>1?'s':''}</span><span class="tc-pill">read</span></div>
      <div class="tc-list">\${shown.map(p=>\`<div class="tc-item">
        <div class="tc-item-title"><span>\${docButtonHTML(p.path,p.path||'page')}</span></div>
        <div class="tc-item-meta">\${p.found?'found':'not found'}\${p.truncated?' · truncated':''}</div>
        \${p.content?\`<div class="tc-item-excerpt">\${esc(shortText(p.content,260))}</div>\`:''}
        \${p.error?\`<div class="tc-item-excerpt">\${esc(p.error)}</div>\`:''}
      </div>\`).join('')}</div>
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.jobs && Array.isArray(data.jobs)) {
    const shown=data.jobs.slice(0,8);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${data.jobs.length} production job\${data.jobs.length>1?'s':''}</span><span class="tc-pill">\${esc(data.workspace||'workspace')}</span></div>
      <div class="tc-list">\${shown.map(job=>\`<div class="tc-item">
        <div class="tc-item-title"><span>\${esc(job.type||'production')} · \${esc(productionStatusLabel(job.status))}</span></div>
        <div class="tc-item-meta">\${esc(job.jobId||'')}\${job.error?\` · \${esc(job.error)}\`:''}</div>
        \${Array.isArray(job.producedFiles)&&job.producedFiles.length?\`<div class="tc-doc-chip-row">\${job.producedFiles.slice(0,5).map(p=>docButtonHTML(p,p,true)).join('')}</div>\`:''}
      </div>\`).join('')}</div>
      \${data.jobs.length>shown.length?\`<div class="tc-item-meta">+\${data.jobs.length-shown.length} more jobs</div>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  const productionTemplates=productionTemplatesSummaryHTML(data, raw);
  if(productionTemplates) return productionTemplates;

  if(data?.sources && Array.isArray(data.sources)) {
    const shown=data.sources.slice(0,12);
    const tail=data.stdout_tail || data.stderr_tail || data.tail || '';
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>\${data.sources.length} source\${data.sources.length>1?'s':''}</span>
        <span class="tc-pill">CME</span>
        \${isPossiblyTruncatedToolResult(data,raw)?'<span class="tc-pill">partial/tail</span>':''}
      </div>
      <div class="tc-list">\${shown.map((source,i)=>\`
        <div class="tc-item">
          <div class="tc-item-title"><span>\${esc(source?.name || source?.id || source?.source || \`source \${i+1}\`)}</span></div>
          <div class="tc-item-meta">\${esc([source?.type,source?.status,source?.path,source?.url].filter(Boolean).join(' · '))}</div>
          \${source?.description || source?.summary ? \`<div class="tc-item-excerpt">\${esc(source.description || source.summary)}</div>\` : ''}
        </div>\`).join('')}</div>
      \${data.sources.length>shown.length?\`<div class="tc-item-meta">+\${data.sources.length-shown.length} more sources</div>\`:''}
      \${tail?\`<details class="tc-raw"><summary>Output tail</summary><pre>\${esc(String(tail))}</pre></details>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  if(data?.job || data?.jobId) {
    const job=data.job || data;
    const status=String(job.status||data.status||'');
    const terminal=productionTerminal(status);
    const produced=Array.isArray(job.producedFiles) ? job.producedFiles : (Array.isArray(data.producedFiles) ? data.producedFiles : []);
    const duration=job.durationSeconds===null || job.durationSeconds===undefined ? '' : \`<span class="tc-pill">\${esc(formatDuration(job.durationSeconds))}</span>\`;
    const exit=job.exitCode===null || job.exitCode===undefined ? '' : \`<span class="tc-pill">exit \${esc(job.exitCode)}</span>\`;
    const progress=data.progress?.percent ?? job.progress?.percent;
    const progressPill=Number.isFinite(Number(progress)) ? \`<span class="tc-pill">\${Math.round(Number(progress))}%</span>\` : '';
    return \`<div class="tc-summary">
      <div class="tc-summary-head">
        <span>Production \${esc(productionStatusLabel(status))}</span>
        \${job.jobId?\`<span class="tc-pill">\${esc(job.jobId)}</span>\`:''}
        \${terminal?\`<span class="tc-pill">\${esc(status)}</span>\`:''}
        \${duration}\${exit}\${progressPill}
      </div>
      \${produced.length?\`<div class="tc-item"><div class="tc-item-meta">\${produced.length} produced file\${produced.length>1?'s':''}</div><div class="tc-doc-chip-row">\${produced.slice(0,10).map(p=>docButtonHTML(p,p,true)).join('')}\${produced.length>10?'<span class="tc-item-meta">…</span>':''}</div></div>\`:''}
      <div class="tc-item-meta">Details, logs and timing in the chain view.</div>
      \${job.error?\`<div class="tc-item-excerpt" style="color:var(--err)">\${esc(job.error)}</div>\`:''}
      <details class="tc-raw"><summary>Raw JSON</summary><pre>\${esc(raw)}</pre></details>
    </div>\`;
  }

  const genericJson=genericJsonSummaryHTML(data, raw);
  if(genericJson) return genericJson;

  // newline-separated path list (wiki_list_pages format: "path/to/page.md [type]")
  const lines=raw.split('\\n').map(l=>l.trim()).filter(Boolean);
  if(lines.length>0 && lines.every(l=>/\\[\\w+\\]$/.test(l))) {
    const byType={};
    for(const l of lines) {
      const m=l.match(/^(.+)\\s+\\[(\\w+)\\]$/);
      if(!m) continue;
      const [,p,t]=m;
      (byType[t]=byType[t]||[]).push(p);
    }
    const groups=Object.entries(byType);
    return \`<div class="tc-summary">
      <div class="tc-summary-head"><span>\${lines.length} item\${lines.length>1?'s':''}</span>\${groups.map(([t])=>\`<span class="tc-pill">\${esc(t)}</span>\`).join('')}</div>
      \${groups.map(([t,ps])=>\`<div class="tc-item">
        <div class="tc-item-meta">\${esc(t)}</div>
        <div class="tc-doc-chip-row">\${ps.slice(0,12).map(p=>docButtonHTML(p,p,true)).join('')}\${ps.length>12?\`<span class="tc-item-meta">+\${ps.length-12} more</span>\`:''}</div>
      </div>\`).join('')}
    </div>\`;
  }

  return \`<div class="tc-summary">
    <div class="tc-summary-head"><span>Result</span></div>
    <pre>\${esc(raw.length>1800?raw.slice(0,1799)+'…':raw)}</pre>
    \${raw.length>1800?\`<details class="tc-raw"><summary>Show all</summary><pre>\${esc(raw)}</pre></details>\`:''}
  </div>\`;
}

function toolResultTraceSummary(result, ok) {
  if(!ok) return 'error';
  const data=parseToolJSON(result);
  if(data?.results && Array.isArray(data.results)) return \`\${data.results.length} result\${data.results.length>1?'s':''}\`;
  if(data?.candidateResults && Array.isArray(data.candidateResults)) {
    const coverage=data.coverage||{};
    const pages=coverage.readPageCount ?? (Array.isArray(data.readPages)?data.readPages.length:0);
    const candidates=coverage.candidateCount ?? data.candidateResults.length;
    return \`\${candidates} candidate\${candidates>1?'s':''} · \${pages} page\${pages>1?'s':''}\`;
  }
  if(data?.pages && Array.isArray(data.pages)) return \`\${data.pages.length} page\${data.pages.length>1?'s':''}\`;
  if(data?.sources && Array.isArray(data.sources)) {
    const tail=isPossiblyTruncatedToolResult(data,typeof result==='string'?result:JSON.stringify(result));
    return \`\${data.sources.length} source\${data.sources.length>1?'s':''}\${tail?' · partial/tail':''}\`;
  }
  if(data?.jobs && Array.isArray(data.jobs)) return \`\${data.jobs.length} production job\${data.jobs.length>1?'s':''}\`;
  if(data?.job || data?.jobId) {
    const job=data.job || data;
    const produced=Array.isArray(job.producedFiles) ? job.producedFiles : (Array.isArray(data.producedFiles) ? data.producedFiles : []);
    const bits=[\`production \${productionStatusLabel(job.status||data.status)}\`];
    if(produced.length) bits.push(\`\${produced.length} file\${produced.length>1?'s':''}\`);
    if(job.durationSeconds!==null && job.durationSeconds!==undefined) bits.push(formatDuration(job.durationSeconds));
    return bits.join(' · ');
  }
  if(Array.isArray(data)) return \`\${data.length} item\${data.length>1?'s':''}\`;
  if(data && typeof data==='object') {
    const entries=Object.entries(data);
    const arrayEntry=entries.length===1 && Array.isArray(entries[0][1]) ? entries[0] : null;
    if(arrayEntry) return \`\${arrayEntry[1].length} \${arrayEntry[0]}\`;
    const arrayEntries=entries.filter(([,value])=>Array.isArray(value));
    if(arrayEntries.length>1) {
      const total=arrayEntries.reduce((sum,[,rows])=>sum+rows.length,0);
      return \`\${total} item\${total>1?'s':''} · \${arrayEntries.map(([key,rows])=>\`\${key} \${rows.length}\`).slice(0,2).join(' · ')}\`;
    }
    return \`\${entries.length} field\${entries.length>1?'s':''}\`;
  }
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
        kind:'Internal',
        title:'readPages',
        summary:\`\${readCount} page\${readCount>1?'s':''} read\`,
        targetId,
      });
    }
    const truncated=coverage.truncatedPageCount ?? 0;
    if(truncated>0) {
      steps.push({
        type:'internal',
        kind:'Coverage',
        title:'truncated pages',
        summary:\`\${truncated} page\${truncated>1?'s':''}\`,
        targetId,
        ok:false,
      });
    }
    const rawCount=coverage.notReadRawSourceCount ?? (data.notReadRawSources?.length || 0);
    if(rawCount>0) {
      steps.push({
        type:'internal',
        kind:'References',
        title:'unread raw',
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
      kind:'Candidates',
      title:'candidate pages',
      summary:\`\${wikiCount} page\${wikiCount>1?'s':''}\`,
      targetId,
    }] : [];
  }
  if((fn==='wiki_read_pages' || fn==='wiki_read_page') && data?.pages && Array.isArray(data.pages)) {
    const found=data.pages.filter(p=>p.found).length;
    return [{
      type:'internal',
      kind:'Reading',
      title:'opened pages',
      summary:\`\${found}/\${data.pages.length} found\`,
      targetId,
    }];
  }
  return [];
}

function updateTC(idx, result, ok) {
  const st=$(\`tc-st-\${idx}\`), body=$(\`tc-body-\${idx}\`);
  if(st){st.textContent=ok?'✓':'!';st.className=\`tc-st \${ok?'ok':'er'}\`;}
  if(body){
    body.innerHTML+=\`<div class="tc-lbl" style="margin-top:8px">Result</div>\${toolResultSummaryHTML(result,ok)}\`;
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
  event.currentTarget.textContent=collapsed?'Show arguments':'Hide arguments';
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
  div.innerHTML='<div class="msg-content"><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div><div class="msg-actions"><button class="msg-action" onclick="copyMessage(this)">Copy</button></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
  return div;
}

function removeStreamBubble(div) {
  if(!div) return;
  div.remove();
}

function keepOrReplaceStatusBubble(currentDiv, text, statusDiv) {
  const value=String(text||'').trim();
  if(!value) {
    removeStreamBubble(currentDiv);
    return statusDiv || null;
  }
  if(statusDiv && statusDiv!==currentDiv && statusDiv.isConnected) {
    setStreamContent(statusDiv,value);
    removeStreamBubble(currentDiv);
    return statusDiv;
  }
  setStreamContent(currentDiv,value);
  return currentDiv;
}

function publishAssistantOutput(content, statusDiv) {
  if(statusDiv && statusDiv.isConnected) {
    setStreamContent(statusDiv,content);
    return statusDiv;
  }
  return appendMsg('assistant',content);
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
  let res;
  try {
    res=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,stream:true}),signal});
  } catch(e) {
    const detail=e instanceof Error ? e.message : String(e);
    throw new Error(\`Chat server unreachable. Check that the wiki server is running. \${detail}\`);
  }
  if(!res.ok) {
    const raw=await res.text();
    let message=raw;
    try {
      const parsed=JSON.parse(raw);
      const normalize=(value)=>{
        if(value==null) return '';
        if(typeof value==='string') return value;
        if(typeof value.message==='string') return value.message;
        try { return JSON.stringify(value); } catch { return String(value); }
      };
      message=[normalize(parsed.error),normalize(parsed.hint)].filter(Boolean).join('\\n');
    } catch {}
    if(res.status===502) {
      const detail=message ? \`\\n\${message}\` : '';
      message=\`LLM unreachable. Check that the LLM service is running and the Base URL is reachable.\${detail}\`;
    } else if(res.status===400 && /INVALID_LLM_BASE_URL|Invalid URL/i.test(message)) {
      message='Invalid LLM configuration. Check the Base URL in chat settings.';
    }
    throw new Error(\`API \${res.status}: \${message||res.statusText}\`);
  }
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
  const isSkillRun=!!resolved.skill;
  const model=$('model-name').value.trim()||'gpt-4o';
  const parsedTemp=parseFloat($('temperature').value);
  const temp=Number.isFinite(parsedTemp) ? parsedTemp : 0.7;
  const useProxy=!!(window.__WIKI_CONFIG__);
  if(!useProxy && !$('base-url').value.trim()){notify('Enter a Base URL','e');return;}

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
  dispatchChatAgentEvent(runTrace,'run_started',{
    origin:'user',
    payload:{content:resolved.sendText},
  });

  let tcIdx=Date.now();
  const MAX_TURNS=24;
  let turn=0;
  const activeTools=getActiveTools();
  const toolsPayload=activeTools.length ? activeTools.map(t=>({
    type:'function',
    function:{name:t.name,description:t.description||'',parameters:t.inputSchema||t.parameters||{type:'object',properties:{}}}
  })) : undefined;
  const llmUrl=useProxy ? '/api/chat' : \`\${$('base-url').value.trim().replace(/\\/$/, '')}/v1/chat/completions\`;
  const llmHeaders=useProxy ? buildProxyLLMHeaders() : buildLLMHeaders();

  let streamDiv=null;
  let streamText='';
  let streamFinalized=false;
  let streamMessagePersisted=false;
  let statusDiv=null;
  const streamClearSeq=clearChatSeq;
  let completedWithoutLimit=false;
  const toolRepeatCounts=new Map();
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
      streamText='';
      streamFinalized=false;
      streamMessagePersisted=false;
      const {content,toolCalls}=await fetchStream(llmUrl,llmHeaders,reqBody,t=>{
        streamText=t;
        setStreamContent(streamDiv,t);
      },streamAbortController.signal);
      if(streamAbortController.signal.aborted) break;
      streamText=content;

      if(toolCalls?.length) {
        const tcWithIdx=toolCalls.map((tc,i)=>({...tc,_domIdx:tcIdx+i}));
        const repeatedObservation=tcWithIdx.some((tc)=>{
          const key=toolCallRepeatKey(tc);
          const count=(toolRepeatCounts.get(key)||0)+1;
          toolRepeatCounts.set(key,count);
          return count>1 && isObserverToolName(toolCallFunctionName(tc));
        });
        if(!isSkillRun && repeatedObservation && tcWithIdx.every(tc=>isObserverToolName(toolCallFunctionName(tc)))) {
          statusDiv=keepOrReplaceStatusBubble(streamDiv,content,statusDiv);
          streamFinalized=true;
          const summary=observerToolLoopSummary([],true);
          dispatchChatAgentEvent(runTrace,'run_summary',{origin:'system',payload:{content:summary}});
          statusDiv=publishAssistantOutput(summary,statusDiv);
          messages.push({role:'assistant',content:summary});
          conversationDirty=true;
          await saveCurrentConversation({immediate:true});
          dispatchChatAgentEvent(runTrace,'run_done',{origin:'system'});
          completedWithoutLimit=true;
          break;
        }
        statusDiv=keepOrReplaceStatusBubble(streamDiv,content,statusDiv);
        streamFinalized=true;
        messages.push({role:'assistant',content:content||null,tool_calls:tcWithIdx.map(({_domIdx,...tc})=>tc)});
        streamMessagePersisted=true;
        for(const tc of tcWithIdx) {
          const fn=toolCallFunctionName(tc)||'?';
          const server=findServerForTool(fn);
          if(isProductionToolName(fn)) productionState.trace=runTrace;
          dispatchChatAgentEvent(runTrace,'tool_call_started',{
            origin:'tool',
            payload:{
              callId:tc.id,
              name:fn,
              kind:server?.name||'MCP',
              targetId:\`tc-\${tc._domIdx}\`,
              compactKey:compactTraceKeyForTool(fn,server),
              assistantText:content||'',
            },
          });
        }
        const toolResults=await Promise.all(tcWithIdx.map(async (tc)=>{
          const domIdx=tc._domIdx;
          const fn=toolCallFunctionName(tc);
          const args=toolCallArgsObject(tc);
          try {
            const r=await callMCPTool(fn,args);
            if(isProductionToolName(fn)) productionState.trace=runTrace;
            handleProductionToolResult(fn,args,r,true);
            dispatchChatAgentEvent(runTrace,'tool_call_result',{
              origin:'tool',
              payload:{callId:tc.id,targetId:\`tc-\${domIdx}\`,name:fn,ok:true,result:r,assistantText:content||''},
            });
            for(const step of derivedTraceStepsForTool(fn,r,true,\`tc-\${domIdx}\`)) {
              dispatchChatAgentEvent(runTrace,'trace_step_upsert',{
                origin:'tool',
                payload:{step},
              });
            }
            return {tool_call_id:tc.id,role:'tool',name:fn,content:r};
          } catch(e) {
            if(isProductionToolName(fn)) productionState.trace=runTrace;
            handleProductionToolResult(fn,args,e.message,false);
            dispatchChatAgentEvent(runTrace,'tool_call_result',{
              origin:'tool',
              payload:{callId:tc.id,targetId:\`tc-\${domIdx}\`,name:fn,ok:false,result:e.message,assistantText:content||''},
            });
            return {tool_call_id:tc.id,role:'tool',name:fn,content:\`\${chatText('Error:','Erreur :')} \${e.message}\`};
          }
        }));
        tcIdx+=toolCalls.length;
        messages.push(...toolResults);
        conversationDirty=true;
        await saveCurrentConversation({immediate:true});
        if(!isSkillRun && tcWithIdx.every(tc=>isObserverToolName(toolCallFunctionName(tc)))) {
          const summary=observerToolLoopSummary(toolResults);
          dispatchChatAgentEvent(runTrace,'run_summary',{origin:'system',payload:{content:summary}});
          statusDiv=publishAssistantOutput(summary,statusDiv);
          messages.push({role:'assistant',content:summary});
          conversationDirty=true;
          await saveCurrentConversation({immediate:true});
          dispatchChatAgentEvent(runTrace,'run_done',{origin:'system'});
          completedWithoutLimit=true;
          break;
        }
        if(shouldStopAfterProductionTools(tcWithIdx)) {
          const summary=productionToolSummary(toolResults);
          dispatchChatAgentEvent(runTrace,'run_summary',{origin:'system',payload:{content:summary}});
          statusDiv=publishAssistantOutput(summary,statusDiv);
          messages.push({role:'assistant',content:summary});
          conversationDirty=true;
          await saveCurrentConversation({immediate:true});
          dispatchChatAgentEvent(runTrace,'run_done',{origin:'system'});
          completedWithoutLimit=true;
          break;
        }
        streamDiv=null;
        if(streamAbortController.signal.aborted) break;
        continue;
      }

      if(statusDiv && statusDiv!==streamDiv && statusDiv.isConnected) {
        setStreamContent(statusDiv,content);
        removeStreamBubble(streamDiv);
      } else {
        setStreamContent(streamDiv,content);
        statusDiv=streamDiv;
      }
      streamFinalized=true;
      messages.push({role:'assistant',content});
      streamMessagePersisted=true;
      conversationDirty=true;
      await saveCurrentConversation({immediate:true});
      dispatchChatAgentEvent(runTrace,'run_done',{origin:'llm'});
      completedWithoutLimit=true;
      break;
    }
    if(turn>=MAX_TURNS && !completedWithoutLimit) {
      const limitText=chatLanguageIsFrench()
        ? \`⚠ Limite de chaînage atteinte (\${MAX_TURNS} tours).\`
        : \`⚠ Chaining limit reached (\${MAX_TURNS} turns).\`;
      appendMsg('assistant',limitText);
      messages.push({role:'assistant',content:limitText});
      dispatchChatAgentEvent(runTrace,'run_error',{origin:'system',payload:{message:limitText}});
      await saveCurrentConversation({immediate:true});
    }
  } catch(err) {
    if(streamClearSeq!==clearChatSeq) return;
    if(err.name==='AbortError') {
      if(streamDiv) {
        const partial=streamDiv.dataset.copy || chatText('Response stopped.','Réponse arrêtée.');
        setStreamContent(streamDiv,partial);
        streamText=partial;
        streamFinalized=true;
        streamDiv.dataset.copy=partial;
        messages.push({role:'assistant',content:partial});
        streamMessagePersisted=true;
      } else {
        const stopped=chatText('Response stopped.','Réponse arrêtée.');
        appendMsg('assistant',stopped);
        messages.push({role:'assistant',content:stopped});
      }
      conversationDirty=true;
      dispatchChatAgentEvent(runTrace,'run_error',{origin:'system',payload:{message:streamText || 'aborted'}});
      await saveCurrentConversation({immediate:true});
    } else {
      if(streamDiv) {
        const errorText=streamText || \`\${chatText('⚠ Error:','⚠ Erreur :')} \${err.message}\`;
        setStreamContent(streamDiv,errorText);
        streamText=errorText;
        streamFinalized=true;
        messages.push({role:'assistant',content:errorText});
        streamMessagePersisted=true;
      } else {
        appendMsg('assistant',\`\${chatText('⚠ Error:','⚠ Erreur :')} \${err.message}\`);
      }
      dispatchChatAgentEvent(runTrace,'run_error',{origin:'system',payload:{message:err.message}});
      notify(err.message,'e');
      conversationDirty=true;
      await saveCurrentConversation({immediate:true});
    }
  } finally {
    if(streamDiv && !streamFinalized && streamClearSeq===clearChatSeq) {
      const finalText=streamText || (streamAbortController?.signal.aborted ? chatText('Response stopped.','Réponse arrêtée.') : '');
      setStreamContent(streamDiv,finalText);
      if(finalText && !streamMessagePersisted) {
        messages.push({role:'assistant',content:finalText});
        conversationDirty=true;
        await saveCurrentConversation({immediate:true});
      }
    }
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
  fetch('/api/llm-config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    baseUrl:cfg.baseUrl,
    apiKey:cfg.apiKey,
    model:cfg.model,
    temperature:Number(cfg.temp),
  })}).catch(()=>{});
  if (cfg.apiKey) flashSaved('llm-saved');
}

async function resetYamlConfig() {
  const wc = window.__WIKI_CONFIG__;
  let cfg = wc;
  try {
    const res=await fetch('/api/llm-config',{cache:'no-store'});
    if(res.ok) cfg=await res.json();
  } catch {}
  localStorage.removeItem(storageKey('mcpchat_config'));
  if(cfg?.baseUrl) $('base-url').value=cfg.baseUrl;
  if(cfg?.apiKey!==undefined) $('api-key').value=cfg.apiKey||'';
  if(cfg?.model) $('model-name').value=cfg.model;
  if(cfg?.temperature!==undefined) $('temperature').value=String(cfg.temperature);
  syncModel();
  flashSaved('llm-saved');
}

// ── LocalStorage (user-added servers only) ──────────────────────────────────

function storageKey(key) {
  const scope = window.__WIKI_CONFIG__?.storageScope;
  return scope ? \`\${key}:\${scope}\` : key;
}

const LS = {USER_SERVERS: storageKey('mcpchat_user_servers')};

function saveServers() {
  const defaults = window.__WIKI_CONFIG__?.mcpServers || [];
  const data = servers.map(s => {
    const inDefaults = defaults.some(d => d.name === s.name);
    return {id:s.id,name:s.name,url:s.url,bearer:inDefaults?'':(s.bearer||''),enabled:s.enabled&&s.status==='ok',injected:s.injected};
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
    // Proxy mode defaults to .wikirc.yaml but keeps workspace-scoped browser overrides.
    if (wc.model) $('model-name').value = wc.model;
    if (wc.temperature !== undefined) $('temperature').value = String(wc.temperature);
    if (wc.baseUrl) $('base-url').value = wc.baseUrl;
    if (wc.apiKey)  { $('api-key').value = wc.apiKey; flashSaved('llm-saved'); }
  } else {
    // CLI mode: load from localStorage
    if (saved.baseUrl) $('base-url').value = saved.baseUrl;
    if (saved.apiKey)  { $('api-key').value = saved.apiKey; flashSaved('llm-saved'); }
    if (saved.model)   $('model-name').value = saved.model;
    if (saved.temp !== undefined) $('temperature').value = saved.temp;
  }
  if (saved.baseUrl) $('base-url').value = saved.baseUrl;
  if (saved.apiKey)  { $('api-key').value = saved.apiKey; flashSaved('llm-saved'); }
  if (saved.model)   $('model-name').value = saved.model;
  if (saved.temp !== undefined) $('temperature').value = saved.temp;
  $('system-prompt').value = localStorage.getItem(storageKey('mcpchat_system_prompt')) ?? window.__WIKI_CONFIG__?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
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
        const injected = override ? true : (s.injected === true);
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
renderProductionTrace();
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
