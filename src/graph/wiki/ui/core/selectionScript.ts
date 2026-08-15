export function graphUiSelectionScript(): string {
  return String.raw`
function graphIcon(name){return name==='preview'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>'}
function sendDocumentToDonna(id,button){const path='/'+id;if(window.parent&&window.parent!==window)window.parent.postMessage({type:'llmwiki:addContext',path},window.location.origin);else sessionStorage.setItem('llm-wiki:pending-context',path);if(button){button.classList.add('done');button.title='Added to Donna'}}
async function previewGraphDocument(id){
  const overlay=document.querySelector('#document-preview-overlay'),content=document.querySelector('#document-preview-content'),heading=document.querySelector('#document-preview-title');
  overlay.hidden=false;heading.textContent='Document preview';content.innerHTML='<div class="loading" style="position:static;padding:2rem">Loading…</div>';
  try{const documentData=await json('/api/graph/document?id='+encodeURIComponent(id));heading.textContent=documentData.title;content.innerHTML=documentData.html}
  catch(error){content.innerHTML='<p>'+esc(error.message)+'</p>'}
}
function documentActionRow(node){
  return '<div class="focus-document-row" data-doc-row="'+esc(node.id)+'"><button type="button" class="focus-document-name" data-doc="'+esc(node.id)+'"><span>'+esc(node.title)+'</span><small>'+esc(node.type)+(graphRelationsLabel(node.degree)?' · '+graphRelationsLabel(node.degree):'')+'</small></button><span class="focus-document-actions"><button type="button" data-preview-doc="'+esc(node.id)+'" title="Preview document" aria-label="Preview '+esc(node.title)+'">'+graphIcon('preview')+'</button><button type="button" data-send-doc="'+esc(node.id)+'" title="Send to Donna" aria-label="Send '+esc(node.title)+' to Donna">'+graphIcon('donna')+'</button></span></div>'
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
  const related=data.nodes.filter(item=>relatedIds.has(item.id)).sort((left,right)=>Number(right.id===node.id)-Number(left.id===node.id)||right.degree-left.degree);
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
  const descends=documentHasRelations(node.id);
  // From a domain's view, the selection goes from a domain to a leaf: staying
  // at the "domain" level would make us look for a leaf's children, hence
  // render an empty scene.
  if(descends)view='focus';else if(view==='map'||view==='domain')view='community';
  render();renderDocumentFocusWindow(node);
  // The card is the only visible feedback when one does not descend: without
  // it, the click would only write a line in a panel at the other end of the
  // screen.
  if(descends)closeGraphContextCard();else openGraphContextCard(node);
}
/*
 A click on a DOMAIN opens its communities, never its documents.

 This is the navigation level that was missing: without it, opening "Software"
 dumped its 142 pages at once. A domain unfolds into a few subjects; it is a
 subject that finally unfolds its documents.
*/
function selectCommunity(id){
  const children=graphCommunityChildren(id);
  if(children.length){
    const domain=(data.domains||[]).find(item=>item.id===id);
    selected=null;selectedCommunity=id;view='domain';render();
    inspector.innerHTML='<div class="panel-head"><div><small>DOMAIN</small><strong>'+esc(graphDomainDisplay(domain?domain.label:id))+'</strong><span>'+children.length+' communities · '+children.reduce((sum,item)=>sum+item.documentCount,0)+' documents</span></div></div><div class="document-focus-list">'+children.map(item=>'<div class="focus-document-row"><button type="button" class="focus-document-name" data-community="'+esc(item.id)+'"><span>'+esc(graphLeafDisplay(item.label))+'</span><small>'+item.documentCount+' documents</small></button></div>').join('')+'</div>';
    return}
  const community=data.communities.find(item=>item.id===id);if(!community)return;
  selected=null;selectedCommunity=id;view='community';render();
  // Same template as at document level: header, then scrolling list. Two
  // different layouts for the same function forced the eye to relearn the
  // panel on every descent.
  inspector.innerHTML='<div class="panel-head"><div><small>COMMUNITY</small><strong>'+esc(graphLeafDisplay(community.label))+'</strong><span>'+community.documentCount+' documents · '+community.internalRelations+' internal relations · '+community.externalRelations+' external</span></div></div><div class="document-focus-list">'+community.nodeIds.slice(0,50).map(nodeId=>documentActionRow(data.nodes.find(node=>node.id===nodeId)||{id:nodeId,title:nodeId,type:'document',degree:0})).join('')+'</div>'
}
document.addEventListener('click',event=>{
  const preview=event.target.closest('[data-preview-doc]');if(preview){event.stopImmediatePropagation();previewGraphDocument(preview.dataset.previewDoc);return}
  const send=event.target.closest('[data-send-doc]');if(send){event.stopImmediatePropagation();sendDocumentToDonna(send.dataset.sendDoc,send);return}
});
document.querySelector('#close-document-preview').addEventListener('click',()=>{document.querySelector('#document-preview-overlay').hidden=true;document.querySelector('#document-preview-content').innerHTML=''});
`;
}
