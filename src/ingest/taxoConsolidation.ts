import type { WikiOperation } from '../types.ts';
import type { ConsolidatedPage, ConsolidationPlan } from './consolidationSchema.ts';
import { normalizeProvenanceValue, normalizeTags } from './provenance.ts';
import { sectionSheetPath } from './sectionSheets.ts';
import { sectionSheetSubject } from './sectionSheets.ts';

/*
 Taxo pipeline — the generation core replacing the per-source consolidation.

 Current TAXO mode is section-first: one model call produces one fiche per
 source section (`Description`, `Tags`, body). A tag/family projection may be
 generated later from the fiche inventory; it never decides whether sections
 are the same subject. Calls, cache, apply and provenance stamping stay in
 IngestService.
*/

export type TaxoSection = {
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
  locator: string;
};

export type TaxoRow = {
  row: number;
  source: string;
  heading: string;
  locator: string;
  facts: string;
  description?: string;
  tags?: string[];
  documentTitle?: string;
  inputHash?: string;
  contentHash?: string;
  /** A resolved archive-relative path, never a raw/untracked workspace path. */
  archivePath?: string;
  /** Opaque section locator into the archived Markdown. */
  citationAnchor?: string;
  citationAnchors?: string[];
  sourceRanges?: Array<{ startLine: number; endLine: number }>;
};

export const TAXO_SECTION_SYSTEM = [
  'You are a knowledge management expert. Restructure ONE section into a concept sheet.',
  'Rewrite only what the section states: add no fact, explanation, purpose, role or consequence.',
  'Keep names, codes, numbers, dates and units exactly as written.',
  'Reply ONLY in Markdown, with no introduction or conclusion, starting exactly with:',
  'Description: <faithful summary of the section, at most 3 lines>',
  'Tags: #tag1 #tag2 (2 to 3 lowercase singular tags on DIFFERENT axes: ALWAYS one nature/domain tag saying what the subject IS, in the source language, plus the named entity when the text names one; a third only for a distinct idea; never two tags that say the same thing)',
  'Then write the section body, restructured but never completed.',
].join('\n');

export function buildTaxoSectionUser(docTitle: string, section: TaxoSection): string {
  return `# Document\n## ${docTitle}\n\n# Section\n## ${section.heading}\n\n${section.body.slice(0, 4000)}`;
}

/** Escapes a value for a YAML double-quoted flow scalar — backslashes FIRST,
 * then quotes: the reverse order would re-escape the backslash the
 * quote-escape just inserted, and a lone unescaped backslash (e.g. a pasted
 * Windows path) otherwise leaves the scalar unterminated. */
function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function taxoSheetPath(row: TaxoRow, collisionIndex = 1): string {
  const source = row.archivePath || canonicalArchivePath(row.source);
  return sectionSheetPath(source, row.documentTitle || source.split('/').pop()?.replace(/\.md$/i, '') || 'document', row.heading, collisionIndex);
}

function canonicalArchivePath(value: string): string {
  const normalized = String(value ?? '').replace(/\\/g, '/');
  const marker = normalized.lastIndexOf('raw/ingested/');
  if (marker >= 0) return normalized.slice(marker);
  const untracked = normalized.lastIndexOf('raw/untracked/');
  if (untracked >= 0) return `raw/ingested/${normalized.slice(untracked + 'raw/untracked/'.length)}`;
  return normalized.startsWith('raw/') ? `raw/ingested/${normalized.slice(4)}` : `raw/ingested/${normalized.replace(/^\/+/, '')}`;
}

/** Render the current TAXO contract: one fiche per source section. */
export function taxoSheetContent(row: TaxoRow, generatedAt: string): string {
  const title = row.heading;
  const archivePath = canonicalArchivePath(row.archivePath || row.source);
  const subject = sectionSheetSubject(row.documentTitle || archivePath.split('/').pop()?.replace(/\.md$/i, '') || 'document', row.heading);
  const tags = normalizeTags(row.tags ?? []);
  // The model sometimes reproduces a [src: …] marker from the section it was
  // given. The engine appends the canonical anchored citations below, so a
  // model-authored marker is at best redundant and at worst an unanchored
  // citation the source-page contract refuses. Strip them.
  const facts = row.facts
    .replace(/\[src:\s*[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const citations = (row.citationAnchors?.length ? row.citationAnchors : [row.citationAnchor])
    .filter((anchor): anchor is string => Boolean(anchor))
    .map((anchor) => `[src: ${archivePath}#${anchor.replace(/^#/, '')}]`);
  return [
    '---',
    'type: source',
    `subject: "${escapeYamlDoubleQuoted(subject)}"`,
    `title: "${escapeYamlDoubleQuoted(title)}"`,
    ...(row.description ? [`description: "${escapeYamlDoubleQuoted(row.description)}"`] : []),
    ...(row.inputHash ? [`input_hash: "${escapeYamlDoubleQuoted(row.inputHash)}"`] : []),
    ...(row.contentHash ? [`content_hash: "${escapeYamlDoubleQuoted(row.contentHash)}"`] : []),
    'status: draft',
    'generated:',
    '  by: llm-wiki',
    `  at: '${generatedAt}'`,
    ...(tags.length ? [`tags: [${tags.map((tag) => `"${escapeYamlDoubleQuoted(tag)}"`).join(', ')}]`] : []),
    '---',
    '',
    `# ${title}`,
    '',
    row.description ? `> ${row.description}\n` : '',
    facts,
    '',
    ...(citations.length ? citations : [`[src: ${archivePath}]`]),
    '',
  ].join('\n');
}

export function taxoTagPageContent(
  tag: string,
  family: string,
  ficheLinks: Array<{ title: string; path: string; description?: string }>,
  generatedAt: string,
  conceptId?: string,
  sourcePreviewLimit = 50,
  subjectId?: string,
): string {
  const normalizedTag = normalizeProvenanceValue(tag);
  const title = normalizedTag ? normalizedTag[0]!.toUpperCase() + normalizedTag.slice(1) : 'Tag';
  return [
    '---',
    'type: concept',
    `subject: "${escapeYamlDoubleQuoted(normalizedTag)}"`,
    ...(conceptId ? [`concept_id: "${escapeYamlDoubleQuoted(conceptId)}"`] : []),
    ...(subjectId ? [`subject_id: "${escapeYamlDoubleQuoted(subjectId)}"`] : []),
    `title: "${escapeYamlDoubleQuoted(title)}"`,
    `family: "${escapeYamlDoubleQuoted(family.trim() || 'unfiled')}"`,
    `sheet_count: ${ficheLinks.length}`,
    'status: draft',
    'generated:',
    '  by: llm-wiki-tags',
    `  at: '${generatedAt}'`,
    `tags: ["${escapeYamlDoubleQuoted(normalizedTag)}"]`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Sources',
    '',
    ...ficheLinks.slice(0, sourcePreviewLimit).map((fiche) => `- **${fiche.title}**${fiche.description ? ` — ${fiche.description}` : ''} [src: ${fiche.path}]`),
    ...(ficheLinks.length > sourcePreviewLimit
      ? [`- ${ficheLinks.length - sourcePreviewLimit} additional fiche(s); citations are retained in the page metadata.`,
        '<!-- Additional generated pivot citations (kept for derived sources provenance):',
        ...ficheLinks.slice(sourcePreviewLimit).map((fiche) => `[src: ${fiche.path}]`),
        '-->']
      : []),
    '',
  ].join('\n');
}

/**
 * Creates the section fiches for one source; source-note pages are obsolete
 * in the TAXO model.
 */
export function taxoPlanForSource(rows: TaxoRow[], generatedAt: string): ConsolidationPlan {
  const operations: WikiOperation[] = [];
  const pages: ConsolidatedPage[] = [];
  const usedPaths = new Set<string>();
  let sheetCount = 0;
  for (const row of rows) {
    let path = taxoSheetPath(row);
    if (usedPaths.has(path)) {
      // Two rows of this source resolved to the same (concept, resume) leaf —
      // disambiguate instead of letting the collision reach
      // validateConsolidation's blocking duplicate-path error, which used to
      // fail the WHOLE source over one colliding leaf.
      let suffix = 2;
      let candidate = taxoSheetPath({ ...row, heading: `${row.heading}-${suffix}` });
      while (usedPaths.has(candidate)) {
        suffix += 1;
        candidate = taxoSheetPath({ ...row, heading: `${row.heading}-${suffix}` });
      }
      path = candidate;
    }
    usedPaths.add(path);
    operations.push({ type: 'create', path, content: taxoSheetContent(row, generatedAt) });
    pages.push({
      path,
      subject: normalizeProvenanceValue(row.heading),
      concept_id: null,
      subject_id: null,
      scope: null,
      kind: null,
      tags: normalizeTags(row.tags ?? []),
      rationale: row.description ?? null,
    });
    sheetCount += 1;
  }
  return {
    summary: `${sheetCount} TAXO fiche(s) generated from ${rows.length} section(s).`,
    operations,
    pages,
  };
}
