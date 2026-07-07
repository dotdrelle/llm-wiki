import { graphInteractionsScript } from './graphInteractions.ts';
import { graphSelectionScript } from './graphSelection.ts';
import { graphViewportScript } from './graphViewport.ts';
import type { GraphEdge, GraphNode, GraphRenderDeps } from './graphTypes.ts';

export type { GraphEdge, GraphNode, GraphRenderDeps } from './graphTypes.ts';

export function renderGraphApp(
  nodes: GraphNode[],
  edges: GraphEdge[],
  etag: string,
  deps: GraphRenderDeps,
): string {
  return `<div class="graph-layout" data-graph-layout data-graph-etag="${deps.escapeAttr(etag)}"><div class="graph-panel"><div class="graph-search-wrapper" data-graph-search-wrapper><div class="graph-toolbar"><div class="graph-search-field"><input class="graph-search-input" type="search" placeholder="Search node..." aria-label="Search graph" data-graph-search autocomplete="off"><ul class="graph-search-dropdown" data-graph-search-dropdown hidden></ul></div><div class="graph-mode-group" role="tablist" aria-label="Graph mode"><button class="graph-mode-btn is-active" type="button" data-graph-mode="radial">Radial</button><button class="graph-mode-btn" type="button" data-graph-mode="dag">DAG</button></div><div class="graph-ctrl-group"><button class="graph-ctrl-btn" type="button" data-graph-zoom-in title="Zoom in">+</button><button class="graph-ctrl-btn" type="button" data-graph-zoom-out title="Zoom out">&#x2212;</button><button class="graph-ctrl-btn" type="button" data-graph-center title="Center on selection" style="font-size:0.9rem">&#x25CE;</button><button class="graph-ctrl-btn" type="button" data-graph-reset title="Reset view" style="font-size:0.9rem">&#x21BA;</button><button class="graph-ctrl-btn" type="button" data-graph-expand title="Expand graph" aria-label="Expand graph" aria-pressed="false" style="font-size:0.9rem">&#x2197;</button></div></div></div><div class="graph-stage"><svg class="graph-svg" viewBox="0 0 1100 720" role="img" aria-label="Navigable document and source graph" data-graph-svg><g data-graph-viewport><g data-link-layer></g><g data-node-layer></g></g></svg></div></div><aside class="relation-panel"><div class="relation-panel-header"><button class="relation-toggle" type="button" title="Show/hide relations" aria-label="Show/hide relations" data-relation-toggle>&#9776;</button><div class="relation-panel-copy"><h2 class="relation-panel-title" data-relation-panel-title>Relations</h2><p class="relation-panel-meta" data-relation-panel-meta>Open a relation to view linked Markdown.</p><dl class="relation-inspector"><dt>Type</dt><dd data-inspector-type>-</dd><dt>Path</dt><dd data-inspector-path>-</dd><dt>Links</dt><dd data-inspector-counts>-</dd></dl><a class="relation-node-open" data-relation-node-open href="#" hidden>Open page</a></div></div><ul class="relation-list" data-relation-list></ul></aside></div>
<div class="modal-backdrop" data-relation-modal><section class="relation-modal" role="dialog" aria-modal="true" aria-labelledby="relation-modal-title"><div class="modal-header"><h2 class="modal-title" id="relation-modal-title" data-modal-title>Relation</h2><button class="modal-close" type="button" aria-label="Close" data-modal-close>x</button></div><div class="modal-body"><article class="modal-doc"><h3 class="modal-doc-title" data-modal-target-title></h3><div class="modal-markdown" data-modal-target-body></div></article></div></section></div>
${renderGraphScript(nodes, edges, deps)}`;
}

function renderGraphScript(nodes: GraphNode[], edges: GraphEdge[], deps: GraphRenderDeps): string {
  const graphData = JSON.stringify({
    nodes,
    edges: edges.map((edge, index) => ({ ...edge, id: `rel-${index}` })),
  });
  return `<script type="application/json" id="graph-data">${deps.escapeScriptJson(graphData)}</script>
<script src="/assets/d3.min.js"></script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('graph-data').textContent || '{"nodes":[],"edges":[]}');
  if (!window.d3) {
    document.querySelector('[data-relation-list]').innerHTML = '<li class="relation-item">d3-force is unavailable: the local /assets/d3.min.js bundle could not be loaded.</li>';
    return;
  }
  const graphLayout = document.querySelector('[data-graph-layout]');
  const graphPanel = graphLayout?.querySelector('.graph-panel');
  const graphPage = graphLayout?.closest('main');
  const svg = document.querySelector('[data-graph-svg]');
  const viewport = document.querySelector('[data-graph-viewport]');
  const linkLayer = document.querySelector('[data-link-layer]');
  const nodeLayer = document.querySelector('[data-node-layer]');
  const relationList = document.querySelector('[data-relation-list]');
  const modal = document.querySelector('[data-relation-modal]');
  const modalTitle = document.querySelector('[data-modal-title]');
  const modalTargetTitle = document.querySelector('[data-modal-target-title]');
  const modalTargetBody = document.querySelector('[data-modal-target-body]');
  const modalClose = document.querySelector('[data-modal-close]');
  const searchInput = document.querySelector('[data-graph-search]');
  const searchDropdown = document.querySelector('[data-graph-search-dropdown]');
  const panelTitle = document.querySelector('[data-relation-panel-title]');
  const panelMeta = document.querySelector('[data-relation-panel-meta]');
  const panelNodeOpen = document.querySelector('[data-relation-node-open]');
  const inspectorType = document.querySelector('[data-inspector-type]');
  const inspectorPath = document.querySelector('[data-inspector-path]');
  const inspectorCounts = document.querySelector('[data-inspector-counts]');
  const btnZoomIn = document.querySelector('[data-graph-zoom-in]');
  const btnZoomOut = document.querySelector('[data-graph-zoom-out]');
  const btnCenter = document.querySelector('[data-graph-center]');
  const btnReset = document.querySelector('[data-graph-reset]');
  const btnExpand = document.querySelector('[data-graph-expand]');
  const btnRelationToggle = document.querySelector('[data-relation-toggle]');
  const modeButtons = [...document.querySelectorAll('[data-graph-mode]')];
  let nodes = data.nodes;
  let edges = data.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type || 'links_to', source: edge.from, target: edge.to }));
  let byId = new Map(nodes.map((node) => [node.id, node]));
  const nodeElements = new Map();
  const linkElements = [];
  const relationElements = new Map();
  const relationItems = new Map();
  let simulation = null;
  let selectedId = nodes[0]?.id || null;
  let dragNode = null;
  let panStart = null;
  let view = { x: 0, y: 0, scale: 1 };
  let searchQuery = '';
  let mode = 'radial';

  function normalizeGraphData(payload) {
    return {
      nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
      edges: Array.isArray(payload?.edges)
        ? payload.edges.map((edge, index) => ({
            id: edge.id || 'rel-' + index,
            from: edge.from,
            to: edge.to,
            type: edge.type || 'links_to',
            source: edge.from,
            target: edge.to,
          }))
        : [],
    };
  }

  async function refreshGraphWhenChanged() {
    const currentEtag = graphLayout?.dataset.graphEtag || '';
    if (!currentEtag) return;
    try {
      const response = await fetch('/api/graph-etag', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload?.etag && payload.etag !== currentEtag) {
        await reloadGraphData(payload.etag);
      }
    } catch {
      // Ignore transient polling failures.
    }
  }

  async function reloadGraphData(nextEtag) {
    const response = await fetch('/api/graph-data', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    const previousPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y, fx: node.fx, fy: node.fy }]));
    const normalized = normalizeGraphData(payload);
    nodes = normalized.nodes.map((node) => {
      const previous = previousPositions.get(node.id);
      return previous ? { ...node, x: previous.x, y: previous.y, fx: previous.fx, fy: previous.fy } : node;
    });
    edges = normalized.edges;
    byId = new Map(nodes.map((node) => [node.id, node]));
    if (selectedId && !byId.has(selectedId)) selectedId = nodes[0]?.id || null;
    graphLayout.dataset.graphEtag = payload.etag || nextEtag;
    render();
    applyView();
    if (searchQuery) {
      applySearchFilter(searchQuery);
      updateDropdown(searchQuery);
    }
  }

  function nodeMatchesSearch(node, query) {
    const q = query.toLowerCase();
    return node.id.toLowerCase().includes(q) || node.title.toLowerCase().includes(q) || String(node.group || '').toLowerCase().includes(q) || String(node.type || '').toLowerCase().includes(q);
  }

  function applySearchFilter(query) {
    searchQuery = query;
    if (!query) {
      for (const el of nodeElements.values()) el.classList.remove('is-dimmed');
      for (const entry of linkElements) entry.element.classList.remove('is-dimmed');
      if (selectedId) selectNode(selectedId);
      return;
    }
    const matchingIds = new Set(nodes.filter((n) => nodeMatchesSearch(n, query)).map((n) => n.id));
    for (const [nodeId, el] of nodeElements) {
      el.classList.toggle('is-dimmed', !matchingIds.has(nodeId));
      el.classList.toggle('is-selected', false);
    }
    for (const entry of linkElements) entry.element.classList.remove('is-connected');
  }

  function updateDropdown(query) {
    if (!query) { searchDropdown.hidden = true; searchDropdown.innerHTML = ''; return; }
    const matches = nodes.filter((n) => nodeMatchesSearch(n, query)).slice(0, 8);
    if (matches.length === 0) {
      searchDropdown.innerHTML = '<li class="graph-search-empty">No results</li>';
    } else {
      searchDropdown.innerHTML = matches.map((n) =>
        '<li class="graph-search-result" data-node-id="' + window.WikiUi.escapeHtml(n.id) + '">' +
        '<span class="graph-search-result-dot ' + n.type + '"></span>' +
        '<span class="graph-search-result-title">' + window.WikiUi.escapeHtml(n.title) + '</span>' +
        '<span class="graph-search-result-path">' + window.WikiUi.escapeHtml(n.secondary || n.id) + '</span>' +
        '</li>'
      ).join('');
    }
    searchDropdown.hidden = false;
  }

  function clearSearch() {
    if (!searchQuery) return;
    searchQuery = '';
    searchInput.value = '';
    searchDropdown.hidden = true;
  }

${graphViewportScript()}
${graphSelectionScript({ relationLabels: deps.relationLabels })}

  function render() {
    simulation?.stop();
    linkLayer.innerHTML = '';
    nodeLayer.innerHTML = '';
    linkElements.length = 0;
    nodeElements.clear();
    renderRelations();
    renderNodes();
    startSimulation();
    if (selectedId) selectNode(selectedId);
  }

  function renderRelations() {
    relationList.innerHTML = '';
    relationElements.clear();
    relationItems.clear();
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const item = document.createElement('li');
      item.className = 'relation-item';
      item.dataset.id = edge.id;
      item.innerHTML = '<span class="relation-kind"></span><span class="relation-path"><span class="relation-title"></span><span class="relation-subpath"></span></span><span class="relation-arrow">↓</span><span class="relation-path"><span class="relation-title"></span><span class="relation-subpath"></span></span><button class="relation-open" type="button">Open</button>';
      item.querySelector('.relation-kind').textContent = relationLabel(edge.type);
      const paths = item.querySelectorAll('.relation-path');
      paths[0].querySelector('.relation-title').textContent = from.title;
      paths[0].querySelector('.relation-subpath').textContent = from.id;
      paths[1].querySelector('.relation-title').textContent = to.title;
      paths[1].querySelector('.relation-subpath').textContent = to.id;
      item.querySelector('button').addEventListener('click', () => openRelation(edge.id));
      item.addEventListener('mouseenter', () => highlightRelation(edge.id));
      item.addEventListener('mouseleave', clearRelationHover);
      relationElements.set(edge.id, item);
      relationItems.set(edge.id, { edge, element: item });
    }
    if (edges.length === 0) relationList.innerHTML = '<li class="relation-item">No relations detected between Markdown documents.</li>';
    else sortRelations(selectedId);
  }

  function renderNodes() {
    for (const edge of edges) {
      const from = byId.get(edge.source);
      const to = byId.get(edge.target);
      if (!from || !to) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.classList.add('graph-link', edge.type);
      line.dataset.from = edge.source;
      line.dataset.to = edge.target;
      linkLayer.appendChild(line);
      linkElements.push({ element: line, edge });
    }
    for (const node of nodes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('graph-node', node.type);
      group.dataset.id = node.id;
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', String(node.r));
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = node.title;
      const secondary = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      secondary.setAttribute('text-anchor', 'middle');
      secondary.classList.add('graph-node-secondary');
      secondary.textContent = node.id;
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = node.id + ' · ' + node.degree + ' relation(s)';

      group.append(title, circle, label, secondary);
      group.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        dragNode = node;
        node.fx = node.x;
        node.fy = node.y;
        simulation?.alphaTarget(0.25).restart();
        group.classList.add('is-dragging');
        group.setPointerCapture(event.pointerId);
      });
      group.addEventListener('pointermove', (event) => {
        if (dragNode !== node) return;
        const point = svgPoint(event);
        node.fx = point.x;
        node.fy = point.y;
        updatePositions();
      });
      group.addEventListener('pointerup', (event) => {
        group.classList.remove('is-dragging');
        group.releasePointerCapture(event.pointerId);
        node.fx = null;
        node.fy = null;
        simulation?.alphaTarget(0);
        dragNode = null;
        clearSearch();
        selectNode(node.id);
      });
      group.addEventListener('focus', () => selectNode(node.id));
      group.addEventListener('dblclick', () => {
        window.location.href = node.href;
      });
      nodeLayer.appendChild(group);
      nodeElements.set(node.id, group);
    }
  }

  function setMode(nextMode) {
    mode = nextMode === 'dag' ? 'dag' : 'radial';
    graphLayout.dataset.graphMode = mode;
    modeButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.graphMode === mode));
    startSimulation();
  }

  function startSimulation() {
    simulation?.stop();
    const radial = mode === 'radial';
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((node) => node.id).distance((edge) => {
        const sourceDegree = edge.source.degree || 0;
        const targetDegree = edge.target.degree || 0;
        return radial ? 120 + Math.min(sourceDegree + targetDegree, 10) * 8 : 150;
      }).strength(radial ? 0.22 : 0.5))
      .force('charge', d3.forceManyBody().strength((node) => radial ? -170 - node.r * 8 : -260 - node.r * 12))
      .force('center', d3.forceCenter(550, 360))
      .force('collision', d3.forceCollide().radius((node) => node.r + 34).strength(0.9))
      .force('x', d3.forceX((node) => radial ? radialX(node) : dagX(node)).strength(radial ? 0.26 : 0.2))
      .force('y', d3.forceY((node) => radial ? radialY(node) : dagY(node)).strength(radial ? 0.26 : 0.2))
      .on('tick', updatePositions);
  }

  function radialX(node) {
    const angle = nodeAngle(node);
    const radius = [0, 210, 330, 430, 500][node.ring || 0] || 500;
    return 550 + Math.cos(angle) * radius;
  }

  function radialY(node) {
    const angle = nodeAngle(node);
    const radius = [0, 130, 210, 275, 320][node.ring || 0] || 320;
    return 360 + Math.sin(angle) * radius;
  }

  function nodeAngle(node) {
    const index = nodes.findIndex((item) => item.id === node.id);
    return nodes.length > 1 ? (Math.PI * 2 * index) / nodes.length - Math.PI / 2 : 0;
  }

  function dagX(node) {
    const order = ${JSON.stringify(deps.dagColumnOrder)};
    const col = Math.max(0, order.indexOf(node.type));
    return 120 + col * 175;
  }

  function dagY(node) {
    const sameType = nodes.filter((item) => item.type === node.type).sort((a, b) => a.title.localeCompare(b.title));
    const index = sameType.findIndex((item) => item.id === node.id);
    return 95 + index * 72;
  }

  function updatePositions() {
    for (const entry of linkElements) {
      const line = entry.element;
      const from = typeof entry.edge.source === 'object' ? entry.edge.source : byId.get(entry.edge.source);
      const to = typeof entry.edge.target === 'object' ? entry.edge.target : byId.get(entry.edge.target);
      if (!from || !to) continue;
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
    }
    for (const node of nodes) {
      const group = nodeElements.get(node.id);
      if (!group) continue;
      group.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');
      const labels = group.querySelectorAll('text');
      labels[0].setAttribute('y', String(node.r + 16));
      labels[1].setAttribute('y', String(node.r + 30));
    }
  }

  function relationWeight(edge) {
    const { sourceId, targetId } = edgeNodeIds(edge);
    return (byId.get(sourceId)?.degree || 0) + (byId.get(targetId)?.degree || 0);
  }

  function sortedRelationItems(focusId) {
    return [...relationItems.values()].sort((left, right) => {
      const leftIds = edgeNodeIds(left.edge);
      const rightIds = edgeNodeIds(right.edge);
      const leftFocused = focusId && (leftIds.sourceId === focusId || leftIds.targetId === focusId);
      const rightFocused = focusId && (rightIds.sourceId === focusId || rightIds.targetId === focusId);
      if (leftFocused !== rightFocused) return leftFocused ? -1 : 1;
      const weightDiff = relationWeight(right.edge) - relationWeight(left.edge);
      if (weightDiff !== 0) return weightDiff;
      return (leftIds.sourceId + leftIds.targetId).localeCompare(rightIds.sourceId + rightIds.targetId);
    });
  }

  function appendRelationLabel(text) {
    const label = document.createElement('li');
    label.className = 'relation-group-label';
    label.textContent = text;
    relationList.appendChild(label);
  }

  function sortRelations(focusId) {
    if (relationItems.size === 0) return;
    relationList.innerHTML = '';
    let focusedAdded = false;
    let otherAdded = false;
    for (const item of sortedRelationItems(focusId)) {
      const { sourceId, targetId } = edgeNodeIds(item.edge);
      const isFocused = Boolean(focusId && (sourceId === focusId || targetId === focusId));
      if (isFocused && !focusedAdded) {
        appendRelationLabel('Relations du noeud selectionne');
        focusedAdded = true;
      }
      if (!isFocused && !otherAdded) {
        appendRelationLabel(focusedAdded ? 'Autres relations' : 'Relations les plus connectees');
        otherAdded = true;
      }
      relationList.appendChild(item.element);
    }
  }

  function openRelation(id) {
    const edge = edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    const { sourceId, targetId } = edgeNodeIds(edge);
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    if (!source || !target) return;
    highlightRelation(id);
    modalTitle.textContent = source.title + ' -> ' + relationLabel(edge.type) + ' -> ' + target.title;
    modalTargetTitle.textContent = target.id;
    modalTargetBody.innerHTML = target.html;
    modal.classList.add('is-open');
  }

  function closeModal() {
    modal.classList.remove('is-open');
  }

  function selectAdjacentNode(delta) {
    if (nodes.length === 0) return;
    const index = Math.max(0, nodes.findIndex((node) => node.id === selectedId));
    const next = nodes[(index + delta + nodes.length) % nodes.length];
    selectNode(next.id);
    panToNode(next.id);
  }

${graphInteractionsScript()}

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    applySearchFilter(query);
    updateDropdown(query);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { applySearchFilter(''); updateDropdown(''); searchInput.value = ''; }
  });
  searchDropdown.addEventListener('click', (event) => {
    const result = event.target.closest('[data-node-id]');
    if (!result) return;
    const id = result.dataset.nodeId;
    clearSearch();
    applySearchFilter('');
    selectNode(id);
    panToNode(id);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-graph-search-wrapper]')) {
      searchDropdown.hidden = true;
    }
  });

  setGraphExpanded(false);
  bindGraphInteractions();
  // mode already defaults to 'radial', matching the static markup's initial
  // is-active state — render() already starts the simulation, so a follow-up
  // setMode('radial') here would just restart it for no visible change.
  render();
  setInterval(refreshGraphWhenChanged, 5000);
})();
</script>`;
}
