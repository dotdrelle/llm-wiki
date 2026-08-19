export const canvasExplorerStyles = String.raw`
.graph-explorer-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:move;background:#070a10}
.graph-explorer-a11y{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.graph-explorer-canvas:focus-visible{outline:2px solid #75aff5;outline-offset:-2px}
/* Header common to both levels of the panel. */
.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex:none;padding:2px 22px 8px 2px;border-bottom:1px solid #ffffff14;margin-bottom:6px}
.panel-head>div{display:flex;min-width:0;flex-direction:column;gap:2px}
.panel-head small{font-size:9.5px;font-weight:500;letter-spacing:.12em;color:#75aff5}
.panel-head strong{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel-head span{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.document-focus-list{min-height:0;overflow:auto;padding:8px}.focus-document-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent)}.focus-document-name{display:flex;min-width:0;flex-direction:column;align-items:flex-start;border:0;background:transparent;text-align:left}.focus-document-name span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.focus-document-name small{color:var(--muted)}.focus-document-actions{display:flex;gap:4px}.focus-document-actions button{display:grid;width:30px;height:30px;padding:6px;place-items:center}.focus-document-actions svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}.focus-document-actions button[data-send-doc]{color:#75aff5}.focus-document-actions button.done{color:#54d28b;border-color:#54d28b}
/* Context card: laid above the canvas, below the inspector in layer order —
   it is a glance, not a panel that takes over. */
.graph-context-card{position:absolute;z-index:4;width:290px;max-height:min(72vh,460px);overflow:hidden;display:flex;flex-direction:column;gap:8px;padding:11px 12px;border:1px solid #ffffff20;border-radius:11px;background:#0b0d13e8;backdrop-filter:blur(12px);box-shadow:0 16px 40px #000b}
.graph-context-card[hidden]{display:none}
.graph-context-card .gcc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;cursor:grab;touch-action:none}
.graph-context-card .gcc-head:active{cursor:grabbing}
.graph-context-card .gcc-head>div{display:flex;min-width:0;flex-direction:column;gap:2px}
.graph-context-card small{font-size:9px;font-weight:600;letter-spacing:.13em;color:#75aff5}
.graph-context-card strong{font-size:12.5px;font-weight:500;color:#e9eef7;overflow-wrap:anywhere;line-height:1.3}
.graph-context-card .gcc-head span{font-size:10px;color:var(--muted)}
.graph-context-card [data-close-context]{flex:none;padding:0 5px;font-size:15px;line-height:1.2;background:transparent;border-color:transparent;color:var(--muted)}
.graph-context-card .gcc-body{margin:0;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;font-size:11.5px;line-height:1.55;color:#c3cddc;overflow-wrap:anywhere}
.graph-context-card .gcc-list{margin:0;padding:0 0 0 16px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:3px;list-style:disc}
.graph-context-card .gcc-list li{font-size:11.5px;line-height:1.45;color:#c3cddc;overflow-wrap:anywhere}
.graph-context-card .gcc-body.pending{color:var(--muted);font-style:italic}
.graph-context-card .gcc-actions{display:flex;gap:6px}
.graph-context-card .gcc-actions button{flex:1;padding:.32rem .5rem;font-size:10.5px;white-space:nowrap}
.graph-context-card .gcc-actions .gcc-donna{flex:0 0 auto;display:grid;place-items:center;width:30px;padding:0;color:#75aff5}
.graph-context-card .gcc-actions .gcc-donna svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2}
body.theme-light .graph-context-card{background:#fffffff0;border-color:#0000001f}
body.theme-light .graph-context-card strong{color:#172433}
body.theme-light .graph-context-card .gcc-body{color:#33475e}
body.theme-light .graph-context-card .gcc-list li{color:#33475e}
@media(max-width:760px){.graph-breadcrumb{max-width:42vw}.graph-context-card{width:min(260px,70vw)}}
@media(prefers-reduced-motion:reduce){.graph-explorer-canvas{scroll-behavior:auto}}
`;
