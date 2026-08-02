export const canvasExplorerStyles = String.raw`
.graph-explorer-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:move;background:#070a10}
.graph-explorer-a11y{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.graph-explorer-canvas:focus-visible{outline:2px solid #75aff5;outline-offset:-2px}
/* En-tête commun aux deux niveaux du panneau. */
.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex:none;padding:2px 22px 8px 2px;border-bottom:1px solid #ffffff14;margin-bottom:6px}
.panel-head>div{display:flex;min-width:0;flex-direction:column;gap:2px}
.panel-head small{font-size:9.5px;font-weight:500;letter-spacing:.12em;color:#75aff5}
.panel-head strong{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel-head span{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel-head button{flex:none;padding:0 6px;font-size:16px;background:transparent;border-color:transparent}
.document-focus-list{min-height:0;overflow:auto;padding:8px}.focus-document-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent)}.focus-document-name{display:flex;min-width:0;flex-direction:column;align-items:flex-start;border:0;background:transparent;text-align:left}.focus-document-name span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.focus-document-name small{color:var(--muted)}.focus-document-actions{display:flex;gap:4px}.focus-document-actions button{display:grid;width:30px;height:30px;padding:6px;place-items:center}.focus-document-actions svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}.focus-document-actions button.done{color:#54d28b;border-color:#54d28b}
@media(max-width:760px){.graph-breadcrumb{max-width:42vw}}
@media(prefers-reduced-motion:reduce){.graph-explorer-canvas{scroll-behavior:auto}}
`;
