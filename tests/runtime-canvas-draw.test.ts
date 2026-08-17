import { describe, expect, it } from 'vitest';
import { graphCanvasScript } from '../src/graph/core/canvas/graphCanvasScript.ts';
import { RUNTIME_CANVAS_SCRIPT } from '../src/chat/runtime/runtimeCanvasScript.ts';

/*
  Ces tests dessinent pour de vrai le graphe d'exécution Run/Task.

  tests/serve-graph.test.ts et tests/graph-canvas-core.test.ts n'inspectent que
  le texte de RUNTIME_CANVAS_SCRIPT : ils vérifient qu'une ligne y figure,
  jamais qu'elle s'exécute. Le cache de sprites du halo, et la retombée
  « rect » quand roundRect manque (Safari < 16), n'avaient donc aucune
  couverture réelle : la version du wiki (canvasExplorerScript.ts) est testée,
  pas celle-ci, et un retour au vieux cache non borné passerait la suite
  entièrement au vert.
*/

function makeContext(calls: string[], roundRect: boolean) {
  const context: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'left',
    font: '10px sans-serif',
  };
  const methods = [
    'createRadialGradient', 'createLinearGradient', 'fillRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo',
    'arc', 'quadraticCurveTo', 'fill', 'stroke', 'setLineDash', 'fillText', 'measureText', 'rect',
    'setTransform', 'drawImage', 'save', 'restore', 'closePath',
  ];
  for (const name of methods) {
    context[name] = (...args: unknown[]) => {
      calls.push(name);
      if (name === 'measureText') return { width: String(args[0] ?? '').length * 6 };
      if (name.startsWith('create')) return { addColorStop() {} };
      return undefined;
    };
  }
  if (roundRect) {
    context.roundRect = () => {
      calls.push('roundRect');
      return undefined;
    };
  }
  return context;
}

function makeElement(className: string) {
  const node: any = {
    className,
    hidden: false,
    dataset: {},
    style: {},
    rect: { left: 0, top: 0, right: 1400, bottom: 800, width: 1400, height: 800 },
    getBoundingClientRect: () => node.rect,
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
    set innerHTML(_value: string) {},
    get innerHTML() {
      return '';
    },
  };
  return node;
}

function mountRuntimeCanvas(options: { roundRect?: boolean } = {}) {
  const roundRect = options.roundRect ?? true;
  const calls: string[] = [];
  let spriteCreations = 0;

  const a11y = makeElement('runtime-graph-a11y');
  const canvas = makeElement('runtime-graph-canvas');
  canvas.parentElement = { querySelector: (selector: string) => (selector.includes('runtime-graph-a11y') ? a11y : null) };
  canvas.getContext = () => makeContext(calls, roundRect);

  let pending: ((now: number) => void) | null = null;
  let requested = 0;
  const timers: Array<{ callback: () => void; delay: number }> = [];

  const environment = {
    document: {
      body: { classList: { contains: () => false } },
      documentElement: { classList: { contains: () => false } },
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      createElement: (tag: string) => {
        if (tag === 'canvas') spriteCreations += 1;
        const offscreen = makeElement('offscreen');
        offscreen.width = 0;
        offscreen.height = 0;
        offscreen.getContext = () => makeContext(calls, roundRect);
        return offscreen;
      },
    },
    window: { addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    performance,
    requestAnimationFrame: (callback: (now: number) => void) => {
      pending = callback;
      return ++requested;
    },
    cancelAnimationFrame: () => {
      pending = null;
    },
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout: () => {},
  };

  const source = [graphCanvasScript(), RUNTIME_CANVAS_SCRIPT].join('\n');
  const names = [
    'document', 'window', 'matchMedia', 'devicePixelRatio', 'ResizeObserver', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'esc', 'shortText', 'selectedRuntimeWorkflowTaskId', 'selectedWorkflowNodeId', 'runtimeWorkflowGraphData',
  ];
  const build = new Function(
    ...names,
    `${source}\nreturn {create:createRuntimeCanvasRenderer};`,
  );
  const api = build(
    environment.document, environment.window, environment.matchMedia, environment.devicePixelRatio,
    environment.ResizeObserver, environment.performance, environment.requestAnimationFrame,
    environment.cancelAnimationFrame, environment.setTimeout, environment.clearTimeout,
    (value: unknown) => String(value),
    (value: unknown, max = 180) => String(value ?? '').slice(0, max),
    null,
    null,
    () => ({ nodes: [], relations: [] }),
  );

  const renderer = api.create(canvas);
  const origin = performance.now();

  return {
    renderer,
    calls,
    spriteCreations: () => spriteCreations,
    frame(now: number) {
      const callback = pending;
      pending = null;
      callback?.(origin + now);
      return pending !== null;
    },
    get pendingFrame() {
      return pending !== null;
    },
  };
}

describe('boucle de dessin du graphe d’exécution', () => {
  it('borne le cache de sprites pendant la pulsation d’un nœud en cours', () => {
    /*
     La pulsation anime l'alpha du halo, donc la clé du cache : sans
     quantification, chaque image créait un canvas hors écran jamais réutilisé.
     Soixante images ne doivent pas multiplier le cache par soixante. Le pas fin
     (100) garde le battement lisse sur la carte ; la plage du pulse (0.24→0.44)
     ne produit alors que ~23 sprites, loin d'un par image.
    */
    const view = mountRuntimeCanvas();
    view.renderer.setScene({
      nodes: [{ id: 'run', label: 'Runtime run', type: 'run', status: 'running', x: 0, y: 0, depth: 0.9 }],
      edges: [],
    });
    expect(() => view.frame(1000)).not.toThrow();
    for (let i = 0; i < 60; i += 1) {
      view.frame(1000 + i * 16);
    }
    expect(view.spriteCreations()).toBeGreaterThan(10);
    expect(view.spriteCreations()).toBeLessThan(40);
  });

  it('dessine les cartes sans roundRect via la retombée « rect »', () => {
    /*
     roundRect est récent (Safari 16+) : sans retombée, la carte levait en
     pleine image et le planificateur figeait le graphe après quelques échecs.
     Le navigateur qui n'a pas roundRect doit quand même dessiner la carte.
    */
    const view = mountRuntimeCanvas({ roundRect: false });
    view.renderer.setScene({
      nodes: [{ id: 'phase:ingest', label: 'Ingest', type: 'task_group', status: 'pending', x: 0, y: 0, depth: 1 }],
      edges: [],
    });
    expect(() => view.frame(1000)).not.toThrow();
    expect(view.calls).toContain('rect');
    expect(view.calls).not.toContain('roundRect');
  });
});
