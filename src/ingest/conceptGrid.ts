import { isValidProvenanceValue } from './provenance.ts';

/*
 Path convention for TAXO tag concepts.

 Each normalized tag has one concept page under a family folder. The folder is
 an organizational label, not an identity: independent tag pages in one family
 have independent concept IDs, while paths and labels may change.

 That only holds while the path and the declared axes cannot disagree, which is
 what `conceptPathMismatch` enforces.
*/
export const CONCEPT_PATH_PREFIX = 'wiki/concepts/';

/**
 * A legacy/manual holding folder for a page not yet assigned to a family.
 *
 * TAXO does not materialize unfiled tags here; it announces them and creates no
 * pivot. Existing or hand-authored pages may still be filed here temporarily.
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

/**
 * The raw `<concept>/<subject>` split of a concept path, before ANY validation.
 *
 * `parseConceptPagePath` returns null for a value it refuses and cannot say
 * WHICH half it refused; a caller that has to name the defect to the operator
 * needs the segments themselves.
 */
export function conceptPathSegments(pagePath: string): { class: string; subject: string } | null {
  if (!pagePath.startsWith(CONCEPT_PATH_PREFIX) || !pagePath.endsWith('.md')) return null;
  const parts = pagePath.slice(CONCEPT_PATH_PREFIX.length, -'.md'.length).split('/');
  if (parts.length !== 2) return null;
  return { class: parts[0] as string, subject: parts[1] as string };
}

export function parseConceptPagePath(pagePath: string): ConceptPathAxes | null {
  const segments = conceptPathSegments(pagePath);
  if (!segments) return null;
  const { class: className, subject: rawSubject } = segments;
  if (!isValidProvenanceValue(className)) return null;
  if (!isValidProvenanceValue(rawSubject)) return null;
  return { class: className, subject: rawSubject };
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
