import type { SearchResult, SourceDocument } from '../types.ts';
import { formatContextResult } from './formatContext.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

export function buildIngestPrompt(args: {
  source: SourceDocument;
  body: string;
  indexContent: string;
  relevantPages: SearchResult[];
  sourcePagePath: string;
  maxChunkChars: number;
  ctx: PromptContext;
}) {
  const relevantPagesText =
    args.relevantPages.length === 0
      ? '(No closely related wiki pages found.)'
      : args.relevantPages
          .map((r) => formatContextResult(r, args.maxChunkChars))
          .join('\n\n');

  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You maintain a local-first markdown wiki.',
      'Use only the provided source material and current wiki context.',
      'Never invent missing facts.',
      'Every factual claim added to wiki pages must cite the ingested raw source using the exact [src: ...] citation path provided in the user message — copy it verbatim, do not shorten or alter it.',
      'Allowed operation paths: wiki/index.md, wiki/concepts/**/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Information architecture:',
      '- wiki/sources/*.md are source notes: summarize what one specific ingested document says.',
      '- wiki/concepts/**/*.md are durable knowledge pages: reusable concepts, systems, actors, requirements, decisions, rules, risks, constraints, workflows, or domain vocabulary.',
      '- When the source introduces or updates durable reusable knowledge, create or update the relevant concept pages under wiki/concepts/.',
      '- Put new concept pages in a meaningful subfolder under wiki/concepts/ when a durable domain grouping is clear, for example wiki/concepts/infrastructure/esx.md.',
      '- Concept pages SHOULD include YAML frontmatter with a human-readable "group" field and optional "tags" list. Reuse an existing group when possible; create a new group only when the source introduces a clearly distinct domain.',
      '- Do not put all reusable knowledge only in the source note.',
      '- Do not create concept pages for one-off details that are only useful inside the source note.',
      'Always update wiki/index.md when creating or renaming wiki pages.',
      'Every operation must include an explicit "type" and a full path starting with "wiki/".',
      'For create and update operations, "content" is REQUIRED and must be the COMPLETE final file content after the change.',
      'Markdown linting rules for operation content: keep a single top-level H1 per file, keep one blank line before and after headings, and do not output raw HTML tags.',
      'Delete operations must omit "content".',
      'In operation content, every citation must use the exact citation path from the user message, for example: [src: <exact citation path>].',
      'Never use placeholders such as "...", "(Contenu existant)", "(Existing content)", or omission markers in operation content.',
      'Return a strict JSON object with { "summary": string, "operations": WikiOperation[] } and no extra text.',
    ].join('\n'),
    user: [
      `# Source to ingest`,
      `[src: ...] citation path (exact — copy this verbatim into every [src: ...] tag): ${args.source.archiveCitationPath}`,
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
      '- Convert raw HTML or Confluence storage markup into plain Markdown before writing wiki content.',
      '- Do not copy HTML tags, inline styles, Confluence macros, or escaped markup into wiki pages.',
      '- Use plain Markdown only. Keep exactly one blank line around headings and avoid extra H1 headings.',
      '- Prefer incremental updates to existing pages instead of duplicating information.',
      '- When information is missing, leave it out rather than speculating.',
    ].join('\n'),
  };
}
