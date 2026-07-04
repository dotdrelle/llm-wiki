export function graphSelectionScript(deps: { relationLabels: Record<string, string> }): string {
  return `
  function connectedIds(id) {
    const ids = new Set([id]);
    for (const edge of edges) {
      const { sourceId, targetId } = edgeNodeIds(edge);
      if (sourceId === id) ids.add(targetId);
      if (targetId === id) ids.add(sourceId);
    }
    return ids;
  }

  function edgeNodeIds(edge) {
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    return { sourceId, targetId };
  }

  function relationLabel(type) {
    return (${JSON.stringify(deps.relationLabels)})[type] || 'relates to';
  }

  function selectNode(id) {
    selectedId = id;
    const node = byId.get(id);
    if (!node) return;
    const connected = connectedIds(id);
    panelTitle.textContent = node.title;
    panelMeta.textContent = node.secondary || node.id;
    inspectorType.textContent = node.type;
    inspectorPath.textContent = node.id;
    inspectorCounts.textContent = (node.inbound || 0) + ' in · ' + (node.outbound || 0) + ' out · ring ' + (node.ring ?? '-');
    if (panelNodeOpen) {
      panelNodeOpen.href = node.href;
      panelNodeOpen.hidden = false;
    }

    for (const [nodeId, element] of nodeElements) {
      element.classList.toggle('is-selected', nodeId === id);
      element.classList.toggle('is-dimmed', !connected.has(nodeId));
    }
    for (const entry of linkElements) {
      const { sourceId, targetId } = edgeNodeIds(entry.edge);
      const isConnected = sourceId === id || targetId === id;
      entry.element.classList.toggle('is-connected', isConnected);
    }
    for (const [relationId, element] of relationElements) {
      const edge = edges.find((candidate) => candidate.id === relationId);
      if (!edge) continue;
      const { sourceId, targetId } = edgeNodeIds(edge);
      element.classList.toggle('is-active', sourceId === id || targetId === id);
    }
    sortRelations(id);
  }

  function highlightRelation(id) {
    const edge = edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    const { sourceId, targetId } = edgeNodeIds(edge);
    for (const [nodeId, element] of nodeElements) {
      element.classList.toggle('is-hovered', nodeId === sourceId || nodeId === targetId);
    }
    for (const entry of linkElements) {
      entry.element.classList.toggle('is-hovered', entry.edge.id === id);
    }
    for (const [relationId, element] of relationElements) {
      element.classList.toggle('is-hovered', relationId === id);
    }
  }

  function clearRelationHover() {
    for (const element of nodeElements.values()) element.classList.remove('is-hovered');
    for (const entry of linkElements) entry.element.classList.remove('is-hovered');
    for (const element of relationElements.values()) element.classList.remove('is-hovered');
  }`;
}
