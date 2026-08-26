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
 */
export function applyOkfFrontmatter(
  content: string,
  options: { type?: string; title?: string; timestamp?: string },
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
  if (!changed) return content;
  return matter.stringify(parsed.content, data);
}
