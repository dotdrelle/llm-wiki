export function graphUiNavigationScript(): string {
  return String.raw`
/*
 Le fil d'Ariane a autant de crans que la carte a de niveaux.

 Il en connaissait trois — carte, communauté, document — alors que la
 navigation en compte quatre depuis que le registre est un arbre. Le niveau
 « domaine » n'y apparaissant pas, on y entrait sans que rien ne l'indique et
 sans pouvoir en ressortir autrement qu'en retournant à la carte : le seul
 chemin de retour sautait par-dessus le niveau qu'on venait de quitter.
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
    // Sans domaine parent — taxonomie plate — remonter d'un cran ramène à la
    // carte, qui est bien le niveau au-dessus.
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

