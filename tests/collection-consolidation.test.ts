import { describe, expect, it } from 'vitest';
import {
  consolidateCollection,
  type CollectionConcept,
} from '../src/ingest/consolidationCollection.ts';

/*
 Collection consolidation (plan Lot 3, §6.4 and §8.1).

 The base consolidates source by source; this pass detects and resolves, for a
 multi-source collection, the subjects several sources produced as cross-source
 duplicates. The assertions lock §8.1's bound (multi-source collections only),
 the stable survivor rule, the filiated redirection of every absorbed concept,
 and the before/after report.
*/

const concept = (path: string, subject: string, source: string): CollectionConcept => ({
  path,
  subject,
  source,
});

describe('collection consolidation', () => {
  it('merges a cross-source subject into a surviving concept', () => {
    const concepts = [
      concept('wiki/concepts/anaplan.md', 'Anaplan', 'src/anaplan.md'),
      concept('wiki/concepts/planning-fp.md', 'anaplan', 'src/board.md'),
    ];
    const { fusions, lineage } = consolidateCollection(concepts, { revision: 4 });

    expect(fusions).toHaveLength(1);
    const fusion = fusions[0]!;
    expect(fusion.subject).toBe('anaplan');
    // Two candidates, both first seen at the same revision: the smallest path
    // lexicographically survives (stable rule of 6.3).
    expect(fusion.survivor).toBe('wiki/concepts/anaplan.md');
    expect(fusion.absorbed).toEqual(['wiki/concepts/planning-fp.md']);

    // The absorbed concept is filiated, never lost: it shows up in merged.
    expect(lineage.merged).toContainEqual({
      id: 'wiki/concepts/planning-fp.md',
      into: 'wiki/concepts/anaplan.md',
    });
    expect(lineage.trulyLost).toEqual([]);
  });
});

describe('multi-source bound (§8.1)', () => {
  it('does not merge two concepts from the SAME source', () => {
    const concepts = [
      concept('wiki/concepts/anaplan.md', 'Anaplan', 'src/anaplan.md'),
      concept('wiki/concepts/gdoc.md', 'anaplan', 'src/anaplan.md'),
    ];
    const { fusions } = consolidateCollection(concepts, { revision: 4 });
    // Two concepts of a single source are already reconciled by the per-source
    // consolidation; they are not a cross-source duplicate.
    expect(fusions).toEqual([]);
  });

  it('merges nothing for a single-source collection (§8.1)', () => {
    const concepts = [
      concept('wiki/concepts/anaplan.md', 'anaplan', 'src/anaplan.md'),
      concept('wiki/concepts/securite.md', 'securite', 'src/anaplan.md'),
    ];
    const { fusions } = consolidateCollection(concepts, { revision: 4, minSources: 2 });
    expect(fusions).toEqual([]);
  });
});

describe('duplicate detection', () => {
  it('reports no duplicate when every subject is carried by a single source', () => {
    const concepts = [
      concept('wiki/concepts/anaplan.md', 'anaplan', 'src/anaplan.md'),
      concept('wiki/concepts/board.md', 'board', 'src/board.md'),
      concept('wiki/concepts/prophix.md', 'prophix', 'src/prophix.md'),
    ];
    const { fusions, lineage } = consolidateCollection(concepts, { revision: 4 });
    expect(fusions).toEqual([]);
    // No identity moved: no merge, no stub, no loss.
    expect(lineage.merged).toEqual([]);
    expect(lineage.deprecated).toEqual([]);
    expect(lineage.trulyLost).toEqual([]);
  });

  it('normalizes the subject before comparing duplicates', () => {
    const concepts = [
      concept('wiki/concepts/anaplan.md', 'Anaplan ', 'src/anaplan.md'),
      concept('wiki/concepts/planning-fp.md', 'Anaplan.', 'src/board.md'),
    ];
    const { fusions } = consolidateCollection(concepts, { revision: 4 });
    expect(fusions).toHaveLength(1);
    expect(fusions[0]!.subject).toBe('anaplan');
  });

  it('absorbs several sources into a single survivor', () => {
    const concepts = [
      concept('wiki/concepts/securite.md', 'securite', 'src/a.md'),
      concept('wiki/concepts/sso.md', 'securite', 'src/b.md'),
      concept('wiki/concepts/iam.md', 'securite', 'src/c.md'),
    ];
    const { fusions, lineage } = consolidateCollection(concepts, { revision: 4 });
    const fusion = fusions.find((f) => f.subject === 'securite')!;
    expect(fusion.survivor).toBe('wiki/concepts/iam.md');
    expect(fusion.absorbed.sort()).toEqual([
      'wiki/concepts/securite.md',
      'wiki/concepts/sso.md',
    ]);
    // Two of the three concepts are absorbed into the merge; the survivor stays.
    expect(lineage.merged).toHaveLength(2);
    expect(lineage.trulyLost).toEqual([]);
  });
});
