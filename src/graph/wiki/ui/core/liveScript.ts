/**
 * État visuel transitoire du graphe.
 *
 * Le graphe n'est plus surveillé périodiquement : dans l'iframe de Donna, le
 * polling de la révision maintenait une activité réseau et pouvait remplacer
 * toute la scène Canvas pendant une longue session. Les données sont chargées
 * une fois à l'ouverture ; une navigation ou un rechargement explicite les
 * reprend depuis le serveur.
 */
export function graphUiLiveScript(): string {
  return String.raw`
const GRAPH_FRESH_MS=14000;
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
`;
}
