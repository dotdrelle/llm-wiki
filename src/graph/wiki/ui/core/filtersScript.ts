export function graphUiFiltersScript(): string {
  return String.raw`
function renderFilters(){const types={};data.nodes.forEach(n=>types[n.type]=(types[n.type]||0)+1);const defaults=new Set(['wiki','wiki-source','deliverable']),groups=[['Foundation',['build-context','template']],['Wiki',['wiki','wiki-source','deliverable']],['Sources',['raw-source']]];document.querySelector('#filters').innerHTML=groups.map(([label,kinds])=>{const available=kinds.filter(k=>types[k]);if(!available.length)return'';return '<fieldset class="filter-group"><legend>'+label+'</legend>'+available.map(k=>'<label class="filter"><input type="checkbox" '+(defaults.has(k)?'checked ':'')+'data-type="'+k+'"><span>'+esc(k)+'</span><span class="muted">'+types[k]+'</span></label>').join('')+'</fieldset>'}).join('');document.querySelector('#community-list').innerHTML=renderCommunityIndex()}
/*
 L'index de gauche suit l'arborescence, comme la carte.

 Il listait les 33 feuilles à plat, côte à côte : la hiérarchie existait dans le
 registre et sur la carte, mais l'index continuait de nier qu'elle existe. Deux
 représentations contradictoires du même corpus dans la même fenêtre, c'est pire
 que pas de hiérarchie du tout.

 Sans domaine — taxonomie déterministe — on garde le rendu plat d'origine.
*/
function communityDocsHtml(community){
  return community.nodeIds.map(id=>{const n=data.nodes.find(x=>x.id===id);return '<div class="community-doc-row"><button class="community-doc" data-doc="'+esc(id)+'" title="'+esc(id)+'">'+esc(n?.title||id)+'.md</button><button type="button" class="community-doc-action" data-preview-doc="'+esc(id)+'" title="Preview">'+graphIcon('preview')+'</button><button type="button" class="community-doc-action" data-send-doc="'+esc(id)+'" title="Send to Donna">'+graphIcon('donna')+'</button></div>'}).join('')}
function communityGroupHtml(community,index,extraClass){
  return '<details class="community-group'+(extraClass?' '+extraClass:'')+'"><summary data-community="'+esc(community.id)+'"><i class="dot" style="--color:'+colors[index%colors.length]+'"></i><span>'+esc(community.label)+'</span><b>'+community.documentCount+'</b></summary><div class="community-docs">'+communityDocsHtml(community)+'</div></details>'}
function renderCommunityIndex(){
  const domains=data.domains||[],parents=data.communityParents||{};
  if(!domains.length)return data.communities.map((c,i)=>communityGroupHtml(c,i)).join('');
  const byId=new Map(data.communities.map(item=>[item.id,item]));
  const orphans=data.communities.filter(item=>!parents[item.id]&&!domains.some(d=>d.id===item.id));
  return [
    ...domains.map((domain,index)=>{
      const children=data.communities.filter(item=>parents[item.id]===domain.id);
      const total=children.reduce((sum,item)=>sum+item.documentCount,0);
      return '<details class="community-group community-domain"><summary data-community="'+esc(domain.id)+'"><i class="dot" style="--color:'+colors[index%colors.length]+'"></i><span>'+esc(domain.label)+'</span><b>'+total+'</b></summary><div class="community-children">'
        +children.map((child,childIndex)=>communityGroupHtml(child,index+childIndex+1,'community-child')).join('')
        +'</div></details>'}),
    // Une racine sans enfant reste une feuille : elle s'affiche au même rang
    // que les domaines, sans quoi elle disparaîtrait de l'index.
    ...orphans.map((item,index)=>communityGroupHtml(item,domains.length+index)),
  ].join('')}
/*
 La liste des domaines est un index de navigation, pas un miroir de la vue.

 Elle se réduisait à ce que le graphe affichait : dès qu'on entrait dans un
 domaine, tous les autres disparaissaient de la colonne. Le seul moyen d'aller
 voir ailleurs était de remonter à la carte — alors que cette liste est
 précisément l'endroit où l'on sait déjà où l'on veut aller.

 Elle reste donc complète et stable. Seuls les filtres par type la font varier,
 puisqu'ils portent sur ce qui existe et non sur ce qu'on regarde ; le domaine
 et le document courants y sont marqués pour qu'on se repère.
*/
function updateCommunityFilterCounts(){
  const enabled=new Set([...document.querySelectorAll('[data-type]:checked')].map(input=>input.dataset.type));
  const typeById=new Map(data.nodes.map(node=>[node.id,node.type]));
  const kept=id=>enabled.has(typeById.get(id));
  document.querySelectorAll('.community-group').forEach(group=>{
    const summary=group.querySelector('[data-community]'),id=summary?.dataset.community;
    // Un domaine n'est pas dans « communities » : le chercher là masquait tous
    // les domaines, donc toutes leurs filles, donc l'index entier.
    const members=graphCommunityMembers(id).filter(kept);
    group.hidden=members.length===0;
    const counter=group.querySelector('summary b');if(counter)counter.textContent=String(members.length);
    summary?.classList.toggle('is-current',id===selectedCommunity);
    // Le domaine courant s'ouvre de lui-même : on vient d'y entrer, sa liste
    // est ce qu'on cherche à lire ensuite.
    if(id===selectedCommunity&&!group.open)group.open=true;
    group.querySelectorAll('[data-doc]').forEach(item=>{
      item.hidden=!kept(item.dataset.doc);
      item.classList.toggle('selected',item.dataset.doc===selected?.id)})})}
/*
 Le voisinage d'une page n'est le cadre de lecture que dans la vue focus.

 La condition portait sur « une page est sélectionnée ». Depuis qu'une page
 sans relation se sélectionne sans descendre, cela réduisait la vue de son
 domaine à ce seul nœud : on cliquait sur un document et le domaine autour
 disparaissait. C'est le niveau de vue qui décide du périmètre, pas la
 présence d'une sélection.
*/
function visible(){const enabled=new Set([...document.querySelectorAll('[data-type]:checked')].map(x=>x.dataset.type));let nodes=data.nodes.filter(n=>enabled.has(n.type));if(selected&&view==='focus'){const base=new Set([selected.id]),scope=new Set(base);data.edges.forEach(e=>{if(base.has(e.from))scope.add(e.to);if(base.has(e.to))scope.add(e.from)});nodes=nodes.filter(n=>scope.has(n.id))}else if(selectedCommunity&&view!=='map'){const base=new Set(graphCommunityMembers(selectedCommunity)),scope=new Set(base);data.edges.forEach(e=>{if(base.has(e.from))scope.add(e.to);if(base.has(e.to))scope.add(e.from)});nodes=nodes.filter(n=>scope.has(n.id))}const ids=new Set(nodes.map(n=>n.id));return{nodes:nodes.map(n=>({...n})),edges:data.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({...e}))}}
`;
}
