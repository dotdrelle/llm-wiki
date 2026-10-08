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
  const currentParallel=phases.reduce((sum,phase)=>sum+(phase.currentParallel||0),0);
  // Authoritative resolved concurrency from the runtime; fall back to the
  // plan-derived value for replayed/historical runs.
  const resolved=runtimeState?.concurrency;
  const maxParallel=Number.isFinite(Number(resolved?.limit))?Number(resolved.limit):Math.max(0,...phases.map(phase=>phase.parallelism||0));
  const ceilingTag=resolved?.cappedByCeiling?' <span class="run-summary-ceiling" title="Capped by WIKI_MANAGER_CAPABILITY_CONCURRENCY">(manager cap)</span>':'';
  const limits=resolved?'Agent recommended: '+(resolved.agentRecommended??'not reported')+' · Agent maximum: '+(resolved.agentMaximum??'not reported')+' · Manager cap: '+(resolved.ceiling??'unset'):'';
  const done=phases.reduce((sum,phase)=>sum+(phase.done||0),0);
  const total=phases.reduce((sum,phase)=>sum+(phase.total||0),0);
  const live=String(run?.status||runtimeState?.status)==='running';
  // One number per notion. A plan of ONE task (an ingest owns the workspace
  // lock for its whole cycle) has no task concurrency to show — "1 / 4" read
  // as a quarter of the capacity unused, while the real parallelism is the
  // model calls inside the ingest. The task line appears only for a plan of
  // several tasks, where it means something.
  const tasks=total>1?\`<span title="\${esc(limits)}">Tasks: \${done}/\${total} done · \${currentParallel} running (max \${maxParallel} at once)\${ceilingTag}</span>\`:'';
  return {live,html:\`<strong>\${esc(run?.label||'Runtime run')}</strong>\${live?'<span class="runtime-live-indicator">● Live</span>':''}\${tasks}\${runtimeWorkflowIngestionSummary(phases)}<span>Tokens \${esc(formatRuntimeTokens(run?.usage))}</span>\`};
}
// The files of an ingestion and the model-call budget they share: the engine
// prepares up to that many files ahead, all drawing on the same calls, and
// writes them one at a time — so "in progress" varies around the limit.
function runtimeWorkflowIngestionLimitLabel() {
  const limit=runtimeState?.ingestionLlmLimit;
  return Number.isInteger(limit)&&limit>0?'up to '+limit:'limit not reported';
}
function runtimeWorkflowIngestionSummary(phases=[]) {
  const tasks=(runtimeState?.workflow?.nodes||[]).filter(task=>task.type==='task'&&['ingest','ingest_rebuild'].includes(task.raw?.operation??task.raw?.arguments?.operation));
  if(!tasks.length) return '';
  const counts={done:0,running:0};let fileTotal=0;
  for(const phase of phases){if(!phase.sourceCounts)continue;counts.done+=phase.sourceCounts.done||0;counts.running+=phase.sourceCounts.running||0;fileTotal+=phase.sourceTotal||0;}
  if(!fileTotal) fileTotal=tasks.reduce((sum,task)=>sum+new Set([...(task.raw?.inputRefs||[]).filter(ref=>ref.type==='file').map(ref=>ref.ref),...(task.raw?.arguments?.inputs||[])]).size,0);
  const files=fileTotal?\`<span>Files: \${counts.done}/\${fileTotal} done · \${counts.running} in progress</span>\`:'';
  return \`\${files}<span title="Configured extraction capacity (limits.maxInFlightRequests), not a live call count">Model calls at once: \${esc(runtimeWorkflowIngestionLimitLabel())}</span>\`;
}
function runtimeWorkflowInspectorHTML() {
  return '<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside>';
}
// Collapse repeated satellites: when 3+ non-core nodes of the same type and
// status hang off the same anchor (the 40 "plan mutates" approvals of one
// revision, the activity spam of one task), replace them with one aggregate
// bubble labelled "N × type". Members stay listed in the inspector; their
// relations are rewired to the aggregate and deduped.
// Maintenance works outside Donna's runs, so its jobs never reach the
// workflow projection: the canvas stayed on an idle "Runtime run" while the
// maintenance agent ingested 44 sources. Its actions are drawn as a second
// tree BESIDE Donna's run — both can execute at once (a doctor, a curation or
// a mail never holds the workspace) — one phase per action, its agent, and an
// ingest's files with their live states.
function runtimeMaintenanceGraphData() {
  const running=typeof window!=='undefined'&&typeof window.getMaintenanceRunning==='function'?window.getMaintenanceRunning():[];
  if(!Array.isArray(running)||!running.length) return null;
  const run={id:'maintenance',type:'run',label:'Maintenance',status:'running',agents:[...new Set(running.map(item=>item.agent).filter(Boolean))],usage:{},phaseCount:running.length,taskCount:running.length};
  const nodes=[run],relations=[];
  for(const item of running){
    const progress=item.progress&&typeof item.progress==='object'?item.progress:{};
    const states=progress.sourceStates&&typeof progress.sourceStates==='object'?Object.entries(progress.sourceStates):[];
    const sourceCounts=states.length?states.reduce((counts,[,value])=>{counts[value]=(counts[value]||0)+1;return counts;},{}):null;
    const id='maintenance:'+item.id;
    const label=String(progress.label||item.summary||item.action||'Maintenance action');
    nodes.push({id,type:'task_group',groupId:id,label:label.length>70?label.slice(0,67)+'…':label,status:'running',tasks:[],agents:item.agent?[String(item.agent)]:[],parallelism:1,currentParallel:1,sourceCounts,sourceTotal:Number(progress.sourceCount)||states.length,sourceProcessLimit:null,done:0,total:1,usage:{},raw:{maintenance:item}});
    relations.push({id:'run-phase:'+id,type:'starts',from:id,to:run.id});
    states.slice(0,RUNTIME_TASK_INPUT_LIMIT).forEach(([name,value],index)=>{
      const inputId='input:'+id+':'+index;
      nodes.push({id:inputId,type:'task_input',taskId:id,detailId:id,label:String(name),ref:String(name),status:String(value)});
      relations.push({id:'task-input:'+inputId,type:'contains',from:inputId,to:id});
    });
  }
  return {nodes,relations};
}
function runtimeWorkflowGraphData() {
  const maintenanceGraph=runtimeMaintenanceGraphData();
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
    // A TAXO ingest is ONE task: its real processes are the source files the
    // engine extracts in parallel (the per-file states the production agent
    // reports), bounded by limits.maxInFlightRequests. Carry them on the phase
    // so the node, the inspector and the run summary describe the same run.
    const ingestion=tasks.some(task=>['ingest','ingest_rebuild'].includes(String(task.raw?.operation??task.raw?.arguments?.operation)));
    const liveSources=ingestion&&currentParallel>0?runtimeActiveSourceStates():null;
    const sourceCounts=liveSources&&liveSources.size?[...liveSources.values()].reduce((counts,value)=>{counts[value]=(counts[value]||0)+1;return counts;},{}):null;
    const sourceTotal=tasks.reduce((sum,task)=>sum+runtimeTaskInputRefs(task).length,0);
    const sourceProcessLimit=ingestion&&Number.isInteger(Number(runtimeState?.ingestionLlmLimit))&&Number(runtimeState.ingestionLlmLimit)>0?Number(runtimeState.ingestionLlmLimit):null;
    const done=tasks.filter(task=>task.status==='done').length;
    return {id:'phase:'+key,type:'task_group',groupId:key,label:String(definition?.label||definition?.raw?.label||humanizeRuntimePhase(key,tasks[0]?.label)||'Phase '+(index+1)),status,tasks,agents,parallelism,currentParallel,sourceCounts,sourceTotal,sourceProcessLimit,done,total:tasks.length,usage,raw:{group:definition?.raw,tasks:tasks.map(task=>task.raw||task)}};
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
  // A TAXO ingest is ONE task over the whole batch: the per-file "Analyze X"
  // tasks that used to list the pending inputs no longer exist. The files the
  // task works on are hung off its detail card instead, the one the live
  // progress names marked running.
  const inputNodes=expandedTasks.flatMap(task=>runtimeTaskInputNodes(task));
  inputNodes.forEach(node=>relations.push({id:'task-input:'+node.id,type:'contains',from:node.id,to:node.detailId}));
  // The external runtime's collective: each named subagent is a child node of
  // the run, so the Canvas shows the run's internal timeline — the roles the
  // gateway ran, with their status, instead of burying them in log lines.
  const subagentNodes=workflowNodes.filter(node=>node.type==='subagent').map(node=>({
    ...node,
    id:String(node.id),
    type:'subagent',
    label:String(node.label||node.subagent||'subagent'),
    status:String(node.status||'pending'),
  }));
  if(runNode) subagentNodes.forEach(node=>relations.push({id:'run-subagent:'+node.id,type:'contains',from:String(runNode.id),to:node.id}));
  const nodes=[
    ...(runNode?[{...runNode,id:String(runNode.id),type:'run',label:String(runNode.label||'Runtime run'),agents:[...new Set(phases.flatMap(phase=>phase.agents))],usage:workflow.usage||{},phaseCount:phases.length,taskCount:taskNodes.length}]:[]),
    ...phases,
    ...expandedTasks,
    ...inputNodes,
    ...subagentNodes,
  ];
  if(runNode) phases.filter(phase=>!relations.some(rel=>rel.from===phase.id)).forEach(phase=>relations.push({id:'run-phase:'+phase.id,type:'starts',from:phase.id,to:String(runNode.id)}));
  // Without an active run of Donna's, the maintenance tree is what is moving:
  // select it by default instead of the idle run node.
  const donnaActive=['running','pending_approval','waiting'].includes(String(runtimeState?.status||'').toLowerCase());
  if(maintenanceGraph){nodes.push(...maintenanceGraph.nodes);relations.push(...maintenanceGraph.relations);}
  const nodeIds=new Set(nodes.map(node=>node.id));
  if(!selectedWorkflowNodeId||!nodeIds.has(selectedWorkflowNodeId)) selectedWorkflowNodeId=maintenanceGraph&&!donnaActive?'maintenance':workflow.current?.id&&nodeIds.has(workflow.current.id)?workflow.current.id:nodes[0]?.id||null;
  return {nodes,relations};
}
const RUNTIME_TASK_INPUT_LIMIT=40;
function runtimeTaskInputRefs(task) {
  const raw=task.raw||{};
  const refs=(Array.isArray(raw.inputRefs)?raw.inputRefs:[])
    .filter(ref=>!ref?.type||ref.type==='file')
    .map(ref=>String(typeof ref==='string'?ref:ref?.ref||''));
  const inputs=Array.isArray(raw.arguments?.inputs)?raw.arguments.inputs.map(String):[];
  return [...new Set([...refs,...inputs].map(value=>value.trim()).filter(Boolean))];
}
// What the live activity lines say the run is on right now (document label,
// detail, current file), lowercased for a basename match.
function runtimeActiveProgressText() {
  const lines=runtimeState?.workflow?.activity?.lines;
  const activities=Array.isArray(runtimeState?.activities)?runtimeState.activities:[];
  const progresses=[
    ...(Array.isArray(lines)?lines.filter(line=>isActivityActive(normalizeActivityStatus(line.status,false))).map(line=>line.progress):[]),
    ...activities.filter(item=>isActivityActive(normalizeActivityStatus(item.status,item.terminal))).map(item=>item.progress),
  ].filter(Boolean);
  return progresses.map(p=>[p.label,p.detail,p.currentFile,p.file,p.source].filter(Boolean).join(' ')).join(' | ').toLowerCase();
}
// Per-file states the production agent reads from the engine trace
// (basename -> running/done/failed), merged over the active progresses. A TAXO
// ingest is one task: this is how finished files turn green and the several
// sources the engine extracts at once show as running together.
function runtimeActiveSourceStates() {
  const lines=runtimeState?.workflow?.activity?.lines;
  const activities=Array.isArray(runtimeState?.activities)?runtimeState.activities:[];
  const states=new Map();
  [...(Array.isArray(lines)?lines.map(line=>line.progress):[]),...activities.map(item=>item.progress)]
    .forEach(progress=>{
      const map=progress?.sourceStates;
      if(map&&typeof map==='object') Object.entries(map).forEach(([name,value])=>states.set(String(name).toLowerCase(),String(value)));
    });
  return states;
}
function runtimeTaskInputNodes(task) {
  const refs=runtimeTaskInputRefs(task);
  if(!refs.length) return [];
  const status=String(task.status||'pending');
  const live=status==='running'?runtimeActiveProgressText():'';
  const fileStates=status==='running'?runtimeActiveSourceStates():new Map();
  const nodes=refs.slice(0,RUNTIME_TASK_INPUT_LIMIT).map((ref,index)=>{
    const name=ref.split('/').pop()||ref;
    const stem=name.replace(/\\.[^.]+$/,'').toLowerCase();
    // The agent's per-file state wins; without it (an older agent), only the
    // file the progress names is known to be in flight.
    const reported=fileStates.get(name.toLowerCase());
    const current=live&&(live.includes(name.toLowerCase())||(stem.length>3&&live.includes(stem)));
    const fileStatus=status==='running'?(reported||(current?'running':'pending')):status;
    return {id:'input:'+task.id+':'+index,type:'task_input',taskId:task.taskId,detailId:task.id,label:name,ref,status:fileStatus};
  });
  if(refs.length>RUNTIME_TASK_INPUT_LIMIT) nodes.push({id:'input:'+task.id+':more',type:'task_input',taskId:task.taskId,detailId:task.id,label:'+'+(refs.length-RUNTIME_TASK_INPUT_LIMIT)+' more file(s)',ref:'',status:status==='running'?'pending':status});
  return nodes;
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
// Subagent timestamps are ISO strings (event.ts in agentEvents.js), not epoch
// milliseconds. new Date(Number(iso)) is a NaN date, which the inspector
// rendered as "Invalid Date" for every role.
function runtimeSubagentTime(value) {
  if(value==null||value==='')return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleTimeString();
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
  const subagent=node.type==='subagent';
  // The live extraction processes of an ingestion phase (sourceStates), never
  // the single workspace-locked task that owns them. The batch size is the
  // phase's own input files; the configured capacity is shown beside it.
  const processTotal=node.sourceTotal||Object.values(node.sourceCounts||{}).reduce((sum,value)=>sum+value,0);
  const processRow=phase&&node.sourceCounts
    ? [['Files',(node.sourceCounts.done||0)+'/'+processTotal+' done · '+(node.sourceCounts.running||0)+' in progress'],['Model calls at once',runtimeWorkflowIngestionLimitLabel()]]
    : [];
  // A phase of one task has no concurrency to report (see the summary line).
  const concurrencyRows=node.total>1?[['Tasks',node.done+'/'+node.total+' done · '+(node.currentParallel||0)+' running (max '+node.parallelism+' at once)']]:[];
  const details=phase
    ? [['Status',node.status],...concurrencyRows,...processRow,['Agents',node.agents?.join(', ')||'Not reported'],['Tokens',formatRuntimeTokens(node.usage)]]
    : subagent
      ? [['Status',node.status],['Started',runtimeSubagentTime(node.startedAt)],['Finished',runtimeSubagentTime(node.finishedAt)]]
      : [['Status',node.status],['Phases',node.phaseCount||0],['Tasks',node.taskCount||0],['Agents',node.agents?.length||0],
        ...(Number.isFinite(Number(runtimeState?.concurrency?.limit))&&(node.taskCount||0)>1?[['Tasks at once (max)',Number(runtimeState.concurrency.limit)],['Agent recommended',runtimeState.concurrency.agentRecommended??'Not reported'],['Agent maximum',runtimeState.concurrency.agentMaximum??'Not reported'],['Manager cap',runtimeState.concurrency.ceiling??'Unset']]:[]),
        ...(runtimeWorkflowIngestionSummary()?[['Model calls at once',runtimeWorkflowIngestionLimitLabel()]]:[]),
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
  // The files the selected task (or a phase's only task) works on, with the
  // status the graph shows for each.
  const inputsTask=selectedTask?.task||(taskRows.length===1?taskRows[0].task:null);
  const inputNodes=inputsTask?nodes.filter(item=>item.type==='task_input'&&item.taskId===String(inputsTask.stepId||inputsTask.id).replace(/^task:/,'')):[];
  // How many files are finished and how many run at once: the parallelism of
  // a TAXO ingest lives inside its single task, so the task count says ×1.
  const inputCounts=inputNodes.reduce((acc,item)=>{ if(item.ref) acc[item.status]=(acc[item.status]||0)+1; return acc; },{});
  const inputsSummary=['done','running','failed'].filter(key=>inputCounts[key]).map(key=>' · '+inputCounts[key]+' '+key).join('');
  const inputList=inputNodes.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Inputs · \${runtimeTaskInputRefs(inputsTask).length} file(s)\${inputsSummary}</div><div class="runtime-inspector-inputs">\${inputNodes.map(item=>\`<div class="runtime-inspector-input" title="\${esc(item.ref)}"><span>\${esc(item.label)}</span><b class="\${esc(item.status)}">\${esc(item.status)}</b></div>\`).join('')}</div></div>\`:'';
  const html=\`<div class="runtime-inspector-title">\${esc(node.label)}</div><div class="runtime-inspector-meta">\${phase?'phase':run?'run':subagent?'subagent':esc(node.type)} · \${esc(node.status||'-')}</div><dl class="runtime-inspector-dl">\${details.map(([key,value])=>\`<dt>\${esc(key)}</dt><dd>\${esc(value)}</dd>\`).join('')}</dl>\${linked.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Sequence</div>\${linked.map(relationLine).join('')}</div>\`:''}\${taskList}\${taskFlow}\${inputList}<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Run journal</div>\${essentialRuntimeLogHTML()}</div>\`;
  // Same reason as for the frame: the inspector is rebuilt on every frame,
  // which reset the journal's scrolling during a run.
  if(inspector.__inspectorHTML===html) return;
  inspector.__inspectorHTML=html;
  const journal=inspector.querySelector('.runtime-inspector-section:last-child pre');
  const journalTop=journal?journal.scrollTop:0;
  const inputsBox=inspector.querySelector('.runtime-inspector-inputs');
  const inputsTop=inputsBox?inputsBox.scrollTop:0;
  const inspectorTop=inspector.scrollTop;
  inspector.innerHTML=html;
  const nextJournal=inspector.querySelector('.runtime-inspector-section:last-child pre');
  if(nextJournal&&journalTop>0) nextJournal.scrollTop=journalTop;
  const nextInputs=inspector.querySelector('.runtime-inspector-inputs');
  if(nextInputs&&inputsTop>0) nextInputs.scrollTop=inputsTop;
  if(inspectorTop>0) inspector.scrollTop=inspectorTop;
}
/* ── end Runtime Graph ─────────────────────────────────────────────── */`;
