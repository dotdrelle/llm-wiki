/**
 * Suivi en direct de la snapshot du wiki.
 *
 * Le graphe était chargé une fois au démarrage et plus jamais ensuite :
 * pendant un ingest, les documents arrivaient dans le wiki sans que rien ne
 * bouge à l'écran, et il fallait recharger la page pour les voir. La route
 * `/api/graph/etag` existait déjà pour ce cas — personne ne la consommait.
 *
 * On l'interroge donc périodiquement et on ne retélécharge la snapshot
 * complète que lorsque l'empreinte change. Le rafraîchissement doit être
 * invisible : filtres, domaines dépliés, position de lecture et cadrage sont
 * conservés, et seuls les nœuds réellement nouveaux se signalent.
 */
export function graphUiLiveScript(): string {
  return String.raw`
const GRAPH_LIVE_INTERVAL_MS=4000;
const GRAPH_FRESH_MS=14000;
let graphRevision=null,graphLiveTimer=null,graphLiveBusy=false;
// id → instant d'apparition. Sert au halo « nouveau », pas à la disposition.
const graphFreshNodes=new Map();
function graphNodeFreshness(id){
  const at=graphFreshNodes.get(id);
  if(at===undefined)return 0;
  const age=performance.now()-at;
  if(age>=GRAPH_FRESH_MS){graphFreshNodes.delete(id);return 0}
  return 1-age/GRAPH_FRESH_MS}
function hasFreshGraphNodes(){
  if(!graphFreshNodes.size)return false;
  const cutoff=performance.now()-GRAPH_FRESH_MS;
  // Certains nouveaux nœuds peuvent être masqués par un filtre ou appartenir
  // à un autre domaine que celui affiché. graphNodeFreshness() ne sera alors
  // jamais appelée pour eux : on doit tout de même les purger ici, sinon leur
  // seule présence maintient la boucle d'animation active indéfiniment.
  graphFreshNodes.forEach((at,id)=>{if(at<=cutoff)graphFreshNodes.delete(id)});
  return graphFreshNodes.size>0}
function graphRevisionOf(source){return String(source?.structureEtag||'')+'|'+String(source?.topologyEtag||'')}
/*
 Le rafraîchissement ne doit rien coûter au lecteur.

 renderFilters() reconstruit la colonne de gauche à partir des valeurs par
 défaut : appelé tel quel toutes les quelques secondes, il aurait recoché les
 types décochés, refermé les domaines dépliés et renvoyé la liste en haut.
 On relève donc l'état de la colonne avant, on le repose après — en laissant
 aux types qui n'existaient pas encore leur case par défaut, puisque le
 lecteur ne s'est jamais prononcé à leur sujet.
*/
function captureGraphUiState(){
  const inputs=[...document.querySelectorAll('[data-type]')];
  return{
    knownTypes:inputs.map(input=>input.dataset.type),
    checkedTypes:inputs.filter(input=>input.checked).map(input=>input.dataset.type),
    openCommunities:[...document.querySelectorAll('.community-group[open] [data-community]')].map(summary=>summary.dataset.community),
    listTop:document.querySelector('#community-list')?.scrollTop||0}}
function restoreGraphUiState(snapshot){
  if(!snapshot)return;
  const known=new Set(snapshot.knownTypes),checked=new Set(snapshot.checkedTypes);
  document.querySelectorAll('[data-type]').forEach(input=>{
    if(known.has(input.dataset.type))input.checked=checked.has(input.dataset.type)});
  const open=new Set(snapshot.openCommunities);
  document.querySelectorAll('.community-group').forEach(group=>{
    const id=group.querySelector('[data-community]')?.dataset.community;
    if(id)group.open=open.has(id)});
  const list=document.querySelector('#community-list');
  if(list)list.scrollTop=snapshot.listTop}
async function refreshGraphData(){
  const next=await json('/api/graph/overview');
  const previous=new Set((data?.nodes||[]).map(node=>node.id));
  const now=performance.now();
  // Au tout premier chargement, aucun nœud n'est « nouveau » : tout le graphe
  // clignoterait.
  if(previous.size)next.nodes.forEach(node=>{if(!previous.has(node.id))graphFreshNodes.set(node.id,now)});
  const uiState=captureGraphUiState();
  data=next;
  graphRevision=graphRevisionOf(next);
  seedCanvasExplorerSlots();
  renderFilters();
  restoreGraphUiState(uiState);
  renderSearchOptions(document.querySelector('#search')?.value||'');
  // Une sélection portant sur une entité disparue laisserait une vue vide sans
  // que rien n'explique pourquoi : on remonte d'un cran.
  if(selected&&!data.nodes.some(node=>node.id===selected.id)){selected=null;if(view==='focus')view=selectedCommunity?'community':'map'}
  if(selectedCommunity&&!data.communities.some(item=>item.id===selectedCommunity)){selectedCommunity=null;if(view!=='list')view='map'}
  render()}
async function pollGraphRevision(){
  if(graphLiveBusy||document.hidden||!data)return;
  graphLiveBusy=true;
  try{
    const head=await json('/api/graph/etag');
    const revision=graphRevisionOf(head);
    if(!graphRevision)graphRevision=revision;
    else if(revision!==graphRevision)await refreshGraphData();
  }catch{
    // Un serveur momentanément indisponible (reconstruction en cours) n'a pas
    // à faire remonter d'erreur : la prochaine passe retentera.
  }finally{graphLiveBusy=false}}
function startGraphLiveWatch(){
  if(graphLiveTimer)return;
  graphRevision=graphRevisionOf(data);
  graphLiveTimer=setInterval(pollGraphRevision,GRAPH_LIVE_INTERVAL_MS);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollGraphRevision()})}
`;
}
