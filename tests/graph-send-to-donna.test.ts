import { describe, expect, it } from 'vitest';
import { WIKI_PANEL_SCRIPT } from '../src/chat/views/wikiPanelScript.ts';
import { graphUiSelectionScript } from '../src/graph/wiki/ui/core/selectionScript.ts';

/*
 « Send to Donna », des deux côtés de la frontière postMessage.

 Le bouton devenait vert au clic, avant que le shell ait lu le message. Un
 chemin refusé — `raw/ingested/`, absent de l'allow-list alors que le graphe
 dessine ces pages et leur propose le bouton — était donc indiscernable d'un
 succès : rien n'arrivait dans le contexte, et l'interface disait le contraire.

 On teste les deux moitiés : ce que le shell accepte, et ce que le graphe ose
 affirmer avant d'avoir reçu la réponse.
*/

/** Extrait `validPageContext` du script du shell et l'évalue seule. */
function loadValidPageContext(): (path: string) => string | null {
  const start = WIKI_PANEL_SCRIPT.indexOf('function validPageContext');
  expect(start).toBeGreaterThan(-1);
  const end = WIKI_PANEL_SCRIPT.indexOf('\nfunction ', start + 1);
  const source = WIKI_PANEL_SCRIPT.slice(start, end);
  return new Function(
    'decodeWikiPath',
    `${source}\nreturn validPageContext;`,
  )((value: string) => String(value ?? ''));
}

describe('documents que le shell accepte en contexte', () => {
  const validPageContext = loadValidPageContext();

  it('accepte les trois racines de connaissance du workspace', () => {
    expect(validPageContext('/wiki/concepts/comparaison-securite.md')).toBe('wiki/concepts/comparaison-securite.md');
    expect(validPageContext('/raw/untracked/export.md')).toBe('raw/untracked/export.md');
    // La régression : le graphe propose « Send to Donna » sur une note de
    // source ingérée, et le shell la jetait en silence.
    expect(validPageContext('/raw/ingested/outils-de-gestion/synthese.md')).toBe('raw/ingested/outils-de-gestion/synthese.md');
  });

  it('refuse la traversée, les non-markdown et le hors-périmètre', () => {
    expect(validPageContext('/wiki/../etc/passwd.md')).toBeNull();
    expect(validPageContext('/wiki/concepts/page.txt')).toBeNull();
    expect(validPageContext('/deliverables/rapport.md')).toBeNull();
    expect(validPageContext('/templates/modele.md')).toBeNull();
  });
});

describe('marque de l’action Donna', () => {
  const source = graphUiSelectionScript();

  it('porte l’hexagone de Donna, plus la flèche de téléchargement', () => {
    /*
     Une flèche vers le bas au-dessus d'un trait, c'est « enregistrer sur le
     disque » partout ailleurs : sur un bouton qui envoie à l'assistant, elle
     annonçait la mauvaise action. L'hexagone reprend le ⬡ du shell.
    */
    expect(source).toContain('M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9Z');
    expect(source).not.toContain('m7 10 5 5 5-5');
    expect(source).not.toContain('M5 20h14');
  });

  it('garde l’œil sur l’aperçu, pour que les deux actions restent distinctes', () => {
    expect(source).toContain('<circle cx="12" cy="12" r="2.5"/>');
  });
});

/** Monte `sendDocumentToDonna` et son écouteur avec un faux parent. */
function mountSender(options: { embedded?: boolean } = {}) {
  const embedded = options.embedded ?? true;
  const posted: Array<{ type: string; path: string }> = [];
  const listeners: Array<(event: unknown) => void> = [];
  const origin = 'https://wiki.test';

  const win: Record<string, unknown> = {
    location: { origin },
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      if (name === 'message') listeners.push(handler);
    },
  };
  win.parent = embedded
    ? { postMessage: (message: { type: string; path: string }) => posted.push(message) }
    : win;

  const documentStub = {
    addEventListener() {},
    querySelector: () => ({ addEventListener() {}, hidden: true, innerHTML: '' }),
  };

  const api = new Function(
    'window', 'document', 'esc', 'json', 'graphRelationsLabel',
    `${graphUiSelectionScript()}\nreturn {send:sendDocumentToDonna};`,
  )(win, documentStub, (value: unknown) => String(value), async () => ({}), () => '');

  return {
    send: api.send as (id: string, button: unknown) => void,
    posted,
    reply(path: string, ok: boolean) {
      for (const handler of listeners) handler({ origin, data: { type: 'llmwiki:addContext:result', path, ok } });
    },
  };
}

function fakeButton() {
  const classes = new Set<string>();
  return { title: 'Send to Donna', classList: { add: (name: string) => classes.add(name) }, classes };
}

describe('accusé de réception du bouton « Send to Donna »', () => {
  it('n’annonce rien tant que le shell n’a pas répondu', () => {
    const view = mountSender();
    const button = fakeButton();
    view.send('raw/ingested/outils-de-gestion/synthese.md', button);

    expect(view.posted).toEqual([
      { type: 'llmwiki:addContext', path: '/raw/ingested/outils-de-gestion/synthese.md' },
    ]);
    // Le message est parti, rien n'est encore acquis.
    expect(button.classes.has('done')).toBe(false);
    expect(button.title).toBe('Send to Donna');
  });

  it('confirme sur un accord et signale un refus', () => {
    const accepted = mountSender();
    const ok = fakeButton();
    accepted.send('wiki/concepts/a.md', ok);
    accepted.reply('/wiki/concepts/a.md', true);
    expect(ok.classes.has('done')).toBe(true);
    expect(ok.title).toBe('Added to Donna');

    const rejected = mountSender();
    const nope = fakeButton();
    rejected.send('deliverables/rapport.md', nope);
    rejected.reply('/deliverables/rapport.md', false);
    expect(nope.classes.has('done')).toBe(false);
    expect(nope.title).toBe('This document cannot be added to Donna');
  });

  it('ne prétend rien quand le graphe est ouvert hors du shell', () => {
    // Pas de parent : il n'existe personne à qui envoyer, et l'ancien code
    // écrivait dans un sessionStorage que rien ne relisait tout en affichant
    // « Added to Donna ».
    const view = mountSender({ embedded: false });
    const button = fakeButton();
    view.send('wiki/concepts/a.md', button);

    expect(view.posted).toHaveLength(0);
    expect(button.classes.has('done')).toBe(false);
    expect(button.title).toBe('Open the graph inside the app to send documents to Donna');
  });
});
