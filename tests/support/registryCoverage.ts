import { KNOWLEDGE_ETAG_ALGORITHM } from '../../src/graph/wiki/taxonomy/knowledge.ts';
import type { TaxonomyRegistry } from '../../src/graph/wiki/taxonomy/schema.ts';

/**
 * Complète un registre de test avec sa preuve de couverture v3.
 *
 * Les fixtures qui portent sur la hiérarchie, l'identité ou le rendu n'ont rien
 * à dire du corpus : leur déclarer « toutes les pages affectées ont été
 * soumises » est exact et ne change aucune des propriétés qu'elles vérifient.
 * Les tests de couverture, eux, écrivent ces champs explicitement.
 */
export function withCoverage(
  registry: Omit<TaxonomyRegistry, 'corpusAlgorithm' | 'corpusPageIds' | 'sampledPageIds'>
    & Partial<Pick<TaxonomyRegistry, 'corpusAlgorithm' | 'corpusPageIds' | 'sampledPageIds'>>,
): TaxonomyRegistry {
  const pages = Object.keys(registry.assignments).sort();
  return {
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    corpusPageIds: pages,
    sampledPageIds: pages,
    ...registry,
  };
}
