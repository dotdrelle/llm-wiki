import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { synthesizeTaxonomy } from '../src/graph/wiki/taxonomy/run.ts';
import { readActiveRegistry } from '../src/graph/wiki/taxonomy/store.ts';
import type { TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';

/*
 Observabilité de l'hystérésis de renommage.

 `consolidate` produisait déjà le verdict — `created`, `renamed`, `kept`,
 `unchanged` — avec le recouvrement qui le justifie, et personne ne le lisait.
 Les deux constantes qui le gouvernent (`RENAME_MIN_STABILITY`,
 `RENAME_MIN_REVISION_GAP`) n'étaient donc réglables qu'à l'aveugle. Ces tests
 fixent le contrat de la remontée : sans lui, régler un seuil redevient une
 impression.
*/

let root = '';

async function page(dir: string, name: string, body: string): Promise<void> {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, `${name}.md`), body, 'utf8');
}

/** Modèle simulé : un domaine, deux feuilles dont les libellés sont paramétrables. */
function proposer(labels: { alpha: string; beta: string; domain?: string }) {
  return async (request: { system: string; user: string }) => {
    const rows = [...request.user.matchAll(/^- (f\d+) :: /gm)].map((match) => match[1]!);
    const assignments: Record<string, string> = {};
    // Affectation STABLE par rang : les membres de chaque feuille ne bougent pas
    // d'une révision à l'autre, donc le recouvrement vaut 1 et seul le libellé
    // change. C'est exactement le cas que l'hystérésis doit trancher.
    rows.forEach((id, index) => {
      assignments[id] = index % 2 ? 'c_beta' : 'c_alpha';
    });
    return {
      domains: [{ id: 'd_general', label: labels.domain ?? 'Général', scopeNote: 'Corpus de test.' }],
      communities: [
        { id: 'c_alpha', label: labels.alpha, domain: 'd_general' },
        { id: 'c_beta', label: labels.beta, domain: 'd_general' },
      ],
      assignments,
    };
  };
}

/** Modèle simulé : une seule feuille, donc un domaine que le moteur aplatit. */
function singleLeafProposer() {
  return async (request: { system: string; user: string }) => {
    const rows = [...request.user.matchAll(/^- (f\d+) :: /gm)].map((match) => match[1]!);
    return {
      domains: [{ id: 'd_general', label: 'Général', scopeNote: 'Corpus de test.' }],
      communities: [{ id: 'c_seul', label: 'Unique', domain: 'd_general' }],
      assignments: Object.fromEntries(rows.map((id) => [id, 'c_seul'])),
    };
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-labels-'));
  for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
    await page('wiki/concepts', name, `---\ngroup: ${name}\n---\n\n# ${name}\n\nContenu ${name}.\n`);
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('décisions de libellé remontées par la synthèse', () => {
  it('rend toute première synthèse comme une création', async () => {
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: proposer({ alpha: 'Alpha', beta: 'Beta' }) },
    );
    if (outcome.status !== 'published') throw new Error(`statut inattendu : ${outcome.status}`);

    // Rien à stabiliser sur un registre vide : le domaine et ses deux feuilles
    // prennent leur nom, et aucune décision ne prétend le contraire.
    expect(outcome.labelDecisions).toHaveLength(3);
    expect(outcome.labelDecisions.every((decision) => decision.outcome === 'created')).toBe(true);
    expect(outcome.labelDecisions.map((decision) => decision.label).sort())
      .toEqual(['Alpha', 'Beta', 'Général']);
  });

  it('expose le renommage refusé avec le recouvrement qui l’a motivé', async () => {
    await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: proposer({ alpha: 'Alpha', beta: 'Beta' }) },
    );

    /*
     Mêmes membres, autres noms : le recouvrement vaut 1, mais l'écart de
     révisions minimal n'est pas atteint, donc l'hystérésis conserve.

     Les deux noms proposés diffèrent des précédents à la comparaison du
     registre, qui est insensible à la casse ET aux accents : « Bêta » aurait
     été lu comme « Beta », donc `unchanged`, et le test aurait mesuré la
     normalisation au lieu de l'hystérésis.
    */
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: proposer({ alpha: 'Alfa', beta: 'Omega' }) },
    );
    if (outcome.status !== 'published') throw new Error(`statut inattendu : ${outcome.status}`);

    const kept = outcome.labelDecisions.filter((decision) => decision.outcome === 'kept');
    expect(kept).toHaveLength(2);
    expect(kept.map((decision) => decision.label).sort()).toEqual(['Alpha', 'Beta']);
    // Le nom proposé n'est pas jeté : il est consultable, et c'est le chiffre
    // actionnable — le recouvrement — qui dit pourquoi il a été refusé.
    expect(kept.map((decision) => decision.proposed).sort()).toEqual(['Alfa', 'Omega']);
    for (const decision of kept) expect(decision.stability).toBe(1);

    // Et le registre publié porte bien l'ancien nom, pas le proposé.
    const registry = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    const labels = registry.communities
      .filter((community) => !community.deprecated)
      .map((community) => community.prefLabel.fr);
    expect(labels).toContain('Alpha');
    expect(labels).not.toContain('Alfa');
  });

  it('ne rapporte aucune décision sur un domaine aplati', async () => {
    const outcome = await synthesizeTaxonomy(
      root,
      { language: 'fr' },
      { propose: singleLeafProposer() },
    );
    if (outcome.status !== 'published') throw new Error(`statut inattendu : ${outcome.status}`);

    /*
     Le domaine à fille unique a quitté le registre : sa fille l'a remplacé à la
     racine. Rapporter une décision sur une bulle que la carte ne montre pas est
     le même défaut que de la compter parmi les communautés.
    */
    const registry = (await readActiveRegistry(root))?.registry as TaxonomyRegistry;
    const alive = new Set(
      registry.communities.filter((community) => !community.deprecated).map((community) => community.id),
    );
    for (const decision of outcome.labelDecisions) expect(alive.has(decision.id)).toBe(true);
    expect(outcome.labelDecisions).toHaveLength(1);
    expect(outcome.labelDecisions[0]!.label).toBe('Unique');
  });
});
