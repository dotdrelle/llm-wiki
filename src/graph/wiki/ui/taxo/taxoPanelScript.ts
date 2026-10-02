/**
 * TAXO graph — chrome: views, filters, inspector, search, live revisions.
 *
 * Four readings of one payload (Families, Concepts, Concept focus, Concepts +
 * sources), the family/source filters of the left column, and the frosted
 * inspector of the prototype. A click on a fiche also opens the context card
 * (LLM summary, "Open page", "Add to Donna"), which is kept from the former
 * graph. The search is the engine's retrieval, server-side; this file only
 * decides what of the matched pages each view can show, and says which mode
 * answered — a lexical fallback is announced, never passed off as semantic.
 */
export function taxoPanelScript(): string {
  return String.raw`
let focusSet=null,showSrcLabels=false;
const ABOUT={
  family:'Each family radiates its concepts. Two families are linked when they share sources; the number on the link counts them.',
  concepts:'Two concepts are linked when one source cites both. The stroke thickens with the number of shared sources.',
  focus:'One concept in the centre, its sources on the first ring, then the concepts those sources also cite. Click an outer concept to move there.',
  full:'Bipartite graph: each source is linked to the concepts it tags.',
  provenance:'One deliverable, read left to right: what produced it, its citing sections, the pivots and fiches each citation went through, and the exact archive fragments it rests on.'};
const LEGEND={
  family:'<span><i class="grad"></i>linked families · shared sources</span><span><i class="dash" style="--c:#8fa3b8"></i>membership</span>',
  concepts:'<span><i style="--c:#7e97b9"></i>shared sources</span><span><i style="--c:#4d9cff"></i>selection</span>',
  focus:'<span><span class="dot" style="--c:'+SRC_COLOR+'"></span>source</span><span><span class="star" style="--c:#4d9cff"></span>concept</span><span><i style="--c:#7e97b9"></i>cites</span>',
  full:'<span><span class="dot" style="--c:'+SRC_COLOR+'"></span>source</span><span><span class="star" style="--c:#4d9cff"></span>concept</span><span><i style="--c:#7e97b9"></i>tag</span>',
  provenance:['template','deliverable','pivot','fiche','fragment'].map(k=>'<span><span class="dot" style="--c:'+PROV_COLOR[k]+'"></span>'+PROV_KIND[k].toLowerCase()+'</span>').join('')};
const $=selector=>document.querySelector(selector);
const panel=$('#panel');

function neighbors(id){
  if(view==='provenance')return provNeighbors(id);
  if(view==='family')return id.startsWith('f:')?[...(famAdj.get(id)?.keys()||[]),...concepts.filter(c=>'f:'+c.family===id).map(c=>c.id)]:['f:'+byId.get(id)?.family];
  if(view==='concepts')return[...(coAdj.get(id)?.keys()||[])];
  const ids=new Set(nodes.map(n=>n.id));return[...(bip.get(id)||[])].filter(x=>ids.has(x))}
// What a search match lights up in the current view: a fiche is not drawn in
// the family and concept views, so it lights the concepts it tags (and, on the
// family view, their families) instead of vanishing.
function searchFocus(){
  if(view==='provenance')return new Set(nodes.filter(n=>searchHits.has(n.path)).map(n=>n.id));
  const matched=[...searchHits].filter(id=>byId.has(id));
  const set=new Set(matched);
  if(view==='family'||view==='concepts')matched.forEach(id=>{if(byId.get(id).type==='source')bip.get(id).forEach(c=>set.add(c))});
  if(view==='family')[...set].forEach(id=>{const n=byId.get(id);if(n?.type==='concept')set.add('f:'+n.family)});
  return set}
function render(){
  if(sel)focusSet=new Set([sel,...neighbors(sel)]);
  else if(query&&searchHits)focusSet=searchFocus();
  else focusSet=null;
  syncChrome();renderPanel();scheduler.invalidate()}
function select(id){sel=id;render()}
function openFocus(id){if(!byId.has(id))return;focusId=id;view='focus';sel=null;buildScene(true);render()}
function activateNode(n){
  if(view==='provenance'){provActivate(n);return}
  if(view==='focus'&&n.type==='concept'&&n.id!==focusId){openFocus(n.id);return}
  select(n.id);
  if(n.type==='source')openGraphContextCard(byId.get(n.id)||n)}
function setView(next){
  if(next===view)return;
  if(next==='focus'&&sel&&byId.get(sel)?.type==='concept')focusId=sel;
  view=next;if(view==='focus'||view==='provenance')sel=null;
  if(view==='provenance'&&!prov)loadProvenance(true);else if(sel&&!viewGraph().nodes.some(n=>n.id===sel))sel=null;
  buildScene(true);render()}

function searchStatus(){
  if(!query)return'';
  if(searchError)return' · search failed: '+searchError;
  if(!searchHits)return' · searching…';
  const shown=[...searchHits].filter(id=>byId.has(id)).length;
  const mode=searchMode?.mode==='hybrid'?'hybrid search':searchMode?.mode==='lexical-fallback'?'lexical search (vector index '+(searchMode.reason||'unavailable')+')':'lexical search (no vector index)';
  return' · '+(searchMode?.weak?'no strong match, '+shown+' closest':shown+' match'+(shown===1?'':'es'))+' · '+mode}
// The search shows its own state where the reader is typing: a spinner while
// the engine answers, then a chip naming the mode that answered — amber when
// the vector side was not used, so a lexical answer never reads as semantic.
function syncSearchChrome(){
  const wrap=$('#search-wrap'),chip=$('#search-mode');
  wrap.classList.toggle('is-searching',Boolean(query)&&!searchHits&&!searchError);
  wrap.setAttribute('aria-busy',String(wrap.classList.contains('is-searching')));
  const mode=searchMode?.mode;
  chip.hidden=!query||!searchHits;
  chip.classList.toggle('degraded',Boolean(searchError)||mode!=='hybrid');
  chip.classList.toggle('degraded',chip.classList.contains('degraded')||Boolean(searchMode?.weak));
  chip.textContent=searchError?'search failed':(mode==='hybrid'?'semantic + lexical':mode==='lexical-fallback'?'lexical only (vector index '+(searchMode.reason||'unavailable')+')':'lexical only')+(searchMode?.weak?' · weak matches':'');
  chip.title=chip.textContent}
function syncChrome(){
  syncSearchChrome();
  ['family','concepts','focus','full','provenance'].forEach(v=>$('#v-'+v).setAttribute('aria-pressed',String(view===v)));
  syncProvChrome();
  $('#view-title').textContent=view==='focus'?'Focus · '+(byId.get(focusId)?.title||''):view==='provenance'?'Provenance · '+(provById.get(prov?.root)?.title||provTarget||''):VIEW_TITLES[view];
  const nS=nodes.filter(n=>n.type==='source').length;
  $('#summary').textContent=(
    view==='family'?FAMS.length+' families · '+concepts.length+' concepts · '+crossLinks.length+' cross-family links':
    view==='concepts'?concepts.length+' concepts · '+coLinks.length+' links by shared sources':
    view==='focus'?nS+' sources · '+Math.max(0,nodes.length-1-nS)+' neighbouring concepts':
    view==='provenance'?provSummary():
    concepts.length+' concepts · '+sources.length+' sources · '+links.length+' links')+searchStatus();
  const pick=$('#pick');pick.hidden=view!=='focus';if(focusId)pick.value=focusId;
  $('#labels').hidden=view!=='full';
  $('#src-filter').closest('section').hidden=view==='family'||view==='concepts'||view==='provenance';
  $('#fam-filters').closest('section').hidden=view==='provenance';
  $('#about').textContent=ABOUT[view];
  $('#legend').innerHTML=LEGEND[view]}
function renderFilters(){
  const famCount={};concepts.forEach(c=>famCount[c.family]=(famCount[c.family]||0)+1);
  $('#fam-filters').innerHTML=FAMS.map(f=>filterButton(f,'<span class="star" style="--c:'+famColor(f)+'"></span><span>'+esc(f)+'</span><span class="n">'+(famCount[f]||0)+'</span>')).join('');
  $('#src-filter').innerHTML=filterButton('__src','<span class="dot" style="--c:'+SRC_COLOR+'"></span><span>Sources</span><span class="n">'+sources.length+'</span>');
  const pick=$('#pick');pick.innerHTML=FAMS.map(f=>'<optgroup label="'+esc(f)+'">'+concepts.filter(c=>c.family===f).sort((a,b)=>a.title.localeCompare(b.title)).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.title)+' ('+c.nsrc+')</option>').join('')+'</optgroup>').join('')}
const filterButton=(key,html)=>'<button type="button" class="filter" data-filter="'+esc(key)+'" aria-pressed="'+active.has(key)+'">'+html+'</button>';

// ---------- inspector ----------
const mark=n=>n.type==='source'?'<span class="dot" style="--c:'+SRC_COLOR+'"></span>':'<span class="star" style="--c:'+colorOf(n)+'"></span>';
const row=(n,count,extra='',attr='data-id')=>'<li><button type="button" '+attr+'="'+esc(n.id)+'">'+mark(n)+'<span>'+esc(n.title)+'</span><span class="n">'+count+'</span></button>'+extra+'</li>';
const via=ids=>'<div class="via">via '+ids.map(s=>esc(byId.get(s)?.title||s)).join(' · ')+'</div>';
const head=(kind,title,sub)=>'<div class="panel-head"><small>'+kind+'</small><strong>'+esc(title)+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
const conceptHead=n=>head('Concept',n.title,mark(n)+esc(n.family)+' · '+n.nsrc+' source'+(n.nsrc>1?'s':''))+(n.desc?'<p>'+esc(n.desc)+'</p>':'')+'<div class="path">'+esc(n.path)+'</div>';
const byWeight=(a,b)=>b.nsrc-a.nsrc||a.title.localeCompare(b.title);
function searchPanel(){
  const matched=[...searchHits].map(id=>byId.get(id)).filter(Boolean);
  const cs=matched.filter(n=>n.type==='concept'),ss=matched.filter(n=>n.type==='source');
  return head('Search',query,esc(searchStatus().replace(/^ · /,'')))+
    (cs.length?'<div class="sec">Concepts · '+cs.length+'</div><ul class="rows">'+cs.map(c=>row(c,c.nsrc)).join('')+'</ul>':'')+
    (ss.length?'<div class="sec">Sources · '+ss.length+'</div><ul class="rows">'+ss.map(s=>row(s,s.nsrc,'','data-src')).join('')+'</ul>':'')+
    (matched.length?'':'<p>No concept or source matches this search.</p>')}
function renderPanel(){
  if(view==='provenance'){panel.innerHTML=provPanel();return}
  let h='';
  if(!sel&&query&&searchHits)h=searchPanel();
  else if(view==='focus'&&!sel){
    const c=byId.get(focusId);if(!c){panel.innerHTML='';return}
    const srcs=nodes.filter(n=>n.ring===1),outer=nodes.filter(n=>n.ring===2).sort((a,b)=>FAMS.indexOf(a.family)-FAMS.indexOf(b.family)||a.title.localeCompare(b.title));
    h=conceptHead(c)+'<div class="sec">Sources · '+srcs.length+'</div><ul class="rows">'+srcs.map(s=>row(s,s.nsrc,'','data-src')).join('')+'</ul>'+
      '<div class="sec">Neighbouring concepts · '+outer.length+'</div>'+(outer.length?'<ul class="rows">'+outer.map(o=>row(o,o.nsrc,via(srcs.filter(s=>bip.get(s.id).has(o.id)).map(s=>s.id)),'data-focus')).join('')+'</ul>':'<p>Its sources cite no other concept.</p>');
  }else if(!sel){
    if(view==='family'){
      const cross=[...crossLinks].sort((a,b)=>b.w-a.w);
      h=head('Families view',FAMS.length+' families',concepts.length+' concepts · '+sources.length+' sources')+
        '<ul class="rows">'+famNodes.map(f=>row(f,f.count+' · '+f.nsrc)).join('')+'</ul>'+
        '<div class="sec">Cross-family links · '+cross.length+'</div><ul class="rows">'+cross.map(l=>'<li><button type="button" data-id="'+esc(l.source)+'"><span>'+esc(byId.get(l.source).title)+' ↔ '+esc(byId.get(l.target).title)+'</span><span class="n">'+l.w+'</span></button></li>').join('')+'</ul>';
    }else if(view==='concepts'){
      h=head('Concepts view',concepts.length+' concepts',coLinks.length+' links by shared sources')+
        FAMS.map(f=>{const cs=concepts.filter(c=>c.family===f).sort(byWeight);return'<div class="sec">'+esc(f)+' · '+cs.length+'</div><ul class="rows">'+cs.map(c=>row(c,c.nsrc)).join('')+'</ul>'}).join('');
    }else{
      const top=[...concepts].sort((a,b)=>b.nsrc-a.nsrc).slice(0,10);
      h=head('Concepts + sources view','Most cited concepts',sources.length+' sources · '+citeLinks.length+' links')+'<ul class="rows">'+top.map(c=>row(c,c.nsrc)).join('')+'</ul>'}
  }else{
    const n=byId.get(sel);
    if(!n){sel=null;panel.innerHTML='';return}
    if(n.type==='family'){
      const cs=concepts.filter(c=>c.family===n.family).sort(byWeight);
      const rel=[...famAdj.get(sel)].map(([id,l])=>({f:byId.get(id),l})).sort((a,b)=>b.l.w-a.l.w);
      h=head('Family',n.title,mark(n)+n.count+' concepts · '+n.nsrc+' sources')+
        '<div class="sec">Concepts · '+cs.length+'</div><ul class="rows">'+cs.map(c=>row(c,c.nsrc)).join('')+'</ul>'+
        '<div class="sec">Linked families · '+rel.length+'</div>'+(rel.length?'<ul class="rows">'+rel.map(({f,l})=>row(f,l.w,via(l.srcs))).join('')+'</ul>':'<p>No source shared with another family.</p>');
    }else if(n.type==='concept'){
      h=conceptHead(n)+(view!=='focus'?'<button type="button" class="cta" data-focus="'+esc(n.id)+'">Open in concept focus</button>':'');
      if(view==='concepts'){
        const rel=[...coAdj.get(sel)].map(([id,l])=>({c:byId.get(id),l})).sort((a,b)=>b.l.w-a.l.w||a.c.title.localeCompare(b.c.title));
        h+='<div class="sec">Linked concepts · '+rel.length+'</div>'+(rel.length?'<ul class="rows">'+rel.map(({c,l})=>row(c,l.w,via(l.srcs))).join('')+'</ul>':'<p>No source shared with another concept.</p>')}
      const srcs=[...bip.get(sel)].map(id=>byId.get(id));
      h+='<div class="sec">Sources · '+srcs.length+'</div><ul class="rows">'+srcs.map(s=>row(s,s.nsrc,'','data-src')).join('')+'</ul>';
    }else{
      const cs=[...bip.get(sel)].map(id=>byId.get(id)).sort(byWeight);
      h=head('Source',n.title,mark(n)+esc(n.folder||''))+(n.desc?'<p>'+esc(n.desc)+'</p>':'')+'<div class="path">'+esc(n.path)+'</div>'+
        '<div class="sec">Tagged concepts · '+cs.length+'</div><ul class="rows">'+cs.map(c=>row(c,c.nsrc,'','data-focus')).join('')+'</ul>'}}
  panel.innerHTML=h}
panel.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.prov)select(button.dataset.prov);
  else if(button.dataset.id)select(button.dataset.id);
  else if(button.dataset.focus)openFocus(button.dataset.focus);
  else if(button.dataset.src){
    const id=button.dataset.src;
    if(view!=='focus'&&view!=='full'){view='full';buildScene(true)}
    select(id);openGraphContextCard(byId.get(id))}});

// ---------- controls ----------
['family','concepts','focus','full','provenance'].forEach(v=>$('#v-'+v).addEventListener('click',()=>setView(v)));
$('#labels').addEventListener('click',()=>{showSrcLabels=!showSrcLabels;scheduler.invalidate()});
$('#reset').addEventListener('click',()=>{Object.keys(manual).forEach(key=>{if(key.startsWith(view+'|'))delete manual[key]});buildScene(false);fit(true)});
$('#pick').addEventListener('change',event=>openFocus(event.target.value));
$('#zoom-in').addEventListener('click',()=>zoomGraph(1.25));
$('#zoom-out').addEventListener('click',()=>zoomGraph(.8));
document.querySelector('.filters').addEventListener('click',event=>{
  const button=event.target.closest('[data-filter]');if(!button)return;
  const key=button.dataset.filter;active.has(key)?active.delete(key):active.add(key);
  button.setAttribute('aria-pressed',String(active.has(key)));render()});
$('#insp-toggle').addEventListener('click',()=>{const insp=$('#inspector');insp.classList.toggle('collapsed');$('#insp-toggle').setAttribute('aria-expanded',String(!insp.classList.contains('collapsed')))});
let searchTimer=0,searchSeq=0;
async function runSearch(){
  const seq=++searchSeq,q=query;
  if(!q){searchHits=null;searchMode=null;searchError=null;render();return}
  try{
    const answer=await json('/api/graph/search?q='+encodeURIComponent(q));
    if(seq!==searchSeq)return;
    searchHits=new Set((answer.results||[]).map(item=>item.path));searchMode=answer;searchError=null}
  catch(error){if(seq!==searchSeq)return;searchHits=new Set();searchMode=null;searchError=String(error.message||error).slice(0,120)}
  render()}
$('#q').addEventListener('input',event=>{
  query=event.target.value.trim();if(query&&sel)sel=null;
  searchHits=null;render();
  clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,250)});

// ---------- loading and live revisions ----------
let taxoLoading=false,taxoWanted=false;
async function loadTaxo(first){
  if(taxoLoading){taxoWanted=true;return}
  taxoLoading=true;
  try{
    do{
      taxoWanted=false;
      const payload=await json('/api/graph/taxo');
      ingestTaxo(payload);
      if(!concepts.length&&!sources.length){$('#empty').hidden=false;$('#summary').textContent='Empty wiki';continue}
      $('#empty').hidden=true;
      renderFilters();buildScene(first);first=false;
      // A revision may have changed what the open search matches.
      if(query)runSearch();else render()
    }while(taxoWanted)}
  catch(error){$('#empty').hidden=false;$('#empty').textContent='Unable to load the graph: '+error.message}
  finally{taxoLoading=false}}
function onGraphRevision(){loadTaxo(false);if(provTarget)loadProvenance(false)}
function startRevisionFeed(){
  if(window.parent&&window.parent!==window){
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin)return;
      if(event.data?.type==='llmwiki:graph-revision')onGraphRevision()});
    try{window.parent.postMessage({type:'llmwiki:graph-subscribe'},location.origin)}catch(error){}
    return}
  if(typeof EventSource!=='function')return;
  const stream=new EventSource('/api/graph/events');
  stream.addEventListener('graph.revision',onGraphRevision);
  window.addEventListener('pagehide',()=>stream.close())}
`;
}
