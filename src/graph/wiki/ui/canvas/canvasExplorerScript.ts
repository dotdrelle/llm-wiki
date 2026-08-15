export function canvasExplorerScript(): string {
  return String.raw`
let canvasExplorer=null;
/*
 Stable placement of a domain on the map.

 The position came from the rank in the filtered list: adding a domain — which
 every ingest does — redistributed ALL the others on the circle. Following the
 arrival of the bubbles was impossible, since the whole map changed on every
 pass.

 Each domain therefore receives a placement at its first appearance and keeps
 it. The golden-angle spiral places newcomers toward the outside without ever
 aligning two points or moving the previous ones; we drop along the way the
 circle around a center, which brought nothing more.
*/
const canvasExplorerSlots=new Map();
function canvasExplorerSlot(id){
  if(!canvasExplorerSlots.has(id))canvasExplorerSlots.set(id,canvasExplorerSlots.size);
  return canvasExplorerSlots.get(id)}
function seedCanvasExplorerSlots(){(data?.communities||[]).forEach(item=>canvasExplorerSlot(item.id))}
/*
 Vogel spiral layout: the angular step is the golden angle, the radius grows
 with the square root of the rank. That is what gives an even distribution with
 no visible alignment, whatever the number of bubbles.

 The radius was too large: with seven or eight domains, the map stretched to
 the edges and the framing had to zoom out to contain everything, so that each
 cluster became tiny amid emptiness. The clusters themselves already occupy a
 surface — it is that surface which must fill the map, not the spacing between
 their centers. We therefore tighten the spiral; the separation of the halos
 remains ensured by each cluster's own radius.
*/
function canvasExplorerSlotPosition(id){
  const slot=canvasExplorerSlot(id),angle=slot*2.399963-Math.PI/2,radius=slot?.092+Math.sqrt(slot)*.076:0;
  return{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius*.72}}
// A card's remembered position no longer depends on the topology: it changed
// on every ingest, so any manual placement was lost at the precise moment the
// graph evolved — that is, when it served the most.
function canvasExplorerPositionKey(id){return'llm-wiki:graph:canvas:'+encodeURIComponent(data?.workspace||'wiki')+':'+encodeURIComponent(id)}
function readCanvasExplorerPosition(id){try{const value=JSON.parse(localStorage.getItem(canvasExplorerPositionKey(id))||'null');return Number.isFinite(value?.x)&&Number.isFinite(value?.y)?value:null}catch{return null}}
/*
 Migration of positions after a merge.

 Positions are keyed by community identifier. When a concept is absorbed, its
 bubble disappears and the manual layout the user had given it would be lost in
 silence — whereas the target community is precisely the one they were looking
 at. We therefore carry the absorbed one's position over to the target, once,
 and only if the target does not already have one: an explicitly chosen
 position prevails over an inherited one.
*/
function migrateCanvasExplorerPositions(redirects){
  if(!redirects)return;
  Object.keys(redirects).forEach(from=>{
    const to=redirects[from];
    if(!to||from===to)return;
    const key=canvasExplorerPositionKey(from);
    const saved=readCanvasExplorerPosition(from);
    if(!saved){localStorage.removeItem(key);return}
    if(!readCanvasExplorerPosition(to)){
      try{localStorage.setItem(canvasExplorerPositionKey(to),JSON.stringify(saved))}catch(error){}}
    localStorage.removeItem(key)})}
function saveCanvasExplorerPosition(node){try{localStorage.setItem(canvasExplorerPositionKey(node.id),JSON.stringify({x:node.x,y:node.y}))}catch{}}
// The list view has no bubble to anchor to: the card would leave with the
// explorer and stay lying in the middle of a table.
function destroyCanvasExplorer(){closeGraphContextCard();canvasExplorer?.destroy();canvasExplorer=null}
function separateCanvasExplorerNodes(nodes){const detailed=nodes.slice(0,50);for(let pass=0;pass<90;pass++){let moved=false;for(let i=0;i<detailed.length;i++)for(let j=i+1;j<detailed.length;j++){const a=detailed[i],b=detailed[j],dx=b.x-a.x,dy=b.y-a.y,minX=.142,minY=.078;if(Math.abs(dx)>=minX||Math.abs(dy)>=minY)continue;moved=true;if(minX-Math.abs(dx)<minY-Math.abs(dy)){const push=(dx<0?-1:1)*(minX-Math.abs(dx))*.51;a.x-=push;b.x+=push}else{const push=(dy<0?-1:1)*(minY-Math.abs(dy))*.51;a.y-=push;b.y+=push}}if(!moved)break}return nodes}
function createCanvasExplorer(host){
  // No more mini-map: on a view that already fits entirely in the frame, it
  // helped nothing and occupied a corner. Framing and the breadcrumb fill its
  // orientation role.
  host.innerHTML='<canvas class="graph-explorer-canvas" tabindex="0" role="application" aria-label="Interactive knowledge graph. Use arrow keys to pan, plus or minus to zoom."></canvas><div class="graph-explorer-a11y" role="tree" aria-label="Visible graph nodes"></div>';
  const surface=host.querySelector('.graph-explorer-canvas'),a11y=host.querySelector('.graph-explorer-a11y');
  const context=surface.getContext('2d');
  const state={scene:null,signature:'',nodeIds:null,width:0,height:0,ratio:1,hits:[],labels:[],anchor:null,obstacle:null,pointer:null,dragged:false,hover:null,viewports:new Map,clock:0,dataRevision:false};
  let scheduler,camera;
  const nodeById=new Map(data.nodes.map(node=>[node.id,node]));
  const color=index=>colors[index%colors.length];
  const light=()=>document.body.classList.contains('theme-light');
  const rgba=(hex,alpha)=>{const value=parseInt(hex.slice(1),16);return 'rgba('+((value>>16)&255)+','+((value>>8)&255)+','+(value&255)+','+alpha+')'};
  /*
   Pre-rendered halos.

   The twinkle of a cluster set shadowBlur on EVERY star: up to 48 members × 6
   domains, i.e. nearly 300 full-frame Gaussian blurs per frame. That is the
   most expensive operation of the Canvas API, and it was in the hottest loop —
   hence the stutters.

   A halo is an image that depends only on a color: we render it once in an
   off-screen canvas and copy it back at the desired scale. drawImage is
   accelerated, createRadialGradient and shadowBlur are not.
  */
  const sprites=new Map();
  function glowSprite(hex,inner,mid){
    const key=hex+'|'+inner+'|'+mid,cached=sprites.get(key);if(cached)return cached;
    const size=64,off=document.createElement('canvas');off.width=size;off.height=size;
    const paint=off.getContext('2d'),gradient=paint.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,rgba(hex,inner));gradient.addColorStop(.45,rgba(hex,mid));gradient.addColorStop(1,rgba(hex,0));
    paint.fillStyle=gradient;paint.fillRect(0,0,size,size);sprites.set(key,off);return off}
  function paintGlow(hex,inner,mid,x,y,radius){
    if(radius<=0)return;context.drawImage(glowSprite(hex,inner,mid),x-radius,y-radius,radius*2,radius*2)}
  // findIndex per document and per frame: linear in the number of domains,
  // executed thousands of times per second for an immutable result.
  const communityRank=new Map(data.communities.map((item,index)=>[item.id,index]));
  const communityIndex=id=>communityRank.get(id)??0;
  function resize(){const rect=surface.getBoundingClientRect(),ratio=Math.min(2,devicePixelRatio||1);state.width=rect.width;state.height=rect.height;state.ratio=ratio;surface.width=Math.max(1,Math.round(rect.width*ratio));surface.height=Math.max(1,Math.round(rect.height*ratio));context.setTransform(ratio,0,0,ratio,0,0);measureFrame();scheduler.invalidate()}
  /*
   The useful frame is not the canvas.

   The breadcrumb, the toolbar and the inspector are laid OVER the canvas,
   which occupies the whole stage. Framing was nevertheless computed on the
   whole canvas and centered on its middle: a third of the graph tucked under
   the inspector, and the space left free on the left stayed empty. The "Fit"
   button conscientiously reframed on a partly masked area.

   We therefore measure the panels that bite into an edge and work in what
   remains. A panel floating in the middle, on the other hand, is ignored:
   cutting it off from both sides would leave nothing.
  */
  function measureFrame(){
    const rect=surface.getBoundingClientRect();
    let left=10,right=state.width-10,top=10,bottom=state.height-10;
    (host.parentElement||host).querySelectorAll('.inspector,.stage-title,.stage-tools').forEach(panel=>{
      const box=panel.getBoundingClientRect();
      if(!box.width||!box.height||panel.hidden)return;
      const x0=box.left-rect.left,x1=box.right-rect.left,y0=box.top-rect.top,y1=box.bottom-rect.top;
      if(x1<=0||y1<=0||x0>=state.width||y0>=state.height)return;
      if(box.height>box.width){if(x0>state.width*.5)right=Math.min(right,x0-14);else left=Math.max(left,x1+14)}
      else if(y0>state.height*.5)bottom=Math.min(bottom,y0-14);
      else top=Math.max(top,y1+14)});
    const width=right-left,height=bottom-top;
    // Guardrail: on a narrow window, the panels can cover almost everything.
    // Better then to frame wide and leave a partial overlap than to reduce the
    // graph to a postage stamp.
    state.frame=width<state.width*.45||height<state.height*.45
      ?{x:state.width/2,y:state.height/2,width:Math.max(240,state.width-24),height:Math.max(200,state.height-52)}
      :{x:(left+right)/2,y:(top+bottom)/2,width,height}}
  const frame=()=>state.frame||{x:state.width/2,y:state.height/2,width:Math.max(240,state.width-24),height:Math.max(200,state.height-52)};
  function project(point){const scale=Math.min(state.width,state.height)*camera.state.scale,box=frame();const projected={x:box.x+(point.x-camera.state.x)*scale,y:box.y+(point.y-camera.state.y)*scale,scale:camera.state.scale*(point.depth||1)};return state.obstacle?shiftOutOfObstacle(projected,point):projected}
  /*
   Move aside a tile that the context card covers.

   The shift applies TO THE PROJECTION, never to the model: the normalized
   positions and those remembered in localStorage stay intact, the edges follow
   since they project the same centers, and everything returns to place when
   the card closes without having to undo anything.

   The shift direction is the one that costs the least: we exit on the side
   closest to the obstacle's edge. The node anchored to the card is exempted —
   it is the one being read, it must stay under the card that describes it.
  */
  function shiftOutOfObstacle(projected,point){
    const zone=state.obstacle;
    if(!zone||point.id&&point.id===state.anchor?.id)return projected;
    const pad=zone.pad||0;
    const left=zone.x-pad,right=zone.x+zone.width+pad,top=zone.y-pad,bottom=zone.y+zone.height+pad;
    if(projected.x<left||projected.x>right||projected.y<top||projected.y>bottom)return projected;
    const outLeft=projected.x-left,outRight=right-projected.x,outTop=projected.y-top,outBottom=bottom-projected.y;
    const min=Math.min(outLeft,outRight,outTop,outBottom);
    if(min===outLeft)return{...projected,x:left};
    if(min===outRight)return{...projected,x:right};
    if(min===outTop)return{...projected,y:top};
    return{...projected,y:bottom}}
  function communityRadius(node){return 28+Math.min(34,Math.sqrt(node.community.nodeIds.length)*7)}
  // Overflow of a node, in pixels and per side, at a given scale. A
  // constellation halo grows with zoom, a card does not: the two are not
  // computed the same way. Since the label can be placed on any side, the
  // reserve is no longer asymmetric toward the bottom — it was when the text
  // was necessarily written under the node.
  function overflow(node,scale){
    if(node.type==='community'){const r=communityRadius(node)*scale+8;return{left:r+22,right:r+22,top:r+18,bottom:r+30}}
    const half=cardWidth(node)/2+8;return{left:half,right:half,top:24,bottom:26}}
  /*
   Fixed-point framing.

   The scale depends on the extent, which depends on the scale: it is an
   implicit equation, not a division. We solved it by assuming that the widest
   node occupied both ends at once, and the tallest node the other two — an
   overestimate that never happens and that systematically cost zoom. Hence the
   two clicks on "+" after every navigation.

   We therefore iterate to the fixed point: on each pass we measure the real
   extent at the current scale and map it to the frame. Three passes suffice in
   practice, the rest is contracting.

   The center is that of the ENVELOPE, not of the positions: a label under a
   cluster shifts the whole downward, and the graph ended up high in the frame
   even after a "Fit".
  */
  function bounds(nodes){
    if(!nodes.length)return{x:0,y:0,scale:1};
    const size=Math.min(state.width,state.height)||1,box=frame(),inner=box.width,tall=box.height;
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    nodes.forEach(node=>{x0=Math.min(x0,node.x);x1=Math.max(x1,node.x);y0=Math.min(y0,node.y);y1=Math.max(y1,node.y)});
    const cx=(x0+x1)/2,cy=(y0+y1)/2;
    const envelope=scale=>{
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      nodes.forEach(node=>{
        const px=(node.x-cx)*size*scale,py=(node.y-cy)*size*scale,pad=overflow(node,scale);
        left=Math.min(left,px-pad.left);right=Math.max(right,px+pad.right);
        top=Math.min(top,py-pad.top);bottom=Math.max(bottom,py+pad.bottom)});
      return{left,right,top,bottom}};
    let scale=1;
    for(let pass=0;pass<8;pass++){
      const shape=envelope(scale);
      const next=Math.max(.35,Math.min(9,scale*Math.min(inner/Math.max(1,shape.right-shape.left),tall/Math.max(1,shape.bottom-shape.top))));
      const settled=Math.abs(next-scale)<=scale*.002;
      scale=next;
      if(settled)break}
    const shape=envelope(scale);
    return{x:cx+(shape.left+shape.right)/2/(size*scale),y:cy+(shape.top+shape.bottom)/2/(size*scale),scale:scale*.99}
  }
  // Deterministic star dust: hashing rather than Math.random, hence the same
  // image on every render and no allocation per frame. The same principle as
  // stableUnit on the projection side, transposed to the browser.
  const noise=(i,salt)=>{let h=(2166136261^salt)>>>0;const t=String(i);for(let k=0;k<t.length;k++){h=(h^t.charCodeAt(k))>>>0;h=Math.imul(h,16777619)>>>0}return h/4294967295};
  const dust=Array.from({length:150},(_,i)=>({x:noise(i,7),y:noise(i,31),z:noise(i,53),a:.10+noise(i,97)*.35}));
  // The background depends only on the size and the theme: the gradient is
  // rebuilt when one of the two changes, not sixty times per second.
  let backdrop=null,backdropKey='';
  function drawBackground(){
    const pale=light(),key=state.width+'x'+state.height+(pale?'l':'d');
    if(key!==backdropKey){
      backdrop=context.createRadialGradient(state.width*.5,state.height*.42,0,state.width*.5,state.height*.45,Math.max(state.width,state.height)*.75);
      backdrop.addColorStop(0,pale?'#ffffff':'#101827');
      backdrop.addColorStop(.55,pale?'#f4f7fb':'#0a0e18');
      backdrop.addColorStop(1,pale?'#e7edf4':'#06080d');
      backdropKey=key}
    context.fillStyle=backdrop;context.fillRect(0,0,state.width,state.height);
    // On a light background luminous dust would be noise: we do without it.
    if(pale||state.scene?.level!=='map')return;
    dust.forEach(star=>{const x=(star.x*state.width+state.clock*6*star.z)%state.width;
      context.fillStyle='rgba(190,205,235,'+star.a*.5+')';context.fillRect(x,star.y*state.height,1.2,1.2)})}
  function curvedEdge(from,to,edge){const a=project(from),b=project(to),cx=(a.x+b.x)/2-(b.y-a.y)*.11,cy=(a.y+b.y)/2+(b.x-a.x)*.11,active=edge.active||from.status==='running'||to.status==='running';context.beginPath();context.moveTo(a.x,a.y);context.quadraticCurveTo(cx,cy,b.x,b.y);context.strokeStyle=active?'rgba(77,156,255,.9)':(light()?'rgba(92,116,148,.34)':'rgba(126,151,185,.28)');context.lineWidth=Math.min(4,1+Math.sqrt(edge.weight||1)*.45);if(edge.type==='related_to')context.setLineDash([3,6]);context.stroke();context.setLineDash([])}
  /*
   Aggregated link between two domains.

   It used to borrow the rendering of document links: a uniform gray that says
   "there is a link" without saying between whom. A gradient from one domain's
   color to the other says it without a legend, and the counter — requested by
   the specification — gives the weight of the relation. The particle indicates
   the reading direction without adding an arrow, which would weigh down the
   overview.
  */
  function communityEdge(from,to,edge,indexFrom,indexTo){
    const a=project(from),b=project(to),cx=(a.x+b.x)/2-(b.y-a.y)*.13,cy=(a.y+b.y)/2+(b.x-a.x)*.13;
    const count=edge.weight||edge.count||1,pale=light();
    const gradient=context.createLinearGradient(a.x,a.y,b.x,b.y);
    gradient.addColorStop(0,rgba(color(indexFrom),pale?.5:.36));
    gradient.addColorStop(.5,pale?'rgba(120,138,166,.16)':'rgba(150,165,200,.10)');
    gradient.addColorStop(1,rgba(color(indexTo),pale?.5:.36));
    context.strokeStyle=gradient;context.lineWidth=.7+Math.min(2.8,Math.sqrt(count)*.9);
    context.beginPath();context.moveTo(a.x,a.y);context.quadraticCurveTo(cx,cy,b.x,b.y);context.stroke();
    const t=(Math.sin(state.clock*1.6+indexFrom*1.3+indexTo)*.5+.5),u=1-t;
    context.fillStyle=pale?'rgba(70,92,124,.65)':'rgba(220,232,255,.55)';
    context.beginPath();context.arc(u*u*a.x+2*u*t*cx+t*t*b.x,u*u*a.y+2*u*t*cy+t*t*b.y,1.6,0,Math.PI*2);context.fill();
    if(count>1){context.textAlign='center';context.font='10px ui-sans-serif,system-ui';
      context.fillStyle=pale?'rgba(70,92,124,.9)':'rgba(163,178,203,.85)';
      context.fillText(count,(a.x+b.x)/2-(b.y-a.y)*.065,(a.y+b.y)/2+(b.x-a.x)*.065)}}
  /*
   A constellation, not a clock face.

   The members were distributed on a perfect circle, at a regular step and
   constant radius: the eye reads a clock there, not a cluster. The golden
   angle (2.39996 rad) combined with a square-root radius fills the disk
   without ever aligning two points, which is exactly what distinguishes a
   constellation from a geometric figure.

   The twinkle is desynchronized per node: that is what gives substance to a
   motionless cluster, at zero cost since the render is already animated.
  */
  // A domain's members do not change from one frame to the next; recomputing
  // them sixty times per second via a map/filter over the whole index was pure
  // wasted work.
  const membersOf=node=>{
    if(!node.members)node.members=node.community.nodeIds.map(id=>nodeById.get(id)).filter(Boolean).slice(0,48);
    return node.members};
  function drawCommunity(node,index){
    const point=project(node),shown=membersOf(node);
    const radius=communityRadius(node)*point.scale,paint=color(index),hot=state.hover===node.id,pale=light();
    /*
     A bubble being absorbed glides toward its target while fading.

     It has no more members to show — the registry deprecated it — so we only
     draw its halo, increasingly pale. The gesture says "this is leaving for
     over there", which a dry disappearance does not say.
    */
    if(node.merging){
      context.save();context.globalAlpha=node.merging*.7;
      paintGlow(paint,.3,.08,point.x,point.y,radius*2.1*node.merging);
      context.strokeStyle=rgba(paint,.45);context.lineWidth=1;context.setLineDash([2,5]);
      context.beginPath();context.arc(point.x,point.y,radius*node.merging,0,Math.PI*2);context.stroke();
      context.setLineDash([]);context.restore();return}
    const beat=state.clock;
    // Three stops: a dense core, a mid-course decay, a complete extinction.
    // Two stops gave a linear fall, which reads as a flat disk instead of a
    // nebula.
    paintGlow(paint,hot?.34:.22,pale?.10:.07,point.x,point.y,radius*2.1);
    shown.forEach((member,memberIndex)=>{
      const angle=memberIndex*2.399963,spread=radius*(.24+Math.sqrt(memberIndex/Math.max(1,shown.length))*.66);
      const qx=point.x+Math.cos(angle)*spread,qy=point.y+Math.sin(angle)*spread*.66;
      const twinkle=.62+.38*Math.sin(beat*3.1+memberIndex*1.7);
      const core=1.5+Math.min(3,Math.sqrt(member.degree||0))*.9;
      paintGlow(paint,.55*twinkle,.18*twinkle,qx,qy,core*3.4);
      context.fillStyle=pale?rgba(paint,.55+.35*twinkle):'rgba(237,245,255,'+(.55+.45*twinkle)+')';
      context.beginPath();context.arc(qx,qy,core,0,Math.PI*2);context.fill()});
    context.strokeStyle=rgba(paint,hot?.9:.4);context.lineWidth=hot?1.6:.9;context.setLineDash([2,5]);
    context.beginPath();context.arc(point.x,point.y,radius,0,Math.PI*2);context.stroke();context.setLineDash([]);
    // The label is no longer written here: it goes into the placement queue,
    // which will set it outside the cluster while avoiding its neighbors.
    // Writing it in place, under the node, piled the texts on top of each other
    // as soon as the map filled up — that is, as soon as it became useful.
    // The displayed count is the domain's, not the drawn stars': the
    // constellation is capped at 48 points, the domain is not.
    state.labels.push({x:point.x,y:point.y,radius,weight:1e6+node.community.nodeIds.length,always:true,lines:[
      // The label already arrives formatted by the scene, which alone knows
      // whether it is a domain or a leaf.
      {text:node.label,font:'500 13px ui-sans-serif,system-ui',height:15,color:hot?(pale?'#0d1826':'#f4f7fc'):(pale?'#2a3a4d':'#c9d3e2')},
      {text:node.community.nodeIds.length+' pages',font:'11px ui-sans-serif,system-ui',height:13,color:rgba(paint,pale?.95:.8)}]});
    state.hits.push({node,x:point.x,y:point.y,r:Math.max(28,radius*1.1)})}
  function cardWidth(node){return Math.min(210,82+String(node.label).length*5.8)}
  function drawDocument(node,index){const point=project(node),paint=color(communityIndex(node.communityId)),selectedNode=selected?.id===node.id,detail=point.scale>1.55,w=cardWidth(node),h=38;if(detail){
      // The shadow blur is reserved for the selected card — a single one. On
      // the others, a pre-rendered halo gives the same relief without running a
      // Gaussian blur again per card and per frame.
      if(!selectedNode)paintGlow(paint,.20,.07,point.x,point.y,Math.max(w,h)*.78);
      else{context.shadowBlur=24;context.shadowColor=rgba(paint,.8)}
      context.fillStyle='rgba(16,23,34,.96)';context.beginPath();context.roundRect(point.x-w/2,point.y-h/2,w,h,9);context.fill();context.shadowBlur=0;context.strokeStyle=rgba(paint,selectedNode?1:.55);context.lineWidth=selectedNode?2:1;context.stroke();context.fillStyle=paint;context.fillRect(point.x-w/2+3,point.y-h/2+7,3,h-14);context.textAlign='left';context.font='600 11.5px ui-sans-serif,system-ui';context.fillStyle='#edf3fb';let label=node.label;while(context.measureText(label).width>w-28&&label.length>5)label=label.slice(0,-2);context.fillText(label+(label!==node.label?'…':''),point.x-w/2+13,point.y-2);context.font='10px ui-sans-serif,system-ui';context.fillStyle=rgba(paint,.9);const relationsLabel=graphRelationsLabel(node.degree);if(relationsLabel)context.fillText(relationsLabel,point.x-w/2+13,point.y+12);state.hits.push({node,x:point.x,y:point.y,w,h})}else{const core=3+Math.sqrt(node.degree||0);paintGlow(paint,.5,.16,point.x,point.y,core*3.6);context.fillStyle='#f4f8ff';context.beginPath();context.arc(point.x,point.y,core,0,Math.PI*2);context.fill();if(point.scale>1.02)state.labels.push({x:point.x,y:point.y,radius:core+3,weight:(node.degree||0)+(selectedNode||state.hover===node.id?1e5:0),always:selectedNode||state.hover===node.id,lines:[{text:node.label.length>22?node.label.slice(0,21)+'…':node.label,font:'10px ui-sans-serif,system-ui',height:12,color:light()?'rgba(44,60,80,.88)':'rgba(220,229,242,.78)'}]});state.hits.push({node,x:point.x,y:point.y,r:15})}}
  /*
   Label placement, in one pass after the nodes.

   A label written at the moment its node is drawn cannot know anything about
   the ones that follow: that is what piled them up. We therefore collect them
   all, then set them from most to least important, reserving each one's
   rectangle. The preferred direction is the one moving away from the cloud's
   barycenter — a label set outward meets nothing —, the eight cardinal
   directions serving as fallback, then a progressive move away.

   What finds no place is not superimposed: it disappears. An important node
   always keeps its label, an isolated point finds it again on hover or
   selection, and the left column remains the exhaustive index. An unreadable
   text informs no one, two superimposed texts inform less than one.
  */
  function drawLabels(){
    const queue=state.labels;
    if(!queue.length)return;
    let cx=0,cy=0;
    queue.forEach(item=>{cx+=item.x/queue.length;cy+=item.y/queue.length});
    const placed=[];
    const collides=box=>placed.some(other=>Math.abs(box.x-other.x)<(box.w+other.w)/2+5&&Math.abs(box.y-other.y)<(box.h+other.h)/2+4);
    const outside=box=>box.x-box.w/2<-40||box.x+box.w/2>state.width+40||box.y-box.h/2<-20||box.y+box.h/2>state.height+20;
    queue.sort((a,b)=>b.weight-a.weight).forEach(item=>{
      let width=0,height=0;
      item.lines.forEach(line=>{context.font=line.font;width=Math.max(width,context.measureText(line.text).width);height+=line.height});
      const dx=item.x-cx,dy=item.y-cy,length=Math.hypot(dx,dy)||1;
      const headings=[{x:dx/length,y:dy/length},{x:0,y:1},{x:0,y:-1},{x:1,y:0},{x:-1,y:0},{x:.71,y:.71},{x:-.71,y:.71},{x:.71,y:-.71},{x:-.71,y:-.71}];
      let box=null;
      for(const heading of headings){
        for(let step=0;step<3;step++){
          const reach=item.radius+7+step*(height*.75+7);
          const candidate={x:item.x+heading.x*(reach+width/2*Math.abs(heading.x)),y:item.y+heading.y*(reach+height/2*Math.abs(heading.y)),w:width,h:height};
          if(collides(candidate)||outside(candidate))continue;
          box=candidate;break}
        if(box)break}
      if(!box){
        if(!item.always)return;
        box={x:item.x,y:item.y+item.radius+7+height/2,w:width,h:height}}
      placed.push(box);
      let top=box.y-height/2;
      context.textAlign='center';
      item.lines.forEach(line=>{context.font=line.font;context.fillStyle=line.color;context.fillText(line.text,box.x,top+line.height*.78);top+=line.height})})}
  // Screen position of a node, radius included. An outside caller — the
  // context card — does not need to know the camera or the frame to set itself
  // next to a bubble.
  function locateNode(id){
    const node=state.scene?.nodes.find(item=>item.id===id);
    if(!node)return null;
    const point=project(node);
    const radius=node.type==='community'?communityRadius(node)*point.scale:point.scale>1.55?cardWidth(node)/2:3+Math.sqrt(node.degree||0);
    if(point.x<-radius||point.y<-radius||point.x>state.width+radius||point.y>state.height+radius)return null;
    return{x:point.x,y:point.y,r:radius}}
  function renderA11y(){a11y.innerHTML=state.scene.nodes.map(node=>'<button type="button" role="treeitem" data-canvas-node="'+esc(node.id)+'">'+esc(node.label)+'</button>').join('')}
  function draw(now){
    // The scheduler requests a frame as soon as it is constructed, before the
    // camera is assigned and before the first setScene. Today nothing breaks
    // because requestAnimationFrame is asynchronous and setScene follows
    // immediately — it is a scheduling accident, not a guarantee.
    if(!camera||!state.scene)return;
    camera.tick(now);state.clock=now/1000;state.hits=[];state.labels=[];
    context.clearRect(0,0,state.width,state.height);drawBackground();
    const byId=new Map(state.scene.nodes.map(node=>[node.id,node]));
    // A domain's color index must come from its place in the list, not from its
    // drawing rank: the latter changes with the depth sort, and the color would
    // jump from one frame to the next.
    const rank=new Map(state.scene.nodes.filter(node=>node.type==='community').map((node,i)=>[node.id,i]));
    state.scene.edges.forEach(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to);if(!from||!to)return;
      if(from.type==='community'&&to.type==='community')communityEdge(from,to,edge,rank.get(from.id)||0,rank.get(to.id)||0);
      else curvedEdge(from,to,edge)});
    // Relations toward the domains left folded. They do not appear in
    // scene.edges: their endpoint is not a document but a constellation, and
    // they aggregate several relations into one.
    state.scene.nodes.forEach((node,index)=>{
      if(!node.collapsed||!node.links)return;
      node.links.forEach(link=>{const from=byId.get(link.from);
        if(from)communityEdge(from,node,{weight:link.count},rank.get(node.id)??index,rank.get(node.id)??index)})});
    state.scene.nodes.slice().sort((a,b)=>(a.depth||1)-(b.depth||1))
      .forEach((node,index)=>{
        node.type==='community'?drawCommunity(node,rank.get(node.id)??index):drawDocument(node,index);
        // What just appeared during an ingest signals itself in place: the
        // reader sees the page arrive in its domain without anything else
        // moving. The halo fades on its own.
        const fresh=graphNodeFreshness(node.id);
        if(!fresh)return;
        const spot=project(node),ring=(node.type==='community'?communityRadius(node)*spot.scale:9)+7+(1-fresh)*10;
        context.strokeStyle='rgba(116,195,101,'+(fresh*.85).toFixed(3)+')';context.lineWidth=2;
        context.beginPath();context.arc(spot.x,spot.y,ring,0,Math.PI*2);context.stroke()});
    drawLabels();
    // The anchor is sampled at the frame, not at the event: zoom, pan and
    // animated reframing all go through the drawing, and a single measurement
    // point avoids a floating card detaching from its bubble during a
    // transition.
    if(state.anchor)state.anchor.notify(locateNode(state.anchor.id));
    /*
     The "new" halo is brief and watched: full cadence. The background twinkle
     does not justify a permanent loop: even reduced to 12 frames/s, it redrew
     the whole scene indefinitely. Outside a transition, a halo or an
     interaction, the Canvas now really stays at rest.
    */
    // A merge convergence is brief and watched, like the halo: it needs the
    // full cadence, and returns the scene to rest as it completes.
    if(hasFreshGraphNodes()||hasGraphMerges())scheduler.animate(260)}
  scheduler=createGraphFrameScheduler(draw);camera=createGraphCamera(scheduler);resize();
  /*
   The map's ambience stays alive, but at reduced cadence.

   Batch 1 had correctly removed the permanent 60 FPS loop, then went too far by
   never wiring the low-cadence regime the scheduler provided. The visible
   result was a completely frozen background that only seemed to come back to
   life on mouse-over. An infinite deadline is intentional here: the scheduler
   sleeps between two frames (≈ 12.5 FPS), interrupts itself when the document
   is hidden and does not start under reduced-motion.
  */
  scheduler.idle(Number.POSITIVE_INFINITY,80);
  function hit(x,y){return [...state.hits].reverse().find(item=>item.w?Math.abs(x-item.x)<=item.w/2&&Math.abs(y-item.y)<=item.h/2:Math.hypot(x-item.x,y-item.y)<=item.r)}
  function coordinates(event){const rect=surface.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top}}
  // The double-click descends as far as it can, but not into a relation-less
  // page: the focus view would be empty there. See selectDocument.
  function activate(node,deep=false){if(node.type==='community')selectCommunity(node.id);else if(deep&&documentHasRelations(node.id)){selected=node;selectedCommunity=node.communityId;view='focus';render()}else selectDocument(node)}
  /*
   End of gesture, in a single place.

   The graph stayed hooked to the cursor after release: one had to click again
   to get rid of it. pointerup did reset state.pointer to null, but it never
   released the capture, and above all pointercancel was listened to nowhere. A
   gesture cancelled by the browser — tab change, touch interruption, button
   released outside the frame — therefore left the drag state active
   indefinitely.
  */
  function endPointerGesture(event,point){
    if(!state.pointer)return;
    const dragging=state.pointer.target&&state.pointer.target.node.type!=='community';
    if(state.dragged&&dragging)saveCanvasExplorerPosition(state.pointer.target.node);
    // A click in the void closes the context card: it is the gesture by which
    // one closes any layer, and the cross remains for those who do not try it.
    else if(!state.dragged&&point){const target=hit(point.x,point.y);if(target)activate(target.node);else closeGraphContextCard()}
    // The identifier is memorized at capture, not re-read from the event: a
    // release outside the canvas provides none, and the capture would stay
    // pending — the canvas would keep intercepting the events intended for the
    // panels hovering over it.
    const captured=state.pointer.pointerId;
    state.pointer=null;state.dragged=false;
    if(captured!==undefined&&surface.hasPointerCapture?.(captured))surface.releasePointerCapture(captured);
    scheduler.invalidate()
  }
  surface.addEventListener('pointerdown',event=>{const point=coordinates(event),target=hit(point.x,point.y);state.pointer={...point,lastX:point.x,lastY:point.y,target,pointerId:event.pointerId};state.dragged=false;surface.setPointerCapture(event.pointerId)});
  surface.addEventListener('pointermove',event=>{const point=coordinates(event);
    if(!state.pointer){const target=hit(point.x,point.y);state.hover=target?.node.id||null;scheduler.invalidate();return}
    // Dragging is only valid while the button is held down. This check makes
    // the gesture independent of a release event being correctly received: if
    // the button is up, we let go, period.
    if(event.buttons===0){endPointerGesture(event,null);return}
    const dx=point.x-state.pointer.lastX,dy=point.y-state.pointer.lastY;if(Math.abs(point.x-state.pointer.x)+Math.abs(point.y-state.pointer.y)>4)state.dragged=true;if(state.pointer.target&&state.pointer.target.node.type!=='community'){const modelScale=Math.min(state.width,state.height)*camera.state.scale;state.pointer.target.node.x+=dx/modelScale;state.pointer.target.node.y+=dy/modelScale}else camera.pan(-dx/(Math.min(state.width,state.height)*camera.state.scale),-dy/(Math.min(state.width,state.height)*camera.state.scale));state.pointer.lastX=point.x;state.pointer.lastY=point.y;scheduler.invalidate()});
  surface.addEventListener('pointerup',event=>endPointerGesture(event,coordinates(event)));
  surface.addEventListener('pointercancel',event=>endPointerGesture(event,null));
  // Last safety net: a release that happens outside the canvas, on a panel or
  // outside the window, never reaches the handlers above. These listeners live
  // on window, so they would survive the explorer: we keep them in order to be
  // able to remove them in destroy().
  const releaseOutside=()=>{if(state.pointer)endPointerGesture(null,null)};
  window.addEventListener('pointerup',releaseOutside);
  window.addEventListener('blur',releaseOutside);
  surface.addEventListener('dblclick',event=>{const point=coordinates(event),target=hit(point.x,point.y);if(target)activate(target.node,true);else camera.moveTo(bounds(state.scene.nodes),280)});
  surface.addEventListener('wheel',event=>{event.preventDefault();const point=coordinates(event),size=Math.min(state.width,state.height),box=frame(),worldX=camera.state.x+(point.x-box.x)/(size*camera.state.scale),worldY=camera.state.y+(point.y-box.y)/(size*camera.state.scale);camera.zoomAt(event.deltaY<0?1.14:1/1.14,worldX,worldY)},{passive:false});
  surface.addEventListener('keydown',event=>{const step=.06/camera.state.scale;if(event.key==='ArrowLeft')camera.pan(-step,0);else if(event.key==='ArrowRight')camera.pan(step,0);else if(event.key==='ArrowUp')camera.pan(0,-step);else if(event.key==='ArrowDown')camera.pan(0,step);else if(event.key==='+'||event.key==='=')camera.zoomAt(1.2,camera.state.x,camera.state.y);else if(event.key==='-')camera.zoomAt(1/1.2,camera.state.x,camera.state.y);else if(event.key==='Home')camera.moveTo(bounds(state.scene.nodes),260);else return;event.preventDefault()});
  a11y.addEventListener('click',event=>{const button=event.target.closest('[data-canvas-node]'),node=state.scene.nodes.find(item=>item.id===button?.dataset.canvasNode);if(node)activate(node)});
  // The panels are observed on the same footing as the canvas: their size
  // changes with their content (a domain of 12 documents does not take the
  // space of a domain of 3), and it is that size that defines the useful
  // frame.
  const observer=new ResizeObserver(resize);observer.observe(host);
  (host.parentElement||host).querySelectorAll('.inspector,.stage-title,.stage-tools').forEach(panel=>observer.observe(panel));const themeObserver=new MutationObserver(()=>scheduler.invalidate());themeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  /*
   A new scene reframes; the same scene keeps its framing.

   The remembered marker was the view LEVEL. Moving from one domain to another
   therefore did not change the level: neither branch fired and the camera
   stayed as it was, framed on the previous domain. One had to recenter and
   rezoom by hand on every entity — and returning to an already visited domain
   restored another one's framing, which is worse than nothing.

   The marker is now the content of the scene. Unprecedented content frames
   automatically, already-left content recovers the framing it had been given,
   and a simple redraw does not move the camera — otherwise manually moving a
   card would retrigger a reframe on every frame.
  */
  /*
   A scene that grows is not a new scene.

   The marker is the node list: the arrival of a document during an ingest
   changes it, and the camera therefore reframed on every new page — in the
   middle of reading, cancelling zoom and pan. But adding is not navigating. As
   long as everything that was displayed still is, we keep the framing; the
   newcomer signals itself by its halo, not by moving the rest.
  */
  /*
   A data revision is not a navigation.

   The "the scene grows" marker above covers addition: all the old nodes still
   present. A merge DELETES: the scene therefore went back to "new scene" and
   reframed, in the middle of reading, cancelling zoom and pan. But the user
   asked for nothing; it is the corpus that moved under their eyes.

   Rather than a third test on the node sets — fragile, and which would have to
   guess what changed — we distinguish the CAUSE: a reframe belongs only to a
   voluntary navigation. The flag is single-use, set by the application of a
   revision, and consumed by the next render.
  */
  return{host,
  markDataRevision(){state.dataRevision=true},
  setScene(scene){
    const signature=scene.level+'#'+scene.nodes.map(node=>node.id).join('|');
    if(state.signature)state.viewports.set(state.signature,{...camera.state});
    const previous=state.signature,previousIds=state.nodeIds;
    const nodeIds=new Set(scene.nodes.map(node=>node.id));
    const grew=!!previousIds&&scene.level===state.scene?.level&&[...previousIds].every(id=>nodeIds.has(id));
    // Consumed no matter what: a flag that survives its render would freeze the
    // camera on the next navigation, which does have the right to reframe.
    const fromRevision=state.dataRevision;state.dataRevision=false;
    state.scene=scene;state.signature=signature;state.nodeIds=nodeIds;
    renderA11y();measureFrame();
    if(signature!==previous&&!grew&&!fromRevision){const saved=state.viewports.get(signature);camera.moveTo(saved||bounds(scene.nodes),saved?260:320)}
    scheduler.invalidate()},
  anchor(id,notify){state.anchor=id?{id,notify}:null;if(!id)state.obstacle=null;scheduler.invalidate()},
  // Rectangle in screen pixels that the tiles must avoid, or null.
  avoid(zone){
    const next=zone?{x:zone.x,y:zone.y,width:zone.width,height:zone.height,pad:zone.pad??14}:null;
    const same=JSON.stringify(next)===JSON.stringify(state.obstacle);
    state.obstacle=next;
    if(!same)scheduler.invalidate()},
  locate:locateNode,
  fit(){measureFrame();camera.moveTo(bounds(state.scene.nodes),280)},zoom(factor){camera.zoomAt(factor,camera.state.x,camera.state.y)},destroy(){observer.disconnect();themeObserver.disconnect();window.removeEventListener('pointerup',releaseOutside);window.removeEventListener('blur',releaseOutside);scheduler.destroy()},invalidate:scheduler.invalidate}
}
function renderCanvasExplorer(){
  if(!canvasExplorer||canvasExplorer.host!==canvas||!canvasExplorer.host.isConnected){destroyCanvasExplorer();canvasExplorer=createCanvasExplorer(canvas)}
  // The "domain" level shows communities, not documents: it is a map
  // restricted to a branch, not a list of pages.
  canvasExplorer.setScene(view==='map'||view==='domain'?canvasExplorerSceneMap():canvasExplorerSceneDocuments())
}
/*
 Bubbles being absorbed, reinjected into the scene.

 They are no longer in the community list — the registry deprecated them — but
 they were on screen an instant before. Removing them dryly would make three
 domains disappear with nothing explaining where their pages went. We keep them
 for the duration of the convergence, at their last known placement, gliding
 them toward their target.
*/
function canvasExplorerMergingNodes(visibleIds){
  const merging=[];
  graphMerging.forEach((entry,id)=>{
    const progress=graphMergeProgress(id);
    if(!progress||!visibleIds.has(entry.to))return;
    const from=canvasExplorerSlotPosition(id),to=canvasExplorerSlotPosition(entry.to);
    // progress goes from 1 (departure) to 0 (arrival): the bubble leaves its
    // place and ends exactly on its target, where it fades.
    merging.push({id,label:'',type:'community',merging:progress,
      community:{id,label:'',nodeIds:[],documentCount:0,conceptCount:0,sourceCount:0,internalRelations:0,externalRelations:0},
      x:to.x+(from.x-to.x)*progress,y:to.y+(from.y-to.y)*progress,depth:.9})});
  return merging}
/*
 Groups the leaf communities under their domain.

 The registry is a tree, a graph node only knows its leaf. Without this fold,
 the map would show as many bubbles as there are subjects — that is, the
 opposite of what a first screen must show. A still-flat taxonomy has no
 domain: the map then keeps its original rendering.
*/
function canvasExplorerRollUp(communities){
  const parents=data.communityParents||{},domains=data.domains||[];
  if(!domains.length)return communities;
  // Descended into a domain: we show ITS communities, without folding them.
  if(view==='domain'&&selectedCommunity)return communities.filter(item=>parents[item.id]===selectedCommunity);
  const byId=new Map(domains.map(item=>[item.id,item]));
  const merged=new Map();
  communities.forEach(item=>{
    const domainId=parents[item.id];
    const domain=domainId?byId.get(domainId):null;
    if(!domain){merged.set(item.id,item);return}
    const current=merged.get(domain.id);
    if(!current){
      // The domain carries the union of its leaves: its counts are the sum of
      // theirs, never of pages that would be attached to it in its own right.
      merged.set(domain.id,{...item,id:domain.id,label:domain.label,nodeIds:[...item.nodeIds],
        documentCount:item.documentCount,conceptCount:item.conceptCount,sourceCount:item.sourceCount,
        internalRelations:item.internalRelations,externalRelations:item.externalRelations});
      return}
    current.nodeIds=[...current.nodeIds,...item.nodeIds];
    current.documentCount+=item.documentCount;current.conceptCount+=item.conceptCount;
    current.sourceCount+=item.sourceCount;
    current.internalRelations+=item.internalRelations;current.externalRelations+=item.externalRelations});
  return [...merged.values()]}
/*
 A bubble counts the DISPLAYED pages, not the registry's.

 We only kept the communities with at least one visible page, then reused their
 whole member list: the pages removed by the type filters — the unticked raw
 sources, for example — stayed counted. The bubble therefore systematically
 announced more than it contained, and its count contradicted the left index's,
 which does apply the filter.

 The domain inheriting the sum of its leaves, the gap accumulated all the more.
*/
function canvasExplorerVisibleCommunities(ids){
  const scoped=[];
  data.communities.forEach(item=>{
    const nodeIds=item.nodeIds.filter(id=>ids.has(id));
    if(!nodeIds.length)return;
    scoped.push({...item,nodeIds,documentCount:nodeIds.length})});
  return scoped}
function canvasExplorerSceneMap(){const graph=visible(),ids=new Set(graph.nodes.map(node=>node.id)),communities=canvasExplorerRollUp(canvasExplorerVisibleCommunities(ids)),nodes=communities.map((item,index)=>{const spot=canvasExplorerSlotPosition(item.id);
  // The level decides the typography: a domain is a heading, a leaf is a named
  // subject.
  const isDomain=(data.domains||[]).some(domain=>domain.id===item.id);
  return{id:item.id,label:isDomain?graphDomainDisplay(item.label):graphLeafDisplay(item.label),type:'community',community:item,x:spot.x,y:spot.y,depth:.92+(index%4)*.04}}),visibleIds=new Set(nodes.map(node=>node.id));return{level:'map',nodes:[...nodes,...canvasExplorerMergingNodes(visibleIds)],edges:canvasExplorerRollUpEdges(visibleIds)}}
/*
 The links follow the fold, otherwise the domain map has no edge.

 Community edges link LEAVES. Once the bubbles are folded, no edge identifier
 corresponds to a displayed node anymore: the map ended up strewn with bubbles
 without a single relation, which is the opposite of what a first screen must
 show. We therefore rewrite each edge to the visible level and aggregate the
 duplicates.
*/
function canvasExplorerRollUpEdges(visibleIds){
  const parents=data.communityParents||{},domains=data.domains||[];
  const lift=id=>{
    if(visibleIds.has(id))return id;
    const parent=parents[id];
    return parent&&visibleIds.has(parent)?parent:null};
  const merged=new Map();
  (data.communityEdges||[]).forEach(edge=>{
    const from=domains.length?lift(edge.from):(visibleIds.has(edge.from)?edge.from:null);
    const to=domains.length?lift(edge.to):(visibleIds.has(edge.to)?edge.to:null);
    // A relation internal to a domain says nothing AT the domain level: it will
    // appear when it is opened.
    if(!from||!to||from===to)return;
    const key=from+'\u0000'+to,current=merged.get(key);
    if(current)current.weight+=edge.count;
    else merged.set(key,{...edge,from,to,weight:edge.count})});
  return [...merged.values()]}
function canvasExplorerSceneDocuments(){const graph=visible(),community=data.communities.find(item=>item.id===selectedCommunity)||(selected?data.communities.find(item=>item.nodeIds.includes(selected.id)):null);if(!community)return{level:view,nodes:[],edges:[]};let ids=new Set(community.nodeIds);if(view==='focus'&&selected){ids=new Set([selected.id]);data.edges.forEach(edge=>{if(edge.from===selected.id)ids.add(edge.to);if(edge.to===selected.id)ids.add(edge.from)})}const source=graph.nodes.filter(node=>ids.has(node.id)).sort((a,b)=>Number(b.id===selected?.id)-Number(a.id===selected?.id)||(b.degree||0)-(a.degree||0)||a.id.localeCompare(b.id)).slice(0,50),count=Math.max(1,source.length),typeColumns={'raw-source':-.36,'wiki-source':-.3,template:-.12,'build-context':-.08,wiki:.15,deliverable:.36},nodes=source.map((node,index)=>{let x,y;if(view==='focus'&&selected){if(node.id===selected.id){x=0;y=0}else{const angle=Math.PI*2*index/count-Math.PI/2;x=typeColumns[node.type]??Math.cos(angle)*.34;y=Math.sin(angle)*.28}}else{const angle=index*2.399963,r=.04+Math.sqrt(index)*.048;x=Math.cos(angle)*r;y=Math.sin(angle)*r*.8}const saved=readCanvasExplorerPosition(node.id);if(saved){x=saved.x;y=saved.y}return{...node,label:node.title,x,y,depth:.9+(index%5)*.04,communityId:node.community?.communityId}});separateCanvasExplorerNodes(nodes);const visibleIds=new Set(nodes.map(node=>node.id));
  const edges=data.edges.filter(edge=>visibleIds.has(edge.from)&&visibleIds.has(edge.to));
  return{level:view,nodes:[...nodes,...collapsedNeighbourGroups(nodes,visibleIds,edges)],edges}}

/*
 Neighboring domains, left folded on the periphery.

 Opening a domain filtered out all the relations going out of it: we lost the
 most useful information of the view — "this page also points elsewhere". The
 reader could not guess it, nothing on screen suggested it.

 We therefore add a folded constellation per neighboring domain, set on a ring
 around the open group, and reconnect the outgoing relations to it. A click
 opens it in turn, which makes lateral navigation possible without going back
 through the map.
*/
function collapsedNeighbourGroups(inner,visibleIds,edges){
  const home=new Map();data.communities.forEach(item=>item.nodeIds.forEach(id=>home.set(id,item.id)));
  const openIds=new Set(inner.map(node=>node.id));
  const reach=new Map();
  data.edges.forEach(edge=>{
    const insideFrom=openIds.has(edge.from),insideTo=openIds.has(edge.to);
    if(insideFrom===insideTo)return;
    const outsideId=insideFrom?edge.to:edge.from,insideId=insideFrom?edge.from:edge.to;
    const groupId=home.get(outsideId);
    // A neighbor already displayed does not need to be represented twice, and a
    // domain-less page has no constellation to tuck into.
    if(!groupId||visibleIds.has(outsideId)||openIds.has(outsideId))return;
    if(!reach.has(groupId))reach.set(groupId,{ids:new Set(),from:new Map()});
    const entry=reach.get(groupId);entry.ids.add(outsideId);
    entry.from.set(insideId,(entry.from.get(insideId)||0)+1)});
  if(!reach.size)return[];
  /*
   Each neighbor settles on the side by which it is linked.

   They were distributed at a regular step on a circle of uniform radius, in
   alphabetical order: a domain's position therefore said nothing about its
   relation to the open group. A neighbor hooked at the bottom left could land
   due north, its link crossing the whole cloud, while a free sector stayed
   empty — and the framing had to encompass a ring whose main part contained
   nothing.

   The direction now comes from the barycenter of the pages that cite it,
   weighted by the number of links. The distance follows the real silhouette of
   the cloud in that direction, not its maximal radius: an elongated cloud no
   longer pushes its lateral neighbors back to the distance of its tip. The
   links are short, they no longer cross anything, and the free space is
   occupied where it is.
  */
  const position=new Map(inner.map(node=>[node.id,node]));
  const centre=inner.reduce((sum,node)=>({x:sum.x+node.x/inner.length,y:sum.y+node.y/inner.length}),{x:0,y:0});
  const innerRadius=Math.max(.12,...inner.map(node=>Math.hypot(node.x-centre.x,node.y-centre.y)));
  const margin=Math.max(.10,innerRadius*.38);
  const groups=[...reach].sort(([a],[b])=>a.localeCompare(b));
  const placed=groups.map(([groupId,entry],index)=>{
    const item=data.communities.find(candidate=>candidate.id===groupId);
    if(!item)return null;
    let ax=0,ay=0,weight=0;
    entry.from.forEach((count,id)=>{const node=position.get(id);if(!node)return;
      ax+=(node.x-centre.x)*count;ay+=(node.y-centre.y)*count;weight+=count});
    let dx=weight?ax/weight:0,dy=weight?ay/weight:0,length=Math.hypot(dx,dy);
    // A neighbor hooked at the exact center — or to pages that cancel each
    // other out in pairs — has no direction of its own: we give it one, stable.
    if(length<1e-4){const angle=Math.PI*2*index/groups.length-Math.PI/2;dx=Math.cos(angle);dy=Math.sin(angle)*.68;length=Math.hypot(dx,dy)||1}
    dx/=length;dy/=length;
    let silhouette=0;
    inner.forEach(node=>{silhouette=Math.max(silhouette,(node.x-centre.x)*dx+(node.y-centre.y)*dy)});
    const base=Math.max(innerRadius*.5,silhouette)+margin;
    return{id:groupId,label:graphLeafDisplay(item.label),type:'community',community:item,collapsed:true,depth:.86,
      x:centre.x+dx*base,y:centre.y+dy*base,base,
      links:[...entry.from].map(([from,count])=>({from,count}))}}).filter(Boolean);
  // Two neighbors hooked at the same place would overlap: we separate them,
  // then set them back outside the cloud, the separation being able to bring
  // them back into it.
  const gap=margin*1.4;
  for(let pass=0;pass<24;pass++){
    let moved=false;
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){
      const a=placed[i],b=placed[j];
      let dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy);
      if(distance>=gap)continue;
      // Two neighbors cited by the same pages fall at the same point: there is
      // then no direction to push in. We fabricate one, derived from the pair
      // so it stays stable from one render to the next.
      if(distance<1e-6){const angle=(i*3+j)*2.399963;dx=Math.cos(angle);dy=Math.sin(angle);distance=1}
      moved=true;const push=(gap-distance)/2/distance;
      a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push}
    placed.forEach(group=>{const dx=group.x-centre.x,dy=group.y-centre.y,distance=Math.hypot(dx,dy)||1e-4;
      if(distance<group.base){group.x=centre.x+dx/distance*group.base;group.y=centre.y+dy/distance*group.base}});
    if(!moved)break}
  return placed}
`;
}
