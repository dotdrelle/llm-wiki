import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditWorkspace } from '../src/provenance/audit.ts';

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/provenance-audit');

describe('provenance audit (lot 0)', () => {
  it('measures phantom sources, unanchored citations and mono-source leaves', async () => {
    const report = await auditWorkspace({ rootDir: FIXTURE, workspace: 'fixture' });

    expect(report.summary.sourcePageCount).toBe(5);
    expect(report.summary.leafCount).toBe(4);
    expect(report.summary.sourcePagesWithNoCitation).toBe(1);
    expect(report.summary.anchoredCitations).toBe(4);
    // 2 on source pages + 2 on `anaplan` + 2 on the cycle leaves.
    expect(report.summary.unanchoredCitations).toBe(6);
    expect(report.summary.anchorAmbiguous).toBe(1);
    expect(report.summary.anchorUnresolved).toBe(0);
    expect(report.summary.leavesWithUnrepresentedSources).toBe(1);
    expect(report.summary.phantomSourceEntries).toBe(1);
    expect(report.summary.leavesRepeatingOneCitationEverywhere).toBe(1);
    expect(report.summary.monoSourceLeaves).toBe(3);
    expect(report.summary.multiSourceLeaves).toBe(1);
    expect(report.summary.wholeFileReadsImplied).toBe(6);
    // Several source-page shapes coexist: the format is not harmonized.
    expect(report.summary.sourcePageDistinctFormats).toBeGreaterThan(1);
  });

  it('flags the acpi shape: a declared source the body never reaches', async () => {
    const report = await auditWorkspace({ rootDir: FIXTURE });
    const anaplan = report.leaves.find((leaf) => leaf.path.endsWith('/anaplan.md'));
    expect(anaplan).toBeTruthy();
    expect(anaplan?.concept).toBe('demo');
    expect(anaplan?.monoSource).toBe(true);
    expect(anaplan?.repeatsOneCitationEverywhere).toBe(true);
    expect(anaplan?.unrepresentedSources).toEqual(['raw/ingested/other.md']);
  });

  it('distinguishes a resolved anchor from an ambiguous one', async () => {
    const report = await auditWorkspace({ rootDir: FIXTURE });
    const detailedNote = report.sourcePages.find((page) => page.path.endsWith('/detailed-note.md'));
    expect(detailedNote?.anchorResolved).toBe(1);
    const repeatedNote = report.sourcePages.find((page) => page.path.endsWith('/repeated-note.md'));
    expect(repeatedNote?.anchorAmbiguous).toBe(1);
  });

  it('detects a citation cycle and its depth', async () => {
    const report = await auditWorkspace({ rootDir: FIXTURE });
    expect(report.chain.cycles.length).toBe(1);
    expect(report.chain.cycles[0]).toEqual([
      'wiki/concepts/demo/cycle-a.md',
      'wiki/concepts/demo/cycle-b.md',
    ]);
    expect(report.chain.maxDepth).toBeGreaterThanOrEqual(2);
  });
});
