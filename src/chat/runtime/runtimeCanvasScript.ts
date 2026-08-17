export const RUNTIME_CANVAS_SCRIPT = String.raw`
let runtimeCanvasRenderer=null;
const runtimeCanvasPositions=new Map;
// Current framing, kept outside the renderer. A frame remount (panel ↔
// Execution view switch, return from the list view) recreates the canvas and
// therefore the renderer: without this the view restarted at the default
// framing and lost the reader's chosen zoom.
let runtimeCanvasCamera=null;
function runtimeStatusColor(status){return{running:'#4f7eff',done:'#22c55e',completed:'#22c55e',failed:'#f06b6b',pending_approval:'#f59e0b',blocked:'#f59e0b',cancelled:'#64748b'}[status]||'#718096'}
// "À faire" reads as hollow/dashed, distinct from done (filled) and running
// (pulsing). pending/queued/waiting are the states that mean "not started yet".
function runtimeIsPending(status){return status==='pending'||status==='queued'||status==='waiting'}
// Stable z-order per node type: run hub at the back, phases above it, details
// on top. Lower value draws first.
function runtimeNodeDepth(node){return node.type==='run'?.9:node.type==='task_group'?1:node.type==='task_detail'?1.2:1.1}
/*
 Layered DAG layout, left → right.

 The previous scene put every phase of the same band side by side on a single
 line, so an ingest with a dozen phases squashed into an unreadable row. Phases
 now sit in COLUMNS of topological depth over depends_on (no dependency = depth
 0 = leftmost), stacked vertically within a column and wrapped into sub-columns
 past a row budget. The run hub anchors the left; expanded task details land in
 a dedicated rightmost column. A manually dragged node keeps its saved position.
*/
function runtimeCanvasScene(){
  const projection=runtimeWorkflowGraphData(),nodes=projection.nodes,relations=projection.relations;
  const isRun=node=>node.type==='run',isPhase=node=>node.type==='task_group',isDetail=node=>node.type==='task_detail';
  // phase -> its prerequisites, over depends_on only.
  const deps=new Map();
  relations.forEach(rel=>{if(rel.type==='depends_on'){if(!deps.has(rel.from))deps.set(rel.from,new Set());deps.get(rel.from).add(rel.to)}});
  const phaseIds=nodes.filter(isPhase).map(node=>node.id);
  const depthOf=new Map();
  const computeDepth=id=>{
    if(depthOf.has(id))return depthOf.get(id);
    depthOf.set(id,0); // cycle guard: the DAG is acyclic, but never loop on a bug
    let d=0;
    (deps.get(id)||[]).forEach(depId=>{d=Math.max(d,computeDepth(depId)+1)});
    depthOf.set(id,d);
    return d;
  };
  phaseIds.forEach(computeDepth);
  // Phases grouped by depth, then chunked into sub-columns so a wide parallel
  // wave wraps instead of stacking into an unreadable tower.
  const MAX_ROWS=9,COL_X=.46,ROW_Y=.26;
  const phasesByDepth=new Map();
  nodes.filter(isPhase).forEach(node=>{const d=depthOf.get(node.id)||0;if(!phasesByDepth.has(d))phasesByDepth.set(d,[]);phasesByDepth.get(d).push(node)});
  [...phasesByDepth.values()].forEach(list=>list.sort((a,b)=>String(a.label).localeCompare(String(b.label))));
  const colOf=new Map();
  nodes.filter(isRun).forEach(node=>colOf.set(node.id,0));
  let column=1;
  [...phasesByDepth.keys()].sort((a,b)=>a-b).forEach(d=>{
    const list=phasesByDepth.get(d);
    for(let i=0;i<list.length;i+=MAX_ROWS){list.slice(i,i+MAX_ROWS).forEach(node=>colOf.set(node.id,column));column++;}
  });
  // Expanded task details: one dedicated column on the far right. Their
  // contains/depends_on edges carry the membership back to the phase.
  nodes.filter(isDetail).forEach(node=>colOf.set(node.id,column));
  const maxCol=Math.max(0,...[...colOf.values()]);
  const byCol=new Map();
  nodes.forEach(node=>{const c=colOf.get(node.id)??(maxCol+1);if(!byCol.has(c))byCol.set(c,[]);byCol.get(c).push(node)});
  const placed=nodes.map(node=>{
    const saved=runtimeCanvasPositions.get(node.id);
    if(saved)return{...node,x:saved.x,y:saved.y,depth:runtimeNodeDepth(node)};
    const c=colOf.get(node.id)??(maxCol+1);
    const members=byCol.get(c)||[];
    const idx=members.indexOf(node);
    const y=(idx-(members.length-1)/2)*ROW_Y;
    return{...node,x:c*COL_X,y,depth:runtimeNodeDepth(node)};
  });
  return{nodes:placed,edges:relations};
}
function createRuntimeCanvasRenderer(host){
  // No mini-map anymore. On an execution graph that fits its frame it oriented
  // no one, ate a corner of the scene and duplicated the role of the "Fit"
  // button — the same reasons it was removed from the wiki graph.
  const canvas=host,context=canvas.getContext('2d'),a11y=canvas.parentElement.querySelector('.runtime-graph-a11y'),state={width:0,height:0,ratio:1,scene:{nodes:[],edges:[]},hits:[],pointer:null,dragged:false,hover:null,topology:'',animated:false,userAdjusted:!!runtimeCanvasCamera,fitted:false,transitions:new Map()};let scheduler,camera;
  // Pre-rendered halos, shared with the wiki graph (graphCanvasGlowScript.ts).
  // The pulse sweeps only 0.24→0.44, so the coarse default (20) would give five
  // visible jerks on a large card: a finer grain keeps the beat smooth and the
  // cache still bounded (~20 sprites, not one per frame).
  const {glow:paintGlow,rgba}=createGraphGlow(context,100);
  /*
   The first framing waits for a real size.

   resize() is called at construction, before layout has given the frame its
   height: the scene then measured 0 × 0 and fit() computed an absurd scale,
   clamped to .4. The graph rendered tiny and stayed that way until the next
   manual "Fit". So we remember the first framing and replay it as soon as the
   ResizeObserver announces a usable surface.
  */
  function resize(){const rect=canvas.getBoundingClientRect(),ratio=Math.min(2,devicePixelRatio||1),wasEmpty=state.width<8||state.height<8;state.width=rect.width;state.height=rect.height;state.ratio=ratio;canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));context.setTransform(ratio,0,0,ratio,0,0);
    if(wasEmpty&&rect.width>=8&&rect.height>=8&&!state.userAdjusted)state.fitted=false;
    if(!state.fitted&&state.scene.nodes.length&&rect.width>=8&&rect.height>=8&&!state.userAdjusted){state.fitted=true;fit()}
    scheduler.invalidate()}
  function project(node){const size=Math.min(state.width,state.height)*camera.state.scale;return{x:state.width/2+(node.x-camera.state.x)*size,y:state.height/2+(node.y-camera.state.y)*size}}
  // A node's footprint in pixels, label included. A card and a bubble have
  // neither the same shape nor the same overflow under the text.
  function nodeBox(node){
    if(node.type==='task_group')return{w:164,h:68,card:true};
    if(node.type==='task_detail')return{w:132,h:52,card:true};
    const r=node.type==='run'?28:14;return{w:r*2,h:r*2+(node.type==='run'?36:22),card:false}}
  /*
   Fixed-point framing, ported from the wiki graph.

   The scale depends on the extent, which depends on the scale: an implicit
   equation, not a division. We iterate to the fixed point, measuring the real
   envelope (node boxes included) at the current scale on each pass. The center
   is that of the ENVELOPE, so a tall card no longer pushes the graph high in
   the frame.
  */
  function computeBounds(nodes){
    if(!nodes.length)return{x:0,y:0,scale:1};
    const size=Math.min(state.width,state.height)||1,inner=Math.max(240,state.width-32),tall=Math.max(180,state.height-32);
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    nodes.forEach(node=>{x0=Math.min(x0,node.x);x1=Math.max(x1,node.x);y0=Math.min(y0,node.y);y1=Math.max(y1,node.y)});
    const cx=(x0+x1)/2,cy=(y0+y1)/2;
    const envelope=scale=>{
      // t is the TOP edge, narrowed by Math.min: seeded at -Infinity it never
      // moved, the envelope height came out infinite, and every node projected
      // to y = +Infinity — the graph drew itself outside its own frame.
      let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity;
      nodes.forEach(node=>{
        const box=nodeBox(node);
        const px=(node.x-cx)*size*scale,py=(node.y-cy)*size*scale;
        const w=box.w/2+16,h=box.h/2+16;
        l=Math.min(l,px-w);r=Math.max(r,px+w);t=Math.min(t,py-h);b=Math.max(b,py+h)});
      return{l,r,t,b}};
    /*
     Fitting must never magnify past the layout's own spacing.

     The ceiling was 2.6, so a two-node run was stretched until its envelope
     filled the frame: the hub pinned to the far left, its single phase two
     thirds away, and a screen of emptiness between them. Cards keep a fixed
     pixel size, so zooming in spreads them without ever making them bigger —
     past scale 1 it buys nothing and costs the whole reading.

     At 1 the layout's own units apply (0.46 of the short side between columns,
     0.26 between rows): a small run sits centred at a natural distance, a large
     one still scales down to fit. The floor stays, it is the only direction
     where magnification actually helps.
    */
    let scale=1;
    for(let pass=0;pass<8;pass++){
      const e=envelope(scale);
      const next=Math.max(.4,Math.min(1,scale*Math.min(inner/Math.max(1,e.r-e.l),tall/Math.max(1,e.b-e.t))));
      if(Math.abs(next-scale)<=scale*.002){scale=next;break}
      scale=next}
    const e=envelope(scale);
    return{x:cx+(e.l+e.r)/2/(size*scale),y:cy+(e.t+e.b)/2/(size*scale),scale:scale*.99}}
  function fit(){if(!state.scene.nodes.length)return;camera.moveTo(computeBounds(state.scene.nodes),280)}
  // The backdrop depends only on the format and the theme, like the wiki
  // graph's three-stop radial: no need to rebuild the gradient on every frame.
  let backdrop=null,backdropKey='';
  function drawBackground(){
    const isLight=document.documentElement.classList.contains('theme-light'),key=state.width+'x'+state.height+(isLight?'l':'d');
    if(key!==backdropKey){
      backdrop=context.createRadialGradient(state.width*.5,state.height*.42,0,state.width*.5,state.height*.45,Math.max(state.width,state.height)*.75);
      backdrop.addColorStop(0,isLight?'#ffffff':'#101827');backdrop.addColorStop(.55,isLight?'#f4f7fb':'#0a0e18');backdrop.addColorStop(1,isLight?'#e7edf4':'#06080d');
      backdropKey=key}
    context.fillStyle=backdrop;context.fillRect(0,0,state.width,state.height)}
  /*
   Orthogonal routing, not the wiki graph's arc.

   The curve was ported from the wiki map, where nodes float and an arc reads as
   an organic relation. This graph is the opposite: a layered DAG, left to right,
   whose whole point is "this comes after that". An engineering schematic states
   that with right angles — out horizontally, one vertical run, in horizontally —
   and the eye follows a corner far better than it follows a bend.

   Three points rather than a spline: the vertical happens at mid-x, so parallel
   phases of one column share the same vertical corridor instead of crossing in
   a fan of arcs. Returns the polyline, so both the stroke and the flow particle
   read the same geometry.
  */
  function edgePath(a,b){
    const midX=(a.x+b.x)/2;
    // Same row: a straight segment. An elbow on a horizontal link would draw
    // two useless corners.
    if(Math.abs(b.y-a.y)<1)return[{x:a.x,y:a.y},{x:b.x,y:b.y}];
    return[{x:a.x,y:a.y},{x:midX,y:a.y},{x:midX,y:b.y},{x:b.x,y:b.y}];
  }
  /** Point at "t" along a polyline, by arc length. Feeds the flow particle. */
  function pointAlong(points,t){
    const spans=[];let total=0;
    for(let i=1;i<points.length;i++){
      const d=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
      spans.push(d);total+=d}
    if(total<=0)return points[0];
    let travelled=t*total;
    for(let i=0;i<spans.length;i++){
      if(travelled<=spans[i]||i===spans.length-1){
        const u=spans[i]>0?Math.min(1,travelled/spans[i]):0;
        return{x:points[i].x+(points[i+1].x-points[i].x)*u,y:points[i].y+(points[i+1].y-points[i].y)*u}}
      travelled-=spans[i]}
    return points[points.length-1];
  }
  // Deterministic per-edge phase so the flow particle keeps a stable position
  // from frame to frame instead of restarting on every redraw.
  // String(): an edge without an id threw here, IN the draw loop — and an
  // exception mid-frame is the black-canvas failure, not a missing particle.
  function edgeSeed(id){const key=String(id??'');let h=0;for(let i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))>>>0;return h%1000}
  function drawEdge(edge,a,b,now){
    const active=edge.active||a.status==='running'||b.status==='running';
    const seq=edge.type==='depends_on';
    context.strokeStyle=active?'rgba(79,126,255,.85)':(seq?'rgba(125,148,180,.4)':'rgba(125,148,180,.26)');
    context.lineWidth=active?2.2:1.1;
    context.setLineDash(seq?[4,5]:[]);
    const route=edgePath(a,b);
    // Rounded corners: a 6px join keeps the right angle legible without the
    // aliased pixel notch a bare lineTo leaves at this line width.
    context.lineJoin='round';
    context.beginPath();context.moveTo(route[0].x,route[0].y);
    for(let i=1;i<route.length;i++)context.lineTo(route[i].x,route[i].y);
    context.stroke();context.setLineDash([]);
    // A particle glides toward the dependent phase while the dependency is live:
    // it says "work is flowing this way" without an arrowhead. It follows the
    // polyline by arc length, so it does not race through the corners.
    if(active&&seq){
      const t=((now+edgeSeed(edge.id))%1800)/1800;
      const point=pointAlong(route,t);
      context.fillStyle='rgba(220,232,255,.9)';
      context.beginPath();context.arc(point.x,point.y,1.8,0,Math.PI*2);context.fill()}}
  // Appearance / status-change signal, like the wiki graph's "fresh" ring. A
  // brand-new node shows a green ring; an existing node whose status just
  // flipped (pending → running → done) shows a brief amber ring. Both fade on
  // their own and keep the scene animated only while one is visible.
  function trackTransition(node,now){
    let prior=state.transitions.get(node.id);
    if(!prior){prior={born:now,statusAt:now,status:node.status};state.transitions.set(node.id,prior)}
    else if(prior.status!==node.status){prior.status=node.status;prior.statusAt=now}
    const bornAge=now-prior.born,changedAge=now-prior.statusAt;
    const fresh=bornAge<1200?1-bornAge/1200:0;
    const flash=changedAge<520?1-changedAge/520:0;
    return{fresh,flash}}
  function drawNode(node,now){
    const point=project(node),color=runtimeStatusColor(node.status);
    const selectedNode=node.type==='task_detail'?node.taskId===selectedRuntimeWorkflowTaskId:node.id===selectedWorkflowNodeId;
    const box=nodeBox(node),card=box.card,w=box.w,h=card?box.h:0;
    const live=node.status==='running'&&!scheduler.reducedMotion;
    const transition=scheduler.reducedMotion?{fresh:0,flash:0}:trackTransition(node,now);
    const pulse=live?.34+Math.sin(now/180)*.1:selectedNode?.38:.2;
    paintGlow(color,pulse,pulse*.35,point.x,point.y,(card?Math.max(w,h):box.w)*.85);
    const pending=runtimeIsPending(node.status);
    if(card){
      // Wiki-style card: dark body, colored accent bar, title + status meta.
      context.fillStyle=pending?'rgba(16,23,34,.5)':'rgba(16,23,34,.96)';
      context.beginPath();graphRoundedRect(context,point.x-w/2,point.y-h/2,w,h,9);context.fill();
      context.strokeStyle=selectedNode?'#fff':rgba(color,selectedNode?1:.6);context.lineWidth=selectedNode?2.5:1.1;
      context.setLineDash(pending?[4,4]:[]);
      context.stroke();context.setLineDash([]);
      context.fillStyle=color;context.fillRect(point.x-w/2+3,point.y-h/2+7,3,h-14);
      context.textAlign='left';context.font='700 10px ui-sans-serif,system-ui';context.fillStyle='#f2f6fd';
      let label=String(node.label||'');const maxW=w-32;
      while(context.measureText(label).width>maxW&&label.length>5)label=label.slice(0,-2);
      context.fillText(label+(label!==String(node.label||'')?'…':''),point.x-w/2+13,point.y-6);
      context.font='9px ui-sans-serif,system-ui';context.fillStyle=rgba(color,.9);
      context.fillText(node.type==='task_group'?((node.done||0)+'/'+(node.total||0)+' tasks · ×'+(node.parallelism||1)):String(node.status||'pending'),point.x-w/2+13,point.y+12);
    } else {
      const r=node.type==='run'?28:14;
      context.fillStyle=pending?rgba(color,.28):rgba(color,.9);
      context.strokeStyle=selectedNode?'#fff':rgba(color,1);context.lineWidth=selectedNode?2.5:1.2;
      context.setLineDash(pending?[4,4]:[]);
      context.beginPath();context.arc(point.x,point.y,r,0,Math.PI*2);context.fill();context.stroke();context.setLineDash([]);
      context.textAlign='center';context.fillStyle='#f7faff';context.font='700 10px ui-sans-serif,system-ui';
      context.fillText(shortText(node.label,18),point.x,point.y+(node.type==='run'?44:26));
    }
    if(transition.fresh>0||transition.flash>0){
      const ringColor=transition.fresh>0?'#74c365':'#f59e0b';
      const alpha=transition.fresh>0?transition.fresh:transition.flash;
      const radius=(card?Math.max(w,h):box.w)/2+8+(1-alpha)*10;
      context.strokeStyle=rgba(ringColor,alpha);context.lineWidth=2;
      context.beginPath();context.arc(point.x,point.y,radius,0,Math.PI*2);context.stroke()}
    state.hits.push({node,x:point.x,y:point.y,w:card?w:36,h:card?h:36});
    return live||transition.fresh>0||transition.flash>0}
  function draw(now){
    camera.tick(now);runtimeCanvasCamera=state.userAdjusted?{...camera.state}:runtimeCanvasCamera;
    state.hits=[];context.clearRect(0,0,state.width,state.height);drawBackground();
    const byId=new Map(state.scene.nodes.map(node=>[node.id,node]));
    state.scene.edges.forEach(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to);if(!from||!to)return;
      // depends_on is stored as dependent→prerequisite; draw it prerequisite→
      // dependent so the flow particle moves with the pipeline (left → right).
      if(edge.type==='depends_on')drawEdge(edge,project(to),project(from),now);
      else drawEdge(edge,project(from),project(to),now)});
    let active=false;
    state.scene.nodes.slice().sort((a,b)=>(a.depth||1)-(b.depth||1)).forEach(node=>{if(drawNode(node,now))active=true});
    // The re-trigger is decided once, after the loop: putting it in the body
    // tied it to the node draw order.
    if(active)scheduler.animate(220)}
  scheduler=createGraphFrameScheduler(draw);camera=createGraphCamera(scheduler);
  if(runtimeCanvasCamera)camera.jump({...runtimeCanvasCamera});
  // Any framing gesture hands the view to its reader: no automatic reframing
  // will impose itself afterwards, until "Reset".
  const claimCamera=()=>{state.userAdjusted=true;state.fitted=true};
  resize();
  function coords(event){const rect=canvas.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top}}
  function hit(point){return[...state.hits].reverse().find(item=>Math.abs(point.x-item.x)<=item.w/2&&Math.abs(point.y-item.y)<=item.h/2)}
  /*
   End of gesture, in a single place — same fix as on the wiki graph.

   pointerup reset state.pointer to null without ever releasing the capture,
   and pointercancel was listened to nowhere: the graph stayed hooked to the
   cursor after release, and the canvas kept intercepting events intended for
   neighboring panels.
  */
  function endPointerGesture(point){
    if(!state.pointer)return;
    if(!state.dragged&&point){const target=hit(point);
      if(target){if(target.node.type==='task_detail')selectRuntimeWorkflowTask(target.node.taskId);else selectRuntimeWorkflowNode(target.node.id)}}
    const captured=state.pointer.pointerId;
    state.pointer=null;state.dragged=false;
    if(captured!==undefined&&canvas.hasPointerCapture?.(captured))canvas.releasePointerCapture(captured);
    scheduler.invalidate()}
  canvas.addEventListener('pointerdown',event=>{const point=coords(event);state.pointer={...point,lastX:point.x,lastY:point.y,target:hit(point),pointerId:event.pointerId};state.dragged=false;canvas.setPointerCapture(event.pointerId)});
  canvas.addEventListener('pointermove',event=>{const point=coords(event);
    if(!state.pointer){const target=hit(point),next=target?.node.id||null;if(next!==state.hover){state.hover=next;scheduler.invalidate()}return}
    // The drag is valid only while the button is held down: we don't depend on
    // correctly receiving a release event.
    if(event.buttons===0){endPointerGesture(null);return}
    const dx=point.x-state.pointer.lastX,dy=point.y-state.pointer.lastY;
    if(Math.abs(point.x-state.pointer.x)+Math.abs(point.y-state.pointer.y)>4)state.dragged=true;
    const size=Math.min(state.width,state.height)*camera.state.scale;
    claimCamera();
    if(state.pointer.target){state.pointer.target.node.x+=dx/size;state.pointer.target.node.y+=dy/size;runtimeCanvasPositions.set(state.pointer.target.node.id,{x:state.pointer.target.node.x,y:state.pointer.target.node.y})}
    else camera.pan(-dx/size,-dy/size);
    state.pointer.lastX=point.x;state.pointer.lastY=point.y;scheduler.invalidate()});
  canvas.addEventListener('pointerup',event=>endPointerGesture(coords(event)));
  canvas.addEventListener('pointercancel',()=>endPointerGesture(null));
  const releaseOutside=()=>{if(state.pointer)endPointerGesture(null)};
  window.addEventListener('pointerup',releaseOutside);
  window.addEventListener('blur',releaseOutside);
  canvas.addEventListener('wheel',event=>{event.preventDefault();claimCamera();const point=coords(event),size=Math.min(state.width,state.height),worldX=camera.state.x+(point.x-state.width/2)/(size*camera.state.scale),worldY=camera.state.y+(point.y-state.height/2)/(size*camera.state.scale);camera.zoomAt(event.deltaY<0?1.14:1/1.14,worldX,worldY)},{passive:false});
  canvas.addEventListener('keydown',event=>{const step=.06/camera.state.scale;if(event.key!=='Home')claimCamera();if(event.key==='ArrowLeft')camera.pan(-step,0);else if(event.key==='ArrowRight')camera.pan(step,0);else if(event.key==='ArrowUp')camera.pan(0,-step);else if(event.key==='ArrowDown')camera.pan(0,step);else if(event.key==='+'||event.key==='=')camera.zoomAt(1.2,camera.state.x,camera.state.y);else if(event.key==='-')camera.zoomAt(1/1.2,camera.state.x,camera.state.y);else if(event.key==='Home')fit();else return;event.preventDefault()});
  a11y.addEventListener('click',event=>{const button=event.target.closest('[data-runtime-node]'),node=state.scene.nodes.find(item=>item.id===button?.dataset.runtimeNode);if(node){if(node.type==='task_detail')selectRuntimeWorkflowTask(node.taskId);else selectRuntimeWorkflowNode(node.id)}});
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  /*
   A changing topology no longer forces the view to reframe.

   During an ingest, tasks appear and finish continuously: the topology kept
   changing and every change relaunched a 280 ms animated fit(). The view jumped
   every few seconds and cancelled the manual placement of the bubbles.
   Automatic framing only makes sense on the first fill — after that, the view
   belongs to its reader.
  */
  return{canvas,setScene(scene){const topology=scene.nodes.map(node=>node.id).join('|')+'#'+scene.edges.map(edge=>edge.from+'>'+edge.to+':'+edge.type).join('|'),changed=topology!==state.topology;
    /*
     Opening a level is a USER action and reframes; a run progressing does not.

     Expanding a task appends its details in a dedicated rightmost column, well
     outside the current framing — and state.fitted, set once and never cleared,
     forbade the only fit that would have shown them. The details were drawn
     correctly, kilometres off screen.

     The discriminator is the number of DETAIL nodes, not of nodes: details exist
     only because a reader asked for them, whereas phases appear and finish on
     their own throughout an ingest. Reframing on any growth would bring back the
     view that jumped every few seconds and cancelled a manual placement.
    */
    const details=nodes=>nodes.filter(node=>node.type==='task_detail').length;
    const opened=details(scene.nodes)!==details(state.scene.nodes);
    state.scene=scene;state.topology=topology;
    const a11yHTML=scene.nodes.map(node=>'<button type="button" role="treeitem" data-runtime-node="'+esc(node.id)+'">'+esc(node.label)+' · '+esc(node.status||'pending')+'</button>').join('');
    if(a11y.innerHTML!==a11yHTML)a11y.innerHTML=a11yHTML;
    if((changed&&!state.fitted||opened)&&!state.userAdjusted&&state.width>=8&&state.height>=8){state.fitted=true;fit()}
    scheduler.invalidate()},fit(){state.fitted=true;fit()},releaseCamera(){state.userAdjusted=false;state.fitted=false},zoom(factor){claimCamera();camera.zoomAt(factor,camera.state.x,camera.state.y)},destroy(){observer.disconnect();window.removeEventListener('pointerup',releaseOutside);window.removeEventListener('blur',releaseOutside);scheduler.destroy()}}
}
function renderRuntimeWorkflowCanvas(){
  if(activityView!=='graph')return;const canvas=$('runtime-graph-canvas'),inspector=$('runtime-graph-inspector');if(!canvas){if(inspector)inspector.innerHTML='<div class="runtime-graph-empty">Graph Agentic unavailable.</div>';return}
  if(!runtimeCanvasRenderer||runtimeCanvasRenderer.canvas!==canvas){runtimeCanvasRenderer?.destroy();runtimeCanvasRenderer=createRuntimeCanvasRenderer(canvas)}
  runtimeCanvasRenderer.setScene(runtimeCanvasScene());renderRuntimeWorkflowInspector()
}
`;
