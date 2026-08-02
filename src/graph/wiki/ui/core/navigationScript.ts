export function graphUiNavigationScript(): string {
  return String.raw`
function updateGraphBreadcrumb(){
  const trail=document.querySelector('#graph-breadcrumb');if(!trail)return;
  const community=selectedCommunity?data?.communities?.find(item=>item.id===selectedCommunity):null;
  const parts=[{level:'map',label:'Map'}];
  if(view==='community'||view==='focus')parts.push({level:'community',label:community?.label||'Community'});
  if(view==='focus'&&selected)parts.push({level:'focus',label:selected.title});
  trail.innerHTML=parts.map((part,index)=>'<button type="button" data-graph-level="'+part.level+'"'+(index===parts.length-1?' aria-current="page"':'')+'>'+esc(part.label)+'</button>').join('<span>›</span>')
}
function navigateGraphLevel(level){
  if(level==='map'){view='map';selected=null;selectedCommunity=null;focusHistory.length=0}
  else if(level==='community'&&selectedCommunity){view='community';selected=null}
  else if(level==='focus'&&selected){view='focus'}
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view==='explore'&&view!=='list'||button.dataset.view==='list'&&view==='list'));
  render()
}
document.querySelector('#graph-breadcrumb').addEventListener('click',event=>{const button=event.target.closest('[data-graph-level]');if(button)navigateGraphLevel(button.dataset.graphLevel)});
`;
}

