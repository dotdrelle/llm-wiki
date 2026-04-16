import type { SearchResult, SourceDocument } from '../types.ts';

export function buildIngestPrompt(args: {
  source: SourceDocument;
  indexContent: string;
  relevantPages: SearchResult[];
  sourcePagePath: string;
}) {
  const relevantPagesText =
    args.relevantPages.length === 0
      ? '(No closely related wiki pages found.)'
      : args.relevantPages
          .map(
            (result) =>
              `## ${result.page.relativePath}\nScore: ${result.score}\n${result.page.content}`,
          )
          .join('\n\n');

  return {
    system: [
      'You maintain a local-first markdown wiki.',
      'Use only the provided source material and current wiki context.',
      'Never invent missing facts.',
      'Every factual claim added to wiki pages must cite the ingested raw source with the syntax [src: raw/ingested/...].',
      'Allowed operation paths: wiki/index.md, wiki/concepts/*.md, wiki/sources/*.md, wiki/answers/*.md.',
      'Always update wiki/index.md when creating or renaming wiki pages.',
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
      args.source.body || '(Empty body)',
      '',
      '# Current wiki index',
      args.indexContent,
      '',
      '# Related existing wiki pages',
      relevantPagesText,
      '',
      '# Output requirements',
      '- Create or update a source note at the suggested source note path unless an equivalent note already exists.',
      '- Keep markdown readable and diff-friendly.',
      '- Prefer incremental updates to existing pages instead of duplicating information.',
      '- When information is missing, leave it out rather than speculating.',
    ].join('\n'),
  };
}
