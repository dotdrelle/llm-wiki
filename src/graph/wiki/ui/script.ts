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

async function load(){
  try{
    data=await json('/api/graph/overview');
    graphRevision=data.taxonomyRevision||0;
    seedCanvasExplorerSlots();renderFilters();renderSearchOptions();render();
    startGraphRevisionFeed()}
  catch(error){canvas.innerHTML='<div class="loading">Unable to load graph: '+esc(error.message)+'</div>'}
}
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
  const query=document.querySelector('#search').value.toLowerCase(),rows=visible().nodes.filter(node=>(node.title+' '+node.id).toLowerCase().includes(query));
  canvas.innerHTML='<div style="overflow:auto;height:100%"><table class="list-table"><thead><tr><th>Document</th><th>Type</th><th>Community</th><th>Relations</th></tr></thead><tbody>'+rows.map(node=>'<tr data-doc="'+esc(node.id)+'"><td><a href="/'+encodeURI(node.id)+'">'+esc(node.title)+'</a><div class="muted">'+esc(node.id)+'</div></td><td>'+esc(node.type)+'</td><td>'+esc(node.community?.communityLabel||'—')+'</td><td>'+node.degree+'</td></tr>').join('')+'</tbody></table></div>'
}
document.querySelector('#search').addEventListener('input',event=>{renderSearchOptions(event.target.value);if(view==='list')renderList()});
document.querySelector('#search').addEventListener('change',()=>activateSearch());
document.querySelector('#search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();activateSearch()}});
document.querySelector('#graph-search-results').addEventListener('click',event=>{const item=event.target.closest('[data-search-id]');if(item)activateSearch(item.dataset.searchId)});
document.querySelector('#reset-search').addEventListener('click',()=>{selected=null;selectedCommunity=null;view='map';focusHistory.length=0;document.querySelector('#search').value='';document.querySelector('#graph-search-results').hidden=true;inspector.innerHTML='<p>Select a community or document to explore its relations.</p>';renderFilters();render()});
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
// so the button stays hidden there, same reveal-on-embed rule as every other
// agent-launched control in this app.
if(window.parent&&window.parent!==window){
  const rebuildBtn=document.querySelector('#community-rebuild');
  rebuildBtn.hidden=false;
  // Meme garde-fou que les autres lancements d'agent : une confirmation
  // explicite avant d'occuper le runtime.
  rebuildBtn.addEventListener('click',async()=>{
    if(!(await confirmAction({
      title:'Rebuild taxonomy',
      message:'Run the taxonomy agent to synthesize communities from the current corpus?',
      confirmLabel:'Rebuild',
    }))) return;
    window.parent.postMessage({type:'llmwiki:runTaxonomy'},location.origin);
  });
}
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
load()
})();
`;
