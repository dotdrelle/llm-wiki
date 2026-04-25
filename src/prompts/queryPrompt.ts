import type { SearchResult } from '../types.ts';
import { MAX_PAGE_CHARS } from './constants.ts';

export function buildQueryPrompt(question: string, context: SearchResult[]) {
  const contextText =
    context.length === 0
      ? '(No matching wiki pages were found.)'
      : context
          .map((result) => {
            const content =
              result.page.content.length > MAX_PAGE_CHARS
                ? `${result.page.content.slice(0, MAX_PAGE_CHARS)}\n...[truncated]`
                : result.page.content;
            return `## ${result.page.relativePath}\nScore: ${result.score}\n${content}`;
          })
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
