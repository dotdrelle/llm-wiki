import { describe, expect, it } from 'vitest';
import { graphCanvasScript } from '../src/graph/core/canvas/graphCanvasScript.ts';
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
