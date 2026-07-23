export const communityViewStyles = `
.community-v3-envelope{cursor:pointer;transition:opacity .18s}
.community-v3-halo{stroke-width:2;fill-opacity:.16;transition:r .2s,fill-opacity .2s}
.community-v3-envelope.is-expanded .community-v3-halo{fill-opacity:.1;stroke-width:3}
.community-v3-title,.community-v3-count,.community-v3-edge-count,.community-v3-node-label,.community-v3-node-number{paint-order:stroke;stroke:var(--bg);stroke-width:4px;stroke-linejoin:round;pointer-events:none}
.community-v3-title{font-size:14px;font-weight:800;text-anchor:middle;fill:var(--text)}
.community-v3-count{font-size:10px;text-anchor:middle;fill:var(--muted)}
.community-v3-edge{stroke:var(--muted);stroke-opacity:.48;fill:none}
.community-v3-edge-count{font-size:10px;text-anchor:middle;fill:var(--muted)}
.community-v3-detail-edge{stroke:var(--muted);stroke-opacity:.18;fill:none;stroke-width:1.2}
.community-v3-detail-edge.is-selected{stroke:var(--accent);stroke-opacity:1;stroke-width:2.8}
.community-v3-node{cursor:pointer}
.community-v3-node-number{fill:var(--text);font-size:8px;font-weight:800;text-anchor:middle;dominant-baseline:central}
.community-v3-node-label{font-size:10px;fill:var(--text);text-anchor:middle}
.community-v3-root[data-zoom-tier="far"] .community-v3-node-label{display:none}
.community-v3-root[data-zoom-tier="medium"] .community-v3-node-label:not(.is-important){display:none}
.community-v3-envelope.is-dimmed,.community-v3-edge.is-dimmed,.community-v3-node.is-dimmed{opacity:.09}
.community-v3-node.is-highlighted .community-v3-node-shape{stroke:var(--text);stroke-width:3;filter:drop-shadow(0 0 5px var(--accent))}
.community-v3-edge.is-highlighted{stroke:var(--accent);stroke-opacity:1}
.community-document-index-stack{position:absolute;z-index:5;right:12px;top:12px;width:min(310px,34%);max-height:calc(100% - 70px);display:flex;flex-direction:column;gap:8px;overflow:auto;overscroll-behavior:contain}
.community-document-index{flex:none;display:flex;max-height:260px;min-height:0;flex-direction:column;padding:10px;background:color-mix(in srgb,var(--community-color,var(--line)) 20%,var(--panel));border:1px solid var(--community-color,var(--line));border-radius:7px;box-shadow:0 10px 28px #0008,inset 0 0 0 1px color-mix(in srgb,var(--community-color,var(--line)) 18%,transparent)}
.community-document-index h4{flex:none;margin:0 0 8px;color:var(--community-color,var(--text))}.community-document-index-list{min-height:0;overflow:auto;overscroll-behavior:contain}
.community-document-index button{display:grid;width:100%;grid-template-columns:28px minmax(0,1fr);gap:7px;align-items:start;border:0;background:color-mix(in srgb,var(--community-color,var(--line)) 8%,var(--panel));padding:5px;text-align:left;color:var(--text)}.community-document-index button:hover,.community-document-index button.selected{background:color-mix(in srgb,var(--community-color,var(--line)) 24%,var(--panel));color:var(--text)}
.community-document-index-number{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--color);color:#fff;font-size:10px;font-weight:800}.community-document-index-name{overflow-wrap:anywhere;line-height:1.25}
`;
