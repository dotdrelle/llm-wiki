import { normalizeProvenanceValue } from './provenance.ts';
import { slugify } from '../utils/path.ts';
import { stripTitleMarkup } from '../utils/pageTitle.ts';

export interface SectionRange {
  startLine: number;
  endLine: number;
}

export interface SectionSheetUnit {
  title: string;
  parent: string;
  body: string;
  sourceRanges: SectionRange[];
  sectionIndex: number;
}

export interface TaxoSheetExtraction {
  description: string;
  tags: string[];
  body: string;
}

export interface SectionSheetOptions {
  minSectionChars?: number;
  minContentChars?: number;
  /** A `#` section larger than this is split at its `##` sub-headings. */
  maxSectionChars?: number;
}

const DEFAULT_MIN_SECTION_CHARS = 40;
const DEFAULT_MIN_CONTENT_CHARS = 40;
const DEFAULT_MAX_SECTION_CHARS = 8000;

function stripNumberPrefix(value: string): string {
  // Emphasis first: a heading written `**5.5.Vue physique**` starts with `**`,
  // so the number-prefix pattern never matched and the fiche kept both the
  // asterisks and its outline number.
  const text = stripTitleMarkup(value);
  const stripped = text
    .replace(/^\d{1,3}(?:\.\d{1,3})*(?:[.)]|\s+(?:[-–—:]\s*)?)\s*/, '')
    .trim();
  return stripped && !/^\d/.test(stripped) ? stripped : text;
}

function substantiveText(value: string): string {
  return value
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, ' ')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, ' ')
    .replace(/^\s*>\s?/gm, ' ')
    .replace(/[|`*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A heading made only of in-page anchor links is a table of contents, not a
 * section: Confluence's TOC macro exports as `## - [](#x) - [1. Objet](#y) …`.
 * Taken as a heading it titled the fiche (and named its file) with the whole
 * outline, so it is dropped instead — the sections it lists follow anyway.
 */
function isNavigationHeading(text: string): boolean {
  if (!/\[[^\]]*\]\(#[^)]*\)/.test(text)) return false;
  return text.replace(/\[[^\]]*\]\(#[^)]*\)/g, ' ').replace(/[-*+•·|>\s]/g, '') === '';
}

function removeFrontmatter(lines: string[]): { lines: string[]; offset: number } {
  if (lines[0] !== '---') return { lines, offset: 0 };
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing < 0) return { lines, offset: 0 };
  return { lines: lines.slice(closing + 1), offset: closing + 1 };
}

function rangesFor(unit: SectionSheetUnit): SectionRange[] {
  return unit.sourceRanges.map((range) => ({ ...range }));
}

function mergeUnits(units: SectionSheetUnit[], minSectionChars: number): SectionSheetUnit[] {
  const output: SectionSheetUnit[] = [];
  let pending: SectionSheetUnit | null = null;

  for (const unit of units) {
    if (unit.body.length >= minSectionChars) {
      if (pending) {
        output.push({
          ...unit,
          body: `${pending.body}\n\n## ${pending.title}\n\n${unit.body}`,
          sourceRanges: [...rangesFor(pending), ...rangesFor(unit)],
        });
        pending = null;
      } else {
        output.push({ ...unit, sourceRanges: rangesFor(unit) });
      }
      continue;
    }

    if (output.length > 0) {
      const previous = output[output.length - 1]!;
      previous.body = `${previous.body}\n\n## ${unit.title}\n\n${unit.body}`;
      previous.sourceRanges.push(...rangesFor(unit));
    } else if (pending) {
      pending.body = `${pending.body}\n\n## ${unit.title}\n\n${unit.body}`;
      pending.sourceRanges.push(...rangesFor(unit));
    } else {
      pending = { ...unit, sourceRanges: rangesFor(unit) };
    }
  }

  if (pending) output.push(pending);
  return output.map((unit, index) => ({ ...unit, sectionIndex: index }));
}

/**
 * Split an archived Markdown document into TAXO section units.
 *
 * This function is deliberately LLM-free. It preserves exact source line
 * ranges before any rewriting or small-section merge, so the writer can later
 * materialize anchored provenance without searching generated text.
 */
export function extractSectionSheets(
  content: string,
  documentTitle: string,
  options: SectionSheetOptions = {},
): SectionSheetUnit[] {
  const minSectionChars = options.minSectionChars ?? DEFAULT_MIN_SECTION_CHARS;
  const minContentChars = options.minContentChars ?? DEFAULT_MIN_CONTENT_CHARS;
  const maxSectionChars = options.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const normalized = content.replace(/\r\n?/g, '\n');
  const { lines, offset } = removeFrontmatter(normalized.split('\n'));
  const units: SectionSheetUnit[] = [];
  let current: SectionSheetUnit | null = null;
  let inFence = false;
  const preamble: string[] = [];
  let preambleStart = offset + 1;

  const flush = (endLine: number) => {
    if (!current) return;
    const body = current.body.trim();
    if (substantiveText(body).length > 0) {
      units.push({ ...current, body, sourceRanges: [{ ...current.sourceRanges[0]!, endLine }] });
    }
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const absoluteLine = offset + index + 1;
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      inFence = !inFence;
      if (current) current.body += `${current.body ? '\n' : ''}${line}`;
      else preamble.push(line);
      continue;
    }

    // Split on `#` only: `##`, `###`… stay inside their document's section
    // (the model restructures them; the H1 section is the citable unit).
    const heading = !inFence ? /^#\s+(.+?)\s*$/.exec(line) : null;
    if (heading && isNavigationHeading(heading[1]!)) continue;
    if (!heading) {
      if (current) current.body += `${current.body ? '\n' : ''}${line}`;
      else {
        if (preamble.length === 0) preambleStart = absoluteLine;
        preamble.push(line);
      }
      continue;
    }

    if (current) flush(absoluteLine - 1);
    const title = stripNumberPrefix(heading[1]!);
    current = {
      title,
      parent: '',
      body: '',
      sourceRanges: [{ startLine: absoluteLine, endLine: absoluteLine }],
      sectionIndex: units.length,
    };
  }

  if (current) flush(offset + lines.length);
  const preambleBody = preamble.join('\n').trim();
  if (substantiveText(preambleBody).length > 0) {
    units.unshift({
      title: stripNumberPrefix(documentTitle) || '(intro)',
      parent: '',
      body: preambleBody,
      sourceRanges: [{ startLine: preambleStart, endLine: preambleStart + preamble.length - 1 }],
      sectionIndex: 0,
    });
  }

  return mergeUnits(splitOversizedUnits(units, lines, offset, maxSectionChars), minSectionChars)
    .filter((unit) => substantiveText(unit.body).length >= minContentChars);
}

/**
 * Consolidation by default, precision as the exception: a `#` section is the
 * unit, but a section larger than `maxSectionChars` is split at its `##`
 * sub-headings so one fiche never swallows a whole document. The content
 * before the first `##` is prepended to the first child; each child keeps its
 * exact line range so its citation can be anchored.
 */
function splitOversizedUnits(
  units: SectionSheetUnit[],
  lines: string[],
  offset: number,
  maxSectionChars: number,
): SectionSheetUnit[] {
  const out: SectionSheetUnit[] = [];
  for (const unit of units) {
    if (unit.body.length <= maxSectionChars) {
      out.push(unit);
      continue;
    }
    const start = unit.sourceRanges[0]?.startLine ?? 1;
    const end = unit.sourceRanges[unit.sourceRanges.length - 1]?.endLine ?? start;
    const from = start - offset - 1;
    const to = Math.min(end - offset, lines.length);
    const children: Array<{ title: string; body: string[]; startLine: number; endLine: number }> = [];
    const preamble: string[] = [];
    let current: { title: string; body: string[]; startLine: number; endLine: number } | null = null;
    let inFence = false;
    for (let index = from; index < to; index += 1) {
      const line = lines[index] ?? '';
      const absoluteLine = offset + index + 1;
      const fence = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        inFence = !inFence;
        if (current) {
          current.body.push(line);
          current.endLine = absoluteLine;
        } else preamble.push(line);
        continue;
      }
      const heading = !inFence ? /^##\s+(.+?)\s*$/.exec(line) : null;
      if (heading && isNavigationHeading(heading[1]!)) continue;
      if (heading) {
        if (current) children.push(current);
        current = { title: stripNumberPrefix(heading[1]!), body: [], startLine: absoluteLine, endLine: absoluteLine };
        continue;
      }
      if (current) {
        current.body.push(line);
        current.endLine = absoluteLine;
      } else {
        preamble.push(line);
      }
    }
    if (current) children.push(current);
    const lead = preamble.join('\n').trim();
    if (children.length === 0) {
      out.push(unit);
      continue;
    }
    if (lead) {
      const first = children[0]!;
      first.body.unshift(lead, '');
      if (first.startLine > start + 1) first.startLine = start + 1;
    }
    let nextIndex = out.length;
    for (const child of children) {
      const body = child.body.join('\n').trim();
      if (!body) continue;
      out.push({
        title: child.title,
        parent: unit.title,
        body,
        sourceRanges: [{ startLine: child.startLine, endLine: child.endLine }],
        sectionIndex: nextIndex,
      });
      nextIndex += 1;
    }
  }
  return out;
}

export function sectionSheetSubject(documentTitle: string, sectionTitle: string): string {
  return normalizeProvenanceValue(`${documentTitle}-${sectionTitle}`);
}

export function sectionSheetPath(
  archiveRelativePath: string,
  documentTitle: string,
  sectionTitle: string,
  collisionIndex = 1,
): string {
  const archive = archiveRelativePath.replace(/^raw\/ingested\//, '').replace(/\.md$/i, '');
  const parts = archive.split('/');
  const documentSlug = slugify(parts.pop() || documentTitle) || 'document';
  const sectionSlug = slugify(sectionTitle) || 'section';
  const suffix = collisionIndex > 1 ? `-${collisionIndex}` : '';
  const directory = parts
    .filter(Boolean)
    .map((part) => slugify(part) || '_')
    .filter((part, index, all) => index === 0 || part !== all[index - 1])
    .join('/');
  return `wiki/sources/${directory ? `${directory}/` : ''}${documentSlug}/${sectionSlug}${suffix}.md`;
}

const DESCRIPTION_RE = /^\s*>?\s*\*{0,2}Description\s*\*{0,2}\s*[:\-–—]\s*(.*)$/iu;
const TAGS_RE = /^\s*>?\s*\*{0,2}Tags\s*\*{0,2}\s*[:\-–—]\s*(.*)$/iu;
const HASHTAG_RE = /#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/** Parse the deliberately small Markdown contract emitted by the TAXO model. */
export function parseTaxoSheet(text: string, maxTags = 3): TaxoSheetExtraction {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tags: string[] = [];
  const seen = new Set<string>();
  const body: string[] = [];
  let description = '';
  let inHeader = true;
  const addTag = (value: string) => {
    const tag = normalizeProvenanceValue(value.replace(/^#+/, ''));
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    tags.push(tag);
  };
  for (const line of lines) {
    const descriptionMatch = line.match(DESCRIPTION_RE);
    if (inHeader && descriptionMatch) {
      description = descriptionMatch[1]!.trim();
      continue;
    }
    const tagsMatch = line.match(TAGS_RE);
    if (inHeader && tagsMatch) {
      const values = [...tagsMatch[1]!.matchAll(HASHTAG_RE)].map((match) => match[1]!);
      (values.length > 0 ? values : tagsMatch[1]!.split(/[,;|]+/)).forEach(addTag);
      continue;
    }
    if (inHeader && line.trim() === '') continue;
    inHeader = false;
    body.push(line);
  }
  return {
    description: description.trim(),
    tags: tags.slice(0, Math.max(0, maxTags)),
    body: body.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}
