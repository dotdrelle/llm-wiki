import { graphForceScript } from '../../graph/core/graphForce.ts';

// Run/Task graph (0.10.2). Node/link SVG mechanics come from graph/core's
// shared D3 socle (graphForce.ts) — this file supplies the runtime workflow
// projection, a laned/layered DAG layout (Run / Tasks / Agents / Outputs
// bands; tasks layered left→right by topological depth over depends_on and
// wrapped into sub-columns), repeated-satellite aggregation (N identical
// activities/approvals on one anchor collapse into a single counted bubble),
// and its own minimal inspector, per plan directeur §9.1 (no toolbar/search/
// relation-modal chrome like the wiki graph).
export const RUNTIME_GRAPH_SCRIPT = `/* ── Runtime Graph ─────────────────────────────────────────────────── */
${graphForceScript()}
const runtimeWorkflowNodePositions=new Map();
let runtimeWorkflowZoomTransform=null;
let runtimeWorkflowZoomBehavior=null;
let runtimeWorkflowUserSelected=false;
let runtimeWorkflowLanes=[];
function runtimeWorkflowGraphHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-shell">\${runtimeWorkflowGraphCenterHTML()}<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside></div>\`;
}
function runtimeWorkflowGraphCenterHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-main"><div class="runtime-graph-toolbar"><span>Run/Task graph</span><span><button type="button" onclick="zoomRuntimeWorkflowGraph(.8)" title="Zoom out" aria-label="Zoom out">−</button><button type="button" onclick="zoomRuntimeWorkflowGraph(1.25)" title="Zoom in" aria-label="Zoom in">+</button><button type="button" onclick="fitRuntimeWorkflowGraph()">Fit</button><button type="button" onclick="resetRuntimeWorkflowGraph()">Reset</button></span></div><div class="runtime-graph-legend"><b>Lines</b><span><i class="depends_on"></i>Depends on</span><span><i class="executed_by"></i>Executed by</span><span><i class="produces"></i>Produces</span><span><i class="related_to"></i>Related</span><b>Bubbles</b><span><i class="bubble running"></i>Running / task</span><span><i class="bubble done"></i>Done</span><span><i class="bubble failed"></i>Failed</span><span><i class="bubble approval"></i>Approval / queue</span><span><i class="bubble run"></i>Run</span><span><i class="bubble activity"></i>Activity</span><span><i class="bubble neutral"></i>Other / cancelled</span></div><svg class="runtime-graph-svg" id="runtime-graph-svg" viewBox="0 0 760 620" aria-label="Runtime workflow graph"></svg></div>\`;
}
function runtimeWorkflowInspectorHTML() {
  return '<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside>';
}
// Collapse repeated satellites: when 3+ non-core nodes of the same type and
// status hang off the same anchor (the 40 "plan mutates" approvals of one
// revision, the activity spam of one task), replace them with one aggregate
// bubble labelled "N × type". Members stay listed in the inspector; their
// relations are rewired to the aggregate and deduped.
function aggregateRuntimeWorkflowNodes(nodes,relations) {
  const coreTypes=new Set(['run','task','queue','executor','output']);
  const buckets=new Map();
  nodes.forEach(node=>{
    if(coreTypes.has(node.type)) return;
    const rel=relations.find(item=>item.from===node.id||item.to===node.id);
    if(!rel) return;
    const anchor=rel.from===node.id?rel.to:rel.from;
    const key=anchor+'|'+node.type+'|'+node.status;
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(node);
  });
  const replaced=new Map();
  const aggregates=[];
  for(const [key,members] of buckets){
    if(members.length<3) continue;
    const type=key.split('|')[1];
    const status=key.split('|')[2];
    const id='agg:'+key;
    aggregates.push({id,label:members.length+' × '+type,type,status,members:members.map(member=>({id:member.id,label:member.label,status:member.status}))});
    members.forEach(member=>replaced.set(member.id,id));
  }
  if(!replaced.size) return {nodes,relations};
  const outNodes=nodes.filter(node=>!replaced.has(node.id)).concat(aggregates);
  const seen=new Set();
  const outRelations=[];
  relations.forEach(rel=>{
    const from=replaced.get(rel.from)||rel.from;
    const to=replaced.get(rel.to)||rel.to;
    if(from===to) return;
    const dedupe=rel.type+'|'+from+'|'+to;
    if(seen.has(dedupe)) return;
    seen.add(dedupe);
    outRelations.push({...rel,from,to});
  });
  return {nodes:outNodes,relations:outRelations};
}
function runtimeWorkflowGraphData() {
  const workflow=runtimeState?.workflow||{};
  const graph=workflow.graph||{};
  const sourceNodes=Array.isArray(graph.visibleNodes)&&graph.visibleNodes.length?graph.visibleNodes:workflow.nodes;
  const sourceRelations=Array.isArray(graph.visibleEdges)&&graph.visibleEdges.length?graph.visibleEdges:workflow.relations;
  let nodes=(Array.isArray(sourceNodes)?sourceNodes:[]).map((node,index)=>({
    ...node,
    id:String(node.id||node.key||node.itemId||'node-'+index),
    label:String(node.label||node.description||node.id||'Node'),
    type:String(node.type||'node'),
    status:String(node.status||'pending'),
  }));
  let nodeIds=new Set(nodes.map(node=>node.id));
  let relations=(Array.isArray(sourceRelations)?sourceRelations:[])
    .map((rel,index)=>({id:String(rel.id||'runtime-rel-'+index),type:String(rel.type||'related_to'),from:String(rel.from||rel.source||''),to:String(rel.to||rel.target||'')}))
    .filter(rel=>nodeIds.has(rel.from)&&nodeIds.has(rel.to));
  ({nodes,relations}=aggregateRuntimeWorkflowNodes(nodes,relations));
  nodeIds=new Set(nodes.map(node=>node.id));
  if(!selectedWorkflowNodeId||!nodeIds.has(selectedWorkflowNodeId)) selectedWorkflowNodeId=workflow.current?.id&&nodeIds.has(workflow.current.id)?workflow.current.id:nodes[0]?.id||null;
  return {nodes,relations};
}
function runtimeWorkflowColor(node) {
  if(node.status==='failed') return '#f06b6b';
  if(node.status==='cancelled') return 'color-mix(in srgb,var(--muted) 42%,var(--panel))';
  if(node.status==='done') return '#22c55e';
  if(node.status==='running') return '#4f7eff';
  if(node.status==='pending_approval') return '#f59e0b';
  const byType={run:'#8b5cf6',task:'#4f7eff',activity:'#14b8a6',executor:'color-mix(in srgb,var(--muted) 42%,var(--panel))',queue:'#f59e0b',approval:'#f97316',replan:'#a855f7',output:'#16a34a'};
  return byType[node.type]||'color-mix(in srgb,var(--muted) 36%,var(--panel))';
}
// Laned DAG layout. Horizontal bands top→bottom: Run, Tasks, Agents
// (executors), Outputs. Tasks are layered left→right by topological depth
// over depends_on (a task always sits right of its prerequisites) and each
// level wraps into sub-columns of at most 8 rows so 30 parallel tasks form a
// compact block instead of a 30-row spike. Remaining nodes (activities,
// approvals, aggregates…) fan out next to the first placed node they relate
// to; unanchored leftovers park in a bottom grid. Returns the lane labels so
// the renderer can draw band titles.
function computeRuntimeWorkflowLayeredLayout(nodes,relations) {
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const colW=170,rowH=72,left=90,maxRows=8;
  const lanes=[];
  const runs=nodes.filter(node=>node.type==='run');
  const tasks=nodes.filter(node=>node.type==='task'||node.type==='queue');
  const executors=nodes.filter(node=>node.type==='executor');
  const outputs=nodes.filter(node=>node.type==='output');
  const core=new Set([...runs,...tasks,...executors,...outputs].map(node=>node.id));
  const taskIds=new Set(tasks.map(node=>node.id));
  const deps=relations.filter(rel=>rel.type==='depends_on'&&taskIds.has(rel.from)&&taskIds.has(rel.to));
  const depth=new Map(tasks.map(node=>[node.id,0]));
  for(let pass=0;pass<tasks.length;pass+=1){
    let changed=false;
    for(const rel of deps){
      const next=(depth.get(rel.to)||0)+1;
      if(next>(depth.get(rel.from)||0)&&next<=tasks.length){depth.set(rel.from,next);changed=true;}
    }
    if(!changed) break;
  }
  const groupOf=new Map();
  relations.forEach(rel=>{if(rel.type==='in_group'&&!groupOf.has(rel.from)) groupOf.set(rel.from,rel.to);});
  const runY=70;
  runs.forEach((node,index)=>{node.x=left+index*colW;node.y=runY;});
  if(runs.length) lanes.push({label:'Run',y:runY});
  const levels=new Map();
  tasks.forEach(node=>{const level=depth.get(node.id)||0;if(!levels.has(level)) levels.set(level,[]);levels.get(level).push(node);});
  const taskTop=runY+96;
  let levelX=left, tasksBottom=taskTop;
  [...levels.keys()].sort((a,b)=>a-b).forEach(level=>{
    const list=levels.get(level).sort((a,b)=>(groupOf.get(a.id)||'').localeCompare(groupOf.get(b.id)||'')||a.label.localeCompare(b.label));
    list.forEach((node,index)=>{
      node.x=levelX+Math.floor(index/maxRows)*colW;
      node.y=taskTop+(index%maxRows)*rowH;
      if(node.y>tasksBottom) tasksBottom=node.y;
    });
    levelX+=Math.ceil(list.length/maxRows)*colW+50;
  });
  if(tasks.length) lanes.push({label:'Tasks',y:taskTop});
  const execY=tasksBottom+110;
  executors.forEach((node,index)=>{node.x=left+index*(colW+30);node.y=execY;});
  if(executors.length) lanes.push({label:'Agents',y:execY});
  const outputY=executors.length?execY+90:execY;
  outputs.forEach((node,index)=>{node.x=left+index*colW;node.y=outputY;});
  if(outputs.length) lanes.push({label:'Outputs',y:outputY});
  const placed=new Set(core);
  const satCount=new Map();
  let pending=nodes.filter(node=>!core.has(node.id));
  for(let pass=0;pass<3&&pending.length;pass+=1){
    pending=pending.filter(node=>{
      const rel=relations.find(item=>(item.from===node.id&&placed.has(item.to))||(item.to===node.id&&placed.has(item.from)));
      if(!rel) return true;
      const anchor=byId.get(rel.from===node.id?rel.to:rel.from);
      const idx=satCount.get(anchor.id)||0;
      satCount.set(anchor.id,idx+1);
      node.x=anchor.x+56+(idx%2)*50;
      node.y=anchor.y+34+Math.floor(idx/2)*40;
      placed.add(node.id);
      return false;
    });
  }
  const maxY=nodes.reduce((acc,node)=>placed.has(node.id)&&node.y>acc?node.y:acc,outputY);
  pending.forEach((node,index)=>{
    node.x=left+(index%5)*colW;
    node.y=maxY+120+Math.floor(index/5)*rowH;
  });
  return lanes;
}
function runtimeWorkflowFitTransform(nodes) {
  const pad=46;
  const minX=Math.min(...nodes.map(node=>node.x-node.r))-pad-40;
  const maxX=Math.max(...nodes.map(node=>node.x+node.r))+pad;
  const minY=Math.min(...nodes.map(node=>node.y-node.r))-pad;
  const maxY=Math.max(...nodes.map(node=>node.y+node.r+18))+pad;
  const scale=Math.max(.25,Math.min(1.5,Math.min(760/(maxX-minX),620/(maxY-minY))));
  return window.d3.zoomIdentity.translate(380-scale*(minX+maxX)/2,310-scale*(minY+maxY)/2).scale(scale);
}
// When most task labels open with the same word ("Ingest …" × 40), that word
// carries no information on-screen — strip it for display (full label stays
// in the hover tooltip and inspector).
function runtimeWorkflowLabelPrefix(nodes) {
  const tasks=nodes.filter(node=>node.type==='task');
  if(tasks.length<6) return '';
  const counts=new Map();
  tasks.forEach(node=>{const word=String(node.label).split(' ')[0];counts.set(word,(counts.get(word)||0)+1);});
  const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];
  return best&&best[1]>=tasks.length*0.6&&best[0].length>3?best[0]:'';
}
function fitRuntimeWorkflowGraph() {
  runtimeWorkflowZoomTransform=null;
  renderRuntimeWorkflowGraph();
}
function zoomRuntimeWorkflowGraph(factor) {
  const svg=$('runtime-graph-svg');
  if(!svg||!runtimeWorkflowZoomBehavior||!window.d3) return;
  window.d3.select(svg).call(runtimeWorkflowZoomBehavior.scaleBy,factor);
}
function resetRuntimeWorkflowGraph() {
  runtimeWorkflowNodePositions.clear();
  runtimeWorkflowZoomTransform=null;
  runtimeWorkflowUserSelected=false;
  renderRuntimeWorkflowGraph();
}
function renderRuntimeWorkflowGraph() {
  if(activityView!=='graph') return;
  const svg=$('runtime-graph-svg');
  if(!svg||!window.d3) {
    const inspector=$('runtime-graph-inspector');
    if(inspector) inspector.innerHTML='<div class="runtime-graph-empty">Graph Agentic unavailable.</div>';
    return;
  }
  const {nodes,relations}=runtimeWorkflowGraphData();
  const nodeIds=new Set(nodes.map(node=>node.id));
  for(const key of [...runtimeWorkflowNodePositions.keys()]) if(!nodeIds.has(key)) runtimeWorkflowNodePositions.delete(key);
  svg.innerHTML='';
  const viewport=document.createElementNS('http://www.w3.org/2000/svg','g');
  const laneLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
  const linkLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
  const nodeLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
  viewport.append(laneLayer,linkLayer,nodeLayer);
  svg.append(viewport);
  const relationCount=new Map(nodes.map(node=>[node.id,0]));
  relations.forEach(edge=>{relationCount.set(edge.from,(relationCount.get(edge.from)||0)+1);relationCount.set(edge.to,(relationCount.get(edge.to)||0)+1);});
  const hasSavedLayout=nodes.length>0&&nodes.every(node=>runtimeWorkflowNodePositions.has(node.id));
  nodes.forEach(node=>{
    const base=node.type==='run'?24:node.type==='task'?16:12;
    node.r=Math.min(base+6,base+Math.sqrt(relationCount.get(node.id)||0)*2);
    const saved=runtimeWorkflowNodePositions.get(node.id);
    if(saved){node.x=saved.x;node.y=saved.y;}
  });
  if(!hasSavedLayout) runtimeWorkflowLanes=computeRuntimeWorkflowLayeredLayout(nodes,relations);
  nodes.forEach(node=>runtimeWorkflowNodePositions.set(node.id,{x:node.x,y:node.y}));
  for(const lane of runtimeWorkflowLanes){
    const text=document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('class','runtime-graph-lane');
    text.setAttribute('x',6);
    text.setAttribute('y',lane.y+4);
    text.textContent=lane.label;
    laneLayer.appendChild(text);
  }
  const linkElements=renderForceLinks(linkLayer,relations,nodes,edge=>'runtime-graph-link '+edge.type);
  const refreshLinks=()=>linkElements.forEach(({element,from,to})=>{
    element.setAttribute('x1',from.x); element.setAttribute('y1',from.y);
    element.setAttribute('x2',to.x); element.setAttribute('y2',to.y);
  });
  const zoom=window.d3.zoom().scaleExtent([.25,3]).on('zoom',event=>{runtimeWorkflowZoomTransform=event.transform;viewport.setAttribute('transform',event.transform);});
  runtimeWorkflowZoomBehavior=zoom;
  window.d3.select(svg).call(zoom);
  const labelPrefix=runtimeWorkflowLabelPrefix(nodes);
  for(const node of nodes) {
    const group=createForceNode(nodeLayer,node,{
      className:n=>'runtime-graph-node '+n.type+(n.id===selectedWorkflowNodeId?' selected':''),
      onSelect:selectRuntimeWorkflowNode,
    });
    const bubble=document.createElementNS('http://www.w3.org/2000/svg','circle');
    bubble.setAttribute('r',node.r);
    // style.fill, not the fill attribute: presentation attributes do not
    // resolve var()/color-mix(), inline style does.
    bubble.style.fill=runtimeWorkflowColor(node);
    const label=document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('y',node.r+13);
    label.setAttribute('text-anchor','middle');
    const display=labelPrefix&&node.label.startsWith(labelPrefix)?(node.label.slice(labelPrefix.length).trim()||node.label):node.label;
    label.textContent=shortText(display,26);
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');
    title.textContent=node.label+' ('+node.type+' · '+(node.status||'-')+')';
    group.append(bubble,label,title);
    window.d3.select(group).call(window.d3.drag()
      .on('start',event=>event.sourceEvent.stopPropagation())
      .on('drag',event=>{node.x=event.x;node.y=event.y;runtimeWorkflowNodePositions.set(node.id,{x:node.x,y:node.y});group.setAttribute('transform',\`translate(\${node.x},\${node.y})\`);refreshLinks();}));
  }
  const transform=runtimeWorkflowZoomTransform||(nodes.length?runtimeWorkflowFitTransform(nodes):null);
  if(transform) window.d3.select(svg).call(zoom.transform,transform);
  applyRuntimeWorkflowHighlight();
  renderRuntimeWorkflowInspector();
}
function selectRuntimeWorkflowNode(id) {
  if(runtimeWorkflowUserSelected&&selectedWorkflowNodeId===id) {
    runtimeWorkflowUserSelected=false;
  } else {
    selectedWorkflowNodeId=id;
    runtimeWorkflowUserSelected=true;
  }
  applyRuntimeWorkflowHighlight();
  renderRuntimeWorkflowInspector();
}
function applyRuntimeWorkflowHighlight() {
  const svg=$('runtime-graph-svg');
  if(!svg) return;
  // Only an explicit user click dims the rest of the graph — the inspector's
  // default auto-selection must not gray everything out on first render.
  const active=runtimeWorkflowUserSelected?selectedWorkflowNodeId:null;
  const {relations}=runtimeWorkflowGraphData();
  const linkedIds=new Set();
  relations.forEach(rel=>{
    if(rel.from===active) linkedIds.add(rel.to);
    if(rel.to===active) linkedIds.add(rel.from);
  });
  svg.querySelectorAll('.runtime-graph-node').forEach(el=>{
    const id=el.dataset.nodeId;
    el.classList.toggle('selected',id===selectedWorkflowNodeId);
    el.classList.toggle('is-related',!!active&&linkedIds.has(id));
    el.classList.toggle('is-dimmed',!!active&&id!==active&&!linkedIds.has(id));
  });
  svg.querySelectorAll('.runtime-graph-link').forEach(el=>{
    const linked=!!active&&(el.dataset.from===active||el.dataset.to===active);
    el.classList.toggle('is-highlighted',linked);
    el.classList.toggle('is-dimmed',!!active&&!linked);
  });
}
function renderRuntimeWorkflowInspector() {
  const inspector=$('runtime-graph-inspector');
  if(!inspector) return;
  const {nodes,relations}=runtimeWorkflowGraphData();
  const node=nodes.find(item=>item.id===selectedWorkflowNodeId)||nodes[0];
  if(!node) { inspector.innerHTML='<div class="runtime-graph-empty">No node selected.</div>'; return; }
  const linked=relations.filter(rel=>rel.from===node.id||rel.to===node.id);
  const logs=filteredRuntimeLogs(runtimeState?.logs);
  const nodeLabel=id=>{const other=nodes.find(item=>item.id===id);return other?other.label:id;};
  const relationLine=rel=>{
    const outgoing=rel.from===node.id;
    const arrow=outgoing?'→':'←';
    const otherId=outgoing?rel.to:rel.from;
    return \`<div class="runtime-inspector-rel">\${arrow} \${esc(rel.type.replaceAll('_',' '))} · \${esc(nodeLabel(otherId))}</div>\`;
  };
  const membersSection=Array.isArray(node.members)&&node.members.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Grouped (\${node.members.length})</div>\${node.members.map(member=>\`<div class="runtime-inspector-rel">\${esc(member.status)} · \${esc(member.label)}</div>\`).join('')}</div>\`:'';
  inspector.innerHTML=\`<div class="runtime-inspector-title">\${esc(node.label)}</div><div class="runtime-inspector-meta">\${esc(node.type)} · \${esc(node.status||'-')}</div><dl class="runtime-inspector-dl"><dt>Id</dt><dd>\${esc(node.id)}</dd><dt>Run</dt><dd>\${esc(runtimeState?.runId||runtimeState?.currentRunId||node.runId||'-')}</dd><dt>Turn</dt><dd>\${esc(runtimeState?.turnId||node.turnId||'-')}</dd><dt>Relations</dt><dd>\${linked.length}</dd></dl>\${membersSection}\${linked.length?\`<div class="runtime-inspector-section">\${linked.map(relationLine).join('')}</div>\`:''}\${logs.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Logs</div><pre>\${logs.map(runtimeLogLineHTML).join('\\n')}</pre></div>\`:''}\`;
}
/* ── end Runtime Graph ─────────────────────────────────────────────── */`;
