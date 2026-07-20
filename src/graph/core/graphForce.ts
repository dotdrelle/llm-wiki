// Radial force-layout mechanics shared by every D3 force-directed graph
// projection (wiki graph radial mode, runtime Run/Task graph). Kept
// deliberately limited to the reusable force primitives required by Run/Task
// chrome, which is wiki-specific UI, not part of the D3 socle itself.
export function graphForceScript(): string {
  return `
  function radialAngleOf(node, nodes) {
    const index = nodes.findIndex((item) => item.id === node.id);
    return nodes.length > 1 ? (index / nodes.length) * Math.PI * 2 - Math.PI / 2 : 0;
  }

  function computeRadialForceLayout(nodes, edges, options) {
    const {
      width = 1100,
      height = 720,
      ringRadii = [0, 210, 330, 430, 500],
      linkDistance = () => 120,
      linkStrength = 0.3,
      chargeStrength = () => -180,
      collidePadding = 20,
      ticks = 140,
    } = options || {};
    const cx = width / 2;
    const cy = height / 2;
    const ringRadius = (node) => ringRadii[node.ring || 0] ?? ringRadii[ringRadii.length - 1];
    nodes.forEach((node) => {
      if (node.x != null && node.y != null) return;
      const angle = radialAngleOf(node, nodes);
      const radius = ringRadius(node);
      node.x = cx + Math.cos(angle) * radius;
      node.y = cy + Math.sin(angle) * radius;
    });
    // d3.forceLink reads link.source/link.target, not the from/to naming
    // this socle's edges use elsewhere (see GraphEdge) — map onto a copy so
    // the link force actually pulls connected nodes together instead of
    // silently no-op'ing on undefined source/target.
    const forceLinks = edges.map((edge) => ({ ...edge, source: edge.source ?? edge.from, target: edge.target ?? edge.to }));
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(forceLinks).id((node) => node.id).distance(linkDistance).strength(linkStrength))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('x', d3.forceX((node) => cx + Math.cos(radialAngleOf(node, nodes)) * ringRadius(node)).strength(0.36))
      .force('y', d3.forceY((node) => cy + Math.sin(radialAngleOf(node, nodes)) * ringRadius(node)).strength(0.36))
      .force('collide', d3.forceCollide((node) => (node.r ?? node.radius ?? 14) + collidePadding).strength(0.9));
    if (options?.onTick) {
      simulation.on('tick', options.onTick);
    } else {
      simulation.stop();
      for (let i = 0; i < ticks; i += 1) simulation.tick();
    }
    return simulation;
  }

  function renderForceLinks(linkLayer, edges, nodes, edgeClassName) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const elements = [];
    for (const edge of edges) {
      const from = typeof edge.source === 'object' ? edge.source : byId.get(edge.source ?? edge.from);
      const to = typeof edge.target === 'object' ? edge.target : byId.get(edge.target ?? edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', edgeClassName ? edgeClassName(edge) : 'graph-force-link');
      line.dataset.from = from.id;
      line.dataset.to = to.id;
      line.setAttribute('x1', from.x);
      line.setAttribute('y1', from.y);
      line.setAttribute('x2', to.x);
      line.setAttribute('y2', to.y);
      linkLayer.appendChild(line);
      elements.push({ element: line, edge, from, to });
    }
    return elements;
  }

  function createForceNode(nodeLayer, node, { className, onSelect } = {}) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', className ? className(node) : 'graph-force-node');
    group.dataset.nodeId = node.id;
    group.setAttribute('tabindex', '0');
    group.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
    if (onSelect) group.addEventListener('click', () => onSelect(node.id));
    nodeLayer.appendChild(group);
    return group;
  }`;
}
