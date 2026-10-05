/*
 The concept vocabulary is the LLM's responsibility, never a table in the code.
 The folder is the current storage label for a concept; `normalizeConceptFolderName`
 decides only the SHAPE of a label, never that two names are the same concept.
 `conceptRelabelMigration.ts` (`pnpm concepts:relabel`) uses it to validate
 labels keyed by `concept_id`.
*/

const MAX_FOLDER_CHARS = 48;

/**
 * The mechanical slug a folder name must have: lowercase Unicode letters,
 * numbers, and combining marks separated by hyphens.
 * This is a shape rule, not a synonym rule — it never decides that two names
 * are the same concept.
 */
export function normalizeConceptFolderName(value: unknown): string | null {
  const raw = String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (
    !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u.test(raw)
    || [...raw].length > MAX_FOLDER_CHARS
  ) return null;
  return raw;
}
