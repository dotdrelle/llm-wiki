import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWikiGraphSnapshot } from '../src/graph/wiki/overview.ts';
import { buildTaxonomyInventory } from '../src/graph/wiki/taxonomy/inventory.ts';
import { KNOWLEDGE_ETAG_ALGORITHM, knowledgeEtag } from '../src/graph/wiki/taxonomy/knowledge.ts';
import { publishCorpusRevision } from '../src/graph/wiki/taxonomy/publish.ts';
import { synthesizeTaxonomy } from '../src/graph/wiki/taxonomy/run.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import { readActiveRegistry, readMarker, writeGeneration, publishGeneration } from '../src/graph/wiki/taxonomy/store.ts';

/*
 Ce que le Lot 0 change au niveau de la synthèse complète : l'empreinte publiée,
 la preuve de couverture écrite dans le registre, et le report explicite quand le
 budget de familles ne permet pas de décider honnêtement.
*/

let root = '';

async function page(dir: string, name: string, body: string): Promise<void> {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, `${name}.md`), body, 'utf8');
}

/** Modèle simulé : un domaine, deux feuilles, chaque famille assignée une fois. */
function proposer() {
  return async (request: { system: string; user: string }) => {
    const rows = [...request.user.matchAll(/^- (f\d+) :: /gm)].map((match) => match[1]!);
    const assignments: Record<string, string> = {};
    rows.forEach((id, index) => {
      assignments[id] = index % 2 ? 'c_beta' : 'c_alpha';
    });
    return {
      domains: [{ id: 'd_general', label: 'Général', scopeNote: 'Corpus de test.' }],
      communities: [
        { id: 'c_alpha', label: 'Alpha', domain: 'd_general' },
        { id: 'c_beta', label: 'Beta', domain: 'd_general' },
      ],
      assignments,
    };
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-lot0-'));
  for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
    await page('wiki/concepts', name, `---\ngroup: ${name}\n---\n\n# ${name}\n\nContenu ${name}.\n`);
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('registre v3 publié par la synthèse', () => {
  it('écrit la preuve de couverture et l’empreinte de connaissance', async () => {
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, { propose: proposer() });
    expect(outcome.status).toBe('published');

    const registry = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    expect(registry.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    expect(registry.corpusAlgorithm).toBe(KNOWLEDGE_ETAG_ALGORITHM);
    expect(registry.corpus).toBe(await knowledgeEtag(root));

    // Le dénominateur de la couverture vit dans le registre publié : un lecteur
    // marqueur + registre doit pouvoir calculer les états sans rejouer la
    // synthèse, c'est-à-dire sans appeler de modèle.
    expect(registry.corpusPageIds.length).toBe(4);
    expect(registry.sampledPageIds).toEqual(registry.corpusPageIds);
    expect((await readMarker(root))?.corpusAlgorithm).toBe(KNOWLEDGE_ETAG_ALGORITHM);
  });

  it('ne se périme pas sur un build ni sur une régénération de deliverable', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: proposer() });

    await page('templates', 'rapport', '# Modèle\n');
    await page('deliverables', 'rapport', '# Rapport régénéré\n');

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
    expect(snapshot.coverage.fresh).toBe(true);
    expect(snapshot.coverage.counts['pending-classification']).toBe(0);
    expect(snapshot.coverage.counts.classified).toBe(4);
  });

  it('met en attente une page ingérée après la synthèse, sans l’appeler non classée', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: proposer() });
    await page('wiki/concepts', 'epsilon', '---\ngroup: epsilon\n---\n\n# epsilon\n\nNouvelle.\n');

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });

    /*
     C'est le § 0.3 : le registre a été publié avant l'ingestion. Les pages
     qu'il ne connaît pas ne sont pas « non classées », elles attendent. Le
     compteur `Ungrouped` doit rester à zéro.
    */
    expect(snapshot.coverage.fresh).toBe(false);
    expect(snapshot.coverage.counts.unclassified).toBe(0);
    expect(snapshot.coverage.counts['pending-classification']).toBe(5);
  });
});

describe('registre v2 hérité', () => {
  it('ne prouve aucune couverture : tout est en attente jusqu’à la première publication v3', async () => {
    /*
     Un registre v2 n'a ni corpus déclaré, ni échantillon. Le lecteur ignore
     toute version inconnue — deviner la sémantique d'un format ancien est la
     façon la plus sûre de corrompre — et l'état honnête est donc l'attente, pas
     un bloc de pages présentées comme des échecs de classement.
    */
    const generation = await writeGeneration(root, {
      schemaVersion: 2,
      revision: 1,
      corpus: 'legacy',
      languages: ['fr'],
      communities: [{ id: 'cmty_1', prefLabel: { fr: 'Ancien' }, firstSeenRevision: 1 }],
      assignments: { 'wiki/concepts/alpha.md': { primaryCommunity: 'cmty_1' } },
    });
    await publishGeneration(root, {
      corpus: 'legacy',
      registryRef: generation.ref,
      registryHash: generation.hash,
    });

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });

    expect(snapshot.coverage.fresh).toBe(false);
    expect(snapshot.coverage.counts.unclassified).toBe(0);
    expect(snapshot.coverage.counts['pending-classification']).toBe(4);
  });
});

describe('borne de familles', () => {
  it('reporte la synthèse avec un diagnostic plutôt qu’un prompt surdimensionné', async () => {
    let calls = 0;
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, {
      maxFamilies: 2,
      propose: async (request) => {
        calls += 1;
        return proposer()(request);
      },
    });

    expect(outcome.status).toBe('deferred');
    if (outcome.status === 'deferred') expect(outcome.code).toBe('family-limit');
    // Le report est un résultat de SYNTHÈSE, pas un état de page : aucun appel
    // n'est payé, et le registre précédent reste ce qu'il était.
    expect(calls).toBe(0);
    expect(await readActiveRegistry(root)).toBeNull();
  });

  it('publie normalement sous la borne', async () => {
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, {
      maxFamilies: 50,
      propose: proposer(),
    });
    expect(outcome.status).toBe('published');
  });
});

describe('vidange de l’échantillon', () => {
  it('soumet d’abord ce qui n’a jamais été jugé, et cumule les passes', async () => {
    // Passe 1 : budget volontairement étroit, la moitié du corpus reste dehors.
    const first = await synthesizeTaxonomy(root, { language: 'fr' }, {
      maxPages: 2,
      propose: proposer(),
    });
    expect(first.status).toBe('published');
    if (first.status !== 'published') return;
    expect(first.outsideSample).toBe(2);

    const afterFirst = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    expect(afterFirst.sampledPageIds.length).toBe(2);

    // Passe 2 : même corpus. Les pages déjà couvertes passent derrière, les
    // recalées passent devant — sans quoi la borne écarterait éternellement les
    // mêmes pages.
    const second = await synthesizeTaxonomy(root, { language: 'fr' }, {
      maxPages: 2,
      propose: proposer(),
    });
    expect(second.status).toBe('published');
    if (second.status !== 'published') return;

    const afterSecond = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    // L'échantillon CUMULE : sans cela la passe 2 ferait retomber celui de la
    // passe 1 hors échantillon et la vidange oscillerait indéfiniment.
    expect(afterSecond.sampledPageIds).toEqual(afterSecond.corpusPageIds);
    expect(second.outsideSample).toBe(0);

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
    expect(snapshot.coverage.counts['outside-sample']).toBe(0);
  });

  it('ne répute couverte aucune page quand l’empreinte a changé', async () => {
    // Passe 1 sous budget étroit : alpha et beta sont jugés, gamma et delta non.
    const first = await synthesizeTaxonomy(root, { language: 'fr' }, {
      maxPages: 2,
      propose: proposer(),
    });
    expect(first.status).toBe('published');

    const before = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    expect(before.sampledPageIds).toEqual(['wiki/concepts/alpha.md', 'wiki/concepts/beta.md']);

    // Le corpus bouge : chaque page existante est réécrite, puis l'ingestion
    // publie sa révision — sans quoi le compare-and-swap refuserait à juste
    // titre une synthèse calculée sur un corpus que le marqueur ignore.
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
      await page('wiki/concepts', name, `---\ngroup: ${name}\n---\n\n# ${name}\n\nContenu révisé.\n`);
    }
    await publishCorpusRevision(root);

    /*
     Un registre périmé ne prouve AUCUNE couverture.

     Si `alpha` et `beta` restaient réputées couvertes, la priorité les
     reléguerait en fin d'échantillon et le budget de deux pages irait à `gamma`
     et `delta` : les deux pages RÉÉCRITES seraient écartées au motif d'un
     classement qui ne décrit plus leur contenu. Sur une empreinte nouvelle,
     personne n'est prioritaire — l'ordre repart du corpus lui-même.
    */
    const second = await synthesizeTaxonomy(root, { language: 'fr' }, {
      maxPages: 2,
      propose: proposer(),
    });
    expect(second.status).toBe('published');
    if (second.status !== 'published') return;

    const after = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    expect(after.corpus).not.toBe(before.corpus);
    // Le cumul ne traverse pas non plus une empreinte nouvelle.
    expect(after.sampledPageIds).toEqual(['wiki/concepts/alpha.md', 'wiki/concepts/beta.md']);
  });

  it('n’invente pas d’échantillon quand le corpus tient dans le budget', async () => {
    const inventory = buildTaxonomyInventory(
      await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' }),
      { language: 'fr', corpus: 'c1', covered: new Set() },
    );
    expect(inventory.sampledPageIds).toEqual(inventory.corpusPageIds);
    expect(inventory.truncated).toBe(false);
  });
});
