import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { isKnowledgeIdentity, newKnowledgeIdentity, normalizeProvenanceValue } from './provenance.ts';
import { parseConceptPagePath } from './conceptGrid.ts';
import { safeWriteFile } from '../utils/fs.ts';
import { extractSourceCitations } from '../utils/markdown.ts';
import { pageTitle } from '../utils/pageTitle.ts';

const MAX_INVENTORY_SAMPLES_PER_FOLDER = 4;
const MAX_INVENTORY_EXCERPT_CHARS = 260;
const MAX_INVENTORY_SUBJECTS_PER_FOLDER = 24;
const MAX_INVENTORY_SOURCES_PER_FOLDER = 24;
const MAX_LEGACY_PAGE_PREVIEW = 40;

export type ConceptIdentityMigrationChange = {
  path: string;
  concept_id: string;
  subject_id?: string;
};

export type ConceptIdentityMigrationConflict = {
  key: string;
  paths: string[];
  identities: string[];
  field: 'concept_id' | 'subject_id';
  reason?: string;
};

export type ConceptIdentityMigrationReport = {
  mode: 'preview' | 'apply';
  /** Preview UUIDs illustrate group membership; only apply UUIDs are persisted. */
  provisionalIdentities: boolean;
  scanned: number;
  changed: number;
  changes: ConceptIdentityMigrationChange[];
  /** Corpus-derived folder map for review before any semantic relabeling. */
  concepts: Array<{
    folder: string;
    identityState: 'complete' | 'partial' | 'missing' | 'conflict' | 'invalid';
    conceptIds: string[];
    pageCount: number;
    subjects: string[];
    subjectsTotal: number;
    citedSources: string[];
    citedSourcesTotal: number;
    samples: Array<{ path: string; subject: string; citations: string[]; excerpt: string }>;
    samplesTotal: number;
  }>;
  /** Legacy flat concept pages require an explicit reviewed grouping before backfill. */
  legacyPages: {
    total: number;
    shown: number;
    pages: Array<{ path: string; title: string; citations: string[]; excerpt: string }>;
  };
  conflicts: ConceptIdentityMigrationConflict[];
  skipped: Array<{ path: string; reason: string }>;
};

/**
 * Backfills opaque identities without moving, merging, or rewriting page text.
 * Conflicting identities are reported and left untouched for a reviewed
 * migration. An identical subject label across concept identities is treated
 * as ambiguous unless all affected pages already carry the same subject_id.
 */
export async function migrateConceptIdentities(options: {
  rootDir: string;
  apply?: boolean;
}): Promise<ConceptIdentityMigrationReport> {
  const rootDir = path.resolve(options.rootDir);
  const files = (await fg('wiki/concepts/**/*.md', { cwd: rootDir, onlyFiles: true })).sort();
  const rows: Array<{
    path: string;
    absolute: string;
    content: string;
    body: string;
    data: Record<string, unknown>;
    folder: string;
    subject: string;
    identityKey: string;
    tagPage: boolean;
    conceptId: string | null;
    subjectId: string | null;
    invalid: string[];
  }> = [];
  const skipped: ConceptIdentityMigrationReport['skipped'] = [];
  const legacyPages: ConceptIdentityMigrationReport['legacyPages']['pages'] = [];
  let legacyPageCount = 0;

  for (const pagePath of files) {
    const axes = parseConceptPagePath(pagePath);
    if (!axes) {
      const tail = pagePath.startsWith('wiki/concepts/') ? pagePath.slice('wiki/concepts/'.length) : '';
      if (tail.endsWith('.md') && !tail.includes('/')) {
        const absolute = path.join(rootDir, pagePath);
        try {
          const content = await readFile(absolute, 'utf8');
          const parsed = matter(content);
          const excerpt = parsed.content.replace(/\[src:[^\]]+\]/gi, '').replace(/\s+/g, ' ').trim();
          const page = {
            path: pagePath,
            title: pageTitle(parsed) || tail.slice(0, -'.md'.length),
            citations: extractSourceCitations(parsed.content),
            excerpt: excerpt.length > MAX_INVENTORY_EXCERPT_CHARS
              ? `${excerpt.slice(0, MAX_INVENTORY_EXCERPT_CHARS).trimEnd()}…`
              : excerpt,
          };
          legacyPageCount += 1;
          if (legacyPages.length < MAX_LEGACY_PAGE_PREVIEW) legacyPages.push(page);
        } catch {
          skipped.push({ path: pagePath, reason: 'legacy flat page could not be read or parsed' });
        }
        continue;
      }
      skipped.push({ path: pagePath, reason: 'path does not match the concept leaf shape' });
      continue;
    }
    const absolute = path.join(rootDir, pagePath);
    const content = await readFile(absolute, 'utf8');
    let parsedContent: string;
    let data: Record<string, unknown>;
    try {
      const parsed = matter(content);
      parsedContent = parsed.content;
      data = parsed.data as Record<string, unknown>;
    } catch {
      skipped.push({ path: pagePath, reason: 'frontmatter could not be parsed' });
      continue;
    }
    const subject = normalizeProvenanceValue(
      typeof data.subject === 'string' && data.subject.trim() ? data.subject : axes.subject,
    );
    const generated = data.generated && typeof data.generated === 'object' ? data.generated : null;
    const tagPage = (generated as { by?: unknown } | null)?.by === 'llm-wiki-tags';
    const invalid = (['concept_id', 'subject_id'] as const)
      .filter((key) => data[key] != null && data[key] !== '' && !isKnowledgeIdentity(data[key]));
    rows.push({
      path: pagePath,
      absolute,
      content,
      body: parsedContent,
      data,
      folder: axes.class,
      subject,
      identityKey: tagPage ? `tag:${subject}` : `folder:${axes.class}`,
      tagPage,
      conceptId: isKnowledgeIdentity(data.concept_id) ? data.concept_id : null,
      subjectId: isKnowledgeIdentity(data.subject_id) ? data.subject_id : null,
      invalid,
    });
  }

  const conflicts: ConceptIdentityMigrationConflict[] = [];
  const uniqueExistingId = (
    field: 'concept_id' | 'subject_id',
    key: string,
    members: typeof rows,
    valueOf: (row: typeof rows[number]) => string | null,
  ): string | null => {
    const identities = [...new Set(members.map(valueOf).filter((value): value is string => value != null))];
    if (identities.length > 1) {
      conflicts.push({ key, field, identities, paths: members.map((row) => row.path) });
      return null;
    }
    return identities[0] ?? null;
  };

  const concepts = new Map<string, string>();
  const subjects = new Map<string, string>();
  const subjectFolders = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.subject) continue;
    const folders = subjectFolders.get(row.subject) ?? new Set<string>();
    folders.add(row.folder);
    subjectFolders.set(row.subject, folders);
  }
  const ambiguousTagSubjects = new Set<string>();
  for (const subject of new Set(rows.filter((row) => row.tagPage).map((row) => row.subject))) {
    const members = rows.filter((row) => row.tagPage && row.subject === subject);
    const folders = new Set(members.map((row) => row.folder));
    if (folders.size < 2) continue;
    const key = `tag:${subject}`;
    ambiguousTagSubjects.add(key);
    conflicts.push({
      key,
      field: 'concept_id',
      identities: [...new Set(members.map((row) => row.conceptId).filter((id): id is string => id !== null))],
      paths: members.map((row) => row.path),
      reason: 'the same TAXO tag appears in multiple family folders; review its family assignment before linking identities',
    });
  }
  const foldersByConceptId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.conceptId) continue;
    const folders = foldersByConceptId.get(row.conceptId) ?? new Set<string>();
    folders.add(row.folder);
    foldersByConceptId.set(row.conceptId, folders);
  }
  for (const [identity, folders] of foldersByConceptId) {
    if (folders.size <= 1) continue;
    const conflictingRows = rows.filter((row) => row.conceptId === identity);
    for (const folder of folders) {
      conflicts.push({
        key: `folder:${folder}`,
        field: 'concept_id',
        identities: [identity],
        paths: conflictingRows.map((row) => row.path),
        reason: 'the same concept_id appears under multiple folder labels',
      });
    }
  }
  for (const group of new Set(rows.map((row) => row.identityKey))) {
    if (ambiguousTagSubjects.has(group)) continue;
    const members = rows.filter((row) => row.identityKey === group);
    const existing = uniqueExistingId('concept_id', group, members, (row) => row.conceptId);
    if (existing) concepts.set(group, existing);
  }
  for (const subject of new Set(rows.map((row) => row.subject).filter(Boolean))) {
    const members = rows.filter((row) => row.subject === subject);
    const existing = uniqueExistingId('subject_id', subject, members, (row) => row.subjectId);
    const crossFolderLabel = (subjectFolders.get(subject)?.size ?? 0) > 1;
    const fullyLinked = Boolean(existing) && members.every((row) => row.subjectId === existing);
    if (crossFolderLabel && !fullyLinked) {
      conflicts.push({
        key: subject,
        field: 'subject_id',
        identities: existing ? [existing] : [],
        paths: members.map((row) => row.path),
        reason: 'the same subject label appears under multiple concept identities; confirm that these pages represent one subject before linking them',
      });
      continue;
    }
    if (existing) subjects.set(subject, existing);
  }

  const changes: ConceptIdentityMigrationChange[] = [];
  const conflictKeys = new Set(conflicts.map((conflict) => `${conflict.field}:${conflict.key}`));
  for (const row of rows) {
    if (row.invalid.length) {
      skipped.push({ path: row.path, reason: `invalid ${row.invalid.join(' and ')} value` });
      continue;
    }
    if (conflictKeys.has(`concept_id:${row.identityKey}`)) {
      skipped.push({ path: row.path, reason: 'concept identity group contains conflicting existing IDs' });
      continue;
    }
    const conceptId = row.conceptId ?? concepts.get(row.identityKey)
      ?? newKnowledgeIdentity();
    const subjectConflict = conflictKeys.has(`subject_id:${row.subject}`);
    const subjectId = row.subjectId ?? (subjectConflict ? null : subjects.get(row.subject))
      ?? (subjectConflict ? null : newKnowledgeIdentity());
    concepts.set(row.identityKey, conceptId);
    if (subjectId) subjects.set(row.subject, subjectId);
    if (row.conceptId === conceptId && row.subjectId === subjectId) continue;
    changes.push({
      path: row.path,
      concept_id: conceptId,
      ...(subjectId ? { subject_id: subjectId } : {}),
    });
    if (options.apply) {
      const nextData = { ...row.data, concept_id: conceptId };
      if (subjectId) (nextData as Record<string, unknown>).subject_id = subjectId;
      const rewritten = matter.stringify(row.body, nextData);
      await safeWriteFile(row.absolute, rewritten);
    }
  }

  const conceptInventory = [...new Set(rows.map((row) => row.folder))].sort().map((folder) => {
    const members = rows.filter((row) => row.folder === folder);
    const conceptIds = [...new Set(members.map((row) => row.conceptId).filter((id): id is string => Boolean(id)))].sort();
    const missingIds = members.some((row) => !row.conceptId);
    const hasInvalid = members.some((row) => row.invalid.length > 0);
    const allTagPages = members.every((row) => row.tagPage);
    const hasConflict = allTagPages
      ? members.some((row) => conflictKeys.has(`concept_id:${row.identityKey}`))
      : conceptIds.length > 1 || conflictKeys.has(`concept_id:folder:${folder}`);
    const identityState: ConceptIdentityMigrationReport['concepts'][number]['identityState'] = hasInvalid
      ? 'invalid'
      : hasConflict
        ? 'conflict'
        : missingIds
          ? conceptIds.length ? 'partial' : 'missing'
          : 'complete';
    const citedSources = [...new Set(members.flatMap((row) => extractSourceCitations(row.body)))].sort();
    const subjects = [...new Set(members.map((row) => row.subject).filter(Boolean))].sort();
    const samples = members.slice(0, MAX_INVENTORY_SAMPLES_PER_FOLDER).map((row) => {
      const excerpt = row.body.replace(/\[src:[^\]]+\]/gi, '').replace(/\s+/g, ' ').trim();
      return {
        path: row.path,
        subject: row.subject,
        citations: extractSourceCitations(row.body),
        excerpt: excerpt.length > MAX_INVENTORY_EXCERPT_CHARS
          ? `${excerpt.slice(0, MAX_INVENTORY_EXCERPT_CHARS).trimEnd()}…`
          : excerpt,
      };
    });
    return {
      folder,
      identityState,
      conceptIds,
      pageCount: members.length,
      subjects: subjects.slice(0, MAX_INVENTORY_SUBJECTS_PER_FOLDER),
      subjectsTotal: subjects.length,
      citedSources: citedSources.slice(0, MAX_INVENTORY_SOURCES_PER_FOLDER),
      citedSourcesTotal: citedSources.length,
      samples,
      samplesTotal: members.length,
    };
  });

  return {
    mode: options.apply ? 'apply' : 'preview',
    provisionalIdentities: !options.apply,
    scanned: files.length,
    changed: changes.length,
    changes,
    concepts: conceptInventory,
    legacyPages: {
      total: legacyPageCount,
      shown: legacyPages.length,
      pages: legacyPages,
    },
    conflicts,
    skipped,
  };
}
