/**
 * TAXO graph — data model in the browser.
 *
 * The server ships the corpus once (`/api/graph/taxo`): concepts with their
 * family, fiches, the concept→fiche citation links and the settled positions
 * of the three force-laid views. Everything else is derived here, the way the
 * TAXO prototype (`_tmp/taxo/graph.html`) derived it, so the four views read
 * one payload: co-citation between concepts, fiches shared between families,
 * family membership. A revision replaces the payload and re-derives.
 */
export function taxoStateScript(): string {
  return String.raw`
const PALETTE=['#4d9cff','#a75ee8','#34c4ca','#66bd4b','#f1b52f','#ed7550','#dc5277','#7895bb','#9d70b9'];
const colors=PALETTE;
const SRC_COLOR='#7895bb';
const FONT='"Geist",ui-sans-serif,system-ui,sans-serif';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function json(url,init){const r=await fetch(url,init?{...init,cache:'no-store'}:{cache:'no-store'});if(!r.ok)throw Error(await r.text());return r.json()}
let FAMS=[],base=[],byId=new Map(),bip=new Map(),concepts=[],sources=[];
let coLinks=[],coAdj=new Map(),famNodes=[],crossLinks=[],famAdj=new Map(),memberLinks=[],citeLinks=[],layout={family:{},concepts:{},full:{}};
const famColor=f=>PALETTE[Math.max(0,FAMS.indexOf(f))%PALETTE.length];
const colorOf=n=>n.type==='source'?SRC_COLOR:famColor(n.family);
let view='family',focusId=null,sel=null,hover=null;
// Search: the server answers with the pages it matched (hybrid retrieval); the
// browser only decides what of them each view can show.
let query='',searchHits=null,searchMode=null,searchError=null;
const active=new Set(['__src']);
function ingestTaxo(payload){
  FAMS=payload.families||[];
  base=(payload.nodes||[]).map(n=>({...n}));
  byId=new Map(base.map(n=>[n.id,n]));
  bip=new Map(base.map(n=>[n.id,new Set()]));
  (payload.links||[]).forEach(l=>{bip.get(l.source)?.add(l.target);bip.get(l.target)?.add(l.source)});
  base.forEach(n=>n.nsrc=bip.get(n.id).size);
  concepts=base.filter(n=>n.type==='concept');sources=base.filter(n=>n.type==='source');
  const shared=new Map();
  sources.forEach(s=>{const cs=[...bip.get(s.id)].sort();for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){const k=cs[i]+'|'+cs[j];if(!shared.has(k))shared.set(k,[]);shared.get(k).push(s.id)}});
  coLinks=[...shared].map(([k,srcs])=>{const[a,b]=k.split('|');return{source:a,target:b,w:srcs.length,srcs,kind:'co'}});
  coAdj=new Map(concepts.map(n=>[n.id,new Map()]));
  coLinks.forEach(l=>{coAdj.get(l.source).set(l.target,l);coAdj.get(l.target).set(l.source,l)});
  const famSources=new Map(FAMS.map(f=>[f,new Set()]));
  concepts.forEach(c=>bip.get(c.id).forEach(sid=>famSources.get(c.family)?.add(sid)));
  famNodes=FAMS.map(f=>({id:'f:'+f,type:'family',title:f,family:f,nsrc:famSources.get(f).size,count:concepts.filter(c=>c.family===f).length}));
  famNodes.forEach(f=>byId.set(f.id,f));
  crossLinks=[];
  for(let i=0;i<FAMS.length;i++)for(let j=i+1;j<FAMS.length;j++){const a=famSources.get(FAMS[i]),b=famSources.get(FAMS[j]);const srcs=[...a].filter(x=>b.has(x));if(srcs.length)crossLinks.push({source:'f:'+FAMS[i],target:'f:'+FAMS[j],w:srcs.length,srcs,kind:'cross'})}
  famAdj=new Map(famNodes.map(f=>[f.id,new Map()]));
  crossLinks.forEach(l=>{famAdj.get(l.source).set(l.target,l);famAdj.get(l.target).set(l.source,l)});
  memberLinks=concepts.map(c=>({source:c.id,target:'f:'+c.family,kind:'member'}));
  citeLinks=(payload.links||[]).map(l=>({source:l.source,target:l.target,kind:'cite'}));
  layout=payload.layout||{family:{},concepts:{},full:{}};
  // A family the reader never saw starts shown; one they hid stays hidden.
  FAMS.forEach(f=>{if(!knownFamilies.has(f)){knownFamilies.add(f);active.add(f)}});
  if(!focusId||!byId.has(focusId))focusId=[...concepts].sort((a,b)=>b.nsrc-a.nsrc)[0]?.id||null;
  if(sel&&!byId.has(sel))sel=null;
}
const knownFamilies=new Set();
const VIEW_TITLES={family:'Families',concepts:'Concepts',focus:'Concept focus',full:'Concepts + sources',provenance:'Provenance'};
function viewGraph(){
  if(view==='family')return{nodes:[...famNodes,...concepts],links:[...crossLinks,...memberLinks]};
  if(view==='concepts')return{nodes:concepts,links:coLinks};
  if(view==='full')return{nodes:base,links:citeLinks};
  return null}
// Provenance cards are not filtered by family or document: the view is one deliverable.
const visible=n=>n.prov?true:n.type==='source'?active.has('__src'):active.has(n.family);
`;
}
