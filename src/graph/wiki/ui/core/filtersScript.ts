export function graphUiFiltersScript(): string {
  return String.raw`
function renderFilters(){const types={};data.nodes.forEach(n=>types[n.type]=(types[n.type]||0)+1);const defaults=new Set(['wiki']),groups=[['Foundation',['build-context','template']],['Wiki',['wiki','wiki-source','deliverable']],['Sources',['raw-source']]];document.querySelector('#filters').innerHTML=groups.map(([label,kinds])=>{const available=kinds.filter(k=>types[k]);if(!available.length)return'';return '<fieldset class="filter-group"><legend>'+label+'</legend>'+available.map(k=>'<label class="filter"><input type="checkbox" '+(defaults.has(k)?'checked ':'')+'data-type="'+k+'"><span>'+esc(k)+'</span><span class="muted">'+types[k]+'</span></label>').join('')+'</fieldset>'}).join('');document.querySelector('#community-list').innerHTML=renderCommunityIndex()}
/*
 The left index follows the tree, like the map.

 It listed the 33 leaves flat, side by side: the hierarchy existed in the
 registry and on the map, but the index kept denying that it exists. Two
 contradictory representations of the same corpus in the same window is worse
 than no hierarchy at all.

 Without a domain — deterministic taxonomy — we keep the original flat
 rendering.
*/
function communityDocsHtml(community){
  const enabled=enabledTypes(),typeById=graphNodeTypeById();
  return community.nodeIds.filter(id=>enabled.has(typeById.get(id))).map(id=>{const n=data.nodes.find(x=>x.id===id);return '<div class="community-doc-row"><button class="community-doc" data-doc="'+esc(id)+'" title="'+esc(id)+'">'+esc(n?.title||id)+'.md</button><button type="button" class="community-doc-action" data-preview-doc="'+esc(id)+'" title="Preview">'+graphIcon('preview')+'</button><button type="button" class="community-doc-action" data-send-doc="'+esc(id)+'" title="Add to Donna" aria-label="Add '+esc(n?.title||id)+' to Donna">'+graphIcon('donna')+'</button></div>'}).join('')}
function communityGroupHtml(community,index,extraClass){
  return '<details class="community-group'+(extraClass?' '+extraClass:'')+'"><summary data-community="'+esc(community.id)+'"><i class="dot" style="--color:'+colors[index%colors.length]+'"></i><span>'+esc(graphLeafDisplay(community.label))+'</span><b>'+community.documentCount+'</b></summary><div class="community-docs">'+communityDocsHtml(community)+'</div></details>'}
function renderCommunityIndex(){
  const domains=data.domains||[],parents=data.communityParents||{};
  if(!domains.length)return data.communities.map((c,i)=>communityGroupHtml(c,i)).join('');
  const byId=new Map(data.communities.map(item=>[item.id,item]));
  const orphans=data.communities.filter(item=>!parents[item.id]&&!domains.some(d=>d.id===item.id));
  return [
    ...domains.map((domain,index)=>{
      const children=data.communities.filter(item=>parents[item.id]===domain.id);
      const total=children.reduce((sum,item)=>sum+item.documentCount,0);
      return '<details class="community-group community-domain"><summary data-community="'+esc(domain.id)+'"><i class="dot" style="--color:'+colors[index%colors.length]+'"></i><span>'+esc(graphDomainDisplay(domain.label))+'</span><b>'+total+'</b></summary><div class="community-children">'
        +children.map((child,childIndex)=>communityGroupHtml(child,index+childIndex+1,'community-child')).join('')
        +'</div></details>'}),
    // A root without a child remains a leaf: it is shown at the same rank as
    // the domains, otherwise it would disappear from the index.
    ...orphans.map((item,index)=>communityGroupHtml(item,domains.length+index)),
  ].join('')}
/*
 The domain list is a navigation index, not a mirror of the view.

 It shrank to what the graph showed: as soon as one entered a domain, all the
 others disappeared from the column. The only way to look elsewhere was to go
 back up to the map — whereas this list is precisely the place where one
 already knows where one wants to go.

 It therefore stays complete and stable. Only the type filters make it vary,
 since they bear on what exists and not on what we are looking at; the current
 domain and document are marked there so one can find one's bearings.
*/
function updateCommunityFilterCounts(){
  const enabled=new Set([...document.querySelectorAll('[data-type]:checked')].map(input=>input.dataset.type));
  const typeById=new Map(data.nodes.map(node=>[node.id,node.type]));
  const kept=id=>enabled.has(typeById.get(id));
  document.querySelectorAll('.community-group').forEach(group=>{
    const summary=group.querySelector('[data-community]'),id=summary?.dataset.community;
    // A domain is not in "communities": looking for it there hid all the
    // domains, hence all their children, hence the whole index.
    const members=graphCommunityMembers(id).filter(kept);
    group.hidden=members.length===0;
    const counter=group.querySelector('summary b');if(counter)counter.textContent=String(members.length);
    summary?.classList.toggle('is-current',id===selectedCommunity);
    // The current domain opens on its own: we just entered it, its list is
    // what we want to read next.
    if(id===selectedCommunity&&!group.open)group.open=true;
    group.querySelectorAll('[data-doc]').forEach(item=>{
      item.hidden=!kept(item.dataset.doc);
      item.classList.toggle('selected',item.dataset.doc===selected?.id)})})}
/*
 A page's neighborhood is only the reading frame in focus view.

 The condition was about "a page is selected". Since a relation-less page
 selects itself without descending, that shrank the view of its domain to that
 single node: one clicked a document and the surrounding domain disappeared. It
 is the view level that decides the scope, not the presence of a selection.
*/
function visible(){const enabled=enabledTypes();let nodes=data.nodes.filter(n=>enabled.has(n.type));if(selected&&!nodes.some(n=>n.id===selected.id))nodes=[selected,...nodes];if(selected&&view==='focus'){const base=new Set([selected.id]),scope=new Set(base);data.edges.forEach(e=>{if(base.has(e.from))scope.add(e.to);if(base.has(e.to))scope.add(e.from)});nodes=nodes.filter(n=>scope.has(n.id))}else if(selectedCommunity&&view!=='map'){const base=new Set(graphCommunityMembers(selectedCommunity)),scope=new Set(base);data.edges.forEach(e=>{if(base.has(e.from))scope.add(e.to);if(base.has(e.to))scope.add(e.from)});nodes=nodes.filter(n=>scope.has(n.id))}const ids=new Set(nodes.map(n=>n.id));return{nodes:nodes.map(n=>({...n})),edges:data.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({...e}))}}
`;
}
