import { applyProvenance, newKnowledgeIdentity, normalizeProvenanceValue, readProvenance } from './provenance.ts';
import { CONCEPT_PATH_PREFIX, parseConceptPagePath } from './conceptGrid.ts';
import type { WikiOperation } from '../types.ts';

/**
 * Apply stable IDs to concept-page writes. Existing page IDs and IDs already
 * present in the destination concept/subject groups take precedence. This
 * deterministic writer is shared by ingestion, direct wiki writes and curation
 * merges; it never decides that two different labels mean the same concept.
 */
export function stampConceptPageIdentities(
  operations: WikiOperation[],
  existingPages: ReadonlyMap<string, string>,
): WikiOperation[] {
  const conceptIdsByFolder = new Map<string, Set<string>>();
  const subjectIdsByLabel = new Map<string, Set<string>>();
  const foldersMissingIdentity = new Set<string>();
  const subjectsMissingIdentity = new Set<string>();
  const knownConceptIds = new Set<string>();
  const knownSubjectIds = new Set<string>();
  const foldersByConceptId = new Map<string, Set<string>>();
  for (const [pagePath, content] of existingPages) {
    if (!pagePath.startsWith(CONCEPT_PATH_PREFIX)) continue;
    const axes = parseConceptPagePath(pagePath);
    if (!axes) continue;
    const provenance = readProvenance(content);
    if (provenance.concept_id) {
      const ids = conceptIdsByFolder.get(axes.class) ?? new Set<string>();
      ids.add(provenance.concept_id);
      conceptIdsByFolder.set(axes.class, ids);
      knownConceptIds.add(provenance.concept_id);
      const folders = foldersByConceptId.get(provenance.concept_id) ?? new Set<string>();
      folders.add(axes.class);
      foldersByConceptId.set(provenance.concept_id, folders);
    } else foldersMissingIdentity.add(axes.class);
    if (!provenance.subject) continue;
    if (provenance.subject_id) {
      const ids = subjectIdsByLabel.get(provenance.subject) ?? new Set<string>();
      ids.add(provenance.subject_id);
      subjectIdsByLabel.set(provenance.subject, ids);
      knownSubjectIds.add(provenance.subject_id);
    } else subjectsMissingIdentity.add(provenance.subject);
  }
  const conceptConflicts = new Set(
    [...conceptIdsByFolder].filter(([, ids]) => ids.size > 1).map(([folder]) => folder),
  );
  for (const folders of foldersByConceptId.values()) {
    if (folders.size > 1) for (const folder of folders) conceptConflicts.add(folder);
  }
  const subjectConflicts = new Set(
    [...subjectIdsByLabel].filter(([, ids]) => ids.size > 1).map(([subject]) => subject),
  );
  const conceptByFolder = new Map([...conceptIdsByFolder]
    .filter(([folder, ids]) => ids.size === 1 && !foldersMissingIdentity.has(folder))
    .map(([folder, ids]) => [folder, [...ids][0]! ]));
  const subjectByLabel = new Map([...subjectIdsByLabel]
    .filter(([subject, ids]) => ids.size === 1 && !subjectsMissingIdentity.has(subject))
    .map(([subject, ids]) => [subject, [...ids][0]! ]));
  return operations.map((operation) => {
    if (operation.type === 'delete' || !operation.path.startsWith(CONCEPT_PATH_PREFIX)) return operation;
    const axes = parseConceptPagePath(operation.path);
    if (!axes) return operation;
    const previous = existingPages.get(operation.path);
    const old = previous ? readProvenance(previous) : null;
    const proposed = readProvenance(operation.content ?? '');
    const subject = normalizeProvenanceValue(old?.subject ?? axes.subject);
    if (!old?.concept_id && (conceptConflicts.has(axes.class) || foldersMissingIdentity.has(axes.class))) {
      throw new Error(`Cannot write ${operation.path}: existing pages in this concept folder have missing or conflicting concept_id values.`);
    }
    if (!old?.subject_id && (subjectConflicts.has(subject) || subjectsMissingIdentity.has(subject))) {
      throw new Error(`Cannot write ${operation.path}: existing pages for this subject have missing or conflicting subject_id values.`);
    }
    const conceptId = old?.concept_id
      ?? conceptByFolder.get(axes.class)
      ?? (proposed.concept_id && knownConceptIds.has(proposed.concept_id) ? proposed.concept_id : null)
      ?? newKnowledgeIdentity();
    const subjectId = old?.subject_id
      ?? subjectByLabel.get(subject)
      ?? (proposed.subject_id && knownSubjectIds.has(proposed.subject_id) ? proposed.subject_id : null)
      ?? newKnowledgeIdentity();
    conceptByFolder.set(axes.class, conceptId);
    subjectByLabel.set(subject, subjectId);
    return {
      ...operation,
      content: applyProvenance(operation.content ?? '', {
        ...(old ?? readProvenance(operation.content ?? '')),
        subject: subject || null,
        concept_id: conceptId,
        subject_id: subjectId,
      }),
    };
  });
}
