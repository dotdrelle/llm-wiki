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
  // Pas de croix dans l'en-tête : elle promettait une fermeture et remontait
  // en réalité d'un niveau, exactement comme le « ← Back » de la barre d'outils
  // (#focus-back, script.ts) — même cible, même condition. Deux commandes pour
  // un seul geste, dont l'une ment sur ce qu'elle fait.
  inspector.innerHTML='<div class="panel-head"><div><small>DOCUMENT</small><strong>'+esc(node.title)+'</strong><span>'+esc(node.id)+'</span></div></div><div class="document-focus-list">'+related.slice(0,50).map(documentActionRow).join('')+'</div>'
}
/*
 Descendre doit apporter quelque chose.

 Le seuil était « au moins une relation », parce qu'une page isolée ouvrait une
 vue focus d'un seul nœud. Mais à une relation la vue en contient deux : on
 quitte le domaine et tout son voisinage pour un segment que le panneau de
 droite énonçait déjà en une ligne. Le prix — perdre le niveau où l'on était —
 ne se paie qu'à partir d'un vrai voisinage, donc de deux liens.

 En dessous, la page se sélectionne sur place et ouvre sa fiche de contexte
 juste à côté : ce que le lecteur cherchait en cliquant, c'est de quoi elle
 parle, pas un graphe à un segment.
*/
const GRAPH_FOCUS_MIN_RELATIONS=2;
function documentRelationCount(id){
  const seen=new Set();
  data.edges.forEach(edge=>{
    if(edge.from===id)seen.add(edge.to);
    else if(edge.to===id)seen.add(edge.from)});
  // Deux pages reliées par trois relations de types différents restent un seul
  // voisin : c'est le voisinage qui rend la descente utile, pas le nombre
  // d'arêtes.
  return seen.size}
function documentHasRelations(id){return documentRelationCount(id)>=GRAPH_FOCUS_MIN_RELATIONS}
async function selectDocument(node){
  if(selected&&selected.id!==node.id)focusHistory.push(selected.id);
  selected=node;selectedCommunity=data.communities.find(community=>community.nodeIds.includes(node.id))?.id||null;
  const descends=documentHasRelations(node.id);
  // Depuis la vue d'un domaine, la sélection passe d'un domaine à une feuille :
  // rester au niveau « domaine » ferait chercher les filles d'une feuille, donc
  // rendrait une scène vide.
  if(descends)view='focus';else if(view==='map'||view==='domain')view='community';
  render();renderDocumentFocusWindow(node);
  // La fiche est le seul retour visible quand on ne descend pas : sans elle,
  // le clic ne ferait qu'écrire une ligne dans un panneau à l'autre bout de
  // l'écran.
  if(descends)closeGraphContextCard();else openGraphContextCard(node);
}
/*
 Un clic sur un DOMAINE ouvre ses communautés, jamais ses documents.

 C'est le niveau de navigation qui manquait : sans lui, ouvrir « Logiciel »
 déversait ses 142 pages d'un coup. Un domaine se déplie en quelques sujets ;
 c'est un sujet qui déplie enfin ses documents.
*/
function selectCommunity(id){
  const children=graphCommunityChildren(id);
  if(children.length){
    const domain=(data.domains||[]).find(item=>item.id===id);
    selected=null;selectedCommunity=id;view='domain';render();
    inspector.innerHTML='<div class="panel-head"><div><small>DOMAINE</small><strong>'+esc(domain?domain.label:id)+'</strong><span>'+children.length+' communautés · '+children.reduce((sum,item)=>sum+item.documentCount,0)+' documents</span></div></div><div class="document-focus-list">'+children.map(item=>'<div class="focus-document-row"><button type="button" class="focus-document-name" data-community="'+esc(item.id)+'"><span>'+esc(item.label)+'</span><small>'+item.documentCount+' documents</small></button></div>').join('')+'</div>';
    return}
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
});
document.querySelector('#close-document-preview').addEventListener('click',()=>{document.querySelector('#document-preview-overlay').hidden=true;document.querySelector('#document-preview-content').innerHTML=''});
`;
}
