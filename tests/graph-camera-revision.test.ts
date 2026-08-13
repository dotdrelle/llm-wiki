import { describe, expect, it } from 'vitest';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import { graphUiLiveScript } from '../src/graph/wiki/ui/core/liveScript.ts';

const canvas = canvasExplorerScript();
const live = graphUiLiveScript();

describe('caméra face à une révision', () => {
  /*
   `grew` couvrait la scène qui s'enrichit — tous les anciens nœuds toujours
   présents. Une fusion en supprime : la scène repassait en « nouvelle scène »
   et se recadrait au milieu de la lecture, annulant zoom et déplacement, alors
   que l'utilisateur n'avait rien demandé.

   Le critère retenu n'est pas un troisième test sur les ensembles de nœuds —
   il faudrait deviner ce qui a changé — mais la CAUSE du rendu : seule une
   navigation volontaire recadre.
  */
  it('ne recadre pas quand le rendu vient d’une révision', () => {
    expect(canvas).toContain('const fromRevision=state.dataRevision;state.dataRevision=false;');
    expect(canvas).toContain('if(signature!==previous&&!grew&&!fromRevision){');
  });

  it('conserve le recadrage d’une navigation volontaire', () => {
    // La condition d'origine reste : changement de signature et scène qui ne
    // fait pas que s'enrichir.
    expect(canvas).toContain('signature!==previous&&!grew');
    expect(canvas).toContain('camera.moveTo(saved||bounds(scene.nodes),saved?260:320)');
  });

  /*
   Un drapeau qui survivrait à son rendu figerait la caméra sur la navigation
   suivante, qui elle a le droit de recadrer. C'est le défaut classique d'un
   état à usage unique mal consommé.
  */
  it('consomme le drapeau à chaque rendu, pas seulement quand il sert', () => {
    const setScene = canvas.slice(canvas.indexOf('setScene(scene){'), canvas.indexOf('anchor(id,notify)'));
    // La remise à zéro précède la condition qui l'utilise.
    expect(setScene.indexOf('state.dataRevision=false')).toBeLessThan(setScene.indexOf('!fromRevision'));
  });

  it('part d’un état neutre', () => {
    expect(canvas).toContain('dataRevision:false');
  });

  it('est posé par l’application d’une révision, jamais par un geste', () => {
    expect(live).toContain('canvasExplorer?.markDataRevision()');
    // Il est posé avant le rendu déclenché par render().
    const apply = live.slice(live.indexOf('function applyGraphRevision(next)'));
    expect(apply.indexOf('markDataRevision')).toBeLessThan(apply.indexOf('render()'));
    // Et nulle part ailleurs : aucun gestionnaire d'événement ne le pose.
    expect(live.match(/markDataRevision/g)).toHaveLength(1);
  });

  it('n’expose le marqueur que sur l’explorateur, pas sur la scène', () => {
    // Le cœur Canvas reste générique : il ne connaît ni communauté ni fusion.
    expect(canvas).toContain('markDataRevision(){state.dataRevision=true}');
  });
});
