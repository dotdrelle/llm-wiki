import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTaxonomyInventory } from '../src/graph/wiki/taxonomy/inventory.ts';
import { buildSynthesisPrompt, checkProposal, SYNTHESIS_SYSTEM } from '../src/graph/wiki/taxonomy/synthesize.ts';
import { loadWikiGraphSnapshot } from '../src/graph/wiki/overview.ts';

/*
 Le défaut de la révision 7 : tailles correctes, hiérarchie correcte, et
 pourtant chaque sujet comparé renommé d'après sa FONCTION — planification,
 visualisation, analyse — donc effacé comme identité navigable.

 Les noms ci-dessous n'existent que dans ce corpus de test : le terme
 distinctif est déduit par différence de vocabulaire entre les études d'une
 même collection, jamais d'une liste connue du code.
*/
const SUBJECTS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

let root = '';

async function page(dir: string, name: string, body: string) {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, `${name}.md`), body, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-identity-'));
  for (const subject of SUBJECTS) {
    await page(
      'raw/ingested/etudes/outils',
      subject,
      `# Étude ${subject}\n\nVoir [source](../../../../wiki/sources/${subject}.md).\n`,
    );
    await page('wiki/sources', subject, `# Étude ${subject}\n\nVoir [archive](../../raw/ingested/etudes/outils/${subject}.md).\n`);
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const inventoryOf = async () => {
  const snapshot = await loadWikiGraphSnapshot({ rootDir: root, language: 'fr' });
  return buildTaxonomyInventory(snapshot, { language: 'fr' });
};

const familyOf = (inventory: Awaited<ReturnType<typeof inventoryOf>>, subject: string) =>
  inventory.families.find((family) => family.members.some((member) => member.includes(`/${subject}.md`)))!;

describe('terme distinctif d’une étude', () => {
  it('se déduit par différence, sans connaître les sujets', () => {
    // La règle ne nomme rien : elle décrit une opération sur le corpus.
    for (const subject of SUBJECTS) expect(SYNTHESIS_SYSTEM.toLowerCase()).not.toContain(subject);
    expect(SYNTHESIS_SYSTEM).toContain('when a family carries identity=');
  });

  it('retient ce que les sœurs n’ont pas', async () => {
    const inventory = await inventoryOf();

    for (const subject of SUBJECTS) {
      expect(familyOf(inventory, subject).distinctiveTerms).toContain(subject);
    }
    // « étude », partagé par les cinq, n'identifie personne.
    expect(familyOf(inventory, 'alpha').distinctiveTerms).not.toContain('etude');
  });

  it('n’invente pas d’identité hors d’une comparaison', async () => {
    // Un sujet seul dans sa collection ne compare rien : tout terme paraîtrait
    // distinctif, et l'imposer figerait un nom arbitraire.
    await rm(path.join(root, 'raw/ingested/etudes/outils'), { recursive: true, force: true });
    await page('raw/ingested/solo', 'unique', '# Étude unique\n');

    const inventory = await inventoryOf();
    const solo = inventory.families.find((family) => family.members.some((member) => member.includes('/unique.md')));
    expect(solo?.distinctiveTerms ?? []).toEqual([]);
  });

  it('parvient jusqu’au modèle', async () => {
    const prompt = buildSynthesisPrompt(await inventoryOf());

    expect(prompt).toMatch(/identity=/);
    expect(prompt).toContain('alpha');
  });
});

describe('conservation de l’identité à la validation', () => {
  const tree = (labels: Record<string, string>) => ({
    domains: [{ id: 'd', label: 'Outils' }],
    communities: Object.entries(labels).map(([id, label]) => ({ id, label, domain: 'd' })),
    assignments: {} as Record<string, string>,
  });

  async function proposalWith(labels: string[]) {
    const inventory = await inventoryOf();
    const families = SUBJECTS.map((subject) => familyOf(inventory, subject));
    const proposal = tree(Object.fromEntries(families.map((family, index) => [`c${index}`, labels[index]!])));
    families.forEach((family, index) => { proposal.assignments[family.id] = `c${index}`; });
    // Les familles hors collection sont affectées à la première communauté.
    for (const family of inventory.families) {
      if (!(family.id in proposal.assignments)) proposal.assignments[family.id] = 'c0';
    }
    return { inventory, proposal };
  }

  it('accepte un libellé qui conserve l’identité du sujet', async () => {
    const { inventory, proposal } = await proposalWith(SUBJECTS);
    const result = checkProposal(proposal, inventory);

    expect(result.ok).toBe(true);
  });

  /*
   Le cœur du correctif. « planification » décrit ce que fait le sujet ; il ne
   dit pas DE QUI on parle, et la carte perd le sujet comparé.
  */
  it('signale sans bloquer un libellé qui nomme la fonction au lieu du sujet', async () => {
    const { inventory, proposal } = await proposalWith([
      'planification', 'visualisation', 'analyse', 'gestionportefeuille', 'gestionfinanciere',
    ]);
    const result = checkProposal(proposal, inventory);

    /*
     C'est un jugement, pas une erreur : le registre reste valide, toutes les
     pages sont affectées, rien n'est perdu — mais les sujets comparés y
     perdent leur nom. Bloquer là-dessus a refusé cinq synthèses d'affilée sans
     jamais laisser voir une carte, donc sans jamais permettre de juger si la
     règle avait raison.
    */
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.filter((issue) => issue.reason.startsWith('identité perdue'))).toHaveLength(5);
  });

  it('signale que deux sujets comparés partagent une communauté', async () => {
    const inventory = await inventoryOf();
    const families = SUBJECTS.map((subject) => familyOf(inventory, subject));
    const proposal = tree({ c0: 'alpha', c1: 'beta' });
    // Les cinq études tombent dans deux feuilles : la comparaison disparaît.
    families.forEach((family, index) => { proposal.assignments[family.id] = index ? 'c1' : 'c0'; });
    for (const family of inventory.families) {
      if (!(family.id in proposal.assignments)) proposal.assignments[family.id] = 'c0';
    }

    const result = checkProposal(proposal, inventory);
    // Deux sujets comparés fondus : la comparaison devient invisible, mais la
    // carte reste utilisable. On publie et on le dit.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.reason.includes('partagent la communauté'))).toBe(true);
  });

  it('tolère une variante qui contient le terme', async () => {
    // On impose la conservation de l'identité, pas une égalité stricte : le
    // modèle garde le droit de préciser.
    const { inventory, proposal } = await proposalWith(SUBJECTS.map((subject) => `${subject}suite`));

    expect(checkProposal(proposal, inventory).ok).toBe(true);
  });
});
