import type { SourceDocument } from '../types.ts';
import type { SourceExtraction } from '../ingest/extractionSchema.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/** Version du prompt, portée par la clé de cache de consolidation. */
export const CONSOLIDATION_PROMPT_VERSION = 1;

export type ConsolidationInventoryPage = {
  path: string;
  title: string;
  subject: string | null;
  scope: string | null;
  excerpt: string;
};

/*
 Prompt de consolidation : un appel, une source, un plan.

 Le budget conceptuel énoncé ici est un contrôle de QUALITÉ, pas une coupure
 aveugle. Le défaut qu'il corrige est précis : sur cinq études comparatives,
 l'ancien chemin produisait 4 concepts pour l'une et 51 pour une autre, sans que
 rien dans le contenu ne justifie l'écart — seule la découpe des titres le
 séparait. Demander une justification par concept supplémentaire coûte une
 phrase et rend l'écart explicable.
*/
export function buildConsolidationPrompt(args: {
  source: SourceDocument;
  extraction: SourceExtraction;
  sourcePagePath: string;
  existingSourceNote: string | null;
  inventory: ConsolidationInventoryPage[];
  indexContent: string;
  collection: string | null;
  ctx: PromptContext;
}): { system: string; user: string } {
  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You maintain a local-first markdown wiki.',
      'You receive structured findings extracted from ONE source document, already merged across its fragments.',
      'You decide, once, what the wiki should contain for this document.',
      '',
      'Granularity policy:',
      '- exactly one source note per document, at the given source note path',
      '- zero to three NEW concept pages of the document’s own subject, by default',
      '- reuse or update an existing concept page before creating a near-duplicate',
      '- a characteristic that only makes sense for this one document stays in the source note',
      '- more than three new concept pages requires an explicit rationale per extra page',
      '- never create a page for a one-off datum or for a documentary rubric of the source',
      '- never create one page per heading of the source document',
      '',
      'Allowed operation paths: wiki/index.md, wiki/concepts/**/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Every operation must include an explicit "type" and a full path starting with "wiki/".',
      'For create and update operations, "content" is REQUIRED and must be the COMPLETE final file content.',
      'Delete operations must omit "content".',
      'Every factual claim must carry the exact [src: ...] citation path from the user message, copied verbatim.',
      'Never use placeholders such as "...", "(existing content)", or omission markers.',
      'Always update wiki/index.md when creating or renaming pages.',
      '',
      'For every created or updated page, also return an entry in "pages" with its provenance:',
      '- subject: the canonical identity the page belongs to, lowercase, no spaces (the compared subject, not its function)',
      '- collection: the comparative set this document belongs to, when there is one',
      '- scope: source | product | transverse | workspace',
      'Do NOT write these three fields inside the page content; the engine writes them.',
      'Do not copy the free-form "group" field into "subject": a group is a shelf, a subject is an identity.',
      '',
      'Return a strict JSON object with { "summary": string, "operations": WikiOperation[], "pages": [] } and no extra text.',
    ].join('\n'),
    user: [
      '# Source document',
      `[src: ...] citation path (exact — copy verbatim into every citation): ${args.source.archiveCitationPath}`,
      `Title: ${args.source.title}`,
      `Source note path: ${args.sourcePagePath}`,
      args.collection ? `Detected collection: ${args.collection}` : 'Detected collection: (none)',
      '',
      '## Extracted facts',
      args.extraction.facts.length
        ? args.extraction.facts
            .map((fact) => `- ${fact.statement}${fact.subject ? ` [${fact.subject}]` : ''} [src: ${fact.citation}]`)
            .join('\n')
        : '(none)',
      '',
      '## Candidate subjects',
      args.extraction.subjects.length
        ? args.extraction.subjects
            .map((subject) =>
              `- ${subject.id} :: ${subject.label} [scope=${subject.scope} | importance=${subject.importance}]`
              + `\n  why: ${subject.rationale}`
              // Le champ est optionnel côté schéma : le prompt ne doit pas
              // supposer qu'un modèle l'a rempli.
              + (subject.relatedExistingPages?.length
                ? `\n  may extend: ${subject.relatedExistingPages.join(', ')}`
                : ''))
            .join('\n')
        : '(none)',
      args.extraction.mainSubject ? `\nMain subject candidate: ${args.extraction.mainSubject}` : '',
      '',
      '## Candidate relations',
      args.extraction.relations.length
        ? args.extraction.relations.map((relation) => `- ${relation.from} --${relation.kind}--> ${relation.to}`).join('\n')
        : '(none)',
      '',
      '## Existing source note',
      args.existingSourceNote ?? '(none yet)',
      '',
      '## Existing wiki pages that may already cover these subjects',
      args.inventory.length
        ? args.inventory
            .map((page) =>
              `- ${page.path} :: ${page.title}`
              + `${page.subject ? ` [subject=${page.subject}]` : ''}`
              + `${page.scope ? ` [scope=${page.scope}]` : ''}`
              + `\n  ${page.excerpt}`)
            .join('\n')
        : '(none)',
      '',
      '# Current wiki index',
      args.indexContent,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}
