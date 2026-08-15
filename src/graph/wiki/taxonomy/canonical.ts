import { createHash } from 'node:crypto';

/**
 * Canonical serialization of the taxonomy registry.
 *
 * A generation is addressed by the fingerprint of its content, and the marker
 * that publishes it carries this fingerprint to verify it. Both require that the
 * same registry always produce the same bytes:
 *
 * - two producers that compute the same taxonomy must converge on the
 *   same file name — that is the natural deduplication and the idempotence of the
 *   replay;
 * - re-reading a valid generation must never fail the integrity
 *   check because another Node version ordered the keys
 *   differently.
 *
 * `JSON.stringify` preserves the key insertion order, which depends on the
 * object's construction order: two code paths producing the same logical
 * value produce different bytes. We therefore sort the keys
 * recursively. The order of arrays, for its part, carries meaning (a member
 * list, a history) and is never reordered.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      // `undefined` would silently disappear from the JSON output: two
      // objects of different shapes would then produce the same fingerprint. The
      // schema validates upstream, so its presence here is a caller defect.
      if (entry === undefined) continue;
      sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('canonicalize: non-finite number, not representable in JSON');
  }
  return value;
}

/** Exact bytes that will be written to disk — the hash covers them. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Fingerprint of a canonical content, truncated.
 *
 * It serves as a file name and travels in the marker; 32 hexadecimal
 * characters (128 bits) leave a considerable margin against the number of
 * generations a workspace will ever produce, while keeping a readable name
 * in an `ls`.
 */
export function contentHash(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}
