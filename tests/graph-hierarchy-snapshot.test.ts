import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWikiGraphSnapshot } from '../src/graph/wiki/overview.ts';
import { publishGeneration, writeGeneration } from '../src/graph/wiki/taxonomy/store.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import { withCoverage } from './support/registryCoverage.ts';

/*
 La hiérarchie doit arriver JUSQU'AUX DONNÉES servies, pas seulement exister
 dans le registre.

 Tous les tests de hiérarchie écrits jusqu'ici inspectaient le texte des
 scripts client : « la fonction de repli est-elle présente ? ». Elle l'était, et
 la carte restait pourtant plate — parce que `communityHierarchy` renvoie
 `parents` et que le snapshot lit `communityParents` : étalé, l'objet passait
 une clé que personne ne lisait. Un spread n'est pas soumis au contrôle de
 propriétés excédentaires, donc ni le typage ni les tests de texte ne pouvaient
 le voir.

 Ce fichier teste la donnée. C'est le seul niveau où ce défaut était visible.
*/

let root = '';

async function page(name: string, group: string) {
  const dir = path.join(root, 'wiki', 'concepts');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.md`), `---\ngroup: ${group}\n---\n\n# ${name}\n`, 'utf8');
}

function registry(): TaxonomyRegistry {
  return withCoverage({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 1,
    corpus: 'sha1:abc',
    languages: ['fr'],
    communities: [
      { id: 'dom_produit', prefLabel: { fr: 'Produit' }, firstSeenRevision: 1, parentCommunity: null },
      { id: 'cmty_alpha', prefLabel: { fr: 'Alpha' }, firstSeenRevision: 1, parentCommunity: 'dom_produit' },
      { id: 'cmty_beta', prefLabel: { fr: 'Beta' }, firstSeenRevision: 1, parentCommunity: 'dom_produit' },
    ],
    assignments: {
      'wiki/concepts/alpha.md': { primaryCommunity: 'cmty_alpha' },
      'wiki/concepts/beta.md': { primaryCommunity: 'cmty_beta' },
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-tree-'));
  await page('alpha', 'Alpha');
  await page('beta', 'Beta');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function publish(data: TaxonomyRegistry) {
  const generation = await writeGeneration(root, data);
  const outcome = await publishGeneration(root, {
    corpus: 'corpus-1',
    registryRef: generation.ref,
    registryHash: generation.hash,
  });
  expect(outcome.status).toBe('published');
}

const snapshotOf = () => loadWikiGraphSnapshot({ rootDir: root, workspace: 'demo', language: 'fr' });

describe('arbre servi au client', () => {
  it('expose les domaines ET la table des parents', async () => {
    await publish(registry());
    const snapshot = await snapshotOf();

    expect(snapshot.synthesized).toBe(true);
    expect(snapshot.domains).toEqual([{ id: 'dom_produit', label: 'Produit' }]);
    // La table qui manquait : sans elle, chaque feuille paraît sans parent et
    // la carte comme l'index restent plats.
    expect(snapshot.communityParents).toEqual({
      cmty_alpha: 'dom_produit',
      cmty_beta: 'dom_produit',
    });
  });

  it('n’expose jamais la clé interne du calcul', async () => {
    await publish(registry());
    const snapshot = await snapshotOf();

    // `parents` est le nom interne de communityHierarchy ; le laisser fuir
    // dans le snapshot est exactement le symptôme du bug d'origine.
    expect(snapshot).not.toHaveProperty('parents');
  });

  it('permet de replier chaque feuille sur son domaine', async () => {
    await publish(registry());
    const snapshot = await snapshotOf();

    // Ce que fait le client : toute communauté portant des pages doit se
    // résoudre vers un domaine affiché sur la carte.
    const domainIds = new Set(snapshot.domains.map((domain) => domain.id));
    const leaves = snapshot.communities.filter((community) => !domainIds.has(community.id));
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(snapshot.communityParents[leaf.id]).toBeDefined();
      expect(domainIds.has(snapshot.communityParents[leaf.id]!)).toBe(true);
    }
  });

  it('reste vide sur une taxonomie déterministe', async () => {
    const snapshot = await snapshotOf();

    // Sans registre, la carte garde son rendu plat : c'est correct, aucun
    // domaine n'existe.
    expect(snapshot.synthesized).toBe(false);
    expect(snapshot.domains).toEqual([]);
    expect(snapshot.communityParents).toEqual({});
  });

  it('n’invente pas de domaine pour une racine qui porte des pages', async () => {
    const flat = registry();
    flat.communities.push({
      id: 'cmty_seule',
      prefLabel: { fr: 'Seule' },
      firstSeenRevision: 1,
      parentCommunity: null,
    });
    flat.assignments['wiki/concepts/alpha.md'] = { primaryCommunity: 'cmty_seule' };
    await publish(flat);

    const snapshot = await snapshotOf();
    // Une racine sans enfant est une feuille : elle s'affiche telle quelle, et
    // n'apparaît pas comme domaine ouvrable.
    expect(snapshot.domains.map((domain) => domain.id)).not.toContain('cmty_seule');
    expect(snapshot.communityParents.cmty_seule).toBeUndefined();
  });
});
