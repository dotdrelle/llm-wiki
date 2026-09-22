import { describe, expect, it } from 'vitest';
import { retargetLeafCitationsToSourceNote } from '../src/provenance/retarget.ts';
import type { WikiOperation } from '../src/types.ts';

const note =
  '# Detailed\n\n## Coûts\n\n90 k€.\n\n[src: raw/ingested/detailed.md#Coûts]\n';

function leaf(content: string): WikiOperation {
  return { type: 'update', path: 'wiki/concepts/produit/jedox.md', content };
}

describe('retarget leaf citations to the source note (two-level shape)', () => {
  it('moves a section-precise archive citation to the source note, keeping the anchor', () => {
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [
        leaf(
          '# Jedox\n\n## Coûts\n\nSynthèse.\n\n[src: raw/ingested/detailed.md#Coûts]\n',
        ),
      ],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: note,
      },
    );

    expect(retargeted).toBe(1);
    expect(operations[0].content).toContain('[src: wiki/sources/detailed.md#Coûts]');
    expect(operations[0].content).not.toContain('raw/ingested/detailed.md#Coûts');
  });

  it('leaves the archive citation when the source note has no matching section', () => {
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [leaf('# Jedox\n\n[src: raw/ingested/detailed.md#Licences]\n')],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: note,
      },
    );

    expect(retargeted).toBe(0);
    expect(operations[0].content).toContain('[src: raw/ingested/detailed.md#Licences]');
  });

  it('never retargets a bare citation or a citation to another archive', () => {
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [
        leaf(
          '# Jedox\n\n[src: raw/ingested/detailed.md]\n[src: raw/ingested/other.md#Coûts]\n',
        ),
      ],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: note,
      },
    );

    expect(retargeted).toBe(0);
    expect(operations[0].content).toContain('[src: raw/ingested/detailed.md]');
    expect(operations[0].content).toContain('[src: raw/ingested/other.md#Coûts]');
  });

  it('leaves the source note itself untouched', () => {
    const sourceNote: WikiOperation = {
      type: 'create',
      path: 'wiki/sources/detailed.md',
      content:
        '# Detailed\n\n## Coûts\n\n90 k€.\n\n[src: raw/ingested/detailed.md#Coûts]\n',
    };
    const { operations, retargeted } = retargetLeafCitationsToSourceNote([sourceNote], {
      sourcePagePath: 'wiki/sources/detailed.md',
      archiveCitationPath: 'raw/ingested/detailed.md',
      sourceNoteContent: note,
    });

    expect(retargeted).toBe(0);
    expect(operations[0].content).toContain('[src: raw/ingested/detailed.md#Coûts]');
  });

  it('does nothing when the plan writes no source note', () => {
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [leaf('# Jedox\n\n[src: raw/ingested/detailed.md#Coûts]\n')],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: null,
      },
    );

    expect(retargeted).toBe(0);
    expect(operations[0].content).toContain('raw/ingested/detailed.md#Coûts');
  });

  it('refuses a same-named section that proves a different fragment', () => {
    const mismatched =
      '# Detailed\n\n## Coûts\n\n90 k€.\n\n[src: raw/ingested/detailed.md#Écarts]\n';
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [leaf('# Jedox\n\n[src: raw/ingested/detailed.md#Coûts]\n')],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: mismatched,
      },
    );

    expect(retargeted).toBe(0);
    expect(operations[0].content).toContain('[src: raw/ingested/detailed.md#Coûts]');
  });

  it('retargets when the source-note section cites the whole archive file', () => {
    const whole = '# Detailed\n\n## Coûts\n\n90 k€.\n\n[src: raw/ingested/detailed.md]\n';
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [leaf('# Jedox\n\n[src: raw/ingested/detailed.md#Coûts]\n')],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: whole,
      },
    );

    expect(retargeted).toBe(1);
    expect(operations[0].content).toContain('[src: wiki/sources/detailed.md#Coûts]');
  });

  it('preserves a legacy citation the previous page already carried', () => {
    const previous = '# Jedox\n\nAncien fait. [src: raw/ingested/detailed.md#Coûts]\n';
    const { operations, retargeted } = retargetLeafCitationsToSourceNote(
      [leaf('# Jedox\n\nAncien fait. [src: raw/ingested/detailed.md#Coûts]\n')],
      {
        sourcePagePath: 'wiki/sources/detailed.md',
        archiveCitationPath: 'raw/ingested/detailed.md',
        sourceNoteContent: note,
        previousContentOf: () => previous,
      },
    );

    expect(retargeted).toBe(0);
    expect(operations[0].content).toContain('[src: raw/ingested/detailed.md#Coûts]');
  });
});
