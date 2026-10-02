import { applyProvenance, newKnowledgeIdentity, normalizeProvenanceValue, readProvenance } from './provenance.ts';
import { CONCEPT_PATH_PREFIX, parseConceptPagePath } from './conceptGrid.ts';
import type { WikiOperation } from '../types.ts';

/**
 * Apply stable IDs to concept-page writes. A folder is a TAXO family, not an
 * identity group; tag pages carry independent concept IDs. Existing page IDs
 * and IDs already attached to the same subject take precedence. This writer
 * never decides that different labels mean the same concept.
 */
export function stampConceptPageIdentities(
  operations: WikiOperation[],
  existingPages: ReadonlyMap<string, string>,
): WikiOperation[] {
  const conceptIdsBySubject = new Map<string, Set<string>>();
  const subjectIdsByLabel = new Map<string, Set<string>>();
  const subjectsMissingConceptIdentity = new Set<string>();
  const subjectsMissingIdentity = new Set<string>();
  for (const [pagePath, content] of existingPages) {
    if (!pagePath.startsWith(CONCEPT_PATH_PREFIX)) continue;
    const axes = parseConceptPagePath(pagePath);
    if (!axes) continue;
    const provenance = readProvenance(content);
    const subject = normalizeProvenanceValue(provenance.subject ?? axes.subject);
    if (!subject) continue;
    if (provenance.concept_id) {
      const ids = conceptIdsBySubject.get(subject) ?? new Set<string>();
      ids.add(provenance.concept_id);
      conceptIdsBySubject.set(subject, ids);
    } else subjectsMissingConceptIdentity.add(subject);
    if (provenance.subject_id) {
      const ids = subjectIdsByLabel.get(subject) ?? new Set<string>();
      ids.add(provenance.subject_id);
      subjectIdsByLabel.set(subject, ids);
    } else subjectsMissingIdentity.add(subject);
  }
  const conceptConflicts = new Set([...conceptIdsBySubject]
    .filter(([, ids]) => ids.size > 1).map(([subject]) => subject));
  const subjectConflicts = new Set(
    [...subjectIdsByLabel].filter(([, ids]) => ids.size > 1).map(([subject]) => subject),
  );
  const conceptBySubject = new Map([...conceptIdsBySubject]
    .filter(([subject, ids]) => ids.size === 1 && !subjectsMissingConceptIdentity.has(subject))
    .map(([subject, ids]) => [subject, [...ids][0]! ]));
  const subjectByLabel = new Map([...subjectIdsByLabel]
    .filter(([subject, ids]) => ids.size === 1 && !subjectsMissingIdentity.has(subject))
    .map(([subject, ids]) => [subject, [...ids][0]! ]));
  return operations.map((operation) => {
    if (operation.type === 'delete' || !operation.path.startsWith(CONCEPT_PATH_PREFIX)) return operation;
    const axes = parseConceptPagePath(operation.path);
    if (!axes) return operation;
    const previous = existingPages.get(operation.path);
    const old = previous ? readProvenance(previous) : null;
    const subject = normalizeProvenanceValue(old?.subject ?? axes.subject);
    if (!old?.concept_id && (conceptConflicts.has(subject) || subjectsMissingConceptIdentity.has(subject))) {
      throw new Error(`Cannot write ${operation.path}: existing pages for this subject have missing or conflicting concept_id values.`);
    }
    if (!old?.subject_id && (subjectConflicts.has(subject) || subjectsMissingIdentity.has(subject))) {
      throw new Error(`Cannot write ${operation.path}: existing pages for this subject have missing or conflicting subject_id values.`);
    }
    const conceptId = old?.concept_id
      ?? conceptBySubject.get(subject)
      ?? newKnowledgeIdentity();
    const subjectId = old?.subject_id
      ?? subjectByLabel.get(subject)
      ?? newKnowledgeIdentity();
    conceptBySubject.set(subject, conceptId);
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
