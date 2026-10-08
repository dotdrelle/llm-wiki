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

  it('la place hors de #main, dans le dock fixe en bas à droite', () => {
    /*
     `#main` est une colonne flex en temps normal et une grille à placements
     explicites en mode split : tout nouvel enfant y demanderait un placement
     dans les deux. Le dock fixe n'appartient à aucune mise en page.
    */
    expect(CHAT_MARKUP.indexOf('id="approval-banner"'))
      .toBeGreaterThan(CHAT_MARKUP.indexOf('id="main"'));
    expect(CHAT_HTML).toContain("if(approval&&approval.parentElement!==dock)dock.append(approval);");
    expect(CHAT_HTML).toContain('#workspace-dock{position:fixed;z-index:116;right:48px;bottom:12px;');
  });

  it('prend la largeur du panneau Activity, texte en haut et boutons dessous', () => {
    // Largeur du rail Activity (--dock-w, écrite par sa poignée), hauteur
    // ajustée au contenu ; les deux actions se partagent la largeur.
    expect(CHAT_HTML).toContain('width:min(calc(var(--dock-w,360px) - 16px),calc(100vw - 64px))');
    expect(CHAT_HTML).toContain("document.documentElement.style.setProperty('--dock-w', clamped+'px');");
    expect(CHAT_HTML).toContain('.workspace-dock-card{box-sizing:border-box;display:flex;flex-direction:column;');
    expect(CHAT_MARKUP.indexOf('id="approval-banner-text"'))
      .toBeLessThan(CHAT_MARKUP.indexOf('class="approval-banner-actions"'));
    expect(CHAT_HTML).toContain('.approval-banner-actions .approval-btn{flex:1;');
    // Reste une alerte ambrée, jamais fondue dans le décor.
    expect(CHAT_HTML).toMatch(/#approval-banner\{[^}]*border-left:3px solid #f59e0b/);
    expect(CHAT_HTML).toContain('rgba(245,158,11,.16)');
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
