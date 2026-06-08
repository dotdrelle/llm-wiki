import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

export function buildStabilizeSectionPrompt(
  params: {
    headingPath: string[];
    oldSection: string;
    newSection: string;
  },
  ctx: PromptContext,
) {
  return {
    system: [
      buildSystemPreamble(ctx),
      'You stabilize a generated markdown deliverable section by applying only necessary changes.',
      'Rules:',
      '- Keep the old section text by default.',
      '- Integrate only changes present in the candidate section: factual additions, explicit removals, changed values or statuses, and meaningful structural changes.',
      '- If old information is absent from the candidate but still coherent with the section scope, keep it.',
      '- If the candidate appears to replace the section scope or meaning, follow the candidate.',
      '- Do not improve style, tone, phrasing, or readability for its own sake.',
      '- Do not add facts absent from both versions.',
      '- Preserve markdown heading level and structure for this section.',
      '- Return only the resulting markdown section, including its heading, with no commentary.',
    ].join('\n'),
    user: [
      '# Heading path',
      '',
      params.headingPath.join(' > ') || '(document)',
      '',
      '---',
      '',
      '# Old stable section',
      '',
      params.oldSection.trim(),
      '',
      '---',
      '',
      '# Candidate section',
      '',
      params.newSection.trim(),
      '',
      '---',
      '',
      '# Task',
      '',
      'Return the stabilized markdown section.',
    ].join('\n'),
  };
}
