import { describe, expect, it } from 'vitest';
import { graphCanvasScript } from '../src/graph/core/canvas/graphCanvasScript.ts';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import { renderWikiGraphV2 } from '../src/graph/wiki/graphApp.ts';
import { RUNTIME_GRAPH_SCRIPT } from '../src/chat/runtime/runtimeGraphScript.ts';

describe('shared graph canvas foundation', () => {
  it('renders only while dirty or animating and pauses in hidden tabs', () => {
    const source = graphCanvasScript();

    expect(source).toContain('if(dirty||animating)request()');
    expect(source).toContain('document.hidden');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).not.toContain('setInterval');
  });

  it('provides interruptible camera transitions and bounded cursor zoom', () => {
    const source = graphCanvasScript();

    expect(source).toContain('function createGraphCamera');
    expect(source).toContain('function moveTo(next,ms=280)');
    expect(source).toContain("clamp(state.scale*factor,.35,9)");
    expect(source).toContain('scheduler.reducedMotion');
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
     Le cadrage automatique n'a lieu qu'au premier remplissage. Pendant un
     ingest la topologie change en continu — des tâches naissent et se
     terminent —, et chaque changement relançait un fit() animé : la vue
     sautait toutes les quelques secondes et annulait le placement manuel des
     bulles.
    */
    expect(RUNTIME_GRAPH_SCRIPT).toContain(
      'if(changed&&!state.userAdjusted&&!state.fitted&&state.width>=8&&state.height>=8){state.fitted=true;fit()}',
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
