/**
 * Browser script of the /provenance page: fetches `/api/graph/provenance`,
 * renders the five columns, the banner and the detail card, and draws the
 * chains. Exported on its own so tests can run it against a real payload.
 */
export const PROVENANCE_SCRIPT = String.raw`
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KIND={template:'Template',context:'Build context',deliverable:'Deliverable',section:'Section',pivot:'Concept pivot',page:'Wiki page',fiche:'TAXO fiche',fragment:'Archive fragment',archive:'Archive'};
const COLOR={template:'tpl',context:'tpl',deliverable:'deliv',section:'deliv',pivot:'pivot',page:'pivot',fiche:'fiche',fragment:'raw',archive:'raw'};
const target=new URLSearchParams(location.search).get('id')||'';
let data=null,mode='frozen',build=null,selected=null,hover=null;
let byId=new Map(),cards=new Map(),els=new Map();

// A card per drawn object: sections are rows of the deliverable card, fragments
// rows of their archive card — exactly the mock-up's grouping.
const ownerOf=id=>{const n=byId.get(id);if(!n)return id;if(n.kind==='section')return data.root;if(n.kind==='fragment')return'archive:'+n.path;return id};
const allChains=()=>data?[...data.chains.map(c=>({ids:c,broken:false})),...(data.brokenChains||[]).map(c=>({ids:c,broken:true}))]:[];
const chainsThrough=ids=>allChains().filter(c=>c.ids.some(h=>ids.includes(h)));
const rowsOf=cardId=>{const c=cards.get(cardId);return c&&c.rows?c.rows.map(r=>r.id):[]};
// Confluence exports nest pages deep: the folders every source shares say
// nothing and crushed the cards. Each root (wiki/sources/, raw/ingested/…)
// shows its shared prefix as "…/", spelled out once in the banner and kept
// whole in tooltips and in the detail card.
let prefixes=[];
function computePrefixes(){
  const groups=new Map();
  data.nodes.forEach(n=>{const m=/^(wiki\/[^/]+\/|raw\/[^/]+\/)/.exec(n.path||'');if(m){if(!groups.has(m[1]))groups.set(m[1],[]);groups.get(m[1]).push(n.path)}});
  prefixes=[];
  groups.forEach((paths,root)=>{
    const dirs=paths.map(p=>p.slice(root.length).split('/').slice(0,-1));
    let shared=dirs[0]||[];
    dirs.forEach(d=>{let i=0;while(i<shared.length&&i<d.length&&shared[i]===d[i])i++;shared=shared.slice(0,i)});
    if(shared.join('/').length>24)prefixes.push({root,full:root+shared.join('/')+'/'})});
}
const short=path=>{const p=prefixes.find(x=>String(path).startsWith(x.full));return p?p.root+'…/'+String(path).slice(p.full.length):String(path)};
const shortText=text=>prefixes.reduce((t,p)=>t.split(p.full).join(p.root+'…/'),String(text));

async function load(){
  if(!target){showError('No deliverable given: open this page from a deliverable\'s "Provenance" link.');return}
  try{
    const query='/api/graph/provenance?id='+encodeURIComponent(target)+(mode==='live'?'&mode=live':'')+(build&&mode==='frozen'?'&build='+encodeURIComponent(build):'');
    const response=await fetch(query,{cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){showError(body.message||('Unable to read the provenance ('+response.status+').'));return}
    data=body;byId=new Map(data.nodes.map(n=>[n.id,n]));
    render()}
  catch(error){showError(String(error.message||error))}}
function showError(message){
  const b=$('banner');b.className='banner error';b.innerHTML='<span class="dot"></span><div>'+esc(message)+'</div>';
  $('title').textContent=target||'Provenance';$('path').textContent=target}

function buildCards(){
  cards=new Map();
  const rank=new Map();let i=0;
  data.nodes.filter(n=>n.col<=1).forEach(n=>rank.set(n.id,i++));
  const ordered=allChains().map(c=>c.ids).sort((a,b)=>(rank.get(a[0])??0)-(rank.get(b[0])??0));
  ordered.forEach(ids=>ids.forEach(id=>{if(!rank.has(id))rank.set(id,i++)}));
  const sorted=[...data.nodes].sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));
  for(const n of sorted){
    if(n.kind==='section'){const d=cards.get(data.root);if(d)d.rows.push(n);continue}
    if(n.kind==='fragment'){
      const id='archive:'+n.path;
      if(!cards.has(id))cards.set(id,{id,kind:'archive',col:4,title:n.title,path:n.path,rows:[]});
      cards.get(id).rows.push(n);continue}
    cards.set(n.id,{...n,rows:n.kind==='deliverable'?[]:null})}}

function badgeFor(row){
  const via=chainsThrough([row.id]);
  if(row.kind==='section'){const ok=via.filter(c=>!c.broken).length,lost=via.length-ok;
    return'<span class="n">'+ok+' proof'+(ok===1?'':'s')+'</span>'+(lost?'<span class="badge broken">'+lost+' broken</span>':'')}
  if(row.status==='missing')return'<span class="badge broken">'+(data.source==='live'?'no longer resolves':'missing in archive')+'</span>';
  if(row.status==='changed')return'<span class="badge stale">'+(data.source==='frozen'?'changed since build':'differs from build')+'</span>';
  if(via.length>1)return'<span class="badge multi">'+via.length+' chains</span>';
  return''}

function render(){
  buildCards();els.clear();computePrefixes();
  if(!selected||(!byId.has(selected)&&!cards.has(selected)))selected=data.root;
  const root=byId.get(data.root);
  $('title').textContent=root?root.title:data.root;$('path').textContent=data.root;
  document.title='Provenance · '+(root?root.title:data.root);
  for(let c=0;c<5;c++)$('col-'+c).querySelectorAll('.node,.empty').forEach(n=>n.remove());
  for(const card of cards.values()){
    const el=document.createElement('div');
    el.className='node'+(card.kind==='context'?' small':'')+(card.kind==='deliverable'?' deliv':'');
    el.style.setProperty('--kind','var(--c-'+COLOR[card.kind]+')');
    el.tabIndex=0;el.dataset.id=card.id;
    const refs=card.rows?0:chainsThrough([card.id]).length;
    el.title=card.path;
    el.innerHTML='<div class="k">'+esc(KIND[card.kind]||card.kind)+'</div><div class="t">'+esc(card.title)+'</div><div class="p">'+esc(short(card.path))+'</div>'
      +(refs>1?'<div class="p">'+refs+' chains pass here</div>':'')
      +(card.status==='missing'&&!card.rows?'<div style="margin-top:6px"><span class="badge broken">no longer exists</span></div>':'');
    if(card.rows){
      const rows=document.createElement('div');rows.className='rows';
      card.rows.forEach(r=>{const row=document.createElement('div');row.className='row';row.tabIndex=0;row.dataset.id=r.id;
        row.innerHTML='<span class="a">'+esc(r.kind==='section'?'§ '+r.title:'#'+(r.anchor||'(whole file)'))+'</span>'+badgeFor(r);
        rows.appendChild(row);els.set(r.id,row)});
      if(card.kind==='deliverable'&&!card.rows.length)rows.innerHTML='<div class="p">No section cites a source.</div>';
      el.appendChild(rows)}
    $('col-'+card.col).appendChild(el);els.set(card.id,el)}
  // An empty column says why, in its header: below it the chains run through.
  const empty={0:'Template unknown: no build record for this deliverable.',2:'None on these chains: the build cited fiches directly.',3:'No fiche on these chains.',4:'No evidence fragment.'};
  for(const c of [0,2,3,4])if(!$('col-'+c).querySelector('.node'))$('col-'+c).querySelector('h3').insertAdjacentHTML('afterend','<div class="empty">'+empty[c]+'</div>');
  renderControls();renderBanner();renderDetail();applyHighlight()}

function renderControls(){
  const frozenAvailable=Boolean(data.buildId)||(data.builds||[]).some(b=>b.createdAt);
  $('mode-frozen').disabled=!frozenAvailable;
  $('mode-frozen').setAttribute('aria-pressed',String(data.source==='frozen'));
  $('mode-live').setAttribute('aria-pressed',String(data.source==='live'));
  const builds=(data.builds||[]).filter(b=>b.createdAt);
  $('build-wrap').hidden=data.source!=='frozen'||builds.length<2;
  $('build').innerHTML=builds.slice().reverse().map(b=>'<option value="'+esc(b.id)+'">'+esc(b.createdAt.replace('T',' ').slice(0,16))+' · '+esc(b.id)+'</option>').join('');
  if(data.buildId)$('build').value=data.buildId}

function renderBanner(){
  const b=$('banner'),fragments=data.nodes.filter(n=>n.kind==='fragment');
  const changed=fragments.filter(n=>n.status==='changed').length,missing=fragments.filter(n=>n.status==='missing').length;
  const frags=data.source==='frozen'?fragments.length:fragments.length-missing;
  const list=(data.degradations||[]).length?'<ul>'+data.degradations.map(d=>'<li title="'+esc(d)+'"><code>'+esc(shortText(d))+'</code></li>').join('')+'</ul>':'';
  const legend=prefixes.length?'<div class="prefixes">'+prefixes.map(p=>'<code>'+esc(p.root)+'…/</code> = <code>'+esc(p.full)+'</code>').join(' · ')+'</div>':'';
  const artifact=data.artifact?' Opened from the export artifact <code>'+esc(data.requested)+'</code>: its evidence is the source deliverable\'s.':'';
  if(data.source==='frozen'){
    b.className='banner'+(list||missing?' live':'');
    b.innerHTML='<span class="dot"></span><div><b>Frozen evidence of build</b> <code>'+esc(data.buildId)+'</code>, read from <code>.wiki/builds/…/evidence.json</code>: '
      +data.chains.length+' chains, '+frags+' fragments. Exactly what this deliverable was built on, and what export uses.'
      +(changed?' '+changed+' fragment'+(changed>1?'s have':' has')+' changed in the current files since.':'')
      +(missing?' '+missing+' fragment'+(missing>1?'s':'')+' no longer resolve'+(missing>1?'':'s')+' in the current archive.':'')+artifact+list+legend+'</div>';
  }else{
    const fallback=mode==='frozen';
    b.className='banner live';
    b.innerHTML='<span class="dot"></span><div><b>Current files</b>'+(fallback?' (no usable frozen evidence for this deliverable)':'')
      +': chains resolved now from the deliverable\'s citations — '+data.chains.length+' chains, '+frags+' fragments'
      +((data.brokenChains||[]).length?', '+data.brokenChains.length+' chain'+(data.brokenChains.length>1?'s':'')+' of the build no longer resolve':'')
      +'. They may differ from what the build used.'+artifact+list+legend+'</div>'}}

function anchorPoint(el,side){const s=$('stage').getBoundingClientRect(),r=el.getBoundingClientRect();
  return{x:(side==='out'?r.right:r.left)-s.left,y:r.top+Math.min(r.height/2,18)-s.top}}
const curve=(a,b)=>{const dx=Math.max(30,(b.x-a.x)*.5);return'M'+a.x+','+a.y+' C'+(a.x+dx)+','+a.y+' '+(b.x-dx)+','+b.y+' '+b.x+','+b.y};
function drawEdges(){
  const svg=$('edges'),stage=$('stage');if(!data)return;
  svg.setAttribute('viewBox','0 0 '+stage.scrollWidth+' '+stage.scrollHeight);
  const lit=litChains(),parts=[];
  for(const e of data.edges){
    if(e.kind!=='uses'&&e.kind!=='produces')continue;
    const A=els.get(e.source),B=els.get(e.target);if(!A||!B)continue;
    if(e.kind==='uses'){const ra=anchorPoint(A,'out'),rb=anchorPoint(B,'out');
      parts.push('<path class="e ctx" d="M'+ra.x+','+ra.y+' C'+(ra.x+22)+','+ra.y+' '+(rb.x+22)+','+rb.y+' '+rb.x+','+rb.y+'"/>')}
    else parts.push('<path class="e ctx" d="'+curve(anchorPoint(A,'out'),anchorPoint(B,'in'))+'"/>')}
  const seen=new Set();
  allChains().forEach((c,index)=>{
    for(let i=0;i<c.ids.length-1;i++){
      const key=c.ids[i]+'>'+c.ids[i+1]+(c.broken?'!':''),on=lit.has(index);
      if(seen.has(key)&&!on)continue;seen.add(key);
      const A=els.get(c.ids[i])||els.get(ownerOf(c.ids[i])),B=els.get(c.ids[i+1])||els.get(ownerOf(c.ids[i+1]));if(!A||!B)continue;
      parts.push('<path class="e'+(c.broken?' broken':'')+(on?' on':'')+'" d="'+curve(anchorPoint(A,'out'),anchorPoint(B,'in'))+'"/>')}});
  svg.innerHTML=parts.join('')}

function focusIds(focus){if(!focus||!data)return[];const rows=rowsOf(focus);if(focus===data.root)return[];return rows.length?rows:[focus]}
function litChains(){
  const ids=focusIds(hover||selected);
  const out=new Set();if(!ids.length)return out;
  allChains().forEach((c,index)=>{if(c.ids.some(h=>ids.includes(h)))out.add(index)});return out}
function applyHighlight(){
  if(!data)return;
  const lit=litChains(),on=new Set(),chains=allChains();
  lit.forEach(index=>chains[index].ids.forEach(h=>{on.add(h);on.add(ownerOf(h))}));
  $('stage').classList.toggle('dim',lit.size>0);
  els.forEach((el,id)=>el.classList.toggle('on',on.has(id)));
  requestAnimationFrame(drawEdges)}

function chainLine(c){
  return c.ids.map(id=>{const n=byId.get(id);if(!n)return esc(id);
    if(n.kind==='fragment')return'<b>'+esc(n.path.split('/').pop())+'</b> #'+esc(n.anchor||'(whole file)');
    if(n.kind==='section')return'§ '+esc(n.title);
    return'<b>'+esc(n.path.split('/').pop())+'</b>'}).join(' → ')}
const donnaPath=path=>/^(wiki|raw\/ingested|raw\/untracked)\//.test(path);
function renderDetail(){
  const d=$('detail');if(!data)return;
  const card=cards.get(selected),n=byId.get(selected)||card;if(!n){d.innerHTML='';return}
  const via=selected===data.root?allChains():chainsThrough(card&&card.rows?rowsOf(selected):[selected]);
  let body='';
  if(n.text){
    body+='<blockquote>'+esc(n.text)+'</blockquote>';
    if(n.status==='changed'&&n.otherText)body+=data.source==='frozen'
      ?'<p class="how">Frozen at build time. The current archive now reads:</p><blockquote class="other">'+esc(n.otherText)+'</blockquote>'
      :'<p class="how">Current text. At build time the deliverable rested on:</p><blockquote class="other">'+esc(n.otherText)+'</blockquote>';
    if(n.status==='missing')body+='<p class="how">This passage no longer resolves in the current archive: the text above is the one the build froze.</p>'}
  if(selected===data.root)body+='<p class="how">'+data.chains.length+' citation chains and '+data.nodes.filter(x=>x.kind==='fragment').length+' evidence fragments'
    +(data.nodes.some(x=>x.kind==='template')?', produced by <b>'+esc(data.nodes.find(x=>x.kind==='template').path)+'</b>':'')+'.</p>';
  if(via.length)body+='<p class="how">'+via.length+' chain'+(via.length>1?'s':'')+(selected===data.root?'':' through here')+':</p><ul class="chainlist">'
    +via.map(c=>'<li'+(c.broken?' class="broken"':'')+'>'+(c.broken?'✕ ':'')+chainLine(c)+'</li>').join('')+'</ul>';
  const path=n.path,anchor=n.kind==='fragment'&&n.anchor?'#'+n.anchor:'';
  const href='/'+String(path).split('/').map(encodeURIComponent).join('/');
  const actions=n.kind==='section'?'':'<div class="actions"><a href="'+esc(href)+'">Open page</a>'
    +(donnaPath(path)?'<button type="button" data-donna="'+esc(path)+'">Add to Donna</button>':'')+'</div>';
  d.innerHTML='<h4>'+esc(KIND[n.kind]||n.kind)+' · '+esc(n.kind==='section'?'§ '+n.title:n.title)+'</h4><div class="p">'+esc(path)+esc(anchor)+'</div>'+body+actions}

// "Add to Donna" claims success only when the shell answers, like the graph.
const pendingDonna=new Map();
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-donna]');if(!button)return;
  const path='/'+button.dataset.donna;
  if(!window.parent||window.parent===window){button.title='Open this page inside the app to send documents to Donna';return}
  pendingDonna.set(path,button);window.parent.postMessage({type:'llmwiki:addContext',path},location.origin)});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.data?.type!=='llmwiki:addContext:result')return;
  const button=pendingDonna.get(event.data.path);if(!button)return;pendingDonna.delete(event.data.path);
  if(event.data.ok){button.classList.add('done');button.textContent='Added to Donna'}else button.title='This document cannot be added to Donna'});

const stage=$('stage');
stage.addEventListener('mouseover',e=>{const t=e.target.closest('.row,.node');const id=t?t.dataset.id:null;if(id!==hover){hover=id;applyHighlight()}});
stage.addEventListener('mouseleave',()=>{hover=null;applyHighlight()});
const pick=e=>{const t=e.target.closest('.row,.node');if(!t)return;e.stopPropagation();selected=t.dataset.id;renderDetail();applyHighlight()};
stage.addEventListener('click',pick);
stage.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(e)}});
stage.addEventListener('focusin',e=>{const t=e.target.closest('.row,.node');if(t){hover=t.dataset.id;applyHighlight()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&data){selected=data.root;hover=null;renderDetail();applyHighlight()}});
$('mode-frozen').addEventListener('click',()=>{mode='frozen';load()});
$('mode-live').addEventListener('click',()=>{mode='live';load()});
$('build').addEventListener('change',e=>{build=e.target.value;load()});
$('refresh').addEventListener('click',()=>load());
window.addEventListener('resize',()=>requestAnimationFrame(drawEdges));
if(window.parent&&window.parent!==window){const close=$('close');close.hidden=false;
  close.addEventListener('click',()=>{try{window.parent.postMessage({type:'llmwiki:close',from:'graph'},location.origin)}catch(error){}})}
load();
`;
