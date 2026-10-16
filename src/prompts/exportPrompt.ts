import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/**
 * Prompt versions feed publication receipts. Bump only the operation's version
 * when its prompt changes so a polish edit does not stale unchanged exports.
 */
export const EXPORT_PROMPT_VERSION = 1;
export const POLISH_PROMPT_VERSION = 2;

const POLISH_EDITORIAL_RULES = [
  '- Make the smallest edits that materially improve clarity, precision, or flow. Keep wording that is already clear and effective.',
  '- Prefer concise sentences and active voice when they sound natural. Keep necessary technical terms; explain jargon only when the intended reader needs it.',
  '- Correct grammar, spelling, and punctuation. Improve transitions only where the relationship between ideas needs clarification.',
  '- Infer the audience, purpose, and professional register from the document and section. If they are unclear, preserve the existing tone rather than inventing one.',
  '- Replace vague or weak wording with precise wording supported by the existing text. Do not add facts, examples, numbers, dates, names, sources, conclusions, or obligations.',
  '- Avoid clichés, repeated openings, and formulaic rhetorical patterns. Keep valid reasoning and lists of distinct points when they help the reader.',
  '- Keep lists for steps, options, and compact enumerations when they improve scanning; use prose when it explains relationships or develops an idea.',
  '- Let sentence and paragraph lengths vary naturally. Do not force a length pattern, add first-person voice, or add parenthetical asides unless they improve clarity.',
  '- Do not add personal opinions, emotional color, or decorative language. Preserve the document’s existing voice and level of formality.',
  '- Write in the configured target language from the system instructions.',
];

export interface SectionExportInput {
  headingPath: string[];
  headingText: string;
  markdown: string;
  fragments: Array<{ path: string; heading?: string; content: string }>;
}

export function buildSectionExportPrompt(section: SectionExportInput, ctx: PromptContext) {
  const fragmentsText = section.fragments
    .map(
      (fragment) =>
        `## ${fragment.path}${fragment.heading ? ` — ${fragment.heading}` : ''}\n\n${fragment.content.trim()}`,
    )
    .join('\n\n---\n\n');

  return {
    system: [
      buildSystemPreamble(ctx),
      'You expand ONE section of a deliverable document using the provided source excerpts.',
      'Rules:',
      '- Use ONLY information present in the provided source excerpts. Do not invent.',
      '- Weave the relevant source details directly into the prose of this section.',
      '- Remove all [src: ...] citation markers from the output.',
      '- Return ONLY the body of the section: no heading line, no other sections, no preamble, no explanation.',
      '- Do not add any markdown heading (#, ##, ...) to the output.',
      '- Preserve every factual statement, number, date, identifier, and obligation already present in the current section content.',
      '- Preserve existing tables; you may complete empty cells from the sources but never remove rows or columns.',
      '- Write in the configured target language from the system instructions.',
      '- If the excerpts lack enough detail to expand part of the section, keep the original text for that part and append a blockquote: "> Note: insufficient source documentation to expand this section."',
    ].join('\n'),
    user: [
      '# Source excerpts',
      '',
      fragmentsText || '(none)',
      '',
      '---',
      '',
      `# Section to expand — ${section.headingPath.join(' > ') || section.headingText}`,
      '',
      section.markdown.trim(),
      '',
      '---',
      '',
      '# Task',
      'Rewrite the body of this section as a self-contained version, expanded with the relevant details from the source excerpts.',
      'Keep everything already stated in the section; only add, complete, or clarify.',
      'Return only the section body in plain Markdown, without the heading line and without [src: ...] markers.',
    ].join('\n'),
  };
}

export function buildSectionPolishPrompt(
  headingPath: string[],
  markdown: string,
  ctx: PromptContext,
) {
  return {
    system: [
      buildSystemPreamble(ctx),
      'You are an editorial reviewer polishing ONE section of a source-grounded markdown deliverable.',
      'Rules:',
      '- Preserve every number, date, identifier, and obligation exactly.',
      ...POLISH_EDITORIAL_RULES,
      '- Preserve tables and their rows and columns. Edit only their prose cells.',
      '- Return ONLY the polished body of the section: no heading line, no explanation.',
      '- Do not add any markdown heading (#, ##, ...) to the output.',
    ].join('\n'),
    user: [
      `# Section to polish — ${headingPath.join(' > ')}`,
      '',
      markdown.trim(),
      '',
      '---',
      '',
      '# Task',
      'Return the polished body of this section only, in plain Markdown, without the heading line.',
    ].join('\n'),
  };
}

export function buildPolishPrompt(markdown: string, ctx: PromptContext) {
  return {
    system: [
      buildSystemPreamble(ctx),
      'You are an editorial reviewer polishing a source-grounded markdown deliverable.',
      'Rules:',
      ...POLISH_EDITORIAL_RULES,
      '- Preserve the heading hierarchy and Markdown structures that carry meaning, especially tables and code blocks. A list may become prose only when that makes relationships clearer; keep steps and options as lists.',
      '- Preserve every number, date, identifier, technical detail, and obligation exactly.',
      '- Keep one blank line before and after headings, and do not output raw HTML tags.',
    ].join('\n'),
    user: [
      '# Markdown document to polish',
      '',
      markdown.trim(),
      '',
      '---',
      '',
      '# Task',
      'Return a polished version of the document.',
      'Keep the same meaning, facts, and heading hierarchy. Use the configured target language.',
      'Use plain Markdown only: no raw HTML, no extra H1 headings, and blank lines around headings.',
    ].join('\n'),
  };
}
