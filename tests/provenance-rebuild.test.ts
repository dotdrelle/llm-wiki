import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rebuildProvenance } from '../src/provenance/rebuild.ts';

async function writePage(root: string, rel: string, content: string): Promise<void> {
  const absolute = path.join(root, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

describe('provenance rebuild (lot 6, deterministic half)', () => {
  it('drops a phantom source and adds an undeclared one on a copy', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rebuild-'));
    await writePage(
      root,
      'wiki/concepts/demo/anaplan.md',
      '---\nsubject: anaplan\ntype: product\nsources:\n  - path: raw/ingested/phantom.md\n---\n\n# Anaplan\n\n[src: raw/ingested/y.md#Coûts]\n',
    );
    const before = path.join(root, 'wiki/concepts/demo/anaplan.md');

    // Dry-run: nothing changes on disk, the report still measures the gap.
    const dry = await rebuildProvenance({ rootDir: root });
    expect(dry.changed).toBe(1);
    expect(dry.phantomEntriesRemoved).toBe(1);
    expect(dry.undeclaredAdded).toBe(1);
    expect(await readFile(before, 'utf8')).toContain('phantom.md');

    const applied = await rebuildProvenance({ rootDir: root, apply: true });
    expect(applied.changed).toBe(1);
    const written = await readFile(before, 'utf8');
    expect(written).toContain('raw/ingested/y.md');
    expect(written).not.toContain('phantom.md');
  });

  it('leaves an unresolved page untouched and reports it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rebuild-degraded-'));
    const bad = '---\nsubject: x\ntype: product\nsources:\n  - path: raw/ingested/x.md\n---\n\n# X\n\n[src: wiki/sources/missing.md]\n';
    await writePage(root, 'wiki/concepts/demo/x.md', bad);

    const report = await rebuildProvenance({ rootDir: root, apply: true });
    expect(report.degraded).toBe(1);
    expect(await readFile(path.join(root, 'wiki/concepts/demo/x.md'), 'utf8')).toBe(bad);
  });

  it('rebuilds provenance across nested TAXO fiches and tag pivots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rebuild-taxo-'));
    await writePage(root, 'raw/ingested/acpi/guide.md', '# Guide\n\n## Costs\n\nEvidence text.\n');
    await writePage(
      root,
      'wiki/sources/acpi/guide/costs.md',
      '---\ntype: source\nsubject: guide-costs\nsources: []\n---\n\n# Costs\n\nEvidence text.\n\n[src: raw/ingested/acpi/guide.md#Costs]\n',
    );
    await writePage(
      root,
      'wiki/concepts/infrastructure/costs.md',
      '---\ntype: concept\nsubject: costs\nsources: []\n---\n\n# Costs\n\n[src: wiki/sources/acpi/guide/costs.md]\n',
    );

    const report = await rebuildProvenance({ rootDir: root, apply: true });
    expect(report.scanned).toBe(2);
    expect(report.files.map((file) => file.path)).toEqual([
      'wiki/concepts/infrastructure/costs.md',
      'wiki/sources/acpi/guide/costs.md',
    ]);
    expect(report.files.every((file) => file.clean)).toBe(true);
    expect(await readFile(path.join(root, 'wiki/sources/acpi/guide/costs.md'), 'utf8'))
      .toContain('path: raw/ingested/acpi/guide.md');
    expect(await readFile(path.join(root, 'wiki/concepts/infrastructure/costs.md'), 'utf8'))
      .toContain('path: raw/ingested/acpi/guide.md');
  });
});
