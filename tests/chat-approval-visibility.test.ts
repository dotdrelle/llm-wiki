import { describe, expect, it } from 'vitest';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';
import { CHAT_MARKUP } from '../src/chat/views/chatView.ts';

/*
 Une approbation est une demande de niveau WORKSPACE, pas un message de chat.

 La bannière vivait dans `#input-wrap`, que la mise en page masque dans trois de
 ses quatre vues centrales : wiki, connectors, execution. Une restauration
 lancée depuis la page d'historique attendait donc une approbation que le
 lecteur ne pouvait pas voir — pas plus que depuis la vue Execution, celle qui
 sert justement à surveiller. Le shell n'a pas ce trou : son panneau de plan est
 toujours à l'écran.
*/

describe('visibilité de la demande d’approbation', () => {
  it('sort la bannière du composer', () => {
    const banner = CHAT_MARKUP.indexOf('id="approval-banner"');
    const inputWrap = CHAT_MARKUP.indexOf('id="input-wrap"');
    const inputBox = CHAT_MARKUP.indexOf('id="input-box"');
    expect(banner).toBeGreaterThan(-1);
    // Elle est après la boîte de saisie, donc hors du bloc qui la contenait.
    expect(banner).toBeGreaterThan(inputWrap);
    expect(banner).toBeGreaterThan(inputBox);
  });

  it('la place hors de #main, qui n’a pas la même mise en page selon le mode', () => {
    /*
     `#main` est une colonne flex en temps normal et une grille à placements
     explicites en mode split : tout nouvel enfant y demanderait un placement
     dans les deux. Une surcouche fixe n'appartient à aucune mise en page.
    */
    expect(CHAT_MARKUP.indexOf('id="approval-banner"'))
      .toBeGreaterThan(CHAT_MARKUP.indexOf('id="main"'));
    expect(CHAT_HTML).toContain('#approval-banner{position:fixed;');
  });

  it('reste au-dessus des vues centrales et lisible sur elles', () => {
    // Fond opaque et ombre : elle flotte désormais sur du contenu au lieu de
    // s'insérer dans le flux au-dessus du composer.
    expect(CHAT_HTML).toContain('z-index:60');
    expect(CHAT_HTML).toContain('background:var(--panel,#141a22)');
    expect(CHAT_HTML).not.toContain('#approval-banner{width:min(900px,100%);align-self:center;');
  });

  it('garde ses deux actions et son annonce assistive', () => {
    // Le point n'est pas de la voir mais de pouvoir répondre sans changer de
    // vue : les boutons partent avec elle.
    expect(CHAT_MARKUP).toContain('onclick="approveRuntimeRun()"');
    expect(CHAT_MARKUP).toContain('onclick="rejectRuntimeRun()"');
    expect(CHAT_MARKUP).toContain('role="alert" aria-live="assertive"');
  });

  it('n’est montrée que par le compteur d’approbations en attente', () => {
    expect(CHAT_HTML).toContain('function updateApprovalBanner()');
    expect(CHAT_HTML).toContain('#approval-banner[hidden]{display:none}');
  });
});
