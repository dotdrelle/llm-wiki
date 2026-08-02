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
  return '<div class="focus-document-row" data-doc-row="'+esc(node.id)+'"><button type="button" class="focus-document-name" data-doc="'+esc(node.id)+'"><span>'+esc(node.title)+'</span><small>'+esc(node.type)+' · '+(node.degree||0)+' relations</small></button><span class="focus-document-actions"><button type="button" data-preview-doc="'+esc(node.id)+'" title="Preview document" aria-label="Preview '+esc(node.title)+'">'+graphIcon('preview')+'</button><button type="button" data-send-doc="'+esc(node.id)+'" title="Send to Donna" aria-label="Send '+esc(node.title)+' to Donna">'+graphIcon('donna')+'</button></span></div>'
}
/*
 Un seul panneau, dont le contenu suit le niveau.

 Le focus document ouvrait sa propre fenêtre par-dessus l'inspecteur, qui
 affichait déjà la même liste : deux cadres superposés, mêmes documents, deux
 fois la place. Elle était de surcroît ajoutée au canevas, dont l'explorateur
 remplace le contenu à chaque rendu — elle disparaissait donc au premier
 redessin, ou survivait détachée selon l'ordre des appels.

 Ici le niveau change ce que le panneau montre, pas le nombre de panneaux.
*/
function renderDocumentFocusWindow(node){
  const relatedIds=new Set([node.id]);data.edges.forEach(edge=>{if(edge.from===node.id)relatedIds.add(edge.to);if(edge.to===node.id)relatedIds.add(edge.from)});
  const related=data.nodes.filter(item=>relatedIds.has(item.id)).sort((left,right)=>Number(right.id===node.id)-Number(left.id===node.id)||right.degree-left.degree);
  inspector.innerHTML='<div class="panel-head"><div><small>DOCUMENT</small><strong>'+esc(node.title)+'</strong><span>'+esc(node.id)+'</span></div><button type="button" data-close-focus title="Back to community" aria-label="Close document focus">×</button></div><div class="document-focus-list">'+related.slice(0,50).map(documentActionRow).join('')+'</div>'
}
// Une page sans relation n'a pas de voisinage à explorer.
function documentHasRelations(id){return data.edges.some(edge=>edge.from===id||edge.to===id)}
/*
 Sélectionner n'est pas descendre.

 Toute page ouvrait la vue focus, y compris celles qui n'ont aucune relation :
 on tombait alors sur un graphe d'un seul nœud, sans rien autour et sans rien
 à en apprendre — un cul-de-sac dont il fallait ressortir par « Back ».

 Le zoom descendant est donc réservé aux pages qui ont au moins un lien. Les
 autres se sélectionnent sur place : le panneau de droite montre leur contenu,
 la vue courante est conservée, et le contexte de lecture avec elle. Depuis la
 carte, où aucune page n'est cliquable individuellement, on descend d'un cran
 jusqu'à son domaine pour que la sélection soit visible.
*/
async function selectDocument(node){
  if(selected&&selected.id!==node.id)focusHistory.push(selected.id);
  selected=node;selectedCommunity=data.communities.find(community=>community.nodeIds.includes(node.id))?.id||null;
  if(documentHasRelations(node.id))view='focus';else if(view==='map')view='community';
  render();renderDocumentFocusWindow(node);
}
function selectCommunity(id){
  const community=data.communities.find(item=>item.id===id);if(!community)return;
  selected=null;selectedCommunity=id;view='community';render();
  // Même gabarit qu'au niveau document : en-tête, puis liste défilante. Deux
  // mises en page différentes pour la même fonction obligeaient l'œil à
  // réapprendre le panneau à chaque descente.
  inspector.innerHTML='<div class="panel-head"><div><small>DOMAINE</small><strong>'+esc(community.label)+'</strong><span>'+community.documentCount+' documents · '+community.internalRelations+' relations internes · '+community.externalRelations+' externes</span></div></div><div class="document-focus-list">'+community.nodeIds.slice(0,50).map(nodeId=>documentActionRow(data.nodes.find(node=>node.id===nodeId)||{id:nodeId,title:nodeId,type:'document',degree:0})).join('')+'</div>'
}
document.addEventListener('click',event=>{
  const preview=event.target.closest('[data-preview-doc]');if(preview){event.stopImmediatePropagation();previewGraphDocument(preview.dataset.previewDoc);return}
  const send=event.target.closest('[data-send-doc]');if(send){event.stopImmediatePropagation();sendDocumentToDonna(send.dataset.sendDoc,send);return}
  if(event.target.closest('[data-close-focus]')){event.stopImmediatePropagation();navigateGraphLevel(selectedCommunity?'community':'map')}
});
document.querySelector('#close-document-preview').addEventListener('click',()=>{document.querySelector('#document-preview-overlay').hidden=true;document.querySelector('#document-preview-content').innerHTML=''});
`;
}
