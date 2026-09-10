import { isValidProvenanceValue } from './provenance.ts';

/*
 Path convention of a concept leaf.

 One leaf per (concept × subject): a subject cited under three concepts yields
 three leaves, each carrying only what belongs to its concept. The path carries
 the two axes — the concept is the folder, the subject is the file name — which
 makes reuse deterministic and the transverse edge of the graph computable.

 That only holds while the path and the declared axes cannot disagree, which is
 what `conceptPathMismatch` enforces.
*/
export const CONCEPT_PATH_PREFIX = 'wiki/concepts/';

/**
 * The reserved concept a leaf falls into when it matches no folder yet.
 *
 * It is never part of a closed set: it is the ENGINE's answer to "this subject
 * does not belong to any concept yet". A leaf waits at
 * `wiki/concepts/unclassified/<subject>.md` until someone files it into a real
 * concept folder.
 */
export const UNCLASSIFIED_CLASS = 'unclassified';
export const UNCLASSIFIED_ID = UNCLASSIFIED_CLASS;
export const UNCLASSIFIED_LABEL = 'Unclassified';

export function conceptPagePath(concept: string, subject: string): string {
  return `${CONCEPT_PATH_PREFIX}${concept}/${subject}.md`;
}

/**
 * The concept folder of a graph node id (with or without a trailing `.md`),
 * or undefined when the id is not a concept leaf. Structural only — unlike
 * `parseConceptPagePath`, it does not validate the folder/subject values,
 * which is what graph builders that only need "which bubble does this belong
 * to" want; use `parseConceptPagePath` where an invalid axis must be caught.
 */
export function conceptFolderFromId(nodeId: string): string | undefined {
  const parts = nodeId.split('/');
  return parts[0] === 'wiki' && parts[1] === 'concepts' && parts.length >= 4
    ? parts[2]
    : undefined;
}

export type ConceptPathAxes = { class: string; subject: string };

export function parseConceptPagePath(pagePath: string): ConceptPathAxes | null {
  if (!pagePath.startsWith(CONCEPT_PATH_PREFIX) || !pagePath.endsWith('.md')) return null;
  const rest = pagePath.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length);
  const parts = rest.split('/');
  if (parts.length !== 2) return null;
  const [className, rawSubject] = parts as [string, string];
  if (!isValidProvenanceValue(className)) return null;
  // A taxo leaf's basename is `<concept>_<resume>` — the underscore is the
  // taxo naming convention, not a literal character the subject is meant to
  // carry. Tolerating ONLY that one substitution (not a full
  // normalizeProvenanceValue, which would also rescue spaces/accents/casing
  // and blur a genuinely malformed path with a taxo one) — and only when the
  // raw value doesn't already validate, so a classic path is completely
  // unchanged — lets this parse instead of unconditionally returning null
  // for every taxo leaf, which used to disable reconcileConceptSubject's
  // path-wins-over-declared-subject guarantee for the whole pipeline.
  const subject = isValidProvenanceValue(rawSubject) ? rawSubject : rawSubject.replace(/_/g, '-');
  if (!isValidProvenanceValue(subject)) return null;
  return { class: className, subject };
}

/**
 * Why a leaf's path disagrees with its declared subject, or null when they
 * agree. The concept (folder) is authoritative by construction; only the
 * subject can drift, and this is the check that catches it.
 */
export function conceptPathMismatch(
  pagePath: string,
  axes: { class: string; subject: string },
): string | null {
  const expected = conceptPagePath(axes.class, axes.subject);
  if (pagePath === expected) return null;
  return `path does not match its declared axes; expected ${expected}`;
}
