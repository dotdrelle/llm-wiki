import matter from 'gray-matter';

/*
 OKF (Open Knowledge Format) frontmatter.

 OKF v0.1 requires exactly one mandatory key per Markdown file: `type`.
 `title`, `description`, `resource`, `tags` and `timestamp` are reserved but
 optional. A bundle is a directory of Markdown; `index.md` and `log.md` are
 conventions; relative links form the graph; history is git.

 llm-wiki is already a directory of Markdown with relative links, an index, a
 log and git history, so the only real gap is the `type` key. This module is the
 single source of truth for it: which `type` a path carries (`okfTypeForPath`),
 and how to write it additively (`applyOkfFrontmatter`) — a manual `type` always
 wins, the engine never overwrites it.
 */

export const OKF_TYPE_CONCEPT = 'concept';
export const OKF_TYPE_SOURCE = 'source';
export const OKF_TYPE_ANSWER = 'answer';
export const OKF_TYPE_INDEX = 'index';
export const OKF_TYPE_LOG = 'log';
export const OKF_TYPE_CONCEPT_GRID = 'concept-grid';
export const OKF_TYPE_DELIVERABLE = 'deliverable';

/**
 * The closed `type` vocabulary, in the order the doctor check and the lint
 * rule report it. Deliberately derived from what already exists on disk — no
 * new vocabulary is invented here (see PlanOKF.md, phase 0).
 */
export const OKF_TYPES = [
  OKF_TYPE_CONCEPT,
  OKF_TYPE_SOURCE,
  OKF_TYPE_ANSWER,
  OKF_TYPE_INDEX,
  OKF_TYPE_LOG,
  OKF_TYPE_CONCEPT_GRID,
  OKF_TYPE_DELIVERABLE,
] as const;

export function isOkfType(value: unknown): value is string {
  return typeof value === 'string' && (OKF_TYPES as readonly string[]).includes(value);
}

/**
 * The OKF `type` a bundle path carries, or null when the path is not in the
 * bundle (raw inputs, templates, build context and `.wiki` state stay out).
 *
 * For `wiki/concepts/**` the type is the page's `kind` when it has one —
 * `kind` is the structured vocabulary the extraction already validated, and it
 * fits OKF's `type` exactly — otherwise the generic `concept`.
 */
export function okfTypeForPath(
  relativePath: string,
  provenance?: { kind?: string | null },
): string | null {
  const path = String(relativePath ?? '').replace(/\\/g, '/');
  if (path.startsWith('wiki/concepts/')) return provenance?.kind ?? OKF_TYPE_CONCEPT;
  if (path.startsWith('wiki/sources/')) return OKF_TYPE_SOURCE;
  if (path.startsWith('wiki/answers/')) return OKF_TYPE_ANSWER;
  if (path === 'wiki/index.md') return OKF_TYPE_INDEX;
  if (path === 'wiki/log.md') return OKF_TYPE_LOG;
  if (path === 'wiki/concepts-grid.md') return OKF_TYPE_CONCEPT_GRID;
  if (path.startsWith('deliverables/')) return OKF_TYPE_DELIVERABLE;
  return null;
}

/**
 * Adds reserved OKF keys to a file's frontmatter, **additively**: a key already
 * present — including a `type` written by hand — is never overwritten, and the
 * body is never touched. Returns the content unchanged when nothing is added.
 *
 * OKF v0.2 keys beyond v0.1's `type`/`title`/`timestamp`:
 * - `generated` — who produced the page and when (written at ingest);
 * - `verified` — the human decisions that reviewed it (written at merge);
 * - `status` — draft | stable | deprecated (draft at ingest, stable at merge).
 * `timestamp` stays a tolerated legacy key; the v0.2 migration of existing
 * pages is a separate manual catch-up phase, never a mass write during a run.
 */
export function applyOkfFrontmatter(
  content: string,
  options: {
    type?: string;
    title?: string;
    timestamp?: string;
    generated?: { by: string; at: string };
    verified?: Array<{ by: string; at: string }>;
    status?: string;
    sources?: Array<{ path: string; usage_count?: number }>;
  },
): string {
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };
  let changed = false;
  if (options.type != null && data.type == null) {
    data.type = options.type;
    changed = true;
  }
  if (options.title != null && data.title == null) {
    data.title = options.title;
    changed = true;
  }
  if (options.timestamp != null && data.timestamp == null) {
    data.timestamp = options.timestamp;
    changed = true;
  }
  if (options.generated != null && data.generated == null) {
    data.generated = options.generated;
    changed = true;
  }
  if (options.status != null && data.status == null) {
    data.status = options.status;
    changed = true;
  }
  if (Array.isArray(options.verified) && options.verified.length > 0) {
    // A merge ADDS its decision to the existing ones; it never rewrites them.
    const existing = Array.isArray(data.verified) ? data.verified : [];
    const merged = [...existing, ...options.verified];
    data.verified = merged;
    changed = true;
  }
  if (Array.isArray(options.sources) && options.sources.length > 0) {
    data.sources = mergeSources(data.sources, options.sources);
    changed = true;
  }
  if (!changed) return content;
  return matter.stringify(parsed.content, data);
}

/**
 * Union of two `sources` lists, keyed by path: a source cited twice is listed
 * once, and the later `usage_count` replaces the earlier observation.
 */
export function mergeSources(
  existing: unknown,
  incoming: unknown,
): Array<Record<string, unknown>> {
  const list = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
  const byPath = new Map<string, Record<string, unknown>>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const path = String(record.path ?? '');
    if (!path) continue;
    const known = byPath.get(path) ?? { path };
    if (Number.isFinite(Number(record.usage_count))) known.usage_count = Number(record.usage_count);
    byPath.set(path, known);
  }
  return [...byPath.values()];
}

/**
 * Carries the engine-owned frontmatter of an existing page onto its
 * replacement.
 *
 * A leaf is rewritten whole by the model on every ingest, so the operation
 * content starts from the model's own frontmatter and never carries what an
 * earlier ingest accumulated. The existing file is only available here, at
 * write time: this is what makes `sources` (and the first `generated`, the
 * human `status`/`verified`) survive an update instead of resetting to the
 * current source. Keys the operation sets (subject, tags, scope, kind, type,
 * title) still win; keys only the file had are kept.
 */
export function carryForwardEngineFrontmatter(
  existingContent: string,
  nextContent: string,
): string {
  let existing: ReturnType<typeof matter>;
  let next: ReturnType<typeof matter>;
  try {
    existing = matter(existingContent);
    next = matter(nextContent);
  } catch {
    return nextContent;
  }
  const data: Record<string, unknown> = { ...existing.data, ...next.data };
  // The first `generated` is the creation stamp: a fresh one never replaces it.
  if (existing.data.generated != null) data.generated = existing.data.generated;
  // `status` is a lifecycle decision (draft | stable | deprecated): an ingest
  // must not downgrade a page a human set to stable back to draft.
  if (existing.data.status != null) data.status = existing.data.status;
  const sources = mergeSources(existing.data.sources, next.data.sources);
  if (sources.length > 0) data.sources = sources;
  else delete data.sources;
  if (Array.isArray(existing.data.verified) || Array.isArray(next.data.verified)) {
    data.verified = [
      ...(Array.isArray(existing.data.verified) ? existing.data.verified : []),
      ...(Array.isArray(next.data.verified) ? next.data.verified : []),
    ];
  }
  return matter.stringify(next.content, data);
}
