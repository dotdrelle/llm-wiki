/**
 * TAXO graph page styles: the prototype's shell (48 px header, filter column,
 * full-frame stage with floating title, tools, legend and frosted inspector),
 * themed by the wiki's `theme-dark` / `theme-light` root classes, plus the
 * context card and preview overlay kept from the former graph.
 */
const DARK = `--bg:#070b12;--bg-image:radial-gradient(1200px 600px at 78% -10%,rgba(40,110,170,.28),transparent 60%),radial-gradient(800px 500px at 8% 110%,rgba(20,70,120,.25),transparent 60%),linear-gradient(rgba(120,190,230,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(120,190,230,.035) 1px,transparent 1px);
  --panel:rgba(14,22,36,.9);--soft:rgba(20,32,50,.82);--text:#e6eef7;--muted:#8fa3b8;--line:rgba(120,190,230,.18);--line-hi:rgba(95,208,255,.45);
  --accent-soft:rgba(95,208,255,.14);--head:#75aff5;--header-bg:#09131fdd;--title:#eef1f6;--summary:#7c879a;
  --float:#0b0d13d1;--float-line:#ffffff1c;--pill:#ffffff0d;--pill-line:#ffffff24;--pill-hover:#ffffff1a;
  --row-line:#ffffff0f;--hover:#1d4775;--selected:#245a9e;--body-muted:#8d96a8;--title-shadow:0 1px 10px #000a;--stage-bg:#070a10;color-scheme:dark;`;
const LIGHT = `--bg:#e9eef5;--bg-image:radial-gradient(1100px 560px at 80% -12%,rgba(120,190,235,.34),transparent 62%),radial-gradient(760px 480px at 6% 108%,rgba(90,150,210,.22),transparent 62%),linear-gradient(rgba(20,80,130,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(20,80,130,.045) 1px,transparent 1px);
  --panel:rgba(255,255,255,.9);--soft:rgba(255,255,255,.82);--text:#12202e;--muted:#5b6d82;--line:rgba(20,110,160,.2);--line-hi:rgba(14,127,168,.5);
  --accent-soft:rgba(14,127,168,.12);--head:#0e6f9a;--header-bg:#f8fbfddd;--title:#172433;--summary:#5b6d82;
  --float:#ffffffd9;--float-line:#0000001f;--pill:#ffffffc4;--pill-line:#00000024;--pill-hover:#ffffff;
  --row-line:#0000000f;--hover:#0e7fa814;--selected:#cfe3fb;--body-muted:#4a5d72;--title-shadow:none;--stage-bg:#f4f7fb;color-scheme:light;`;

export const taxoStyles = `
:root{--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;--left-w:220px;${DARK}}
:root.theme-light{${LIGHT}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);background-image:var(--bg-image);background-size:auto,auto,48px 48px,48px 48px;color:var(--text);font:14px var(--font);overflow:hidden}
button,input,select{font:inherit;color:inherit}
button{border:1px solid var(--line);background:var(--soft);border-radius:6px;cursor:pointer}
button:focus-visible,input:focus-visible,select:focus-visible,canvas:focus-visible{outline:2px solid var(--head);outline-offset:1px}
header{height:48px;display:flex;align-items:center;gap:18px;padding-inline:18px;border-bottom:1px solid var(--line);background:var(--header-bg);backdrop-filter:blur(12px)}
.brand{display:inline-flex;align-items:center;gap:.45em;font-size:15px;letter-spacing:.03em;color:var(--title);white-space:nowrap;text-decoration:none}
.brand svg{width:19px;height:19px}
header nav{display:flex;gap:2px}
header nav button{border-radius:4px;padding:.45rem .7rem;font-size:12px;white-space:nowrap}
header nav button[aria-pressed="true"]{background:var(--selected);border-color:var(--line-hi);color:var(--title)}
header nav button:hover{border-color:var(--line-hi)}
.search-wrap{position:relative;margin-left:auto;display:flex;align-items:center;gap:6px}
.search{width:min(360px,30vw);min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.5rem .8rem .5rem 2rem;font-size:12px}
.search-spinner{position:absolute;left:10px;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--head);opacity:0;pointer-events:none}
.search-wrap.is-searching .search-spinner{opacity:1;animation:search-spin .7s linear infinite}
.search-wrap.is-searching .search{border-color:var(--line-hi);box-shadow:0 0 0 3px var(--accent-soft)}
@keyframes search-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.search-wrap.is-searching .search-spinner{animation:none;border-color:var(--head)}}
.search-mode{flex:none;padding:.18rem .5rem;border-radius:999px;font-size:10.5px;letter-spacing:.02em;border:1px solid var(--line-hi);background:var(--accent-soft);color:var(--head);white-space:nowrap}
.search-mode[hidden]{display:none}
.search-mode.degraded{border-color:#f59e0b88;background:#f59e0b1f;color:#d48a06}
.shell-close{padding:.35rem .6rem;font-size:12px}
main{height:calc(100% - 48px);display:grid;grid-template-columns:var(--left-w) minmax(0,1fr);gap:8px;padding:8px}
.filters{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:12px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:14px}
.filters h3{font-size:12px;text-transform:uppercase;color:var(--head);letter-spacing:.05em;margin:0 0 8px;font-weight:600}
.filter-list{display:flex;flex-direction:column;gap:2px}
.filter{display:flex;align-items:center;gap:8px;width:100%;padding:6px;border:0;background:transparent;border-radius:5px;text-align:left;font-size:13px}
.filter:hover{background:var(--hover)}
.filter[aria-pressed="false"]{opacity:.4}
.filter .n,.rows .n{margin-left:auto;font:11px var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.dot{width:10px;height:10px;border-radius:3px;background:var(--c);flex:none;display:inline-block}
.star{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block;background:#f4f8ff;box-shadow:0 0 0 2px color-mix(in srgb,var(--c) 70%,transparent),0 0 8px var(--c)}
.about{font-size:12px;line-height:1.55;color:var(--muted);margin:0}
.stage{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:7px;min-height:0;background:var(--stage-bg)}
#cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:move}
.stage-empty{position:absolute;inset:0;display:grid;place-items:center;padding:2rem;text-align:center;color:var(--muted);z-index:3}
.stage-empty[hidden]{display:none}
.stage-title{position:absolute;z-index:5;left:18px;top:14px;display:flex;flex-direction:column;gap:2px;pointer-events:none;text-shadow:var(--title-shadow);max-width:calc(100% - 320px)}
.stage-title b{font-size:15px;font-weight:500;color:var(--title);letter-spacing:.1px}
.stage-title small{font-size:11.5px;color:var(--summary);font-variant-numeric:tabular-nums}
.stage-tools{position:absolute;z-index:6;left:18px;top:56px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.stage-tools button,.stage-tools select{padding:.28rem .62rem;font-size:11.5px;border-radius:999px;background:var(--pill);border:1px solid var(--pill-line);color:var(--text)}
.stage-tools button:hover{background:var(--pill-hover)}
.stage-tools #zoom-out,.stage-tools #zoom-in{min-width:28px;padding:.28rem .5rem;font-weight:600}
.stage-tools select{max-width:220px;cursor:pointer}
.stage-tools [hidden]{display:none}
.legend{position:absolute;z-index:4;left:10px;bottom:10px;display:flex;gap:10px;flex-wrap:wrap;max-width:calc(100% - 300px);padding:7px 9px;background:var(--float);border:1px solid var(--float-line);border-radius:6px;font-size:10.5px;color:var(--muted);backdrop-filter:blur(12px)}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend i{display:inline-block;width:16px;height:2px;background:var(--c)}
.legend i.dash{height:0;background:none;border-top:2px dashed var(--c)}
.legend i.grad{background:linear-gradient(90deg,#4d9cff,#f1b52f)}
.inspector{position:absolute;z-index:5;right:14px;top:14px;width:268px;max-height:calc(100% - 28px);padding:10px 11px;display:flex;flex-direction:column;gap:8px;overflow:hidden;border:1px solid var(--float-line);border-radius:11px;background:var(--float);backdrop-filter:blur(12px);box-shadow:0 18px 44px #0006}
.inspector-title{display:flex;align-items:center;justify-content:space-between;margin:0;font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--muted);cursor:pointer;user-select:none;background:none;border:0;padding:0;width:100%}
.inspector-title::after{content:'−';font-size:14px;font-weight:600}
.inspector.collapsed .inspector-title::after{content:'+'}
.inspector.collapsed #panel{display:none}
#panel{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;overscroll-behavior:contain}
.panel-head{display:flex;flex-direction:column;gap:2px;padding:2px 2px 8px;border-bottom:1px solid var(--row-line)}
.panel-head small{font-size:9.5px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--head)}
.panel-head strong{font-size:13.5px;font-weight:500;color:var(--title);line-height:1.3;text-wrap:balance}
.panel-head span{font-size:10.5px;color:var(--muted);display:inline-flex;align-items:center;gap:6px}
#panel p{margin:0;font-size:11.5px;line-height:1.55;color:var(--body-muted)}
.path{font:10px var(--mono);color:var(--muted);overflow-wrap:anywhere}
.sec{font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--head);margin:4px 0 0}
.rows{list-style:none;margin:0;padding:0}
.rows li{border-bottom:1px solid var(--row-line)}
.rows button{display:flex;align-items:center;gap:8px;width:100%;padding:5px 4px;border:0;background:transparent;border-radius:4px;text-align:left;font-size:12px;line-height:1.35}
.rows button:hover{background:var(--hover)}
.rows .via{font-size:10.5px;color:var(--muted);padding:0 4px 5px 22px;line-height:1.4}
.cta{align-self:flex-start;padding:.3rem .7rem;font-size:11px;border-radius:999px;background:var(--accent-soft);border-color:var(--line-hi);color:var(--head)}
.graph-context-card{position:absolute;z-index:7;width:min(260px,70vw);max-height:min(72vh,460px);overflow:hidden;display:flex;flex-direction:column;gap:8px;padding:11px 12px;border:1px solid var(--float-line);border-radius:11px;background:var(--float);backdrop-filter:blur(12px);box-shadow:0 16px 40px #000b}
.graph-context-card[hidden]{display:none}
.gcc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;cursor:grab;touch-action:none}
.gcc-head:active{cursor:grabbing}
.gcc-head>div{display:flex;min-width:0;flex-direction:column;gap:2px}
.graph-context-card small{font-size:9px;font-weight:600;letter-spacing:.13em;color:var(--head)}
.graph-context-card strong{font-size:12.5px;font-weight:500;color:var(--title);overflow-wrap:anywhere;line-height:1.3}
.gcc-head span{font-size:10px;color:var(--muted)}
.graph-context-card [data-close-context]{flex:none;padding:0 5px;font-size:15px;line-height:1.2;background:transparent;border-color:transparent;color:var(--muted)}
.gcc-body,.gcc-list li{font-size:11.5px;line-height:1.5;color:var(--body-muted);overflow-wrap:anywhere}
.gcc-body{margin:0;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.gcc-list{margin:0;padding:0 0 0 16px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:3px;list-style:disc}
.gcc-body.pending{font-style:italic}
.gcc-tags{display:flex;flex-wrap:wrap;gap:4px;flex:none}
.gcc-tag{font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;color:var(--tag-color);border:1px solid color-mix(in srgb,var(--tag-color) 45%,transparent);background:color-mix(in srgb,var(--tag-color) 14%,transparent)}
.gcc-actions{display:flex;gap:6px}
.gcc-actions button{flex:1;padding:.32rem .5rem;font-size:10.5px;white-space:nowrap}
.gcc-actions .gcc-donna{flex:0 0 auto;display:grid;place-items:center;width:30px;padding:0;color:var(--head)}
.gcc-actions .gcc-donna.done{color:#74c365}
.gcc-actions .gcc-donna svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2}
.document-preview-overlay{position:fixed;z-index:50;right:8px;top:56px;width:50vw;height:calc(100vh - 64px);display:flex;flex-direction:column;overflow:hidden;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px #000c;backdrop-filter:blur(12px)}
.document-preview-overlay[hidden]{display:none}
.document-preview-head{display:flex;flex:none;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line)}
.document-preview-content{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 22px;line-height:1.55}
.document-preview-content img{max-width:100%}
@media (max-width:820px){
  body{overflow:auto}
  header{height:auto;flex-wrap:wrap;padding-block:8px;gap:8px 12px}
  header nav{order:3;width:100%;overflow-x:auto}
  .search-wrap{flex:1 1 140px}.search{width:100%}
  main{height:auto;grid-template-columns:1fr;grid-template-rows:auto 62vh auto}
  .filters{flex-direction:row;flex-wrap:wrap}
  .filter-list{flex-direction:row;flex-wrap:wrap}
  .filter{width:auto}
  .about{display:none}
  .legend{max-width:calc(100% - 20px)}
  .inspector{position:static;width:auto;max-height:none;box-shadow:none}
  .document-preview-overlay{width:calc(100vw - 16px)}
}
`;
