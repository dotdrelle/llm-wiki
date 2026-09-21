import { hashText } from '../utils/hash.ts';
import { splitMarkdownSections } from '../utils/markdown.ts';

/*
 * Lot 1 of `plan-provenance-feuilles.md`: the canonical locator layer.
 *
 * The model never invents an offset or a digest. It copies an opaque locator
 * token from a catalogue the engine builds (`section:…` for a heading path,
 * `fragment:…` for a headingless or ambiguous region); the engine materializes
 * the final address (`#Heading > Sub` or `#L12-L20@sha256=…`) afterwards.
 *
 * One codec, shared by the catalogue, the address materialization and the
 * read-side resolution, so the three cannot drift.
 */

const PATH_SEPARATOR = ' > ';

export const LOCATOR_DEFAULT_MAX_ENTRIES = 200;
export const LOCATOR_DEFAULT_MAX_FRAGMENT_CHARS = 4000;
export const LOCATOR_DEFAULT_PREVIEW_CHARS = 160;

export type LocatorKind = 'section' | 'fragment';

export interface ProvenanceLocator {
  /** Opaque, citable token: `section:<path>` or `fragment:<id>`. */
  token: string;
  kind: LocatorKind;
  /** Heading hierarchy (`[]` for a synthetic fragment). */
  headingPath: string[];
  /** One-line excerpt, bounded — data, never an instruction. */
  preview: string;
  /** Characters of the addressed region. */
  size: number;
}

export interface LocatorCatalogue {
  locators: ProvenanceLocator[];
  /** True when the entry ceiling cut the catalogue. */
  truncated: boolean;
}

export interface MaterializedAddress {
  /** Anchor only, without the leading `#`, as stored in `[src: path#anchor]`. */
  anchor: string;
  kind: LocatorKind;
  text: string;
}

export type AnchorResolution =
  | { status: 'resolved'; text: string; headingPath: string[] }
  | { status: 'ambiguous'; matches: string[][] }
  | { status: 'missing' };

/** Percent-encode the characters that would make a component ambiguous. */
export function encodeHeadingComponent(value: string): string {
  return String(value)
    .trim()
    .replace(/%/g, '%25')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23');
}

export function decodeHeadingComponent(value: string): string {
  return String(value)
    .replace(/%3E/gi, '>')
    .replace(/%23/g, '#')
    .replace(/%25/g, '%');
}

export function serializeHeadingPath(parts: string[]): string {
  return parts.map(encodeHeadingComponent).join(PATH_SEPARATOR);
}

export function parseHeadingPath(anchor: string): string[] {
  return String(anchor ?? '')
    .split(PATH_SEPARATOR)
    .map((part) => decodeHeadingComponent(part))
    .filter((part) => part.length > 0);
}

/**
 * Accent- and case-insensitive, whitespace-collapsed comparison key. Distinct
 * from `normalizeHeadingPathKey` (which the graph uses and keeps verbatim): a
 * citation matches a heading a human would call the same.
 */
export function normalizeHeadingText(value: string): string {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHeadingPath(parts: string[]): string {
  return parts.map(normalizeHeadingText).join(PATH_SEPARATOR);
}

function splitFrontmatter(markdown: string): { body: string; bodyStartLine: number } {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return { body: normalized, bodyStartLine: 1 };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { body: normalized, bodyStartLine: 1 };
  const closeEnd = normalized.indexOf('\n', end + 4);
  if (closeEnd < 0) return { body: '', bodyStartLine: normalized.split('\n').length };
  const prefix = normalized.slice(0, closeEnd + 1);
  return { body: normalized.slice(closeEnd + 1), bodyStartLine: prefix.split('\n').length };
}

interface RawFragment {
  id: string;
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Deterministic fragmentation of a document body: paragraphs grouped up to a
 * character ceiling, line spans recorded for the final `#L…` address. Same
 * input, same ids, same spans — the address can always be recomputed.
 */
function splitFragments(bodyStartLine: number, body: string, maxChars: number): RawFragment[] {
  const lines = body.split('\n');
  const blocks: Array<{ text: string; startLine: number; endLine: number }> = [];
  let buffer: string[] = [];
  let start = -1;
  const flush = (endLine: number) => {
    if (buffer.length === 0) return;
    blocks.push({ text: buffer.join('\n'), startLine: bodyStartLine + start, endLine: bodyStartLine + endLine });
    buffer = [];
    start = -1;
  };
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      flush(index - 1);
      return;
    }
    if (start < 0) start = index;
    buffer.push(line);
  });
  flush(lines.length - 1);

  const fragments: RawFragment[] = [];
  let current: { text: string; startLine: number; endLine: number } | null = null;
  for (const block of blocks) {
    if (current && current.text.length + block.text.length + 2 > maxChars) {
      fragments.push({ id: `f-${String(fragments.length + 1).padStart(3, '0')}`, ...current });
      current = null;
    }
    current = current
      ? { text: `${current.text}\n\n${block.text}`, startLine: current.startLine, endLine: block.endLine }
      : { text: block.text, startLine: block.startLine, endLine: block.endLine };
  }
  if (current) fragments.push({ id: `f-${String(fragments.length + 1).padStart(3, '0')}`, ...current });
  return fragments;
}

function preview(text: string, maxChars: number): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

/**
 * The catalogue the model is allowed to cite from. A heading path is offered
 * only when its FULL normalized path is unique in the document; a path that
 * repeats falls back to synthetic fragments, so a token is never ambiguous.
 */
export function buildLocatorCatalogue(
  markdown: string,
  options: { maxEntries?: number; maxFragmentChars?: number; previewChars?: number } = {},
): LocatorCatalogue {
  const maxEntries = options.maxEntries ?? LOCATOR_DEFAULT_MAX_ENTRIES;
  const maxFragmentChars = options.maxFragmentChars ?? LOCATOR_DEFAULT_MAX_FRAGMENT_CHARS;
  const previewChars = options.previewChars ?? LOCATOR_DEFAULT_PREVIEW_CHARS;

  const { sections } = splitMarkdownSections(markdown);
  const counts = new Map<string, number>();
  for (const section of sections) {
    if (!section.headingText) continue;
    const key = normalizeHeadingPath(section.headingPath);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const locators: ProvenanceLocator[] = [];
  let truncated = false;
  const push = (locator: ProvenanceLocator): boolean => {
    if (locators.length >= maxEntries) {
      truncated = true;
      return false;
    }
    locators.push(locator);
    return true;
  };

  for (const section of sections) {
    if (!section.headingText) continue;
    const key = normalizeHeadingPath(section.headingPath);
    if ((counts.get(key) ?? 0) > 1) continue; // ambiguous path -> fragments only
    if (!push({
      token: `section:${serializeHeadingPath(section.headingPath)}`,
      kind: 'section',
      headingPath: section.headingPath,
      preview: preview(section.markdown, previewChars),
      size: section.markdown.length,
    })) break;
  }

  // A headingless document, or one whose full paths repeat, must still be
  // citable: synthetic fragments cover the whole body so no region is lost.
  const hasAmbiguousPath = [...counts.values()].some((count) => count > 1);
  if (sections.length === 0 || hasAmbiguousPath) {
    const { body, bodyStartLine } = splitFrontmatter(markdown);
    for (const fragment of splitFragments(bodyStartLine, body, maxFragmentChars)) {
      if (!push({
        token: `fragment:${fragment.id}`,
        kind: 'fragment',
        headingPath: [],
        preview: preview(fragment.text, previewChars),
        size: fragment.text.length,
      })) break;
    }
  }

  return { locators, truncated };
}

/** Recompute the terminal address of a catalogue token. */
/**
 * A model may percent-encode the token it copies (spaces as `%20`, `>` as
 * `%3E`). Decode tolerantly: a malformed `%` sequence is kept literal rather
 * than throwing.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function materializeLocator(
  markdown: string,
  token: string,
  options: { maxFragmentChars?: number } = {},
): MaterializedAddress | null {
  const maxFragmentChars = options.maxFragmentChars ?? LOCATOR_DEFAULT_MAX_FRAGMENT_CHARS;
  const value = String(token ?? '');
  if (value.startsWith('section:')) {
    const serialized = value.slice('section:'.length);
    const parts = parseHeadingPath(safeDecode(serialized));
    if (parts.length === 0) return null;
    const wanted = normalizeHeadingPath(parts);
    const { sections } = splitMarkdownSections(markdown);
    const matches = sections.filter((section) => section.headingText && normalizeHeadingPath(section.headingPath) === wanted);
    if (matches.length !== 1) return null;
    return { anchor: serializeHeadingPath(parts), kind: 'section', text: matches[0].markdown };
  }
  if (value.startsWith('fragment:')) {
    const id = value.slice('fragment:'.length);
    const { body, bodyStartLine } = splitFrontmatter(markdown);
    const fragment = splitFragments(bodyStartLine, body, maxFragmentChars).find((entry) => entry.id === id);
    if (!fragment) return null;
    return {
      anchor: `L${fragment.startLine}-${fragment.endLine}@sha256=${hashText(fragment.text)}`,
      kind: 'fragment',
      text: fragment.text,
    };
  }
  return null;
}

const FRAGMENT_ANCHOR = /^L(\d+)-(\d+)@sha256=([0-9a-f]{64})$/;

/**
 * Resolve a synthetic fragment anchor (`L42-L57@sha256=…`) by recomputing the
 * document's fragments with the SAME rule that materialized it, and matching
 * the address. A fragment that cannot be recomputed identically is missing —
 * never silently widened.
 */
function resolveFragmentAnchor(markdown: string, anchor: string): AnchorResolution {
  const match = FRAGMENT_ANCHOR.exec(anchor.trim());
  if (!match) return { status: 'missing' };
  const start = Number(match[1]);
  const end = Number(match[2]);
  const { body, bodyStartLine } = splitFrontmatter(markdown);
  const fragment = splitFragments(bodyStartLine, body, LOCATOR_DEFAULT_MAX_FRAGMENT_CHARS)
    .find((entry) => entry.startLine === start && entry.endLine === end);
  if (!fragment) return { status: 'missing' };
  if (hashText(fragment.text) !== match[3]) return { status: 'missing' };
  return { status: 'resolved', text: fragment.text, headingPath: [] };
}

/**
 * Read-side resolution. A synthetic fragment (`L…@sha256=…`) is recomputed; a
 * single-component anchor matches a heading TEXT and is resolved only when
 * unique; a multi-component anchor matches a full path. An ambiguous or missing
 * anchor is reported, never silently widened.
 */
export function resolveAnchor(markdown: string, anchor: string): AnchorResolution {
  if (FRAGMENT_ANCHOR.test(String(anchor ?? '').trim())) {
    return resolveFragmentAnchor(markdown, anchor);
  }
  const parts = parseHeadingPath(anchor);
  if (parts.length === 0) return { status: 'missing' };
  const { sections } = splitMarkdownSections(markdown);
  const candidates = parts.length === 1
    ? sections.filter((section) => section.headingText && normalizeHeadingText(section.headingText) === normalizeHeadingText(parts[0]))
    : sections.filter((section) => section.headingText && normalizeHeadingPath(section.headingPath) === normalizeHeadingPath(parts));
  if (candidates.length === 0) return { status: 'missing' };
  if (candidates.length > 1) return { status: 'ambiguous', matches: candidates.map((section) => section.headingPath) };
  return { status: 'resolved', text: candidates[0].markdown, headingPath: candidates[0].headingPath };
}
