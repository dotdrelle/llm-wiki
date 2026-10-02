import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
    expect(report.summary.monoSourceRepeats).toBe(1);
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

  it('audits a nested TAXO fiche and its tag pivot without phantom terminal sources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-audit-taxo-'));
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'sources', 'acpi', 'guide'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'concepts', 'infrastructure'), { recursive: true });
    await writeFile(
      path.join(root, 'raw', 'ingested', 'guide.md'),
      '# Guide\n\n## Coûts\n\nLe coût documenté.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'sources', 'acpi', 'guide', 'couts.md'),
      '---\ntype: source\nsubject: guide-couts\ninput_hash: input\ncontent_hash: content\ngenerated:\n  by: llm-wiki\nsources:\n  - path: raw/ingested/guide.md\n---\n\n# Coûts\n\nLe coût documenté.\n\n[src: raw/ingested/guide.md#Coûts]\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'infrastructure', 'couts.md'),
      '---\ntype: concept\nsubject: coûts\nfamily: Infrastructure\ngenerated:\n  by: llm-wiki-tags\nsources:\n  - path: raw/ingested/guide.md\n---\n\n# Coûts\n\n[src: wiki/sources/acpi/guide/couts.md#Coûts]\n',
      'utf8',
    );

    const report = await auditWorkspace({ rootDir: root, workspace: 'taxo' });
    const fiche = report.sourcePages.find((entry) => entry.path.endsWith('/couts.md'));
    expect(fiche?.path).toBe('wiki/sources/acpi/guide/couts.md');
    expect(fiche?.declaredSources).toEqual(['raw/ingested/guide.md']);
    expect(report.summary.phantomSourceEntries).toBe(0);
    expect(report.summary.sourcePagesWithNoCitation).toBe(0);
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
