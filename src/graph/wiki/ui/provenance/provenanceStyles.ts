/** Styles of the /provenance page: the approved mock-up's, on the app's theme classes. */
export const PROVENANCE_STYLES = String.raw`
/* Layout: one stage, five evidence columns read left to right (what built it → the deliverable → how it reached the proof → the proof). */
:root{
  --bg:#e9eef5;--stage:#f4f7fb;--panel:#ffffffe6;--text:#12202e;--muted:#5b6d82;--line:rgba(20,110,160,.22);
  --line-hi:#0e7fa8;--accent-soft:rgba(14,127,168,.12);
  --c-tpl:#8a63c9;--c-deliv:#0e7fa8;--c-pivot:#c98a12;--c-fiche:#4f7bb3;--c-raw:#3f9a57;
  --warn:#b26a00;--warn-soft:rgba(178,106,0,.12);--bad:#c0392b;--bad-soft:rgba(192,57,43,.1);
  --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  color-scheme:light}
html.theme-dark{
  --bg:#070b12;--stage:#0a1019;--panel:rgba(14,22,36,.92);--text:#e6eef7;--muted:#8fa3b8;--line:rgba(120,190,230,.2);
  --line-hi:#5fd0ff;--accent-soft:rgba(95,208,255,.14);
  --c-tpl:#b08cf0;--c-deliv:#5fd0ff;--c-pivot:#f1b52f;--c-fiche:#86a9d8;--c-raw:#66bd4b;
  --warn:#f1b52f;--warn-soft:rgba(241,181,47,.14);--bad:#ff7a6b;--bad-soft:rgba(255,122,107,.12);color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.45}
code{font-family:var(--mono);font-size:.92em}
.wrap{margin:0 auto;padding-block:16px 32px;padding-inline:16px;display:grid;gap:12px}
.header{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.titles{display:grid;gap:1px;min-width:0}
.titles small{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--line-hi);font-weight:600}
.titles h1{margin:0;font-size:16px;font-weight:600;text-wrap:balance}
.titles code{color:var(--muted);font-size:11.5px;overflow-wrap:anywhere}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{font:inherit;font-size:12.5px;padding:5px 10px;background:none;border:0;color:var(--muted);cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--accent-soft);color:var(--text);font-weight:600}
.seg button:disabled{cursor:not-allowed;opacity:.5}
.build{font-size:12px;color:var(--muted);display:inline-flex;gap:6px;align-items:center}
select{font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--stage);color:var(--text);max-width:320px}
.ghost{font:inherit;font-size:12.5px;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:none;color:var(--text);cursor:pointer;text-decoration:none}
button:focus-visible,select:focus-visible,a:focus-visible,.node:focus-visible,.row:focus-visible{outline:2px solid var(--line-hi);outline-offset:2px}
.banner{display:flex;gap:10px;align-items:flex-start;border-radius:10px;padding:9px 12px;font-size:13px;border:1px solid var(--line);background:var(--panel)}
.banner.live{border-color:var(--warn);background:var(--warn-soft)}
.banner.error{border-color:var(--bad);background:var(--bad-soft)}
.banner .dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--c-raw)}
.banner.live .dot{background:var(--warn)}.banner.error .dot{background:var(--bad)}
.banner ul{margin:4px 0 0;padding-left:18px;color:var(--muted)}
.banner li code{overflow-wrap:anywhere}
.stage-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--stage)}
.stage{position:relative;min-width:1180px;display:grid;grid-template-columns:1fr 1.15fr 1fr 1.05fr 1.25fr;gap:44px;padding:16px 22px 24px}
svg.edges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.col{display:flex;flex-direction:column;gap:10px;min-width:0;position:relative;z-index:1}
.col h3{margin:0 0 2px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between;gap:6px}
.col h3 small{font-weight:500;letter-spacing:0;text-transform:none}
.empty{font-size:11.5px;color:var(--muted);margin-top:-6px}
.prefixes{margin-top:6px;font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}
.node{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--kind);border-radius:9px;padding:8px 10px;cursor:pointer;transition:opacity .15s,border-color .15s;min-width:0}
.node .k{font-size:10.5px;color:var(--kind);font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-bottom:2px}
.node .t{font-weight:600;font-size:13px;line-height:1.3;text-wrap:balance;overflow-wrap:anywhere}
.node .p{font-family:var(--mono);font-size:10.5px;color:var(--muted);overflow-wrap:anywhere;margin-top:2px}
.node.small{padding:6px 9px}.node.small .t{font-size:12px;font-weight:500}
.node.deliv{border-width:1px 1px 1px 4px;box-shadow:0 0 0 1px var(--accent-soft),0 8px 24px -14px var(--line-hi)}
.rows{display:grid;gap:4px;margin-top:8px}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12px;padding:4px 7px;border-radius:6px;background:var(--accent-soft);cursor:pointer;min-width:0}
.row .a{font-family:var(--mono);font-size:10.5px;overflow-wrap:anywhere;min-width:0}
.row .n{font-size:10.5px;color:var(--muted);flex:none;font-variant-numeric:tabular-nums}
.badge{font-size:10px;padding:1px 6px;border-radius:999px;flex:none;font-weight:600;white-space:nowrap}
.badge.stale{color:var(--warn);background:var(--warn-soft)}
.badge.broken{color:var(--bad);background:var(--bad-soft)}
.badge.multi{color:var(--muted);border:1px solid var(--line)}
.dim .node:not(.on),.dim .row:not(.on){opacity:.28}
.node.on,.row.on{border-color:var(--line-hi)}
.row.on{outline:1px solid var(--line-hi)}
path.e{fill:none;stroke:var(--line);stroke-width:1.4}
path.e.ctx{stroke-dasharray:3 4}
path.e.broken{stroke:var(--bad);stroke-dasharray:5 4;stroke-width:1.6}
path.e.on{stroke:var(--line-hi);stroke-width:2.2}
.dim path.e:not(.on){opacity:.25}
.bottom{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:12px}
@media (max-width:860px){.bottom{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:0}
.card h4{margin:0 0 6px;font-size:13px}
.card .p{font-family:var(--mono);font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.card blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid var(--c-raw);background:var(--accent-soft);border-radius:0 6px 6px 0;font-size:13px;white-space:pre-wrap;max-height:320px;overflow:auto}
.card blockquote.other{border-left-color:var(--warn)}
.card .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.card .actions a,.card .actions button{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--stage);color:var(--text);padding:5px 10px;border-radius:8px;cursor:pointer;text-decoration:none}
.card .actions button.done{border-color:var(--c-raw)}
.chainlist{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:6px}
.chainlist li{font-family:var(--mono);font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.chainlist li b{color:var(--text);font-weight:500}
.chainlist li.broken{color:var(--bad)}
.legend{display:grid;gap:7px;font-size:12.5px}
.legend div{display:flex;gap:8px;align-items:center}
.sw{width:10px;height:10px;border-radius:3px;flex:none}
.ln{width:22px;height:0;border-top:2px solid var(--line-hi);flex:none}
.ln.d{border-top:2px dashed var(--bad)}.ln.c{border-top:2px dotted var(--muted)}
.how{font-size:12.5px;color:var(--muted);margin:8px 0 0}
@media (prefers-reduced-motion:reduce){.node{transition:none}}
`;
