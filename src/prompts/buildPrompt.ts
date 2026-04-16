import type { SearchResult, TemplateDocument } from '../types.ts';

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
              .map(
                (result) =>
                  `### ${result.page.relativePath}\nScore: ${result.score}\n${result.page.content}`,
              )
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

  return {
    system: [
      'You generate markdown fragments for a local-first deliverable template.',
      'Each fragment replaces exactly one [[INSTRUCTION: ...]] token.',
      'Use only provided wiki context.',
      'Never fabricate facts or names.',
      'When context is insufficient, output a short markdown note stating that the wiki lacks enough evidence.',
      'Do not emit headings that already exist in the template unless the instruction explicitly asks for them.',
      'Cite factual claims with [src: relative/path.md].',
      'Return strict JSON as { "replacements": [{ "id": string, "content": string }] } and no extra text.',
    ].join('\n'),
    user: [
      '# Template',
      args.template.content,
      '',
      '# Replacement slots',
      slotsText,
      '',
      '# Output requirements',
      '- Keep fragments stable and readable for clean git diffs.',
      '- Respect the tone implied by the template.',
      '- If evidence is missing, say so plainly instead of guessing.',
    ].join('\n'),
  };
}
