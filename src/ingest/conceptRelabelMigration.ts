import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { applyProvenance, newKnowledgeIdentity, readProvenance } from './provenance.ts';
import { normalizeConceptFolderName } from './conceptFolders.ts';
import { parseConceptPagePath } from './conceptGrid.ts';
import { regenerateWikiIndex } from '../services/wikiIndexService.ts';
import { pathExists, safeWriteFile, withFileLock } from '../utils/fs.ts';
import { resolveInside, toPosix } from '../utils/path.ts';

const SOURCE_REGISTRY_PATH = '.wiki/source-registry.json';
const SOURCE_REGISTRY_VERSION = 1;

export type ConceptRelabelMapping = {
  schemaVersion: 1;
  concepts: Array<{ concept_id: string; label: string }>;
  /** Explicitly refile reviewed pages under an existing concept identity. */
  pages?: Array<{ path: string; concept_id: string }>;
  /** Explicitly group reviewed flat legacy pages under newly-created identities. */
  legacyGroups?: Array<{ label: string; pages: string[] }>;
};

export type ConceptRelabelChange = {
  from: string;
  to: string;
  concept_id: string;
  previous_concept_id?: string;
};

export type ConceptRelabelReport = {
  mode: 'preview' | 'apply';
  applied: boolean;
  changed: number;
  changes: ConceptRelabelChange[];
  conflicts: Array<{ key: string; paths: string[]; reason: string }>;
  skipped: Array<{ path: string; reason: string }>;
  vectorIndexRequiresRebuild: boolean;
  createdConcepts: Array<{ concept_id: string; label: string; pages: string[] }>;
};

type PageRecord = {
  path: string;
  content: string;
  folder: string | null;
  base: string;
  conceptId: string | null;
  targetConceptId: string | null;
  legacyFlat: boolean;
  taxo: boolean;
  target: string;
};

function simultaneousRewrite(content: string, changes: ConceptRelabelChange[]): string {
  const paths = new Map<string, string>();
  for (const change of changes) {
    paths.set(change.from, change.to);
    const sourceNoWiki = change.from.replace(/^wiki\//, '');
    const targetNoWiki = change.to.replace(/^wiki\//, '');
    if (sourceNoWiki !== change.from) paths.set(sourceNoWiki, targetNoWiki);
  }
  const rewritePath = (value: string): string => {
    const normalized = value.replace(/^\.\//, '');
    const pathPartEnd = normalized.indexOf('#');
    const pathPart = pathPartEnd < 0 ? normalized : normalized.slice(0, pathPartEnd);
    const anchor = pathPartEnd < 0 ? '' : normalized.slice(pathPartEnd);
    const target = paths.get(pathPart);
    return target ? `${target}${anchor}` : value;
  };

  let result = content;
  // Citations can point to a concept page and may carry a section anchor.
  result = result.replace(/\[src:\s*([^\]\s]+)\]/g, (match, rawPath: string) => {
    const rewritten = rewritePath(rawPath);
    return rewritten === rawPath ? match : `[src: ${rewritten}]`;
  });
  // Wiki-style links preserve their optional display label.
  result = result.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (match, rawPath: string, label = '') => {
    const rewritten = rewritePath(rawPath.trim());
    return rewritten === rawPath.trim() ? match : `[[${rewritten}${label}]]`;
  });
  // Markdown link targets may be relative to `wiki/`; keep titles and anchors.
  result = result.replace(/(\]\()([^\s)]+)([^)]*\))/g, (match, prefix: string, rawPath: string, suffix: string) => {
    const rewritten = rewritePath(rawPath);
    return rewritten === rawPath ? match : `${prefix}${rewritten}${suffix}`;
  });
  return result;
}

/**
 * Applies a reviewed concept-label map to a workspace copy. A concept keeps
 * its UUID while its folder label changes. This operation does not merge
 * different concept identities or alter archived source documents.
 */
export async function migrateConceptLabels(options: {
  rootDir: string;
  mapping: ConceptRelabelMapping;
  apply?: boolean;
}): Promise<ConceptRelabelReport> {
  const rootDir = path.resolve(options.rootDir);
  const files = (await fg('wiki/concepts/**/*.md', { cwd: rootDir, onlyFiles: true })).sort();
  const conflicts: ConceptRelabelReport['conflicts'] = [];
  const skipped: ConceptRelabelReport['skipped'] = [];
  if (!options.mapping || options.mapping.schemaVersion !== 1 || !Array.isArray(options.mapping.concepts)) {
    return {
      mode: options.apply ? 'apply' : 'preview',
      applied: false,
      changed: 0,
      changes: [],
      conflicts: [{ key: 'mapping', paths: [], reason: 'expected schemaVersion: 1 and a concepts array' }],
      skipped: [],
      vectorIndexRequiresRebuild: false,
      createdConcepts: [],
    };
  }
  const records: PageRecord[] = [];
  const idsByFolder = new Map<string, Set<string>>();
  const foldersById = new Map<string, Set<string>>();
  const recordsByFolder = new Map<string, PageRecord[]>();
  const recordByPath = new Map<string, PageRecord>();

  for (const pagePath of files) {
    const axes = parseConceptPagePath(pagePath);
    const legacyFlat = /^wiki\/concepts\/[^/]+\.md$/.test(pagePath);
    if (!axes && !legacyFlat) {
      skipped.push({ path: pagePath, reason: 'path does not match the concept leaf shape' });
      continue;
    }
    const content = await readFile(resolveInside(rootDir, pagePath), 'utf8');
    let conceptId: string | null = null;
    let taxo = false;
    try {
      conceptId = readProvenance(content).concept_id ?? null;
      taxo = typeof matter(content).data?.concept === 'string';
    } catch {
      skipped.push({ path: pagePath, reason: 'frontmatter could not be parsed' });
      continue;
    }
    if (!conceptId && !legacyFlat) {
      skipped.push({ path: pagePath, reason: 'concept_id is missing or invalid; backfill identities first' });
      continue;
    }
    if (axes && conceptId) {
      const ids = idsByFolder.get(axes.class) ?? new Set<string>();
      ids.add(conceptId);
      idsByFolder.set(axes.class, ids);
      const folders = foldersById.get(conceptId) ?? new Set<string>();
      folders.add(axes.class);
      foldersById.set(conceptId, folders);
    }
    const record: PageRecord = {
      path: pagePath,
      content,
      folder: axes?.class ?? null,
      base: pagePath.split('/').pop() ?? '',
      conceptId,
      targetConceptId: conceptId,
      legacyFlat,
      taxo,
      target: pagePath,
    };
    records.push(record);
    recordByPath.set(pagePath, record);
    if (axes) {
      const folderRecords = recordsByFolder.get(axes.class) ?? [];
      folderRecords.push(record);
      recordsByFolder.set(axes.class, folderRecords);
    }
  }

  for (const [folder, identities] of idsByFolder) {
    if (identities.size > 1) {
      conflicts.push({
        key: folder,
        paths: (recordsByFolder.get(folder) ?? []).map((record) => record.path),
        reason: 'one folder contains multiple concept identities',
      });
    }
  }
  for (const [identity, folders] of foldersById) {
    if (folders.size > 1) {
      conflicts.push({
        key: identity,
        paths: [...(foldersById.get(identity) ?? [])]
          .flatMap((folder) => recordsByFolder.get(folder) ?? [])
          .map((record) => record.path),
        reason: 'one identity is stored under multiple folder labels',
      });
    }
  }

  const mappingById = new Map<string, string>();
  for (const rawItem of options.mapping.concepts ?? []) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      conflicts.push({ key: '', paths: [], reason: 'mapping entry must be an object with concept_id and label' });
      continue;
    }
    const item = rawItem as { concept_id?: unknown; label?: unknown };
    const identity = typeof item.concept_id === 'string' ? item.concept_id : '';
    const label = normalizeConceptFolderName(item.label);
    if (!identity || !label) {
      conflicts.push({ key: identity, paths: [], reason: 'mapping requires a valid concept_id and folder label' });
      continue;
    }
    if (mappingById.has(identity)) {
      conflicts.push({ key: identity, paths: [], reason: 'mapping contains the same concept_id more than once' });
      continue;
    }
    if (!foldersById.has(identity)) {
      conflicts.push({ key: identity, paths: [], reason: 'concept_id is not present in this workspace' });
      continue;
    }
    mappingById.set(identity, label);
  }

  const pageTargets = new Map<string, string>();
  const createdConcepts: ConceptRelabelReport['createdConcepts'] = [];
  const legacyLabels = new Set<string>();
  for (const group of options.mapping.legacyGroups ?? []) {
    const label = normalizeConceptFolderName(group?.label);
    const pages = Array.isArray(group?.pages) ? group.pages.map((item) => toPosix(String(item).trim()).replace(/^\.\//, '')) : [];
    if (!label || !pages.length) {
      conflicts.push({ key: label ?? '', paths: pages, reason: 'legacy group requires a valid label and at least one reviewed page' });
      continue;
    }
    if (legacyLabels.has(label) || idsByFolder.has(label) || [...foldersById.values()].some((folders) => folders.has(label))) {
      conflicts.push({ key: label, paths: pages, reason: 'legacy group label duplicates another group or an existing concept folder' });
      continue;
    }
    legacyLabels.add(label);
    const conceptId = newKnowledgeIdentity();
    createdConcepts.push({ concept_id: conceptId, label, pages });
    for (const pagePath of pages) {
      const record = recordByPath.get(pagePath);
      if (!record?.legacyFlat) {
        conflicts.push({ key: pagePath, paths: [pagePath], reason: 'legacy group page must be an existing flat wiki/concepts/<page>.md file' });
        continue;
      }
      if (pageTargets.has(pagePath)) {
        conflicts.push({ key: pagePath, paths: [pagePath], reason: 'mapping contains the same page more than once' });
        continue;
      }
      record.targetConceptId = conceptId;
      record.target = toPosix(path.posix.join('wiki', 'concepts', label, record.base));
      pageTargets.set(pagePath, conceptId);
    }
  }
  for (const rawItem of options.mapping.pages ?? []) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      conflicts.push({ key: '', paths: [], reason: 'page mapping entry must contain path and concept_id' });
      continue;
    }
    const item = rawItem as { path?: unknown; concept_id?: unknown };
    const pagePath = typeof item.path === 'string' ? toPosix(item.path.trim()).replace(/^\.\//, '') : '';
    const identity = typeof item.concept_id === 'string' ? item.concept_id : '';
    if (!pagePath || !identity) {
      conflicts.push({ key: pagePath, paths: pagePath ? [pagePath] : [], reason: 'page mapping requires a workspace-relative path and concept_id' });
      continue;
    }
    if (pageTargets.has(pagePath)) {
      conflicts.push({ key: pagePath, paths: [pagePath], reason: 'mapping contains the same page more than once' });
      continue;
    }
    const record = recordByPath.get(pagePath);
    if (!record) {
      conflicts.push({ key: pagePath, paths: [pagePath], reason: 'page path is not a concept leaf with a unique identity' });
      continue;
    }
    if (record.conceptId === identity && !record.legacyFlat) {
      conflicts.push({ key: pagePath, paths: [pagePath], reason: 'page already belongs to the requested concept identity' });
      continue;
    }
    if (!foldersById.has(identity)) {
      conflicts.push({ key: pagePath, paths: [pagePath], reason: 'target concept_id is not present in this workspace' });
      continue;
    }
    pageTargets.set(pagePath, identity);
  }
  if (options.mapping.schemaVersion !== 1) {
    conflicts.push({ key: 'schemaVersion', paths: [], reason: 'mapping schemaVersion must be 1' });
  }

  const targetOwner = new Map<string, string>();
  for (const [identity, label] of mappingById) {
    const owner = targetOwner.get(label);
    if (owner && owner !== identity) {
      conflicts.push({ key: label, paths: [], reason: 'mapping would merge distinct concept identities; this migration only relabels one identity at a time' });
      continue;
    }
    targetOwner.set(label, identity);
    const currentFolders = foldersById.get(identity) ?? new Set<string>();
    for (const sourceFolder of currentFolders) {
      const sourcePages = (recordsByFolder.get(sourceFolder) ?? [])
        .filter((record) => record.conceptId === identity);
      for (const record of sourcePages) {
        const taxoResume = record.taxo && record.base.startsWith(`${sourceFolder}_`)
          ? record.base.slice(sourceFolder.length + 1, -'.md'.length)
          : record.taxo
            ? ''
            : null;
        if (record.taxo && !taxoResume) {
          conflicts.push({
            key: identity,
            paths: [record.path],
            reason: 'taxonomic leaf filename does not match its current folder label',
          });
          continue;
        }
        const targetBase = taxoResume == null ? record.base : `${label}_${taxoResume}.md`;
        record.target = toPosix(path.posix.join('wiki', 'concepts', label, targetBase));
      }
    }
  }

  for (const [pagePath, identity] of pageTargets) {
    const record = recordByPath.get(pagePath)!;
    if (record.legacyFlat && record.targetConceptId === identity && !foldersById.has(identity)) continue;
    record.targetConceptId = identity;
    const targetFolders = foldersById.get(identity)!;
    const targetFolder = [...targetFolders][0]!;
    const label = mappingById.get(identity) ?? targetFolder;
    if (targetFolders.size !== 1 && !mappingById.has(identity)) {
      conflicts.push({ key: identity, paths: [pagePath, ...(recordsByFolder.get(targetFolder) ?? []).map((item) => item.path)], reason: 'target concept identity has multiple folder labels; relabel it explicitly before refiling' });
      continue;
    }
    const taxoResume = record.taxo && record.folder && record.base.startsWith(`${record.folder}_`)
      ? record.base.slice(record.folder.length + 1, -'.md'.length)
      : record.taxo ? '' : null;
    if (record.taxo && !taxoResume) {
      conflicts.push({ key: identity, paths: [pagePath], reason: 'taxonomic leaf filename does not match its current folder label' });
      continue;
    }
    const targetBase = taxoResume == null ? record.base : `${label}_${taxoResume}.md`;
    record.target = toPosix(path.posix.join('wiki', 'concepts', label, targetBase));
  }

  const targets = new Map<string, PageRecord>();
  const sourcePaths = new Set(records.map((record) => record.path));
  const movingPaths = new Set(records
    .filter((record) => record.target !== record.path)
    .map((record) => record.path));
  const changes: ConceptRelabelChange[] = [];
  for (const record of records) {
    if (record.target === record.path) continue;
    const previous = targets.get(record.target);
    if (previous) {
      conflicts.push({ key: record.target, paths: [previous.path, record.path], reason: 'multiple pages would use the same destination path' });
      continue;
    }
    targets.set(record.target, record);
    if (sourcePaths.has(record.target) && !movingPaths.has(record.target)) {
      conflicts.push({ key: record.target, paths: [record.path, record.target], reason: 'destination page is not part of the reviewed migration' });
      continue;
    }
    if (!sourcePaths.has(record.target) && await pathExists(resolveInside(rootDir, record.target))) {
      conflicts.push({ key: record.target, paths: [record.path], reason: 'destination path already exists but is not part of the reviewed migration' });
      continue;
    }
    changes.push({
      from: record.path,
      to: record.target,
      concept_id: record.targetConceptId!,
      ...(record.targetConceptId !== record.conceptId && record.conceptId ? { previous_concept_id: record.conceptId } : {}),
    });
  }

  const report: ConceptRelabelReport = {
    mode: options.apply ? 'apply' : 'preview',
    applied: false,
    changed: changes.length,
    changes,
    conflicts,
    skipped,
    vectorIndexRequiresRebuild: changes.length > 0,
    createdConcepts,
  };
  if (!options.apply || conflicts.length > 0 || skipped.length > 0 || changes.length === 0) return report;

  const registryAbsolute = resolveInside(rootDir, SOURCE_REGISTRY_PATH);
  const registryExists = await pathExists(registryAbsolute);
  if (registryExists) {
    try {
      const registry = JSON.parse(await readFile(registryAbsolute, 'utf8')) as { version?: unknown; sources?: unknown };
      if (registry.version !== SOURCE_REGISTRY_VERSION || !Array.isArray(registry.sources)) {
        conflicts.push({ key: SOURCE_REGISTRY_PATH, paths: [], reason: 'source registry has an unknown or invalid format; page ownership cannot be safely updated' });
      }
    } catch {
      conflicts.push({ key: SOURCE_REGISTRY_PATH, paths: [], reason: 'source registry cannot be parsed; page ownership cannot be safely updated' });
    }
    if (conflicts.length > 0) return { ...report, conflicts };
  }

  const originalContent = new Map<string, string>();
  const staged: Array<{ change: ConceptRelabelChange; temp: string }> = [];
  const completed: ConceptRelabelChange[] = [];
  let registryOriginal: string | null = null;
  try {
    for (const change of changes) {
      const targetAbsolute = resolveInside(rootDir, change.to);
      await mkdir(path.dirname(targetAbsolute), { recursive: true });
    }
    for (const change of changes) {
      const temp = `${change.from}.relabel-${randomUUID()}.tmp`;
      await rename(resolveInside(rootDir, change.from), resolveInside(rootDir, temp));
      staged.push({ change, temp });
    }
    for (const item of staged) {
      await rename(resolveInside(rootDir, item.temp), resolveInside(rootDir, item.change.to));
      completed.push(item.change);
    }

    const allMarkdown = await fg([
      'wiki/**/*.md',
      'deliverables/**/*.md',
      'templates/**/*.md',
      'build-context/**/*.md',
    ], { cwd: rootDir, onlyFiles: true });
    const changedContents = new Map<string, { original: string; next: string }>();
    const movedRecordByTarget = new Map(changes.map((change) => [change.to, recordByPath.get(change.from)]));
    for (const file of allMarkdown) {
      const absolute = resolveInside(rootDir, file);
      const original = await readFile(absolute, 'utf8');
      let next = simultaneousRewrite(original, changes);
      const movedRecord = movedRecordByTarget.get(file);
      if (movedRecord) {
        const parsed = matter(next);
        const withConcept = movedRecord.taxo
          ? matter.stringify(parsed.content, {
            ...parsed.data,
            concept: parseConceptPagePath(file)?.class ?? movedRecord.folder,
          })
          : next;
        const provenance = readProvenance(withConcept);
        const targetAxes = parseConceptPagePath(file);
        next = applyProvenance(withConcept, {
          ...provenance,
          ...(targetAxes ? { subject: targetAxes.subject } : {}),
          concept_id: movedRecord.targetConceptId,
        });
      }
      if (next !== original || movedRecord) {
        originalContent.set(file, original);
        changedContents.set(file, { original, next });
      }
    }

    for (const [targetPath, content] of changedContents) {
      await safeWriteFile(resolveInside(rootDir, targetPath), content.next);
    }
    if (registryExists) {
      const lockPath = `${registryAbsolute}.lock`;
      await withFileLock(lockPath, async () => {
        const raw = await readFile(registryAbsolute, 'utf8');
        const registry = JSON.parse(raw) as { version: number; sources: Array<Record<string, unknown>> };
        if (registry.version !== SOURCE_REGISTRY_VERSION || !Array.isArray(registry.sources)) {
          throw new Error('Source registry changed to an unsupported format during migration.');
        }
        registryOriginal = raw;
        const pathMap = new Map(changes.map((change) => [change.from, change.to]));
        const next = {
          ...registry,
          sources: registry.sources.map((source) => ({
            ...source,
            ...(Array.isArray(source.producedPages)
              ? { producedPages: source.producedPages.map((page) => typeof page === 'string' ? pathMap.get(page) ?? page : page) }
              : {}),
          })),
        };
        await safeWriteFile(registryAbsolute, `${JSON.stringify(next, null, 2)}\n`);
      });
    }
    const index = await regenerateWikiIndex(rootDir);
    if (index.status === 'failed') {
      throw new Error(`Wiki index regeneration failed: ${index.error instanceof Error ? index.error.message : String(index.error)}`);
    }
  } catch (error) {
    const rollbackFailures: Error[] = [];
    const attemptRollback = async (action: string, operation: () => Promise<unknown>): Promise<void> => {
      try {
        await operation();
      } catch (rollbackError) {
        const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        rollbackFailures.push(new Error(`${action}: ${detail}`, { cause: rollbackError }));
      }
    };
    if (registryOriginal != null) {
      await attemptRollback('restore source registry', () => withFileLock(`${registryAbsolute}.lock`, async () => {
        await safeWriteFile(registryAbsolute, registryOriginal!);
      }));
    }
    for (const [targetPath, content] of originalContent) {
      await attemptRollback(`restore ${targetPath}`, () => safeWriteFile(resolveInside(rootDir, targetPath), content));
    }
    for (const change of [...completed].reverse()) {
      await attemptRollback(`move ${change.to} back to ${change.from}`, () =>
        rename(resolveInside(rootDir, change.to), resolveInside(rootDir, change.from)));
    }
    for (const item of [...staged].reverse()) {
      if (completed.some((change) => change.from === item.change.from)) continue;
      await attemptRollback(`restore staged ${item.change.from}`, () =>
        rename(resolveInside(rootDir, item.temp), resolveInside(rootDir, item.change.from)));
    }
    if (rollbackFailures.length) {
      const original = error instanceof Error ? error : new Error(String(error));
      throw new AggregateError(
        [original, ...rollbackFailures],
        `Concept relabel migration failed and rollback had ${rollbackFailures.length} failure(s): ${rollbackFailures.map((failure) => failure.message).join('; ')}`,
      );
    }
    throw error;
  }
  report.applied = true;
  return report;
}
