import type { WikiOperation } from '../types.ts';
import type { ConsolidatedPage, ConsolidationPlan } from './consolidationSchema.ts';
import { normalizeTags } from './provenance.ts';

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
  for (let index = 0; index < lines.length; index++) {
    const heading = /^#\s+(.+)$/.exec(lines[index] ?? '');
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
      current.body += (current.body ? '\n' : '') + (lines[index] ?? '');
      current.endLine = index + 1;
      current.locator = `${current.startLine}-${index + 1}`;
    } else {
      current = {
        heading: '(intro)',
        body: lines[index] ?? '',
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
  'You extract domain concepts from ONE section of a document.',
  'Return strict JSON only: {"concept": string, "resume": string, "facts": string}.',
  '- The user message gives you the DOCUMENT title first: use it. If the document is about a specific product, vendor or tool, and the section speaks about that product, then concept = THAT product/vendor/tool name (kebab-case) — never a generic theme when the document is a product study.',
  '- concept: the ONE domain concept this section is about, kebab-case, SINGULAR. If the section is a pure table of contents or an index with no concept of its own, return {"concept": "", "resume": "", "facts": ""}.',
  '- resume: one or two words, kebab-case, summarizing the IDEA of this section about that concept. Never reuse the concept name alone.',
  '- facts: 1-3 sentences, what this section establishes about the concept. In French.',
].join('\n');

export function buildTaxoSectionUser(docTitle: string, section: TaxoSection): string {
  return `# Document\n## ${docTitle}\n\n# Section\n## ${section.heading}\n\n${section.body.slice(0, 4000)}`;
}

export const TAXO_DEDUP_SYSTEM = [
  'You receive a table of candidate concepts extracted section by section from a document corpus.',
  'Your job: output the list of UNIQUE, NON-REDUNDANT concepts, aligned with the OKF conventions below.',
  'Return strict JSON only: {"concepts": [{"name": string, "label": string, "kind": string, "scope": string, "definition": string, "tags": string[], "covers": number[]}]}.',
  '- name: the canonical concept name, kebab-case, SINGULAR, short common-noun phrase. REFUSE generic names that describe a document part, not a concept: "source", "divers", "general", "introduction", "annexe", "sommaire", "index".',
  '- A PRODUCT, VENDOR or TOOL that rows mention MUST remain its own concept — never absorb it into a theme concept.',
  '- label: the human-readable name of the concept (prefLabel), in French, capitalized.',
  '- kind: the NATURE of the subject, exactly one of: vendor | product | requirement | regulation | dimension | scenario | domain | decision | tool. Prefer the most specific that fits.',
  '- scope: source | product | transverse | workspace.',
  '- definition: 2-3 sentences, self-contained, built ONLY from the facts of the covered rows. In French.',
  '- tags: THEME words only — cross-cutting topics that LINK several concepts together for a graph (e.g. securite, souverainete, cout, donnees, integration, certification, tracabilite, reporting). Rules: 2 to 4 tags per concept; a tag MUST apply to at least TWO concepts in your answer; NEVER use a concept name (or another concept name) as a tag; French, singular, kebab-case.',
  '- covers: the numbers of ALL rows that belong to this concept (merge synonyms, near-duplicates, singular/plural, same family).',
  '- every row must be covered exactly once; do not invent concepts absent from the table.',
].join('\n');

export function buildTaxoTable(rows: TaxoRow[]): string {
  return rows
    .map((row) => `${row.row}. concept="${row.concept}" resume="${row.resume}" | ${row.facts.slice(0, 150)}`)
    .join('\n');
}

/**
 * The closed `kind` vocabulary of the extraction contract, with the taxo
 * pipeline's wider vocabulary clamped onto it. `tool` folds into `product`
 * (a tool is a product page); `domain` and `decision` carry no subject
 * nature — their leaves keep the generic OKF `type: concept`.
 */
export function taxoKindForSchema(kind: string): ConsolidatedPage['kind'] {
  const raw = String(kind ?? '').trim();
  if (raw === 'tool') return 'product';
  if (['vendor', 'product', 'requirement', 'regulation', 'dimension', 'scenario'].includes(raw)) {
    return raw as ConsolidatedPage['kind'];
  }
  return null;
}

export function taxoScopeForSchema(scope: string): ConsolidatedPage['scope'] {
  const raw = String(scope ?? '').trim();
  return ['source', 'product', 'transverse', 'workspace'].includes(raw)
    ? raw as ConsolidatedPage['scope']
    : 'product';
}

export function taxoLeafPath(concept: string, resume: string): string {
  const clean = String(resume ?? 'note').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return `wiki/concepts/${concept}/${concept}_${clean}.md`;
}

export function taxoLeafContent(row: TaxoRow, concept: TaxoConcept, generatedAt: string): string {
  const resume = String(row.resume || 'note').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
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
    `sources:`,
    `  - raw/ingested/${row.source}`,
    `locator: { heading: "${row.heading.replace(/"/g, '\\"')}", lines: "${row.locator}" }`,
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
  concepts: TaxoConcept[],
  sourcePagePath: string,
  generatedAt: string,
): ConsolidationPlan {
  const byRow = new Map(rows.map((row) => [row.row, row]));
  const operations: WikiOperation[] = [];
  const pages: ConsolidatedPage[] = [];
  let leafCount = 0;
  for (const concept of concepts) {
    for (const rowNumber of concept.covers ?? []) {
      const row = byRow.get(Number(rowNumber));
      if (!row) continue;
      const path = taxoLeafPath(concept.name, row.resume);
      operations.push({ type: 'create', path, content: taxoLeafContent(row, concept, generatedAt) });
      pages.push({
        path,
        subject: path.split('/').pop()?.replace(/\.md$/, '') ?? null,
        scope: taxoScopeForSchema(concept.scope),
        kind: taxoKindForSchema(concept.kind),
        tags: normalizeTags(concept.tags),
        rationale: concept.definition ?? null,
      });
      leafCount += 1;
    }
  }
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
    ].join('\n'),
  });
  return {
    summary: `${leafCount} leaf/leaves filed under ${concepts.length} concept(s).`,
    operations,
    pages,
  };
}
