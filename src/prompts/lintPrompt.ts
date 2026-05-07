import type { WikiPage } from '../types.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

export function buildSemanticLintPrompt(
  indexContent: string,
  pages: WikiPage[],
  ctx: PromptContext,
) {
  return {
    system: [
      buildSystemPreamble(ctx),
      'You review a local markdown wiki for quality issues.',
      'Use only the provided wiki pages.',
      'Return strict JSON with contradictions, missingConcepts, and shallowPages.',
    ].join('\n'),
    user: [
      '# Wiki index',
      indexContent,
      '',
      '# Wiki pages',
      pages
        .map((page) => `## ${page.relativePath}\n${page.content}`)
        .join('\n\n'),
      '',
      '# Required checks',
      '- Contradictions between pages.',
      '- Concepts mentioned repeatedly but lacking a dedicated page.',
      '- Shallow pages that look like placeholders.',
    ].join('\n'),
  };
}
