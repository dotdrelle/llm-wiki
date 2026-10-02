/**
 * Provenance view — one deliverable, read left to right.
 *
 * A fifth view of the /graph page, opened with `?provenance=<deliverable>`
 * (the "Provenance" action of a deliverable page). It draws what the server
 * reads from the build's frozen evidence manifest (`/api/graph/provenance`):
 * template and build context → the deliverable and its citing sections →
 * the pivots and fiches each citation went through → the exact fragments of
 * `raw/ingested/`. Columns are computed here, like the Focus rings; drawing
 * stays on the shared Canvas renderer (cards and curves), never DOM nodes.
 *
 * "Frozen" is what the build used and what export will read; "Current"
 * re-resolves today's files. Every degradation the server reports is listed
 * in the inspector — a fallback or a broken chain is never silent.
 */
export function provenanceScript(): string {
  return String.raw`
const PROV_COLOR={template:'#a75ee8',context:'#a75ee8',deliverable:'#34c4ca',section:'#34c4ca',pivot:'#f1b52f',page:'#f1b52f',fiche:'#7895bb',fragment:'#66bd4b'};
const PROV_KIND={template:'Template',context:'Build context',deliverable:'Deliverable',section:'Section',pivot:'Concept pivot',page:'Wiki page',fiche:'TAXO fiche',fragment:'Evidence fragment'};
const PROV_COLUMN_X=285,PROV_W=215;
let provTarget=null,prov=null,provById=new Map(),provMode='frozen',provBuild=null,provError=null,provLoading=false;
function initProvenance(){
  try{provTarget=new URLSearchParams(location.search).get('provenance')||null}catch(error){provTarget=null}
  if(!provTarget)return false;
  view='provenance';loadProvenance(true);return true}
async function loadProvenance(reframe){
  if(!provTarget||provLoading)return;
  provLoading=true;
  try{
    const query='/api/graph/provenance?id='+encodeURIComponent(provTarget)+(provMode==='live'?'&mode=live':'')+(provBuild?'&build='+encodeURIComponent(provBuild):'');
    prov=await json(query);provError=null;
    provById=new Map(prov.nodes.map(n=>[n.id,n]));
    if(sel&&!provById.has(sel))sel=null;
    renderProvBuilds()}
  catch(error){prov=null;provById=new Map();provError=String(error.message||error).slice(0,300)}
  finally{provLoading=false}
  if(view==='provenance'){buildScene(Boolean(reframe));render()}}
function renderProvBuilds(){
  const pick=document.querySelector('#prov-build');if(!pick||!prov)return;
  pick.innerHTML=(prov.builds||[]).slice().reverse().map(b=>'<option value="'+esc(b.id)+'">'+esc((b.createdAt||'').replace('T',' ').slice(0,16)||'build')+' · '+esc(b.id)+'</option>').join('');
  if(prov.buildId)pick.value=prov.buildId}
function provSub(n){
  if(n.kind==='fragment')return'#'+(n.anchor||'(whole file)');
  if(n.kind==='section')return'section';
  return n.path}
// Rows follow the order chains are met, so a section's evidence sits level with it.
function provenanceData(){
  if(!prov)return{nodes:[],links:[]};
  const rank=new Map();let i=0;
  prov.nodes.filter(n=>n.col<=1).forEach(n=>rank.set(n.id,i++));
  const ordered=[...prov.chains].sort((a,b)=>(rank.get(a[0])??0)-(rank.get(b[0])??0));
  ordered.forEach(chain=>chain.forEach(id=>{if(!rank.has(id))rank.set(id,i++)}));
  prov.nodes.forEach(n=>{if(!rank.has(n.id))rank.set(n.id,i++)});
  const columns=[[],[],[],[],[]];
  [...prov.nodes].sort((a,b)=>rank.get(a.id)-rank.get(b.id)).forEach(n=>columns[Math.max(0,Math.min(4,n.col))].push(n));
  const out=[];
  columns.forEach((col,c)=>{
    const step=c===4?62:56,top=-(col.length-1)*step/2;
    col.forEach((n,k)=>{const placed=manual['provenance|'+n.id];
      out.push({...n,type:'prov',prov:true,w:PROV_W,h:n.kind==='fragment'?48:42,x:placed?placed[0]:(c-2)*PROV_COLUMN_X,y:placed?placed[1]:top+k*step})})});
  const links=prov.edges.map(e=>({source:e.source,target:e.target,kind:'prov-'+e.kind}));
  return{nodes:out,links}}
// Everything on a chain through the node: the reader sees the whole path, both ways.
function provNeighbors(id){
  if(!prov)return[];
  const n=provById.get(id);if(!n)return[];
  if(n.kind==='template'||n.kind==='context')return prov.nodes.filter(m=>m.col===0||m.kind==='deliverable').map(m=>m.id);
  if(n.kind==='deliverable')return prov.nodes.map(m=>m.id);
  const out=new Set();prov.chains.forEach(chain=>{if(chain.includes(id))chain.forEach(x=>out.add(x))});
  if(n.kind==='section')out.add(prov.root);
  return[...out]}
function provChainsThrough(id){return prov?prov.chains.filter(chain=>chain.includes(id)):[]}
function provSummary(){
  if(provError)return'unable to load';
  if(!prov)return'loading…';
  const frags=prov.nodes.filter(n=>n.kind==='fragment').length;
  return prov.chains.length+' citation chains · '+frags+' evidence fragments · '+(prov.source==='frozen'?'frozen evidence':'current files')}
function provChainLine(chain){
  return chain.map(id=>{const n=provById.get(id);if(!n)return esc(id);
    return n.kind==='fragment'?'<b>'+esc(n.title)+'</b> #'+esc(n.anchor||''):n.kind==='section'?'§ '+esc(n.title):esc(n.path.split('/').pop())}).join(' → ')}
function provPanel(){
  if(provError)return head('Provenance',provTarget||'','')+'<p>Unable to load the provenance of this deliverable: '+esc(provError)+'</p>';
  if(!prov)return head('Provenance',provTarget||'','Loading…');
  const warnings=(prov.degradations||[]).length?'<div class="sec">Announced · '+prov.degradations.length+'</div><ul class="prov-warn">'+prov.degradations.map(d=>'<li>'+esc(d)+'</li>').join('')+'</ul>':'';
  const origin=prov.source==='frozen'
    ?'<p>Frozen evidence of build <code>'+esc(prov.buildId)+'</code>: exactly what this deliverable was built on, and what export reads.</p>'
    :'<p class="prov-live">Current files: chains resolved now from the deliverable\'s citations. They may differ from the build.</p>';
  const n=sel&&provById.get(sel);
  if(!n){
    const root=provById.get(prov.root);
    return head('Provenance',root?root.title:prov.root,esc(provSummary()))+'<div class="path">'+esc(prov.root)+'</div>'
      +(prov.artifact?'<p>Opened from the export artifact <code>'+esc(prov.requested)+'</code>; its evidence is the source deliverable\'s.</p>':'')
      +origin+warnings
      +'<div class="sec">Sections · '+prov.nodes.filter(m=>m.kind==='section').length+'</div><ul class="rows">'
      +prov.nodes.filter(m=>m.kind==='section').map(m=>'<li><button type="button" data-prov="'+esc(m.id)+'"><span class="dot" style="--c:'+PROV_COLOR.section+'"></span><span>'+esc(m.title)+'</span><span class="n">'+provChainsThrough(m.id).length+'</span></button></li>').join('')+'</ul>'}
  const chains=n.kind==='deliverable'?prov.chains:provChainsThrough(n.id);
  const status=n.status==='changed'?(prov.source==='frozen'?'<p class="prov-live">The archive changed since the build: the text below is the frozen one.</p>':'<p class="prov-live">Differs from the text frozen by the build.</p>'):n.status==='missing'?'<p class="prov-live">This fragment no longer resolves in the current archive.</p>':'';
  return head(PROV_KIND[n.kind]||n.kind,n.title,esc(provSub(n)))+'<div class="path">'+esc(n.path)+(n.anchor?'#'+esc(n.anchor):'')+'</div>'
    +status+(n.text?'<blockquote class="prov-quote">'+esc(n.text)+'</blockquote>':'')
    +(chains.length?'<div class="sec">Citation chains · '+chains.length+'</div><ul class="prov-chains">'+chains.map(c=>'<li>'+provChainLine(c)+'</li>').join('')+'</ul>':'')
    +(n.kind!=='section'?'<button type="button" class="cta" data-preview-doc="'+esc(n.path)+'">Open page</button>':'')}
function provActivate(n){
  select(n.id);
  if(n.kind!=='section'&&n.kind!=='fragment')openGraphContextCard({id:n.id,title:n.title,type:PROV_KIND[n.kind]||n.kind})}
function syncProvChrome(){
  const on=view==='provenance';
  document.querySelector('#v-provenance').hidden=!provTarget;
  document.querySelector('#stage').classList.toggle('prov',on);
  const mode=document.querySelector('#prov-mode'),pick=document.querySelector('#prov-build');
  mode.hidden=!on;mode.textContent=provMode==='frozen'?'Show current files':'Show frozen evidence';
  pick.hidden=!on||provMode==='live'||!prov||(prov.builds||[]).length<2}
document.querySelector('#prov-mode').addEventListener('click',()=>{provMode=provMode==='frozen'?'live':'frozen';loadProvenance(false)});
document.querySelector('#prov-build').addEventListener('change',event=>{provBuild=event.target.value;loadProvenance(false)});
// ---------- drawing (shared Canvas primitives of the renderer) ----------
function drawProvEdge(l){
  const a=P(l.a),b=P(l.b),lit=!focusSet||(focusSet.has(l.a.id)&&focusSet.has(l.b.id)),on=Boolean(sel||query)&&lit;
  ctx.globalAlpha=lit?1:.12;
  const ax=a.x+(l.a.w/2)*K(),bx=b.x-(l.b.w/2)*K();
  ctx.strokeStyle=on?'rgba(77,156,255,.9)':(pale?'rgba(92,116,148,.38)':'rgba(126,151,185,.32)');
  ctx.lineWidth=on?2:1.2;
  if(l.kind==='prov-uses'||l.kind==='prov-section'){
    // Inside a column: a dotted bracket along the right-hand edges.
    const ra=a.x+(l.a.w/2)*K(),rb=b.x+(l.b.w/2)*K(),out=Math.max(ra,rb)+18;
    ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(ra,a.y);ctx.bezierCurveTo(out,a.y,out,b.y,rb,b.y);ctx.stroke();ctx.setLineDash([]);
  }else{
    const dx=Math.max(30,(bx-ax)*.5);
    ctx.beginPath();ctx.moveTo(ax,a.y);ctx.bezierCurveTo(ax+dx,a.y,bx-dx,b.y,bx,b.y);ctx.stroke()}
  ctx.globalAlpha=1}
function drawProvCard(n){
  const p=P(n),paint=PROV_COLOR[n.kind]||SRC_COLOR,selected=sel===n.id,hot=hover===n.id,k=Math.min(1.25,Math.max(.9,K())),w=n.w*K(),h=n.h*k;
  ctx.globalAlpha=dim(n)?.18:1;
  if(selected||hot)glow(paint,.35,.12,p.x,p.y,Math.max(w,h)*.7);
  ctx.fillStyle=pale?'rgba(255,255,255,.97)':'rgba(16,23,34,.96)';
  ctx.beginPath();graphRoundedRect(ctx,p.x-w/2,p.y-h/2,w,h,8);ctx.fill();
  ctx.strokeStyle=rgba(paint,selected||hot?1:.5);ctx.lineWidth=selected||n.kind==='deliverable'?2:1;ctx.stroke();
  ctx.fillStyle=paint;ctx.fillRect(p.x-w/2+3,p.y-h/2+6,3,h-12);
  if(K()>.42){
    const fit=(text,font,max)=>{ctx.font=font;let t=String(text);if(ctx.measureText(t).width<=max)return t;while(t.length>4&&ctx.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…'};
    const left=p.x-w/2+12,max=w-22-(n.status&&n.status!=='unchanged'?16:0);
    ctx.textAlign='left';ctx.fillStyle=pale?'#172433':'#edf3fb';
    ctx.fillText(fit(n.kind==='section'?'§ '+n.title:n.title,'600 '+Math.round(11*k)+'px '+FONT,max),left,p.y-2*k);
    ctx.fillStyle=rgba(paint,.95);ctx.fillText(fit(provSub(n),Math.round(9.5*k)+'px '+FONT,max),left,p.y+11*k);
    if(n.status&&n.status!=='unchanged'){ctx.fillStyle=n.status==='missing'?'#ed7550':'#f1b52f';ctx.beginPath();ctx.arc(p.x+w/2-10,p.y-h/2+10,4,0,Math.PI*2);ctx.fill()}}
  ctx.globalAlpha=1;
  hits.push({n,x:p.x,y:p.y,w,h})}
`;
}
