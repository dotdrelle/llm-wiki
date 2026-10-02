import { graphUiThemeScript } from '../core/themeScript.ts';
import { PROVENANCE_SCRIPT } from './provenanceScript.ts';
import { PROVENANCE_STYLES } from './provenanceStyles.ts';

/**
 * The /provenance page: where one deliverable's evidence comes from.
 *
 * An HTML page, deliberately not a Canvas view of /graph. It reads one
 * deliverable — a few dozen nodes at most — whose value is TEXT: titles,
 * paths, anchors, the exact frozen passage, badges and announcements. The
 * Canvas renderer is built for clouds of points and truncated all of that; this
 * page is the approved mock-up fed by `/api/graph/provenance`
 * (`provenanceGraph.ts`). It is the one documented exception to the
 * Canvas-only rule of the wiki graph (see the repo CLAUDE.md).
 *
 * Five columns read left to right: template and build context → the
 * deliverable and its citing sections → concept pivots → TAXO fiches → archive
 * fragments. The banner states which evidence is shown (frozen build or
 * current files) and lists every announcement the server returned — a
 * fallback or a broken chain is never hidden in a collapsed panel.
 */
export function renderProvenancePage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Provenance</title><style>${PROVENANCE_STYLES}</style></head><body>
<div class="wrap">
  <header class="header">
    <div class="titles"><small>Provenance</small><h1 id="title">Loading…</h1><code id="path"></code></div>
    <div class="controls">
      <div class="seg" role="group" aria-label="Evidence shown">
        <button type="button" id="mode-frozen" aria-pressed="true">Frozen evidence</button>
        <button type="button" id="mode-live" aria-pressed="false">Current files</button>
      </div>
      <label class="build" id="build-wrap" hidden>Build <select id="build"></select></label>
      <button type="button" class="ghost" id="refresh" title="Read the evidence again">Refresh</button>
      <a class="ghost" href="/graph">Graph</a>
      <button type="button" class="ghost" id="close" hidden title="Close" aria-label="Close">✕</button>
    </div>
  </header>
  <div class="banner" id="banner" role="status"></div>
  <div class="stage-scroll">
    <div class="stage" id="stage">
      <svg class="edges" id="edges" aria-hidden="true"></svg>
      <div class="col" id="col-0"><h3>Template &amp; context</h3></div>
      <div class="col" id="col-1"><h3>Deliverable</h3></div>
      <div class="col" id="col-2"><h3>Pivots <small>navigation</small></h3></div>
      <div class="col" id="col-3"><h3>TAXO fiches</h3></div>
      <div class="col" id="col-4"><h3>Archives <small>the proof</small></h3></div>
    </div>
  </div>
  <div class="bottom">
    <div class="card" id="detail" aria-live="polite"></div>
    <div class="card">
      <h4>Reading</h4>
      <div class="legend">
        <div><span class="sw" style="background:var(--c-tpl)"></span>Template and build-context files that produced the deliverable</div>
        <div><span class="sw" style="background:var(--c-deliv)"></span>The deliverable, one row per citing section</div>
        <div><span class="sw" style="background:var(--c-pivot)"></span>Concept pivot: a navigation path, never a proof</div>
        <div><span class="sw" style="background:var(--c-fiche)"></span>TAXO fiche: the faithful source section</div>
        <div><span class="sw" style="background:var(--c-raw)"></span>Exact fragment of <code>raw/ingested/</code>: the proof</div>
        <div><span class="ln c"></span>Uses (template, context)</div>
        <div><span class="ln"></span>Highlighted citation chain</div>
        <div><span class="ln d"></span>Chain the build used that no longer resolves</div>
      </div>
      <p class="how">Hover or select a section, a page or a fragment: every chain through it lights up, from the deliverable to the proof.</p>
    </div>
  </div>
</div>
<script>
(()=>{
${graphUiThemeScript()}
${PROVENANCE_SCRIPT}
})();
</script></body></html>`;
}
