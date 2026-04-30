import type { SearchResult, SourceDocument } from '../types.ts';
import { formatContextResult } from './formatContext.ts';

export function buildIngestPrompt(args: {
  source: SourceDocument;
  body: string;
  indexContent: string;
  relevantPages: SearchResult[];
  sourcePagePath: string;
  maxChunkChars: number;
}) {
  const relevantPagesText =
    args.relevantPages.length === 0
      ? '(No closely related wiki pages found.)'
      : args.relevantPages
          .map((r) => formatContextResult(r, args.maxChunkChars))
          .join('\n\n');

  return {
    system: [
      'You maintain a local-first markdown wiki.',
      'Use only the provided source material and current wiki context.',
      'Never invent missing facts.',
      'Every factual claim added to wiki pages must cite the ingested raw source with the syntax [src: raw/ingested/...].',
      'Allowed operation paths: wiki/index.md, wiki/concepts/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Information architecture:',
      '- wiki/sources/*.md are source notes: summarize what one specific ingested document says.',
      '- wiki/concepts/*.md are durable knowledge pages: reusable concepts, systems, actors, requirements, decisions, rules, risks, constraints, workflows, or domain vocabulary.',
      '- When the source introduces or updates durable reusable knowledge, create or update the relevant concept pages under wiki/concepts/.',
      '- Do not put all reusable knowledge only in the source note.',
      '- Do not create concept pages for one-off details that are only useful inside the source note.',
      'Always update wiki/index.md when creating or renaming wiki pages.',
      'Every operation must include an explicit "type" and a full path starting with "wiki/".',
      'For update operations, "content" must be the COMPLETE final file content after the change.',
      'Never use placeholders such as "...", "(Contenu existant)", "(Existing content)", or omission markers in operation content.',
      'Return a strict JSON object with { "summary": string, "operations": WikiOperation[] } and no extra text.',
    ].join('\n'),
    user: [
      `# Source to ingest`,
      `Original path: ${args.source.relativePath}`,
      `Archive citation path after ingest: ${args.source.archiveCitationPath}`,
      `Suggested source note path: ${args.sourcePagePath}`,
      '',
      '## Frontmatter',
      JSON.stringify(args.source.frontmatter, null, 2),
      '',
      '## Body',
      args.body || '(Empty body)',
      '',
      '# Current wiki index',
      args.indexContent,
      '',
      '# Related existing wiki pages',
      relevantPagesText,
      '',
      '# Output requirements',
      '- Create or update a source note at the suggested source note path unless an equivalent note already exists.',
      '- Also create or update concept pages under wiki/concepts/ for reusable knowledge found in the source.',
      '- A good ingest usually creates or updates one source note, zero or more concept pages, and wiki/index.md links for every new page.',
      '- Link concept pages and source notes together when useful.',
      '- Keep markdown readable and diff-friendly.',
      '- Prefer incremental updates to existing pages instead of duplicating information.',
      '- When information is missing, leave it out rather than speculating.',
    ].join('\n'),
  };
}
