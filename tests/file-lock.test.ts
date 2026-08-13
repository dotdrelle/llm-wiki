import { mkdtemp, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withFileLock } from '../src/utils/fs.ts';

/*
 Le verrou de fichier porte désormais l'allocation de révision du graphe, dont
 la section critique n'est qu'un `rename` mais qui doit survivre à une rafale
 d'ingestion. Deux propriétés en découlent, et aucune n'était couverte.
*/

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-lock-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('withFileLock', () => {
  it('sérialise deux titulaires et libère toujours le verrou', async () => {
    const lockPath = path.join(root, 'revision.lock');
    const order: string[] = [];
    const hold = (name: string) =>
      withFileLock(lockPath, async () => {
        order.push(`${name}:in`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`${name}:out`);
      });

    await Promise.all([hold('a'), hold('b')]);

    // Aucun entrelacement : un « in » est toujours suivi de son propre « out ».
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(`${order[0]!.split(':')[0]}:out`);
    expect(order[3]).toBe(`${order[2]!.split(':')[0]}:out`);
    // Le verrou ne survit pas à l'opération, même après contention.
    expect(await stat(lockPath).catch(() => null)).toBeNull();
  });

  it('libère le verrou quand l’opération lève, sans avaler l’erreur', async () => {
    const lockPath = path.join(root, 'revision.lock');

    await expect(
      withFileLock(lockPath, async () => {
        throw new Error('publication abandonnée');
      }),
    ).rejects.toThrow('publication abandonnée');

    expect(await stat(lockPath).catch(() => null)).toBeNull();
    // Un titulaire suivant doit pouvoir entrer immédiatement.
    await expect(withFileLock(lockPath, async () => 'ok')).resolves.toBe('ok');
  });

  /*
   Le cœur du correctif. La condition testait `attempt === attempts - 1` AVANT
   de regarder le verrou : un propriétaire mort dont le verrou venait d'expirer
   faisait échouer l'appel au lieu d'être récupéré — précisément au moment où
   la récupération était la seule issue restante.
  */
  it('récupère un verrou périmé y compris à la dernière tentative', async () => {
    const lockPath = path.join(root, 'revision.lock');
    const orphan = await open(lockPath, 'wx');
    await orphan.close();
    // Le propriétaire est mort il y a longtemps.
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    // Une seule tentative : sans le correctif, elle relançait EEXIST.
    await expect(
      withFileLock(lockPath, async () => 'repris', { ttlMs: 1_000, attempts: 1 }),
    ).resolves.toBe('repris');
  });

  it('ne vole pas un verrou encore vivant et finit par abandonner', async () => {
    const lockPath = path.join(root, 'revision.lock');
    const owner = await open(lockPath, 'wx');

    try {
      await expect(
        withFileLock(lockPath, async () => 'jamais', {
          ttlMs: 60_000,
          attempts: 2,
          maxBackoffMs: 1,
        }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await owner.close();
    }
  });

  /*
   `maxBackoffMs` sert à obtenir un budget long ET régulier. Sans plafond, le
   backoff `50 × (n+1)` fait croître le budget en n² et allonge les dernières
   attentes à plusieurs secondes : inutilisable pour un chemin qui alimente la
   vivacité de l'écran.
  */
  it('plafonne le palier d’attente sans changer le défaut', async () => {
    const lockPath = path.join(root, 'revision.lock');
    const owner = await open(lockPath, 'wx');
    const started = Date.now();

    try {
      await withFileLock(lockPath, async () => 'jamais', {
        ttlMs: 60_000,
        attempts: 6,
        maxBackoffMs: 5,
      }).catch(() => null);
    } finally {
      await owner.close();
    }

    // Sans plafond : 50+100+150+200+250 = 750 ms. Avec un palier de 5 ms, on
    // reste très en deçà, tout en ayant bien tenté six fois.
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('retourne la valeur de l’opération et écrit sous protection', async () => {
    const lockPath = path.join(root, 'revision.lock');
    const target = path.join(root, 'marker.json');

    const revision = await withFileLock(lockPath, async () => {
      const current = await readFile(target, 'utf8').catch(() => '{"revision":0}');
      const next = (JSON.parse(current).revision as number) + 1;
      await writeFile(target, JSON.stringify({ revision: next }), 'utf8');
      return next;
    });

    expect(revision).toBe(1);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ revision: 1 });
  });
});
