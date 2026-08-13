import { describe, expect, it } from 'vitest';
import { checkDistribution, MAX_LEAF_SHARE } from '../src/graph/wiki/taxonomy/distribution.ts';
import {
  MAX_COMMUNITY_DEPTH,
  REGISTRY_SCHEMA_VERSION,
  validateRegistry,
  type RegistryCommunity,
  type TaxonomyRegistry,
} from '../src/graph/wiki/taxonomy/schema.ts';

const community = (
  id: string,
  label: string,
  parentCommunity: string | null = null,
): RegistryCommunity => ({ id, prefLabel: { fr: label }, firstSeenRevision: 1, parentCommunity });

function registry(
  communities: RegistryCommunity[],
  assignments: TaxonomyRegistry['assignments'],
): TaxonomyRegistry {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 1,
    corpus: 'sha1:abc',
    languages: ['fr'],
    communities,
    assignments,
  };
}

/** L'arborescence attendue : domaine → solutions → pages. */
function hierarchical(): TaxonomyRegistry {
  const communities = [
    community('dom_logiciel', 'Logiciel'),
    community('cmty_anaplan', 'Anaplan', 'dom_logiciel'),
    community('cmty_board', 'Board', 'dom_logiciel'),
    community('dom_finance', 'Finance'),
    community('cmty_reporting', 'Reporting', 'dom_finance'),
    community('cmty_tarification', 'Tarification', 'dom_finance'),
  ];
  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const [leaf, count] of [['cmty_anaplan', 4], ['cmty_board', 3], ['cmty_reporting', 3], ['cmty_tarification', 2]] as const) {
    for (let index = 0; index < count; index += 1) {
      assignments[`wiki/${leaf}-${index}.md`] = { primaryCommunity: leaf };
    }
  }
  return registry(communities, assignments);
}

const reasons = (result: ReturnType<typeof validateRegistry>) =>
  result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.reason}`).join(' | ');

describe('arborescence du registre', () => {
  it('accepte domaine → communauté → pages', () => {
    expect(validateRegistry(hierarchical()).ok).toBe(true);
  });

  /*
   L'invariant qui empêche le fourre-tout. Autoriser l'attache directe à un
   domaine rouvrirait la porte par laquelle 142 pages se sont retrouvées dans
   une seule bulle, et un clic sur le domaine afficherait de nouveau une liste
   que personne ne peut lire.
  */
  it('refuse une page rattachée directement à un domaine parent', () => {
    const data = hierarchical();
    data.assignments['wiki/orpheline.md'] = { primaryCommunity: 'dom_logiciel' };

    expect(reasons(validateRegistry(data))).toContain('porte des communautés filles');
  });

  it('refuse un parent inconnu ou une auto-parenté', () => {
    expect(reasons(validateRegistry(registry(
      [community('cmty_a', 'Alpha', 'dom_absent')],
      { 'wiki/a.md': { primaryCommunity: 'cmty_a' } },
    )))).toContain('domaine parent inconnu');

    expect(reasons(validateRegistry(registry(
      [community('cmty_a', 'Alpha', 'cmty_a')],
      { 'wiki/a.md': { primaryCommunity: 'cmty_a' } },
    )))).toContain('son propre parent');
  });

  it('refuse un cycle de parenté', () => {
    // Sans cette borne, tout consommateur qui remonte l'arbre boucle — carte
    // comprise.
    const result = validateRegistry(registry(
      [community('cmty_a', 'Alpha', 'cmty_b'), community('cmty_b', 'Beta', 'cmty_a')],
      {},
    ));

    expect(reasons(result)).toContain('cycle de parenté');
  });

  it('borne la profondeur à ce que la navigation sait rendre', () => {
    const result = validateRegistry(registry(
      [
        community('dom', 'Domaine'),
        community('mid', 'Milieu', 'dom'),
        community('leaf', 'Feuille', 'mid'),
      ],
      { 'wiki/a.md': { primaryCommunity: 'leaf' } },
    ));

    expect(reasons(result)).toContain(`au-delà du maximum ${MAX_COMMUNITY_DEPTH}`);
  });

  /*
   L'unicité devient une règle de fratrie. Une arborescence ne montre jamais
   que les racines, puis les enfants d'un seul domaine : deux « Reporting »
   sous deux domaines distincts ne se rencontrent jamais à l'écran. Garder la
   règle globale repousserait le modèle vers des libellés composés — ce que la
   règle du mot unique cherche précisément à éviter.
  */
  it('autorise le même libellé sous deux domaines différents', () => {
    const result = validateRegistry(registry(
      [
        community('dom_a', 'Finance'),
        community('dom_b', 'Securite'),
        community('a_rep', 'Reporting', 'dom_a'),
        community('b_rep', 'Reporting', 'dom_b'),
      ],
      { 'wiki/a.md': { primaryCommunity: 'a_rep' }, 'wiki/b.md': { primaryCommunity: 'b_rep' } },
    ));

    expect(result.ok).toBe(true);
  });

  it('refuse deux libellés identiques dans la même fratrie', () => {
    const result = validateRegistry(registry(
      [
        community('dom', 'Finance'),
        community('a', 'Reporting', 'dom'),
        community('b', 'reporting', 'dom'),
      ],
      { 'wiki/a.md': { primaryCommunity: 'a' }, 'wiki/b.md': { primaryCommunity: 'b' } },
    ));

    expect(reasons(result)).toContain('dans la même fratrie');
  });

  it('refuse deux domaines racines homonymes', () => {
    // Les racines sont fratrie entre elles : la carte les affiche ensemble.
    const result = validateRegistry(registry(
      [community('dom_a', 'Logiciel'), community('dom_b', 'logiciel')],
      {},
    ));

    expect(reasons(result)).toContain('dans la même fratrie');
  });
});

describe('facettes secondaires', () => {
  /*
   Une page « sécurité Prophix » relève principalement de Prophix. La ranger
   dans Sécurité la ferait disparaître de son produit ; la dupliquer fausserait
   tous les comptes. La facette est donc « reliée à », jamais « appartient à ».
  */
  it('accepte une facette vers une autre communauté', () => {
    const data = hierarchical();
    data.assignments['wiki/cmty_anaplan-0.md'] = {
      primaryCommunity: 'cmty_anaplan',
      relatedCommunities: ['cmty_reporting'],
    };

    expect(validateRegistry(data).ok).toBe(true);
  });

  it('refuse une facette redondante avec l’appartenance principale', () => {
    const data = hierarchical();
    data.assignments['wiki/cmty_anaplan-0.md'] = {
      primaryCommunity: 'cmty_anaplan',
      relatedCommunities: ['cmty_anaplan'],
    };

    expect(reasons(validateRegistry(data))).toContain('facette redondante');
  });

  it('refuse une facette vers une communauté inconnue', () => {
    const data = hierarchical();
    data.assignments['wiki/cmty_anaplan-0.md'] = {
      primaryCommunity: 'cmty_anaplan',
      relatedCommunities: ['cmty_fantome'],
    };

    expect(reasons(validateRegistry(data))).toContain('inconnue ou dépréciée');
  });
});

describe('distribution', () => {
  it('valide une arborescence équilibrée', () => {
    const report = checkDistribution(hierarchical());

    expect(report.ok).toBe(true);
    expect(report.domains).toBe(2);
    expect(report.leaves).toBe(4);
  });

  /*
   Le contrôle qui manquait. La révision fautive était structurellement valide
   — identifiants cohérents, libellés conformes, couverture complète — et
   fonctionnellement inutilisable.
  */
  it('rejette le fourre-tout qui a détruit la navigation', () => {
    const assignments: TaxonomyRegistry['assignments'] = {};
    for (let index = 0; index < 142; index += 1) {
      assignments[`wiki/page-${index}.md`] = { primaryCommunity: 'cmty_logiciel' };
    }
    const report = checkDistribution(registry([community('cmty_logiciel', 'Logiciel')], assignments));

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('leaf_too_large');
    expect(report.largestLeaf).toBe(142);
  });

  it('mesure la démesure en part du corpus, pas en valeur absolue', () => {
    // Le même nombre de pages est acceptable dans un grand corpus et
    // inacceptable dans un petit : un seuil fixe se tromperait dans les deux
    // sens selon la taille du wiki.
    const build = (total: number, inLeaf: number) => {
      const assignments: TaxonomyRegistry['assignments'] = {};
      for (let index = 0; index < total; index += 1) {
        assignments[`wiki/p${index}.md`] = {
          primaryCommunity: index < inLeaf ? 'big' : `small_${index % 7}`,
        };
      }
      const ids = new Set(Object.values(assignments).map((item) => item.primaryCommunity));
      return registry([...ids].map((id) => community(id, `L${id}`)), assignments);
    };

    expect(checkDistribution(build(200, 100)).ok).toBe(false);
    expect(checkDistribution(build(200, Math.floor(200 * MAX_LEAF_SHARE) - 1)).issues
      .some((issue) => issue.code === 'leaf_too_large')).toBe(false);
  });

  it('signale un domaine qui ne sépare rien', () => {
    const report = checkDistribution(registry(
      [community('dom', 'Domaine'), community('leaf', 'Feuille', 'dom')],
      { 'wiki/a.md': { primaryCommunity: 'leaf' } },
    ));

    // Deux clics au lieu d'un, sans information gagnée.
    expect(report.issues.map((issue) => issue.code)).toContain('domain_too_thin');
  });

  it('signale une feuille vide', () => {
    const data = hierarchical();
    data.communities.push(community('cmty_vide', 'Vide', 'dom_finance'));

    expect(checkDistribution(data).issues.map((issue) => issue.code)).toContain('empty_leaf');
  });

  it('tolère une taxonomie plate sur un très petit corpus', () => {
    const report = checkDistribution(registry(
      [community('a', 'Alpha'), community('b', 'Beta')],
      { 'wiki/a.md': { primaryCommunity: 'a' }, 'wiki/b.md': { primaryCommunity: 'b' } },
    ));

    expect(report.ok).toBe(true);
  });
});
