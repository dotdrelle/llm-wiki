import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TREE_ROOTS,
  createEntry,
  deleteEntry,
  moveEntry,
  resolveTreeRoot,
} from '../src/serve/tree/treeMutations.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tree-mutations-'));
  for (const section of ['wiki/concepts', 'templates', 'build-context', 'deliverables', 'raw/untracked']) {
    await mkdir(path.join(root, section), { recursive: true });
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const write = (relative: string, content = '# x\n') =>
  mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    .then(() => writeFile(path.join(root, relative), content, 'utf8'));

const exists = (relative: string) =>
  stat(path.join(root, relative)).then(() => true, () => false);

describe('périmètre autorisé', () => {
  it('reconnaît les cinq sections du panneau, et rien d’autre', () => {
    for (const section of ['wiki', 'templates', 'build-context', 'deliverables', 'raw/untracked']) {
      expect(resolveTreeRoot(`${section}/a.md`), section).not.toBeNull();
    }
    // Hors panneau : refusé, jamais corrigé en silence.
    expect(resolveTreeRoot('.wiki/cache/x.md')).toBeNull();
    expect(resolveTreeRoot('raw/ingested/x.md')).toBeNull();
    expect(resolveTreeRoot('.wikirc.yaml')).toBeNull();
  });

  it('refuse toute traversée, quelle que soit l’opération', async () => {
    await write('wiki/keep.md');
    for (const evil of ['wiki/../../etc/passwd', '../secrets.md', 'wiki/../.wikirc.yaml']) {
      const result = await deleteEntry(root, evil);
      expect(result.ok, evil).toBe(false);
    }
    expect(await exists('wiki/keep.md')).toBe(true);
  });

  it('ne laisse pas supprimer la racine d’une section', async () => {
    const result = await deleteEntry(root, 'wiki');
    expect(result.ok).toBe(false);
    expect(await exists('wiki')).toBe(true);
  });
});

describe('suppression', () => {
  it('emporte un dossier et tout son contenu', async () => {
    await write('wiki/concepts/a.md');
    await write('wiki/concepts/deep/b.md');

    const result = await deleteEntry(root, 'wiki/concepts');

    expect(result.ok).toBe(true);
    expect(await exists('wiki/concepts')).toBe(false);
  });

  it('refuse un fichier qui n’est pas du Markdown', async () => {
    await write('wiki/notes.txt', 'x');
    const result = await deleteEntry(root, 'wiki/notes.txt');
    expect(result.ok).toBe(false);
    expect(await exists('wiki/notes.txt')).toBe(true);
  });
});

describe('purge des dossiers vidés', () => {
  it('nettoie sous Pending, où un dossier n’est qu’un regroupement', async () => {
    await write('raw/untracked/lot-a/doc.md');

    await deleteEntry(root, 'raw/untracked/lot-a/doc.md');

    expect(await exists('raw/untracked/lot-a')).toBe(false);
    // Jamais la racine de la section elle-même.
    expect(await exists('raw/untracked')).toBe(true);
  });

  it('laisse un dossier wiki vide en place', async () => {
    // Un dossier vide dans le wiki est un rangement voulu ; le supprimer
    // reviendrait à défaire une décision que personne n'a demandé d'annuler.
    await write('wiki/concepts/reseau/a.md');

    await deleteEntry(root, 'wiki/concepts/reseau/a.md');

    expect(await exists('wiki/concepts/reseau')).toBe(true);
  });
});

describe('déplacement', () => {
  it('déplace un fichier dans un sous-dossier de sa section', async () => {
    await write('wiki/a.md');
    await mkdir(path.join(root, 'wiki/concepts/reseau'), { recursive: true });

    const result = await moveEntry(root, 'wiki/a.md', 'wiki/concepts/reseau');

    expect(result.ok).toBe(true);
    expect(await exists('wiki/concepts/reseau/a.md')).toBe(true);
    expect(await exists('wiki/a.md')).toBe(false);
  });

  it('ramène à la racine de la section quand la destination est vide', async () => {
    await write('templates/sous/x.md');

    const result = await moveEntry(root, 'templates/sous/x.md', '');

    expect(result.ok).toBe(true);
    expect(await exists('templates/x.md')).toBe(true);
  });

  it('refuse un déplacement d’une section à une autre', async () => {
    // Un template posé dans wiki/ n'est plus un template, et rien dans
    // l'interface ne dirait ce qu'il est devenu.
    await write('templates/rapport.md');

    const result = await moveEntry(root, 'templates/rapport.md', 'wiki');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/between sections/);
    expect(await exists('templates/rapport.md')).toBe(true);
  });

  it('refuse de déplacer un dossier dans lui-même', async () => {
    await write('wiki/concepts/a.md');

    const inside = await moveEntry(root, 'wiki/concepts', 'wiki/concepts');
    const descendant = await moveEntry(root, 'wiki/concepts', 'wiki/concepts/sub');

    expect(inside.ok).toBe(false);
    expect(descendant.ok).toBe(false);
    expect(await exists('wiki/concepts/a.md')).toBe(true);
  });

  it('n’écrase jamais une entrée existante', async () => {
    await write('wiki/a.md', 'source');
    await write('wiki/concepts/a.md', 'destination');

    const result = await moveEntry(root, 'wiki/a.md', 'wiki/concepts');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(await exists('wiki/a.md')).toBe(true);
  });

  it('signale un déplacement sans effet plutôt que d’échouer', async () => {
    await write('wiki/a.md');
    const result = await moveEntry(root, 'wiki/a.md', 'wiki');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.unchanged).toBe(true);
  });
});

describe('création', () => {
  it('crée un dossier dans une section', async () => {
    const result = await createEntry(root, 'templates', 'rapports', 'folder');

    expect(result.ok).toBe(true);
    expect(await exists('templates/rapports')).toBe(true);
  });

  it('ajoute l’extension attendue à un fichier qui n’en a pas', async () => {
    const result = await createEntry(root, 'wiki', 'nouvelle-page', 'file');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.path).toBe('wiki/nouvelle-page.md');
  });

  it('refuse un nom qui porte un séparateur', async () => {
    // Un nom n'est qu'un nom : accepter un chemin ici rouvrirait la traversée
    // par une porte que la normalisation ne surveille pas.
    for (const name of ['a/b', 'a\\b', '..', '.', '  ']) {
      const result = await createEntry(root, 'wiki', name, 'folder');
      expect(result.ok, name).toBe(false);
    }
    expect((await readdir(path.join(root, 'wiki'))).sort()).toEqual(['concepts']);
  });

  it('écrit le contenu fourni dans le fichier créé', async () => {
    // Le drag & drop d'un .md sur Pending passe par ce chemin : sans contenu,
    // l'import déposerait des fichiers vides.
    const result = await createEntry(root, 'raw/untracked', 'source', 'file', '# Titre\n');

    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, 'raw/untracked/source.md'), 'utf8')).toBe('# Titre\n');
  });

  it('refuse un contenu au-delà de la limite', async () => {
    const result = await createEntry(root, 'raw/untracked', 'gros', 'file', 'x'.repeat(5 * 1024 * 1024 + 1));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it('refuse d’écraser une entrée existante', async () => {
    await write('wiki/page.md');
    const result = await createEntry(root, 'wiki', 'page', 'file');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});

describe('règles par section', () => {
  it('déclare la purge pour Pending seulement', () => {
    // C'est la seule différence de comportement entre les sections ; la figer
    // évite qu'une section en hérite par recopie distraite.
    expect(TREE_ROOTS.pending.pruneEmptyDirs).toBe(true);
    for (const key of ['wiki', 'templates', 'build-context', 'deliverables']) {
      expect(TREE_ROOTS[key].pruneEmptyDirs, key).toBe(false);
    }
  });
});
