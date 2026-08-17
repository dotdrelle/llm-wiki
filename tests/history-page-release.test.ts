import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryService } from '../src/services/historyService.ts';
import { handleWikiRoutes } from '../src/serve/routes/wikiRoutes.ts';

/*
 Ce que la page /history DIT une fois qu'un release existe.

 Le mécanisme — un tag git plutôt qu'une réécriture — est sûr. Les trois pièges
 sont dans le texte : juste après « Release this state » la liste principale est
 vide par construction, le compteur d'en-tête ne compte plus que ce qui suit le
 tag, et le repli annonce un total dont il n'affiche qu'une part.
*/

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-history-page-'));
  roots.push(root);
  await Promise.all(['wiki', 'templates', 'build-context', 'deliverables', '.wiki']
    .map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  return root;
}

/** Rend `/history` et retourne le HTML produit. */
async function renderHistory(root: string): Promise<string> {
  let html = '';
  const res = {
    writeHead() {},
    end(body: string) { html = body; },
  } as never;
  const handled = await handleWikiRoutes({ method: 'GET', url: '/history' } as never, res, '/history', {
    rootDir: root,
    sendJson: () => {},
    readRequestBody: async () => '',
    sendGzippedHtml: async (_req: unknown, _res: unknown, body: string) => { html = body; },
  } as never);
  expect(handled).toBe(true);
  return html;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('page /history autour d’un release', () => {
  it('ne déclare pas l’historique vide quand tout est simplement passé sous le release', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    for (const name of ['a', 'b']) {
      await writeFile(path.join(root, 'wiki', `${name}.md`), `# ${name}\n`, 'utf8');
      await history.commit({ command: 'build', message: `build: ${name}` });
    }
    const release = await history.createRelease();

    // L'état exact que l'utilisateur voit : la page se recharge juste après le
    // tag, donc rien n'a encore été commité par-dessus.
    const html = await renderHistory(root);

    expect(html).not.toContain('No workspace history available.');
    expect(html).toContain(`Nothing changed since ${release.name}`);
    // Et le repli, lui, annonce bien les commits conservés.
    expect(html).toContain(`commit(s) before ${release.name}`);
  });

  it('compte séparément ce qui suit le release et ce qui le précède', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'a.md'), '# a\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: a' });
    const release = await history.createRelease();
    await writeFile(path.join(root, 'wiki', 'b.md'), '# b\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: b' });

    const html = await renderHistory(root);

    // « 0 commit(s) » au-dessus d'un historique complet était le même mensonge
    // que la liste vide : le compteur ne portait que sur l'après-release.
    expect(html).toContain(`1 commit(s) since ${release.name} ·`);
    expect(html).toMatch(/· \d+ before it/);
  });

  it('sans release, garde son message et son compteur d’origine', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'a.md'), '# a\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: a' });

    const html = await renderHistory(root);

    expect(html).toContain('No release yet');
    expect(html).not.toContain('since release-');
  });
});
