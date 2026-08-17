import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { synthesizeTaxonomy } from '../src/graph/wiki/taxonomy/run.ts';
import { buildTaxonomyInventory } from '../src/graph/wiki/taxonomy/inventory.ts';
import {
  buildSynthesisPrompt,
  checkProposal,
  retryHint,
  SYNTHESIS_SYSTEM,
} from '../src/graph/wiki/taxonomy/synthesize.ts';
import { loadWikiGraphSnapshot } from '../src/graph/wiki/overview.ts';
import { readActiveRegistry, readDirtyFlag } from '../src/graph/wiki/taxonomy/store.ts';
import { validateRegistry, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';

let root = '';

/*
 Corpus de forme ACPI : plusieurs produits nommés qui servent le même but,
 chacun avec ses pages, plus un domaine réellement distinct à côté.

 Aucun de ces noms n'apparaît dans le code ni dans le prompt : c'est la règle
 STRUCTURELLE « préférer un domaine commun à une communauté par produit » qui
 doit les rassembler. Les coder en dur produirait une taxonomie qui ne
 survivrait pas au prochain corpus.
*/
const PRODUCTS = ['anaplan', 'board', 'prophix'];

async function page(dir: string, name: string, body: string) {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, `${name}.md`), body, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-synth-'));
  for (const product of PRODUCTS) {
    await page('wiki/concepts', product, `---\ngroup: ${product}\n---\n\n# ${product}\n\nOutil de pilotage.\n`);
    await page(
      'wiki/concepts',
      `${product}-integration`,
      `---\ngroup: ${product}\n---\n\n# Intégration ${product}\n\nVoir [${product}](./${product}.md).\n`,
    );
  }
  await page('wiki/concepts', 'reseau', '---\ngroup: Reseau\n---\n\n# Réseau\n\nTopologie.\n');
  await page('wiki/concepts', 'routage', '---\ngroup: Reseau\n---\n\n# Routage\n\nVoir [réseau](./reseau.md).\n');
  // Deuxième sujet non-produit : un domaine a besoin d'au moins deux
  // communautés filles, sans quoi il ajoute un clic sans rien séparer.
  await page('wiki/concepts', 'chiffrement', '---\ngroup: Securite\n---\n\n# Chiffrement\n\nClés.\n');
  await page('wiki/concepts', 'authentification', '---\ngroup: Securite\n---\n\n# Authentification\n\nVoir [chiffrement](./chiffrement.md).\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const inventoryOf = async () => {
  const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
  return buildTaxonomyInventory(snapshot, { language: 'fr' });
};

/**
 * Modèle simulé, hiérarchique : un domaine par grand sujet, une feuille par
 * produit. C'est la forme que la carte doit rendre — `carte → domaine →
 * communauté → document` — et celle qu'une proposition plate ne peut pas
 * exprimer.
 */
function conceptualProposer(label = 'Solutions') {
  return async (request: { system: string; user: string }) => {
    const rows = [...request.user.matchAll(/^- (f\d+) :: (.*)$/gm)].map((match) => ({ id: match[1]!, text: match[2]! }));
    const owner = (text: string) => PRODUCTS.find((product) => text.includes(product)) ?? null;
    const communities = [
      ...PRODUCTS.map((product) => ({ id: `c_${product}`, label: product, domain: 'solutions' })),
      { id: 'c_topologie', label: 'Topologie', domain: 'infra' },
      { id: 'c_protection', label: 'Protection', domain: 'infra' },
    ];
    const assignments: Record<string, string> = {};
    let alternate = 0;
    for (const row of rows) {
      const product = owner(row.text);
      if (product) assignments[row.id] = `c_${product}`;
      else assignments[row.id] = (alternate++ % 2) ? 'c_protection' : 'c_topologie';
    }
    return {
      domains: [
        { id: 'solutions', label, scopeNote: 'Outils de pilotage.' },
        { id: 'infra', label: 'Infrastructure', scopeNote: 'Réseau et protection.' },
      ],
      communities,
      assignments,
    };
  };
}

describe('inventaire soumis à la synthèse', () => {
  it('montre la taxonomie active comme continuité, jamais comme preuve de regroupement', async () => {
    const inventory = await inventoryOf();
    inventory.communitiesFromRegistry = true;
    inventory.communities = [
      { id: 'old', label: 'AncienProduit', size: 2, scopeNote: 'Pilotage.', topPages: ['wiki/concepts/anaplan.md'] },
    ];

    const prompt = buildSynthesisPrompt(inventory);
    // Le libellé précédent est transmis, avec son périmètre et ses pages les
    // plus centrales : c'est ce qui permet au modèle de réutiliser le nom au
    // lieu d'en inventer un à chaque exécution.
    expect(prompt).toContain('AncienProduit');
    expect(prompt).toContain('scope=Pilotage.');
    expect(prompt).toContain('top=wiki/concepts/anaplan.md');
    // Mais la règle le présente comme continuité, pas comme vérité de
    // regroupement : le modèle regroupe sur les familles, pas sur ces libellés.
    expect(SYNTHESIS_SYSTEM).toContain('reuse its existing label');
    expect(SYNTHESIS_SYSTEM).not.toContain('never semantic evidence');
  });

  it('n’émet aucune continuité depuis la projection déterministe', async () => {
    /*
     Sans registre publié, inventory.communities vient d'assignGraphCommunities :
     des libellés dérivés de group: et le repli « Ungrouped ». Les présenter
     comme « Previous communities » réintroduirait l'identité que le Lot 0 a
     retirée, et l'exemple le plus visible contredirait la règle anti fourre-tout.
    */
    const inventory = await inventoryOf();
    expect(inventory.communitiesFromRegistry).toBe(false);

    const prompt = buildSynthesisPrompt(inventory);
    expect(prompt).not.toContain('Previous communities');
    expect(prompt).not.toContain('Ungrouped');
  });

  it('rend l’extrait de la page la plus centrale quand le fournisseur en fournit', async () => {
    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
    const inventory = buildTaxonomyInventory(snapshot, {
      language: 'fr',
      excerpts: new Map([['wiki/concepts/anaplan.md', 'Outil de pilotage financier.']]),
    });
    const prompt = buildSynthesisPrompt(inventory);

    // Un titre ne dit pas le sujet : l'extrait court de la page la plus
    // connectée de chaque famille est ce qui permet de nommer le domaine.
    expect(prompt).toContain('excerpt: Outil de pilotage financier.');
  });

  it('borne l’extrait transmis au modèle', async () => {
    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
    const long = 'a'.repeat(500);
    const inventory = buildTaxonomyInventory(snapshot, {
      language: 'fr',
      excerpts: new Map([['wiki/concepts/anaplan.md', long]]),
    });
    const prompt = buildSynthesisPrompt(inventory);

    // MAX_EXCERPT tronque : on ne transporte jamais la page entière.
    const excerptLine = prompt.split('\n').find((line) => line.includes('excerpt:'));
    expect(excerptLine).toBeDefined();
    expect(excerptLine!.length).toBeLessThan(200);
    expect(excerptLine).toContain('…');
  });

  it('ne transporte jamais le contenu des pages sans extrait fourni', async () => {
    const inventory = await inventoryOf();
    const prompt = buildSynthesisPrompt(inventory);

    // Le snapshot public retire déjà raw/html/preview : l'inventaire n'a donc
    // aucun moyen d'y prendre du contenu. Le contenu n'entre qu'à travers les
    // extraits fournis explicitement par l'appelant.
    expect(prompt).not.toContain('Outil de pilotage.');
    expect(prompt).not.toContain('Topologie.');
    expect(JSON.stringify(inventory)).not.toContain('# Réseau');
  });

  it('transmet les indices structurels dont dépend le regroupement', async () => {
    const inventory = await inventoryOf();
    const prompt = buildSynthesisPrompt(inventory);

    expect(prompt).toContain('Language for every label: fr.');
    expect(prompt).toMatch(/signals=/);
    // Le groupe reste un SIGNAL transmis au modèle — c'est tout ce qu'il est.
    expect(prompt).toMatch(/signals=Securite/);
  });

  it('ne fusionne plus deux pages sur la seule égalité de group:', async () => {
    const inventory = await inventoryOf();

    /*
     `chiffrement` et `authentification` partagent `group: Securite` et ne
     citent aucune source : rien ne prouve qu'elles sont un même sujet.

     L'union globale par groupe faisait exactement l'inverse de ce qu'on attend
     d'elle sur un corpus comparatif — elle rassemblait cinq produits sous
     `security` tout en dispersant les pages d'un même produit dont les groupes
     divergeaient. Le modèle voit le signal et décide ; le moteur ne décide plus
     à sa place.
    */
    const familyOf = (page: string) =>
      inventory.families.find((family) => family.members.some((member) => member.endsWith(page)))?.id;

    expect(familyOf('chiffrement.md')).not.toBe(familyOf('authentification.md'));
    expect(inventory.families.length).toBe(inventory.pages.length);
  });

  /*
   La règle qui doit produire le regroupement conceptuel attendu. Elle est
   structurelle : aucun produit, aucun domaine n'est nommé.
  */
  it('demande un domaine commun plutôt qu’une communauté par produit', () => {
    expect(SYNTHESIS_SYSTEM).toContain('prefer one common domain over one community per product');
    expect(SYNTHESIS_SYSTEM).toContain('exactly one word');
    // Aucun vocabulaire métier dans les règles.
    for (const product of [...PRODUCTS, 'acpi', 'solution']) {
      expect(SYNTHESIS_SYSTEM.toLowerCase()).not.toContain(product);
    }
  });

  it('borne le corpus et le dit', async () => {
    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
    const inventory = buildTaxonomyInventory(snapshot, { language: 'fr', maxPages: 3 });

    expect(inventory.pages).toHaveLength(3);
    expect(inventory.truncated).toBe(true);
  });

  it('relie une collection comparative sans fusionner ses sujets', async () => {
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    for (const name of names) {
      await page('raw/ingested/etudes/logiciels', name, `# Étude ${name}\n\nVoir [source](../../../../wiki/sources/${name}.md).\n`);
      await page('wiki/sources', name, `# Étude ${name}\n\nVoir [archive](../../raw/ingested/etudes/logiciels/${name}.md).\n`);
    }
    const inventory = await inventoryOf();
    const families = names.map((name) => inventory.families.find((item) =>
      item.members.some((member) => member.endsWith(`/logiciels/${name}.md`)))!);

    expect(families.every(Boolean)).toBe(true);
    expect(new Set(families.map((item) => item.id)).size).toBe(5);
    expect(families.every((item) => item.members.some((member) => member.endsWith(`/sources/${path.basename(item.members.find((member) => member.includes('/logiciels/'))!)}`)))).toBe(true);
    expect(new Set(families.flatMap((item) => item.collections)).size).toBe(1);
    // Le code de production reste agnostique : ces noms n'existent que dans
    // ce corpus de test et ne sont jamais nécessaires à la règle.
    expect(SYNTHESIS_SYSTEM).not.toMatch(/alpha|beta|gamma|delta|epsilon/);
  });

  it('ne ré-agglomère pas les concepts des sujets comparés', async () => {
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    for (const name of names) {
      await page('raw/ingested/collection', `etude-outils-pilotage-${name}`, `# Étude outils pilotage ${name}\n`);
      await page('wiki/concepts/outils', `${name}-fonctionnalites`, `# Fonctionnalités ${name}\n`);
    }
    const inventory = await inventoryOf();
    const conceptFamilies = names.map((name) => inventory.families.find((item) =>
      item.members.some((member) => member.endsWith(`/${name}-fonctionnalites.md`)))!);

    expect(conceptFamilies.every(Boolean)).toBe(true);
    expect(new Set(conceptFamilies.map((item) => item.id)).size).toBe(5);
    expect(Math.max(...inventory.families.map((item) => item.members.length))).toBeLessThan(10);
  });
});

describe('validation d’une proposition', () => {
  it('explains how to fix leaves without a family', () => {
    const hint = retryHint([
      { path: 'assignments', reason: 'community without a family: c8' },
      { path: 'assignments', reason: 'community without a family: c24' },
    ]);

    expect(hint).toContain('Unused communities: c8, c24');
    expect(hint).toContain('assign at least one appropriate family');
    expect(hint).toContain('remove it from the communities array entirely');
    expect(hint).toContain('every declared community');
  });

  it('refuse une famille inventée', async () => {
    const inventory = await inventoryOf();
    const result = checkProposal(
      { domains: [{ id: 'd', label: 'Solutions' }], communities: [{ id: 'a', label: 'Alpha', domain: 'd' }, { id: 'b', label: 'Beta', domain: 'd' }], assignments: { fantome: 'a' } },
      inventory,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.reason.includes('unknown family'))).toBe(true);
  });

  it('refuse une couverture incomplète', async () => {
    const inventory = await inventoryOf();
    const result = checkProposal(
      { domains: [{ id: 'd', label: 'Solutions' }], communities: [{ id: 'a', label: 'Alpha', domain: 'd' }, { id: 'b', label: 'Beta', domain: 'd' }], assignments: { [inventory.families[0]!.id]: 'a' } },
      inventory,
    );

    // Une page oubliée retomberait au repli sans que rien ne le signale : la
    // carte mentirait sur ce qu'elle a compris.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.reason.startsWith('unassigned family'))).toBe(true);
  });

  it('refuse un libellé qui n’est pas un mot unique', async () => {
    const inventory = await inventoryOf();
    for (const label of ['solutions/anaplan', 'solutions_saas', 'Solutions SaaS']) {
      const result = checkProposal(
        { domains: [{ id: 'd', label }], communities: [{ id: 'a', label: 'Alpha', domain: 'd' }, { id: 'b', label: 'Beta', domain: 'd' }], assignments: Object.fromEntries(inventory.families.map((item, index) => [item.id, index ? 'b' : 'a'])) },
        inventory,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('refuse une affectation vers une communauté inconnue', async () => {
    const inventory = await inventoryOf();
    const result = checkProposal(
      {
        domains: [{ id: 'd', label: 'Solutions' }],
        communities: [{ id: 'a', label: 'Alpha', domain: 'd' }, { id: 'b', label: 'Beta', domain: 'd' }],
        assignments: Object.fromEntries(inventory.families.map((item, index) => [item.id, index ? 'b' : 'fantome'])),
      },
      inventory,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.reason.includes('unknown community'))).toBe(true);
  });
});

describe('synthèse complète', () => {
  it('publie une collection comparative comme relations entre feuilles', async () => {
    for (const product of PRODUCTS) {
      await page('raw/ingested/comparatif', product, `# Étude ${product}\n\nVoir [source](../../../wiki/sources/${product}.md).\n`);
      await page('wiki/sources', product, `# Étude ${product}\n\nVoir [archive](../../raw/ingested/comparatif/${product}.md).\n`);
    }

    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    expect(outcome.status).toBe('published');
    const registry = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;

    const assignments = PRODUCTS.map((product) => registry.assignments[`raw/ingested/comparatif/${product}.md`]!);
    expect(new Set(assignments.map((item) => item.primaryCommunity)).size).toBe(3);
    expect(assignments.every((item) => item.relatedCommunities?.length === 2)).toBe(true);
    for (const assignment of assignments) {
      expect(assignment.relatedCommunities).not.toContain(assignment.primaryCommunity);
    }
  });

  it('publie un registre et rattache les produits au domaine conceptuel', async () => {
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });

    expect(outcome.status).toBe('published');
    if (outcome.status !== 'published') return;
    expect(outcome.revision).toBeGreaterThan(0);

    const active = await readActiveRegistry(root);
    const registry = active?.registry as TaxonomyRegistry;
    expect(validateRegistry(registry).ok).toBe(true);

    /*
     Chaque produit garde SA communauté ; c'est leur domaine qui est commun.

     L'attente inverse — un seul groupe pour les trois — est exactement ce qui
     avait produit une bulle de 142 pages : réduire le nombre de bulles en
     fusionnant les sujets détruit la navigation qu'on prétendait simplifier.
    */
    const byId = new Map(registry.communities.map((item) => [item.id, item]));
    const byPage = registry.assignments;
    const leaves = PRODUCTS.map((product) => byPage[`wiki/concepts/${product}.md`]!.primaryCommunity);
    expect(new Set(leaves).size).toBe(PRODUCTS.length);

    // ... et ils relèvent tous du même domaine, nommé d'après le concept.
    const parents = new Set(leaves.map((id) => byId.get(id)!.parentCommunity));
    expect(parents.size).toBe(1);
    const domain = byId.get([...parents][0] as string)!;
    expect(domain.prefLabel.fr).toBe('Solutions');
    expect(domain.parentCommunity ?? null).toBeNull();

    // Aucune page n'est accrochée au domaine : il agrège ses feuilles.
    expect(Object.values(byPage).some((item) => item.primaryCommunity === domain.id)).toBe(false);

    // Et le sujet réellement distinct relève d'un autre domaine.
    const other = byId.get(byPage['wiki/concepts/reseau.md']!.primaryCommunity)!;
    expect(other.parentCommunity).not.toBe(domain.id);
  });

  it('rend la nouvelle taxonomie visible dans le snapshot', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });

    const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });

    expect(snapshot.synthesized).toBe(true);
    expect(snapshot.taxonomyRevision).toBeGreaterThan(0);
    // Le snapshot rend la FEUILLE : c'est le niveau qui porte les pages. Le
    // domaine est ce que la carte agrège, pas ce qu'une page déclare.
    const page = snapshot.nodes.find((node) => node.id === 'wiki/concepts/anaplan.md');
    expect(page?.community).toMatchObject({ communityLabel: 'anaplan', assignment: 'synthesized' });
  });

  /*
   Dégradation gracieuse : sans LLM configuré, le graphe garde sa projection
   déterministe et le dit. Jamais une erreur, jamais une page vide.
  */
  it('ne tente rien sans LLM et laisse le déterministe en place', async () => {
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, {});

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_llm' });
    expect(await readActiveRegistry(root)).toBeNull();
  });

  /*
   La docstring promet « ne lève jamais », et trois appelants — la commande, le
   watcher, la capacité de production — ont été écrits en la croyant. Seule la
   partie basse de la fonction l'honorait : le chargement du snapshot et la
   lecture du registre restaient à découvert.
  */
  it('ne laisse pas remonter une exception de préparation', async () => {
    // La panne est injectée dans la construction de l'inventaire, donc AVANT la
    // boucle de retry qui, elle, était déjà protégée. Peu importe la source :
    // c'est la frontière de la fonction que le contrat engage.
    const broken = new Map<string, string>();
    Object.defineProperty(broken, 'get', {
      value() {
        throw new Error('lecture du corpus impossible');
      },
    });
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: conceptualProposer(), excerpts: broken },
    );

    expect(outcome.status).toBe('deferred');
    if (outcome.status !== 'deferred') return;
    // L'échec se dit : un « deferred » muet se retenterait en silence à jamais.
    expect(outcome.reason).toBeTruthy();
  });

  /*
   Un domaine aplati — réduit à un enfant unique promu racine — disparaissait du
   registre sans souche : le seul cas où une communauté s'évanouissait sans
   laisser de trace, alors que tout le modèle s'interdit cela pour qu'une
   sélection ancienne reste résoluble.
  */
  it('laisse une souche derrière un domaine aplati', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    const before = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;
    const domainId = before.communities.find((item) => item.prefLabel.fr === 'Infrastructure')!.id;

    // Le domaine « Infrastructure » n'a plus qu'une fille : il est aplati.
    const oneChild = async (request: { system: string; user: string }) => {
      const proposal = await conceptualProposer()(request);
      proposal.communities = proposal.communities.filter((item) => item.id !== 'c_protection');
      for (const [family, community] of Object.entries(proposal.assignments)) {
        if (community === 'c_protection') proposal.assignments[family] = 'c_topologie';
      }
      return proposal;
    };
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: oneChild });
    const after = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;
    const stub = after.communities.find((item) => item.id === domainId);

    expect(stub).toBeDefined();
    expect(stub!.deprecated).toBe(true);
    // Il pointe vers son enfant promu, qui porte exactement les mêmes pages.
    expect(stub!.replacedBy).toBeTruthy();
    expect(validateRegistry(after).ok).toBe(true);
  });

  /*
   L'échantillon décide, le corpus entier reçoit la décision.

   `maxPages` borne ce qu'on soumet au modèle, mais les affectations étaient
   reconstruites à partir de ce seul échantillon : au-delà de 400 pages — ou
   sous `--max-pages` — toutes les autres disparaissaient du registre publié,
   retombaient sur la projection déterministe, et la synthèse suivante effaçait
   au passage leur affectation précédente. Le snapshot annonçait pourtant une
   taxonomie synthétisée.

   Les tests couvraient la construction d'un inventaire tronqué, jamais la
   couverture du registre finalement publié.
  */
  it('ne perd pas les pages hors échantillon quand le corpus est tronqué', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    const full = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;
    const covered = Object.keys(full.assignments).length;
    expect(covered).toBeGreaterThan(3);

    // Le modèle ne voit plus que trois pages ; le registre doit continuer d'en
    // couvrir autant qu'avant.
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer(), maxPages: 3 });
    const after = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;

    expect(Object.keys(after.assignments).length).toBe(covered);
    for (const page of Object.keys(full.assignments)) {
      expect(after.assignments[page]).toBeDefined();
    }
    // Chaque affectation reconduite pointe une communauté vivante du NOUVEAU
    // registre : une cible fusionnée doit avoir été suivie, pas recopiée.
    const live = new Map(after.communities.map((item) => [item.id, item]));
    for (const assignment of Object.values(after.assignments)) {
      expect(live.get(assignment.primaryCommunity)?.deprecated).not.toBe(true);
    }
    expect(validateRegistry(after).ok).toBe(true);
  });

  /*
   Le fond de l'affaire : une absence d'information n'est pas une décision.

   Sur un corpus tronqué, une communauté dont aucune page n'était dans
   l'échantillon n'apparaissait dans aucun brouillon, donc était traitée comme
   disparue et dépréciée — alors que le modèle ne l'a jamais vue. Ses pages
   perdaient toute cible et sortaient du registre. Déduire une suppression de ce
   qu'on n'a pas montré, c'est inventer une décision que personne n'a prise.
  */
  it('ne déprécie pas une communauté que le modèle n’a jamais vue', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    const before = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;
    const liveBefore = before.communities.filter((item) => !item.deprecated).map((item) => item.id);

    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer(), maxPages: 3 });
    const after = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;
    const deprecated = new Set(
      after.communities.filter((item) => item.deprecated).map((item) => item.id),
    );

    // Les pages hors échantillon gardent une communauté vivante ; aucune de
    // leurs communautés n'a été enterrée faute d'avoir été soumise.
    const unsampledPages = Object.keys(before.assignments)
      .filter((page) => after.assignments[page]);
    expect(unsampledPages.length).toBe(Object.keys(before.assignments).length);
    for (const page of unsampledPages) {
      expect(deprecated.has(after.assignments[page]!.primaryCommunity)).toBe(false);
    }
    // Et leurs identifiants sont les mêmes : la troncature ne renomme rien.
    expect(liveBefore.every((id) => after.communities.some((item) => item.id === id))).toBe(true);
  });

  it('annonce ce qui reste sans affectation sur un corpus tronqué', async () => {
    // Première synthèse tronquée : aucune révision précédente d'où reconduire,
    // donc une partie du corpus n'a réellement aucune décision. La carte reste
    // publiable — refuser priverait de tout — mais elle doit le dire.
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: conceptualProposer(), maxPages: 3 },
    );

    expect(outcome.status).toBe('published');
    if (outcome.status !== 'published') return;
    expect(outcome.warnings.some((warning) => warning.includes('without assignment'))).toBe(true);
  });

  it('ne se plaint de rien quand le corpus tient entier', async () => {
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });

    expect(outcome.status).toBe('published');
    if (outcome.status !== 'published') return;
    expect(outcome.warnings.some((warning) => warning.includes('without assignment'))).toBe(false);
  });

  it('rejette en bloc une proposition non conforme, sans rien publier', async () => {
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: async () => ({ domains: [{ id: 'x', label: 'deux mots' }], assignments: {} }) },
    );

    expect(outcome.status).toBe('rejected');
    expect(await readActiveRegistry(root)).toBeNull();
    // La synthèse perdue est signalée : Serve ne peut pas la refaire, la
    // capacité orchestrée la reprendra.
    expect(await readDirtyFlag(root)).toMatchObject({ kind: 'pendingSynthesis' });
  });

  it('borne les tentatives face à un modèle qui n’aboutit jamais', async () => {
    let calls = 0;
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      {
        propose: async () => {
          calls += 1;
          return { domains: [{ id: 'x', label: 'a/b' }], assignments: {} };
        },
      },
    );

    expect(outcome.status).toBe('rejected');
    expect(calls).toBe(3);
  });

  it('conserve les identifiants d’une communauté qui a seulement grossi', async () => {
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    const before = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;

    await page('wiki/concepts', 'anaplan-suite', '---\ngroup: anaplan\n---\n\n# Suite\n\nVoir [anaplan](./anaplan.md).\n');
    await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    const after = (await readActiveRegistry(root))!.registry as TaxonomyRegistry;

    // Sans ré-ancrage, la bulle changerait d'identité à chaque ingestion et
    // perdrait sa position Canvas et la sélection en cours.
    expect(new Set(after.communities.map((item) => item.id)))
      .toEqual(new Set(before.communities.map((item) => item.id)));
  });
});

describe('empreinte gelée à la barrière (§7.2)', () => {
  /*
   La capacité de production gèle l'empreinte après le dernier apply, puis lance
   la tâche taxonomique avec cette valeur. Si le corpus a bougé entre la barrière
   et la synthèse, celle-ci est périmée avant même le premier appel au modèle :
   la refuser tout de suite est honnête et épargne le coût d'une proposition que
   le compare-and-swap rejetterait de toute façon.
   */
  it('refuse avant tout appel quand le corpus a bougé depuis la barrière', async () => {
    const { knowledgeEtag } = await import('../src/graph/wiki/taxonomy/knowledge.ts');
    const frozen = await knowledgeEtag(root);

    // Une ingestion concurrente modifie le corpus après le gel.
    await page('wiki/concepts', 'arrive-tard', '---\ngroup: autre\n---\n\n# Arrivé tard\n');

    let calls = 0;
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      {
        propose: async () => {
          calls += 1;
          return conceptualProposer()({ system: '', user: '' });
        },
        expectedCorpus: frozen,
      },
    );

    expect(outcome.status).toBe('stale');
    expect(calls).toBe(0);
    // Rien n'a été publié.
    expect(await readActiveRegistry(root)).toBeNull();
  });

  it('synthétise normalement quand l’empreinte gelée correspond encore', async () => {
    const { knowledgeEtag } = await import('../src/graph/wiki/taxonomy/knowledge.ts');
    const frozen = await knowledgeEtag(root);

    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: conceptualProposer(), expectedCorpus: frozen },
    );

    expect(outcome.status).toBe('published');
  });

  it('sans empreinte gelée, ne change rien au comportement existant', async () => {
    const outcome = await synthesizeTaxonomy(root, { language: 'fr' }, { propose: conceptualProposer() });
    expect(outcome.status).toBe('published');
  });
});
