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

export type ConceptPathAxes = { class: string; subject: string };

export function parseConceptPagePath(pagePath: string): ConceptPathAxes | null {
  if (!pagePath.startsWith(CONCEPT_PATH_PREFIX) || !pagePath.endsWith('.md')) return null;
  const rest = pagePath.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length);
  const parts = rest.split('/');
  if (parts.length !== 2) return null;
  const [className, subject] = parts as [string, string];
  if (!isValidProvenanceValue(className) || !isValidProvenanceValue(subject)) return null;
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
