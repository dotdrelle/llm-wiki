import { graphCanvasScript } from '../../graph/core/canvas/graphCanvasScript.ts';
import { RUNTIME_CANVAS_SCRIPT } from './runtimeCanvasScript.ts';

// Run/Task graph. Node/link SVG mechanics come from graph/core's shared Canvas
// camera and scheduler — this file supplies the runtime workflow projection, a
// laned/layered DAG layout (Run / Tasks / Agents / Outputs bands; tasks layered
// left→right by topological depth over depends_on and wrapped into sub-columns),
// repeated-satellite aggregation (N identical activities/approvals on one anchor
// collapse into a single counted bubble), and its own minimal inspector — no
// toolbar/search/relation-modal chrome like the wiki graph.
export const RUNTIME_GRAPH_SCRIPT = `/* ── Runtime Graph ─────────────────────────────────────────────────── */
${graphCanvasScript()}
${RUNTIME_CANVAS_SCRIPT}
let runtimeWorkflowUserSelected=false;
let selectedRuntimeWorkflowTaskId=null;
function runtimeWorkflowGraphHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-shell">\${runtimeWorkflowGraphCenterHTML()}<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside></div>\`;
}
function runtimeWorkflowGraphCenterHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-main"><div class="runtime-graph-toolbar"><span>Run execution</span><span><button type="button" onclick="zoomRuntimeWorkflowGraph(.8)" title="Zoom out" aria-label="Zoom out">−</button><button type="button" onclick="zoomRuntimeWorkflowGraph(1.25)" title="Zoom in" aria-label="Zoom in">+</button><button type="button" onclick="fitRuntimeWorkflowGraph()">Fit</button><button type="button" onclick="resetRuntimeWorkflowGraph()">Reset</button></span></div>\${runtimeWorkflowSummarySlotHTML()}<div class="runtime-graph-legend"><b>Relation</b><span><i class="depends_on"></i>Sequence / dependency</span><b>Status</b><span><i class="bubble running"></i>Running</span><span><i class="bubble done"></i>Done</span><span><i class="bubble failed"></i>Failed</span><span><i class="bubble approval"></i>Approval</span><span><i class="bubble pending"></i>Pending</span><span><i class="bubble fresh"></i>New / changed</span></div><div class="runtime-canvas-stage"><canvas class="runtime-graph-canvas" id="runtime-graph-canvas" tabindex="0" role="application" aria-label="Interactive run execution graph"></canvas><div class="runtime-graph-a11y" role="tree" aria-label="Visible execution nodes"></div></div></div>\`;
}
// The summary is the only fragment of the frame that changes on every tick. It
// therefore lives in a stable slot, updated in place: rewriting the whole
// frame for it destroyed the neighboring canvas every second (see
// renderActivities), hence the flicker and the impossible dragging.
function runtimeWorkflowSummarySlotHTML() {
  const summary=runtimeWorkflowSummaryParts();
  return \`<div class="runtime-run-summary\${summary.live?' live':''}" id="runtime-run-summary">\${summary.html}</div>\`;
}
// The Plan tab reuses the same summary, but without the slot: it is not
// refreshed in place — the list has its own fingerprint guard — and two
// elements carrying the same id in one page is a source of bugs we have no
// reason to introduce.
function runtimeWorkflowSummaryHTML() {
  const summary=runtimeWorkflowSummaryParts();
  if(!summary.html) return '';
  return \`<div class="runtime-run-summary\${summary.live?' live':''}">\${summary.html}</div>\`;
}
function refreshRuntimeWorkflowSummary() {
  const host=$('runtime-run-summary');
  if(!host) return;
  const summary=runtimeWorkflowSummaryParts();
  host.classList.toggle('live',summary.live);
  if(host.__summaryHTML===summary.html) return;
  host.__summaryHTML=summary.html;
  host.innerHTML=summary.html;
}
function runtimeWorkflowSummaryParts() {
  const {nodes}=runtimeWorkflowGraphData();
  if(!nodes.length) return {html:'',live:false};
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
  return {live,html:\`<strong>\${esc(run?.label||'Runtime run')}</strong>\${live?'<span class="runtime-live-indicator">● Live</span>':''}<span>\${agents.size} agent\${agents.size===1?'':'s'}</span><span>Parallel \${currentParallel} / max ×\${maxParallel}\${ceilingTag}</span><span>\${done}/\${total} tasks</span><span>Tokens \${esc(formatRuntimeTokens(run?.usage))}</span>\`};
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
function fitRuntimeWorkflowGraph(){runtimeCanvasRenderer?.fit()}
function zoomRuntimeWorkflowGraph(factor){runtimeCanvasRenderer?.zoom(factor)}
// "Reset" also hands the view back to automatic framing: without it, a manual
// drag froze the view for the rest of the session and the button only reset
// the node positions.
function resetRuntimeWorkflowGraph(){runtimeCanvasPositions.clear();runtimeCanvasCamera=null;runtimeWorkflowUserSelected=false;selectedRuntimeWorkflowTaskId=null;runtimeCanvasRenderer?.releaseCamera();renderRuntimeWorkflowCanvas();runtimeCanvasRenderer?.fit()}
function renderRuntimeWorkflowGraph(){renderRuntimeWorkflowCanvas()}
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
  const html=\`<div class="runtime-inspector-title">\${esc(node.label)}</div><div class="runtime-inspector-meta">\${phase?'phase':run?'run':esc(node.type)} · \${esc(node.status||'-')}</div><dl class="runtime-inspector-dl">\${details.map(([key,value])=>\`<dt>\${esc(key)}</dt><dd>\${esc(value)}</dd>\`).join('')}</dl>\${linked.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Sequence</div>\${linked.map(relationLine).join('')}</div>\`:''}\${taskList}\${taskFlow}<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Run journal</div>\${essentialRuntimeLogHTML()}</div>\`;
  // Same reason as for the frame: the inspector is rebuilt on every frame,
  // which reset the journal's scrolling during a run.
  if(inspector.__inspectorHTML===html) return;
  inspector.__inspectorHTML=html;
  const journal=inspector.querySelector('.runtime-inspector-section:last-child pre');
  const journalTop=journal?journal.scrollTop:0;
  inspector.innerHTML=html;
  const nextJournal=inspector.querySelector('.runtime-inspector-section:last-child pre');
  if(nextJournal&&journalTop>0) nextJournal.scrollTop=journalTop;
}
/* ── end Runtime Graph ─────────────────────────────────────────────── */`;
