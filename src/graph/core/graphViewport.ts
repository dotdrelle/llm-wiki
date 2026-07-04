export function graphViewportScript(): string {
  return `
  function applyView() {
    viewport.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.scale + ')');
  }

  function zoomBy(factor) {
    const nextScale = Math.min(3, Math.max(0.35, view.scale * factor));
    view.x = view.x + 550 * (view.scale - nextScale);
    view.y = view.y + 360 * (view.scale - nextScale);
    view.scale = nextScale;
    applyView();
  }

  function panToNode(id) {
    const node = byId.get(id);
    if (!node || node.x == null) return;
    view.x = 550 - node.x * view.scale;
    view.y = 360 - node.y * view.scale;
    applyView();
  }

  function centerSelected() {
    const node = byId.get(selectedId);
    if (!node || node.x == null) return;
    const targetScale = Math.max(view.scale, 1.2);
    view.scale = targetScale;
    view.x = 550 - node.x * targetScale;
    view.y = 360 - node.y * targetScale;
    applyView();
  }

  function resetView() {
    view = { x: 0, y: 0, scale: 1 };
    applyView();
  }

  function svgPoint(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = viewport.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : { x: point.x, y: point.y };
  }`;
}
