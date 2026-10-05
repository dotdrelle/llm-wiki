import { hashText } from '../utils/hash.ts';
// Shared by the final-context filter and the freshness hash.
export const FINAL_CONTEXT_EXCLUDED_PATHS = new Set(['wiki/index.md', 'wiki/log.md']);
export const BUILD_INPUT_SIGNATURE = 'wiki-content-v2';

/** Version of the build-state `outputHash` that is comparable to the file on disk. */
export const OUTPUT_HASH_VERSION = 2;
/**
 * True only when the file provably differs from what the last build wrote. A
 * legacy record (hash of the un-normalized text) cannot prove it, so it is
 * never reported as a hand edit.
 */
export function outputEditedSinceBuild(prior: { outputHash: string; outputHashVersion?: number }, content: string): boolean {
  return prior.outputHashVersion === OUTPUT_HASH_VERSION && prior.outputHash !== hashText(content);
}

/**
 * Whether the wiki is unchanged since a deliverable was built. A record written
 * before the current fingerprint carries the legacy one: if that still matches
 * the wiki as it is now, nothing changed and the deliverable stays fresh —
 * an engine upgrade must not stale (and rebuild) every deliverable once.
 */
export function knowledgeUnchanged(priorWikiHash: string, current: string, legacy: string): boolean {
  return priorWikiHash === current || priorWikiHash === legacy;
}
