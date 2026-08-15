import { describe, expect, it } from 'vitest';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';

const source = canvasExplorerScript();

/**
 * Reproduit le cadrage de la vue des domaines hors navigateur.
 *
 * Le calcul est le seul endroit du rendu dont on puisse vérifier le résultat
 * sans peindre de pixels — et c'est aussi celui qui décidait, à lui seul, que
 * le graphe s'affiche minuscule ou débordé.
 */
function frameScale(width: number, height: number, sizes: number[]) {
  const size = Math.min(width, height);
  const points = sizes.map((count, index) => {
    const angle = (Math.PI * 2 * index) / sizes.length - Math.PI / 2;
    const radius = sizes.length > 5 && index === 0 ? 0 : 0.34;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.62,
      r: 28 + Math.min(34, Math.sqrt(count) * 7),
    };
  });
  const x0 = Math.min(...points.map((p) => p.x));
  const x1 = Math.max(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y));
  const y1 = Math.max(...points.map((p) => p.y));
  const grow = Math.max(...points.map((p) => p.r + 10));
  const labelRoom = 38;
  const spanX = (x1 - x0) * size + grow * 2;
  const spanY = (y1 - y0) * size * 1.02 + grow * 2;
  const scale = Math.max(
    0.35,
    Math.min(
      9,
      Math.min(
        Math.max(240, width - 24) / spanX,
        (Math.max(200, height - 52) - labelRoom * 2) / spanY,
      ) * 0.98,
    ),
  );
  return { scale, spanX, spanY, labelRoom };
}

describe('vue des domaines', () => {
  it('cadre sans déborder, quels que soient le format et le nombre de domaines', () => {
    const cases: Array<[number, number, number[]]> = [
      [1200, 640, [19, 14, 11, 11, 5, 4, 2]],
      [640, 620, [19, 14, 11, 11, 5, 4, 2]],
      [1400, 360, [19, 14, 11, 11, 5, 4, 2]],
      [1200, 640, [30, 8, 4]],
      [1200, 640, [22, 18, 15, 12, 11, 9, 8, 6, 5, 4, 3, 2]],
      [1200, 640, [120]],
    ];
    for (const [width, height, sizes] of cases) {
      const { scale, spanX, spanY, labelRoom } = frameScale(width, height, sizes);
      // Le halo grandit AVEC l'échelle : c'est ce que l'ancienne heuristique
      // — deux constantes et un facteur 1.35 — ne pouvait pas modéliser, d'où
      // des débordements jusqu'à 164 px sur un cadre étroit.
      expect(spanX * scale).toBeLessThanOrEqual(width);
      expect(spanY * scale + labelRoom * 2).toBeLessThanOrEqual(height);
      // Et il faut remplir : un cadrage sans débord mais à 40 % du cadre
      // laisserait le graphe minuscule, le défaut d'origine.
      const fill = Math.max(spanX * scale / width, (spanY * scale + labelRoom * 2) / height);
      expect(fill).toBeGreaterThan(0.8);
    }
  });

  it('ne réintroduit pas le facteur d’échelle ajouté après coup', () => {
    // Le *1.35 compensait une formule fausse. Le rétablir masquerait à nouveau
    // le vrai calcul.
    expect(source).not.toContain('target.scale*1.35');
    expect(source).toContain('function communityRadius');
  });

  it('distingue les liens entre domaines des liens entre documents', () => {
    // Ils partageaient le rendu gris uniforme : « il existe un lien », sans
    // dire entre qui, ni combien de pages le portent.
    expect(source).toContain('function communityEdge');
    expect(source).toContain('createLinearGradient');
    expect(source).toMatch(/context\.fillText\(count/);
  });

  it('dessine une constellation, pas un cadran', () => {
    // Les membres étaient sur un cercle parfait à pas régulier. L'angle d'or
    // avec un rayon en racine remplit le disque sans jamais aligner deux
    // points.
    expect(source).toContain('2.399963');
    expect(source).toMatch(/Math\.sqrt\(memberIndex/);
  });

  it('reste lisible sur le thème clair', () => {
    // drawCommunity écrivait en #eef4fc quel que soit le thème : invisible sur
    // blanc.
    expect(source).not.toContain("context.fillStyle='#eef4fc'");
    const block = source.slice(source.indexOf('function drawCommunity'), source.indexOf('function cardWidth'));
    expect(block).toContain('pale');
  });

  it('ne peint jamais avant que la caméra et la scène existent', () => {
    // Le planificateur demande une image dès sa construction ; aujourd'hui
    // rien ne casse par chance de calendrier.
    expect(source).toContain('if(!camera||!state.scene)return');
  });

  /*
   L'ambiance reste vivante, mais pas à pleine cadence.

   Le premier correctif avait supprimé la boucle permanente à 60 FPS puis était
   allé trop loin : le régime réduit du scheduler n'était jamais branché, et le
   fond figé ne semblait reprendre vie qu'au passage de la souris. L'invariant
   n'est donc pas « aucune animation » mais « aucune animation à pleine cadence
   sans raison ».
  */
  it('anime la constellation à cadence réduite, jamais à pleine cadence', () => {
    expect(source).not.toContain("state.scene.level==='map')scheduler.animate");
    // 80 ms ≈ 12,5 images/s : le scheduler DORT entre deux images au lieu de se
    // réveiller à chaque rafraîchissement pour ne rien dessiner.
    expect(source).toContain('scheduler.idle(Number.POSITIVE_INFINITY,80)');
    // Le régime réduit reste soumis aux deux garde-fous du scheduler : onglet
    // masqué et prefers-reduced-motion.
    expect(source).not.toContain('setInterval');
  });

  it('n’anime que le halo temporaire, pas le scintillement de fond', () => {
    /*
     `state.animated` est vrai dès qu'une scène contient un domaine, donc en
     permanence en vue map. Passé par animate(), qui repousse son échéance à
     chaque image, il tenait le processus de rendu à 60 im/s tant que le graphe
     restait ouvert — chaque image redessinant la scène entière. C'est la charge
     d'une session laissée de côté, pas celle d'une interaction, et c'est le
     profil compatible avec la mort du processus de rendu observée.

     Le halo « nouveau » garde la pleine cadence : il est bref, il se regarde,
     et il s'éteint tout seul.
    */
    // Une convergence de fusion rejoint le halo au même régime : brève,
    // regardée, et rendant la scène au repos en s'achevant.
    expect(source).toContain('if(hasFreshGraphNodes()||hasGraphMerges())scheduler.animate(260)');
    expect(source).not.toContain('if(state.animated||hasFreshGraphNodes())scheduler.animate');
    expect(source).not.toContain('GRAPH_IDLE_FRAME_MS');
  });

  it('ne pose aucun flou d’ombre dans la boucle des étoiles', () => {
    /*
     shadowBlur est un flou gaussien plein cadre par appel de remplissage. Dans
     la boucle des membres — jusqu'à 48 par domaine — il produisait des
     centaines de passes par image : c'était la cause des à-coups. Un halo ne
     dépend que d'une couleur, donc il se pré-rend une fois.
    */
    const block = source.slice(source.indexOf('function drawCommunity'), source.indexOf('function cardWidth'));
    expect(block).not.toContain('shadowBlur');
    expect(block).toContain('paintGlow');
    expect(source).toContain('const sprites=new Map()');
  });

  it('cadre sur la zone laissée libre par les panneaux, pas sur le canevas', () => {
    /*
     Les panneaux sont posés par-dessus le canevas. Cadrer sur le canevas
     entier rangeait une partie du graphe sous l'inspecteur et laissait le
     côté opposé vide — y compris après un clic sur « Fit ».
    */
    expect(source).toContain("querySelectorAll('.inspector,.stage-title,.stage-tools')");
    expect(source).toContain('function measureFrame()');
    expect(source).toContain('fit(){measureFrame();');
    // La projection et le zoom à la molette doivent partager ce centre, sinon
    // le point sous le curseur se déplacerait pendant le zoom. La projection
    // passe désormais par une variable intermédiaire, pour pouvoir écarter les
    // tuiles que la fiche de contexte recouvre : c'est le calcul du centre qui
    // est l'invariant, pas la forme de l'expression.
    expect(source).toContain('x:box.x+(point.x-camera.state.x)*scale');
    expect(source).toContain('y:box.y+(point.y-camera.state.y)*scale');
    expect(source).toContain('worldX=camera.state.x+(point.x-box.x)/');
  });

  it('rend le canevas sans mini-carte', () => {
    // Sur une vue qui tient entière dans le cadre, elle n'orientait personne et
    // occupait un coin. Le cadrage et le fil d'Ariane suffisent.
    expect(source).not.toContain('graph-explorer-minimap');
    expect(source).not.toContain('drawMiniMap');
  });
});

describe('propriété du sous-arbre #canvas', () => {
  it('ne place aucun élément piloté par le script dans #canvas', async () => {
    // `createCanvasExplorer` fait `host.innerHTML = …` : tout ce qui se trouve
    // dans #canvas est détruit au premier rendu. Or `stateScript` capture
    // #inspector, #summary et #view-title UNE FOIS au chargement — les
    // références survivent, détachées, et les écritures partent dans le vide.
    // Aucune exception, aucun message : la navigation semble simplement ne
    // rien faire.
    const { renderWikiGraphV2 } = await import('../src/graph/wiki/graphApp.ts');
    const html = renderWikiGraphV2();
    const stage = html.slice(html.indexOf('<section class="stage">'));
    const canvas = stage.slice(stage.indexOf('<div id="canvas">'), stage.indexOf('<div class="stage-title"'));

    for (const id of ['view-title', 'summary', 'inspector', 'graph-breadcrumb', 'fit', 'zoom-in', 'fullscreen']) {
      expect(canvas).not.toContain(`id="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(source).toContain('host.innerHTML=');
  });
});

describe('index des domaines, colonne de gauche', () => {
  it('reste complet quel que soit le niveau affiché', async () => {
    const { graphUiFiltersScript } = await import('../src/graph/wiki/ui/core/filtersScript.ts');
    const filters = graphUiFiltersScript();

    // La liste se réduisait à ce que le graphe montrait : entrer dans un
    // domaine faisait disparaître tous les autres, et le seul moyen d'aller
    // voir ailleurs était de remonter à la carte — alors que cette colonne est
    // justement l'endroit où l'on sait déjà où l'on veut aller.
    expect(filters).toContain('function updateCommunityFilterCounts()');
    expect(filters).not.toContain('const visibleIds=new Set(nodes.map(n=>n.id))');
    // Seuls les filtres par type la font varier : ils portent sur ce qui
    // existe, pas sur ce qu'on regarde.
    expect(filters).toContain("document.querySelectorAll('[data-type]:checked')");
    // Le domaine courant est marqué et déplié.
    expect(filters).toContain("classList.toggle('is-current',id===selectedCommunity)");
    expect(filters).toContain('if(id===selectedCommunity&&!group.open)group.open=true');
  });

  it('navigue au clic, sans passer par un filtre', async () => {
    const { graphAppScript } = await import('../src/graph/wiki/ui/script.ts');
    expect(graphAppScript).toContain('selectCommunity(community.dataset.community)');
    expect(graphAppScript).toContain('updateCommunityFilterCounts();');
  });
});

describe('fin du geste de déplacement', () => {
  // Le graphe restait accroché au curseur après le relâchement : il fallait
  // recliquer pour s'en défaire. Le déplacement doit être strictement
  // conditionné au maintien du bouton.
  it('libère le graphe dès que le bouton est relâché, par quatre chemins', () => {
    // 1. relâchement normal
    expect(source).toContain("surface.addEventListener('pointerup',event=>endPointerGesture(event,coordinates(event)))");
    // 2. geste annulé par le navigateur — n'était écouté nulle part
    expect(source).toContain("surface.addEventListener('pointercancel'");
    // 3. bouton relevé sans que l'événement parvienne : le déplacement se
    //    vérifie à chaque mouvement, il ne fait pas confiance à la réception
    expect(source).toContain('if(event.buttons===0){endPointerGesture(event,null);return}');
    // 4. relâchement hors du canevas, sur un panneau ou hors de la fenêtre
    expect(source).toContain("window.addEventListener('pointerup',releaseOutside)");
    expect(source).toContain("window.addEventListener('blur',releaseOutside)");
  });

  it('libère la capture même sans événement, et retire ses écouteurs globaux', () => {
    // L'identifiant vient de la prise, pas de l'événement de fin : un
    // relâchement hors cadre n'en fournit aucun, et le canevas continuerait
    // d'intercepter les événements destinés aux panneaux.
    expect(source).toContain('const captured=state.pointer.pointerId');
    expect(source).toContain('surface.releasePointerCapture(captured)');
    // Ces écouteurs vivent sur window : sans retrait, un explorateur détruit
    // continuerait de réagir.
    expect(source).toContain("window.removeEventListener('pointerup',releaseOutside)");
  });
});

describe('domaines voisins restés repliés', () => {
  // Ouvrir un domaine filtrait toutes les relations qui en sortent : rien à
  // l'écran ne laissait deviner qu'une page renvoyait ailleurs.
  const scene = () => {
    const nodes = [
      { id: 'a1', title: 'Alpha 1', type: 'wiki', degree: 2 },
      { id: 'a2', title: 'Alpha 2', type: 'wiki', degree: 2 },
      { id: 'b1', title: 'Beta 1', type: 'wiki', degree: 2 },
      { id: 'c1', title: 'Gamma 1', type: 'wiki', degree: 1 },
    ];
    const data = {
      nodes,
      communities: [
        { id: 'alpha', label: 'Alpha', nodeIds: ['a1', 'a2'] },
        { id: 'beta', label: 'Beta', nodeIds: ['b1'] },
        { id: 'gamma', label: 'Gamma', nodeIds: ['c1'] },
      ],
      communityEdges: [],
      edges: [
        { from: 'a1', to: 'a2', type: 'related_to' },
        { from: 'a1', to: 'b1', type: 'related_to' },
        { from: 'a2', to: 'b1', type: 'related_to' },
        { from: 'a2', to: 'c1', type: 'related_to' },
      ],
    };
    const build = new Function(
      'data', 'selected', 'selectedCommunity', 'view', 'visible', 'localStorage', 'graphLeafDisplay',
      `${source}\nreturn canvasExplorerSceneDocuments;`,
    );
    return build(data, null, 'alpha', 'community', () => ({ nodes }), {
      getItem: () => null,
      setItem: () => {},
    }, (label: string) => (label ? label.charAt(0).toUpperCase() + label.slice(1) : label))();
  };

  it('représente chaque domaine voisin par une constellation repliée', () => {
    const groups = scene().nodes.filter((node: { type: string }) => node.type === 'community');
    expect(groups.map((group: { label: string }) => group.label).sort()).toEqual(['Beta', 'Gamma']);
    expect(groups.every((group: { collapsed: boolean }) => group.collapsed)).toBe(true);
  });

  it('rebranche les relations sortantes sur elles, en les agrégeant', () => {
    const beta = scene().nodes.find((node: { id: string }) => node.id === 'beta');
    // Deux pages du domaine ouvert pointent vers Beta : l'une et l'autre le
    // montrent, plutôt qu'un unique trait qui masquerait la provenance.
    expect(beta.links.map((link: { from: string }) => link.from).sort()).toEqual(['a1', 'a2']);
  });

  it('ne dessine pas ces liens depuis scene.edges, qui ignore les groupes', () => {
    const edges = scene().edges;
    expect(edges.map((edge: { from: string; to: string }) => `${edge.from}->${edge.to}`)).toEqual(['a1->a2']);
    expect(source).toContain('if(!node.collapsed||!node.links)return');
  });

  /*
   Le placement doit dire quelque chose de la relation.

   Répartis à pas régulier sur un cercle de rayon uniforme et dans l'ordre
   alphabétique, les voisins atterrissaient n'importe où : un domaine accroché
   en bas à gauche pouvait se retrouver plein nord, son lien traversant tout le
   nuage, pendant qu'un secteur libre restait vide et que le cadrage devait
   quand même englober l'anneau entier.
  */
  const placement = () => {
    // Deux pages du domaine ouvert, écartées horizontalement, et un voisin
    // accroché à chacune d'un côté seulement.
    const nodes = [
      { id: 'open/left', title: 'Gauche', type: 'wiki', degree: 2 },
      { id: 'open/right', title: 'Droite', type: 'wiki', degree: 2 },
      { id: 'west/1', title: 'Ouest', type: 'wiki', degree: 1 },
      { id: 'east/1', title: 'Est', type: 'wiki', degree: 1 },
    ];
    const data = {
      nodes,
      communities: [
        { id: 'open', label: 'Open', nodeIds: ['open/left', 'open/right'] },
        { id: 'west', label: 'West', nodeIds: ['west/1'] },
        { id: 'east', label: 'East', nodeIds: ['east/1'] },
      ],
      communityEdges: [],
      edges: [
        { from: 'open/left', to: 'open/right', type: 'related_to' },
        { from: 'open/left', to: 'west/1', type: 'related_to' },
        { from: 'open/right', to: 'east/1', type: 'related_to' },
      ],
    };
    const build = new Function(
      'data', 'selected', 'selectedCommunity', 'view', 'visible', 'localStorage', 'graphLeafDisplay',
      `${source}\nreturn canvasExplorerSceneDocuments;`,
    );
    const scene = build(data, null, 'open', 'community', () => ({ nodes }), {
      getItem: () => null,
      setItem: () => {},
    }, (label: string) => (label ? label.charAt(0).toUpperCase() + label.slice(1) : label))();
    const by = (id: string) => scene.nodes.find((node: { id: string }) => node.id === id);
    return { scene, by };
  };

  it('pose chaque voisin du côté par lequel il est relié', () => {
    const { by } = placement();
    const left = by('open/left');
    const right = by('open/right');
    const west = by('west');
    const east = by('east');
    const middle = (left.x + right.x) / 2;

    // « West » n'est cité que par la page de gauche, « East » que par celle de
    // droite : chacun se pose de son côté, aucun lien ne traverse le nuage.
    expect(Math.sign(west.x - middle)).toBe(Math.sign(left.x - middle));
    expect(Math.sign(east.x - middle)).toBe(Math.sign(right.x - middle));
  });

  it('les rapproche du nuage plutôt que de les poser sur un anneau uniforme', () => {
    const { by } = placement();
    const left = by('open/left');
    const right = by('open/right');
    const centre = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
    const spread = Math.max(
      Math.hypot(left.x - centre.x, left.y - centre.y),
      Math.hypot(right.x - centre.x, right.y - centre.y),
    );
    for (const id of ['west', 'east']) {
      const group = by(id);
      const distance = Math.hypot(group.x - centre.x, group.y - centre.y);
      // Dehors — un voisin ne se pose pas au milieu des fiches…
      expect(distance).toBeGreaterThan(spread);
      // …mais l'ancien couple (plancher .34 + marge .20) plaçait un petit
      // groupe à plus de trois fois son rayon. On reste dans le raisonnable.
      expect(distance).toBeLessThan(spread + Math.max(0.1, spread * 0.38) * 2.2);
    }
  });

  it('sépare deux voisins accrochés au même endroit, sans les ramener dedans', () => {
    // Même point d'accroche pour les deux : sans passe de séparation ils se
    // superposeraient exactement.
    const nodes = [
      { id: 'open/1', title: 'Un', type: 'wiki', degree: 2 },
      { id: 'open/2', title: 'Deux', type: 'wiki', degree: 1 },
      { id: 'x/1', title: 'X', type: 'wiki', degree: 1 },
      { id: 'y/1', title: 'Y', type: 'wiki', degree: 1 },
    ];
    const data = {
      nodes,
      communities: [
        { id: 'open', label: 'Open', nodeIds: ['open/1', 'open/2'] },
        { id: 'x', label: 'X', nodeIds: ['x/1'] },
        { id: 'y', label: 'Y', nodeIds: ['y/1'] },
      ],
      communityEdges: [],
      edges: [
        { from: 'open/1', to: 'open/2', type: 'related_to' },
        { from: 'open/1', to: 'x/1', type: 'related_to' },
        { from: 'open/1', to: 'y/1', type: 'related_to' },
      ],
    };
    const build = new Function(
      'data', 'selected', 'selectedCommunity', 'view', 'visible', 'localStorage', 'graphLeafDisplay',
      `${source}\nreturn canvasExplorerSceneDocuments;`,
    );
    const scene = build(data, null, 'open', 'community', () => ({ nodes }), {
      getItem: () => null,
      setItem: () => {},
    }, (label: string) => (label ? label.charAt(0).toUpperCase() + label.slice(1) : label))();
    const x = scene.nodes.find((node: { id: string }) => node.id === 'x');
    const y = scene.nodes.find((node: { id: string }) => node.id === 'y');
    expect(Math.hypot(x.x - y.x, x.y - y.y)).toBeGreaterThan(0.05);

    const documents = scene.nodes.filter((node: { type: string }) => node.type !== 'community');
    const centre = documents.reduce(
      (sum: { x: number; y: number }, node: { x: number; y: number }) => ({
        x: sum.x + node.x / documents.length,
        y: sum.y + node.y / documents.length,
      }),
      { x: 0, y: 0 },
    );
    const spread = Math.max(
      ...documents.map((node: { x: number; y: number }) => Math.hypot(node.x - centre.x, node.y - centre.y)),
    );
    for (const group of [x, y]) {
      expect(Math.hypot(group.x - centre.x, group.y - centre.y)).toBeGreaterThan(spread);
    }
  });
});

describe('cadrage automatique', () => {
  it('recadre quand la scène change, et seulement là', () => {
    /*
     Le repère mémorisé était le NIVEAU de vue. Passer d'un domaine à un autre
     n'en change pas : la caméra restait cadrée sur le précédent, et il fallait
     recentrer puis rezoomer à la main à chaque entité.
    */
    expect(source).toContain("const signature=scene.level+'#'+scene.nodes.map(node=>node.id).join('|')");
    // Troisième condition depuis : une révision de données n'est pas une
    // navigation et ne recadre pas non plus (cf. graph-camera-revision).
    expect(source).toContain('if(signature!==previous&&!grew&&!fromRevision){');
    // Un simple redessin ne bouge pas la caméra : sinon déplacer une fiche
    // relancerait un recadrage à chaque image.
    expect(source).not.toContain("state.viewports.get(scene.level)");
  });

  it('ne recadre pas une scène qui ne fait que s’enrichir', () => {
    /*
     Pendant un ingest, chaque page qui arrive change la liste des nœuds. Si ce
     seul fait déclenchait un recadrage, la vue sauterait toutes les quelques
     secondes en pleine lecture et annulerait zoom et déplacement. Ajouter
     n'est pas naviguer : tant que tout ce qui était affiché l'est encore, le
     cadrage appartient au lecteur.
    */
    expect(source).toContain(
      "const grew=!!previousIds&&scene.level===state.scene?.level&&[...previousIds].every(id=>nodeIds.has(id))",
    );
  });

  it('donne à chaque domaine un emplacement qu’il garde', () => {
    /*
     La position venait du rang dans la liste filtrée : l'arrivée d'un domaine
     redistribuait tous les autres, et suivre l'ajout des bulles pendant un
     ingest était impossible.
    */
    expect(source).toContain('function canvasExplorerSlot(id)');
    expect(source).toContain('canvasExplorerSlots.set(id,canvasExplorerSlots.size)');
    expect(source).toContain('const spot=canvasExplorerSlotPosition(item.id)');
    // La clé de position d'une fiche ne dépend plus de la topologie : elle
    // changeait précisément au moment où le graphe évoluait.
    expect(source).not.toContain("':'+data?.topologyEtag+':'");
  });

  it('pose les libellés à l’extérieur, sans les superposer', () => {
    /*
     Ils étaient écrits sous le nœud au moment de le dessiner : un libellé ne
     pouvait donc rien savoir de ceux qui suivaient, et ils se tassaient les uns
     sur les autres dès que la carte se remplissait.
    */
    expect(source).toContain('function drawLabels()');
    expect(source).toContain('state.labels.push(');
    expect(source).not.toContain("context.fillText(node.label.toUpperCase()");
    // Ce qui ne trouve pas sa place disparaît plutôt que de se superposer,
    // sauf pour les nœuds qui doivent rester nommés.
    expect(source).toContain('if(!item.always)return;');
  });

  it('résout l’échelle par point fixe et centre sur l’enveloppe', () => {
    /*
     L'échelle dépend de l'emprise, qui dépend de l'échelle : un halo grandit
     avec le zoom, une fiche non. C'était résolu par une division supposant que
     le nœud le plus large occupait les deux extrémités à la fois — une
     majoration qui n'arrive jamais et qui coûtait du zoom à chaque cadrage.

     Et le centre était celui des positions, pas celui de l'enveloppe : les
     libellés écrits sous les nœuds décalaient l'ensemble, d'où un graphe collé
     vers le bas même après « Fit ».
    */
    expect(source).toContain('function overflow(node,scale)');
    expect(source).toContain('const envelope=scale=>{');
    expect(source).toContain('for(let pass=0;pass<8;pass++)');
    expect(source).toContain('return{x:cx+(shape.left+shape.right)/2/(size*scale),y:cy+(shape.top+shape.bottom)/2/(size*scale)');
    // L'ancienne majoration ne doit pas revenir.
    expect(source).not.toContain('fixedX*2');
  });
});

describe('panneau unique', () => {
  it('affiche un seul cadre, dont le contenu suit le niveau', async () => {
    const { renderWikiGraphV2 } = await import('../src/graph/wiki/graphApp.ts');
    const html = renderWikiGraphV2();

    // Le focus document ouvrait sa propre fenêtre par-dessus l'inspecteur, qui
    // listait déjà les mêmes documents : deux cadres superposés pour une seule
    // information. Elle était de surcroît ajoutée au canevas, dont
    // l'explorateur remplace le contenu — donc détachée au premier redessin.
    expect(html).not.toContain('document-focus-window');
    expect(html).not.toContain('canvas.appendChild(windowElement)');

    // Les deux niveaux écrivent dans le même panneau, avec le même gabarit.
    expect(html).toContain('<small>DOCUMENT</small>');
    expect(html).toContain('<small>DOMAIN</small>');
    expect(html).toContain('.panel-head{');
    expect(html).toContain('.inspector .document-focus-list');
  });
});

describe('mise en page de la scène', () => {
  it('donne tout le cadre au graphe et fait flotter le reste au-dessus', async () => {
    const { renderWikiGraphV2 } = await import('../src/graph/wiki/graphApp.ts');
    const html = renderWikiGraphV2();

    // La barre de titre bordée et la colonne de 274 px se disputaient la
    // largeur avec le graphe pour n'afficher que quelques lignes de texte.
    expect(html).not.toContain('class="stage-head"');
    expect(html).toContain('main{grid-template-columns:var(--left-w) 5px minmax(500px,1fr)}');
    expect(html).toContain('class="stage-title"');

    // Le panneau de sélection est désormais un calque, dans la scène.
    expect(html.indexOf('class="inspector"')).toBeGreaterThan(html.indexOf('<section class="stage"'));
    expect(html).toContain('.inspector{position:absolute');
    expect(html).toContain('backdrop-filter:blur(12px)');

    // Et il reste lisible sur le thème clair, qui n'était pas traité.
    expect(html).toContain('body.theme-light .inspector');
    expect(html).toContain('body.theme-light .stage-title');
  });
});

/*
 Une bulle ne compte que ce qu'elle montre.

 Sur ACPI : sept domaines totalisant 101 pages sur une carte dont l'en-tête
 annonçait 88 documents. L'écart valait exactement le nombre de sources brutes,
 décochées dans les filtres — on ne gardait que les communautés ayant au moins
 une page visible, puis on réutilisait leur liste de membres ENTIÈRE. Le domaine
 héritant de la somme de ses feuilles, l'erreur se cumulait.

 L'index de gauche, lui, appliquait bien le filtre : deux compteurs
 contradictoires pour le même corpus dans la même fenêtre.
*/
describe('compte des pages sur la carte', () => {
  const build = (data: unknown, visibleIds: string[]) => {
    const factory = new Function(
      'data', 'selected', 'selectedCommunity', 'view', 'visible', 'localStorage',
      'graphDomainDisplay', 'graphLeafDisplay', 'graphMerging', 'graphMergeProgress',
      `${source}\nreturn { scene: canvasExplorerSceneMap, scoped: canvasExplorerVisibleCommunities };`,
    );
    return factory(
      data,
      null,
      null,
      'map',
      () => ({ nodes: visibleIds.map((id) => ({ id })), edges: [] }),
      { getItem: () => null, setItem: () => {} },
      (label: string) => String(label ?? '').toUpperCase(),
      (label: string) => (label ? label.charAt(0).toUpperCase() + label.slice(1) : label),
      // Aucune fusion en cours : ces deux-là appartiennent au script « live »,
      // qui n'est pas chargé ici.
      new Map(),
      () => 0,
    );
  };

  const corpus = () => ({
    workspace: 'w',
    domains: [{ id: 'dom', label: 'logiciel' }],
    communityParents: { a: 'dom', b: 'dom' },
    communities: [
      // Trois pages chacune, dont une seule source brute masquée par le filtre.
      { id: 'a', label: 'anaplan', nodeIds: ['a1', 'a2', 'raw-a'], documentCount: 3, conceptCount: 2, sourceCount: 1, internalRelations: 0, externalRelations: 0 },
      { id: 'b', label: 'board', nodeIds: ['b1', 'raw-b'], documentCount: 2, conceptCount: 1, sourceCount: 1, internalRelations: 0, externalRelations: 0 },
    ],
    communityEdges: [],
    nodes: [],
    edges: [],
  });

  it('ne compte pas les pages écartées par les filtres de type', () => {
    const api = build(corpus(), ['a1', 'a2', 'b1']);
    const scoped = api.scoped(new Set(['a1', 'a2', 'b1']));

    expect(scoped.map((item: { id: string; documentCount: number }) => [item.id, item.documentCount]))
      .toEqual([['a', 2], ['b', 1]]);
  });

  it('additionne sur le domaine ce que ses feuilles montrent réellement', () => {
    const api = build(corpus(), ['a1', 'a2', 'b1']);
    const bubble = api.scene().nodes.find((node: { id: string }) => node.id === 'dom');

    // 3 et non 5 : c'est le total affiché, pas celui du registre.
    expect(bubble.community.nodeIds).toHaveLength(3);
    expect(bubble.community.documentCount).toBe(3);
  });

  it('met le domaine en capitales et la feuille en initiale majuscule', () => {
    // Taxonomie plate : plus de domaine, les feuilles remontent à la racine.
    const flat = { ...corpus(), domains: [] as Array<{ id: string; label: string }>, communityParents: {} as Record<string, string> };

    expect(build(corpus(), ['a1', 'b1']).scene().nodes[0].label).toBe('LOGICIEL');
    const leaves = build(flat, ['a1', 'b1']).scene().nodes.map((node: { label: string }) => node.label);
    expect(leaves).toEqual(['Anaplan', 'Board']);
  });
});
