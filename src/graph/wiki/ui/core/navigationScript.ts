export function graphUiNavigationScript(): string {
  return String.raw`
/*
 The breadcrumb has as many steps as the map has levels.

 It knew three — map, community, document — whereas navigation counts four
 since the registry is a tree. The "domain" level not appearing in it, one
 entered it without anything indicating it and without being able to leave
 except by returning to the map: the only return path skipped over the level
 one had just left.
*/
function graphDomainOf(id){
  if(!id)return null;
  if(graphIsDomain(id))return id;
  return (data?.communityParents||{})[id]||null}
function updateGraphBreadcrumb(){
  const trail=document.querySelector('#graph-breadcrumb');if(!trail)return;
  const parts=[{level:'map',label:'Map'}];
  const domainId=graphDomainOf(selectedCommunity);
  if(domainId&&view!=='map')parts.push({level:'domain',label:graphDomainDisplay(graphCommunityLabel(domainId))});
  if((view==='community'||view==='focus')&&selectedCommunity&&selectedCommunity!==domainId){
    parts.push({level:'community',label:graphLeafDisplay(graphCommunityLabel(selectedCommunity))})}
  if(view==='focus'&&selected)parts.push({level:'focus',label:selected.title});
  trail.innerHTML=parts.map((part,index)=>'<button type="button" data-graph-level="'+part.level+'"'+(index===parts.length-1?' aria-current="page"':'')+'>'+esc(part.label)+'</button>').join('<span>›</span>')
}
function navigateGraphLevel(level){
  if(level==='map'){view='map';selected=null;selectedCommunity=null;focusHistory.length=0}
  else if(level==='domain'){
    const domainId=graphDomainOf(selectedCommunity);
    // Without a parent domain — flat taxonomy — going back up one step
    // returns to the map, which is indeed the level above.
    if(domainId){view='domain';selected=null;selectedCommunity=domainId}
    else{view='map';selected=null;selectedCommunity=null;focusHistory.length=0}}
  else if(level==='community'&&selectedCommunity){view='community';selected=null}
  else if(level==='focus'&&selected){view='focus'}
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view==='explore'&&view!=='list'||button.dataset.view==='list'&&view==='list'));
  render()
}
document.querySelector('#graph-breadcrumb').addEventListener('click',event=>{const button=event.target.closest('[data-graph-level]');if(button)navigateGraphLevel(button.dataset.graphLevel)});
`;
}

