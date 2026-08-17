import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleTreeApi, type TreeRoutesDeps } from '../src/serve/routes/treeRoutes.ts';
import { WIKI_LAYOUT_SCRIPT } from '../src/serve/html/wikiLayoutScript.ts';

/*
 Ce qu'une suppression depuis l'arbre laisse derrière elle.

 Elle effaçait le fichier sans écrire une ligne d'historique : la suppression
 flottait en `git status` jusqu'à ce qu'un `ingest:` ou un `build:` l'avale sous
 un message parlant d'autre chose. Et elle ne disait pas qui citait la page —
 or un lien mort se dégrade en texte brut au rendu, sans avertissement : le
 lecteur n'apprenait jamais ce qui avait disparu.
*/

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tree-delete-'));
  await mkdir(path.join(root, 'wiki/concepts'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function harness(overrides: Partial<TreeRoutesDeps> = {}) {
  const sent: Array<{ status: number; data: Record<string, unknown> }> = [];
  const commits: Array<{ path: string; kind: string }> = [];
  const deps: TreeRoutesDeps = {
    rootDir: root,
    readRequestBuffer: async () => Buffer.from(''),
    sendJson: (_res, status, data) => { sent.push({ status, data: data as Record<string, unknown> }); },
    commitDeletion: async (relativePath, kind) => { commits.push({ path: relativePath, kind }); },
    ...overrides,
  };
  return { deps, sent, commits };
}

/*
 `urlPath` arrive DÉCODÉ : `serve.ts` applique `decodeURIComponent` avant de
 router. Un harnais qui enverrait des `%2F` testerait un chemin que le handler
 ne voit jamais — et le refus de traversée passerait pour la mauvaise raison.
*/
const call = (deps: TreeRoutesDeps, method: string, urlPath: string, query = '') =>
  handleTreeApi({ method, url: urlPath + query } as never, {} as never, urlPath, deps);

describe('traçabilité d’une suppression depuis l’arbre', () => {
  it('écrit son propre commit, nommé, limité au chemin supprimé', async () => {
    await writeFile(path.join(root, 'wiki/concepts/a.md'), '# A\n', 'utf8');
    const { deps, sent, commits } = harness();

    await call(deps, 'DELETE', '/api/tree/wiki/concepts/a.md');

    expect(sent[0]?.status).toBe(200);
    expect(commits).toEqual([{ path: 'wiki/concepts/a.md', kind: 'file' }]);
  });

  it('ne transforme pas un échec de commit en échec de suppression', async () => {
    await writeFile(path.join(root, 'wiki/concepts/a.md'), '# A\n', 'utf8');
    // Un workspace sans historique, ou un commit qui casse : le fichier EST
    // parti, le dire échoué serait mentir dans l'autre sens.
    const { deps, sent } = harness({
      commitDeletion: async () => { throw new Error('history unavailable'); },
    });

    await call(deps, 'DELETE', '/api/tree/wiki/concepts/a.md');

    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.data.ok).toBe(true);
  });

  it('ne commite rien quand la suppression a été refusée', async () => {
    const { deps, sent, commits } = harness();

    // Hors des racines éditables : refusé avant tout accès disque.
    await call(deps, 'DELETE', '/api/tree/../../etc/passwd.md');

    expect(sent[0]?.data.ok).toBe(false);
    expect(commits).toHaveLength(0);
  });
});

describe('pages citant la cible, avant destruction', () => {
  it('répond le décompte et la liste bornée', async () => {
    const { deps, sent } = harness({
      countReferences: async (target) => (target === 'wiki/concepts/a.md'
        ? ['wiki/concepts/b.md', 'wiki/concepts/c.md']
        : []),
    });

    await call(deps, 'GET', '/api/tree/references', '?path=wiki%2Fconcepts%2Fa.md');

    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.data.count).toBe(2);
    expect(sent[0]?.data.pages).toEqual(['wiki/concepts/b.md', 'wiki/concepts/c.md']);
  });

  it('rend zéro plutôt qu’une erreur quand rien ne sait compter', async () => {
    const { deps, sent } = harness();
    await call(deps, 'GET', '/api/tree/references', '?path=wiki%2Fconcepts%2Fa.md');
    expect(sent[0]?.data.count).toBe(0);
  });
});

describe('confirmation affichée par le navigateur', () => {
  it('consulte les références avant de demander, et nomme le nombre', () => {
    expect(WIKI_LAYOUT_SCRIPT).toContain('/api/tree/references?path=');
    expect(WIKI_LAYOUT_SCRIPT).toContain("' page(s) link to it:");
  });

  it('demande aussi pour un fichier cité, et se tait pour un fichier isolé', () => {
    // La règle « seuls les dossiers demandent » n'était juste que pour une page
    // que personne ne cite.
    expect(WIKI_LAYOUT_SCRIPT).toContain("kind === 'folder' || citing === null || citing.length > 0");
  });

  it('traite un décompte impossible comme un doute, jamais comme un zéro', () => {
    expect(WIKI_LAYOUT_SCRIPT).toContain('Could not check which pages link to it.');
  });
});
