import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateConceptLabels } from '../src/ingest/conceptRelabelMigration.ts';

describe('reviewed concept label migration', () => {
  let root = '';

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  it('relables a TAXO tag family without changing the tag filename or identity', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-relabel-taxo-tag-'));
    const dir = path.join(root, 'wiki/concepts/family-old');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'network.md'), [
      '---',
      'title: network',
      'subject: network',
      'concept_id: 123e4567-e89b-42d3-a456-426614174000',
      'subject_id: 223e4567-e89b-42d3-a456-426614174000',
      'family: family-old',
      'generated:',
      '  by: llm-wiki-tags',
      '---',
      '',
      '# network',
      '',
    ].join('\n'));

    const mapping = {
      schemaVersion: 1 as const,
      concepts: [{ concept_id: '123e4567-e89b-42d3-a456-426614174000', label: 'family-new' }],
    };
    const preview = await migrateConceptLabels({ rootDir: root, mapping });
    expect(preview.conflicts).toEqual([]);
    expect(preview.changes).toEqual([expect.objectContaining({
      from: 'wiki/concepts/family-old/network.md',
      to: 'wiki/concepts/family-new/network.md',
    })]);

    const applied = await migrateConceptLabels({ rootDir: root, mapping, apply: true });
    expect(applied.applied).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/family-new/network.md'), 'utf8');
    expect(moved).toContain('subject: network');
    expect(moved).toContain('concept_id: 123e4567-e89b-42d3-a456-426614174000');
    expect(moved).toContain('subject_id: 223e4567-e89b-42d3-a456-426614174000');
    expect(moved).toContain('family: family-new');
    expect(moved).toContain('by: llm-wiki-tags');
  });

  it('previews, then relabels by concept_id and rewrites inbound references', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-relabel-'));
    const sourceDir = path.join(root, 'wiki/concepts/label-old');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
    await mkdir(path.join(root, 'raw/ingested'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/label-old/subject-one.md'),
      '---\nconcept_id: 123e4567-e89b-42d3-a456-426614174000\nsubject: subject-one\nsubject_id: 223e4567-e89b-42d3-a456-426614174000\n---\n\n# Subject\n\nEvidence [src: raw/ingested/source.md].\n');
    await writeFile(path.join(root, 'wiki/sources/note.md'),
      '# Note\n\n'
      + 'See [src: wiki/concepts/label-old/subject-one.md#Details].\n\n'
      + 'Wiki link [[wiki/concepts/label-old/subject-one.md|detail]].\n\n'
      + 'Markdown link [detail](concepts/label-old/subject-one.md#Details).\n\n'
      + 'The literal path wiki/concepts/label-old/subject-one.md is historical text.\n');
    await writeFile(path.join(root, 'raw/ingested/source.md'), '# Original\n');

    const mapping = {
      schemaVersion: 1 as const,
      concepts: [{ concept_id: '123e4567-e89b-42d3-a456-426614174000', label: 'label-new' }],
    };
    const preview = await migrateConceptLabels({ rootDir: root, mapping });
    expect(preview.mode).toBe('preview');
    expect(preview.changed).toBe(1);
    expect(await readFile(path.join(root, 'wiki/concepts/label-old/subject-one.md'), 'utf8')).toContain('concept_id:');

    const applied = await migrateConceptLabels({ rootDir: root, mapping, apply: true });
    expect(applied.applied).toBe(true);
    expect(applied.vectorIndexRequiresRebuild).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/label-new/subject-one.md'), 'utf8');
    expect(moved).toContain('concept_id: 123e4567-e89b-42d3-a456-426614174000');
    expect(await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8'))
      .toContain('[src: wiki/concepts/label-new/subject-one.md#Details]');
    const note = await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8');
    expect(note).toContain('[[wiki/concepts/label-new/subject-one.md|detail]]');
    expect(note).toContain('[detail](concepts/label-new/subject-one.md#Details)');
    expect(note).toContain('The literal path wiki/concepts/label-old/subject-one.md is historical text.');
    expect(await readFile(path.join(root, 'wiki/index.md'), 'utf8')).toContain('label-new/subject-one.md');
    expect(await readFile(path.join(root, 'raw/ingested/source.md'), 'utf8')).toBe('# Original\n');
  });

  it('refuses a mapping that would merge distinct concept identities', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-relabel-conflict-'));
    for (const [folder, id] of [
      ['label-one', '123e4567-e89b-42d3-a456-426614174000'],
      ['label-two', '223e4567-e89b-42d3-a456-426614174000'],
    ]) {
      const dir = path.join(root, 'wiki/concepts', folder);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${folder}.md`), `---\nconcept_id: ${id}\nsubject: ${folder}\n---\n\n# Page\n`);
    }
    const report = await migrateConceptLabels({
      rootDir: root,
      mapping: {
        schemaVersion: 1,
        concepts: [
          { concept_id: '123e4567-e89b-42d3-a456-426614174000', label: 'merged-label' },
          { concept_id: '223e4567-e89b-42d3-a456-426614174000', label: 'merged-label' },
        ],
      },
      apply: true,
    });
    expect(report.applied).toBe(false);
    expect(report.conflicts.some((conflict) => conflict.reason.includes('merge distinct concept identities'))).toBe(true);
    expect(await readFile(path.join(root, 'wiki/concepts/label-one/label-one.md'), 'utf8')).toContain('concept_id:');
  });

  it('moves explicitly grouped flat legacy pages into a new opaque concept identity', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-relabel-legacy-'));
    const firstPath = path.join(root, 'wiki/concepts/old-subject-one.md');
    const secondPath = path.join(root, 'wiki/concepts/old-subject-two.md');
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
    await mkdir(path.join(root, 'raw/ingested'), { recursive: true });
    const first = '---\ntitle: First page\nsubject_id: 223e4567-e89b-42d3-a456-426614174000\n---\n\n# First\n\nEvidence [src: raw/ingested/proof.md#Detail].\n';
    const second = '---\ntitle: Second page\n---\n\n# Second\n\nOther evidence.\n';
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    await writeFile(path.join(root, 'wiki/sources/note.md'), 'See [src: wiki/concepts/old-subject-one.md#First].\n');
    await writeFile(path.join(root, 'raw/ingested/proof.md'), '# Proof\n');
    const mapping = {
      schemaVersion: 1 as const,
      concepts: [],
      legacyGroups: [{ label: 'reviewed-axis', pages: ['wiki/concepts/old-subject-one.md', 'wiki/concepts/old-subject-two.md'] }],
    };

    const preview = await migrateConceptLabels({ rootDir: root, mapping });
    expect(preview.conflicts).toEqual([]);
    expect(preview.changes).toHaveLength(2);
    expect(preview.changes[0]?.concept_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(preview.changes[1]?.concept_id).toBe(preview.changes[0]?.concept_id);
    expect(await readFile(firstPath, 'utf8')).toBe(first);

    const applied = await migrateConceptLabels({ rootDir: root, mapping, apply: true });
    expect(applied.applied).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/reviewed-axis/old-subject-one.md'), 'utf8');
    expect(moved).toContain(`concept_id: ${applied.changes[0]?.concept_id}`);
    expect(moved).toContain('subject: old-subject-one');
    expect(moved).toContain('subject_id: 223e4567-e89b-42d3-a456-426614174000');
    expect(moved).toContain('[src: raw/ingested/proof.md#Detail]');
    expect(await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8'))
      .toContain('[src: wiki/concepts/reviewed-axis/old-subject-one.md#First]');
    expect(await readFile(path.join(root, 'wiki/concepts/reviewed-axis/old-subject-two.md'), 'utf8'))
      .toContain(`concept_id: ${applied.changes[0]?.concept_id}`);
  });

  it('rejects unreviewed legacy page paths and labels that collide with an existing folder', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-relabel-legacy-invalid-'));
    const dir = path.join(root, 'wiki/concepts/existing-axis');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/legacy.md'), '# Legacy\n');
    await writeFile(path.join(dir, 'page.md'), '---\nconcept_id: 123e4567-e89b-42d3-a456-426614174000\n---\n# Existing\n');
    const report = await migrateConceptLabels({ rootDir: root, mapping: {
      schemaVersion: 1,
      concepts: [],
      legacyGroups: [
        { label: 'existing-axis', pages: ['wiki/concepts/legacy.md'] },
        { label: 'new-axis', pages: ['wiki/concepts/missing.md'] },
      ],
    }, apply: true });
    expect(report.applied).toBe(false);
    expect(report.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(await readFile(path.join(root, 'wiki/concepts/legacy.md'), 'utf8')).toBe('# Legacy\n');
  });

  it('refiles a reviewed page under an existing concept identity and preserves subject identity and citations', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-refile-'));
    await mkdir(path.join(root, '.wiki'), { recursive: true });
    for (const [folder, id, subject] of [
      ['axis-one', '123e4567-e89b-42d3-a456-426614174000', 'subject-one'],
      ['axis-two', '223e4567-e89b-42d3-a456-426614174000', 'subject-two'],
    ]) {
      const dir = path.join(root, 'wiki/concepts', folder);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${subject}.md`),
        `---\nconcept_id: ${id}\nsubject: ${subject}\nsubject_id: 323e4567-e89b-42d3-a456-426614174000\n---\n\n# ${subject}\n\nEvidence [src: raw/ingested/source.md#Details].\n`);
    }
    const original = await readFile(path.join(root, 'wiki/concepts/axis-one/subject-one.md'), 'utf8');
    await writeFile(path.join(root, '.wiki/source-registry.json'), JSON.stringify({
      version: 1,
      sources: [{
        sourceId: 'path:raw/ingested/source.md',
        archivePath: 'raw/ingested/source.md',
        contentHash: 'sha256:abc',
        status: 'active',
        firstSeenAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-01T00:00:00Z',
        lastIngestedAt: '2026-01-01T00:00:00Z',
        producedPages: ['wiki/concepts/axis-one/subject-one.md'],
      }],
    }, null, 2));
    const mapping = {
      schemaVersion: 1 as const,
      concepts: [],
      pages: [{ path: 'wiki/concepts/axis-one/subject-one.md', concept_id: '223e4567-e89b-42d3-a456-426614174000' }],
    };

    const preview = await migrateConceptLabels({ rootDir: root, mapping });
    expect(preview.changed).toBe(1);
    expect(preview.changes[0]).toMatchObject({
      from: 'wiki/concepts/axis-one/subject-one.md',
      to: 'wiki/concepts/axis-two/subject-one.md',
      concept_id: '223e4567-e89b-42d3-a456-426614174000',
      previous_concept_id: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(await readFile(path.join(root, 'wiki/concepts/axis-one/subject-one.md'), 'utf8')).toBe(original);

    const applied = await migrateConceptLabels({ rootDir: root, mapping, apply: true });
    expect(applied.applied).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/axis-two/subject-one.md'), 'utf8');
    expect(moved).toContain('concept_id: 223e4567-e89b-42d3-a456-426614174000');
    expect(moved).toContain('subject_id: 323e4567-e89b-42d3-a456-426614174000');
    expect(moved).toContain('[src: raw/ingested/source.md#Details]');
    const registry = JSON.parse(await readFile(path.join(root, '.wiki/source-registry.json'), 'utf8'));
    expect(registry.sources[0].producedPages).toEqual(['wiki/concepts/axis-two/subject-one.md']);
    expect(await readFile(path.join(root, 'wiki/concepts/axis-one/subject-one.md'), 'utf8').catch(() => '')).toBe('');
  });

  it('refuses to overwrite a destination page outside the reviewed inventory', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-refile-collision-'));
    for (const [folder, id, subject] of [
      ['axis-one', '123e4567-e89b-42d3-a456-426614174000', 'subject-one'],
      ['axis-two', '223e4567-e89b-42d3-a456-426614174000', 'subject-two'],
    ]) {
      const dir = path.join(root, 'wiki/concepts', folder);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${subject}.md`), `---\nconcept_id: ${id}\nsubject: ${subject}\n---\n\n# Page\n`);
    }
    const destination = path.join(root, 'wiki/concepts/axis-two/subject-one.md');
    await writeFile(destination, '# Unreviewed destination\n');
    const report = await migrateConceptLabels({
      rootDir: root,
      mapping: {
        schemaVersion: 1,
        concepts: [],
        pages: [{ path: 'wiki/concepts/axis-one/subject-one.md', concept_id: '223e4567-e89b-42d3-a456-426614174000' }],
      },
      apply: true,
    });
    expect(report.applied).toBe(false);
    expect(report.conflicts.some((conflict) => conflict.reason.includes('not part of the reviewed migration'))).toBe(true);
    expect(await readFile(destination, 'utf8')).toBe('# Unreviewed destination\n');
  });

  it('restores moved pages when index regeneration fails after the move', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'concept-relabel-rollback-'));
    const originalPath = path.join(root, 'wiki/concepts/label-old/subject-one.md');
    await mkdir(path.dirname(originalPath), { recursive: true });
    await mkdir(path.join(root, 'wiki/index.md'), { recursive: true });
    const original = '---\nconcept_id: 123e4567-e89b-42d3-a456-426614174000\nsubject: subject-one\n---\n\n# Evidence\n';
    await writeFile(originalPath, original);

    await expect(migrateConceptLabels({
      rootDir: root,
      mapping: {
        schemaVersion: 1,
        concepts: [{ concept_id: '123e4567-e89b-42d3-a456-426614174000', label: 'label-new' }],
      },
      apply: true,
    })).rejects.toThrow(/Wiki index regeneration failed/);

    expect(await readFile(originalPath, 'utf8')).toBe(original);
    await expect(readFile(path.join(root, 'wiki/concepts/label-new/subject-one.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
