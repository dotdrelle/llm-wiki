import type { WikiOperation } from '../types.ts';
import type { ConsolidatedPage, ConsolidationPlan } from './consolidationSchema.ts';
import { normalizeProvenanceValue, normalizeTags } from './provenance.ts';
import { createFenceTracker } from '../utils/sourcePacking.ts';

/*
 Taxo pipeline — the generation core replacing the per-source consolidation.

 Two stages:
   1. one extraction call per `#` section of a source -> {concept, resume, facts};
   2. one GLOBAL dedup call over the whole batch's table (plus the existing
      wiki inventory) -> unique non-redundant concepts with kind/scope/
      definition/tags, whose canonical names the leaves inherit.

 A concept stays a folder; a leaf is `<concept>_<resume>.md`. Tags are THEME
 words shared across concepts so the graph's transverse edges connect the
 leaves. Everything here is pure data -> plan mapping; the LLM calls, the
 cache, the apply and the provenance stamping stay in IngestService.
*/

export type TaxoSection = {
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
  locator: string;
};

export function splitIntoSections(markdown: string): TaxoSection[] {
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').split('\n');
  const sections: TaxoSection[] = [];
  let current: TaxoSection | null = null;
  // A `# ` in the first column of a fenced code block is content, not a
  // heading — sourcePacking.ts's splitAtLevel exists specifically to avoid
  // cutting a pack in the middle of a quoted Markdown example; reusing its
  // tracker here avoids re-deciding (and re-fixing) the same bug twice.
  const fenced = createFenceTracker();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const heading = !fenced(line) ? /^#\s+(.+)$/.exec(line) : null;
    if (heading) {
      current = {
        heading: heading[1].trim(),
        body: '',
        startLine: index + 1,
        endLine: index + 1,
        locator: `${index + 1}-${index + 1}`,
      };
      sections.push(current);
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
      current.endLine = index + 1;
      current.locator = `${current.startLine}-${index + 1}`;
    } else {
      current = {
        heading: '(intro)',
        body: line,
        startLine: index + 1,
        endLine: index + 1,
        locator: `${index + 1}-${index + 1}`,
      };
      sections.push(current);
    }
  }
  return sections.filter((section) => section.body.trim().length > 40);
}

export type TaxoRow = {
  row: number;
  source: string;
  heading: string;
  locator: string;
  concept: string;
  resume: string;
  facts: string;
};

export type TaxoConcept = {
  name: string;
  label: string;
  kind: string;
  scope: string;
  definition: string;
  tags: string[];
  covers: number[];
};

export const TAXO_SECTION_SYSTEM = [
  'You extract reusable knowledge candidates from ONE section of a document.',
  'Return strict JSON only: {"concept": string, "resume": string, "facts": string}.',
  '- Identify the referent or theme needed to connect the section facts to related knowledge. Use the words and language of the source as display labels; they are not identity keys.',
  '- Do not create a separate candidate merely because the document has a heading, row, or sub-part. Preserve distinct referents when the source gives them distinct facts.',
  '- If the section contains no reusable information, return empty strings for all three fields.',
  '- Keep names, codes, dates, and other identifiers exactly as written.',
  '- facts: a concise, faithful statement of the information in this section, in the source language.',
].join('\n');

export function buildTaxoSectionUser(docTitle: string, section: TaxoSection): string {
  return `# Document\n## ${docTitle}\n\n# Section\n## ${section.heading}\n\n${section.body.slice(0, 4000)}`;
}

export const TAXO_DEDUP_SYSTEM = [
  'You receive a table of candidates extracted from document sections.',
  'Group rows only when their content supports the same reusable subject or theme. Do not impose a fixed vocabulary or merge distinct referents because they share a label.',
  'Return strict JSON only: {"concepts": [{"name": string, "label": string, "kind": string, "scope": string, "definition": string, "tags": string[], "covers": number[]}]}.',
  '- name: a concise storage label for the grouping. The engine stores a separate opaque identity; the label may be revised or translated.',
  '- label: a readable display label suitable for the workspace. Keep names and codes as written in the sources.',
  '- kind and scope: optional descriptive metadata drawn from the corpus. They are not fixed vocabularies and do not define identity.',
  '- definition: a concise synthesis supported only by the covered rows, in the source language.',
  '- tags: useful retrieval labels grounded in the rows. Do not apply a fixed tag list or language-specific normalization.',
  '- covers: the numbers of all rows represented by this grouping.',
  '- Every row must be covered exactly once; do not invent content absent from the table.',
].join('\n');

export function buildTaxoTable(rows: TaxoRow[]): string {
  return rows
    .map((row) => `${row.row}. concept="${row.concept}" resume="${row.resume}" | ${row.facts.slice(0, 150)}`)
    .join('\n');
}

export function taxoKindForSchema(kind: string): ConsolidatedPage['kind'] {
  const raw = String(kind ?? '').trim();
  return raw || null;
}

export function taxoScopeForSchema(scope: string): ConsolidatedPage['scope'] {
  const raw = String(scope ?? '').trim();
  return raw || null;
}

/**
 * The shared "resume" slug both a leaf's path and its own frontmatter/title
 * derive from — one implementation instead of two independent ones, so they
 * can never disagree. It uses shared Unicode-aware provenance normalization,
 * without language-specific slug rules.
 */
function taxoResumeSlug(resume: string): string {
  return normalizeProvenanceValue(resume) || '0';
}

/** Escapes a value for a YAML double-quoted flow scalar — backslashes FIRST,
 * then quotes: the reverse order would re-escape the backslash the
 * quote-escape just inserted, and a lone unescaped backslash (e.g. a pasted
 * Windows path) otherwise leaves the scalar unterminated. */
function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function taxoLeafPath(concept: string, resume: string): string {
  return `wiki/concepts/${concept}/${concept}_${taxoResumeSlug(resume)}.md`;
}

export function taxoLeafContent(row: TaxoRow, concept: TaxoConcept, generatedAt: string): string {
  const resume = taxoResumeSlug(row.resume);
  const title = `${concept.label ?? concept.name} — ${resume.replace(/-/g, ' ')}`;
  const kind = taxoKindForSchema(concept.kind) ?? 'concept';
  return [
    '---',
    `title: ${title}`,
    `type: ${kind}`,
    `subject: ${resume}`,
    `kind: ${taxoKindForSchema(concept.kind) ?? 'concept'}`,
    `scope: ${taxoScopeForSchema(concept.scope)}`,
    `concept: ${concept.name}`,
    `tags: [${concept.tags.join(', ')}]`,
    'generated:',
    '  by: taxo-pipeline',
    `  at: '${generatedAt}'`,
    'status: draft',
    // No hand-written `sources:` here: IngestService's stampSourceProvenance
    // additively stamps the correctly-shaped { path, usage_count } entry on
    // every operation, unconditionally, right before apply. A second,
    // wrongly-shaped copy here (a raw string, and the wrong pre-archive
    // path) used to get spread as a string during that merge —
    // {...'a string'} produces {0:'a',1:' ',...} — corrupting every leaf.
    `locator: { heading: "${escapeYamlDoubleQuoted(row.heading)}", lines: "${row.locator}" }`,
    `confidence: ${concept.covers.length >= 2 ? 0.9 : 0.6}`,
    '---',
    '',
    `# ${title}`,
    '',
    `> ${concept.definition}`,
    '',
    row.facts,
    '',
    `[src: raw/ingested/${row.source}]`,
    '',
  ].join('\n');
}

/**
 * Maps the global dedup result back onto ONE source: the operations and the
 * provenance pages that source's rows produce. The apply, the provenance
 * stamping and the index regeneration stay untouched downstream.
 */
export function taxoPlanForSource(
  rows: TaxoRow[],
  conceptByRow: Map<number, TaxoConcept>,
  sourcePagePath: string,
  generatedAt: string,
): ConsolidationPlan {
  const operations: WikiOperation[] = [];
  const pages: ConsolidatedPage[] = [];
  const usedPaths = new Set<string>();
  const touchedConcepts = new Set<TaxoConcept>();
  let leafCount = 0;
  // `rows` is already scoped to this one source (by the caller); looking up
  // each row's concept in a map built ONCE for the whole batch keeps this
  // O(rows for this source) instead of rescanning every concept's entire
  // (batch-wide) `covers` array once per source.
  for (const row of rows) {
    const concept = conceptByRow.get(row.row);
    if (!concept) continue;
    touchedConcepts.add(concept);
    let path = taxoLeafPath(concept.name, row.resume);
    if (usedPaths.has(path)) {
      // Two rows of this source resolved to the same (concept, resume) leaf —
      // disambiguate instead of letting the collision reach
      // validateConsolidation's blocking duplicate-path error, which used to
      // fail the WHOLE source over one colliding leaf.
      let suffix = 2;
      let candidate = taxoLeafPath(concept.name, `${row.resume}-${suffix}`);
      while (usedPaths.has(candidate)) {
        suffix += 1;
        candidate = taxoLeafPath(concept.name, `${row.resume}-${suffix}`);
      }
      path = candidate;
    }
    usedPaths.add(path);
    operations.push({ type: 'create', path, content: taxoLeafContent(row, concept, generatedAt) });
    pages.push({
      path,
      subject: path.split('/').pop()?.replace(/\.md$/, '') ?? null,
      concept_id: null,
      subject_id: null,
      scope: taxoScopeForSchema(concept.scope),
      kind: taxoKindForSchema(concept.kind),
      tags: normalizeTags(concept.tags),
      rationale: concept.definition ?? null,
    });
    leafCount += 1;
  }
  // Every row of a source shares its archive path; enforceSourceCitationPath
  // (IngestService) rewrites whatever this names to the canonical archive
  // path regardless — but without a `[src: ...]` bracket to rewrite at all,
  // the source note carried no citation and the "no citation of the ingested
  // source" check fired on every single taxo ingest, unconditionally.
  const citationSource = rows[0]?.source;
  operations.push({
    type: 'create',
    path: sourcePagePath,
    content: [
      '---',
      'type: source',
      'generated:',
      '  by: taxo-pipeline',
      `  at: '${generatedAt}'`,
      'status: draft',
      '---',
      '',
      '# Source note',
      '',
      ...rows.map((row) => `- ${row.heading} — ${row.facts.split('.')[0] ?? row.facts}`.trim()),
      '',
      ...(citationSource ? [`[src: raw/ingested/${citationSource}]`, ''] : []),
    ].join('\n'),
  });
  pages.push({
    path: sourcePagePath,
    subject: sourcePagePath.split('/').pop()?.replace(/\.md$/, '') ?? null,
    concept_id: null,
    subject_id: null,
    scope: null,
    kind: null,
    tags: [],
    rationale: null,
  });
  return {
    summary: `${leafCount} leaf/leaves filed under ${touchedConcepts.size} concept(s).`,
    operations,
    pages,
  };
}
