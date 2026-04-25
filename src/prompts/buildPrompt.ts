import type { SearchResult, TemplateDocument } from '../types.ts';
import { MAX_PAGE_CHARS } from './constants.ts';

export function buildDeliverablePrompt(args: {
  template: TemplateDocument;
  slots: Array<{
    id: string;
    instruction: string;
    headingPath: string[];
    surroundingText: string;
    context: SearchResult[];
  }>;
}) {
  const slotsText = args.slots
    .map((slot) => {
      const context =
        slot.context.length === 0
          ? '(No relevant wiki pages found.)'
          : slot.context
              .map((result) => {
                const content =
                  result.page.content.length > MAX_PAGE_CHARS
                    ? `${result.page.content.slice(0, MAX_PAGE_CHARS)}\n...[truncated]`
                    : result.page.content;
                return `### ${result.page.relativePath}\nScore: ${result.score}\n${content}`;
              })
              .join('\n\n');

      return [
        `## ${slot.id}`,
        `Instruction: ${slot.instruction}`,
        `Heading path: ${slot.headingPath.join(' > ') || '(root)'}`,
        `Surrounding template text:`,
        slot.surroundingText,
        '',
        'Relevant wiki context:',
        context,
      ].join('\n');
    })
    .join('\n\n');

  const ids = args.slots.map((s) => s.id).join(', ');
  return {
    system: [
      'You generate markdown fragments to fill in a document template.',
      'You will receive a list of slots, each with an id, an instruction, and wiki context.',
      'For each slot, write the markdown content that replaces it.',
      'Use only the provided wiki context. Never fabricate facts, names, or numbers.',
      'When context is insufficient, write a short note: "> Évidence manquante dans le wiki — à compléter."',
      'Do not repeat headings already present in the template.',
      'Cite factual claims with [src: path/to/wiki/page.md].',
      `You MUST return ONLY a JSON object with this exact structure — nothing else:`,
      `{ "replacements": [ { "id": "<slot-id>", "content": "<markdown text>" }, ... ] }`,
      `The replacements array must contain exactly one entry per slot id: ${ids}.`,
    ].join('\n'),
    user: [
      '# Slots to fill',
      slotsText,
      '',
      '# Output rules',
      '- Return ONLY the JSON object. No explanation, no markdown fence, no extra text.',
      `- The "replacements" array must have exactly ${args.slots.length} item(s) with ids: ${ids}.`,
      '- Each "content" value is a markdown string (use \\n for line breaks inside JSON strings).',
      '- If evidence is missing for a slot, still include it in the array with a short note.',
    ].join('\n'),
  };
}
