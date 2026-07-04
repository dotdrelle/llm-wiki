export function graphInteractionsScript(): string {
  return `
  function setGraphExpanded(expanded) {
    graphLayout.classList.toggle('graph-expanded', expanded);
    graphPage?.classList.toggle('graph-page-expanded', expanded);
    syncExpandedLegendPosition();
    if (btnExpand) {
      btnExpand.setAttribute('aria-pressed', expanded ? 'true' : 'false');
      btnExpand.title = expanded ? 'Collapse graph' : 'Expand graph';
      btnExpand.textContent = expanded ? '↙' : '↗';
    }
  }

  function syncExpandedLegendPosition() {
    if (!graphPage?.classList.contains('graph-page-expanded') || !graphPanel) {
      graphPage?.style.removeProperty('--graph-legend-left');
      return;
    }
    const left = Math.max(8, graphPanel.getBoundingClientRect().left + 12);
    graphPage.style.setProperty('--graph-legend-left', left + 'px');
  }

  function bindGraphInteractions() {
    window.addEventListener('resize', syncExpandedLegendPosition);
    svg.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.graph-node')) return;
      panStart = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
      svg.classList.add('is-panning');
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!panStart) return;
      view.x = panStart.viewX + (event.clientX - panStart.x);
      view.y = panStart.viewY + (event.clientY - panStart.y);
      applyView();
    });
    svg.addEventListener('pointerup', (event) => {
      panStart = null;
      svg.classList.remove('is-panning');
      svg.releasePointerCapture(event.pointerId);
    });
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
    }, { passive: false });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeModal(); clearSearch(); applySearchFilter(''); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') selectAdjacentNode(1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') selectAdjacentNode(-1);
      if (event.key === 'Enter' && selectedId) window.location.href = byId.get(selectedId)?.href || '#';
    });
    btnZoomIn.addEventListener('click', () => zoomBy(1.25));
    btnZoomOut.addEventListener('click', () => zoomBy(1 / 1.25));
    btnCenter.addEventListener('click', centerSelected);
    btnReset.addEventListener('click', resetView);
    btnExpand?.addEventListener('click', () => {
      setGraphExpanded(!graphLayout.classList.contains('graph-expanded'));
    });
    btnRelationToggle.addEventListener('click', () => {
      graphLayout.classList.toggle('relations-collapsed');
    });
    modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.graphMode)));
  }`;
}
