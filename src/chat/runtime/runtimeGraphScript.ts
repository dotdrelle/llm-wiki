import { graphForceScript } from '../../graph/core/graphForce.ts';

// Run/Task graph (0.10.2). Layout/render mechanics come from graph/core's
// shared D3 socle (graphForce.ts) — this file only supplies the runtime
// workflow projection and its own minimal inspector, per plan directeur §9.1
// (no toolbar/search/relation-modal chrome like the wiki graph; a plain
// graph + inspector pane is all this view needs).
export const RUNTIME_GRAPH_SCRIPT = `/* ── Runtime Graph ─────────────────────────────────────────────────── */
${graphForceScript()}
function runtimeWorkflowGraphHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-shell">\${runtimeWorkflowGraphCenterHTML()}<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside></div>\`;
}
function runtimeWorkflowGraphCenterHTML() {
  if(!runtimeState?.workflow?.nodes?.length) return '<div class="act-empty">No runtime workflow graph yet.</div>';
  return \`<div class="runtime-graph-main"><div class="runtime-graph-toolbar"><span>Run/Task graph</span><button type="button" onclick="renderRuntimeWorkflowGraph()">Center</button></div><svg class="runtime-graph-svg" id="runtime-graph-svg" viewBox="0 0 760 620" aria-label="Runtime workflow graph"></svg></div>\`;
}
function runtimeWorkflowInspectorHTML() {
  return '<aside class="runtime-graph-inspector" id="runtime-graph-inspector"></aside>';
}
function runtimeWorkflowGraphData() {
  const workflow=runtimeState?.workflow||{};
  const graph=workflow.graph||{};
  const sourceNodes=Array.isArray(graph.visibleNodes)&&graph.visibleNodes.length?graph.visibleNodes:workflow.nodes;
  const sourceRelations=Array.isArray(graph.visibleEdges)&&graph.visibleEdges.length?graph.visibleEdges:workflow.relations;
  const nodes=(Array.isArray(sourceNodes)?sourceNodes:[]).map((node,index)=>({
    ...node,
    id:String(node.id||node.key||node.itemId||'node-'+index),
    label:String(node.label||node.description||node.id||'Node'),
    type:String(node.type||'node'),
    status:String(node.status||'pending'),
  }));
  const nodeIds=new Set(nodes.map(node=>node.id));
  const relations=(Array.isArray(sourceRelations)?sourceRelations:[])
    .map((rel,index)=>({id:String(rel.id||'runtime-rel-'+index),type:String(rel.type||'related_to'),from:String(rel.from||rel.source||''),to:String(rel.to||rel.target||'')}))
    .filter(rel=>nodeIds.has(rel.from)&&nodeIds.has(rel.to));
  if(!selectedWorkflowNodeId||!nodeIds.has(selectedWorkflowNodeId)) selectedWorkflowNodeId=workflow.current?.id||nodes[0]?.id||null;
  return {nodes,relations};
}
function runtimeWorkflowRing(node) {
  if(node.type==='run') return 0;
  if(node.type==='task'||node.type==='queue') return 1;
  if(node.type==='executor'||node.type==='activity') return 2;
  if(node.type==='approval'||node.type==='replan') return 3;
  if(node.type==='output') return 4;
  return 3;
}
// Node bodies are a uniform gray card now (see renderRuntimeWorkflowGraph) —
// this only colors the small status-indicator dot at the card's top-right.
function runtimeWorkflowColor(node) {
  if(node.status==='failed') return '#f06b6b';
  if(node.status==='cancelled') return '#8a94a6';
  if(node.status==='done') return '#22c55e';
  if(node.status==='running') return '#4f7eff';
  if(node.status==='pending_approval') return '#f59e0b';
  const byType={run:'#8b5cf6',task:'#4f7eff',activity:'#14b8a6',executor:'#64748b',queue:'#f59e0b',approval:'#f97316',replan:'#a855f7',output:'#16a34a'};
  return byType[node.type]||'#94a3b8';
}
// Soft light-grey card (raised-button look) instead of the previous dark
// slate: the dark squares clashed with the light Execution background. The
// subtle stroke keeps the card visible on the pale canvas.
const RUNTIME_GRAPH_NODE_FILL='#e8ebef';
const RUNTIME_GRAPH_NODE_STROKE='#c9cfd8';
function renderRuntimeWorkflowGraph() {
  if(activityView!=='graph') return;
  const svg=$('runtime-graph-svg');
  if(!svg||!window.d3) {
    const inspector=$('runtime-graph-inspector');
    if(inspector) inspector.innerHTML='<div class="runtime-graph-empty">D3 unavailable.</div>';
    return;
  }
  const {nodes,relations}=runtimeWorkflowGraphData();
  svg.innerHTML='';
  const linkLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
  const nodeLayer=document.createElementNS('http://www.w3.org/2000/svg','g');
  svg.append(linkLayer,nodeLayer);
  nodes.forEach(node=>{
    node.ring=runtimeWorkflowRing(node);
    node.r=node.type==='run'?30:node.type==='task'?22:17;
  });
  computeRadialForceLayout(nodes,relations,{
    width:760,
    height:620,
    ringRadii:[0,120,215,300,370],
    linkDistance:edge=>edge.type==='depends_on'?92:118,
    linkStrength:0.42,
    chargeStrength:node=>node.type==='run'?-520:-170,
    collidePadding:20,
  });
  renderForceLinks(linkLayer,relations,nodes,edge=>'runtime-graph-link '+edge.type);
  for(const node of nodes) {
    const group=createForceNode(nodeLayer,node,{
      className:n=>'runtime-graph-node '+n.type+(n.id===selectedWorkflowNodeId?' selected':''),
      onSelect:selectRuntimeWorkflowNode,
    });
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    const side=node.r*1.7;
    rect.setAttribute('x',-side/2);
    rect.setAttribute('y',-side/2);
    rect.setAttribute('width',side);
    rect.setAttribute('height',side);
    rect.setAttribute('rx',Math.min(10,side*0.28));
    rect.setAttribute('ry',Math.min(10,side*0.28));
    rect.setAttribute('fill',RUNTIME_GRAPH_NODE_FILL);
    rect.setAttribute('stroke',RUNTIME_GRAPH_NODE_STROKE);
    rect.setAttribute('stroke-width','1');
    const statusDot=document.createElementNS('http://www.w3.org/2000/svg','circle');
    statusDot.setAttribute('class','runtime-graph-node-status');
    statusDot.setAttribute('r',5);
    statusDot.setAttribute('cx',side/2-2);
    statusDot.setAttribute('cy',-side/2+2);
    statusDot.setAttribute('fill',runtimeWorkflowColor(node));
    const label=document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('y',side/2+13);
    label.setAttribute('text-anchor','middle');
    label.textContent=shortText(node.label,24);
    group.append(rect,statusDot,label);
  }
  renderRuntimeWorkflowInspector();
}
function selectRuntimeWorkflowNode(id) {
  selectedWorkflowNodeId=id;
  renderRuntimeWorkflowGraph();
}
function renderRuntimeWorkflowInspector() {
  const inspector=$('runtime-graph-inspector');
  if(!inspector) return;
  const {nodes,relations}=runtimeWorkflowGraphData();
  const node=nodes.find(item=>item.id===selectedWorkflowNodeId)||nodes[0];
  if(!node) { inspector.innerHTML='<div class="runtime-graph-empty">No node selected.</div>'; return; }
  const linked=relations.filter(rel=>rel.from===node.id||rel.to===node.id);
  const logs=filteredRuntimeLogs(runtimeState?.logs);
  inspector.innerHTML=\`<div class="runtime-inspector-title">\${esc(node.label)}</div><div class="runtime-inspector-meta">\${esc(node.type)} · \${esc(node.status||'-')}</div><dl class="runtime-inspector-dl"><dt>Id</dt><dd>\${esc(node.id)}</dd><dt>Run</dt><dd>\${esc(runtimeState?.runId||runtimeState?.currentRunId||node.runId||'-')}</dd><dt>Turn</dt><dd>\${esc(runtimeState?.turnId||node.turnId||'-')}</dd><dt>Relations</dt><dd>\${linked.length}</dd></dl>\${linked.length?\`<div class="runtime-inspector-section">\${linked.map(rel=>\`<div class="runtime-inspector-rel">\${esc(rel.type)} · \${esc(rel.from)} → \${esc(rel.to)}</div>\`).join('')}</div>\`:''}\${logs.length?\`<div class="runtime-inspector-section"><div class="runtime-inspector-heading">Logs</div><pre>\${esc(logs.join('\\n'))}</pre></div>\`:''}\`;
}
/* ── end Runtime Graph ─────────────────────────────────────────────── */`;
