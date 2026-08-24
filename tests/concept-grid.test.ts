import { describe, expect, it } from 'vitest';
import {
  conceptPagePath,
  conceptPathMismatch,
  MAX_GRID_CLASSES,
  parseConceptGrid,
  parseConceptPagePath,
  UNCLASSIFIED_CLASS,
  type ConceptGrid,
} from '../src/ingest/conceptGrid.ts';
import { validateConsolidation } from '../src/ingest/consolidationValidate.ts';
import { consolidationPlanSchema } from '../src/ingest/consolidationSchema.ts';
import { readProvenance } from '../src/ingest/provenance.ts';

const gridMarkdown = (classes: string[]): string => [
  '# Grille',
  '',
  '```yaml',
  'class:',
  ...classes.map((value) => `  - ${value}`),
  'statut: reference | analyse',
  '```',
].join('\n');

describe('parseConceptGrid', () => {
  it('reads the class vocabulary of a grid file', () => {
    const read = parseConceptGrid(gridMarkdown(['offre-marche', 'ecosysteme-libre']));
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.grid.classes).toEqual(['offre-marche', 'ecosysteme-libre']);
  });

  it('reports a file with no vocabulary block as absent, not as an empty grid', () => {
    expect(parseConceptGrid('# Grille\n\nrien ici.').status).toBe('absent');
  });

  /*
   The three rejections below share one purpose: a grid we only half-understood
   must never become a SMALLER closed set. Every class silently dropped would
   reject legitimate pages later, at ingest time, for a defect that lives in
   the grid file.
  */
  it('rejects a non-canonical class rather than normalizing it silently', () => {
    const read = parseConceptGrid(gridMarkdown(['Offre Marché', 'ecosysteme-libre']));
    expect(read.status).toBe('malformed');
    if (read.status !== 'malformed') return;
    expect(read.issues[0]).toContain('offre-marche');
  });

  it('rejects a duplicated class', () => {
    const read = parseConceptGrid(gridMarkdown(['offre-marche', 'offre-marche']));
    expect(read.status).toBe('malformed');
  });

  it('rejects a grid below the minimum and above the maximum', () => {
    expect(parseConceptGrid(gridMarkdown(['offre-marche'])).status).toBe('malformed');
    const tooMany = Array.from({ length: MAX_GRID_CLASSES + 1 }, (_, index) => `classe-${index}`);
    expect(parseConceptGrid(gridMarkdown(tooMany)).status).toBe('malformed');
  });

  it('stops the class list at the next key of the block', () => {
    const read = parseConceptGrid([
      '```yaml',
      'class:',
      '  - offre-marche',
      '  - ecosysteme-libre',
      'statut:',
      '  - reference',
      '```',
    ].join('\n'));
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.grid.classes).toEqual(['offre-marche', 'ecosysteme-libre']);
  });
});

describe('leaf path convention', () => {
  it('round-trips a path through its two axes', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    expect(at).toBe('wiki/concepts/offre-marche/alpha.md');
    expect(parseConceptPagePath(at)).toEqual({ class: 'offre-marche', subject: 'alpha' });
  });

  it('does not read a flat concept page as a leaf', () => {
    expect(parseConceptPagePath('wiki/concepts/alpha-platform.md')).toBeNull();
  });

  it('names the expected path when the axes and the path disagree', () => {
    const mismatch = conceptPathMismatch('wiki/concepts/offre-marche/alpha.md', {
      class: 'souverainete-hebergement',
      subject: 'alpha',
    });
    expect(mismatch).toContain('wiki/concepts/souverainete-hebergement/alpha.md');
  });
});

const GRID: ConceptGrid = {
  classes: ['offre-marche', 'souverainete-hebergement'],
  set: new Set(['offre-marche', 'souverainete-hebergement']),
};

const CITATION = 'raw/ingested/etude-alpha.md';

function planWith(page: Record<string, unknown>, at: string) {
  return consolidationPlanSchema.parse({
    summary: 'test',
    operations: [
      { type: 'update', path: 'wiki/sources/etude-alpha.md', content: `note [src: ${CITATION}]` },
      { type: 'create', path: at, content: `feuille [src: ${CITATION}]` },
    ],
    pages: [{ path: at, ...page }],
  });
}

function validate(plan: ReturnType<typeof planWith>, grid?: ConceptGrid) {
  return validateConsolidation(plan, {
    sourcePagePath: 'wiki/sources/etude-alpha.md',
    citationPath: CITATION,
    existingPaths: new Set<string>(),
    collection: 'solutions-externes',
    grid,
  });
}

describe('leaf axes at consolidation', () => {
  it('accepts a leaf whose declared axes match its path and the grid', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(planWith({ subject: 'alpha', class: 'offre-marche' }, at), GRID);
    expect(result.errors).toEqual([]);
    expect(readProvenance(result.operations[1]!.content ?? '').class).toBe('offre-marche');
  });

  /*
   The failure a real run produced five times out of thirteen: the model names
   the identity correctly IN THE PATH, then declares `subject` as the source
   document's file name. The path is the considered choice, the declaration is
   the reflex — so the path wins, and the disagreement is reported rather than
   costing a whole source.
  */
  it('keeps the path axes when the declaration contradicts them, and says so', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(
      planWith({ subject: 'etude-progiciels-externes-solution-alpha', class: 'offre-marche' }, at),
      GRID,
    );
    expect(result.errors).toEqual([]);
    expect(readProvenance(result.operations[1]!.content ?? '').subject).toBe('alpha');
    expect(result.warnings.map((issue) => issue.reason).join(' ')).toContain('contradicts the path');
  });

  it('derives both axes from the path when the plan declares neither', () => {
    const at = conceptPagePath('souverainete-hebergement', 'alpha');
    const result = validate(planWith({}, at), GRID);
    expect(result.errors).toEqual([]);
    const provenance = readProvenance(result.operations[1]!.content ?? '');
    expect(provenance.class).toBe('souverainete-hebergement');
    expect(provenance.subject).toBe('alpha');
  });


  it('accepts a leaf under the reserved unclassified class even though it is not in the grid', () => {
    // `unclassified` is the engine's fallback, not a grid class: a leaf that
    // matches no class lands there and must never be rejected for want of a class.
    const at = conceptPagePath(UNCLASSIFIED_CLASS, 'alpha');
    const result = validate(planWith({ subject: 'alpha', class: UNCLASSIFIED_CLASS }, at), GRID);
    expect(result.errors).toEqual([]);
    expect(readProvenance(result.operations[1]!.content ?? '').class).toBe(UNCLASSIFIED_CLASS);
  });

  it('rejects a class the grid does not declare, and names the valid ones', () => {
    const at = conceptPagePath('securite', 'alpha');
    const result = validate(planWith({ subject: 'alpha', class: 'securite' }, at), GRID);
    const reasons = result.errors.map((issue) => issue.reason).join(' ');
    expect(reasons).toContain('unknown class');
    expect(reasons).toContain('souverainete-hebergement');
  });

  it('rejects an unknown secondary class', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(
      planWith({ subject: 'alpha', class: 'offre-marche', classSecondary: ['economie'] }, at),
      GRID,
    );
    expect(result.errors.map((issue) => issue.reason).join(' ')).toContain('unknown secondary class');
  });

  /*
   Deriving only applies to a well-formed leaf path. A flat concept page has no
   axes to read, so it is still refused — that is where the original defect lived.
  */
  it('still rejects a flat concept page, which carries no axes to derive', () => {
    const result = validate(planWith({ subject: 'alpha' }, 'wiki/concepts/alpha-platform.md'), GRID);
    expect(result.errors.map((issue) => issue.reason)).toContain(
      'concept page without a ranking class',
    );
  });

  it('keeps a secondary class in the frontmatter and never repeats the primary one', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(
      planWith(
        { subject: 'alpha', class: 'offre-marche', classSecondary: ['souverainete-hebergement'] },
        at,
      ),
      GRID,
    );
    expect(result.errors).toEqual([]);
    expect(readProvenance(result.operations[1]!.content ?? '').classSecondary)
      .toEqual(['souverainete-hebergement']);
  });

  it('accepts a French key synonym for the class', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(planWith({ subject: 'alpha', classe: 'offre-marche' }, at), GRID);
    expect(result.errors).toEqual([]);
  });

  /*
   Without a grid the same problems must remain visible and remain harmless:
   the grid pass has to be able to run on a corpus that was ingested before it
   existed.
  */
  it('only warns while the workspace has no grid', () => {
    const at = 'wiki/concepts/alpha-platform.md';
    const result = validate(planWith({ subject: 'security-compliance' }, at));
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.reason)).toContain(
      'concept page without a ranking class',
    );
  });
});

/*
 Reconciliation must not become a way to lose a signal. A secondary class equal
 to the primary is a self-contradiction in the plan and stays an error; it is
 only dropped when THIS reconciliation created the collision by moving the
 primary onto the path's class.
*/
describe('reconciliation keeps what it must reject', () => {
  it('still rejects a secondary class the model declared equal to its primary', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(
      planWith(
        { subject: 'alpha', class: 'offre-marche', classSecondary: ['offre-marche'] },
        at,
      ),
      GRID,
    );
    expect(result.errors.map((issue) => issue.reason).join(' '))
      .toContain('both as primary and secondary');
  });

  it('drops a collision that the path correction itself created', () => {
    const at = conceptPagePath('offre-marche', 'alpha');
    const result = validate(
      planWith(
        { subject: 'alpha', class: 'souverainete-hebergement', classSecondary: ['offre-marche'] },
        at,
      ),
      GRID,
    );
    expect(result.errors).toEqual([]);
    expect(readProvenance(result.operations[1]!.content ?? '').classSecondary).toEqual([]);
  });
});
