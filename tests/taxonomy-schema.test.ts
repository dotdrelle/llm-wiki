import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_ETAG_ALGORITHM } from '../src/graph/wiki/taxonomy/knowledge.ts';
import {
  communityLabel,
  isValidLabel,
  normalizeLabel,
  REGISTRY_SCHEMA_VERSION,
  resolveCommunity,
  validateRegistry,
  type TaxonomyRegistry,
} from '../src/graph/wiki/taxonomy/schema.ts';

function registry(overrides: Partial<TaxonomyRegistry> = {}): TaxonomyRegistry {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 4,
    corpus: 'sha1:abc',
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    languages: ['fr'],
    communities: [
      { id: 'cmty_1', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1 },
      { id: 'cmty_2', prefLabel: { fr: 'Intégration' }, firstSeenRevision: 2 },
    ],
    assignments: { 'wiki/a.md': { primaryCommunity: 'cmty_1' } },
    corpusPageIds: ['wiki/a.md'],
    sampledPageIds: ['wiki/a.md'],
    ...overrides,
  };
}

const reasons = (result: ReturnType<typeof validateRegistry>) =>
  result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.reason}`);

describe('libellé visible', () => {
  it('exige un mot unique sans chemin', () => {
    expect(isValidLabel('Solution')).toBe(true);
    // Les deux façons dont un modèle recrache une hiérarchie de dossiers.
    expect(isValidLabel('solutions/anaplan')).toBe(false);
    expect(isValidLabel('solutions_saas')).toBe(false);
    expect(isValidLabel('Solutions SaaS')).toBe(false);
    expect(isValidLabel(' Solution')).toBe(false);
    expect(isValidLabel('')).toBe(false);
  });

  it('compare comme un lecteur, pas comme un octet', () => {
    // Trois graphies que l'œil lit comme le même mot sur deux bulles voisines.
    expect(normalizeLabel('Solution')).toBe(normalizeLabel('solution'));
    expect(normalizeLabel('Intégration')).toBe(normalizeLabel('integration'));
  });
});

describe('validation du registre', () => {
  it('accepte un registre conforme', () => {
    const result = validateRegistry(registry());
    expect(result.ok).toBe(true);
  });

  it('ignore un registre d’une autre version plutôt que de l’interpréter', () => {
    const result = validateRegistry(registry({ schemaVersion: 99 }));
    expect(reasons(result)).toEqual([`schemaVersion: attendu ${REGISTRY_SCHEMA_VERSION}, reçu 99`]);
  });

  /*
   D7 : deux bulles nommées pareil sont un défaut de la carte, quoi que disent
   leurs notes. La règle porte sur le libellé NORMALISÉ, sinon « Solution » et
   « solution » passeraient.
  */
  it('refuse deux libellés visibles identiques dans la même langue', () => {
    const result = validateRegistry(
      registry({
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1 },
          { id: 'cmty_2', prefLabel: { fr: 'solution' }, firstSeenRevision: 2 },
        ],
      }),
    );
    expect(reasons(result).join()).toContain('libellé visible en double avec cmty_1');
  });

  it('tolère le même libellé dans deux langues différentes', () => {
    const result = validateRegistry(
      registry({
        languages: ['fr', 'en'],
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'Solution', en: 'Solution' }, firstSeenRevision: 1 },
          { id: 'cmty_2', prefLabel: { fr: 'Réseau', en: 'Network' }, firstSeenRevision: 2 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('laisse un concept déprécié garder le libellé d’un actif', () => {
    // Il n'est plus affiché : il ne peut plus créer de doublon visuel, et son
    // libellé reste utile pour lire l'historique.
    const result = validateRegistry(
      registry({
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1 },
          {
            id: 'cmty_2',
            prefLabel: { fr: 'Solution' },
            firstSeenRevision: 1,
            deprecated: true,
            replacedBy: 'cmty_1',
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  /*
   La règle inverse était en place, et c'est elle qui a produit le défaut.

   On refusait un concept déprécié sans successeur, au motif qu'il formait un
   cul-de-sac. Mais quand plus aucune communauté ne reprenait ses pages, il
   fallait bien en désigner un : le code se repliait sur le premier survivant de
   la liste, sans aucun rapport. Un lecteur revenant avec un identifiant ancien
   atterrissait donc en silence ailleurs — et la note de changement écrite juste
   à côté disait « removed ».

   Le cul-de-sac redouté n'existe pas : `resolveCommunity` s'arrête sur un
   `replacedBy` nul et rend le concept déprécié lui-même, que le client sait
   présenter comme disparu. Entre une redirection fausse et pas de redirection,
   la seconde est la seule honnête — et la seule visible.
  */
  it('accepte un concept déprécié sans remplaçant', () => {
    const result = validateRegistry(
      registry({
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1, deprecated: true },
          { id: 'cmty_2', prefLabel: { fr: 'Intégration' }, firstSeenRevision: 2 },
        ],
        assignments: { 'wiki/a.md': { primaryCommunity: 'cmty_2' } },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('refuse une redirection ou une absorption vers l’inconnu', () => {
    const result = validateRegistry(
      registry({
        communities: [
          {
            id: 'cmty_1',
            prefLabel: { fr: 'Solution' },
            firstSeenRevision: 1,
            replaces: ['cmty_disparu'],
          },
        ],
      }),
    );
    expect(reasons(result).join()).toContain('concept absorbé inconnu');
  });

  it('refuse une page affectée à une communauté dépréciée', () => {
    // L'affecter là la ferait disparaître de la carte sans rien signaler.
    const result = validateRegistry(
      registry({
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1 },
          {
            id: 'cmty_2',
            prefLabel: { fr: 'Ancien' },
            firstSeenRevision: 1,
            deprecated: true,
            replacedBy: 'cmty_1',
          },
        ],
        assignments: { 'wiki/a.md': { primaryCommunity: 'cmty_2' } },
      }),
    );
    expect(reasons(result).join()).toContain('inconnue ou dépréciée');
  });

  it('refuse un identifiant en double', () => {
    const result = validateRegistry(
      registry({
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1 },
          { id: 'cmty_1', prefLabel: { fr: 'Intégration' }, firstSeenRevision: 2 },
        ],
      }),
    );
    expect(reasons(result).join()).toContain('identifiant en double');
  });

  /*
   Le rejet est EN BLOC. Un registre à moitié appliqué produirait une carte que
   personne n'a décidée et dont on ne saurait plus dire de quoi elle dérive.
  */
  it('rapporte tous les défauts d’un coup, sans rien appliquer', () => {
    const result = validateRegistry(
      registry({
        communities: [
          { id: 'cmty_1', prefLabel: { fr: 'deux mots' }, firstSeenRevision: 1 },
          { id: 'cmty_2', prefLabel: { fr: 'a/b' }, firstSeenRevision: 2 },
        ],
        assignments: { 'wiki/a.md': { primaryCommunity: 'cmty_inconnu' } },
      }),
    );
    expect(result.ok).toBe(false);
    expect(reasons(result)).toHaveLength(3);
  });
});

describe('lecture du registre', () => {
  it('dérive le libellé affiché sans jamais rendre du vide', () => {
    const community = { id: 'cmty_1', prefLabel: { en: 'Solution' }, firstSeenRevision: 1 };

    expect(communityLabel(community, 'en')).toBe('Solution');
    // Langue absente : on retombe, on ne masque pas la bulle.
    expect(communityLabel(community, 'fr')).toBe('Solution');
    expect(communityLabel({ id: 'cmty_x', prefLabel: {}, firstSeenRevision: 1 }, 'fr')).toBe('cmty_x');
  });

  /*
   C'est ce qui rend la fusion et le remap de sélection résolubles
   indéfiniment : un client qui revient avec un identifiant absorbé obtient
   toujours sa cible.
  */
  it('suit une chaîne d’absorptions jusqu’au concept actif', () => {
    const data = registry({
      communities: [
        { id: 'cmty_3', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1 },
        { id: 'cmty_2', prefLabel: { fr: 'Ancien' }, firstSeenRevision: 1, deprecated: true, replacedBy: 'cmty_3' },
        { id: 'cmty_1', prefLabel: { fr: 'Antique' }, firstSeenRevision: 1, deprecated: true, replacedBy: 'cmty_2' },
      ],
      assignments: { 'wiki/a.md': { primaryCommunity: 'cmty_3' } },
    });

    expect(resolveCommunity(data, 'cmty_1')?.id).toBe('cmty_3');
    expect(resolveCommunity(data, 'cmty_inconnu')).toBeNull();
  });

  it('ne boucle pas sur une chaîne circulaire', () => {
    const data = registry({
      communities: [
        { id: 'cmty_1', prefLabel: { fr: 'A' }, firstSeenRevision: 1, deprecated: true, replacedBy: 'cmty_2' },
        { id: 'cmty_2', prefLabel: { fr: 'B' }, firstSeenRevision: 1, deprecated: true, replacedBy: 'cmty_1' },
      ],
      assignments: {},
    });

    expect(() => resolveCommunity(data, 'cmty_1')).not.toThrow();
  });
});
