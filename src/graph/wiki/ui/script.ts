import { graphCanvasScript } from '../../core/canvas/graphCanvasScript.ts';
import { canvasExplorerScript } from './canvas/canvasExplorerScript.ts';
import { graphUiHelpersScript } from './core/helpersScript.ts';
import { graphUiNavigationScript } from './core/navigationScript.ts';
import { graphUiFiltersScript } from './core/filtersScript.ts';
import { graphUiContextCardScript } from './core/contextCardScript.ts';
import { graphUiLiveScript } from './core/liveScript.ts';
import { graphUiSearchScript } from './core/searchScript.ts';
import { graphUiSelectionScript } from './core/selectionScript.ts';
import { graphUiStateScript } from './core/stateScript.ts';
import { graphUiThemeScript } from './core/themeScript.ts';

export const graphAppScript = String.raw`
(()=>{
${graphCanvasScript()}
${graphUiStateScript()}
${graphUiHelpersScript()}
${graphUiSearchScript()}
${graphUiFiltersScript()}
${graphUiSelectionScript()}
${graphUiNavigationScript()}
${canvasExplorerScript()}
${graphUiContextCardScript()}
${graphUiLiveScript()}
${graphUiThemeScript()}

function graphQuerySuffix(){return searchQuery?('?q='+encodeURIComponent(searchQuery)):''}
/*
 Applying a snapshot, from any source (load, revision, search reload).

 The concept grouping is the top-level communities; the server does not ship it
 twice, so the browser restores the entry the combobox reads, then re-applies
 the axis the reader chose — a fresh snapshot always arrives re-rooted at
 concept, and silently dropping back to the concept map would discard their
 reading.
*/
function ingestGraph(next){
  data=next;
  data.groupings={...(data.groupings||{}),concept:{communities:data.communities,communityEdges:data.communityEdges}};
  if(groupAxis!=='concept'){
    const grouping=data.groupings?.[groupAxis];
    if(grouping){data.communities=grouping.communities;data.communityEdges=grouping.communityEdges}}
  seedCanvasExplorerSlots();renderFilters();renderSearchOptions(document.querySelector('#search')?.value||'');render()}
async function load(){
  try{
    const next=await json('/api/graph/overview'+graphQuerySuffix());
    ingestGraph(next);
    graphRevision=next.taxonomyRevision||graphRevision||0;
    startGraphRevisionFeed()}
  catch(error){canvas.innerHTML='<div class="loading">Unable to load graph: '+esc(error.message)+'</div>'}
}
/*
 Reactive relation search.

 The query narrows the corpus server-side, so a keystroke that changes it must
 re-fetch — debounced, and guarded by a sequence so a slow earlier response
 cannot overwrite the newer scene. Not reframing: the reader keeps their camera.
*/
let searchReloadTimer=0,searchFetchSeq=0;
async function reloadForQuery(){
  const seq=++searchFetchSeq;
  try{
    const next=await json('/api/graph/overview'+graphQuerySuffix());
    if(seq!==searchFetchSeq)return;
    ingestGraph(next)}
  catch(error){/* a dropped keystroke must not blank the canvas */}}
function render(){
  if(!data)return;
  /*
   Corpus vide : on l'annonce, on ne dessine pas.

   Sans ce garde-fou l'ecran affichait un canvas vide sous un compteur
   "0 communautes · 0 documents" — indistinguable d'un chargement qui n'a pas
   abouti. Le message dit quoi faire ensuite.
  */
  if(!data.nodes.length){
    destroyCanvasExplorer();
    canvas.innerHTML='<div class="loading">No document in the graph yet. Add sources to Pending, then run an ingest.</div>';
    summary.textContent='Empty wiki';
    title.textContent='Global map view';
    document.querySelector('#graph-breadcrumb').hidden=true;
    document.querySelector('#spacing-control').hidden=true;
    document.querySelector('#focus-back').hidden=true;
    return;
  }
  const current=visible(),visibleCommunities=data.communities.filter(community=>community.nodeIds.some(id=>current.nodes.some(node=>node.id===id)));
  updateCommunityFilterCounts();updateGraphBreadcrumb();
  document.querySelector('#graph-breadcrumb').hidden=view==='list';
  document.querySelector('#spacing-control').hidden=true;
  document.querySelector('#focus-back').hidden=view==='map'||view==='list';
  // The floating toolbar (Map/+/−/Fit/fullscreen) and the Selection window only
  // read against a canvas: in list view there is nothing to zoom or select, so
  // they would float over a table they do not control. Hide both.
  document.querySelector('main').classList.toggle('list-view',view==='list');
  const suffix=selectedCommunity?' · selection: '+graphCommunityLabel(selectedCommunity):'';
  /*
   The counter announces the DISPLAYED level, not the registry content.

   It said "33 communities" on a map that folds 3 of them: the reader believed
   they were seeing 33 bubbles and looked for the missing ones. A counter that
   describes something other than what is on screen is worse than no counter.
  */
  const domains=data.domains||[],parents=data.communityParents||{};
  const shown=domains.length&&view==='map'
    ? new Set(visibleCommunities.map(community=>parents[community.id]||community.id)).size
    : visibleCommunities.length;
  const unit=domains.length&&view==='map'?' domains · ':' communities · ';
  summary.textContent=shown+unit+current.nodes.length+' documents · '+current.edges.length+' relations'+suffix;
  title.textContent={map:'Global map view',domain:'Domain view',community:'Community view',focus:'Provenance focus',list:'List view'}[view];
  if(view==='list'){destroyCanvasExplorer();renderList();return}
  renderCanvasExplorer()
}
function renderList(){
  // The snapshot is already narrowed by the search (server-side, before the
  // projection): re-filtering here by title/id alone would hide a page that
  // matched through a tag or its subject. Type filters still apply, via visible().
  const rows=visible().nodes;
  canvas.innerHTML='<div style="overflow:auto;height:100%"><table class="list-table"><thead><tr><th>Document</th><th>Type</th><th>Community</th><th>Relations</th></tr></thead><tbody>'+rows.map(node=>'<tr data-doc="'+esc(node.id)+'"><td><a href="/'+encodeURI(node.id)+'">'+esc(node.title)+'</a><div class="muted">'+esc(node.id)+'</div></td><td>'+esc(node.type)+'</td><td>'+esc(node.community?.communityLabel||'—')+'</td><td>'+node.degree+'</td></tr>').join('')+'</tbody></table></div>'
}
document.querySelector('#search').addEventListener('input',event=>{
  renderSearchOptions(event.target.value);
  searchQuery=event.target.value;
  // The search is a GLOBAL relation filter: it must never leave the reader
  // pinned on one document. Typing drops any document selection, and a
  // document focus returns to the filtered map so the whole neighbourhood is
  // visible. The community/domain level the reader was on is preserved.
  if(searchQuery.trim()){
    if(selected){selected=null;refreshInspector()}
    if(view==='focus'){view='map';focusHistory.length=0}}
  if(searchReloadTimer)clearTimeout(searchReloadTimer);
  searchReloadTimer=setTimeout(()=>{searchReloadTimer=0;reloadForQuery()},220);
  if(view==='list')renderList()});
// Enter keeps the filtered view — it does NOT pick a result. The dropdown
// stays an OPTIONAL shortcut: only an explicit click navigates.
document.querySelector('#search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();closeSearchOptions()}else if(event.key==='Escape'){closeSearchOptions()}});
document.querySelector('#graph-search-results').addEventListener('click',event=>{
  // "Filter the graph for …": keep the global relation view and just hide the
  // list. It is the only way to dismiss the suggestions without leaving the
  // filtered graph for a single document.
  if(event.target.closest('[data-search-filter]')){closeSearchOptions();return}
  const item=event.target.closest('[data-search-id]');if(item)activateSearch(item.dataset.searchId)});
// A click anywhere outside the search closes the suggestions: the list used to
// stay open and cover the graph and the selection until a leaf was picked.
document.addEventListener('click',event=>{if(!event.target.closest('.graph-search'))closeSearchOptions()});
document.querySelector('#reset-search').addEventListener('click',()=>{selected=null;selectedCommunity=null;view='map';focusHistory.length=0;searchQuery='';if(searchReloadTimer){clearTimeout(searchReloadTimer);searchReloadTimer=0}document.querySelector('#search').value='';document.querySelector('#graph-search-results').hidden=true;inspector.innerHTML='<p>Select a community or document to explore its relations.</p>';reloadForQuery()});
document.addEventListener('click',event=>{
  const viewButton=event.target.closest('[data-view]');
  if(viewButton){view=viewButton.dataset.view==='list'?'list':selected?'focus':selectedCommunity?(graphIsDomain(selectedCommunity)?'domain':'community'):'map';document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button===viewButton));render();return}
  const community=event.target.closest('[data-community]');if(community){const group=community.closest('details'),willOpen=group?!group.open:undefined;event.preventDefault();selectCommunity(community.dataset.community);if(group&&willOpen!==undefined)group.open=willOpen;return}
  const documentButton=event.target.closest('[data-doc]');if(documentButton){const node=data.nodes.find(item=>item.id===documentButton.dataset.doc);if(node)selectDocument(node)}
});
// The three surfaces a type filter governs: the left index, the canvas, and the
// right panel. The panel was missing, so it kept listing rows the filter had
// just removed everywhere else.
document.querySelector('#filters').addEventListener('change',()=>{document.querySelector('#community-list').innerHTML=renderCommunityIndex();render();refreshInspector()});
// The grouping axis re-roots the map: the halos and their relations come from
// the precomputed grouping for the chosen axis (concept/subject/type/tag). The
// swap is a reading change, not a re-projection: it reuses the snapshot the
// server already sent. A selection made under one grouping means nothing under
// another, so the descent is reset to the map.
document.querySelector('#group-axis').addEventListener('change',event=>{
  groupAxis=event.target.value;
  const grouping=data?.groupings?.[groupAxis];
  if(!grouping)return;
  data.communities=grouping.communities;
  data.communityEdges=grouping.communityEdges;
  selected=null;selectedCommunity=null;view='map';focusHistory.length=0;
  document.querySelector('#inspector').innerHTML='<p>Select a community or document to explore its relations.</p>';
  document.querySelector('#community-list').innerHTML=renderCommunityIndex();
  render()});
document.querySelector('#zoom-in').addEventListener('click',()=>canvasExplorer?.zoom(1.25));
document.querySelector('#zoom-out').addEventListener('click',()=>canvasExplorer?.zoom(.8));
document.querySelector('#fit').addEventListener('click',()=>canvasExplorer?.fit());
document.querySelector('#community-refresh').addEventListener('click',()=>{onGraphRevision(Math.max(graphRevision+1,(data?.taxonomyRevision||0)+1))});
// "Build" launches through Donna, not a direct API call: same discipline as
// the wiki sidebar's Ingest/Build-template buttons (wikiPanelScript.ts). It
// used to call /api/graph/taxonomy directly, in place, with an inline
// spinner+timer — a known bypass of the runtime's approval/idempotency
// machinery. Real orchestration (visible in the Plan, with a proper task
// dependsOn chain) won this trade-off over the inline spinner. Only
// meaningful inside the chat shell, where there is a Donna to post to — a
// standalone /graph visit (no parent frame) has nothing to route through,
// "← Back" goes back up ONE step. It jumped from focus view to the map as soon
// as the intermediate level was not a community in the strict sense, which
// cancelled the whole descent for a single back click.
document.querySelector('#focus-back').addEventListener('click',()=>{
  if(view==='focus'&&selectedCommunity&&!graphIsDomain(selectedCommunity))navigateGraphLevel('community');
  else if(view==='focus'||view==='community')navigateGraphLevel('domain');
  else navigateGraphLevel('map')});
document.querySelector('#inspector-toggle').addEventListener('click',event=>{const main=document.querySelector('main'),collapsed=main.classList.toggle('inspector-collapsed');event.currentTarget.title=collapsed?'Open panel':'Collapse panel';localStorage.setItem('llm-wiki:graph:inspectorCollapsed',collapsed?'1':'0');requestAnimationFrame(()=>canvasExplorer?.invalidate())});
if(localStorage.getItem('llm-wiki:graph:inspectorCollapsed')==='1')document.querySelector('main').classList.add('inspector-collapsed');
document.querySelector('#fullscreen').addEventListener('click',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()});
document.addEventListener('fullscreenchange',()=>requestAnimationFrame(()=>canvasExplorer?.invalidate()));
const resizer=document.querySelector('.left-resizer');let resizing=false;
function applyLeft(clientX){const width=Math.max(160,Math.min(clientX-8,420));document.documentElement.style.setProperty('--left-w',width+'px');localStorage.setItem('llm-wiki:graph:leftWidth',String(width))}
const savedWidth=Number(localStorage.getItem('llm-wiki:graph:leftWidth'));if(savedWidth)applyLeft(savedWidth+8);
resizer.addEventListener('pointerdown',event=>{resizing=true;resizer.classList.add('dragging');resizer.setPointerCapture?.(event.pointerId)});
window.addEventListener('pointermove',event=>{if(resizing)applyLeft(event.clientX)});
window.addEventListener('pointerup',()=>{resizing=false;resizer.classList.remove('dragging')});
window.addEventListener('pagehide',()=>destroyCanvasExplorer());
// Close button: only when the graph runs inside the chat shell's central
// frame. Standalone (a top-level /graph tab) it stays hidden — there is
// nothing to close back to, and no parent to tell.
if(window.parent&&window.parent!==window){
  const graphClose=document.querySelector('#graph-shell-close');
  if(graphClose){
    graphClose.hidden=false;
    graphClose.addEventListener('click',()=>{try{window.parent.postMessage({type:'llmwiki:close',from:'graph'},location.origin)}catch(error){}});
  }
}
load()
})();
`;
