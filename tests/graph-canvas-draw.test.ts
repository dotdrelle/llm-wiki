import { describe, expect, it } from 'vitest';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import { graphUiSelectionScript } from '../src/graph/wiki/ui/core/selectionScript.ts';
import { graphCameraScript } from '../src/graph/core/canvas/graphCameraScript.ts';
import { graphFrameScript } from '../src/graph/core/canvas/graphFrameScript.ts';

/*
 Ces tests dessinent pour de vrai.

 Les tests existants inspectaient le texte du script : ils vérifiaient qu'une
 ligne était présente, jamais qu'elle s'exécutait. Une variable renommée à
 moitié (« members » devenu « shown » partout sauf au compteur de pages) est
 passée au travers et a produit trois régressions apparentes — la moitié des
 domaines invisibles, l'animation qui ne repart qu'au passage de la souris, le
 clic sans effet — pour une seule référence morte, parce qu'une exception dans
 la boucle de dessin emporte tout ce qui la suit.

 Un contexte 2D factice suffit à l'attraper : on ne juge pas de l'image, on
 vérifie que la boucle va jusqu'au bout et pose bien toutes ses cibles.
*/

type Fake = Record<string, unknown> & { calls: string[] };

function fakeContext(calls: string[]) {
  const methods = [
    'createRadialGradient', 'createLinearGradient', 'fillRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo',
    'arc', 'quadraticCurveTo', 'fill', 'stroke', 'setLineDash', 'fillText', 'measureText', 'roundRect',
    'setTransform', 'drawImage', 'save', 'restore', 'closePath',
  ];
  const context: Record<string, unknown> = {};
  for (const name of methods) {
    context[name] = (...args: unknown[]) => {
      calls.push(name);
      // Le navigateur lève sur ces deux cas ; le stub aussi, sinon le test
      // validerait des appels que Chrome refuse.
      if (name === 'drawImage') {
        if (!args[0]) throw new TypeError('drawImage: source manquante');
        if (args[3] === 0 || args[4] === 0) throw new Error('IndexSizeError');
      }
      if (name === 'measureText') return { width: String(args[0]).length * 6 };
      if (name.startsWith('create')) return { addColorStop() {} };
      return undefined;
    };
  }
  return context;
}

function fakeElement(className: string, calls: string[]): any {
  const node: any = {
    className,
    hidden: false,
    dataset: {},
    style: {},
    children: [] as any[],
    rect: { left: 0, top: 0, right: 1400, bottom: 800, width: 1400, height: 800 },
    getContext: () => fakeContext(calls),
    getBoundingClientRect: () => node.rect,
    querySelector: (selector: string) => node.children.find((child: any) => selector.includes(child.className)) ?? null,
    querySelectorAll: (selector: string) =>
      node.children.filter((child: any) => selector.split(',').some((part) => part.trim() === `.${child.className}`)),
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

function corpus() {
  const communities = Array.from({ length: 6 }, (_, index) => ({
    id: `c${index}`,
    label: `Domaine ${index}`,
    documentCount: 4 + index,
    nodeIds: Array.from({ length: 4 + index }, (_, member) => `c${index}/n${member}`),
  }));
  const nodes = communities.flatMap((community) =>
    community.nodeIds.map((id, member) => ({
      id,
      title: id,
      type: 'wiki',
      degree: member,
      community: { communityId: community.id, communityLabel: community.label },
    })),
  );
  return {
    workspace: 'w',
    topologyEtag: 'etag',
    nodes,
    communities,
    edges: [
      { from: 'c0/n0', to: 'c1/n0', type: 'related_to' },
      { from: 'c0/n1', to: 'c0/n2', type: 'related_to' },
      { from: 'c0/n2', to: 'c3/n1', type: 'related_to' },
    ],
    communityEdges: [
      { from: 'c0', to: 'c1', count: 2 },
      { from: 'c2', to: 'c3', count: 1 },
    ],
  };
}

const source = [graphFrameScript(), graphCameraScript(), canvasExplorerScript()].join('\n');
const palette = ['#4d9cff', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

function mount(view: 'map' | 'community', selectedCommunity: string | null) {
  const calls: string[] = [];
  const data = corpus();
  const surface = fakeElement('graph-explorer-canvas', calls);
  const a11y = fakeElement('graph-explorer-a11y', calls);
  const host = fakeElement('canvas-host', calls);
  host.children = [surface, a11y];

  const inspector = fakeElement('inspector', calls);
  inspector.rect = { left: 1080, top: 110, right: 1390, bottom: 600, width: 310, height: 490 };
  const title = fakeElement('stage-title', calls);
  title.rect = { left: 20, top: 90, right: 300, bottom: 140, width: 280, height: 50 };
  const tools = fakeElement('stage-tools', calls);
  tools.rect = { left: 1000, top: 78, right: 1390, bottom: 100, width: 390, height: 22 };
  const stage = fakeElement('stage', calls);
  stage.children = [host, inspector, title, tools];
  host.parentElement = stage;

  let pending: ((now: number) => void) | null = null;
  let requested = 0;
  const environment = {
    document: {
      body: { classList: { contains: () => false } },
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      createElement: () => {
        const offscreen = fakeElement('offscreen', calls);
        offscreen.width = 0;
        offscreen.height = 0;
        return offscreen;
      },
    },
    window: { addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: (now: number) => void) => {
      pending = callback;
      return ++requested;
    },
    cancelAnimationFrame: () => {
      pending = null;
    },
  };

  const visible = () => ({ nodes: data.nodes.map((node) => ({ ...node })), edges: data.edges.map((edge) => ({ ...edge })) });
  const args = [
    data, palette, null, selectedCommunity, view, (value: unknown) => String(value), () => {}, () => {}, () => {},
    visible, () => '', { getItem: () => null, setItem() {} },
    environment.document, environment.window, environment.matchMedia, 2, environment.ResizeObserver,
    environment.MutationObserver, environment.requestAnimationFrame, environment.cancelAnimationFrame,
  ];
  const names = [
    'data', 'colors', 'selected', 'selectedCommunity', 'view', 'esc', 'render', 'selectDocument', 'selectCommunity',
    'visible', 'graphIcon', 'localStorage', 'document', 'window', 'matchMedia', 'devicePixelRatio', 'ResizeObserver',
    'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  const build = new Function(
    ...names,
    `${source}\nreturn {create:createCanvasExplorer,map:canvasExplorerSceneMap,documents:canvasExplorerSceneDocuments};`,
  );
  const api = build(...args);
  const explorer = api.create(host);
  const scene = view === 'map' ? api.map() : api.documents();
  explorer.setScene(scene);

  return {
    scene,
    calls,
    frame(now: number) {
      const callback = pending;
      pending = null;
      callback?.(now);
      return pending !== null;
    },
    get pendingFrame() {
      return pending !== null;
    },
  };
}

describe('boucle de dessin du canevas', () => {
  it('dessine la carte entière sans lever, tous les domaines compris', () => {
    const view = mount('map', null);
    expect(view.scene.nodes).toHaveLength(6);
    expect(() => view.frame(1000)).not.toThrow();
    // Un halo par domaine et un par étoile : si la boucle s'arrêtait au premier
    // nœud, ce compte tomberait à celui d'un seul amas.
    const glows = view.calls.filter((call) => call === 'drawImage').length;
    expect(glows).toBeGreaterThan(30);
    // Deux libellés par domaine — le nom et le nombre de pages.
    const labels = view.calls.filter((call) => call === 'fillText').length;
    expect(labels).toBeGreaterThanOrEqual(12);
  });

  it('redemande une image tant que des constellations sont à l’écran', () => {
    /*
     C'est la boucle d'animation. Quand elle s'arrête, le scintillement ne
     reprend qu'au passage de la souris, chaque invalidation redemandant une
     image isolée — ce qui se lit comme « l'animation suit le curseur ».
    */
    const view = mount('map', null);
    expect(view.frame(1000)).toBe(true);
    expect(view.frame(1016)).toBe(true);
  });

  it('dessine aussi la vue d’un domaine et ses voisins repliés', () => {
    const view = mount('community', 'c0');
    expect(view.scene.nodes.some((node: any) => node.type === 'community')).toBe(true);
    expect(() => view.frame(1000)).not.toThrow();
    // La vue « community » contient des amas repliés : elle doit s'animer elle
    // aussi, la condition ne portant plus sur le niveau de vue.
    expect(view.frame(1016)).toBe(true);
  });

  it('ne descend que dans les pages qui ont au moins une relation', async () => {
    /*
     La vue focus d'une page isolée est un graphe d'un seul nœud : un
     cul-de-sac dont il faut ressortir par « Back ». Ces pages se sélectionnent
     donc sur place, pour être lues dans le panneau de droite.
    */
    const data = corpus();
    const build = new Function(
      'data', 'esc', 'inspector', 'render', 'document', 'window', 'colors',
      `let selected=null,selectedCommunity=null,view='community',focusHistory=[];
       ${graphUiSelectionScript()}
       return {select:selectDocument,state:()=>({view,selected:selected&&selected.id}),
               setView:next=>{view=next},hasRelations:documentHasRelations};`,
    );
    const api = build(
      data,
      (value: unknown) => String(value),
      { innerHTML: '' },
      () => {},
      {
        addEventListener() {},
        querySelector: () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, innerHTML: '' }),
        querySelectorAll: () => [],
        body: { classList: { contains: () => false } },
      },
      { addEventListener() {} },
      palette,
    );

    const linked = data.nodes.find((node) => node.id === 'c0/n0')!;
    const isolated = data.nodes.find((node) => node.id === 'c5/n8')!;
    expect(api.hasRelations(linked.id)).toBe(true);
    expect(api.hasRelations(isolated.id)).toBe(false);

    await api.select(linked);
    expect(api.state()).toEqual({ view: 'focus', selected: 'c0/n0' });

    api.setView('community');
    await api.select(isolated);
    // Sélectionnée, mais on reste dans son domaine.
    expect(api.state()).toEqual({ view: 'community', selected: 'c5/n8' });

    // Depuis la carte, aucune page n'est cliquable individuellement : on
    // descend d'un cran jusqu'à son domaine pour que la sélection se voie.
    api.setView('map');
    await api.select(isolated);
    expect(api.state().view).toBe('community');
  });

  it('ne laisse pas une image en échec emporter la boucle', () => {
    /*
     Sans cette garantie, la première exception fige le rendu définitivement et
     le symptôme ne ressemble plus du tout à la cause.
    */
    let attempts = 0;
    let pending: unknown = null;
    const environment = {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      document: { hidden: false, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame: (callback: (now: number) => void) => {
        pending = callback;
        return 1;
      },
      cancelAnimationFrame: () => {
        pending = null;
      },
    };
    const build = new Function(
      'matchMedia', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'draw',
      `${graphFrameScript()}\nreturn createGraphFrameScheduler(draw);`,
    );
    const scheduler = build(
      environment.matchMedia, environment.document, environment.requestAnimationFrame, environment.cancelAnimationFrame,
      () => {
        attempts += 1;
        throw new Error('image en échec');
      },
    );
    scheduler.invalidate();
    // Trois images de suite échouent, et chacune est bien retentée : l'erreur
    // remonte, la boucle survit.
    for (let step = 0; step < 3; step += 1) {
      const callback = pending as ((now: number) => void) | null;
      pending = null;
      expect(() => callback?.(step)).toThrow('image en échec');
      expect(pending).not.toBeNull();
    }
    expect(attempts).toBe(3);
    // …mais pas indéfiniment : au-delà de quelques échecs consécutifs, mieux
    // vaut une vue figée qu'une exception à chaque image.
    for (let step = 0; step < 6; step += 1) {
      const callback = pending as ((now: number) => void) | null;
      pending = null;
      try {
        callback?.(10 + step);
      } catch {
        /* attendu */
      }
    }
    expect(attempts).toBe(5);
    expect(pending).toBeNull();
  });
});
