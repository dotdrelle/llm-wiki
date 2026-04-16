import type { SearchResult } from '../types.ts';

export function buildQueryPrompt(question: string, context: SearchResult[]) {
  const contextText =
    context.length === 0
      ? '(No matching wiki pages were found.)'
      : context
          .map(
            (result) =>
              `## ${result.page.relativePath}\nScore: ${result.score}\n${result.page.content}`,
          )
          .join('\n\n');

  return {
    system: [
      'You answer questions strictly from a local markdown wiki.',
      'Use only the provided context pages.',
      'Do not invent facts.',
      'When the wiki is missing evidence, say so explicitly.',
      'Use markdown in the final answer.',
      'Cite factual claims with [src: relative/path.md].',
    ].join('\n'),
    user: [
      `# Question`,
      question,
      '',
      '# Context pages',
      contextText,
      '',
      '# Answer requirements',
      '- Answer in the same language as the user question when practical.',
      '- Prefer concise synthesis over repetition.',
      '- End with a short "Missing information" note if the wiki does not fully answer the question.',
    ].join('\n'),
  };
}
