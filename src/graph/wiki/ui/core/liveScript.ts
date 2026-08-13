/**
 * État visuel transitoire du graphe, et abonnement aux révisions.
 *
 * Le graphe n'est pas *sondé* : l'ancien polling de la révision entretenait une
 * activité réseau permanente et remplaçait toute la scène Canvas au fil d'une
 * longue session. Il est désormais *notifié*, par un flux d'événements, et
 * réconcilie sa scène en place — jamais un rechargement, jamais un remontage.
 *
 * Deux modes de réception, un seul flux ouvert par document :
 *
 * - **autonome** (`/graph` dans son propre onglet) : le document ouvre lui-même
 *   son `EventSource` ;
 * - **embarqué** (iframe du shell) : le parent tient la connexion et relaie par
 *   `postMessage`. Une `EventSource` par iframe multiplierait les connexions et
 *   les tempêtes de reconnexion pour un seul et même flux.
 */
export function graphUiLiveScript(): string {
  return String.raw`
const GRAPH_FRESH_MS=14000;
/*
 Convergence d'une fusion.

 Une bulle absorbée ne doit pas disparaître d'un coup : le lecteur verrait
 trois domaines s'évaporer sans comprendre où sont passées leurs pages. Elle
 glisse donc vers sa cible avant de s'effacer, ce qui raconte la fusion au lieu
 de la subir.

 La durée est courte et bornée : c'est une explication, pas un spectacle, et
 elle ne doit pas retarder la lecture de la carte nouvelle.
*/
const GRAPH_MERGE_MS=900;
// id absorbé → { vers, depuis quand }
const graphMerging=new Map();
function graphMergeProgress(id){
  const entry=graphMerging.get(id);
  if(entry===undefined)return 0;
  const age=performance.now()-entry.at;
  if(age>=GRAPH_MERGE_MS){graphMerging.delete(id);return 0}
  return 1-age/GRAPH_MERGE_MS}
function hasGraphMerges(){
  if(!graphMerging.size)return false;
  const cutoff=performance.now()-GRAPH_MERGE_MS;
  // Même purge défensive que pour le halo : une bulle absorbée dans un domaine
  // qu'on n'affiche pas ne sera jamais interrogée, et sa seule présence
  // maintiendrait la boucle d'animation active indéfiniment.
  graphMerging.forEach((entry,id)=>{if(entry.at<=cutoff)graphMerging.delete(id)});
  return graphMerging.size>0}
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

/*
 Réception des révisions et garde anti-obsolescence.

 Une seule récupération en vol à la fois, et la dernière révision gagne : sans
 cela, deux réponses parties dans l'ordre 41 puis 42 peuvent revenir dans
 l'ordre inverse et la plus ancienne écraserait la scène la plus récente. C'est
 le même problème de concurrence que le flux du runtime, et il se règle au même
 endroit — à l'application, pas à l'émission.
*/
let graphRevision=0,graphFetching=false,graphWanted=0,graphRetryTimer=0,graphRetryDelay=1000;
function scheduleGraphRetry(){
  if(graphRetryTimer||graphWanted<=graphRevision)return;
  graphRetryTimer=setTimeout(()=>{
    graphRetryTimer=0;
    if(graphWanted>graphRevision)onGraphRevision(graphWanted)},graphRetryDelay);
  graphRetryDelay=Math.min(graphRetryDelay*2,10000)}
function onGraphRevision(revision){
  if(!Number.isFinite(revision)||revision<=graphRevision)return;
  graphWanted=Math.max(graphWanted,revision);
  if(graphFetching)return;
  graphFetching=true;
  (async()=>{
    try{
      while(graphWanted>graphRevision){
        const target=graphWanted;
        const next=await json('/api/graph/overview');
        // Une réponse partie avant une révision plus récente n'a pas le droit
        // d'écraser une scène plus à jour : on relit plutôt que d'appliquer.
        if(next.taxonomyRevision<target)throw new Error('graph snapshot behind announced revision');
        applyGraphRevision(next);
        graphRevision=Math.max(target,next.taxonomyRevision||0);
        graphRetryDelay=1000}
    }catch(error){scheduleGraphRetry()}
    finally{graphFetching=false}})()}
/*
 Applique un snapshot en place.

 Les nouveaux identifiants sont relevés AVANT que les données ne changent :
 c'est ce qui alimente le halo « nouveau », jusqu'ici implémenté mais jamais
 nourri. Aucun remontage, aucun rechargement — render() passe par setScene, qui
 conserve caméra, cadrage et positions.
*/
function applyGraphRevision(next){
  const known=new Set((data&&data.nodes||[]).map(node=>node.id));
  const knownCommunities=new Set((data&&data.communities||[]).map(item=>item.id));
  // Les bulles qu'on affichait ET qui viennent d'être absorbées : elles seules
  // ont une convergence à jouer. Une fusion survenue avant l'ouverture de la
  // page n'a rien à raconter.
  const redirects=next.communityRedirects||{};
  Object.keys(redirects).forEach(from=>{
    if(knownCommunities.has(from)&&redirects[from])graphMerging.set(from,{to:redirects[from],at:performance.now()})});
  data=next;
  // Une fusion déplace la sélection sur la cible plutôt que de la perdre, et
  // reporte la position manuelle de l'absorbé.
  migrateCanvasExplorerPositions(next.communityRedirects);
  redirectGraphSelection(next.communityRedirects);
  // Le prochain rendu vient d'une révision, pas d'un geste : il ne recadre pas.
  canvasExplorer?.markDataRevision();
  seedCanvasExplorerSlots();
  next.nodes.forEach(node=>{if(!known.has(node.id))graphFreshNodes.set(node.id,performance.now())});
  next.communities.forEach(item=>{if(!knownCommunities.has(item.id))graphFreshNodes.set(item.id,performance.now())});
  renderFilters();renderSearchOptions();render()}
/*
 La sélection suit l'identifiant stable à travers une fusion.

 Une communauté sélectionnée qui vient d'être absorbée n'a pas disparu : elle a
 une cible. Laisser la sélection pointer un identifiant mort viderait le
 panneau et renverrait l'utilisateur à la carte sans explication, au milieu de
 sa lecture.
*/
function redirectGraphSelection(redirects){
  if(!redirects)return;
  const target=redirects[selectedCommunity];
  if(target)selectedCommunity=target;
  if(selected&&selected.community&&redirects[selected.community.communityId]){
    selected.community={...selected.community,communityId:redirects[selected.community.communityId]}}}
function startGraphRevisionFeed(){
  // Embarqué : le parent tient l'unique connexion et relaie. Autonome : on
  // ouvre la nôtre. Jamais les deux.
  if(window.parent&&window.parent!==window){
    window.addEventListener('message',event=>{
      // Le shell et le graphe sont servis par le même processus : tout message
      // d'une autre origine est étranger au flux et n'a rien à piloter ici.
      if(event.origin!==location.origin)return;
      const payload=event.data;
      if(payload&&payload.type==='llmwiki:graph-revision')onGraphRevision(Number(payload.revision))});
    try{window.parent.postMessage({type:'llmwiki:graph-subscribe'},location.origin)}catch(error){}
    return}
  if(typeof EventSource!=='function')return;
  const stream=new EventSource('/api/graph/events');
  stream.addEventListener('graph.revision',event=>{
    try{onGraphRevision(Number(JSON.parse(event.data).revision))}catch(error){}});
  // Pas de gestion de reconnexion ici : EventSource la fait seul, et le
  // serveur impose son backoff par le champ retry.
  window.addEventListener('pagehide',()=>{stream.close();if(graphRetryTimer)clearTimeout(graphRetryTimer)})}
`;
}
