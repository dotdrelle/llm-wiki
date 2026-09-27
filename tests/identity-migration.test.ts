import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateConceptIdentities } from '../src/ingest/identityMigration.ts';
import { readProvenance } from '../src/ingest/provenance.ts';

describe('concept identity migration', () => {
  let root = '';

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  it('previews labels without writing, then persists IDs consistently on apply', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-identities-'));
    const folder = path.join(root, 'wiki/concepts/knowledge-set');
    await mkdir(folder, { recursive: true });
    const first = path.join(folder, 'subject-one.md');
    const second = path.join(folder, 'subject-two.md');
    await writeFile(first,
      '---\nconcept_id: 123e4567-e89b-42d3-a456-426614174000\nsubject: shared-subject\nsubject_id: 223e4567-e89b-42d3-a456-426614174000\n---\n\n# First\n');
    await writeFile(second, '---\nsubject: shared-subject\n---\n\n# Second\n');

    const preview = await migrateConceptIdentities({ rootDir: root });
    expect(preview.mode).toBe('preview');
    expect(preview.changed).toBe(1);
    expect(preview.provisionalIdentities).toBe(true);
    const inventory = preview.concepts[0];
    expect(inventory).toMatchObject({
      folder: 'knowledge-set',
      identityState: 'partial',
      conceptIds: ['123e4567-e89b-42d3-a456-426614174000'],
      pageCount: 2,
      subjects: ['shared-subject'],
    });
    expect(inventory?.samples).toContainEqual(expect.objectContaining({
      path: 'wiki/concepts/knowledge-set/subject-one.md',
      subject: 'shared-subject',
    }));
    expect(readProvenance(await readFile(second, 'utf8')).concept_id).toBeNull();

    const applied = await migrateConceptIdentities({ rootDir: root, apply: true });
    expect(applied.mode).toBe('apply');
    expect(applied.changed).toBe(1);
    const firstIds = readProvenance(await readFile(first, 'utf8'));
    const secondIds = readProvenance(await readFile(second, 'utf8'));
    expect(secondIds.concept_id).toBe(firstIds.concept_id);
    expect(secondIds.subject_id).toBe(firstIds.subject_id);
  });

  it('surfaces flat legacy concept pages as a bounded review inventory instead of dropping them as malformed', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-identity-flat-'));
    const folder = path.join(root, 'wiki/concepts');
    await mkdir(folder, { recursive: true });
    for (let index = 0; index < 45; index += 1) {
      await writeFile(path.join(folder, `legacy-${index}.md`),
        `# Legacy page ${index}\n\nDistinctive detail ${index}. [src: raw/ingested/source-${index}.md]\n`);
    }

    const report = await migrateConceptIdentities({ rootDir: root });
    expect(report.scanned).toBe(45);
    expect(report.concepts).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.legacyPages.total).toBe(45);
    expect(report.legacyPages.shown).toBe(40);
    expect(report.legacyPages.pages[0]).toMatchObject({
      path: 'wiki/concepts/legacy-0.md',
      title: 'Legacy page 0',
      citations: ['raw/ingested/source-0.md'],
    });
  });

  it('reports a concept identity reused under multiple folder labels and leaves both folders untouched', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-identity-conflict-'));
    for (const folder of ['label-one', 'label-two']) {
      const dir = path.join(root, 'wiki/concepts', folder);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${folder}.md`),
        `---\nconcept_id: 123e4567-e89b-42d3-a456-426614174000\nsubject: unique-${folder}\n---\n\n# Page\n`);
    }

    const report = await migrateConceptIdentities({ rootDir: root, apply: true });
    expect(report.changed).toBe(0);
    expect(report.conflicts).toHaveLength(2);
    expect(report.conflicts.every((conflict) => conflict.reason?.includes('multiple folder labels'))).toBe(true);
    expect(report.skipped).toHaveLength(2);
    expect(report.concepts.every((concept) => concept.identityState === 'conflict')).toBe(true);
  });

  it('does not merge same-labeled subjects across concepts without an existing shared identity', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-subject-homonym-'));
    const folders = ['first-axis', 'second-axis'];
    const paths: string[] = [];
    for (const folder of folders) {
      const dir = path.join(root, 'wiki/concepts', folder);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, 'shared-name.md');
      paths.push(file);
      await writeFile(file, `---\nsubject: shared-name\n---\n\n# ${folder}\n`);
    }

    const preview = await migrateConceptIdentities({ rootDir: root });
    const conflict = preview.conflicts.find((item) => item.field === 'subject_id');
    expect(conflict?.reason).toContain('appears under multiple concept identities');
    expect(conflict?.paths).toHaveLength(2);
    expect(preview.changes).toHaveLength(2);
    expect(preview.changes.every((item) => item.subject_id === undefined)).toBe(true);
    expect(preview.changes[0]?.concept_id).not.toBe(preview.changes[1]?.concept_id);

    await migrateConceptIdentities({ rootDir: root, apply: true });
    for (const file of paths) {
      const provenance = readProvenance(await readFile(file, 'utf8'));
      expect(provenance.concept_id).toBeTruthy();
      expect(provenance.subject_id).toBeNull();
    }
  });
});
