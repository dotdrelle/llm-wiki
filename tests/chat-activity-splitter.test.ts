import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import { SPLITTERS_SCRIPT } from '../src/chat/layout/splittersScript.ts';

/*
 Le rail Activity était large de 360px, fixes, derrière un simple border-left.

 Ce trait ressemble aux deux vraies poignées de cette mise en page — le
 séparateur de la barre latérale et celui des panneaux — jusqu'au grain visuel.
 Il invitait donc à un glissement qu'il ne pouvait pas honorer, sur le panneau
 qui en avait le plus besoin : celui qui affiche un graphe d'exécution et des
 chemins de fichiers complets.
*/

describe('poignée de redimensionnement du rail Activity', () => {
  it('existe dans le balisage, à côté du panneau', () => {
    expect(CHAT_HTML).toContain('id="activity-resizer"');
    // Même classe que la poignée de gauche : un seul style de préhension pour
    // un seul geste.
    expect(CHAT_HTML).toContain('id="activity-resizer" class="main-resizer"');
    expect(CHAT_HTML).toContain('role="separator" aria-orientation="vertical"');
  });

  it('se place après le panneau dans le DOM, et à sa gauche à l’écran', () => {
    /*
     CSS n'a pas de sélecteur de frère PRÉCÉDENT : pour que
     `#activity-panel.closed + #activity-resizer` puisse masquer la poignée
     quand le panneau est fermé, elle doit suivre le panneau dans le document.
     `order` la ramène visuellement à sa gauche.
    */
    expect(CHAT_HTML.indexOf('id="activity-resizer"'))
      .toBeGreaterThan(CHAT_HTML.indexOf('id="activity-panel"'));
    expect(CHAT_HTML).toContain('#activity-resizer{order:1}');
    expect(CHAT_HTML).toContain('#activity-panel.closed + #activity-resizer');
  });

  it('écrit la largeur que le panneau lit, et la persiste', () => {
    expect(SPLITTERS_SCRIPT).toContain('function initActivitySplitter()');
    expect(SPLITTERS_SCRIPT).toContain("panel.style.setProperty('--act-w'");
    expect(SPLITTERS_SCRIPT).toContain('localStorage.setItem(ACT_SPLIT_KEY');
    expect(CHAT_HTML).toContain("const ACT_SPLIT_KEY = 'mcpchat_activity_width';");
    expect(CHAT_HTML).toContain('initActivitySplitter();');
  });

  it('mesure depuis le bord droit, puisque le rail est ancré à droite', () => {
    // Le miroir de la barre latérale : celle-ci grandit avec clientX, le rail
    // grandit quand le pointeur va vers la GAUCHE. Le signe est tout le sujet.
    expect(SPLITTERS_SCRIPT).toContain('const rightEdge=panel.getBoundingClientRect().right;');
    expect(SPLITTERS_SCRIPT).toContain('setActivityW(rightEdge-e.clientX, true)');
  });

  it('borne la largeur des deux côtés', () => {
    // Plancher : le graphe d'exécution cesse d'être lisible. Plafond : la
    // conversation garde au moins 40 % de la fenêtre.
    expect(SPLITTERS_SCRIPT).toContain('Math.max(280, Math.min(width, Math.max(320, window.innerWidth*0.6)))');
  });

  it('coupe la transition pendant le glissement', () => {
    // Le panneau anime sa largeur ; gardée pendant le drag, cette animation
    // traîne d'une image derrière le pointeur et donne une poignée qui semble
    // cassée.
    expect(SPLITTERS_SCRIPT).toContain("panel.classList.add('resizing')");
    expect(CHAT_HTML).toContain('#activity-panel.resizing{transition:none}');
  });

  it('garde les deux séparateurs hors de chatHtml, sous sa garde de taille', () => {
    // L'extraction n'est pas cosmétique : chatHtml.ts touchait son plafond.
    expect(SPLITTERS_SCRIPT).toContain('function initMainSplitter()');
    expect(SPLITTERS_SCRIPT).toContain('function initActivitySplitter()');
  });
});
