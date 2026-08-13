import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWikiGraphSnapshot } from '../src/graph/wiki/overview.ts';
import { publishGeneration, writeGeneration } from '../src/graph/wiki/taxonomy/store.ts';
import { REGISTRY_SCHEMA_VERSION } from '../src/graph/wiki/taxonomy/schema.ts';

/*
 Le cache du snapshot est keyé par l'empreinte des FICHIERS. Une consolidation
 qui renomme ou fusionne sans qu'aucun Markdown ne bouge ne changerait donc
 rien de visible : le graphe continuerait de servir l'ancienne taxonomie
 jusqu'à la prochaine édition de page. C'est la révision qui ferme ce trou.
*/

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-snapshot-'));
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

describe('révision de taxonomie et cache du snapshot', () => {
  it('part d’une révision nulle et non synthétisée', async () => {
    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });

    expect(snapshot.taxonomyRevision).toBe(0);
    expect(snapshot.synthesized).toBe(false);
    // Le graphe rend quand même quelque chose : la dégradation est gracieuse.
    expect(snapshot.nodes.length).toBeGreaterThan(0);
  });

  it('sert la même instance tant que rien ne change', async () => {
    const first = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });
    const second = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });

    expect(second).toBe(first);
  });

  it('invalide le cache quand seul le registre change', async () => {
    const before = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });

    const generation = await writeGeneration(root, {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      revision: 1,
      corpus: 'sha1:abc',
      languages: ['fr'],
      communities: [{ id: 'cmty_1', prefLabel: { fr: 'Sécurité' }, firstSeenRevision: 1 }],
      assignments: {
        'wiki/concepts/securite/chiffrement.md': { primaryCommunity: 'cmty_1' },
      },
    });
    const published = await publishGeneration(root, {
      corpus: 'corpus-1',
      registryRef: generation.ref,
      registryHash: generation.hash,
    });
    expect(published.status).toBe('published');

    const after = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo', language: 'fr' });

    // Aucun fichier Markdown n'a bougé : le structureEtag est identique.
    expect(after.structureEtag).toBe(before.structureEtag);
    // Et pourtant le snapshot est neuf, et il annonce la nouvelle révision.
    expect(after).not.toBe(before);
    expect(after.taxonomyRevision).toBe(1);
    expect(after.synthesized).toBe(true);
    // Le registre a bien piloté l'affectation, dans la langue demandée.
    const page = after.nodes.find((node) => node.id.endsWith('chiffrement.md'));
    expect(page?.community).toMatchObject({
      communityId: 'cmty_1',
      communityLabel: 'Sécurité',
      assignment: 'synthesized',
    });
  });

  /*
   `synthesized` dit qu'un registre VALIDE a été appliqué, pas qu'un marqueur
   pointe un fichier. Un registre illisible retombe sur la projection
   déterministe et l'annonce, plutôt que de laisser croire à une taxonomie
   synthétisée qui n'a pas eu lieu.
  */
  it('retombe sur le déterministe quand le registre est invalide', async () => {
    const generation = await writeGeneration(root, { communities: [{ id: 'cmty_1' }] });
    await publishGeneration(root, {
      corpus: 'corpus-1',
      registryRef: generation.ref,
      registryHash: generation.hash,
    });

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });

    expect(snapshot.taxonomyRevision).toBe(1);
    expect(snapshot.synthesized).toBe(false);
    // Et surtout : le graphe rend quand même quelque chose.
    expect(snapshot.nodes.length).toBeGreaterThan(0);
  });

  it('reste non synthétisé pour une révision purement déterministe', async () => {
    await publishGeneration(root, { corpus: 'corpus-1', registryRef: null, registryHash: null });

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo' });

    expect(snapshot.taxonomyRevision).toBe(1);
    // Une révision a bien été publiée, mais aucun registre ne la porte : le
    // snapshot ne doit pas laisser croire à une taxonomie synthétisée.
    expect(snapshot.synthesized).toBe(false);
  });
});
