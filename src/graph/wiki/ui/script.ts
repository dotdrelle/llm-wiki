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
  try{data=await json('/api/graph/overview');seedCanvasExplorerSlots();renderFilters();renderSearchOptions();render();startGraphLiveWatch()}
  catch(error){canvas.innerHTML='<div class="loading">Unable to load graph: '+esc(error.message)+'</div>'}
}
function render(){
  if(!data)return;
  const current=visible(),visibleCommunities=data.communities.filter(community=>community.nodeIds.some(id=>current.nodes.some(node=>node.id===id)));
  updateCommunityFilterCounts();updateGraphBreadcrumb();
  document.querySelector('#graph-breadcrumb').hidden=view==='list';
  document.querySelector('#spacing-control').hidden=true;
  document.querySelector('#focus-back').hidden=view==='map'||view==='list';
  const suffix=selectedCommunity?' · selection: '+(data.communities.find(community=>community.id===selectedCommunity)?.label||selectedCommunity):'';
  summary.textContent=visibleCommunities.length+' communities · '+current.nodes.length+' documents · '+current.edges.length+' relations'+suffix;
  title.textContent={map:'Global map view',community:'Community view',focus:'Provenance focus',list:'List view'}[view];
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
document.querySelector('#reset-search').addEventListener('click',()=>{selected=null;selectedCommunity=null;view='map';focusHistory.length=0;document.querySelector('#search').value='';document.querySelector('#graph-search-results').hidden=true;inspector.innerHTML='<h3>Selection</h3><p>Select a community or document to explore its relations.</p>';renderFilters();render()});
document.addEventListener('click',event=>{
  const viewButton=event.target.closest('[data-view]');
  if(viewButton){view=viewButton.dataset.view==='list'?'list':selected?'focus':selectedCommunity?'community':'map';document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button===viewButton));render();return}
  const community=event.target.closest('[data-community]');if(community){selectCommunity(community.dataset.community);return}
  const documentButton=event.target.closest('[data-doc]');if(documentButton){const node=data.nodes.find(item=>item.id===documentButton.dataset.doc);if(node)selectDocument(node)}
});
document.querySelector('#filters').addEventListener('change',render);
document.querySelector('#zoom-in').addEventListener('click',()=>canvasExplorer?.zoom(1.25));
document.querySelector('#zoom-out').addEventListener('click',()=>canvasExplorer?.zoom(.8));
document.querySelector('#fit').addEventListener('click',()=>canvasExplorer?.fit());
document.querySelector('#focus-back').addEventListener('click',()=>{if(view==='focus'&&selectedCommunity)navigateGraphLevel('community');else navigateGraphLevel('map')});
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
load()
})();
`;
