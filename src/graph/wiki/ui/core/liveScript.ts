/**
 * Transient visual state of the graph, and subscription to revisions.
 *
 * The graph is not *polled*: the old revision polling maintained permanent
 * network activity and replaced the whole Canvas scene over the course of a
 * long session. It is now *notified*, by an event stream, and reconciles its
 * scene in place — never a reload, never a remount.
 *
 * Two receive modes, a single stream opened per document:
 *
 * - **standalone** (`/graph` in its own tab): the document opens its own
 *   `EventSource`;
 * - **embedded** (shell iframe): the parent holds the connection and relays via
 *   `postMessage`. An `EventSource` per iframe would multiply the connections
 *   and the reconnection storms for one and the same stream.
 */
export function graphUiLiveScript(): string {
  return String.raw`
const GRAPH_FRESH_MS=14000;
/*
 Convergence of a merge.

 An absorbed bubble must not disappear all at once: the reader would see three
 domains evaporate without understanding where their pages went. It therefore
 glides toward its target before fading out, which narrates the merge instead
 of suffering it.

 The duration is short and bounded: it is an explanation, not a spectacle, and
 it must not delay reading the new map.
*/
const GRAPH_MERGE_MS=900;
// absorbed id → { to, since when }
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
  // Same defensive purge as for the halo: a bubble absorbed into a domain we
  // are not showing will never be queried, and its mere presence would keep
  // the animation loop active indefinitely.
  graphMerging.forEach((entry,id)=>{if(entry.at<=cutoff)graphMerging.delete(id)});
  return graphMerging.size>0}
// id → appearance instant. Used for the "new" halo, not for layout.
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
  // Some new nodes may be hidden by a filter or belong to a domain other than
  // the one displayed. graphNodeFreshness() will then never be called for them:
  // we must still purge them here, otherwise their mere presence keeps the
  // animation loop active indefinitely.
  graphFreshNodes.forEach((at,id)=>{if(at<=cutoff)graphFreshNodes.delete(id)});
  return graphFreshNodes.size>0}

/*
 Receiving revisions and anti-staleness guard.

 A single in-flight fetch at a time, and the last revision wins: without it,
 two responses sent in the order 41 then 42 can come back in the reverse order
 and the older one would overwrite the newer scene. It is the same concurrency
 problem as the runtime stream, and it is solved in the same place — at
 application, not at emission.
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
        // A response sent before a newer revision has no right to overwrite a
        // more up-to-date scene: we re-read rather than apply.
        if(next.taxonomyRevision<target)throw new Error('graph snapshot behind announced revision');
        applyGraphRevision(next);
        graphRevision=Math.max(target,next.taxonomyRevision||0);
        graphRetryDelay=1000}
    }catch(error){scheduleGraphRetry()}
    finally{graphFetching=false}})()}
/*
 Applies a snapshot in place.

 The new identifiers are recorded BEFORE the data changes: that is what feeds
 the "new" halo, until now implemented but never fed. No remount, no reload —
 render() goes through setScene, which preserves camera, framing and positions.
*/
function applyGraphRevision(next){
  const known=new Set((data&&data.nodes||[]).map(node=>node.id));
  const knownCommunities=new Set((data&&data.communities||[]).map(item=>item.id));
  // The bubbles we were showing AND that have just been absorbed: only they
  // have a convergence to play. A merge that happened before the page opened
  // has nothing to narrate.
  const redirects=next.communityRedirects||{};
  Object.keys(redirects).forEach(from=>{
    if(knownCommunities.has(from)&&redirects[from])graphMerging.set(from,{to:redirects[from],at:performance.now()})});
  data=next;
  // The concept grouping is the top-level communities; the server does not
  // ship it twice, so the browser restores the entry the combobox reads.
  data.groupings={...(data.groupings||{}),concept:{communities:data.communities,communityEdges:data.communityEdges}};
  // A revision replaces the snapshot whole: the grouping axis the reader chose
  // is a reading, not data, so it is re-applied on the fresh snapshot rather
  // than silently dropping back to the concept map.
  if(groupAxis!=='concept'){
    const grouping=data?.groupings?.[groupAxis];
    if(grouping){data.communities=grouping.communities;data.communityEdges=grouping.communityEdges}}
  // A merge moves the selection to the target rather than losing it, and
  // carries over the absorbed one's manual position.
  migrateCanvasExplorerPositions(next.communityRedirects);
  redirectGraphSelection(next.communityRedirects);
  // The next render comes from a revision, not from a gesture: it does not
  // reframe.
  canvasExplorer?.markDataRevision();
  seedCanvasExplorerSlots();
  next.nodes.forEach(node=>{if(!known.has(node.id))graphFreshNodes.set(node.id,performance.now())});
  next.communities.forEach(item=>{if(!knownCommunities.has(item.id))graphFreshNodes.set(item.id,performance.now())});
  renderFilters();renderSearchOptions();render()}
/*
 The selection follows the stable identifier across a merge.

 A selected community that has just been absorbed has not disappeared: it has a
 target. Leaving the selection pointing at a dead identifier would empty the
 panel and send the user back to the map without explanation, in the middle of
 their reading.
*/
function redirectGraphSelection(redirects){
  if(!redirects)return;
  const target=redirects[selectedCommunity];
  if(target)selectedCommunity=target;
  if(selected&&selected.community&&redirects[selected.community.communityId]){
    selected.community={...selected.community,communityId:redirects[selected.community.communityId]}}}
function startGraphRevisionFeed(){
  // Embedded: the parent holds the single connection and relays. Standalone: we
  // open our own. Never both.
  if(window.parent&&window.parent!==window){
    window.addEventListener('message',event=>{
      // The shell and the graph are served by the same process: any message
      // from another origin is foreign to the stream and has nothing to drive
      // here.
      if(event.origin!==location.origin)return;
      const payload=event.data;
      if(payload&&payload.type==='llmwiki:graph-revision')onGraphRevision(Number(payload.revision))});
    try{window.parent.postMessage({type:'llmwiki:graph-subscribe'},location.origin)}catch(error){}
    return}
  if(typeof EventSource!=='function')return;
  const stream=new EventSource('/api/graph/events');
  stream.addEventListener('graph.revision',event=>{
    try{onGraphRevision(Number(JSON.parse(event.data).revision))}catch(error){}});
  // No reconnection handling here: EventSource does it on its own, and the
  // server imposes its backoff via the retry field.
  window.addEventListener('pagehide',()=>{stream.close();if(graphRetryTimer)clearTimeout(graphRetryTimer)})}
`;
}
