/**
 * Context card, anchored to the node.
 *
 * A page with fewer than two neighbors no longer descends into focus view: the
 * descent cost the level we were on and only rendered a graph of one or two
 * nodes. The click must still answer something, and what the reader is looking
 * for at that moment is simple — what this page is about.
 *
 * The card therefore sits next to the bubble, follows zoom and pan, and
 * carries a summary produced by the LLM (cached server-side, cf.
 * `graph/wiki/summary.ts`). It stays small: it is a glance before deciding to
 * open, not a reading panel — that one already exists.
 */
export function graphUiContextCardScript(): string {
  return String.raw`
let graphContextCard=null,graphContextNodeId=null,graphContextToken=0,graphContextPinned=false;
// Hand-chosen position, kept from one card to the next as long as the one we
// moved has not been closed.
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
  // The token invalidates the response of a summary still in flight: the next
  // card must not inherit the previous one's text.
  graphContextToken+=1;
  canvasExplorer?.anchor(null);
  canvasExplorer?.avoid(null);
  // Closing is the only gesture that revokes the manual placement: we start
  // again from a card anchored to its node, as on first open.
  graphContextPinned=false;graphContextPlacement={left:'',top:''};
  if(graphContextCard)  {graphContextCard.hidden=true;graphContextCard.innerHTML=''}}

/*
 Tell the tiles the space occupied by the card.

 They move aside for the duration of the reading instead of being covered. The
 rectangle is re-read on every repositioning: it follows zoom and pan like the
 card itself.
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
 Placement: to the right of the node if there is room, otherwise to the left,
 then clamped back into the frame. A card that overflows the stage is a card
 one does not read — and the canvas occupies the whole stage, so there is no
 "outside" where it could be left to stick out.
*/
function positionGraphContextCard(point){
  const card=graphContextCard;
  if(!card||card.hidden)return;
  // A card moved by hand is a choice: we stop recomputing it. Repositioning it
  // on every frame would cancel the gesture under the fingers of whoever just
  // made it. It must nevertheless disappear if its anchor node leaves the
  // frame: otherwise it stays displayed above nothing.
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
 Move the card by hand.

 Dragging starts on the header only: the body carries the summary, which must
 be selectable, and the buttons must stay clickable. As soon as the first pixel
 is travelled the card is pinned — definitively for this opening, including if
 the graph moves afterwards.
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
  return '<div class="gcc-head"><div><small>CONTEXT</small><strong>'+esc(node.title||node.label||node.id)+'</strong>'
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
   A moved card stays where it was put, including for the next selection.

   Pinning was reset on every open: one chose a corner of the screen, clicked
   the leaf next to it, and the card went back to sticking to the node. The
   gesture had to be redone on every click, so it was useless — yet it is
   precisely when chaining selections that one needs it to stop moving. Moving
   a card is a decision about the layout, not about the displayed document;
   only its explicit closing revokes it.
  */
  if(graphContextPinned){card.style.left=graphContextPlacement.left;card.style.top=graphContextPlacement.top}
  card.hidden=false;
  card.innerHTML=graphContextCardHTML(node,'Summarizing…',true);
  // The anchor is set before the response: the card must follow the graph even
  // while the summary is being computed.
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
