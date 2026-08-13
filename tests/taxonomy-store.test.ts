import { mkdir, mkdtemp, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDirtyFlag,
  collectGenerations,
  generationName,
  publishGeneration,
  readActiveRegistry,
  readDirtyFlag,
  readMarker,
  taxonomyPaths,
  writeDirtyFlag,
  writeGeneration,
} from '../src/graph/wiki/taxonomy/store.ts';

let root = '';
const registry = (label: string) => ({ communities: [{ id: 'cmty_1', prefLabel: { fr: label } }] });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-'));
  // Le code de production crée le répertoire au premier safeWriteFile ; les
  // tests qui écrivent des états dégradés à la main doivent le devancer.
  await mkdir(taxonomyPaths(root).dir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function publish(label: string, corpus: string, expectedCorpus?: string) {
  const generation = await writeGeneration(root, registry(label));
  return publishGeneration(root, {
    corpus,
    registryRef: generation.ref,
    registryHash: generation.hash,
    expectedCorpus,
  });
}

describe('générations immuables', () => {
  it('adresse une génération par son contenu et la rend idempotente', async () => {
    const first = await writeGeneration(root, registry('Solution'));
    const second = await writeGeneration(root, registry('Solution'));

    expect(second.ref).toBe(first.ref);
    expect(first.ref).toBe(generationName(first.hash));
    // Réécrire la même génération réécrit les mêmes octets : c'est ce qui rend
    // le rejeu d'un producteur sans effet.
    expect(await readFile(path.join(taxonomyPaths(root).dir, first.ref), 'utf8')).toBe(first.canonical);
  });

  it('n’écrase jamais une génération voisine', async () => {
    const a = await writeGeneration(root, registry('Solution'));
    const b = await writeGeneration(root, registry('Intégration'));

    expect(a.ref).not.toBe(b.ref);
    // Les deux coexistent : c'est ce qui autorise l'écriture hors verrou.
    await expect(stat(path.join(taxonomyPaths(root).dir, a.ref))).resolves.toBeTruthy();
    await expect(stat(path.join(taxonomyPaths(root).dir, b.ref))).resolves.toBeTruthy();
  });

  /*
   Le défaut que l'indirection corrige : avec un unique communities.json écrasé
   avant le marqueur, un producteur mort entre les deux laissait un état sans
   registre précédent récupérable.
  */
  it('laisse la génération précédente lisible tant qu’une nouvelle n’est pas publiée', async () => {
    await publish('Solution', 'corpus-1');
    const before = await readActiveRegistry(root);

    // Un producteur écrit sa génération puis meurt avant de publier.
    await writeGeneration(root, registry('Intégration'));

    const after = await readActiveRegistry(root);
    expect(after?.marker.revision).toBe(before?.marker.revision);
    expect(after?.registry).toEqual(registry('Solution'));
  });
});

describe('publication et révision', () => {
  it('incrémente une révision monotone', async () => {
    expect(await readMarker(root)).toBeNull();

    const first = await publish('Solution', 'corpus-1');
    const second = await publish('Intégration', 'corpus-2');

    expect(first).toMatchObject({ status: 'published' });
    expect(second).toMatchObject({ status: 'published' });
    expect((first as { marker: { revision: number } }).marker.revision).toBe(1);
    expect((second as { marker: { revision: number } }).marker.revision).toBe(2);
  });

  it('abandonne une proposition calculée sur un corpus périmé', async () => {
    await publish('Solution', 'corpus-2');

    // Le producteur avait commencé sur corpus-1 ; une ingestion est passée.
    const outcome = await publish('Ancien', 'corpus-1', 'corpus-1');

    expect(outcome.status).toBe('stale');
    // Le registre actif n'a pas bougé, et la révision non plus.
    const active = await readActiveRegistry(root);
    expect(active?.marker.revision).toBe(1);
    expect(active?.registry).toEqual(registry('Solution'));
  });

  /*
   Deux producteurs concurrents publient chacun un commit ENTIER : jamais le
   marqueur de l'un avec le registre de l'autre. C'est ce que l'indirection
   garantit et qu'un communities.json unique ne pouvait pas offrir.
  */
  it('ne panache jamais le marqueur d’un producteur avec le registre d’un autre', async () => {
    const [a, b] = await Promise.all([
      publish('Solution', 'corpus-a'),
      publish('Intégration', 'corpus-b'),
    ]);

    expect(a.status).toBe('published');
    expect(b.status).toBe('published');
    const revisions = [a, b].map((outcome) => (outcome as { marker: { revision: number } }).marker.revision);
    expect(new Set(revisions).size).toBe(2);

    const active = await readActiveRegistry(root);
    expect(active).not.toBeNull();
    // Le registre lu correspond bien au marqueur lu, quel que soit le gagnant.
    const label = (active!.registry as { communities: Array<{ prefLabel: { fr: string } }> })
      .communities[0]!.prefLabel.fr;
    expect(active!.marker.corpus).toBe(label === 'Solution' ? 'corpus-a' : 'corpus-b');
    expect(active!.marker.revision).toBe(2);
  });

  it('signale l’indisponibilité sans lever, pour ne pas emporter l’ingestion', async () => {
    // Un verrou vivant que personne ne relâchera pendant le test.
    const owner = await open(taxonomyPaths(root).lock, 'wx');

    try {
      const generation = await writeGeneration(root, registry('Solution'));
      const outcome = await publishGeneration(
        root,
        { corpus: 'corpus-1', registryRef: generation.ref, registryHash: generation.hash },
        // Budget resserré : on veut observer l'abandon, pas l'attendre 60 s.
        { ttlMs: 60_000, attempts: 2, maxBackoffMs: 1 },
      );
      // Pas d'exception : l'appelant décide quoi faire, il ne meurt pas.
      expect(outcome.status).toBe('unavailable');
    } finally {
      await owner.close();
    }
  });
});

describe('lecture cohérente', () => {
  it('rejette une génération dont l’empreinte ne correspond plus', async () => {
    const outcome = await publish('Solution', 'corpus-1');
    const ref = (outcome as { marker: { registryRef: string } }).marker.registryRef;
    // Corruption sur disque : le contenu ne vaut plus son nom.
    await writeFile(path.join(taxonomyPaths(root).dir, ref), '{"communities":[]}', 'utf8');

    expect(await readActiveRegistry(root, 1)).toBeNull();
  });

  it('retombe proprement quand le marqueur est absent ou illisible', async () => {
    expect(await readActiveRegistry(root)).toBeNull();

    await writeFile(taxonomyPaths(root).marker, '{ tronqué', 'utf8');
    expect(await readMarker(root)).toBeNull();
    expect(await readActiveRegistry(root)).toBeNull();
  });

  it('accepte une révision déterministe sans génération', async () => {
    const outcome = await publishGeneration(root, {
      corpus: 'corpus-1',
      registryRef: null,
      registryHash: null,
    });

    expect(outcome.status).toBe('published');
    const active = await readActiveRegistry(root);
    expect(active?.registry).toBeNull();
    expect(active?.marker.revision).toBe(1);
  });
});

describe('drapeau de reprise', () => {
  it('distingue le travail que Serve sait reprendre de celui qu’il doit signaler', async () => {
    await writeDirtyFlag(root, { kind: 'deterministic', corpus: 'c1', baseRevision: 3, at: 1 });
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'deterministic', baseRevision: 3 });

    await writeDirtyFlag(root, { kind: 'pendingSynthesis', corpus: 'c1', baseRevision: 3, at: 2 });
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'pendingSynthesis' });

    await clearDirtyFlag(root);
    expect(await readDirtyFlag(root)).toBeNull();
  });

  it('ignore un drapeau de type inconnu plutôt que de le croire', async () => {
    await writeFile(taxonomyPaths(root).dirty, '{"kind":"whatever"}', 'utf8');
    expect(await readDirtyFlag(root)).toBeNull();
  });
});

describe('ramassage des générations', () => {
  async function age(ref: string, ms: number) {
    const when = new Date(Date.now() - ms);
    await utimes(path.join(taxonomyPaths(root).dir, ref), when, when);
  }

  it('ne supprime jamais la génération courante, même ancienne', async () => {
    const outcome = await publish('Solution', 'corpus-1');
    const ref = (outcome as { marker: { registryRef: string } }).marker.registryRef;
    await age(ref, 10 * 60_000);

    expect(await collectGenerations(root, { retention: 0, minAgeMs: 0 })).toEqual([]);
    await expect(stat(path.join(taxonomyPaths(root).dir, ref))).resolves.toBeTruthy();
  });

  /*
   Le piège du ramassage. Une génération écrite il y a 200 ms peut appartenir à
   un producteur qui attend encore le verrou : elle paraît orpheline et ne l'est
   pas. La supprimer casserait sa publication.
  */
  it('épargne une orpheline plus jeune que le budget d’acquisition du verrou', async () => {
    await publish('Solution', 'corpus-1');
    const pending = await writeGeneration(root, registry('En vol'));

    expect(await collectGenerations(root, { retention: 0 })).toEqual([]);
    await expect(stat(path.join(taxonomyPaths(root).dir, pending.ref))).resolves.toBeTruthy();
  });

  it('supprime une orpheline ancienne au-delà de la rétention', async () => {
    await publish('Solution', 'corpus-1');
    const orphan = await writeGeneration(root, registry('Abandonnée'));
    await age(orphan.ref, 5 * 60_000);

    expect(await collectGenerations(root, { retention: 0 })).toEqual([orphan.ref]);
    await expect(stat(path.join(taxonomyPaths(root).dir, orphan.ref))).rejects.toThrow();
  });

  it('conserve une fenêtre de grâce pour les lecteurs', async () => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    const refs: string[] = [];
    for (const [index, label] of labels.entries()) {
      const outcome = await publish(label, `corpus-${index}`);
      const ref = (outcome as { marker: { registryRef: string } }).marker.registryRef;
      refs.push(ref);
      await age(ref, 5 * 60_000 + (labels.length - index) * 1_000);
    }

    await collectGenerations(root, { retention: 4 });

    // Le marqueur, pas le mtime, désigne la courante et les trois publications
    // précédentes. Les deux publications sorties de cet historique partent.
    await expect(stat(path.join(taxonomyPaths(root).dir, refs[0]!))).rejects.toThrow();
    await expect(stat(path.join(taxonomyPaths(root).dir, refs[1]!))).rejects.toThrow();
    for (const ref of refs.slice(2)) {
      await expect(stat(path.join(taxonomyPaths(root).dir, ref))).resolves.toBeTruthy();
    }
  });

  it('ne touche à rien quand le répertoire n’existe pas encore', async () => {
    expect(await collectGenerations(root)).toEqual([]);
  });
});
