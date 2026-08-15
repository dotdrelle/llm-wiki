export const RUNTIME_CANVAS_SCRIPT = String.raw`
let runtimeCanvasRenderer=null;
const runtimeCanvasPositions=new Map;
// Current framing, kept outside the renderer. A frame remount (panel ↔
// Execution view switch, return from the list view) recreates the canvas and
// therefore the renderer: without this the view restarted at the default
// framing and lost the reader's chosen zoom.
let runtimeCanvasCamera=null;
function runtimeStatusColor(status){return{running:'#4f7eff',done:'#22c55e',completed:'#22c55e',failed:'#f06b6b',pending_approval:'#f59e0b',blocked:'#f59e0b',cancelled:'#64748b'}[status]||'#718096'}
function runtimeCanvasScene(){
  const projection=runtimeWorkflowGraphData(),nodes=projection.nodes.map((node,index)=>{const lane=node.type==='run'?0:node.type==='task_group'?1:node.type==='task_detail'?2:3,peers=projection.nodes.filter(item=>(item.type==='run'?0:item.type==='task_group'?1:item.type==='task_detail'?2:3)===lane),slot=peers.findIndex(item=>item.id===node.id),saved=runtimeCanvasPositions.get(node.id),x=saved?.x??(lane===0?0:(slot-(peers.length-1)/2)*Math.min(.22,.72/Math.max(1,peers.length-1))),y=saved?.y??(-.3+lane*.2);return{...node,x,y,depth:1+(index%4)*.025}});return{nodes,edges:projection.relations}}
function createRuntimeCanvasRenderer(host){
  // No mini-map anymore. On an execution graph that fits its frame it oriented
  // no one, ate a corner of the scene and duplicated the role of the "Fit"
  // button — the same reasons it was removed from the wiki graph.
  const canvas=host,context=canvas.getContext('2d'),a11y=canvas.parentElement.querySelector('.runtime-graph-a11y'),state={width:0,height:0,ratio:1,scene:{nodes:[],edges:[]},hits:[],pointer:null,dragged:false,hover:null,topology:'',animated:false,userAdjusted:!!runtimeCanvasCamera,fitted:false};let scheduler,camera;
  const rgba=(hex,alpha)=>{const value=parseInt(hex.slice(1),16);return'rgba('+((value>>16)&255)+','+((value>>8)&255)+','+(value&255)+','+alpha+')'};
  /*
   Pre-rendered halos, like on the wiki graph.

   shadowBlur is a full-frame gaussian blur per fill call. It was applied to
   every node on every frame, and on a "running" node the loop runs
   continuously: the cost was therefore permanent, not occasional. A halo
   depends only on a color, so it is rendered once.
  */
  const sprites=new Map();
  function glowSprite(hex,inner,mid){
    const key=hex+'|'+inner+'|'+mid,cached=sprites.get(key);if(cached)return cached;
    const size=64,off=document.createElement('canvas');off.width=size;off.height=size;
    const paint=off.getContext('2d'),gradient=paint.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,rgba(hex,inner));gradient.addColorStop(.45,rgba(hex,mid));gradient.addColorStop(1,rgba(hex,0));
    paint.fillStyle=gradient;paint.fillRect(0,0,size,size);sprites.set(key,off);return off}
  function paintGlow(hex,inner,mid,x,y,radius){if(radius>0)context.drawImage(glowSprite(hex,inner,mid),x-radius,y-radius,radius*2,radius*2)}
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
   Bounding-box framing.

   The two constants .72 and .62 assumed a square scene and ignored the node
   sizes: a card is 164 px wide whatever the zoom, so its overflow cannot be
   derived from a fraction of the model. On a wide, low frame the result was
   consistently too small or truncated.
  */
  function fit(){
    if(!state.scene.nodes.length)return;
    const size=Math.min(state.width,state.height)||1,inner=Math.max(220,state.width-28),tall=Math.max(180,state.height-28);
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,padX=0,padY=0;
    state.scene.nodes.forEach(node=>{const box=nodeBox(node);
      x0=Math.min(x0,node.x);x1=Math.max(x1,node.x);y0=Math.min(y0,node.y);y1=Math.max(y1,node.y);
      padX=Math.max(padX,box.w/2+14);padY=Math.max(padY,box.h/2+14)});
    const spanX=Math.max(.001,x1-x0)*size,spanY=Math.max(.001,y1-y0)*size;
    const scale=Math.min((inner-padX*2)/Math.max(1,spanX),(tall-padY*2)/Math.max(1,spanY));
    camera.moveTo({x:(x0+x1)/2,y:(y0+y1)/2,scale:Math.max(.4,Math.min(2.6,scale*.98))},280)}
  // The backdrop depends only on the format and the theme: no need to rebuild
  // the gradient on every frame.
  let backdrop=null,backdropKey='';
  function drawBackground(){
    const isLight=document.documentElement.classList.contains('theme-light'),key=state.width+'x'+state.height+(isLight?'l':'d');
    if(key!==backdropKey){
      backdrop=context.createRadialGradient(state.width*.5,state.height*.45,0,state.width*.5,state.height*.45,Math.max(state.width,state.height)*.7);
      backdrop.addColorStop(0,isLight?'#ffffff':'#101928');backdrop.addColorStop(1,isLight?'#e8eef5':'#07090e');
      backdropKey=key}
    context.fillStyle=backdrop;context.fillRect(0,0,state.width,state.height)}
  function draw(now){
    camera.tick(now);runtimeCanvasCamera=state.userAdjusted?{...camera.state}:runtimeCanvasCamera;
    state.hits=[];context.clearRect(0,0,state.width,state.height);drawBackground();
    const byId=new Map(state.scene.nodes.map(node=>[node.id,node]));
    state.scene.edges.forEach(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to);if(!from||!to)return;
      const a=project(from),b=project(to),active=from.status==='running'||to.status==='running';
      context.strokeStyle=active?'rgba(79,126,255,.9)':'rgba(125,148,180,.3)';context.lineWidth=active?2.4:1.1;
      context.setLineDash(edge.type==='depends_on'?[4,5]:[]);
      context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();context.setLineDash([])});
    let running=false;
    state.scene.nodes.forEach(node=>{
      const point=project(node),color=runtimeStatusColor(node.status);
      const selectedNode=node.type==='task_detail'?node.taskId===selectedRuntimeWorkflowTaskId:node.id===selectedWorkflowNodeId;
      const box=nodeBox(node),card=box.card,w=box.w,h=card?box.h:0;
      const live=node.status==='running'&&!scheduler.reducedMotion;
      if(live)running=true;
      // An active node's pulse goes through the halo intensity rather than a
      // blur radius: the image is the same, the cost is not.
      const pulse=live?.34+Math.sin(now/180)*.1:selectedNode?.38:.2;
      paintGlow(color,pulse,pulse*.35,point.x,point.y,(card?Math.max(w,box.h):box.w)*.85);
      context.fillStyle=rgba(color,card?.72:.88);context.strokeStyle=selectedNode?'#fff':rgba(color,1);context.lineWidth=selectedNode?3:1.2;
      context.beginPath();
      if(card)context.roundRect(point.x-w/2,point.y-h/2,w,h,10);
      else context.arc(point.x,point.y,node.type==='run'?28:14,0,Math.PI*2);
      context.fill();context.stroke();
      context.textAlign='center';context.fillStyle='#f7faff';context.font='700 10px ui-sans-serif,system-ui';
      context.fillText(shortText(node.label,card?24:18),point.x,point.y+(card?-7:node.type==='run'?44:28));
      if(card){context.font='9px ui-sans-serif,system-ui';context.fillStyle='rgba(255,255,255,.82)';
        context.fillText(node.type==='task_group'?(node.done||0)+'/'+(node.total||0)+' tasks · ×'+(node.parallelism||1):(node.status||'pending'),point.x,point.y+11)}
      state.hits.push({node,x:point.x,y:point.y,w:card?w:36,h:card?h:36})});
    // The re-trigger is decided once, after the loop: putting it in the body
    // tied it to the node draw order.
    if(running)scheduler.animate(220)}
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
  return{canvas,setScene(scene){const topology=scene.nodes.map(node=>node.id).join('|')+'#'+scene.edges.map(edge=>edge.from+'>'+edge.to+':'+edge.type).join('|'),changed=topology!==state.topology;state.scene=scene;state.topology=topology;
    const a11yHTML=scene.nodes.map(node=>'<button type="button" role="treeitem" data-runtime-node="'+esc(node.id)+'">'+esc(node.label)+' · '+esc(node.status||'pending')+'</button>').join('');
    if(a11y.innerHTML!==a11yHTML)a11y.innerHTML=a11yHTML;
    if(changed&&!state.userAdjusted&&!state.fitted&&state.width>=8&&state.height>=8){state.fitted=true;fit()}
    scheduler.invalidate()},fit(){state.fitted=true;fit()},releaseCamera(){state.userAdjusted=false;state.fitted=false},zoom(factor){claimCamera();camera.zoomAt(factor,camera.state.x,camera.state.y)},destroy(){observer.disconnect();window.removeEventListener('pointerup',releaseOutside);window.removeEventListener('blur',releaseOutside);scheduler.destroy()}}
}
function renderRuntimeWorkflowCanvas(){
  if(activityView!=='graph')return;const canvas=$('runtime-graph-canvas'),inspector=$('runtime-graph-inspector');if(!canvas){if(inspector)inspector.innerHTML='<div class="runtime-graph-empty">Graph Agentic unavailable.</div>';return}
  if(!runtimeCanvasRenderer||runtimeCanvasRenderer.canvas!==canvas){runtimeCanvasRenderer?.destroy();runtimeCanvasRenderer=createRuntimeCanvasRenderer(canvas)}
  runtimeCanvasRenderer.setScene(runtimeCanvasScene());renderRuntimeWorkflowInspector()
}
`;
