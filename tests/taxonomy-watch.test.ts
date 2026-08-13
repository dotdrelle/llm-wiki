import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recoverPendingWork } from '../src/graph/wiki/taxonomy/recovery.ts';
import { createTaxonomyWatcher } from '../src/graph/wiki/taxonomy/watcher.ts';
import {
  publishGeneration,
  readDirtyFlag,
  readMarker,
  taxonomyPaths,
  writeDirtyFlag,
  writeGeneration,
  type TaxonomyMarker,
} from '../src/graph/wiki/taxonomy/store.ts';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-watch-'));
  await mkdir(taxonomyPaths(root).dir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function publishRegistry(label: string, corpus: string) {
  const generation = await writeGeneration(root, { communities: [{ id: 'cmty_1', label }] });
  return publishGeneration(root, {
    corpus,
    registryRef: generation.ref,
    registryHash: generation.hash,
  });
}

describe('reprise du travail en attente', () => {
  it('ne fait rien sans drapeau', async () => {
    expect(await recoverPendingWork(root)).toEqual({ status: 'idle' });
  });

  /*
   Serve sait réellement refaire ce travail : la projection déterministe se
   recalcule depuis les fichiers. Il publie donc et efface le drapeau.
  */
  it('reprend et efface un travail déterministe', async () => {
    await writeDirtyFlag(root, { kind: 'deterministic', corpus: 'c1', baseRevision: 0, at: 1 });

    const outcome = await recoverPendingWork(root);

    expect(outcome).toEqual({ status: 'recovered', revision: 1 });
    expect(await readDirtyFlag(root)).toBeNull();
    expect((await readMarker(root))?.revision).toBe(1);
  });

  /*
   La proposition validée vivait en mémoire du producteur mort. Serve ne
   rappelle jamais le modèle : il ne peut pas la reconstituer. Effacer le
   drapeau prétendrait le contraire, et plus personne ne saurait qu'une
   synthèse manque.
  */
  it('signale une synthèse perdue sans prétendre l’avoir reprise', async () => {
    await publishRegistry('Solution', 'c1');
    await writeDirtyFlag(root, { kind: 'pendingSynthesis', corpus: 'c2', baseRevision: 1, at: 2 });

    const outcome = await recoverPendingWork(root);

    expect(outcome).toEqual({ status: 'signalled', revision: 2 });
    // Le drapeau survit : c'est le signal que la capacité orchestrée consomme.
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'pendingSynthesis' });
  });

  it('conserve la génération précédente active pendant une synthèse perdue', async () => {
    const published = await publishRegistry('Solution', 'c1');
    const before = (published as { marker: TaxonomyMarker }).marker;
    await writeDirtyFlag(root, { kind: 'pendingSynthesis', corpus: 'c2', baseRevision: 1, at: 2 });

    await recoverPendingWork(root);

    const after = await readMarker(root);
    // La révision avance, mais le registre actif ne change pas : jamais une
    // génération orpheline, jamais un pointeur vide.
    expect(after?.revision).toBe(2);
    expect(after?.registryRef).toBe(before.registryRef);
    expect(after?.registryHash).toBe(before.registryHash);
  });

  it('ne republie pas pendingSynthesis à chaque réveil du watcher', async () => {
    await publishRegistry('Solution', 'c1');
    await writeDirtyFlag(root, { kind: 'pendingSynthesis', corpus: 'c2', baseRevision: 1, at: 2 });

    expect(await recoverPendingWork(root)).toEqual({ status: 'signalled', revision: 2 });
    expect(await recoverPendingWork(root)).toEqual({ status: 'signalled', revision: 2 });
    expect((await readMarker(root))?.revision).toBe(2);
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'pendingSynthesis' });
  });

  /*
   Une empreinte de corpus ne recule jamais.

   Le drapeau fige l'empreinte à l'instant de l'échec, mais une ingestion peut
   parfaitement aboutir entre cet échec et cette reprise. Republier l'empreinte
   du drapeau faisait alors repartir le marqueur en arrière, tout en gardant le
   registre d'aujourd'hui : le marqueur mentait sur le corpus auquel il
   correspond, et un consommateur qui compare les empreintes voyait le corpus
   changer à l'envers.
  */
  it('ne fait pas reculer le marqueur quand une ingestion a abouti depuis', async () => {
    await publishRegistry('Solution', 'ancien');
    await writeDirtyFlag(root, { kind: 'deterministic', corpus: 'ancien', baseRevision: 1, at: 1 });
    // Une ingestion aboutit pendant que le drapeau attend.
    await publishRegistry('Solution', 'recent');

    const outcome = await recoverPendingWork(root);
    const marker = await readMarker(root);

    expect(outcome).toEqual({ status: 'superseded', revision: 2 });
    expect(marker?.corpus).toBe('recent');
    // Le travail réclamé n'existe plus : garder le drapeau ferait boucler le
    // watcher sur un état révolu.
    expect(await readDirtyFlag(root)).toBeNull();
  });

  it('garde une synthèse due même quand le corpus a changé sous elle', async () => {
    await publishRegistry('Solution', 'ancien');
    await writeDirtyFlag(root, { kind: 'pendingSynthesis', corpus: 'ancien', baseRevision: 1, at: 1 });
    await publishRegistry('Solution', 'recent');

    const outcome = await recoverPendingWork(root);
    const marker = await readMarker(root);

    // Personne n'a refait la synthèse pour le nouveau corpus non plus : elle
    // reste due. Mais le marqueur, lui, est déjà à jour — on n'y touche pas.
    expect(outcome).toEqual({ status: 'signalled', revision: 2 });
    expect(marker?.corpus).toBe('recent');
    expect(marker?.revision).toBe(2);
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'pendingSynthesis' });
  });

  it('reporte sans rien effacer quand le verrou est indisponible', async () => {
    await writeDirtyFlag(root, { kind: 'deterministic', corpus: 'c1', baseRevision: 0, at: 1 });
    // Verrou tenu par un tiers vivant.
    await writeFile(taxonomyPaths(root).lock, '', 'utf8');

    const outcome = await recoverPendingWork(root, { ttlMs: 60_000, attempts: 2, maxBackoffMs: 1 });

    expect(outcome).toEqual({ status: 'deferred' });
    // Le drapeau reste : c'est précisément son rôle.
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'deterministic' });
  });
});

describe('surveillance du marqueur', () => {
  function collect() {
    const seen: TaxonomyMarker[] = [];
    const watcher = createTaxonomyWatcher({
      rootDir: root,
      onRevision: (marker) => seen.push(marker),
      pollIntervalMs: 5_000,
      debounceMs: 1,
      recover: false,
    });
    return { seen, watcher };
  }

  /*
   Attendre `check()` doit signifier qu'une vérification a bien eu lieu après
   l'appel. Un drapeau « une à la fois » qui fait sortir sans vérifier rendait
   ce test dépendant de la charge de la machine : la vérification lancée à la
   construction était encore en vol, et l'appel retournait sans rien lire.
  */
  it('annonce une révision publiée, une seule fois', async () => {
    const { seen, watcher } = collect();
    try {
      await publishRegistry('Solution', 'c1');
      await watcher.check();
      // Une seconde vérification sans publication ne réannonce rien : le
      // client ne doit pas refaire un snapshot pour rien.
      await watcher.check();

      expect(seen.map((marker) => marker.revision)).toEqual([1]);
    } finally {
      watcher.stop();
    }
  });

  it('suit le compteur, pas le mtime', async () => {
    const { seen, watcher } = collect();
    try {
      await publishRegistry('Solution', 'c1');
      await watcher.check();

      // Réécriture du marqueur à l'identique : le mtime bouge, la révision non.
      const marker = await readMarker(root);
      await writeFile(taxonomyPaths(root).marker, JSON.stringify(marker), 'utf8');
      await watcher.check();

      expect(seen).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  });

  it('continue de voir les révisions après le remplacement de l’inode', async () => {
    const { seen, watcher } = collect();
    try {
      // Chaque publication remplace le marqueur par rename : un watcher posé
      // sur le fichier suivrait l'ancien inode et deviendrait aveugle.
      for (const label of ['A', 'B', 'C']) {
        await publishRegistry(label, `corpus-${label}`);
        await watcher.check();
      }

      expect(seen.map((marker) => marker.revision)).toEqual([1, 2, 3]);
    } finally {
      watcher.stop();
    }
  });

  it('reste muet tant qu’aucune révision n’est publiée', async () => {
    const { seen, watcher } = collect();
    try {
      await watcher.check();
      expect(seen).toEqual([]);
    } finally {
      watcher.stop();
    }
  });

  it('survit à un marqueur illisible et repart à la révision suivante', async () => {
    const { seen, watcher } = collect();
    try {
      await writeFile(taxonomyPaths(root).marker, '{ tronqué', 'utf8');
      await watcher.check();
      expect(seen).toEqual([]);

      await publishRegistry('Solution', 'c1');
      await watcher.check();
      expect(seen).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  });

  it('n’annonce plus rien après stop()', async () => {
    const { seen, watcher } = collect();
    watcher.stop();

    await publishRegistry('Solution', 'c1');
    await watcher.check();

    expect(seen).toEqual([]);
  });

  it('reprend le travail en attente quand la reprise est active', async () => {
    const seen: TaxonomyMarker[] = [];
    const watcher = createTaxonomyWatcher({
      rootDir: root,
      onRevision: (marker) => seen.push(marker),
      pollIntervalMs: 5_000,
      debounceMs: 1,
    });
    try {
      await writeDirtyFlag(root, { kind: 'deterministic', corpus: 'c1', baseRevision: 0, at: 1 });
      await watcher.check();

      expect(seen.map((marker) => marker.revision)).toEqual([1]);
      expect(await readDirtyFlag(root)).toBeNull();
    } finally {
      watcher.stop();
    }
  });
});
