import { describe, expect, it } from 'vitest';
import { graphUiLiveScript } from '../src/graph/wiki/ui/core/liveScript.ts';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';

const live = graphUiLiveScript();
const canvas = canvasExplorerScript();

describe('convergence d’une fusion', () => {
  /*
   Une bulle absorbée qui disparaît d'un coup laisse le lecteur devant trois
   domaines évaporés sans lui dire où sont passées leurs pages. La convergence
   raconte la fusion au lieu de la subir.
  */
  it('retient les bulles absorbées le temps de les faire converger', () => {
    expect(live).toContain('const graphMerging=new Map()');
    expect(live).toContain('function graphMergeProgress(id)');
    // Elles ne sont plus dans les données : c'est la scène qui les réinjecte.
    expect(canvas).toContain('function canvasExplorerMergingNodes(visibleIds)');
    expect(canvas).toContain('...canvasExplorerMergingNodes(visibleIds)');
  });

  it('ne joue que les fusions qu’on avait sous les yeux', () => {
    // Une fusion survenue avant l'ouverture de la page n'a rien à raconter :
    // l'utilisateur n'a jamais vu la bulle de départ.
    expect(live).toContain('if(knownCommunities.has(from)&&redirects[from])graphMerging.set(from,');
  });

  it('fait glisser la bulle de sa place vers sa cible', () => {
    expect(canvas).toContain('x:to.x+(from.x-to.x)*progress');
    expect(canvas).toContain('y:to.y+(from.y-to.y)*progress');
    // Et seulement si la cible est réellement affichée : converger vers une
    // bulle hors écran ne montrerait rien.
    expect(canvas).toContain('if(!progress||!visibleIds.has(entry.to))return');
  });

  it('n’affiche qu’un halo décroissant, sans membres', () => {
    // Le registre l'a dépréciée : elle n'a plus de pages à montrer, et en
    // dessiner donnerait une bulle vivante qui s'en va.
    expect(canvas).toContain('if(node.merging){');
    expect(canvas).toContain('context.globalAlpha=node.merging*.7');
  });

  /*
   Même purge défensive que le halo « nouveau » : une bulle absorbée dans un
   domaine qu'on n'affiche pas ne sera jamais interrogée, et sa seule présence
   maintiendrait la boucle d'animation active indéfiniment.
  */
  it('purge les convergences expirées, y compris invisibles', () => {
    expect(live).toContain('function hasGraphMerges()');
    expect(live).toContain('graphMerging.forEach((entry,id)=>{if(entry.at<=cutoff)graphMerging.delete(id)})');
  });

  it('rend la scène au repos une fois la convergence achevée', () => {
    // La condition d'animation est bornée par les deux transitoires : passé
    // leur durée, plus rien ne redemande d'image.
    expect(canvas).toContain('if(hasFreshGraphNodes()||hasGraphMerges())scheduler.animate(260)');
    expect(live).toContain('const GRAPH_MERGE_MS=900');
  });

  it('reste cohérent avec le remap de sélection et des positions', () => {
    // Les trois lisent la même table : une fusion déplace la sélection, migre
    // la position manuelle, et joue la convergence.
    const apply = live.slice(live.indexOf('function applyGraphRevision(next)'));
    expect(apply).toContain('graphMerging.set');
    expect(apply).toContain('migrateCanvasExplorerPositions(next.communityRedirects)');
    expect(apply).toContain('redirectGraphSelection(next.communityRedirects)');
  });
});
