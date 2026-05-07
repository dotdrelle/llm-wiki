import type { SearchResult } from '../types.ts';
import { formatContextResult } from './formatContext.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

export function buildQueryPrompt(
  question: string,
  context: SearchResult[],
  maxChunkChars: number,
  ctx: PromptContext,
) {
  const contextText =
    context.length === 0
      ? '(No matching wiki pages were found.)'
      : context.map((r) => formatContextResult(r, maxChunkChars)).join('\n\n');

  return {
    system: [
      buildSystemPreamble(ctx),
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
      '- Answer in the configured target language from the system instructions.',
      '- Prefer concise synthesis over repetition.',
      '- End with a short "Missing information" note if the wiki does not fully answer the question.',
    ].join('\n'),
  };
}
