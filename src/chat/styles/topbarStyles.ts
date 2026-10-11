// The top bar's profile menu and connector status pill (topbarScript.ts).
export const TOPBAR_CSS = `.tb-model-wrap{position:relative}
.tb-model.switchable{cursor:pointer}
.tb-model.switchable:hover{border-color:var(--accent);color:var(--text)}
.tb-profile-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:60;min-width:180px;padding:4px;background:var(--panel);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow)}
.tb-profile-item{display:flex;align-items:center;gap:6px;width:100%;border:0;background:none;color:var(--text);font-size:12px;font-family:var(--font-sans);padding:6px 8px;border-radius:6px;cursor:pointer;text-align:left}
.tb-profile-item span{width:12px;color:var(--accent)}
.tb-profile-item:hover{background:var(--panel-soft)}
.tb-profile-item.active{font-weight:700}
.tb-profile-empty{font-size:12px;color:var(--muted);padding:6px 8px}
.tb-connectors{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-family:var(--font-mono);padding:4px 10px;border-radius:99px;border:1px solid var(--border);background:var(--panel-soft);color:var(--muted2);cursor:pointer}
.tb-connectors:hover{border-color:var(--accent);color:var(--text)}
.tb-dot{width:7px;height:7px;border-radius:50%;background:var(--muted2)}
.tb-connectors.ok .tb-dot{background:#16a34a}
.tb-connectors.warn{border-color:color-mix(in srgb,#d97706 55%,var(--border));color:#d97706}
.tb-connectors.warn .tb-dot{background:#d97706}`;
