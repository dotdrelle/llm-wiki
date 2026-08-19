export function graphUiSelectionScript(): string {
  return String.raw`
/*
 The Donna action carries Donna's mark, not a download arrow.

 A downward arrow onto a line is the universal "save to disk" icon: on a button
 that sends a document to the assistant it announced the wrong action. The
 hexagon mirrors the shell's ⬡ glyph (chatView.ts: shell tab, sidebar logo and
 empty-chat mark), drawn as a stroked path because these buttons style their
 svg with fill:none;stroke:currentColor.
*/
function graphIcon(name){return name==='preview'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>':name==='hammer'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9Z"/></svg>'}
/*
 "Send to Donna" only claims success once the shell grants it.

 The button used to turn green on the spot, before the message had been read:
 a path the shell refuses — or a graph opened outside the shell, where there is
 no parent to ask — looked exactly like a success. The confirmation now waits
 for llmwiki:addContext:result, and a standalone graph says plainly that it has
 nobody to send to rather than pretending.
*/
const graphPendingDonna=new Map();
function sendDocumentToDonna(id,button){
  const path='/'+id;
  if(!window.parent||window.parent===window){
    if(button){button.title='Open the graph inside the app to send documents to Donna'}
    return}
  if(button)graphPendingDonna.set(path,button);
  window.parent.postMessage({type:'llmwiki:addContext',path},window.location.origin)}
window.addEventListener('message',event=>{
  if(event.origin!==window.location.origin)return;
  const data=event.data;
  if(!data||data.type!=='llmwiki:addContext:result')return;
  const button=graphPendingDonna.get(data.path);
  if(!button)return;
  graphPendingDonna.delete(data.path);
  if(data.ok){button.classList.add('done');button.title='Added to Donna'}
  else{button.title='This document cannot be added to Donna'}});
async function previewGraphDocument(id){
  const overlay=document.querySelector('#document-preview-overlay'),content=document.querySelector('#document-preview-content'),heading=document.querySelector('#document-preview-title');
  overlay.hidden=false;heading.textContent='Document preview';content.innerHTML='<div class="loading" style="position:static;padding:2rem">Loading…</div>';
  try{const documentData=await json('/api/graph/document?id='+encodeURIComponent(id));heading.textContent=documentData.title;content.innerHTML=documentData.html}
  catch(error){content.innerHTML='<p>'+esc(error.message)+'</p>'}
}
function documentActionRow(node){
  return '<div class="focus-document-row" data-doc-row="'+esc(node.id)+'"><button type="button" class="focus-document-name" data-doc="'+esc(node.id)+'"><span>'+esc(node.title)+'</span><small>'+esc(node.type)+(graphRelationsLabel(node.degree)?' · '+graphRelationsLabel(node.degree):'')+'</small></button><span class="focus-document-actions"><button type="button" data-preview-doc="'+esc(node.id)+'" title="Preview document" aria-label="Preview '+esc(node.title)+'">'+graphIcon('preview')+'</button><button type="button" data-send-doc="'+esc(node.id)+'" title="Add to Donna" aria-label="Add '+esc(node.title)+' to Donna">'+graphIcon('donna')+'</button></span></div>'
}
/*
 A single panel, whose content follows the level.

 The document focus opened its own window over the inspector, which already
 showed the same list: two superimposed frames, the same documents, twice the
 space. It was moreover added to the canvas, whose explorer replaces the
 content on every render — it therefore disappeared at the first redraw, or
 survived detached depending on the order of the calls.

 Here the level changes what the panel shows, not the number of panels.
*/
function renderDocumentFocusWindow(node){
  const relatedIds=new Set([node.id]);data.edges.forEach(edge=>{if(edge.from===node.id)relatedIds.add(edge.to);if(edge.to===node.id)relatedIds.add(edge.from)});
  const related=data.nodes.filter(item=>relatedIds.has(item.id)&&(item.id===node.id||enabledTypes().has(item.type))).sort((left,right)=>Number(right.id===node.id)-Number(left.id===node.id)||right.degree-left.degree);
  // No cross in the header: it promised a closing and actually went back up a
  // level, exactly like the "← Back" of the toolbar (#focus-back, script.ts) —
  // same target, same condition. Two commands for a single gesture, one of
  // which lies about what it does.
  inspector.innerHTML='<div class="panel-head"><div><small>DOCUMENT</small><strong>'+esc(node.title)+'</strong><span>'+esc(node.id)+'</span></div></div><div class="document-focus-list">'+related.slice(0,50).map(documentActionRow).join('')+'</div>'
}
/*
 Descending must bring something.

 The threshold was "at least one relation", because an isolated page opened a
 focus view of a single node. But with one relation the view contains two: one
 leaves the domain and all its neighborhood for a segment that the right panel
 already stated in one line. The price — losing the level we were on — is only
 paid starting from a real neighborhood, hence two links.

 Below that, the page selects itself in place and opens its context card right
 next to it: what the reader was looking for by clicking is what it is about,
 not a one-segment graph.
*/
const GRAPH_FOCUS_MIN_RELATIONS=2;
function documentRelationCount(id){
  const seen=new Set();
  data.edges.forEach(edge=>{
    if(edge.from===id)seen.add(edge.to);
    else if(edge.to===id)seen.add(edge.from)});
  // Two pages linked by three relations of different types remain a single
  // neighbor: it is the neighborhood that makes the descent useful, not the
  // number of edges.
  return seen.size}
function documentHasRelations(id){return documentRelationCount(id)>=GRAPH_FOCUS_MIN_RELATIONS}
async function selectDocument(node){
  if(selected&&selected.id!==node.id)focusHistory.push(selected.id);
  selected=node;selectedCommunity=data.communities.find(community=>community.nodeIds.includes(node.id))?.id||null;
  // A single click selects and opens the summary card; it does NOT descend.
  // Descending stays on the double-click (activate(node, true)), where the
  // intent is explicit. Descending here made a click on a well-connected page
  // reframe the whole graph around its neighborhood, hiding what one was
  // reading.
  if(view==='map'||view==='domain')view='community';
  render();renderDocumentFocusWindow(node);
  // The summary card opens for every document, connected or not: the focus
  // view shows the neighborhood, the card shows what the page is about. Gating
  // the summary behind a relation threshold made a well-connected page's
  // content unreachable without descending.
  openGraphContextCard(node);
}
/*
 Panel content for a community or a domain, WITHOUT touching the selection.

 A click on a DOMAIN opens its communities, never its documents. This is the
 navigation level that was missing: without it, opening "Software" dumped its
 142 pages at once. A domain unfolds into a few subjects; it is a subject that
 finally unfolds its documents.

 Splitting the rendering out of selectCommunity is what lets a filter change
 replay it. As long as the two were one, the panel could only be built at the
 moment of a click: toggling a type afterwards redrew the graph and the left
 index, and left the panel listing rows the filter had just hidden everywhere
 else.
*/
function renderCommunityInspector(id){
  const children=graphCommunityChildren(id);
  if(children.length){
    const domain=(data.domains||[]).find(item=>item.id===id);
    inspector.innerHTML='<div class="panel-head"><div><small>DOMAIN</small><strong>'+esc(graphDomainDisplay(domain?domain.label:id))+'</strong><span>'+children.length+' communities · '+children.reduce((sum,item)=>sum+item.documentCount,0)+' documents</span></div></div><div class="document-focus-list">'+children.map(item=>'<div class="focus-document-row"><button type="button" class="focus-document-name" data-community="'+esc(item.id)+'"><span>'+esc(graphLeafDisplay(item.label))+'</span><small>'+item.documentCount+' documents</small></button></div>').join('')+'</div>';
    return}
  const community=data.communities.find(item=>item.id===id);if(!community)return;
  // Same template as at document level: header, then scrolling list. Two
  // different layouts for the same function forced the eye to relearn the
  // panel on every descent.
  const enabled=enabledTypes(),typeById=graphNodeTypeById();
  const shown=community.nodeIds.filter(nodeId=>enabled.has(typeById.get(nodeId)));
  // "N of M" rather than M alone: the head announced the community's full size
  // while the list below it obeyed the filters, so the two disagreed by exactly
  // what had been hidden — and nothing said so.
  const count=shown.length===community.documentCount
    ? community.documentCount+' documents'
    : shown.length+' of '+community.documentCount+' documents';
  inspector.innerHTML='<div class="panel-head"><div><small>COMMUNITY</small><strong>'+esc(graphLeafDisplay(community.label))+'</strong><span>'+count+' · '+community.internalRelations+' internal relations · '+community.externalRelations+' external</span></div></div><div class="document-focus-list">'+shown.slice(0,50).map(nodeId=>documentActionRow(data.nodes.find(node=>node.id===nodeId)||{id:nodeId,title:nodeId,type:'document',degree:0})).join('')+'</div>'
}
function selectCommunity(id){
  const children=graphCommunityChildren(id);
  if(children.length){
    selected=null;selectedCommunity=id;view='domain';render();
    renderCommunityInspector(id);
    return}
  // The guard stays BEFORE the assignments: an unknown id must not move the
  // selection to something the panel then cannot render.
  const community=data.communities.find(item=>item.id===id);if(!community)return;
  selected=null;selectedCommunity=id;view='community';render();
  renderCommunityInspector(id)
}
/** Replay the panel for whatever is currently selected. Nothing else moves. */
function refreshInspector(){
  if(selected)renderDocumentFocusWindow(selected);
  else if(selectedCommunity)renderCommunityInspector(selectedCommunity)
}
document.addEventListener('click',event=>{
  const preview=event.target.closest('[data-preview-doc]');if(preview){event.stopImmediatePropagation();previewGraphDocument(preview.dataset.previewDoc);return}
  const send=event.target.closest('[data-send-doc]');if(send){event.stopImmediatePropagation();sendDocumentToDonna(send.dataset.sendDoc,send);return}
});
document.querySelector('#close-document-preview').addEventListener('click',()=>{document.querySelector('#document-preview-overlay').hidden=true;document.querySelector('#document-preview-content').innerHTML=''});
`;
}
