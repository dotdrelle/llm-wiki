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
let selectedRuntimeWorkflowTaskId=null;
const runtimeWorkflowStatusByNode=new Map();
function runtimeWorkflowGraphHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-shell">\${runtimeWorkflowGraphCenterHTML()}<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside></div>\`;
}
function runtimeWorkflowGraphCenterHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-main"><div class="runtime-graph-toolbar"><span>Run execution</span><span><button type="button" onclick="zoomRuntimeWorkflowGraph(.8)" title="Zoom out" aria-label="Zoom out">−</button><button type="button" onclick="zoomRuntimeWorkflowGraph(1.25)" title="Zoom in" aria-label="Zoom in">+</button><button type="button" onclick="fitRuntimeWorkflowGraph()">Fit</button><button type="button" onclick="resetRuntimeWorkflowGraph()">Reset</button></span></div>\${runtimeWorkflowSummaryHTML()}<div class="runtime-graph-legend"><b>Relation</b><span><i class="depends_on"></i>Sequence / dependency</span><b>Status</b><span><i class="bubble running"></i>Running</span><span><i class="bubble done"></i>Done</span><span><i class="bubble failed"></i>Failed</span><span><i class="bubble approval"></i>Approval</span><span><i class="bubble neutral"></i>Waiting</span></div><svg class="runtime-graph-svg" id="runtime-graph-svg" viewBox="0 0 760 620" aria-label="Simplified run execution graph"></svg></div>\`;
}
function runtimeWorkflowSummaryHTML() {
  const {nodes}=runtimeWorkflowGraphData();
  if(!nodes.length) return '';
  const run=nodes.find(node=>node.type==='run');
  const phases=nodes.filter(node=>node.type==='task_group');
  const agents=new Set(phases.flatMap(phase=>phase.agents||[]));
  const currentParallel=phases.reduce((sum,phase)=>sum+(phase.currentParallel||0),0);
  // Authoritative resolved concurrency from the runtime; fall back to the
  // plan-derived value for replayed/historical runs.
  const resolved=runtimeState?.concurrency;
  const maxParallel=Number.isFinite(Number(resolved?.limit))?Number(resolved.limit):Math.max(0,...phases.map(phase=>phase.parallelism||0));
  const ceilingTag=resolved?.cappedByCeiling?' <span class="run-summary-ceiling" title="Capped by WIKI_MANAGER_CAPABILITY_CONCURRENCY">(ceiling)</span>':'';
  const done=phases.reduce((sum,phase)=>sum+(phase.done||0),0);
  const total=phases.reduce((sum,phase)=>sum+(phase.total||0),0);
  const live=String(run?.status||runtimeState?.status)==='running';
  return \`<div class="runtime-run-summary\${live?' live':''}"><strong>\${esc(run?.label||'Runtime run')}</strong>\${live?'<span class="runtime-live-indicator">● Live</span>':''}<span>\${agents.size} agent\${agents.size===1?'':'s'}</span><span>Parallel \${currentParallel} / max ×\${maxParallel}\${ceilingTag}</span><span>\${done}/\${total} tasks</span><span>Tokens \${esc(formatRuntimeTokens(run?.usage))}</span></div>\`;
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
  const workflowNodes=Array.isArray(workflow.nodes)?workflow.nodes:[];
  const taskNodes=workflowNodes.filter(node=>node.type==='task');
  const runNode=workflowNodes.find(node=>node.type==='run');
  const graphNodes=Array.isArray(graph.nodes)?graph.nodes:[];
  const graphEdges=Array.isArray(graph.edges)?graph.edges:[];
  const groupDefinitions=new Map(graphNodes.filter(node=>node.type==='task_group').map(node=>[String(node.id).replace(/^group:/,''),node]));
  const assignmentAgents=new Map();
  for(const task of taskNodes){
    const assignmentIds=graphEdges.filter(edge=>edge.type==='assigned_to'&&edge.from===task.id).map(edge=>edge.to);
    const agents=assignmentIds.flatMap(id=>graphEdges.filter(edge=>edge.type==='uses_agent'&&edge.from===id).map(edge=>String(edge.to).replace(/^agent:/,'')));
    if(task.executor) agents.push(String(task.executor));
    assignmentAgents.set(task.id,[...new Set(agents.filter(Boolean))]);
  }
  const phaseKey=task=>String(task.raw?.groupId||task.raw?.group||task.raw?.operation||task.raw?.requiredCapability||task.stepId||task.id);
  const buckets=new Map();
  taskNodes.forEach(task=>{const key=phaseKey(task);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(task);});
  const statusRank={failed:7,pending_approval:6,waiting_approval:6,running:5,queued:4,waiting:3,pending:2,done:1,cancelled:0};
  const usageByTask=workflow.usage?.byTask||{};
  const phases=[...buckets].map(([key,tasks],index)=>{
    const definition=groupDefinitions.get(key);
    const statuses=tasks.map(task=>String(task.status||'pending'));
    const status=statuses.every(value=>value==='done')?'done':statuses.sort((a,b)=>(statusRank[b]||0)-(statusRank[a]||0))[0]||'pending';
    const agents=[...new Set(tasks.flatMap(task=>assignmentAgents.get(task.id)||[]))];
    const usage=tasks.reduce((sum,task)=>{
      const taskId=String(task.stepId||task.id).replace(/^task:/,'');
      const value=usageByTask[taskId]||{};
      if(value.inputKnown){sum.inputTokens+=Number(value.inputTokens)||0;sum.inputKnown=true;}
      if(value.outputKnown){sum.outputTokens+=Number(value.outputTokens)||0;sum.outputKnown=true;}
      if(value.totalKnown){sum.totalTokens+=Number(value.totalTokens)||0;sum.totalKnown=true;}
      return sum;
    },{inputTokens:0,outputTokens:0,totalTokens:0,inputKnown:false,outputKnown:false,totalKnown:false});
    const currentParallel=tasks.filter(task=>task.status==='running').length;
    const parallelism=Math.max(1,Number(definition?.raw?.recommendedConcurrency)||currentParallel||1);
    const done=tasks.filter(task=>task.status==='done').length;
    return {id:'phase:'+key,type:'task_group',groupId:key,label:String(definition?.label||definition?.raw?.label||humanizeRuntimePhase(key,tasks[0]?.label)||'Phase '+(index+1)),status,tasks,agents,parallelism,currentParallel,done,total:tasks.length,usage,raw:{group:definition?.raw,tasks:tasks.map(task=>task.raw||task)}};
  });
  const phaseByTask=new Map();
  phases.forEach(phase=>phase.tasks.forEach(task=>phaseByTask.set(String(task.stepId),phase.id)));
  const relationKeys=new Set();
  const relations=[];
  for(const phase of phases){
    for(const task of phase.tasks){
      for(const dependency of task.dependsOn||[]){
        const dependencyPhase=phaseByTask.get(String(dependency));
        if(!dependencyPhase||dependencyPhase===phase.id) continue;
        const key=phase.id+'|'+dependencyPhase;
        if(!relationKeys.has(key)){relationKeys.add(key);relations.push({id:'phase-dep:'+key,type:'depends_on',from:phase.id,to:dependencyPhase});}
      }
      const dependencyGroup=task.raw?.dependsOnGroup;
      const dependencyPhase=dependencyGroup?'phase:'+dependencyGroup:null;
      if(dependencyPhase&&phases.some(item=>item.id===dependencyPhase)&&dependencyPhase!==phase.id){
        const key=phase.id+'|'+dependencyPhase;
        if(!relationKeys.has(key)){relationKeys.add(key);relations.push({id:'phase-dep:'+key,type:'depends_on',from:phase.id,to:dependencyPhase});}
      }
    }
  }
  const expandedPhase=runtimeWorkflowUserSelected?phases.find(phase=>phase.id===selectedWorkflowNodeId):null;
  const expandedTasks=expandedPhase?(expandedPhase.tasks||[]).map(task=>{
    const taskId=String(task.stepId||task.id).replace(/^task:/,'');
    return {
      ...task,
      id:'detail:'+expandedPhase.id+':'+taskId,
      taskId,
      phaseId:expandedPhase.id,
      type:'task_detail',
      label:String(task.label||task.description||taskId),
      status:String(task.status||'pending'),
      usage:workflow.usage?.byTask?.[taskId]||{},
      timing:workflow.timingByTask?.[taskId]||{},
    };
  }):[];
  if(expandedPhase){
    const detailByTask=new Map(expandedTasks.map(task=>[task.taskId,task]));
    for(const task of expandedTasks){
      const dependencies=(task.dependsOn||[]).map(value=>detailByTask.get(String(value))).filter(Boolean);
      if(dependencies.length){
        dependencies.forEach(dependency=>relations.push({id:'detail-dep:'+task.id+':'+dependency.id,type:'depends_on',from:task.id,to:dependency.id}));
      } else {
        relations.push({id:'phase-task:'+task.id,type:'contains',from:task.id,to:expandedPhase.id});
      }
    }
  }
  const nodes=[
    ...(runNode?[{...runNode,id:String(runNode.id),type:'run',label:String(runNode.label||'Runtime run'),agents:[...new Set(phases.flatMap(phase=>phase.agents))],usage:workflow.usage||{},phaseCount:phases.length,taskCount:taskNodes.length}]:[]),
    ...phases,
    ...expandedTasks,
  ];
  if(runNode) phases.filter(phase=>!relations.some(rel=>rel.from===phase.id)).forEach(phase=>relations.push({id:'run-phase:'+phase.id,type:'starts',from:phase.id,to:String(runNode.id)}));
  const nodeIds=new Set(nodes.map(node=>node.id));
  if(!selectedWorkflowNodeId||!nodeIds.has(selectedWorkflowNodeId)) selectedWorkflowNodeId=workflow.current?.id&&nodeIds.has(workflow.current.id)?workflow.current.id:nodes[0]?.id||null;
  return {nodes,relations};
}
function humanizeRuntimePhase(key,label='') {
  const value=String(key||label).replace(/[._-]+/g,' ').trim();
  return value.replace(/\\b\\w/g,char=>char.toUpperCase());
}
function formatRuntimeTokens(usage) {
  const format=(known,value)=>known?new Intl.NumberFormat().format(Number(value)||0):'—';
  const split=format(usage?.inputKnown,usage?.inputTokens)+' in · '+format(usage?.outputKnown,usage?.outputTokens)+' out';
  return usage?.totalKnown?split+' · '+format(true,usage.totalTokens)+' total':split;
}
function formatRuntimeDuration(ms) {
  const n=Number(ms);
  if(!Number.isFinite(n)||n<0)return '';
  const minutes=n/60000;
  return (minutes<10?Math.max(.1,minutes).toFixed(1):Math.round(minutes))+' min';
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
  const colW=220,rowH=112,left=250,maxRows=4;
  const lanes=[];
  const runs=nodes.filter(node=>node.type==='run');
  const tasks=nodes.filter(node=>node.type==='task_group');
  const taskDetails=nodes.filter(node=>node.type==='task_detail');
  const executors=nodes.filter(node=>node.type==='executor');
  const outputs=nodes.filter(node=>node.type==='output');
  const core=new Set([...runs,...tasks,...taskDetails,...executors,...outputs].map(node=>node.id));
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
  const runY=310;
  runs.forEach((node,index)=>{node.x=75+index*colW;node.y=runY;});
  const levels=new Map();
  tasks.forEach(node=>{const level=depth.get(node.id)||0;if(!levels.has(level)) levels.set(level,[]);levels.get(level).push(node);});
  const taskTop=105;
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
  if(tasks.length) lanes.push({label:'Execution sequence',y:32});
  if(taskDetails.length){
    const detailIds=new Set(taskDetails.map(node=>node.id));
    const detailDeps=relations.filter(rel=>rel.type==='depends_on'&&detailIds.has(rel.from)&&detailIds.has(rel.to));
    const detailDepth=new Map(taskDetails.map(node=>[node.id,0]));
    for(let pass=0;pass<taskDetails.length;pass+=1){
      let changed=false;
      for(const rel of detailDeps){
        const next=(detailDepth.get(rel.to)||0)+1;
        if(next>(detailDepth.get(rel.from)||0)&&next<=taskDetails.length){detailDepth.set(rel.from,next);changed=true;}
      }
      if(!changed) break;
    }
    const anchor=byId.get(taskDetails[0]?.phaseId);
    const savedAnchor=anchor?runtimeWorkflowNodePositions.get(anchor.id):null;
    const detailLevels=new Map();
    taskDetails.forEach(node=>{const level=detailDepth.get(node.id)||0;if(!detailLevels.has(level))detailLevels.set(level,[]);detailLevels.get(level).push(node);});
    for(const [level,list] of [...detailLevels].sort((a,b)=>a[0]-b[0])){
      list.sort((a,b)=>(Number(a.timing?.startedAt)||Infinity)-(Number(b.timing?.startedAt)||Infinity));
      list.forEach((node,index)=>{
        node.x=(savedAnchor?.x??anchor?.x??left)+level*190+(index%3)*150-150;
        node.y=(savedAnchor?.y??anchor?.y??taskTop)+105+Math.floor(index/3)*82;
        tasksBottom=Math.max(tasksBottom,node.y);
      });
    }
    lanes.push({label:'Selected phase · task DAG',y:(anchor?.y||taskTop)+72});
  }
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
      const savedAnchor=runtimeWorkflowNodePositions.get(anchor.id);
      const idx=satCount.get(anchor.id)||0;
      satCount.set(anchor.id,idx+1);
      node.x=(savedAnchor?.x??anchor.x)+56+(idx%2)*50;
      node.y=(savedAnchor?.y??anchor.y)+34+Math.floor(idx/2)*40;
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
  selectedRuntimeWorkflowTaskId=null;
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
  const savedPositions=new Map(nodes.flatMap(node=>{
    const saved=runtimeWorkflowNodePositions.get(node.id);
    return saved?[[node.id,saved]]:[];
  }));
  nodes.forEach(node=>{
    const base=node.type==='task_group'?84:node.type==='task_detail'?66:node.type==='run'?28:12;
    node.r=Math.min(base+6,base+Math.sqrt(relationCount.get(node.id)||0)*2);
  });
  if(!hasSavedLayout) runtimeWorkflowLanes=computeRuntimeWorkflowLayeredLayout(nodes,relations);
  // Status updates can introduce a new task node. Lay out that missing node,
  // then restore every known coordinate so an SSE refresh never moves bubbles
  // the user has positioned manually (Reset is the only intentional clear).
  nodes.forEach(node=>{
    const saved=savedPositions.get(node.id);
    if(saved){node.x=saved.x;node.y=saved.y;}
  });
  nodes.forEach(node=>runtimeWorkflowNodePositions.set(node.id,{x:node.x,y:node.y}));
  for(const lane of runtimeWorkflowLanes){
    const text=document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('class','runtime-graph-lane');
    text.setAttribute('x',6);
    text.setAttribute('y',lane.y+4);
    text.textContent=lane.label;
    laneLayer.appendChild(text);
  }
  const renderNodeById=new Map(nodes.map(node=>[node.id,node]));
  const linkElements=renderForceLinks(linkLayer,relations,nodes,edge=>{
    const active=[renderNodeById.get(edge.from),renderNodeById.get(edge.to)].some(node=>node?.status==='running');
    return 'runtime-graph-link '+edge.type+(active?' is-active-flow':'');
  });
  const refreshLinks=()=>linkElements.forEach(({element,from,to})=>{
    element.setAttribute('x1',from.x); element.setAttribute('y1',from.y);
    element.setAttribute('x2',to.x); element.setAttribute('y2',to.y);
  });
  const zoom=window.d3.zoom().scaleExtent([.25,3]).on('zoom',event=>{runtimeWorkflowZoomTransform=event.transform;viewport.setAttribute('transform',event.transform);});
  runtimeWorkflowZoomBehavior=zoom;
  window.d3.select(svg).call(zoom);
  const labelPrefix=runtimeWorkflowLabelPrefix(nodes);
  for(const node of nodes) {
    const previousStatus=runtimeWorkflowStatusByNode.get(node.id);
    const statusChanged=previousStatus!=null&&previousStatus!==node.status;
    runtimeWorkflowStatusByNode.set(node.id,node.status);
    const group=createForceNode(nodeLayer,node,{
      className:n=>'runtime-graph-node '+n.type+' status-'+String(n.status||'pending')+(statusChanged?' status-changed':'')+((n.type==='task_detail'?n.taskId===selectedRuntimeWorkflowTaskId:n.id===selectedWorkflowNodeId)?' selected':''),
      onSelect:node.type==='task_detail'?()=>selectRuntimeWorkflowTask(node.taskId):selectRuntimeWorkflowNode,
    });
    const rectangular=node.type==='task_group'||node.type==='task_detail';
    const bubble=document.createElementNS('http://www.w3.org/2000/svg',rectangular?'rect':'circle');
    if(node.type==='task_group'){
      bubble.setAttribute('x',-82);bubble.setAttribute('y',-34);bubble.setAttribute('width',164);bubble.setAttribute('height',68);bubble.setAttribute('rx',10);
    } else if(node.type==='task_detail'){
      bubble.setAttribute('x',-64);bubble.setAttribute('y',-25);bubble.setAttribute('width',128);bubble.setAttribute('height',50);bubble.setAttribute('rx',7);
    } else bubble.setAttribute('r',node.r);
    // style.fill, not the fill attribute: presentation attributes do not
    // resolve var()/color-mix(), inline style does.
    bubble.style.fill=runtimeWorkflowColor(node);
    const label=document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('y',node.type==='task_group'?-9:node.type==='task_detail'?-5:node.r+15);
    label.setAttribute('text-anchor','middle');
    const display=labelPrefix&&node.label.startsWith(labelPrefix)?(node.label.slice(labelPrefix.length).trim()||node.label):node.label;
    label.textContent=shortText(display,node.type==='task_group'?25:node.type==='task_detail'?20:26);
    if(node.type==='task_group'){
      const meta=document.createElementNS('http://www.w3.org/2000/svg','text');
      meta.setAttribute('class','runtime-graph-node-meta');meta.setAttribute('y',9);meta.setAttribute('text-anchor','middle');
      meta.textContent=node.done+'/'+node.total+' tasks · parallel ×'+node.parallelism;
      const agentMeta=document.createElementNS('http://www.w3.org/2000/svg','text');
      agentMeta.setAttribute('class','runtime-graph-node-agent');agentMeta.setAttribute('y',24);agentMeta.setAttribute('text-anchor','middle');
      agentMeta.textContent=(node.agents.length?node.agents.length+' agent'+(node.agents.length>1?'s':''):'agent —')+' · '+formatRuntimeTokens(node.usage);
      group.append(bubble,label,meta,agentMeta);
    } else if(node.type==='task_detail'){
      const meta=document.createElementNS('http://www.w3.org/2000/svg','text');
      meta.setAttribute('class','runtime-graph-node-meta');meta.setAttribute('y',11);meta.setAttribute('text-anchor','middle');
      meta.textContent=(node.status||'pending')+(node.timing?.durationMs!=null?' · '+formatRuntimeDuration(node.timing.durationMs):'');
      group.append(bubble,label,meta);
    } else if(node.type==='run'){
      // Resolved scheduler concurrency, straight on the run anchor. Same source
      // of truth (runtimeState.concurrency) as the summary bar and inspector, so
      // the three can never disagree. Amber when the manager ceiling bit.
      const conc=runtimeState?.concurrency;
      const limit=Number.isFinite(Number(conc?.limit))?Number(conc.limit):null;
      if(limit!=null){
        const meta=document.createElementNS('http://www.w3.org/2000/svg','text');
        meta.setAttribute('class','runtime-graph-node-agent');meta.setAttribute('y',node.r+30);meta.setAttribute('text-anchor','middle');
        meta.textContent='parallel ×'+limit+(conc?.cappedByCeiling?' (ceiling)':'');
        if(conc?.cappedByCeiling) meta.style.fill='#f59e0b';
        group.append(bubble,label,meta);
      } else group.append(bubble,label);
    } else group.append(bubble,label);
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');
    title.textContent=node.label+' ('+node.type+' · '+(node.status||'-')+')';
    group.append(title);
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
  if(selectedWorkflowNodeId!==id) selectedRuntimeWorkflowTaskId=null;
  if(runtimeWorkflowUserSelected&&selectedWorkflowNodeId===id) {
    runtimeWorkflowUserSelected=false;
  } else {
    selectedWorkflowNodeId=id;
    runtimeWorkflowUserSelected=true;
  }
  renderRuntimeWorkflowGraph();
}
function selectRuntimeWorkflowTask(taskId) {
  selectedRuntimeWorkflowTaskId=selectedRuntimeWorkflowTaskId===taskId?null:taskId;
  renderRuntimeWorkflowGraph();
}
function applyRuntimeWorkflowHighlight() {
  const svg=$('runtime-graph-svg');
  if(!svg) return;
  // Only an explicit user click dims the rest of the graph — the inspector's
  // default auto-selection must not gray everything out on first render.
  const {nodes,relations}=runtimeWorkflowGraphData();
  const selectedTaskNode=nodes.find(node=>node.type==='task_detail'&&node.taskId===selectedRuntimeWorkflowTaskId);
  const selectedId=selectedTaskNode?.id||selectedWorkflowNodeId;
  const active=runtimeWorkflowUserSelected?selectedId:null;
  const linkedIds=new Set();
  relations.forEach(rel=>{
    if(rel.from===active) linkedIds.add(rel.to);
    if(rel.to===active) linkedIds.add(rel.from);
  });
  if(active===selectedWorkflowNodeId){
    nodes.filter(node=>node.type==='task_detail'&&node.phaseId===selectedWorkflowNodeId).forEach(node=>linkedIds.add(node.id));
  }
  svg.querySelectorAll('.runtime-graph-node').forEach(el=>{
    const id=el.dataset.nodeId;
    el.classList.toggle('selected',id===selectedId);
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
  const nodeLabel=id=>{const other=nodes.find(item=>item.id===id);return other?other.label:id;};
  const relationLine=rel=>{
    const outgoing=rel.from===node.id;
    const arrow=outgoing?'→':'←';
    const otherId=outgoing?rel.to:rel.from;
    return \`<div class="runtime-inspector-rel">\${arrow} \${esc(rel.type.replaceAll('_',' '))} · \${esc(nodeLabel(otherId))}</div>\`;
  };
  const phase=node.type==='task_group';
  const run=node.type==='run';
  const details=phase
    ? [['Status',node.status],['Tasks',node.done+' / '+node.total],['Agents',node.agents?.join(', ')||'Not reported'],['Parallelism',(node.currentParallel||0)+' active / max ×'+node.parallelism],['Tokens',formatRuntimeTokens(node.usage)]]
    : [['Status',node.status],['Phases',node.phaseCount||0],['Tasks',node.taskCount||0],['Agents',node.agents?.length||0],
      ...(Number.isFinite(Number(runtimeState?.concurrency?.limit))?[['Parallelism','max ×'+Number(runtimeState.concurrency.limit)+(runtimeState.concurrency.cappedByCeiling?' (ceiling)':'')]]:[]),
      ['Tokens',formatRuntimeTokens(node.usage)]];
  // Per-task rows ordered by start time (temporal flow), each with wall-clock
  // duration and tokens in/out — sourced from the workflow projection
  // (usage.byTask + timingByTask), the same numbers as the phase aggregate.
  const ritTok=(known,value)=>known?new Intl.NumberFormat().format(Number(value)||0):'—';
  const usageByTask=runtimeState?.workflow?.usage?.byTask||{};
  const timingByTask=runtimeState?.workflow?.timingByTask||{};
  const taskRows=phase&&node.tasks?.length?[...node.tasks].map(task=>{
    const taskId=String(task.stepId||task.id).replace(/^task:/,'');
    return {task,taskId,tk:usageByTask[taskId]||{},tm:timingByTask[taskId]||{}};
  }).sort((a,b)=>(Number(a.tm.startedAt)||Number(a.tm.finishedAt)||Infinity)-(Number(b.tm.startedAt)||Number(b.tm.finishedAt)||Infinity)):[];
  if(selectedRuntimeWorkflowTaskId&&!taskRows.some(row=>row.taskId===selectedRuntimeWorkflowTaskId)) selectedRuntimeWorkflowTaskId=null;
  const taskList=taskRows.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Tasks · flow (by start)</div>\${taskRows.slice(0,20).map((row,i)=>{
    const dur=formatRuntimeDuration(row.tm.durationMs);
    const hasTok=row.tk.inputKnown||row.tk.outputKnown;
    const meta=[dur?'⏱ '+dur:'',hasTok?ritTok(row.tk.inputKnown,row.tk.inputTokens)+' in / '+ritTok(row.tk.outputKnown,row.tk.outputTokens)+' out':''].filter(Boolean).join(' · ');
    return \`<button type="button" class="runtime-inspector-task\${row.taskId===selectedRuntimeWorkflowTaskId?' selected':''}" data-task-id="\${esc(row.taskId)}" onclick="selectRuntimeWorkflowTask(this.dataset.taskId)"><span class="rit-top"><span class="rit-seq">\${i+1}</span><span class="rit-label">\${esc(row.task.label)}</span><b class="\${esc(row.task.status)}">\${esc(row.task.status)}</b></span>\${meta?\`<span class="rit-meta">\${esc(meta)}</span>\`:''}</button>\`;
  }).join('')}\${taskRows.length>20?\`<div class="runtime-inspector-rel">+\${taskRows.length-20} more</div>\`:''}</div>\`:'';
  const selectedTaskIndex=taskRows.findIndex(row=>row.taskId===selectedRuntimeWorkflowTaskId);
  const selectedTask=selectedTaskIndex>=0?taskRows[selectedTaskIndex]:null;
  const taskFlow=selectedTask?(()=>{
    const previous=taskRows[selectedTaskIndex-1];
    const next=taskRows[selectedTaskIndex+1];
    const started=selectedTask.tm.startedAt!=null&&Number.isFinite(Number(selectedTask.tm.startedAt))?new Date(Number(selectedTask.tm.startedAt)).toLocaleTimeString():'—';
    const duration=formatRuntimeDuration(selectedTask.tm.durationMs)||'—';
    const tokens=ritTok(selectedTask.tk.inputKnown,selectedTask.tk.inputTokens)+' in / '+ritTok(selectedTask.tk.outputKnown,selectedTask.tk.outputTokens)+' out';
    const agent=selectedTask.task.executor||selectedTask.task.raw?.executor||'—';
    return \`<div class="runtime-inspector-section runtime-task-flow"><div class="runtime-inspector-heading">Execution sequence · task \${selectedTaskIndex+1}/\${taskRows.length}</div><div class="rit-flow-line previous"><span>Previous</span><b>\${esc(previous?.task.label||'Start')}</b></div><div class="rit-flow-line current"><span>Selected</span><b>\${esc(selectedTask.task.label)}</b></div><div class="rit-flow-line next"><span>Next</span><b>\${esc(next?.task.label||'End')}</b></div><dl class="runtime-inspector-dl"><dt>Status</dt><dd>\${esc(selectedTask.task.status||'—')}</dd><dt>Started</dt><dd>\${esc(started)}</dd><dt>Duration</dt><dd>\${esc(duration)}</dd><dt>Agent</dt><dd>\${esc(agent)}</dd><dt>Tokens</dt><dd>\${esc(tokens)}</dd></dl></div>\`;
  })():'';
  inspector.innerHTML=\`<div class="runtime-inspector-title">\${esc(node.label)}</div><div class="runtime-inspector-meta">\${phase?'phase':run?'run':esc(node.type)} · \${esc(node.status||'-')}</div><dl class="runtime-inspector-dl">\${details.map(([key,value])=>\`<dt>\${esc(key)}</dt><dd>\${esc(value)}</dd>\`).join('')}</dl>\${linked.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Sequence</div>\${linked.map(relationLine).join('')}</div>\`:''}\${taskList}\${taskFlow}<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Run journal</div>\${essentialRuntimeLogHTML()}</div>\`;
}
/* ── end Runtime Graph ─────────────────────────────────────────────── */`;
