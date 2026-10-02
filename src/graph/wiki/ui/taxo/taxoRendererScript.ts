/**
 * TAXO graph — Canvas renderer.
 *
 * The drawing of the TAXO prototype (family halos, concept stars, source
 * squares/cards, curved cross-family links with their travelling particle,
 * collision-aware labels), on the shared Canvas primitives: the camera and
 * the idle-aware frame scheduler of `graph/core/canvas/` and its pre-rendered
 * glow. No D3 in the browser — the force views arrive already laid out
 * (`taxoLayout.ts`); only the Focus rings are computed here. A dragged node
 * keeps its place per view until "Recenter" resets the camera.
 */
export function taxoRendererScript(): string {
  return String.raw`
const stage=document.querySelector('#stage'),cv=document.querySelector('#cv'),ctx=cv.getContext('2d');
let W=0,H=0,ratio=1,nodes=[],links=[],rings=null,hits=[],labelsQ=[],clock=0,pale=false;
const manual={};
const EX=1.45;
const R=n=>n.type==='family'?16+Math.sqrt(n.count)*4:n.type==='concept'?3.5+Math.sqrt(n.nsrc)*1.6:4.5;
const scheduler=createGraphFrameScheduler(draw);
const camera=createGraphCamera(scheduler,{x:0,y:0,scale:1});
const {glow,rgba}=createGraphGlow(ctx);
const K=()=>camera.state.scale;
const P=n=>({x:W/2+(n.x-camera.state.x)*K(),y:H/2+(n.y-camera.state.y)*K()});
const toWorld=(sx,sy)=>({x:camera.state.x+(sx-W/2)/K(),y:camera.state.y+(sy-H/2)/K()});
function readTheme(){pale=document.documentElement.classList.contains('theme-light')}
readTheme();
new MutationObserver(()=>{readTheme();backKey='';scheduler.invalidate()}).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
function resize(){const r=stage.getBoundingClientRect(),was=W;W=r.width;H=r.height;ratio=Math.min(2,window.devicePixelRatio||1);cv.width=Math.max(1,Math.round(W*ratio));cv.height=Math.max(1,Math.round(H*ratio));backKey='';if(!was&&W)fit(false);scheduler.invalidate()}
new ResizeObserver(resize).observe(stage);

function focusData(){
  const c=byId.get(focusId);if(!c)return{nodes:[],links:[],rings:null};
  const srcs=[...bip.get(focusId)].map(id=>byId.get(id)).sort((a,b)=>a.title.localeCompare(b.title));
  const others=new Map();
  srcs.forEach((s,i)=>bip.get(s.id).forEach(cid=>{if(cid!==focusId){if(!others.has(cid))others.set(cid,[]);others.get(cid).push(i)}}));
  const n=Math.max(srcs.length,1),R1=n<2?150:Math.max(175,165/(2*Math.sin(Math.PI/n))),R2=R1+170,ang=i=>i/n*2*Math.PI-Math.PI/2+(n%2?0:Math.PI/n);
  const out=[{...c,x:0,y:0,ring:0}];
  srcs.forEach((s,i)=>out.push({...s,x:Math.cos(ang(i))*R1*EX,y:Math.sin(ang(i))*R1,ring:1}));
  const outer=[...others].map(([id,idx])=>({id,a:Math.atan2(idx.reduce((t,i)=>t+Math.sin(ang(i)),0),idx.reduce((t,i)=>t+Math.cos(ang(i)),0))})).sort((p,q)=>p.a-q.a);
  const m=Math.max(outer.length,1),off=outer.length?outer[0].a:0;
  outer.forEach((o,k)=>{const a=off+k/m*2*Math.PI;out.push({...byId.get(o.id),x:Math.cos(a)*R2*EX,y:Math.sin(a)*R2,ring:2})});
  const ids=new Set(out.map(x=>x.id));
  return{nodes:out,links:citeLinks.filter(l=>ids.has(l.source)&&ids.has(l.target)).map(l=>({...l})),rings:[R1,R2]}}
function buildScene(reframe){
  rings=null;
  if(view==='focus'){const F=focusData();nodes=F.nodes;links=F.links;rings=F.rings}
  else{const V=viewGraph(),placed=layout[view]||{};
    nodes=V.nodes.map(n=>{const p=manual[view+'|'+n.id]||placed[n.id]||[0,0];return{...n,x:p[0],y:p[1]}});
    links=V.links.map(l=>({...l}))}
  const map=new Map(nodes.map(n=>[n.id,n]));
  links.forEach(l=>{l.a=map.get(l.source);l.b=map.get(l.target)});
  links=links.filter(l=>l.a&&l.b);
  if(reframe)fit(false);
  scheduler.invalidate()}
function fit(animate){
  const vis=nodes.filter(visible);if(!vis.length||!W)return;
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  vis.forEach(n=>{const r=R(n)+(n.type==='family'?40:20);x0=Math.min(x0,n.x-r);x1=Math.max(x1,n.x+r);y0=Math.min(y0,n.y-r);y1=Math.max(y1,n.y+r)});
  const padL=20,padR=W>820?300:20,padT=90,padB=50;
  const k=Math.max(.35,Math.min(2.2,Math.min((W-padL-padR)/(x1-x0+80),(H-padT-padB)/(y1-y0+30))));
  const ox=(padL-padR)/2,oy=(padT-padB)/2,target={x:(x0+x1)/2-ox/k,y:(y0+y1)/2-oy/k,scale:k};
  if(animate)camera.moveTo(target,450);else camera.jump(target)}

// ---------- drawing ----------
const noise=(i,salt)=>{let h=(2166136261^salt)>>>0;const t=String(i);for(let k=0;k<t.length;k++){h=(h^t.charCodeAt(k))>>>0;h=Math.imul(h,16777619)>>>0}return h/4294967295};
const dust=Array.from({length:150},(_,i)=>({x:noise(i,7),y:noise(i,31),z:noise(i,53),a:.1+noise(i,97)*.35}));
let back=null,backKey='';
function drawBackground(){
  const key=W+'x'+H+(pale?'l':'d');
  if(key!==backKey){back=ctx.createRadialGradient(W*.5,H*.42,0,W*.5,H*.45,Math.max(W,H)*.75);
    back.addColorStop(0,pale?'#ffffff':'#101827');back.addColorStop(.55,pale?'#f4f7fb':'#0a0e18');back.addColorStop(1,pale?'#e7edf4':'#06080d');backKey=key}
  ctx.fillStyle=back;ctx.fillRect(0,0,W,H);
  if(pale)return;
  dust.forEach(s=>{const x=((s.x*W+clock*6*s.z)%W+W)%W;ctx.fillStyle='rgba(190,205,235,'+s.a*.5+')';ctx.fillRect(x,s.y*H,1.2,1.2)})}
const dim=n=>focusSet&&!focusSet.has(n.id);
const edgeOn=l=>visible(l.a)&&visible(l.b);
const edgeActive=l=>sel&&(l.a.id===sel||l.b.id===sel);
function edgeDim(l){if(!focusSet)return false;if(sel)return!edgeActive(l);return!(focusSet.has(l.a.id)&&focusSet.has(l.b.id))}
function curve(a,b,bend){const cx=(a.x+b.x)/2-(b.y-a.y)*bend,cy=(a.y+b.y)/2+(b.x-a.x)*bend;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(cx,cy,b.x,b.y);return{cx,cy}}
function drawEdge(l){
  const a=P(l.a),b=P(l.b),on=edgeActive(l);
  ctx.globalAlpha=edgeDim(l)?.12:1;
  if(l.kind==='cross'){
    const g=ctx.createLinearGradient(a.x,a.y,b.x,b.y);
    g.addColorStop(0,rgba(colorOf(l.a),pale?.7:.55));g.addColorStop(.5,pale?'rgba(110,128,156,.4)':'rgba(150,165,200,.38)');g.addColorStop(1,rgba(colorOf(l.b),pale?.7:.55));
    ctx.strokeStyle=on?'rgba(77,156,255,.9)':g;ctx.lineWidth=1+Math.min(3,Math.sqrt(l.w)*.75)+(on?.6:0);
    const{cx,cy}=curve(a,b,.13);ctx.stroke();
    const i=FAMS.indexOf(l.a.family),j=FAMS.indexOf(l.b.family);
    const t=scheduler.reducedMotion?.5:(Math.sin(clock*1.6+i*1.3+j)*.5+.5),u=1-t;
    ctx.fillStyle=pale?'rgba(70,92,124,.65)':'rgba(220,232,255,.55)';ctx.beginPath();ctx.arc(u*u*a.x+2*u*t*cx+t*t*b.x,u*u*a.y+2*u*t*cy+t*t*b.y,1.8,0,Math.PI*2);ctx.fill();
    if(K()>.45){ctx.textAlign='center';ctx.font='10px '+FONT;ctx.fillStyle=pale?'rgba(70,92,124,.9)':'rgba(163,178,203,.85)';ctx.fillText(l.w,(a.x+b.x)/2-(b.y-a.y)*.065,(a.y+b.y)/2+(b.x-a.x)*.065)}
  }else if(l.kind==='member'){
    ctx.strokeStyle=rgba(colorOf(l.b),on?.8:pale?.32:.22);ctx.lineWidth=on?1.3:.8;ctx.setLineDash([2,4]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
  }else{
    ctx.strokeStyle=on?'rgba(77,156,255,.9)':(pale?'rgba(92,116,148,.34)':'rgba(126,151,185,.28)');
    ctx.lineWidth=Math.min(4,1+Math.sqrt(l.w||1)*.45)+(l.w>1?.8:0)+(on?.4:0);
    curve(a,b,view==='focus'?.06:.11);ctx.stroke()}
  ctx.globalAlpha=1}
function drawFamily(n){
  const p=P(n),paint=colorOf(n),hot=hover===n.id||sel===n.id;
  let reach=R(n);nodes.forEach(m=>{if(m.type==='concept'&&m.family===n.family&&visible(m))reach=Math.max(reach,Math.hypot(m.x-n.x,m.y-n.y)+18)});
  const r=reach*K();
  ctx.globalAlpha=dim(n)?.15:1;
  glow(paint,hot?.3:.18,pale?.08:.06,p.x,p.y,r*1.5);
  ctx.strokeStyle=rgba(paint,hot?.9:.45);ctx.lineWidth=hot?1.6:.9;ctx.setLineDash([2,5]);
  ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  const core=Math.max(3,4.5*Math.sqrt(K()));glow(paint,.6,.2,p.x,p.y,core*4);
  ctx.fillStyle=pale?paint:'#f4f8ff';ctx.beginPath();ctx.arc(p.x,p.y,core,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;
  labelsQ.push({x:p.x,y:p.y,radius:10,weight:1e6+n.count,always:true,dim:dim(n),lines:[
    {text:n.title,font:'500 13px '+FONT,h:15,color:hot?(pale?'#0d1826':'#f4f7fc'):(pale?'#2a3a4d':'#c9d3e2')},
    {text:n.count+' concepts · '+n.nsrc+' sources',font:'11px '+FONT,h:13,color:rgba(paint,pale?.95:.8)}]});
  hits.push({n,x:p.x,y:p.y,r:18})}
function drawStar(n,i){
  const p=P(n),paint=colorOf(n),hot=hover===n.id,selected=sel===n.id||(view==='focus'&&n.ring===0);
  const tw=scheduler.reducedMotion?1:.8+.2*Math.sin(clock*2.4+i*1.7);
  const core=(R(n)+(n.ring===0?4:0))*Math.min(1.6,Math.max(.75,Math.sqrt(K())));
  ctx.globalAlpha=dim(n)?.13:1;
  glow(paint,(hot||selected?.7:.5)*tw,(hot||selected?.24:.16)*tw,p.x,p.y,core*(selected?5:3.8));
  ctx.fillStyle=pale?paint:'#f4f8ff';ctx.beginPath();ctx.arc(p.x,p.y,core,0,Math.PI*2);ctx.fill();
  if(pale){ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.stroke()}
  if(selected){ctx.strokeStyle=rgba(paint,.95);ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(p.x,p.y,core+5,0,Math.PI*2);ctx.stroke()}
  ctx.globalAlpha=1;
  if(K()>.5||hot||selected||n.ring===0)labelsQ.push({x:p.x,y:p.y,radius:core+3,weight:(n.nsrc||0)+(selected||hot?1e5:0)+(n.ring===0?1e6:0),always:selected||hot||n.ring===0,dim:dim(n),lines:[
    {text:n.title.length>24?n.title.slice(0,23)+'…':n.title,font:(selected||n.ring===0?'600 12px ':'10.5px ')+FONT,h:13,color:selected||hot?(pale?'#0d1826':'#f4f7fc'):(pale?'rgba(44,60,80,.88)':'rgba(220,229,242,.78)')}]});
  hits.push({n,x:p.x,y:p.y,r:Math.max(12,core+6)})}
const cardWidth=n=>Math.min(178,86+String(n.title).length*5.4);
function drawCard(n){
  const p=P(n),paint=SRC_COLOR,selected=sel===n.id,hot=hover===n.id,w=cardWidth(n),h=40;
  ctx.globalAlpha=dim(n)?.15:1;
  glow(paint,selected?.45:.2,selected?.16:.07,p.x,p.y,Math.max(w,h)*(selected?.9:.7));
  ctx.fillStyle=pale?'rgba(255,255,255,.97)':'rgba(16,23,34,.96)';
  ctx.beginPath();graphRoundedRect(ctx,p.x-w/2,p.y-h/2,w,h,9);ctx.fill();
  ctx.strokeStyle=rgba(paint,selected||hot?1:.55);ctx.lineWidth=selected?2:1;ctx.stroke();
  ctx.fillStyle=paint;ctx.fillRect(p.x-w/2+3,p.y-h/2+7,3,h-14);
  ctx.textAlign='left';ctx.font='600 11px '+FONT;ctx.fillStyle=pale?'#172433':'#edf3fb';
  let t=n.title;while(ctx.measureText(t).width>w-24&&t.length>5)t=t.slice(0,-2);ctx.fillText(t+(t!==n.title?'…':''),p.x-w/2+13,p.y-3);
  ctx.font='9.5px '+FONT;ctx.fillStyle=rgba(paint,.95);ctx.fillText(n.nsrc+' concept'+(n.nsrc>1?'s':''),p.x-w/2+13,p.y+11);
  ctx.globalAlpha=1;
  hits.push({n,x:p.x,y:p.y,w,h})}
function drawSquare(n){
  const p=P(n),paint=SRC_COLOR,hot=hover===n.id,selected=sel===n.id,s=5*Math.min(1.5,Math.max(.8,Math.sqrt(K())));
  if(K()>1.7||selected)return drawCard(n);
  ctx.globalAlpha=dim(n)?.13:1;
  glow(paint,hot?.6:.4,.12,p.x,p.y,s*4);
  ctx.fillStyle=pale?'#ffffff':'rgba(16,23,34,.96)';ctx.strokeStyle=rgba(paint,hot?1:.85);ctx.lineWidth=1.3;
  ctx.beginPath();graphRoundedRect(ctx,p.x-s,p.y-s,s*2,s*2,2);ctx.fill();ctx.stroke();
  ctx.globalAlpha=1;
  if(showSrcLabels||hot||(focusSet&&focusSet.has(n.id)&&(sel||query)))labelsQ.push({x:p.x,y:p.y,radius:s+3,weight:hot?1e5:1,always:hot,dim:dim(n),lines:[{text:n.title.length>30?n.title.slice(0,29)+'…':n.title,font:'10px '+FONT,h:12,color:pale?'rgba(60,78,100,.85)':'rgba(170,185,210,.75)'}]});
  hits.push({n,x:p.x,y:p.y,r:Math.max(10,s+4)})}
function placeLabels(){
  const placed=[];labelsQ.sort((a,b)=>b.weight-a.weight);
  labelsQ.forEach(item=>{
    let w=0,h=0;item.lines.forEach(l=>{ctx.font=l.font;w=Math.max(w,ctx.measureText(l.text).width);h+=l.h});
    const cands=[[item.x-w/2,item.y+item.radius+4],[item.x+item.radius+5,item.y-h/2],[item.x-item.radius-5-w,item.y-h/2],[item.x-w/2,item.y-item.radius-4-h]];
    let box=null;
    for(const[x,y]of cands){const b={x,y,w,h};if(!placed.some(o=>b.x<o.x+o.w+3&&b.x+b.w+3>o.x&&b.y<o.y+o.h+2&&b.y+b.h+2>o.y)){box=b;break}}
    if(!box){if(!item.always)return;box={x:cands[0][0],y:cands[0][1],w,h}}
    placed.push(box);
    ctx.globalAlpha=item.dim?.18:1;ctx.textAlign='left';
    let top=box.y;item.lines.forEach(l=>{ctx.font=l.font;ctx.lineWidth=3;ctx.strokeStyle=pale?'rgba(247,250,252,.85)':'rgba(6,8,13,.7)';ctx.lineJoin='round';
      const lx=box.x+(w-ctx.measureText(l.text).width)/2;ctx.strokeText(l.text,lx,top+l.h*.8);ctx.fillStyle=l.color;ctx.fillText(l.text,lx,top+l.h*.8);top+=l.h});
    ctx.globalAlpha=1})}
let lastNow=0,anchorId=null,anchorCallback=null;
function draw(now){
  if(!W)return;
  clock+=Math.min(.05,lastNow?(now-lastNow)/1000:0);lastNow=now;
  camera.tick(now);
  ctx.setTransform(ratio,0,0,ratio,0,0);hits=[];labelsQ=[];
  drawBackground();
  if(rings){const o=P({x:0,y:0});ctx.strokeStyle=pale?'rgba(92,116,148,.25)':'rgba(126,151,185,.18)';ctx.setLineDash([2,6]);ctx.lineWidth=1;
    rings.forEach(r=>{ctx.beginPath();ctx.ellipse(o.x,o.y,r*K()*EX,r*K(),0,0,Math.PI*2);ctx.stroke()});ctx.setLineDash([])}
  links.forEach(l=>{if(edgeOn(l)&&!edgeActive(l))drawEdge(l)});
  links.forEach(l=>{if(edgeOn(l)&&edgeActive(l))drawEdge(l)});
  const ordered=nodes.filter(visible).sort((a,b)=>(dim(b)?1:0)-(dim(a)?1:0)||(a.id===sel)-(b.id===sel));
  ordered.forEach((n,i)=>{if(n.type==='family')drawFamily(n);else if(n.type==='concept')drawStar(n,i);else if(view==='focus')drawCard(n);else drawSquare(n)});
  placeLabels();
  if(anchorCallback)anchorCallback(locateNode(anchorId));
  // The twinkle and the link particles have no end: they ride the scheduler's
  // reduced cadence, never a permanent sixty frames per second.
  if(camera.moving)scheduler.animate(60);else scheduler.idle(1000,80)}
function locateNode(id){const n=id&&nodes.find(item=>item.id===id&&visible(item));if(!n)return null;const p=P(n);if(p.x<0||p.y<0||p.x>W||p.y>H)return null;return{x:p.x,y:p.y,r:n.type==='source'?12:R(n)*Math.sqrt(K())+4}}

// ---------- interaction ----------
const offset=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
function hitAt(x,y){for(let i=hits.length-1;i>=0;i--){const h=hits[i];if(h.w?(Math.abs(x-h.x)<=h.w/2&&Math.abs(y-h.y)<=h.h/2):((x-h.x)**2+(y-h.y)**2<=h.r*h.r))return h.n}return null}
let drag=null;
cv.addEventListener('pointerdown',e=>{const[x,y]=offset(e);drag={n:hitAt(x,y),x0:x,y0:y,lx:x,ly:y,moved:false};cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointermove',e=>{const[x,y]=offset(e);
  if(drag){
    if(!drag.moved&&Math.hypot(x-drag.x0,y-drag.y0)<4)return;
    drag.moved=true;
    if(drag.n&&view!=='focus'){const w=toWorld(x,y),n=nodes.find(item=>item.id===drag.n.id);if(n){
      // A family carries its concepts: they move by the same offset, as they
      // did in the prototype's live simulation, instead of staying behind.
      const dx=w.x-n.x,dy=w.y-n.y;
      if(n.type==='family')nodes.forEach(m=>{if(m.type==='concept'&&m.family===n.family){m.x+=dx;m.y+=dy;manual[view+'|'+m.id]=[m.x,m.y]}});
      n.x=w.x;n.y=w.y;manual[view+'|'+n.id]=[w.x,w.y]}}
    else if(!drag.n)camera.pan(-(x-drag.lx)/K(),-(y-drag.ly)/K());
    drag.lx=x;drag.ly=y;scheduler.invalidate();return}
  const n=hitAt(x,y),id=n?n.id:null;if(id!==hover){hover=id;cv.style.cursor=n?'pointer':'move';scheduler.invalidate()}});
cv.addEventListener('pointerup',e=>{if(!drag)return;const d=drag;drag=null;
  if(cv.hasPointerCapture?.(e.pointerId))cv.releasePointerCapture(e.pointerId);
  if(d.moved)return;
  if(!d.n){if(sel)select(null);return}
  activateNode(d.n)});
cv.addEventListener('pointercancel',()=>{drag=null});
cv.addEventListener('pointerleave',()=>{if(hover){hover=null;scheduler.invalidate()}});
cv.addEventListener('wheel',e=>{e.preventDefault();const[x,y]=offset(e),w=toWorld(x,y);camera.zoomAt(e.deltaY<0?1.14:1/1.14,w.x,w.y)},{passive:false});
cv.addEventListener('keydown',e=>{const step=40/K();const m={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
  if(m){camera.pan(m[0],m[1]);e.preventDefault()}
  else if(e.key==='+'||e.key==='=')camera.zoomAt(1.2,camera.state.x,camera.state.y);else if(e.key==='-')camera.zoomAt(1/1.2,camera.state.x,camera.state.y);
  else if(e.key==='Escape')select(null)});
// The context card (contextCardScript) reads the renderer through this
// surface: where a node is on screen, and a callback to follow it.
function zoomGraph(factor){camera.zoomAt(factor,camera.state.x,camera.state.y)}
const canvasExplorer={anchor(id,callback){anchorId=id;anchorCallback=id?callback:null;scheduler.invalidate()},avoid(){},locate:locateNode,invalidate:()=>scheduler.invalidate()};
`;
}
