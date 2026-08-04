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
let graphContextCard=null,graphContextNodeId=null,graphContextToken=0;
function graphContextCardElement(){
  if(graphContextCard?.isConnected)return graphContextCard;
  const stage=document.querySelector('.stage');
  if(!stage)return null;
  const card=document.createElement('div');
  card.className='graph-context-card';
  card.hidden=true;
  stage.appendChild(card);
  graphContextCard=card;
  return card}
function closeGraphContextCard(){
  graphContextNodeId=null;
  // Le jeton invalide la réponse d'un résumé encore en vol : la fiche suivante
  // ne doit pas hériter du texte de la précédente.
  graphContextToken+=1;
  canvasExplorer?.anchor(null);
  if(graphContextCard)  {graphContextCard.hidden=true;graphContextCard.innerHTML=''}}
/*
 Placement : à droite du nœud si la place existe, sinon à gauche, puis rabattu
 dans le cadre. Une fiche qui déborde de la scène est une fiche qu'on ne lit
 pas — et le canevas occupe toute la scène, donc il n'y a pas de « dehors » où
 la laisser dépasser.
*/
function positionGraphContextCard(point){
  const card=graphContextCard;
  if(!card||card.hidden)return;
  const stage=document.querySelector('.stage');
  if(!stage)return;
  if(!point){card.style.visibility='hidden';return}
  card.style.visibility='';
  const frame=stage.getBoundingClientRect(),box=card.getBoundingClientRect();
  const gap=point.r+14;
  let left=point.x+gap;
  if(left+box.width>frame.width-10)left=point.x-gap-box.width;
  left=Math.max(10,Math.min(left,frame.width-box.width-10));
  const top=Math.max(10,Math.min(point.y-box.height/2,frame.height-box.height-10));
  card.style.left=left+'px';
  card.style.top=top+'px'}
function graphContextCardHTML(node,body,pending){
  const relations=documentRelationCount(node.id);
  return '<div class="gcc-head"><div><small>CONTEXTE</small><strong>'+esc(node.title||node.label||node.id)+'</strong>'
    +'<span>'+esc(node.type||'document')+' · '+relations+' relation'+(relations===1?'':'s')+'</span></div>'
    +'<button type="button" data-close-context title="Close" aria-label="Close context card">×</button></div>'
    +'<p class="gcc-body'+(pending?' pending':'')+'">'+esc(body)+'</p>'
    +'<div class="gcc-actions"><button type="button" data-preview-doc="'+esc(node.id)+'">Open page</button>'
    +'<button type="button" data-send-doc="'+esc(node.id)+'">Send to Donna</button></div>'}
async function openGraphContextCard(node){
  const card=graphContextCardElement();
  if(!card)return;
  const token=++graphContextToken;
  graphContextNodeId=node.id;
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
