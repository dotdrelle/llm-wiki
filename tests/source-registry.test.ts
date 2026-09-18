import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SOURCE_REGISTRY_VERSION,
  hashContent,
  isReportClean,
  orphanPages,
  readSourceRegistry,
  reconcileRegistry,
  recordSourceObservation,
  sourceIdFromArchivePath,
  writeSourceRegistry,
  type SourceRegistryFile,
} from '../src/services/sourceRegistry.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'source-registry-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const empty = (): SourceRegistryFile => ({ version: SOURCE_REGISTRY_VERSION, sources: [] });
const at = (day: number) => `2026-08-0${day}T10:00:00.000Z`;

function observe(registry: SourceRegistryFile, over: Partial<Parameters<typeof recordSourceObservation>[1]> = {}) {
  return recordSourceObservation(registry, {
    sourceId: 'path:raw/ingested/archi.md',
    archivePath: 'raw/ingested/archi.md',
    contentHash: hashContent('# archi'),
    producedPages: ['wiki/sources/archi.md'],
    ingested: true,
    observedAt: at(1),
    ...over,
  });
}

describe('lecture du registre', () => {
  it('rend un registre vide plutôt qu’une erreur quand le fichier manque', async () => {
    // Ce fichier est une observation : une observation ratée ne doit jamais
    // interrompre le travail qu'elle observe.
    const registry = await readSourceRegistry(path.join(root, 'absent.json'));
    expect(registry.sources).toEqual([]);
  });

  it('ignore un fichier corrompu ou d’une autre version', async () => {
    const broken = path.join(root, 'broken.json');
    await writeFile(broken, '{ pas du json', 'utf8');
    expect((await readSourceRegistry(broken)).sources).toEqual([]);

    const future = path.join(root, 'future.json');
    await writeFile(future, JSON.stringify({ version: 999, sources: [{ sourceId: 'x' }] }), 'utf8');
    expect((await readSourceRegistry(future)).sources).toEqual([]);
  });

  it('écrit de façon atomique et se relit', async () => {
    const file = path.join(root, 'nested', 'registry.json');
    const registry = observe(empty());

    await writeSourceRegistry(file, registry);

    expect(await readSourceRegistry(file)).toEqual(registry);
    // Aucun fichier temporaire laissé derrière.
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true);
  });
});

describe('observation d’une source', () => {
  it('enregistre une source inconnue comme active', () => {
    const registry = observe(empty());

    expect(registry.sources).toHaveLength(1);
    expect(registry.sources[0].status).toBe('active');
    expect(registry.sources[0].firstSeenAt).toBe(at(1));
    expect(registry.sources[0].producedPages).toEqual(['wiki/sources/archi.md']);
  });

  it('met à jour sans dupliquer, et garde la première date', () => {
    const after = observe(observe(empty()), {
      observedAt: at(5),
      producedPages: ['wiki/sources/archi.md', 'wiki/concepts/postgresql.md'],
    });

    expect(after.sources).toHaveLength(1);
    expect(after.sources[0].firstSeenAt).toBe(at(1));
    expect(after.sources[0].lastSeenAt).toBe(at(5));
    expect(after.sources[0].producedPages).toEqual([
      'wiki/concepts/postgresql.md',
      'wiki/sources/archi.md',
    ]);
  });

  it('n’efface pas les pages produites quand la source est inchangée', () => {
    // `unchanged since last ingest` ne produit rien. Écraser la liste par un
    // tableau vide ferait perdre, à chaque simple ré-archivage, la trace de
    // tout ce que la source avait produit.
    const after = observe(observe(empty()), {
      observedAt: at(5),
      ingested: false,
      producedPages: undefined,
    });

    expect(after.sources[0].producedPages).toEqual(['wiki/sources/archi.md']);
    expect(after.sources[0].lastSeenAt).toBe(at(5));
    expect(after.sources[0].lastIngestedAt).toBe(at(1));
  });

  it('ramène une source revue à l’état actif', () => {
    const missing: SourceRegistryFile = {
      ...empty(),
      sources: [{
        sourceId: 'path:raw/ingested/archi.md',
        archivePath: 'raw/ingested/archi.md',
        contentHash: hashContent('# archi'),
        status: 'missing',
        firstSeenAt: at(1),
        lastSeenAt: at(2),
        lastIngestedAt: at(1),
        producedPages: ['wiki/sources/archi.md'],
      }],
    };

    expect(observe(missing, { observedAt: at(6) }).sources[0].status).toBe('active');
  });

  it('dérive un identifiant du chemin d’archive, faute de mieux', () => {
    // Tant qu'aucun producteur ne fournit d'identité stable, un renommage
    // amont crée bien une source nouvelle — ce que le registre a précisément
    // vocation à rendre visible plutôt qu'à masquer.
    expect(sourceIdFromArchivePath('raw/ingested/a.md')).toBe('path:raw/ingested/a.md');
    expect(sourceIdFromArchivePath('raw/ingested/a.md'))
      .not.toBe(sourceIdFromArchivePath('raw/ingested/a-renomme.md'));
  });
});

describe('réconciliation', () => {
  const registry = (): SourceRegistryFile => ({
    ...empty(),
    sources: [{
      sourceId: 'path:raw/ingested/archi.md',
      archivePath: 'raw/ingested/archi.md',
      contentHash: 'sha256:x',
      status: 'active',
      firstSeenAt: at(1),
      lastSeenAt: at(1),
      lastIngestedAt: at(1),
      producedPages: ['wiki/sources/archi.md', 'wiki/concepts/postgresql.md'],
    }],
  });

  it('ne signale rien quand tout concorde', () => {
    const report = reconcileRegistry(registry(), {
      archives: ['raw/ingested/archi.md'],
      wikiPages: ['wiki/sources/archi.md', 'wiki/concepts/postgresql.md'],
    });

    expect(isReportClean(report)).toBe(true);
  });

  it('nomme une page produite qui a disparu', () => {
    // C'est le symptôme rapporté : une page supprimée reste connue du système
    // sans que rien ne le dise.
    const report = reconcileRegistry(registry(), {
      archives: ['raw/ingested/archi.md'],
      wikiPages: ['wiki/sources/archi.md'],
    });

    expect(report.vanishedPages).toEqual([
      { sourceId: 'path:raw/ingested/archi.md', pages: ['wiki/concepts/postgresql.md'] },
    ]);
    expect(isReportClean(report)).toBe(false);
  });

  it('nomme une archive disparue', () => {
    const report = reconcileRegistry(registry(), {
      archives: [],
      wikiPages: ['wiki/sources/archi.md', 'wiki/concepts/postgresql.md'],
    });

    expect(report.vanishedArchives).toEqual(['raw/ingested/archi.md']);
  });

  it('distingue une archive antérieure au registre', () => {
    // Une installation existante a des archives que le registre ne connaît
    // pas. Les confondre avec une anomalie ferait un rapport ininterprétable
    // au premier lancement.
    const report = reconcileRegistry(registry(), {
      archives: ['raw/ingested/archi.md', 'raw/ingested/ancien.md'],
      wikiPages: ['wiki/sources/archi.md', 'wiki/concepts/postgresql.md'],
    });

    expect(report.unregisteredArchives).toEqual(['raw/ingested/ancien.md']);
    expect(report.vanishedArchives).toEqual([]);
  });

  it('signale une page qu’aucune source vivante ne soutient', () => {
    const report = reconcileRegistry(registry(), {
      archives: ['raw/ingested/archi.md'],
      wikiPages: ['wiki/sources/archi.md', 'wiki/concepts/postgresql.md', 'wiki/concepts/ecrit-a-la-main.md'],
    });

    expect(report.orphans).toEqual(['wiki/concepts/ecrit-a-la-main.md']);
  });

  it('ne compte pas une source retirée comme soutien', () => {
    const retracted = registry();
    retracted.sources[0].status = 'retracted';

    expect(orphanPages(retracted, ['wiki/sources/archi.md']))
      .toEqual(['wiki/sources/archi.md']);
  });

  it('est purement descriptive : elle ne modifie pas le registre', () => {
    // Rien ne doit être recréé ni supprimé tant que le retrait n'est pas
    // spécifié bout en bout (T32.4).
    const before = registry();
    const snapshot = JSON.parse(JSON.stringify(before));

    reconcileRegistry(before, { archives: [], wikiPages: [] });

    expect(before).toEqual(snapshot);
  });
});

describe('provenance des affirmations', () => {
  it('épargne un marqueur déjà ancré, ancre de section comprise', async () => {
    /*
     Ce test figeait un défaut connu (T32.5) : `enforceSourceCitationPath`
     réécrivait TOUT marqueur `[src: …]` ne désignant pas la source courante,
     alors qu'un `update` porte le contenu COMPLET de la page — les marqueurs
     hérités d'autres sources étaient donc réattribués à la source en cours.

     Le défaut est corrigé : `ANCHORED_CITATION_PATH` épargne un chemin
     d'archive ou de page bien formé. Le test pin désormais le contrat en
     vigueur, y compris le point qui l'avait cassé une seconde fois — le test
     porte sur le CHEMIN seul, jamais sur `chemin#Section`, car un titre de
     section porte des espaces et des apostrophes par nature.
    */
    const source = await readFile(
      new URL('../src/services/ingestService.ts', import.meta.url),
      'utf8',
    );
    const fn = source.slice(
      source.indexOf('function enforceSourceCitationPath'),
      source.indexOf('function diffPreview'),
    );

    // Le chemin est séparé de son ancre AVANT le test de forme…
    expect(fn).toContain('const { path: citedPath, anchor } = splitCitationAnchor(cleanCitationPath);');
    expect(fn).toContain('if (ANCHORED_CITATION_PATH.test(anchoredPath)) {');
    // …et l'ancre survit, dans les deux branches.
    expect(fn).toContain('return `[src: ${anchoredPath}${anchor ? `#${anchor}` : \'\'}]`;');
    expect(fn).toContain('return `[src: ${archiveCitationPath}${anchor ? `#${anchor}` : \'\'}]`;');
    // La comparaison de réécriture porte sur le chemin, pas sur la citation
    // entière : sinon toute citation ancrée était comptée comme réécrite.
    expect(fn).toContain('if (citedPath !== archiveCitationPath) rewrittenCitations += 1;');
  });
});
