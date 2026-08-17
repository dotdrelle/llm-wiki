import { describe, expect, it } from 'vitest';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import { graphUiSelectionScript } from '../src/graph/wiki/ui/core/selectionScript.ts';
import { graphCanvasScript } from '../src/graph/core/canvas/graphCanvasScript.ts';
import { graphFrameScript } from '../src/graph/core/canvas/graphFrameScript.ts';
import { graphUiLiveScript } from '../src/graph/wiki/ui/core/liveScript.ts';

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

// Le petit état de fraîcheur fait partie du même script dans l'application :
// la boucle de dessin peut l'interroger sans démarrer de polling ni de trafic
// réseau en arrière-plan.
const source = [graphCanvasScript(), canvasExplorerScript(), graphUiLiveScript()].join('\n');
const palette = ['#4d9cff', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

describe('halo des nouveaux nœuds', () => {
  it('ne maintient aucun rafraîchissement automatique du graphe', () => {
    const liveSource = graphUiLiveScript();
    expect(liveSource).not.toContain('setInterval');
    expect(liveSource).not.toContain('/api/graph/etag');
    expect(liveSource).not.toContain('visibilitychange');
    expect(liveSource).not.toContain('startGraphLiveWatch');
  });

  it('expire même lorsqu’un nouveau nœud est masqué', () => {
    /*
     Un nœud filtré n'est pas dessiné, donc graphNodeFreshness() ne peut pas
     supprimer son horodatage. La vérification globale doit purger elle-même
     les entrées expirées afin de ne pas entretenir la boucle d'animation.
    */
    expect(source).toContain('const cutoff=performance.now()-GRAPH_FRESH_MS');
    expect(source).toContain('graphFreshNodes.forEach((at,id)=>{if(at<=cutoff)graphFreshNodes.delete(id)});');
  });
});

function mount(
  view: 'map' | 'community',
  selectedCommunity: string | null,
  options: { fresh?: string } = {},
) {
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
  let spriteCreations = 0;
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const environment = {
    document: {
      body: { classList: { contains: () => false } },
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      createElement: (tag: string) => {
        if (tag === 'canvas') spriteCreations += 1;
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
    // Le régime réduit ne redemande pas une image tout de suite : il DORT, par
    // un timer. Sans stub, ce sommeil serait invisible au harnais et la boucle
    // paraîtrait arrêtée.
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout: () => {
      timers.length = 0;
    },
  };

  const visible = () => ({ nodes: data.nodes.map((node) => ({ ...node })), edges: data.edges.map((edge) => ({ ...edge })) });
  const args = [
    data, palette, null, selectedCommunity, view, (value: unknown) => String(value), () => {}, () => {}, () => {},
    visible, () => '', { getItem: () => null, setItem() {} },
    environment.document, environment.window, environment.matchMedia, 2, environment.ResizeObserver,
    environment.MutationObserver, environment.requestAnimationFrame, environment.cancelAnimationFrame,
    environment.setTimeout, environment.clearTimeout,
    // Même contrat que le helper réel : rien à afficher pour une relation
    // unique, qui est déjà dessinée.
    (count: number) => (count === 1 ? '' : `${count || 0} relations`),
    (label: string) => String(label ?? '').toUpperCase(),
    (label: string) => (label ? label.charAt(0).toUpperCase() + label.slice(1) : label),
  ];
  const names = [
    'data', 'colors', 'selected', 'selectedCommunity', 'view', 'esc', 'render', 'selectDocument', 'selectCommunity',
    'visible', 'graphIcon', 'localStorage', 'document', 'window', 'matchMedia', 'devicePixelRatio', 'ResizeObserver',
    'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'graphRelationsLabel', 'graphDomainDisplay', 'graphLeafDisplay',
  ];
  const build = new Function(
    ...names,
    `${source}\nreturn {create:createCanvasExplorer,map:canvasExplorerSceneMap,documents:canvasExplorerSceneDocuments,
       markFresh:id=>graphFreshNodes.set(id,performance.now())};`,
  );
  const api = build(...args);
  // Avant setScene : state.animated relève hasFreshGraphNodes() à ce moment-là.
  if (options.fresh) api.markFresh(options.fresh);
  const explorer = api.create(host);
  const scene = view === 'map' ? api.map() : api.documents();
  /*
   Le harnais doit dater ses images sur la MÊME ligne de temps que le code.

   `setScene` lance une transition de caméra, et `camera.moveTo` est appelé hors
   dessin : son échéance est donc posée avec `performance.now()`. Des estampilles
   arbitraires — 1000, 1080 — tombaient très loin derrière cette échéance, si
   bien que la transition paraissait éternellement en cours : la boucle restait
   à pleine cadence et n'atteignait jamais le régime réduit que ces tests
   vérifient. Le défaut était dans le harnais, pas dans l'ordonnanceur, mais il
   rendait deux tests rouges en permanence — donc muets sur ce qu'ils gardent.

   L'origine est prise ici : `frame(1000)` veut dire « 1000 ms après le montage »,
   ce qui est bien après les 320 ms de transition.
  */
  const origin = performance.now();
  explorer.setScene(scene);

  return {
    scene,
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
    get pendingTimers() {
      return timers.map((entry) => entry.delay);
    },
    // Fait expirer les sommeils en attente : chacun redemande alors une image.
    fireTimers() {
      const due = timers.splice(0, timers.length);
      due.forEach((entry) => entry.callback());
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

  it('anime les constellations stables à cadence réduite', () => {
    /*
     Sans interaction, transition ou halo, aucun rAF continu ne doit tourner.
     Un timer réveille la scène toutes les 80 ms pour l'ambiance seulement.
    */
    const view = mount('map', null);
    expect(view.frame(1000)).toBe(false);
    expect(view.pendingTimers).toEqual([80]);
    expect(view.fireTimers()).toBe(true);
    expect(view.frame(1080)).toBe(false);
    expect(view.pendingTimers).toEqual([80]);
  });

  it('borne le cache de sprites malgré le scintillement des étoiles', () => {
    /*
     Le scintillement animait l'alpha du halo, donc la clé du cache : chaque
     image créait un canvas hors écran par étoile, jamais réutilisé — une
     croissance non bornée qui finissait par tuer l'onglet. L'alpha est
     désormais quantifié : cinquante images ne doivent pas multiplier le cache
     par cinquante.
    */
    const view = mount('map', null);
    view.frame(1000);
    for (let i = 0; i < 50; i += 1) {
      view.fireTimers();
      view.frame(1160 + i * 80);
    }
    expect(view.spriteCreations()).toBeLessThan(1000);
  });

  it('dessine aussi la vue d’un domaine et ses voisins repliés', () => {
    const view = mount('community', 'c0');
    expect(view.scene.nodes.some((node: any) => node.type === 'community')).toBe(true);
    expect(() => view.frame(1000)).not.toThrow();
    // Les voisins repliés suivent la même cadence réduite, jamais un rAF libre.
    expect(view.pendingTimers).toEqual([80]);
    expect(view.fireTimers()).toBe(true);
  });

  it('garde la pleine cadence pour un nœud fraîchement arrivé', () => {
    /*
     Le halo « nouveau » est bref et se regarde : il passe par animate(), donc
     par une image immédiate, pas par le sommeil du scintillement.
    */
    const view = mount('map', null, { fresh: 'c0' });
    expect(view.frame(1000)).toBe(true);
    expect(view.pendingTimers).toEqual([]);
  });

  it('ne descend qu’au double-clic, jamais au simple clic', async () => {
    /*
     Le simple clic sélectionnait et descendait d'un cran dès deux relations :
     un clic sur une page bien connectée recadrait tout le graphe autour de son
     voisinage, masquant ce qu'on lisait. Le simple clic sélectionne et ouvre la
     fiche ; la descente reste au double-clic, où l'intention est explicite. Le
     seuil de deux voisins demeure pour ce double-clic.
     */
    const data = corpus();
    const cards: Array<string | null> = [];
    const build = new Function(
      'data', 'esc', 'inspector', 'render', 'document', 'window', 'colors',
      'openGraphContextCard', 'closeGraphContextCard', 'graphRelationsLabel', 'graphLeafDisplay', 'enabledTypes', 'graphNodeTypeById',
      `let selected=null,selectedCommunity=null,view='community',focusHistory=[];
       ${graphUiSelectionScript()}
       return {select:selectDocument,state:()=>({view,selected:selected&&selected.id}),
               setView:next=>{view=next},hasRelations:documentHasRelations,
               relations:documentRelationCount};`,
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
      (node: { id: string }) => cards.push(node.id),
      () => cards.push(null),
      (count: number) => (count === 1 ? '' : `${count || 0} relations`),
      (label: string) => (label ? label.charAt(0).toUpperCase() + label.slice(1) : label),
      () => new Set(['wiki']),
      () => new Map(data.nodes.map((node) => [node.id, node.type])),
    );

    const hub = data.nodes.find((node) => node.id === 'c0/n2')!;
    const single = data.nodes.find((node) => node.id === 'c0/n0')!;
    const isolated = data.nodes.find((node) => node.id === 'c5/n8')!;
    expect(api.relations(hub.id)).toBe(2);
    expect(api.relations(single.id)).toBe(1);
    expect(api.hasRelations(hub.id)).toBe(true);
    expect(api.hasRelations(single.id)).toBe(false);
    expect(api.hasRelations(isolated.id)).toBe(false);

    await api.select(hub);
    // Le simple clic ne descend pas : il sélectionne et ouvre la fiche.
    expect(api.state()).toEqual({ view: 'community', selected: 'c0/n2' });
    expect(cards).toEqual(['c0/n2']);

    api.setView('community');
    await api.select(single);
    expect(api.state()).toEqual({ view: 'community', selected: 'c0/n0' });
    expect(cards).toEqual(['c0/n2', 'c0/n0']);

    // Depuis la carte, on descend d'un cran jusqu'à la communauté de la page.
    api.setView('map');
    await api.select(isolated);
    expect(api.state().view).toBe('community');
    expect(cards).toEqual(['c0/n2', 'c0/n0', 'c5/n8']);
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
