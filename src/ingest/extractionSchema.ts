/*
 Legacy extraction metadata, retained for older workspaces.

 `scope` and `kind` are descriptive values, never identity keys. The extraction
 schemas that produced them were retired with the pre-TAXO pipeline; only the
 normalization helpers remain, used by `consolidationSchema.ts` and
 `ingest/provenance.ts`.
*/

/** Descriptive metadata retained for older workspaces; neither is an identity key. */
export type ExtractionScope = string;
export type ExtractionKind = string;

export function normalizeScope(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeKind(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
