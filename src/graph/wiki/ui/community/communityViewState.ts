export function communityViewStateScript(): string {
  return String.raw`
const communityExpanded=new Set;
const communityExpandedBeforeIsolation=new Set;
let isolatedCommunity=null;
let communityZoom=d3.zoomIdentity;
const communityPositions=new Map;
function communityPositionKey(id){return 'llm-wiki:graph:community:'+encodeURIComponent(data?.workspace||'wiki')+':'+id}
function readCommunityPosition(id){
  if(communityPositions.has(id))return communityPositions.get(id);
  try{
    const saved=JSON.parse(localStorage.getItem(communityPositionKey(id))||'null');
    if(saved?.topologyEtag===data?.topologyEtag&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)){
      const position={x:saved.x,y:saved.y};communityPositions.set(id,position);return position;
    }
  }catch{}
  return null;
}
function saveCommunityPosition(id,position){
  communityPositions.set(id,position);
  localStorage.setItem(communityPositionKey(id),JSON.stringify({...position,topologyEtag:data.topologyEtag}));
}
function resetCommunityViewState(){communityExpanded.clear();communityExpandedBeforeIsolation.clear();isolatedCommunity=null;communityZoom=d3.zoomIdentity}
function openCommunityForDocument(id){
  const community=data?.communities?.find(c=>c.nodeIds.includes(id));
  if(!community)return;
  communityExpanded.clear();communityExpanded.add(community.id);
  data.edges.forEach(edge=>{
    if(edge.from!==id&&edge.to!==id)return;
    const neighborId=edge.from===id?edge.to:edge.from,neighborCommunity=data.communities.find(c=>c.nodeIds.includes(neighborId));
    if(neighborCommunity)communityExpanded.add(neighborCommunity.id);
  });
  selectedCommunity=community.id;
}
function leaveCommunityIsolation(){
  isolatedCommunity=null;selected=null;selectedCommunity=null;communityZoom=d3.zoomIdentity;
  communityExpanded.clear();communityExpandedBeforeIsolation.forEach(id=>communityExpanded.add(id));communityExpandedBeforeIsolation.clear();
  focusHistory.length=0;inspector.innerHTML='<h3>Selection</h3><p>Select a community or document to explore its relations.</p>';render()
}
`;
}
