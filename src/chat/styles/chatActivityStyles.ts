/** Activity/help side-panel styles, split from chatStyles.ts (size guard). */
export const CHAT_ACTIVITY_CSS = `/* ACTIVITY PANEL */
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
.act-body.activity-list-mode{overflow:hidden}.activity-subtabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;flex:none;margin-bottom:8px}.activity-subtab{min-width:0;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--muted);font:800 9px var(--font-sans);padding:5px 3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}.activity-subtab:hover,.activity-subtab.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}.activity-subtab.has-error{border-color:color-mix(in srgb,var(--err) 55%,var(--border));color:var(--err)}.activity-subtab.has-running{border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}.activity-subtab-content{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}.activity-subtab-content>.act-card+.act-card{margin-top:6px}.activity-subtab-logs{display:flex;flex-direction:column;overflow:hidden}.activity-subtab-logs .runtime-log-filters{flex:none}.activity-subtab-logs .runtime-log{flex:1;min-height:0;max-height:none}
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
.stream-cursor::after{content:'▋';animation:blink .8s step-end infinite;color:var(--accent);margin-left:1px}`;
