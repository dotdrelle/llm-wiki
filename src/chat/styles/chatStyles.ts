import { WIKI_CSS_VARS, WIKI_FONT_STACK, WIKI_MONO_STACK } from '../theme.ts'; const CHAT_COMPONENT_CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans);background:var(--bg);color:var(--text);height:100vh;display:flex;overflow:hidden}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

/* SHELL: left tabs + right rail (no top bar) */
.shell-tabs{display:flex;align-items:center;gap:6px;height:54px;padding:0 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.shell-tab{flex:1;height:30px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--muted);cursor:pointer;font-family:var(--font-sans);font-size:12px;font-weight:800;transition:border-color .2s,color .2s,background .2s}
.shell-tab svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.shell-tab-glyph{font-size:15px;line-height:1;font-weight:400}
.shell-tab:hover{border-color:var(--accent);color:var(--accent)}
.shell-tab.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
#wiki-side-host{display:none;flex:1;min-height:0}
#wiki-side-host iframe{display:block;width:100%;height:100%;border:0;background:var(--bg)}
body.left-wiki .sb-logo,body.left-wiki .sb-scroll{display:none}
body.left-wiki #wiki-side-host{display:block}
#right-rail{order:3;width:40px;min-width:40px;height:100vh;background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:10px;flex-shrink:0}
body.center-wiki #right-rail{padding-top:10px}
.rail-btn{position:relative;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--muted);cursor:pointer;font-family:var(--font-sans);font-size:14px;font-weight:800;transition:border-color .2s,color .2s,background .2s}
.rail-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.rail-badge{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;border-radius:99px;background:var(--accent);color:#fff;font-size:9px;line-height:14px;text-align:center;padding:0 3px;display:none}
.rail-badge.show{display:block}

/* SIDEBAR */
#sidebar{width:var(--sidebar-w,300px);min-width:var(--sidebar-w,300px);height:100vh;background:var(--panel);display:flex;flex-direction:column;overflow:hidden;transition:width .3s,min-width .3s}
#sidebar.collapsed{width:0;min-width:0}
.main-resizer{width:6px;cursor:col-resize;display:flex;align-items:center;justify-content:center;border-left:1px solid var(--border);border-right:1px solid var(--border);background:var(--panel);touch-action:none;flex-shrink:0;height:100vh}
.main-resizer:hover,.main-resizer.dragging{background:var(--panel-soft)}
.main-resizer::before{content:'';width:3px;height:34px;border-radius:99px;background:var(--border)}
.main-resizer:hover::before,.main-resizer.dragging::before{background:var(--muted)}
.sb-logo{padding:18px 16px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px}
.sb-logo-mark{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--muted);font-weight:400;flex-shrink:0}
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
#main{flex:1;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
#wiki-view{flex:1;min-height:0;display:none}
#wiki-view iframe{display:block;width:100%;height:100%;border:0;background:var(--bg)}
body.center-wiki:not(.connectors-mode):not(.execution-mode) #wiki-view{display:block}
body.center-wiki:not(.connectors-mode):not(.execution-mode) #topbar,
body.center-wiki:not(.connectors-mode):not(.execution-mode) #messages,
body.center-wiki:not(.connectors-mode):not(.execution-mode) #input-wrap{display:none}
#wiki-split-resizer{display:none}
#cmdk-backdrop{position:fixed;inset:0;z-index:220;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
#cmdk-backdrop[hidden]{display:none}
#cmdk{width:min(560px,92vw);background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden;display:flex;flex-direction:column}
.cmdk-input-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}
.cmdk-input-row svg{width:16px;height:16px;flex:none;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round}
#cmdk-input{flex:1;border:0;background:none;color:var(--text);font:500 .95rem var(--font-sans);outline:none}
#cmdk-results{max-height:46vh;overflow-y:auto;padding:6px}
.cmdk-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;color:var(--text);font-family:var(--font-sans);padding:8px 10px;border-radius:8px;cursor:pointer}
.cmdk-item.is-sel{background:var(--accent-soft);color:var(--accent)}
.cmdk-item-title{font-size:.88rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmdk-item-sub{font-size:.72rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmdk-item-body{flex:1;min-width:0}
.cmdk-tag{flex:none;font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:5px;padding:2px 6px}
.cmdk-empty{padding:18px;text-align:center;font-size:.85rem;color:var(--muted)}
.cmdk-hint{display:flex;gap:14px;padding:8px 14px;border-top:1px solid var(--border);font-size:.7rem;color:var(--muted)}
.cmdk-hint kbd{font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);border-radius:4px;padding:0 4px}
body.iframe-drag iframe{pointer-events:none}
#split-toggle.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
@media (min-width:900px){
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #main{display:grid;grid-template-columns:minmax(280px,var(--split-wiki-w,50%)) 6px minmax(340px,1fr);grid-template-rows:auto minmax(0,1fr) auto}
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #wiki-view{display:block;grid-column:1;grid-row:1/4;min-width:0;border-right:1px solid var(--border)}
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #wiki-split-resizer{display:block;grid-column:2;grid-row:1/4;cursor:col-resize;background:transparent;transition:background .15s}
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #wiki-split-resizer:hover,
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #wiki-split-resizer.dragging{background:var(--accent)}
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #topbar{display:flex;grid-column:3;grid-row:1;min-width:0}
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #messages{display:flex;grid-column:3;grid-row:2;min-width:0;padding:28px clamp(12px,2vw,28px) 22px}
body.split-wiki.center-wiki:not(.connectors-mode):not(.execution-mode) #input-wrap{display:flex;grid-column:3;grid-row:3;min-width:0}
}
#topbar{min-height:54px;padding:6px 18px;border-bottom:1px solid var(--border);background:var(--panel);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tb-model{font-family:var(--font-mono);font-size:11px;color:var(--muted2);background:var(--panel-soft);border:1px solid var(--border);padding:4px 10px;border-radius:99px}
.sec-label-actions{display:flex;align-items:center;gap:6px}
.tb-profile-select{display:none;max-width:130px;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--muted2);font-size:11px;padding:2px 8px;font-family:var(--font-sans);font-weight:600}
.tb-profile-select.visible{display:inline-block}
.tb-profile-select:disabled{opacity:.55;cursor:not-allowed}
.tb-mcps{display:flex;gap:5px;flex-wrap:wrap}
.tb-mcp-pill{font-size:10px;font-family:var(--font-mono);font-weight:500;padding:3px 8px;border-radius:99px;background:rgba(79,126,255,.12);border:1px solid rgba(79,126,255,.25);color:var(--accent)}
.tb-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.tb-clear,.tb-system{background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);height:30px;display:inline-flex;align-items:center;padding:0 12px;cursor:pointer;font-size:12px;font-family:var(--font-sans);font-weight:600;transition:all .2s}
.tb-clear:hover{border-color:var(--err);color:var(--err)}
.tb-system:hover,.tb-system.active{border-color:var(--accent);color:var(--accent)}
body.connectors-mode #messages,body.connectors-mode #input-wrap,body.connectors-mode #execution-view{display:none}
body.connectors-mode #connectors-view{display:block}
body:not(.connectors-mode) #connectors-view{display:none}
body.execution-mode #messages,body.execution-mode #input-wrap,body.execution-mode #connectors-view{display:none}
body.execution-mode #execution-view{display:flex}
body:not(.execution-mode) #execution-view{display:none}
.connectors-view{flex:1;min-height:0;overflow:auto;padding:28px clamp(18px,4vw,48px)}
.execution-view{flex:1;min-height:0;overflow:hidden;padding:20px clamp(14px,3vw,34px);flex-direction:column;gap:14px}
.execution-head{display:flex;flex-direction:column;flex-shrink:0}
.execution-head h1{font-size:20px;line-height:1.2;margin:0;color:var(--text)}
.execution-head p{font-size:12px;color:var(--muted);line-height:1.45;margin:4px 0 0;max-width:680px}
#runtime-graph-center{flex:1;min-height:0}
#runtime-graph-center .runtime-graph-main{height:100%}
#runtime-graph-center .runtime-graph-svg{height:calc(100vh - 168px)}
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
.msg.msg-hidden{display:none}
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
@keyframes upload-pulse{0%,100%{opacity:1}50%{opacity:.45}}
/* ACTIVITY PANEL */
#activity-panel{order:2;width:360px;min-width:360px;height:100vh;background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;transition:width .25s,min-width .25s;flex-shrink:0}
#activity-panel.closed{width:0;min-width:0}
#help-panel{order:2;width:360px;min-width:360px;height:100vh;background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;transition:width .25s,min-width .25s;flex-shrink:0}
#help-panel.closed{width:0;min-width:0}
.help-panel-actions{display:flex;gap:4px;align-items:center}
#help-body{padding:12px 14px;overflow-y:auto}
.help-toc-item{display:block;width:100%;text-align:left;background:var(--panel-soft);border:1px solid var(--border);border-radius:8px;padding:9px 11px;margin:0 0 7px;font:inherit;font-weight:600;color:var(--text);cursor:pointer}
.help-toc-item:hover{border-color:var(--accent)}
.help-article{font-size:.9rem;line-height:1.55}
.help-article h1{font-size:1.15rem;margin:.1rem 0 .6rem}
.help-article h2{font-size:1rem;margin:1rem 0 .4rem}
.help-article ul,.help-article ol{padding-left:1.2rem}
.help-article code{background:var(--panel-soft);padding:1px 5px;border-radius:4px;font-size:.85em}
.help-article table{border-collapse:collapse;width:100%;font-size:.85em}
.help-article th,.help-article td{border:1px solid var(--border);padding:4px 8px;text-align:left}
.help-article a{color:var(--accent)}
.help-loading{color:var(--muted);padding:6px 2px}
.act-panel-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0;min-height:44px}
.act-panel-title{font-size:13px;font-weight:800;color:var(--text)}
.act-view-tabs{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:7px;background:var(--panel-soft);margin-left:auto;margin-right:8px}
.act-view-tab{border:0;border-radius:5px;background:transparent;color:var(--muted);font:800 10px var(--font-sans);padding:4px 7px;cursor:pointer}
.act-view-tab.active{background:var(--panel);color:var(--text);box-shadow:0 0 0 1px var(--border)}
.act-view-tab:hover{color:var(--accent)}
.act-clear-all{flex:none;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--muted);font:700 9px var(--font-sans);padding:5px 7px;cursor:pointer;white-space:nowrap;margin-right:3px}.act-clear-all:hover{border-color:var(--err);color:var(--err)}
.act-panel-close{background:none;border:none;cursor:pointer;color:var(--muted);padding:2px 6px;border-radius:6px;font-size:16px;line-height:1}
.act-panel-close:hover{color:var(--text);background:var(--panel-soft)}
.act-body{flex:1;overflow-y:auto;padding:10px 10px 18px;display:flex;flex-direction:column;gap:10px}
.act-body>*{flex-shrink:0}
.act-body.activity-list-mode{overflow:hidden}.activity-subtabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;flex:none}.activity-subtab{min-width:0;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--muted);font:800 9px var(--font-sans);padding:5px 3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}.activity-subtab:hover,.activity-subtab.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}.activity-subtab.has-error{border-color:color-mix(in srgb,var(--err) 55%,var(--border));color:var(--err)}.activity-subtab.has-running{border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}.activity-subtab-content{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}.activity-subtab-content>.act-card+.act-card{margin-top:6px}.activity-subtab-logs{display:flex;flex-direction:column;overflow:hidden}.activity-subtab-logs .runtime-log-filters{flex:none}.activity-subtab-logs .runtime-log{flex:1;min-height:0;max-height:none}
.act-section-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 6px}
.act-section-title{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.act-dismiss-all{font-size:10px;color:var(--muted);background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:4px}
.act-dismiss-all:hover{color:var(--text);background:var(--panel-soft)}
.activity-subtab-toolbar{display:flex;align-items:center;justify-content:space-between;padding:0 4px 7px}.activity-subtab-toolbar-title{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.activity-subtab-actions{display:flex;align-items:center;gap:4px}.activity-subtab-clear,.activity-subtab-reset{border:0;background:none;color:var(--muted);font:700 10px var(--font-sans);cursor:pointer;padding:2px 4px;border-radius:4px}.activity-subtab-clear:hover{color:var(--err);background:color-mix(in srgb,var(--err) 8%,transparent)}.activity-subtab-reset{border:1px solid var(--border);color:var(--muted);padding:3px 6px}.activity-subtab-reset:hover{background:var(--panel-soft);border-color:var(--muted);color:var(--text)}
.act-empty{font-size:12px;color:var(--muted2);text-align:center;padding:22px 10px;line-height:1.5}
.act-empty-btn{margin-top:10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font-size:12px;font-weight:700;font-family:var(--font-sans);padding:8px 10px;cursor:pointer}
.act-empty-btn:hover{border-color:var(--accent);color:var(--accent)}
.act-card{background:var(--panel-soft);border:1px solid var(--border);border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;gap:7px}
.act-card.running{border-color:color-mix(in srgb,var(--accent) 35%,var(--border))}
.act-card-head{display:flex;align-items:flex-start;gap:8px}
.act-card-icon{font-size:16px;flex-shrink:0;margin-top:1px;line-height:1}
.act-card-info{flex:1;min-width:0}
.act-card-name{font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.act-card-meta{font-size:10px;color:var(--muted);margin-top:1px}
.act-badge{font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;flex-shrink:0;margin-top:2px}
.act-badge.running{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.act-badge.done{background:color-mix(in srgb,#22c55e 14%,transparent);color:#16a34a}
.act-badge.stored{background:color-mix(in srgb,#f59e0b 14%,transparent);color:#b45309}
.act-badge.failed{background:color-mix(in srgb,var(--err) 14%,transparent);color:var(--err)}
.act-badge.cancelled{background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--muted)}
.act-steps{display:flex;flex-direction:column;gap:3px}
.act-step{display:flex;align-items:center;gap:6px;font-size:11px}
.act-step-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.act-step.done .act-step-dot{background:#22c55e}
.act-step.running .act-step-dot{background:var(--accent);animation:upload-pulse 1.2s ease-in-out infinite}
.act-step.pending .act-step-dot,.act-step.failed .act-step-dot{background:var(--border)}
.act-step.failed .act-step-dot{background:var(--err)}
.act-step-label{flex:1;color:var(--text)}
.act-step.pending .act-step-label{color:var(--muted)}
.act-step.failed .act-step-label{color:var(--err)}
.act-step-val{font-size:10px;color:var(--muted);font-family:var(--font-mono)}
.act-step.done .act-step-val{color:#16a34a}
.act-step.running .act-step-val{color:var(--accent)}
.act-output{font-size:10px;color:var(--muted);font-family:var(--font-mono);background:var(--panel-deep);border-radius:5px;padding:4px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;title:attr(title)}
.act-output:hover{color:var(--text)}
.act-error{font-size:10px;color:var(--err);font-family:var(--font-mono);background:color-mix(in srgb,var(--err) 8%,transparent);border-radius:5px;padding:5px 7px;word-break:break-all}
.act-actions{display:flex;gap:5px;justify-content:flex-end}
.act-btn{font-size:10px;font-weight:700;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--muted);padding:4px 9px;cursor:pointer;font-family:var(--font-sans)}
.act-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.act-btn.del:hover{border-color:var(--err);color:var(--err);background:color-mix(in srgb,var(--err) 8%,transparent)}
.runtime-status{font-size:10px;color:var(--muted);font-family:var(--font-mono);padding:0 4px 6px}
.runtime-log-filters{margin:0 0 7px}.runtime-log-filters input{width:100%;border:1px solid var(--border);border-radius:8px;background:var(--panel-deep);color:var(--text);font:11px var(--font-mono);padding:6px 8px}.runtime-log{font-family:var(--font-mono);font-size:10px;line-height:1.4;color:var(--muted2);background:var(--panel-deep);border:1px solid var(--border);border-radius:8px;padding:7px 8px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow-y:auto;overscroll-behavior:contain}.runtime-log .rt-log-time{color:var(--accent)}.runtime-log.empty{color:var(--muted)}.runtime-choice-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.runtime-graph-shell{min-height:100%;display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:8px}
.runtime-graph-main,.runtime-graph-inspector{min-width:0;border:1px solid var(--border);border-radius:10px;background:var(--panel-soft);overflow:hidden}
.runtime-graph-main{display:flex;flex-direction:column}
.runtime-graph-toolbar{height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 9px;border-bottom:1px solid var(--border);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.runtime-graph-toolbar button{border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--muted);font:800 10px var(--font-sans);padding:3px 7px;cursor:pointer}
.runtime-graph-toolbar>span:last-child{display:flex;gap:5px}
.runtime-graph-toolbar button:hover{border-color:var(--accent);color:var(--accent)}
.runtime-graph-legend{display:flex;flex-wrap:wrap;gap:5px 10px;padding:6px 9px;border-bottom:1px solid var(--border);font-size:9px;color:var(--muted)}
.runtime-graph-legend span{display:inline-flex;align-items:center;gap:4px}.runtime-graph-legend b{font-size:8px;text-transform:uppercase;letter-spacing:.06em}.runtime-graph-legend i{width:18px;border-top:2px solid var(--border)}.runtime-graph-legend i.depends_on{border-color:var(--accent);border-top-style:dashed}.runtime-graph-legend i.executed_by{border-color:#14b8a6}.runtime-graph-legend i.produces{border-color:#16a34a}.runtime-graph-legend i.bubble{width:8px;height:8px;border:0;border-radius:50%}.runtime-graph-legend i.running{background:#4f7eff}.runtime-graph-legend i.done{background:#22c55e}.runtime-graph-legend i.failed{background:#f06b6b}.runtime-graph-legend i.approval{background:#f59e0b}.runtime-graph-legend i.run{background:#8b5cf6}.runtime-graph-legend i.activity{background:#14b8a6}.runtime-graph-legend i.neutral{background:color-mix(in srgb,var(--muted) 42%,var(--panel))}
.runtime-graph-svg{display:block;width:100%;height:520px;background:radial-gradient(circle at 50% 50%,var(--panel),transparent 66%)}
.runtime-graph-link{stroke:var(--border);stroke-width:1.2;opacity:.72}
.runtime-graph-link.depends_on{stroke-dasharray:4 4;stroke:var(--accent)}
.runtime-graph-link.executed_by{stroke:#14b8a6}
.runtime-graph-link.produces{stroke:#16a34a}
.runtime-graph-link.is-highlighted{opacity:1;stroke:var(--text);stroke-width:2.2}
.runtime-graph-link.is-dimmed{opacity:.18}
.runtime-graph-lane{fill:var(--muted);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
.runtime-graph-node{cursor:pointer}
.runtime-graph-node circle{stroke:var(--panel);stroke-width:3;filter:drop-shadow(0 2px 3px rgba(0,0,0,.18))}
.runtime-graph-node.selected circle{stroke:var(--text);stroke-width:5}
.runtime-graph-node.is-related circle{stroke:var(--text);stroke-width:4}
.runtime-graph-node.is-dimmed{opacity:.32}
.runtime-graph-node text{fill:var(--text);font-size:10px;font-weight:800;paint-order:stroke;stroke:var(--panel);stroke-width:4px}
.runtime-graph-inspector{padding:10px;overflow:hidden;display:flex;flex-direction:column}
.runtime-inspector-title{font-size:12px;font-weight:850;color:var(--text);line-height:1.25;overflow-wrap:anywhere}
.runtime-inspector-meta{margin-top:3px;font:700 10px var(--font-mono);color:var(--muted)}
.runtime-inspector-dl{display:grid;grid-template-columns:42px minmax(0,1fr);gap:5px 7px;margin:10px 0;font-size:10px}
.runtime-inspector-dl dt{color:var(--muted);font-weight:800}
.runtime-inspector-dl dd{color:var(--text);font-family:var(--font-mono);overflow-wrap:anywhere}
.runtime-inspector-section{border-top:1px solid var(--border);padding-top:8px;margin-top:8px;flex-shrink:0}
.runtime-inspector-section:last-child{flex:1;display:flex;flex-direction:column;min-height:0}
.runtime-inspector-heading{font-size:10px;font-weight:850;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;flex-shrink:0}
.runtime-inspector-rel{font-size:10px;line-height:1.35;color:var(--muted2);overflow-wrap:anywhere}
.runtime-inspector-section pre{overflow:auto;white-space:pre-wrap;font:10px/1.45 var(--font-mono);color:var(--muted2);background:var(--panel-deep);border:1px solid var(--border);border-radius:7px;padding:7px}
.runtime-inspector-section:last-child pre{flex:1;min-height:100px}
.runtime-inspector-section pre .rt-log-time{color:var(--accent)}
.runtime-graph-empty{font-size:12px;color:var(--muted);padding:12px;line-height:1.45}
@media (max-width: 980px){.runtime-graph-shell{grid-template-columns:1fr}.runtime-graph-svg{height:420px}}
.tb-act-btn{position:relative;background:none;border:1px solid var(--border);border-radius:8px;color:var(--muted);height:30px;padding:0 10px;cursor:pointer;font-size:12px;font-family:var(--font-sans);font-weight:700;display:flex;align-items:center;gap:5px;transition:all .2s}
.tb-act-btn:hover,.tb-act-btn.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.tb-act-badge{min-width:16px;height:16px;border-radius:99px;background:var(--accent);color:#fff;font-size:9px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 4px;margin-left:2px}
.tb-act-badge.visible{display:flex}
@media(max-width:900px){#activity-panel,#help-panel{position:fixed;top:0;right:40px;width:min(92vw,360px);min-width:0;height:100vh;margin-top:0;z-index:999;box-shadow:-4px 0 24px rgba(0,0,0,.18);transform:translateX(0);transition:transform .25s,width .25s}#activity-panel.closed,#help-panel.closed{width:min(92vw,360px);min-width:0;transform:translateX(calc(100% + 40px))}}
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
/* OBS CARD */
.obs-wrap{display:flex;flex-direction:column;gap:6px}
.obs-chip{font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--muted);text-transform:uppercase}
.obs-card{background:var(--panel-soft);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-family:var(--font-sans)}
.obs-card-head{display:flex;align-items:center;justify-content:space-between;padding:7px 11px;border-bottom:1px solid var(--border);background:var(--panel)}
.obs-tool-name{font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--text)}
.obs-badge{font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;flex-shrink:0}
.obs-badge.ok{background:color-mix(in srgb,#22c55e 14%,transparent);color:#16a34a}
.obs-badge.fail{background:color-mix(in srgb,var(--err) 14%,transparent);color:var(--err)}
.obs-badge.run{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.obs-badge.queue{background:color-mix(in srgb,var(--accent) 9%,transparent);color:var(--muted2)}
.obs-badge.warn{background:color-mix(in srgb,#f59e0b 14%,transparent);color:#b45309}
.obs-kv-grid{display:grid;grid-template-columns:max-content 1fr;padding:4px 0}
.obs-k{font-family:var(--font-mono);font-size:10px;color:var(--muted);padding:3px 8px 3px 11px;white-space:nowrap;align-self:start}
.obs-v{font-family:var(--font-mono);font-size:11px;color:var(--text);padding:3px 11px 3px 0;word-break:break-all;align-self:start}
.obs-action-hint{font-size:11px;color:var(--accent);padding:6px 11px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--accent) 5%,transparent)}
.obs-error-hint{font-size:11px;color:var(--err);padding:6px 11px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--err) 5%,transparent)}
.obs-list{padding:4px 11px 8px;display:flex;flex-direction:column;gap:3px}
.obs-list-item{font-size:11px;color:var(--text);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
.runtime-thinking{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px}
.runtime-thinking .typing{flex:none}
@keyframes boing{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
#empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted)}
#empty .em-icon{font-size:36px;opacity:.6}
#empty h2{font-size:17px;font-weight:800;color:var(--muted2)}
#empty p{font-size:12px;text-align:center;max-width:260px;line-height:1.7;color:var(--muted)}
.empty-actions{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:10px;margin-top:8px;width:min(620px,100%)}
.empty-tile{border:1px solid var(--border);border-radius:10px;background:var(--panel);box-shadow:var(--shadow);padding:13px 14px;text-align:left;color:var(--text);cursor:pointer;font-family:var(--font-sans);transition:border-color .18s,transform .18s,box-shadow .18s}
.empty-tile:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 10px 24px rgba(15,23,42,.09)}
.empty-tile.wide{grid-column:1/-1}
.empty-tile-title{display:block;font-size:13px;font-weight:800;margin-bottom:4px}
.empty-tile-desc{display:block;font-size:11px;line-height:1.45;color:var(--muted)}
@media(max-width:640px){.empty-actions{grid-template-columns:1fr}}

/* INPUT */
#input-wrap{padding:12px 18px 14px;background:linear-gradient(to top,var(--panel) 82%,rgba(255,255,255,0));display:flex;flex-direction:column;align-items:center}
#page-context-chips{width:min(900px,100%);display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:5px;margin:0 0 6px;align-self:center;box-sizing:border-box}
#page-context-chips[hidden]{display:none}
.page-context-chip{min-width:0;max-width:min(360px,100%);display:inline-flex;align-items:center;gap:5px;padding:4px 7px 4px 9px;border:1px solid var(--border);border-radius:14px;background:var(--panel-soft);font-size:.75rem;color:var(--muted)}
.page-context-chip svg{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:2}
.page-context-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.page-context-clear{flex:none;border:0;background:none;color:var(--muted);cursor:pointer;font-size:.9rem;line-height:1;padding:0 1px}
.page-context-clear:hover{color:var(--fg)}
.input-box{position:relative;width:min(900px,100%);display:flex;flex-direction:column;gap:8px;background:var(--panel-soft);border:1px solid var(--border);border-radius:24px;padding:12px 14px 10px 18px;box-shadow:0 8px 24px rgba(0,0,0,.05);transition:border-color .2s,box-shadow .2s,background .2s}
.input-actions{display:flex;align-items:center;gap:8px}
.input-actions-spacer{flex:1}
.input-box.agent-on{background:var(--accent-soft);border-color:var(--accent)}
.input-box.agent-on:focus-within{border-color:var(--accent)}
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
#chat-input{flex:none;width:100%;background:none;border:none;color:var(--text);font-family:var(--font-sans);font-size:15px;resize:none;max-height:180px;overflow-y:auto;line-height:1.55;outline:none;padding:4px 0}
#chat-input::placeholder{color:var(--muted)}
.attach-btn{background:transparent;border:1px solid var(--border);border-radius:50%;width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted);transition:border-color .2s,color .2s,background .2s}
.attach-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--panel)}
.attach-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.agent-mode-btn{border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:7px 9px;cursor:pointer;font-family:var(--font-sans);transition:border-color .2s,color .2s,background .2s}
.agent-mode-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--panel)}
.agent-mode-btn.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.agent-mode-btn.disabled{opacity:.45;cursor:not-allowed}
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
.prompt-drawer{position:fixed;top:0;left:0;right:0;bottom:0;z-index:997;pointer-events:none}
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
hr.divider{border:none;border-top:1px solid var(--border);margin:8px 12px}`; export const CHAT_STYLE = `<style>
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
:root.theme-light{--panel-deep:#e2e8f0;--ok:#1a8a5a;--err:#c0392b;--warn:#c7a800}
:root.theme-dark{--panel-deep:#1a2330;--ok:#2dd4a0;--err:#f06b6b;--warn:#f5c842}
${CHAT_COMPONENT_CSS}
</style>`;
