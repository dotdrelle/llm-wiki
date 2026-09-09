import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyOkfV02Migration,
  listBundleFilesV02Migration,
  migrateOkfV02,
} from '../src/okf/scan.ts';
import { applyOkfFrontmatter } from '../src/okf/frontmatter.ts';

describe('migrateOkfV02', () => {
  it('migrates timestamp to generated and adds status: draft', () => {
    const { content, reasons } = migrateOkfV02(
      '---\ntype: concept\ntimestamp: 2026-01-01T10:00:00.000Z\n---\n# A\n',
    );
    expect(content).toContain('generated:');
    expect(content).toContain('2026-01-01T10:00:00.000Z');
    expect(content).not.toContain('timestamp:');
    expect(content).toContain('status: draft');
    expect(reasons).toContain('timestamp → generated');
  });

  it('moves a trailing Citations section into frontmatter sources', () => {
    const { content, reasons } = migrateOkfV02(
      '---\ntype: concept\n---\n# A\n\nbody text\n\n## Citations\n- [src: raw/ingested/note.md]\n- [src: raw/ingested/other.md]\n',
    );
    expect(content).toContain('sources:');
    expect(content).toContain('path: raw/ingested/note.md');
    expect(content).toContain('path: raw/ingested/other.md');
    expect(content).not.toContain('## Citations');
    expect(content).toContain('body text');
    expect(reasons.some((reason) => reason.startsWith('Citations section'))).toBe(true);
  });

  it('leaves a mid-document Citations section in place and reports it', () => {
    const original = '---\ntype: concept\n---\n# A\n\n## Citations\n- [src: raw/ingested/x.md]\n\n## After\nmore text\n';
    const { content, reasons } = migrateOkfV02(original);
    expect(content).toContain('## Citations');
    expect(reasons.some((reason) => reason.includes('not trailing'))).toBe(true);
  });

  it('accumulates sources without duplicating existing ones', () => {
    const { content } = migrateOkfV02(
      '---\ntype: concept\nsources:\n  - path: raw/ingested/note.md\n---\n# A\n\n## Citations\n- [src: raw/ingested/note.md]\n- [src: raw/ingested/other.md]\n',
    );
    const matches = content.match(/path: raw\/ingested\/note\.md/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(content).toContain('path: raw/ingested/other.md');
  });

  it('reports no reasons for an already-migrated page', () => {
    const { reasons } = migrateOkfV02(
      '---\ntype: concept\ngenerated:\n  by: llm-wiki\n  at: 2026-01-01T10:00:00.000Z\nstatus: draft\n---\n# A\n',
    );
    expect(reasons).toHaveLength(0);
  });
});

describe('the v0.2 catch-up scan', () => {
  it('lists and applies the migration across the bundle, idempotently', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'okf-v02-scan-'));
    mkdirSync(path.join(rootDir, 'wiki', 'concepts', 'demo'), { recursive: true });
    const file = 'wiki/concepts/demo/a.md';
    writeFileSync(
      path.join(rootDir, file),
      '---\ntype: concept\ntimestamp: 2026-01-01T10:00:00.000Z\n---\n# A\n\n## Citations\n- [src: raw/ingested/note.md]\n',
    );

    const migrations = await listBundleFilesV02Migration(rootDir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0].file).toBe(file);

    const { written } = await applyOkfV02Migration(rootDir);
    expect(written).toEqual([file]);

    const migrated = readFileSync(path.join(rootDir, file), 'utf8');
    expect(migrated).not.toContain('timestamp:');
    expect(migrated).toContain('generated:');

    // Idempotent: the second scan finds nothing to do.
    expect(await listBundleFilesV02Migration(rootDir)).toHaveLength(0);
  });
});


describe('applyOkfFrontmatter sources', () => {
  it('refreshes usage_count for a known source path instead of duplicating it', () => {
    const once = applyOkfFrontmatter('---\ntype: concept\n---\n# A\n', {
      sources: [{ path: 'raw/ingested/note.md', usage_count: 2 }],
    });
    const twice = applyOkfFrontmatter(once, {
      sources: [{ path: 'raw/ingested/note.md', usage_count: 7 }],
    });
    expect(twice.match(/path: raw\/ingested\/note\.md/g)).toHaveLength(1);
    expect(twice).toContain('usage_count: 7');
    expect(twice).not.toContain('usage_count: 2');
  });
});
