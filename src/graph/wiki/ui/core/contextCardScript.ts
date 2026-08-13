/**
 * Fiche de contexte, ancrée au nœud.
 *
 * Une page à moins de deux voisins ne descend plus en vue focus : la descente
 * coûtait le niveau où l'on était et ne rendait qu'un graphe d'un ou deux
 * nœuds. Le clic doit pourtant répondre à quelque chose, et ce que le lecteur
 * cherche à ce moment-là est simple — de quoi parle cette page.
 *
 * La fiche se pose donc à côté de la bulle, suit le zoom et le déplacement, et
 * porte un résumé produit par le LLM (mis en cache côté serveur, cf.
 * `graph/wiki/summary.ts`). Elle reste petite : c'est un coup d'œil avant de
 * décider d'ouvrir, pas un panneau de lecture — celui-ci existe déjà.
 */
export function graphUiContextCardScript(): string {
  return String.raw`
let graphContextCard=null,graphContextNodeId=null,graphContextToken=0,graphContextPinned=false;
// Position choisie à la main, conservée d'une fiche à l'autre tant qu'on n'a
// pas fermé celle qu'on avait déplacée.
let graphContextPlacement={left:'',top:''};
function graphContextCardElement(){
  if(graphContextCard?.isConnected)return graphContextCard;
  const stage=document.querySelector('.stage');
  if(!stage)return null;
  const card=document.createElement('div');
  card.className='graph-context-card';
  card.hidden=true;
  stage.appendChild(card);
  enableGraphContextCardDrag(card);
  graphContextCard=card;
  return card}
function closeGraphContextCard(){
  graphContextNodeId=null;
  // Le jeton invalide la réponse d'un résumé encore en vol : la fiche suivante
  // ne doit pas hériter du texte de la précédente.
  graphContextToken+=1;
  canvasExplorer?.anchor(null);
  canvasExplorer?.avoid(null);
  // Fermer est le seul geste qui révoque le placement manuel : on repart d'une
  // fiche ancrée à son nœud, comme à la première ouverture.
  graphContextPinned=false;graphContextPlacement={left:'',top:''};
  if(graphContextCard)  {graphContextCard.hidden=true;graphContextCard.innerHTML=''}}

/*
 Signaler aux tuiles la place occupée par la fiche.

 Elles s'écartent le temps de la lecture au lieu d'être recouvertes. Le
 rectangle est relu à chaque repositionnement : il suit le zoom et le
 déplacement comme la fiche elle-même.
*/
function updateGraphContextObstacle(){
  const card=graphContextCard;
  if(!card||card.hidden||card.style.visibility==='hidden')return canvasExplorer?.avoid(null);
  canvasExplorer?.avoid({
    x:parseFloat(card.style.left)||0,
    y:parseFloat(card.style.top)||0,
    width:card.offsetWidth,
    height:card.offsetHeight,
  })}
/*
 Placement : à droite du nœud si la place existe, sinon à gauche, puis rabattu
 dans le cadre. Une fiche qui déborde de la scène est une fiche qu'on ne lit
 pas — et le canevas occupe toute la scène, donc il n'y a pas de « dehors » où
 la laisser dépasser.
*/
function positionGraphContextCard(point){
  const card=graphContextCard;
  if(!card||card.hidden)return;
  // Une fiche déplacée à la main est un choix : on cesse de la recalculer. La
  // reposer à chaque image annulerait le geste sous les doigts de celui qui
  // vient de la faire. Elle doit néanmoins disparaître si son nœud d'ancrage
  // sort du cadre : sinon elle reste affichée au-dessus de rien.
  if(graphContextPinned){
    if(!point){card.style.visibility='hidden';canvasExplorer?.avoid(null);return}
    card.style.visibility='';
    return updateGraphContextObstacle()}
  const stage=document.querySelector('.stage');
  if(!stage)return;
  if(!point){card.style.visibility='hidden';canvasExplorer?.avoid(null);return}
  card.style.visibility='';
  const frame=stage.getBoundingClientRect(),box=card.getBoundingClientRect();
  const gap=point.r+14;
  let left=point.x+gap;
  if(left+box.width>frame.width-10)left=point.x-gap-box.width;
  left=Math.max(10,Math.min(left,frame.width-box.width-10));
  const top=Math.max(10,Math.min(point.y-box.height/2,frame.height-box.height-10));
  card.style.left=left+'px';
  card.style.top=top+'px';
  updateGraphContextObstacle()}

/*
 Déplacer la fiche à la main.

 Le glissement démarre sur l'en-tête uniquement : le corps porte le résumé,
 qu'on doit pouvoir sélectionner, et les boutons doivent rester cliquables.
 Dès le premier pixel parcouru la fiche est épinglée — définitivement pour
 cette ouverture, y compris si le graphe bouge ensuite.
*/
function enableGraphContextCardDrag(card){
  card.addEventListener('pointerdown',event=>{
    const head=event.target.closest('.gcc-head');
    if(!head||event.target.closest('button'))return;
    const startX=event.clientX,startY=event.clientY;
    const originLeft=parseFloat(card.style.left)||0,originTop=parseFloat(card.style.top)||0;
    const stage=document.querySelector('.stage');
    const frame=stage?stage.getBoundingClientRect():{width:Infinity,height:Infinity};
    let moved=false;
    const onMove=moveEvent=>{
      const dx=moveEvent.clientX-startX,dy=moveEvent.clientY-startY;
      if(!moved&&Math.abs(dx)+Math.abs(dy)<3)return;
      moved=true;graphContextPinned=true;
      card.style.left=Math.max(0,Math.min(originLeft+dx,frame.width-card.offsetWidth))+'px';
      card.style.top=Math.max(0,Math.min(originTop+dy,frame.height-card.offsetHeight))+'px';
      graphContextPlacement={left:card.style.left,top:card.style.top};
      updateGraphContextObstacle()};
    const onUp=()=>{
      window.removeEventListener('pointermove',onMove);
      window.removeEventListener('pointerup',onUp)};
    window.addEventListener('pointermove',onMove);
    window.addEventListener('pointerup',onUp)})}
function graphContextCardHTML(node,body,pending){
  const relations=documentRelationCount(node.id);
  return '<div class="gcc-head"><div><small>CONTEXTE</small><strong>'+esc(node.title||node.label||node.id)+'</strong>'
    +'<span>'+esc(node.type||'document')+(graphRelationsLabel(relations)?' · '+graphRelationsLabel(relations):'')+'</span></div>'
    +'<button type="button" data-close-context title="Close" aria-label="Close context card">×</button></div>'
    +'<p class="gcc-body'+(pending?' pending':'')+'">'+esc(body)+'</p>'
    +'<div class="gcc-actions"><button type="button" data-preview-doc="'+esc(node.id)+'">Open page</button>'
    +'<button type="button" data-send-doc="'+esc(node.id)+'">Send to Donna</button></div>'}
async function openGraphContextCard(node){
  const card=graphContextCardElement();
  if(!card)return;
  const token=++graphContextToken;
  graphContextNodeId=node.id;
  /*
   Une fiche déplacée reste où on l'a mise, y compris pour la sélection
   suivante.

   L'épinglage était remis à zéro à chaque ouverture : on choisissait un coin
   d'écran, on cliquait la feuille d'à côté, et la fiche repartait se coller au
   nœud. Le geste devait être refait à chaque clic, donc il ne servait à rien —
   or c'est précisément en enchaînant les sélections qu'on a besoin qu'elle
   cesse de bouger. Déplacer une fiche est une décision sur la mise en page,
   pas sur le document affiché ; seule sa fermeture explicite la révoque.
  */
  if(graphContextPinned){card.style.left=graphContextPlacement.left;card.style.top=graphContextPlacement.top}
  card.hidden=false;
  card.innerHTML=graphContextCardHTML(node,'Summarizing…',true);
  // L'ancre est posée avant la réponse : la fiche doit suivre le graphe même
  // pendant que le résumé se calcule.
  canvasExplorer?.anchor(node.id,positionGraphContextCard);
  positionGraphContextCard(canvasExplorer?.locate(node.id)||null);
  try{
    const summary=await json('/api/graph/summary?id='+encodeURIComponent(node.id));
    if(token!==graphContextToken)return;
    card.innerHTML=graphContextCardHTML(node,summary.summary||'No readable content.',false);
  }catch(error){
    if(token!==graphContextToken)return;
    card.innerHTML=graphContextCardHTML(node,'Summary unavailable: '+error.message,false)}
  positionGraphContextCard(canvasExplorer?.locate(node.id)||null)}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-close-context]')){event.stopImmediatePropagation();closeGraphContextCard()}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&graphContextNodeId)closeGraphContextCard()});
`;
}
