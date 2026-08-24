import { describe, expect, it } from 'vitest';
import type { ConceptGrid } from '../src/ingest/conceptGrid.ts';
import {
  buildDerivedRegistry,
  domainBoundsForClasses,
  UNCLASSIFIED_ID,
  validateDomainProposal,
  type ClassedPage,
  type DomainProposal,
} from '../src/graph/wiki/taxonomy/derived.ts';

const grid = (ids: string[]): ConceptGrid => ({
  classes: ids,
  set: new Set(ids),
  info: new Map(ids.map((id) => [id, { id, label: id.toUpperCase(), criterion: null }])),
});

const GRID = grid(['classe-a', 'classe-b', 'classe-c', 'classe-d']);

const PROPOSAL: DomainProposal = {
  domains: [{ id: 'd1', label: 'Communauté alpha' }, { id: 'd2', label: 'Groupe beta' }],
  classDomains: { 'classe-a': 'd1', 'classe-b': 'd1', 'classe-c': 'd2', 'classe-d': 'd2' },
};

const page = (path: string, cls: string | null, subject: string | null): ClassedPage =>
  ({ path, class: cls, subject });

describe('validateDomainProposal', () => {
  it('accepts a grouping that covers every class', () => {
    expect(validateDomainProposal(PROPOSAL, GRID)).toEqual([]);
  });

  it('rejects a class left out of the grouping', () => {
    const partial: DomainProposal = {
      ...PROPOSAL,
      classDomains: { 'classe-a': 'd1', 'classe-b': 'd1', 'classe-c': 'd2' },
    };
    expect(validateDomainProposal(partial, GRID)).toContain('class not gathered: "classe-d"');
  });

  it('rejects a community that gathers a single class', () => {
    const lonely: DomainProposal = {
      domains: [...PROPOSAL.domains, { id: 'd3', label: 'Isolé' }],
      classDomains: { ...PROPOSAL.classDomains, 'classe-d': 'd3' },
    };
    expect(validateDomainProposal(lonely, GRID).join(' ')).toContain('gathers a single class');
  });

  /*
   The rule the study insists on and a model cannot self-check: two labels
   sharing a word are almost always one community split for symmetry.
  */
  it('rejects two community labels that share a term', () => {
    const overlapping: DomainProposal = {
      ...PROPOSAL,
      domains: [{ id: 'd1', label: 'Pilotage projet' }, { id: 'd2', label: 'Pilotage technique' }],
    };
    expect(validateDomainProposal(overlapping, GRID).join(' ')).toContain('share the term');
  });

  it('rejects a catch-all label', () => {
    const catchAll: DomainProposal = {
      ...PROPOSAL,
      domains: [{ id: 'd1', label: 'Divers' }, { id: 'd2', label: 'Groupe beta' }],
    };
    expect(validateDomainProposal(catchAll, GRID).length).toBeGreaterThan(0);
  });

  it('allows a single community below four classes', () => {
    const small = grid(['classe-a', 'classe-b']);
    const one: DomainProposal = {
      domains: [{ id: 'd1', label: 'Communauté alpha' }],
      classDomains: { 'classe-a': 'd1', 'classe-b': 'd1' },
    };
    expect(domainBoundsForClasses(2).min).toBe(1);
    expect(validateDomainProposal(one, small)).toEqual([]);
  });
});

describe('buildDerivedRegistry', () => {
  const build = (pages: ClassedPage[]) => buildDerivedRegistry({
    grid: GRID,
    pages,
    proposal: PROPOSAL,
    language: 'fr',
    corpus: 'etag',
    revision: 3,
  });

  it('files every page under the class written in its own frontmatter', () => {
    const { registry } = build([
      page('wiki/concepts/classe-a/x.md', 'classe-a', 'x'),
      page('wiki/concepts/classe-c/y.md', 'classe-c', 'y'),
    ]);
    expect(registry.assignments['wiki/concepts/classe-a/x.md']!.primaryCommunity)
      .toBe('community-classe-a');
    expect(registry.assignments['wiki/concepts/classe-c/y.md']!.primaryCommunity)
      .toBe('community-classe-c');
  });

  /*
   The transverse edge, computed instead of inferred: one subject projected
   onto two classes makes each leaf name the other's community.
  */
  it('links the sibling leaves of one subject across classes', () => {
    const { registry } = build([
      page('wiki/concepts/classe-a/x.md', 'classe-a', 'x'),
      page('wiki/concepts/classe-b/x.md', 'classe-b', 'x'),
      page('wiki/concepts/classe-c/y.md', 'classe-c', 'y'),
    ]);
    expect(registry.assignments['wiki/concepts/classe-a/x.md']!.relatedCommunities)
      .toEqual(['community-classe-b']);
    expect(registry.assignments['wiki/concepts/classe-b/x.md']!.relatedCommunities)
      .toEqual(['community-classe-a']);
    expect(registry.assignments['wiki/concepts/classe-c/y.md']!.relatedCommunities)
      .toBeUndefined();
  });

  it('does not publish a community for a class the corpus does not populate', () => {
    const { registry } = build([page('wiki/concepts/classe-a/x.md', 'classe-a', 'x')]);
    const ids = registry.communities.map((community) => community.id);
    expect(ids).toContain('community-classe-a');
    expect(ids).not.toContain('community-classe-b');
    // d2 gathers only unpopulated classes: it must not appear either.
    expect(ids).not.toContain('domain-d2');
  });

  /*
   A classless page is counted and shown, never dissolved into a neighbouring
   community — the same discipline `coverage.ts` applies to `Ungrouped`.
  */
  it('gathers classless pages under an explicit community and says how many', () => {
    const { registry, warnings } = build([
      page('wiki/concepts/classe-a/x.md', 'classe-a', 'x'),
      page('wiki/concepts/legacy.md', null, 'legacy'),
      page('wiki/concepts/other.md', 'classe-inconnue', 'other'),
    ]);
    expect(registry.assignments['wiki/concepts/legacy.md']!.primaryCommunity)
      .toBe(`community-${UNCLASSIFIED_ID}`);
    expect(registry.assignments['wiki/concepts/other.md']!.primaryCommunity)
      .toBe(`community-${UNCLASSIFIED_ID}`);
    expect(warnings.join(' ')).toContain('2 page(s) carry no class');
  });

  it('covers every page of the corpus exactly once', () => {
    const pages = [
      page('wiki/concepts/classe-a/x.md', 'classe-a', 'x'),
      page('wiki/concepts/classe-b/x.md', 'classe-b', 'x'),
      page('wiki/index.md', null, null),
    ];
    const { registry } = build(pages);
    expect(Object.keys(registry.assignments).sort()).toEqual(pages.map((p) => p.path).sort());
    expect(registry.corpusPageIds).toHaveLength(3);
  });
});
