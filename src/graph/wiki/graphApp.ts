import { graphCanvasScript } from '../core/canvas/graphCanvasScript.ts';
import { graphUiContextCardScript } from './ui/core/contextCardScript.ts';
import { graphUiThemeScript } from './ui/core/themeScript.ts';
import { provenanceScript } from './ui/provenance/provenanceScript.ts';
import { documentActionsScript } from './ui/taxo/documentActionsScript.ts';
import { taxoPanelScript } from './ui/taxo/taxoPanelScript.ts';
import { taxoRendererScript } from './ui/taxo/taxoRendererScript.ts';
import { taxoStateScript } from './ui/taxo/taxoStateScript.ts';
import { taxoStyles } from './ui/taxo/taxoStyles.ts';

// The graph's own mark — the same three connected circles as the sidebar's
// "Graph" action — so the page header and the left-panel entry read as one
// identity instead of a stray "⌘". currentColor so it follows the theme.
const GRAPH_BRAND_MARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.6 8.1 10.8 15"/><path d="m15.4 8.1-2.2 6.9"/><path d="M9 6h6"/></svg>';

/**
 * The /graph page: the TAXO reading of the wiki.
 *
 * Four views of one payload (`/api/graph/taxo`) — Families, Concepts, Concept
 * focus, Concepts + sources — plus the Provenance view of one deliverable
 * (`?provenance=<path>`, `/api/graph/provenance`), with family/source filters, a frosted inspector,
 * the engine's hybrid search (`/api/graph/search`) and the context card of a
 * fiche (LLM summary, preview, "Add to Donna"). Canvas only, on the shared
 * camera and frame scheduler; the force layouts are settled server-side.
 */
export function renderWikiGraphV2(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wiki Graph</title><style>${taxoStyles}</style></head><body>
<header><a class="brand" href="/">${GRAPH_BRAND_MARK}Wiki graph</a>
<nav aria-label="View"><button type="button" id="v-family" aria-pressed="true">Families</button><button type="button" id="v-concepts" aria-pressed="false">Concepts</button><button type="button" id="v-focus" aria-pressed="false">Concept focus</button><button type="button" id="v-full" aria-pressed="false">Concepts + sources</button><button type="button" id="v-provenance" aria-pressed="false" hidden>Provenance</button></nav>
<div class="search-wrap" id="search-wrap"><input class="search" id="q" type="search" autocomplete="off" placeholder="Search the wiki (semantic when the vector index is built)…" aria-label="Search the graph"><span class="search-spinner" aria-hidden="true"></span><span class="search-mode" id="search-mode" hidden></span></div>
<button id="graph-shell-close" class="shell-close" type="button" hidden title="Close graph" aria-label="Close graph">✕</button></header>
<main>
<aside class="filters"><section><h3>Families</h3><div class="filter-list" id="fam-filters"></div></section><section><h3>Documents</h3><div class="filter-list" id="src-filter"></div></section><p class="about" id="about"></p></aside>
<section class="stage" id="stage">
<canvas id="cv" tabindex="0" role="application" aria-label="Graph of concepts and sources. Wheel to zoom, drag to pan."></canvas>
<div class="stage-empty" id="empty" hidden>No concept in the wiki yet. Add sources to Pending, then run an ingest.</div>
<div class="stage-title"><b id="view-title">Families</b><small id="summary"></small></div>
<div class="stage-tools"><select id="pick" aria-label="Concept in the centre" hidden></select><button type="button" id="labels" hidden>Source labels</button><button type="button" id="prov-mode" hidden>Show current files</button><select id="prov-build" aria-label="Build whose frozen evidence is shown" hidden></select><button type="button" id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button><button type="button" id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button><button type="button" id="reset">Recenter</button></div>
<div class="legend" id="legend"></div>
<div class="inspector" id="inspector"><button type="button" class="inspector-title" id="insp-toggle" aria-expanded="true">Selection</button><div id="panel"></div></div>
</section>
</main>
<div id="document-preview-overlay" class="document-preview-overlay" hidden><div class="document-preview-head"><strong id="document-preview-title">Document preview</strong><button id="close-document-preview" type="button">Close</button></div><div id="document-preview-content" class="document-preview-content"></div></div>
<script>
(()=>{
${graphCanvasScript()}
${taxoStateScript()}
${documentActionsScript()}
${taxoRendererScript()}
${provenanceScript()}
${graphUiContextCardScript()}
${taxoPanelScript()}
${graphUiThemeScript()}
// Close button: only when the graph runs inside the chat shell's centre frame.
if(window.parent&&window.parent!==window){
  const close=document.querySelector('#graph-shell-close');
  close.hidden=false;
  close.addEventListener('click',()=>{try{window.parent.postMessage({type:'llmwiki:close',from:'graph'},location.origin)}catch(error){}});
}
window.addEventListener('pagehide',()=>scheduler.destroy());
initProvenance();
startRevisionFeed();
loadTaxo(true);
})();
</script></body></html>`;
}
