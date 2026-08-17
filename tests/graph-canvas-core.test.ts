import { describe, expect, it } from 'vitest';
import { graphCanvasScript } from '../src/graph/core/canvas/graphCanvasScript.ts';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import { renderWikiGraphV2 } from '../src/graph/wiki/graphApp.ts';
import { RUNTIME_GRAPH_SCRIPT } from '../src/chat/runtime/runtimeGraphScript.ts';
import { RUNTIME_CANVAS_SCRIPT } from '../src/chat/runtime/runtimeCanvasScript.ts';

describe('shared graph canvas foundation', () => {
  it('renders only while dirty or animating and pauses in hidden tabs', () => {
    const source = graphCanvasScript();

    // Les échéances sont relues après le dessin : c'est lui qui les pose.
    expect(source).toContain('else if(dirty||(!reduced.matches&&now<animateUntil))request()');
    expect(source).toContain('document.hidden');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).not.toContain('setInterval');
  });

  /*
   Le scintillement de fond ne s'arrête jamais : passé par animate(), il tenait
   le processus de rendu à 60 im/s tant que le graphe restait ouvert, chaque
   image redessinant la scène entière. C'est la charge d'une session laissée de
   côté, pas celle d'une interaction. Il a donc son propre régime.
  */
  it('sépare la pleine cadence du scintillement de fond', () => {
    const source = graphCanvasScript();

    // Le régime réduit dort entre deux images au lieu de se réveiller à chaque
    // rafraîchissement de l'écran pour ne rien dessiner.
    expect(source).toContain('function requestLater(delay)');
    expect(source).toContain('else if(!reduced.matches&&now<idleUntil)requestLater(idleIntervalMs-(now-lastIdle))');
    expect(source).toContain('const idleDue=idling&&now-lastIdle>=idleIntervalMs');
    // Les échéances se posent sur l'estampille du dessin, pas sur une autre
    // horloge : c'est ce que run() relit ensuite.
    expect(source).toContain('function stamp(){return drawing?clock:performance.now()}');
    // Toujours pas de boucle libre : ni setInterval, ni rAF inconditionnel.
    expect(source).not.toContain('setInterval');
    // Le mouvement réduit reste prioritaire sur les deux régimes.
    expect(source).toContain('function idle(duration=260,intervalMs){\n    if(reduced.matches)return;');
    // Le timer doit mourir avec le planificateur, sinon il ressuscite une image
    // après la destruction de l'explorateur.
    expect(source).toContain('if(timer)clearTimeout(timer)');
  });

  it('réserve la pleine cadence au halo et garde l’ambiance à cadence réduite', () => {
    const source = canvasExplorerScript();

    // Une convergence de fusion rejoint le halo au même régime : brève,
    // regardée, et rendant la scène au repos en s'achevant.
    expect(source).toContain('if(hasFreshGraphNodes()||hasGraphMerges())scheduler.animate(260)');
    expect(source).toContain('scheduler.idle(Number.POSITIVE_INFINITY,80)');
    expect(source).not.toContain('GRAPH_IDLE_FRAME_MS');
  });

  it('provides interruptible camera transitions and bounded cursor zoom', () => {
    const source = graphCanvasScript();

    expect(source).toContain('function createGraphCamera');
    expect(source).toContain('function moveTo(next,ms=280)');
    expect(source).toContain("clamp(state.scale*factor,.35,9)");
    expect(source).toContain('scheduler.reducedMotion');
  });

  it('partage la retombée roundRect et le halo entre les deux graphes', () => {
    /*
     Le correctif Safari (< 16, pas de roundRect) et la quantification du cache
     de halos avaient été portés sur un seul des deux graphes. Ils vivent
     désormais dans le module partagé, et aucun consommateur ne contourne la
     retombée par un appel direct.
    */
    const shared = graphCanvasScript();
    expect(shared).toContain('function graphRoundedRect');
    expect(shared).toContain('else{context.rect(x,y,w,h)}');
    expect(shared).toContain('function createGraphGlow');
    expect(shared).toContain('function glowSprite(');
    // Aucun appel direct à roundRect ni duplication du halo hors du module partagé.
    expect(canvasExplorerScript()).not.toContain('context.roundRect(');
    expect(RUNTIME_CANVAS_SCRIPT).not.toContain('context.roundRect(');
    expect(canvasExplorerScript()).not.toContain('function glowSprite(');
    expect(RUNTIME_CANVAS_SCRIPT).not.toContain('function glowSprite(');
  });

  it('presents map, community, and focus as one Explore navigation', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('data-view="explore" class="active"');
    expect(html).toContain('id="graph-breadcrumb"');
    expect(html).toContain('function navigateGraphLevel(level)');
    expect(html).toContain("selectedCommunity=id;view='community'");
    expect(html).toContain("selected=node;selectedCommunity=node.communityId;view='focus'");
  });

  it('patches Activity/Execution Canvas state without refitting unchanged topology', () => {
    expect(RUNTIME_GRAPH_SCRIPT).toContain('function createRuntimeCanvasRenderer');
    expect(RUNTIME_GRAPH_SCRIPT).toContain('changed=topology!==state.topology');
    /*
     Mais un DÉPLIEMENT doit recadrer : les détails d'une tâche atterrissent
     dans une colonne dédiée à l'extrême droite, hors du cadre courant, et
     `state.fitted` interdisait le seul fit qui les aurait montrés. Le
     discriminant est le nombre de nœuds `task_detail` — ils n'existent que
     parce qu'un lecteur les a demandés — et non le nombre de nœuds, qui bouge
     tout seul pendant un ingest.
    */
    expect(RUNTIME_GRAPH_SCRIPT).toContain("node.type==='task_detail').length");
    expect(RUNTIME_GRAPH_SCRIPT).toContain('const opened=details(scene.nodes)!==details(state.scene.nodes);');
    /*
     Le cadrage automatique n'a lieu qu'au premier remplissage. Pendant un
     ingest la topologie change en continu — des tâches naissent et se
     terminent —, et chaque changement relançait un fit() animé : la vue
     sautait toutes les quelques secondes et annulait le placement manuel des
     bulles.
    */
    expect(RUNTIME_GRAPH_SCRIPT).toContain(
      'if((changed&&!state.fitted||opened)&&!state.userAdjusted&&state.width>=8&&state.height>=8){state.fitted=true;fit()}',
    );
    expect(RUNTIME_GRAPH_SCRIPT).toContain('const claimCamera=()=>{state.userAdjusted=true;state.fitted=true}');
    expect(RUNTIME_GRAPH_SCRIPT).toContain('runtimeCanvasPositions.set');
  });
});

describe('fiche de contexte et tuiles', () => {
  const source = canvasExplorerScript();

  it('écarte les tuiles à la projection, jamais dans le modèle', () => {
    /*
     La tuile cliquée changeait de place pour laisser tenir la fiche. Ce sont
     les tuiles GÊNÉES qui doivent s'écarter, et seulement le temps de la
     lecture : le décalage s'applique donc à la projection. Les positions
     normalisées et celles mémorisées dans localStorage restent intactes, les
     arêtes suivent puisqu'elles projettent les mêmes centres, et fermer la
     fiche suffit à tout remettre en place.
    */
    expect(source).toContain('function shiftOutOfObstacle(projected,point)');
    expect(source).toContain('state.obstacle?shiftOutOfObstacle(projected,point):projected');
    // Aucune écriture dans le modèle depuis la fonction de décalage.
    const shift = source.slice(source.indexOf('function shiftOutOfObstacle'));
    const body = shift.slice(0, shift.indexOf('\n  function '));
    expect(body).not.toMatch(/point\.(x|y)\s*[-+]?=/);
    expect(body).not.toContain('saveCanvasExplorerPosition');
  });

  it('laisse en place la tuile que la fiche décrit', () => {
    // Écarter le nœud ancré reproduirait exactement le défaut d'origine.
    expect(source).toContain("point.id&&point.id===state.anchor?.id");
  });

  it('libère les tuiles dès que la fiche se ferme', () => {
    expect(source).toContain('anchor(id,notify){state.anchor=id?{id,notify}:null;if(!id)state.obstacle=null;');
    expect(source).toContain('avoid(zone){');
  });
});
