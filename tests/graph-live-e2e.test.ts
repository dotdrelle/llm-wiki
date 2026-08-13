import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishCorpusRevision } from '../src/graph/wiki/taxonomy/publish.ts';
import { createGraphEventHub } from '../src/serve/sse/graphEvents.ts';
import { loadWikiGraphSnapshot } from '../src/graph/wiki/overview.ts';
import {
  readDirtyFlag,
  readMarker,
  taxonomyPaths,
} from '../src/graph/wiki/taxonomy/store.ts';

/*
 Validation de bout en bout du circuit temps réel, taxonomie DÉTERMINISTE
 uniquement — aucun LLM. C'est l'inversion voulue : on prouve que le transport,
 la révision et la réconciliation tiennent avant d'y brancher un modèle non
 déterministe, plutôt que de déboguer les deux dans la même itération.
*/

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'));
  await mkdir(path.join(root, 'wiki', 'concepts', 'securite'), { recursive: true });
  await writeFile(
    path.join(root, 'wiki', 'concepts', 'securite', 'chiffrement.md'),
    '---\ngroup: Sécurité\n---\n\n# Chiffrement\n',
    'utf8',
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeClient() {
  const req = new EventEmitter();
  const chunks: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    writeHead() {},
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {},
  });
  return {
    req,
    res,
    revisions: () =>
      chunks
        .filter((chunk) => chunk.includes('event: graph.revision'))
        .map((chunk) => JSON.parse(chunk.split('data: ')[1]!.split('\n')[0]!).revision as number),
  };
}

async function addPage(name: string, group: string) {
  const dir = path.join(root, 'wiki', 'concepts', group.toLowerCase());
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.md`), `---\ngroup: ${group}\n---\n\n# ${name}\n`, 'utf8');
}

describe('circuit complet, taxonomie déterministe', () => {
  it('propage une écriture jusqu’aux abonnés sans rien recharger', async () => {
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);
      const before = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });
      expect(before.taxonomyRevision).toBe(0);

      // Une source vient d'être appliquée.
      await addPage('signature', 'Securite');
      const published = await publishCorpusRevision(root);
      await hub.check();

      expect(published.status).toBe('published');
      expect(client.revisions()).toEqual([1]);

      // Et le snapshot suivant porte la nouvelle page ET la nouvelle révision.
      const after = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });
      expect(after.taxonomyRevision).toBe(1);
      expect(after.nodes.length).toBeGreaterThan(before.nodes.length);
    } finally {
      hub.stop();
    }
  });

  it('annonce une révision par source appliquée, dans l’ordre', async () => {
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);

      for (const [name, group] of [['a', 'Securite'], ['b', 'Reseau'], ['c', 'Reseau']]) {
        await addPage(name!, group!);
        await publishCorpusRevision(root);
        await hub.check();
      }

      // Monotone et sans trou : c'est ce que la garde anti-obsolescence du
      // client suppose pour ignorer une réponse tardive.
      expect(client.revisions()).toEqual([1, 2, 3]);
    } finally {
      hub.stop();
    }
  });

  it('n’annonce rien quand une publication ne change pas le corpus', async () => {
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);
      await addPage('signature', 'Securite');
      await publishCorpusRevision(root);
      await hub.check();
      expect(client.revisions()).toEqual([1]);

      // Republier sans écriture ne crée aucun état observable nouveau.
      await publishCorpusRevision(root);
      await hub.check();
      await hub.check();

      expect(client.revisions()).toEqual([1]);
    } finally {
      hub.stop();
    }
  });

  /*
   L'invariant qui protège la production : une révision non allouée est un
   problème d'affichage. Elle ne doit jamais faire échouer l'écriture, et le
   travail doit rester repris.
  */
  it('bascule sur le drapeau quand le verrou est indisponible, sans lever', async () => {
    await mkdir(taxonomyPaths(root).dir, { recursive: true });
    await writeFile(taxonomyPaths(root).lock, '', 'utf8');

    const outcome = await publishCorpusRevision(root, {
      ttlMs: 60_000,
      attempts: 2,
      maxBackoffMs: 1,
    });

    expect(outcome.status).toBe('deferred');
    expect(await readMarker(root)).toBeNull();
    // Serve sait refaire ce travail : il se recalcule depuis les fichiers.
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'deterministic' });
  });

  it('reprend le travail différé au prochain réveil de Serve', async () => {
    await mkdir(taxonomyPaths(root).dir, { recursive: true });
    await writeFile(taxonomyPaths(root).lock, '', 'utf8');
    await publishCorpusRevision(root, { ttlMs: 60_000, attempts: 2, maxBackoffMs: 1 });
    await rm(taxonomyPaths(root).lock, { force: true });

    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);
      await hub.check();

      // Le graphe rattrape son retard tout seul, sans nouvelle ingestion.
      expect(client.revisions()).toEqual([1]);
      expect(await readDirtyFlag(root)).toBeNull();
    } finally {
      hub.stop();
    }
  });

  it('conserve la même empreinte de corpus que le snapshot', async () => {
    await publishCorpusRevision(root);

    const marker = await readMarker(root);
    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });

    // Deux empreintes calculées autrement rendraient la comparaison de
    // péremption sous verrou sans valeur.
    expect(marker?.corpus).toBe(snapshot.structureEtag);
  });
});
