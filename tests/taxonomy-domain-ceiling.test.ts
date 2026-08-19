import { describe, expect, it } from 'vitest';
import { checkProposal, type TaxonomyProposal } from '../src/graph/wiki/taxonomy/synthesize.ts';
import type { TaxonomyInventory } from '../src/graph/wiki/taxonomy/inventory.ts';

/*
 Plafond de domaines (§ maxDomains, synthesize.ts).

 Une taxonomie mesurée sur un corpus comparatif (ACPI : une trentaine de
 communautés réparties sur seulement 3 domaines) a montré le plancher à 3 et
 le coefficient à 1.5 trop serrés : le modèle était forcé sous ce plafond
 quel que soit le nombre de sujets réellement distincts, produisant des
 domaines si larges qu'ils ne séparaient plus rien. Ce test verrouille les
 nouvelles valeurs (plancher 5, coefficient 2) : les ramollir en douce doit
 casser ce test.
*/

function inventoryWithFamilies(count: number): TaxonomyInventory {
  const families = Array.from({ length: count }, (_, index) => ({
    id: `f${index}`,
    members: [`wiki/concepts/page-${index}.md`],
    titles: [`Page ${index}`],
    signals: [],
    collections: [],
    distinctiveTerms: [],
    neighbours: [],
    excerpt: '',
  }));
  return {
    language: 'fr',
    pageCount: count,
    truncated: false,
    families,
    communities: [],
    communitiesFromRegistry: false,
  } as unknown as TaxonomyInventory;
}

/**
 * A structurally valid proposal with `domainCount` domains, one community
 * each, and every one of `familyCount` families assigned round-robin — every
 * inventory family must appear in `assignments` and every community needs at
 * least one, both checked independently of the domain-count ceiling this
 * suite targets.
 */
function proposalWithDomains(domainCount: number, familyCount: number): TaxonomyProposal {
  const domains = Array.from({ length: domainCount }, (_, index) => ({ id: `d${index}`, label: `Domaine${index}` }));
  const communities = domains.map((domain, index) => ({ id: `${domain.id}c`, label: `Communaute${index}`, domain: domain.id }));
  const assignments: Record<string, string> = {};
  for (let index = 0; index < familyCount; index += 1) {
    assignments[`f${index}`] = `${domains[index % domains.length]!.id}c`;
  }
  return { domains, communities, assignments };
}

describe('plafond de fragmentation des domaines', () => {
  it('accepte le plancher (5 domaines) même avec très peu de familles', () => {
    const inventory = inventoryWithFamilies(5);
    const result = checkProposal(proposalWithDomains(5, 5), inventory);
    expect(result.ok).toBe(true);
  });

  it('rejette au-delà du plancher quand les familles ne le justifient pas', () => {
    const inventory = inventoryWithFamilies(6);
    const result = checkProposal(proposalWithDomains(6, 6), inventory);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.reason.includes('too fragmented'))).toBe(true);
      expect(result.issues.some((issue) => issue.reason.includes('maximum 5'))).toBe(true);
    }
  });

  it('scale avec le coefficient 2, pas 1.5', () => {
    // sqrt(100) * 2 = 20 : le plafond doit suivre le NOUVEAU coefficient.
    const inventory = inventoryWithFamilies(100);
    expect(checkProposal(proposalWithDomains(20, 100), inventory).ok).toBe(true);
    expect(checkProposal(proposalWithDomains(21, 100), inventory).ok).toBe(false);
  });
});
