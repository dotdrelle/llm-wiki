import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

export function buildExportPrompt(
  deliverableContent: string,
  sources: Array<{ path: string; content: string }>,
  ctx: PromptContext,
) {
  const sourcesText = sources
    .map((s) => `## ${s.path}\n\n${s.content.trim()}`)
    .join('\n\n---\n\n');

  return {
    system: [
      buildSystemPreamble(ctx),
      'You expand a deliverable document into a fully self-contained version.',
      'Rules:',
      '- Use ONLY information present in the provided source pages. Do not invent.',
      '- For each section, weave the relevant source details directly into the prose.',
      '- Remove all [src: ...] citation markers from the output.',
      '- Preserve the document structure and heading hierarchy. Translate heading text to the configured target language when needed.',
      '- Write in the configured target language from the system instructions.',
      '- Do not add new sections or headings not present in the original.',
      '- Markdown linting rules: keep a single top-level H1, keep one blank line before and after headings, and do not output raw HTML tags.',
      '- If sources lack enough detail to expand a section, keep the original text and append a blockquote: "> Note: insufficient source documentation to expand this section."',
    ].join('\n'),
    user: [
      '# Source pages',
      '',
      sourcesText,
      '',
      '---',
      '',
      '# Document to expand',
      '',
      deliverableContent.trim(),
      '',
      '---',
      '',
      '# Task',
      'Rewrite the document above as a fully self-contained version.',
      'Replace every [src: ...] citation with detailed inline content from the sources.',
      'Keep the overall structure unchanged and keep the same heading levels.',
      'Use plain Markdown only: no raw HTML, no extra H1 headings, and blank lines around headings.',
    ].join('\n'),
  };
}

export function buildPolishPrompt(markdown: string, ctx: PromptContext) {
  return {
    system: [
      buildSystemPreamble(ctx),
      'You are an editorial reviewer polishing a source-grounded markdown deliverable.',
      'Rules:',
      '- Improve clarity, flow, and readability without changing the meaning.',
      '- Preserve the markdown structure and heading hierarchy. Translate heading text to the configured target language when needed.',
      '- Do not add new factual claims, examples, numbers, dates, names, conclusions, or source citations.',
      '- Markdown linting rules: keep a single top-level H1, keep one blank line before and after headings, and do not output raw HTML tags.',
      '- Do not remove important technical or project-specific details.',
      '- Write in the configured target language from the system instructions.',
      '- Write in a natural, clear voice — as if explaining to a thoughtful colleague. Keep it simple and direct without becoming casual in formal documents.',
      '- Vary sentence length and rhythm: mix short punchy sentences with fuller explanatory ones. Avoid a uniformly smooth or templated cadence.',
      '- Vary sentence openings and reduce repetitive phrasing or keyword repetition unless technically necessary.',
      '- Replace generic connective phrases and boilerplate wording with precise transitions that fit the surrounding content.',
      '- When the document type allows it, use light first- or second-person framing ("we" or "you") to make the prose more direct; avoid this in formal or compliance-style documents.',
      '- Add warmth where appropriate, without clichés or exaggerated emotion.',
      '- Replace semicolons with periods or coordinating words when that improves readability.',
      '- Avoid overusing em dashes; prefer commas, periods, parentheses, or clearer sentence breaks.',
      '- Do not add personal opinions; the document must remain factual and source-grounded.',
      '- For English text only, use common contractions when they sound natural in context.',
      '- For French text only, use natural contractions and everyday phrasing ("c\'est", "j\'ai", "on est"); favor short sentences. Avoid stiff connectors such as "En outre" or "Par conséquent" when the relationship is already clear.',
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
      'Keep the same facts and markdown structure. Use the configured target language.',
      'Use plain Markdown only: no raw HTML, no extra H1 headings, and blank lines around headings.',
    ].join('\n'),
  };
}
