export function communityViewScript(): string {
  return String.raw`
function communityFilteredGraph(){
  return visible()
}
function communityInitialPosition(community,index,total,w,h){
  const saved=readCommunityPosition(community.id);if(saved)return saved;
  const columns=Math.max(1,Math.ceil(Math.sqrt(total*w/Math.max(h,1))));
  const rows=Math.ceil(total/columns),col=index%columns,row=Math.floor(index/columns);
  const position={x:(col+1)*w/(columns+1),y:(row+1)*h/(rows+1)};communityPositions.set(community.id,position);return position
}
function communityRadius(documentCount,expanded){
  if(!expanded)return 30+Math.min(30,Math.sqrt(documentCount)*7);
  return Math.max(88,Math.min(185,52+Math.sqrt(documentCount)*18))
}
function communityNodePoint(index,total,radius){
  if(total===1)return{x:0,y:8};
  const ring=Math.floor(Math.sqrt(index)),start=ring*ring,count=Math.max(6,(ring*2+1)*2),slot=index-start;
  const angle=Math.PI*2*slot/count-Math.PI/2,spread=Math.min(radius-28,28+ring*27);
  return{x:Math.cos(angle)*spread,y:Math.sin(angle)*spread}
}
function communityNodeImportant(node,externalIds){return node.type==='wiki'||externalIds.has(node.id)||node.degree>=4||selected?.id===node.id}
function communityMembers(community,nodeById){return community.nodeIds.map(id=>nodeById.get(id)).filter(Boolean).sort((a,b)=>b.degree-a.degree||a.id.localeCompare(b.id))}
function renderCommunityDocumentIndexes(communities,nodeById){
  const opened=communities.filter(community=>communityExpanded.has(community.id));if(!opened.length)return;
  const stack=document.createElement('div');stack.className='community-document-index-stack';
  opened.forEach(community=>{const members=communityMembers(community,nodeById),color=colors[data.communities.indexOf(community)%colors.length],panel=document.createElement('aside');panel.className='community-document-index';panel.style.setProperty('--community-color',color);panel.innerHTML='<h4>'+esc(community.label)+' · '+members.length+' documents</h4><div class="community-document-index-list">'+members.map((node,index)=>'<button data-doc="'+esc(node.id)+'" class="'+(selected?.id===node.id?'selected':'')+'" title="'+esc(node.id)+'"><span class="community-document-index-number" style="--color:'+color+'">'+(index+1)+'</span><span class="community-document-index-name">'+esc(node.title)+'</span></button>').join('')+'</div>';stack.appendChild(panel)});
  canvas.appendChild(stack)
}
function appendCommunityShape(group,node,color){
  const size=6+Math.min(7,Math.sqrt(node.degree||0)*1.8),shape=group.append(node.type==='wiki'?'circle':node.type==='deliverable'?'rect':'path').attr('class','community-v3-node-shape').attr('fill',node.type==='raw-source'?'none':color).attr('stroke',color);
  if(node.type==='wiki')shape.attr('r',size);
  else if(node.type==='wiki-source')shape.attr('d','M'+(-size)+','+(-size)+'h'+(size*2)+'v'+(size*2)+'h'+(-size*2)+'z');
  else if(node.type==='raw-source')shape.attr('d','M'+(-size)+','+(-size)+'h'+(size*2)+'v'+(size*2)+'h'+(-size*2)+'z').attr('stroke-width',2.5);
  else if(node.type==='template'||node.type==='build-context')shape.attr('d','M0,'+(-size*1.25)+'L'+(size*1.25)+',0L0,'+(size*1.25)+'L'+(-size*1.25)+',0Z');
  else shape.attr('x',-size*1.4).attr('y',-size*.75).attr('width',size*2.8).attr('height',size*1.5).attr('rx',2);
  shape.append('title').text(node.title+'\n'+node.type+' · '+node.community.communityLabel)
}
function renderCommunityView(){
  const graph=communityFilteredGraph();canvas.innerHTML='';
  const w=canvas.clientWidth||900,h=canvas.clientHeight||650,nodeById=new Map(graph.nodes.map(n=>[n.id,n]));
  let shown=data.communities.filter(c=>c.nodeIds.some(id=>nodeById.has(id)));
  if(isolatedCommunity)shown=shown.filter(c=>c.id===isolatedCommunity);
  if(!shown.length){canvas.innerHTML='<div class="loading">No community matches the active filters.</div>';return}
  const shownIds=new Set(shown.map(c=>c.id)),communityByNode=new Map;
  shown.forEach(c=>c.nodeIds.forEach(id=>{if(nodeById.has(id))communityByNode.set(id,c.id)}));
  const positions=new Map(shown.map((c,i)=>[c.id,communityInitialPosition(c,i,shown.length,w,h)]));
  const visibleCounts=new Map(shown.map(c=>[c.id,c.nodeIds.filter(id=>nodeById.has(id)).length])),radii=new Map(shown.map(c=>[c.id,communityRadius(visibleCounts.get(c.id),communityExpanded.has(c.id))]));
  const svg=d3.select(canvas).append('svg').attr('viewBox','0 0 '+w+' '+h),root=svg.append('g').attr('class','community-v3-root').attr('data-zoom-tier',isolatedCommunity?'near':'far').attr('transform',communityZoom);
  svg.call(d3.zoom().scaleExtent([.35,5]).on('zoom',event=>{communityZoom=event.transform;root.attr('transform',event.transform);root.attr('data-zoom-tier',isolatedCommunity?'near':event.transform.k<.8?'far':event.transform.k<1.65?'medium':'near')}));
  let aggregates=(data.communityEdges||[]).filter(e=>shownIds.has(e.from)&&shownIds.has(e.to));
  if(graph.nodes.length!==data.nodes.length){const filtered=new Map;graph.edges.forEach(e=>{const from=communityByNode.get(e.from),to=communityByNode.get(e.to);if(!from||!to||from===to)return;const key=JSON.stringify([from,to]),current=filtered.get(key)||{from,to,count:0,relations:{}};current.count++;current.relations[e.type]=(current.relations[e.type]||0)+1;filtered.set(key,current)});aggregates=[...filtered.values()]}
  const aggregateLayer=root.append('g'),aggregateGroups=aggregateLayer.selectAll('g').data(aggregates).join('g').attr('class','community-v3-edge');
  aggregateGroups.append('line').attr('stroke-width',e=>1+Math.sqrt(e.count));aggregateGroups.append('text').attr('class','community-v3-edge-count').text(e=>e.count);
  const renderedNodePositions=new Map,detailLayer=root.append('g'),communityLayer=root.append('g');
  const groups=communityLayer.selectAll('g').data(shown).join('g').attr('class',c=>'community-v3-envelope'+(communityExpanded.has(c.id)?' is-expanded':'')).attr('data-community-id',c=>c.id).attr('transform',c=>'translate('+positions.get(c.id).x+','+positions.get(c.id).y+')');
  groups.append('circle').attr('class','community-v3-halo').attr('r',c=>radii.get(c.id)).attr('fill',(c,i)=>colors[data.communities.indexOf(c)%colors.length]).attr('stroke',(c,i)=>colors[data.communities.indexOf(c)%colors.length]);
  groups.append('text').attr('class','community-v3-title').attr('y',c=>communityExpanded.has(c.id)?-radii.get(c.id)-10:4).text(c=>c.label);
  groups.append('text').attr('class','community-v3-count').attr('y',c=>communityExpanded.has(c.id)?-radii.get(c.id)+4:20).text(c=>visibleCounts.get(c.id)+' pages');
  const externalIds=new Set;graph.edges.forEach(e=>{if(communityByNode.get(e.from)!==communityByNode.get(e.to)||selected&&(e.from===selected.id||e.to===selected.id)){externalIds.add(e.from);externalIds.add(e.to)}});
  groups.filter(c=>communityExpanded.has(c.id)).each(function(c){
    const members=communityMembers(c,nodeById),radius=radii.get(c.id),local=new Map;
    members.forEach((node,index)=>{const point=communityNodePoint(index,members.length,radius);local.set(node.id,point);const center=positions.get(c.id);renderedNodePositions.set(node.id,{x:center.x+point.x,y:center.y+point.y})});
    const nodeGroups=d3.select(this).append('g').selectAll('g').data(members).join('g').attr('class',n=>'community-v3-node'+(selected?.id===n.id?' is-highlighted':'')).attr('transform',n=>'translate('+local.get(n.id).x+','+local.get(n.id).y+')').on('click',(event,node)=>{event.stopPropagation();selectDocument(node)});
    nodeGroups.each(function(node){appendCommunityShape(d3.select(this),node,colors[data.communities.indexOf(c)%colors.length])});
    nodeGroups.append('text').attr('class','community-v3-node-number').text((_,index)=>index+1);
    nodeGroups.call(d3.drag().subject((_,node)=>({...local.get(node.id)})).on('start',event=>event.sourceEvent?.stopPropagation()).on('drag',function(event,node){const limit=Math.max(12,radius-18),distance=Math.hypot(event.x,event.y)||1,scale=Math.min(1,limit/distance),point={x:event.x*scale,y:event.y*scale},center=positions.get(c.id);local.set(node.id,point);renderedNodePositions.set(node.id,{x:center.x+point.x,y:center.y+point.y});d3.select(this).attr('transform','translate('+point.x+','+point.y+')');detailLayer.selectAll('line').attr('x1',e=>renderedNodePositions.get(e.from).x).attr('y1',e=>renderedNodePositions.get(e.from).y).attr('x2',e=>renderedNodePositions.get(e.to).x).attr('y2',e=>renderedNodePositions.get(e.to).y)}));
  });
  const detailed=graph.edges.filter(e=>renderedNodePositions.has(e.from)&&renderedNodePositions.has(e.to)&&(selected?e.from===selected.id||e.to===selected.id:communityByNode.get(e.from)===communityByNode.get(e.to)));
  const relationColors={links_to:'#72a7e8',cites:'#9f7aea',generated_from:'#74c365',uses_template:'#e4b44c',uses_context:'#44c2c7',produces:'#ed7d4d',related_to:'#cf6fe4'};
  detailLayer.selectAll('line').data(detailed).join('line').attr('class',e=>'community-v3-detail-edge'+(selected&&(e.from===selected.id||e.to===selected.id)?' is-selected':'')).style('stroke',e=>relationColors[e.type]||'#93a9c2').attr('x1',e=>renderedNodePositions.get(e.from).x).attr('y1',e=>renderedNodePositions.get(e.from).y).attr('x2',e=>renderedNodePositions.get(e.to).x).attr('y2',e=>renderedNodePositions.get(e.to).y).append('title').text(e=>e.type.replaceAll('_',' ')+' : '+e.from+' → '+e.to);
  function updateAggregateGeometry(){aggregateGroups.select('line').attr('x1',e=>positions.get(e.from).x).attr('y1',e=>positions.get(e.from).y).attr('x2',e=>positions.get(e.to).x).attr('y2',e=>positions.get(e.to).y);aggregateGroups.select('text').attr('x',e=>(positions.get(e.from).x+positions.get(e.to).x)/2).attr('y',e=>(positions.get(e.from).y+positions.get(e.to).y)/2-6)}
  updateAggregateGeometry();
  let clickTimer=null;groups.on('click',(event,c)=>{event.stopPropagation();if(clickTimer)clearTimeout(clickTimer);clickTimer=setTimeout(()=>{const wasOpen=communityExpanded.has(c.id);if(!event.shiftKey)communityExpanded.clear();if(wasOpen)communityExpanded.delete(c.id);else communityExpanded.add(c.id);selectedCommunity=c.id;render()},180)}).on('dblclick',(event,c)=>{event.preventDefault();event.stopPropagation();if(clickTimer)clearTimeout(clickTimer);communityExpandedBeforeIsolation.clear();communityExpanded.forEach(id=>communityExpandedBeforeIsolation.add(id));isolatedCommunity=c.id;selected=null;communityZoom=d3.zoomIdentity;communityExpanded.clear();communityExpanded.add(c.id);selectedCommunity=c.id;render()});
  groups.call(d3.drag().on('start',function(){d3.select(this).raise()}).on('drag',function(event,c){const position={x:event.x,y:event.y},before=positions.get(c.id),dx=position.x-before.x,dy=position.y-before.y;positions.set(c.id,position);d3.select(this).attr('transform','translate('+position.x+','+position.y+')');renderedNodePositions.forEach((point,nodeId)=>{if(communityByNode.get(nodeId)===c.id){point.x+=dx;point.y+=dy}});detailLayer.selectAll('line').attr('x1',e=>renderedNodePositions.get(e.from).x).attr('y1',e=>renderedNodePositions.get(e.from).y).attr('x2',e=>renderedNodePositions.get(e.to).x).attr('y2',e=>renderedNodePositions.get(e.to).y);updateAggregateGeometry()}).on('end',(_,c)=>saveCommunityPosition(c.id,positions.get(c.id))));
  if(selected){const related=new Set([selected.id]);graph.edges.forEach(e=>{if(e.from===selected.id)related.add(e.to);if(e.to===selected.id)related.add(e.from)});groups.classed('is-dimmed',c=>!c.nodeIds.some(id=>related.has(id)));aggregateGroups.style('display','none');root.selectAll('.community-v3-node').classed('is-dimmed',n=>!related.has(n.id)).classed('is-highlighted',n=>n.id===selected.id)}
  addCommunityLegend();
  renderCommunityDocumentIndexes(shown,nodeById);
}
`;
}
