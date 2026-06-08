import type { SearchResult, TemplateDocument } from '../types.ts';
import { formatContextResult } from './formatContext.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

export function buildDeliverablePrompt(args: {
  template: TemplateDocument;
  maxChunkChars: number;
  buildContext?: string;
  ctx: PromptContext;
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
              .map((r) => formatContextResult(r, args.maxChunkChars))
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
      buildSystemPreamble(args.ctx),
      'You generate markdown fragments to fill in a document template.',
      'You will receive a list of slots, each with an id, an instruction, and wiki context.',
      'For each slot, write the markdown content that replaces it.',
      'Use only the provided wiki context. Never fabricate facts, names, or numbers.',
      'When context is insufficient, write a short note: "> Missing evidence: the wiki does not contain enough documented information for this section."',
      'Do not repeat headings already present in the template.',
      'Markdown linting rules: do not emit raw HTML tags; do not emit level-1 headings unless the slot explicitly requires a document title; keep one blank line before and after any heading.',
      'Cite factual claims with the provided Context citation path, preferably wiki/concepts/ or wiki/sources/. Do not replace a context page citation with nested raw/ingested citations unless the raw source is the only available evidence.',
      'When sources conflict or describe different decision states, prefer the most recent dated source and explicitly treat older decision-pending notes as superseded.',
      args.buildContext
        ? `Common generation rules from build-context/:\n${args.buildContext}`
        : '',
      `You MUST return ONLY a JSON object with this exact structure — nothing else:`,
      `{ "replacements": [ { "id": "<slot-id>", "content": "<markdown text>" } ] }`,
      `The replacements array must contain exactly one entry per slot id: ${ids}.`,
    ]
      .filter(Boolean)
      .join('\n'),
    user: [
      '# Slots to fill',
      slotsText,
      '',
      '# Output rules',
      '- Return ONLY the JSON object. No explanation, no markdown fence, no extra text.',
      `- The "replacements" array must have exactly ${args.slots.length} item(s) with ids: ${ids}.`,
      '- Each "content" value is a markdown string (use \\n for line breaks inside JSON strings).',
      '- Do not return "content" as an object, array, or nested structure.',
      '- If evidence is missing for a slot, still include it in the array with a short note.',
      '- Avoid raw HTML. Use plain Markdown only. Keep blank lines around headings.',
    ].join('\n'),
  };
}

export function buildSingleSlotDeliverablePrompt(args: {
  template: TemplateDocument;
  maxChunkChars: number;
  buildContext?: string;
  ctx: PromptContext;
  slot: {
    id: string;
    instruction: string;
    headingPath: string[];
    surroundingText: string;
    context: SearchResult[];
  };
}) {
  const context =
    args.slot.context.length === 0
      ? '(No relevant wiki pages found.)'
      : args.slot.context
          .map((r) => formatContextResult(r, args.maxChunkChars))
          .join('\n\n');

  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You generate one markdown fragment to fill one document template slot.',
      'Return only the markdown fragment. Do not return JSON.',
      'Use only the provided wiki context. Never fabricate facts, names, or numbers.',
      'When context is insufficient, write a short note: "> Missing evidence: the wiki does not contain enough documented information for this section."',
      'Do not repeat headings already present in the template.',
      'Markdown linting rules: do not emit raw HTML tags; do not emit level-1 headings unless the slot explicitly requires a document title; keep one blank line before and after any heading.',
      'Cite factual claims with the provided Context citation path, preferably wiki/concepts/ or wiki/sources/. Do not replace a context page citation with nested raw/ingested citations unless the raw source is the only available evidence.',
      'When sources conflict or describe different decision states, prefer the most recent dated source and explicitly treat older decision-pending notes as superseded.',
      args.buildContext
        ? `Common generation rules from build-context/:\n${args.buildContext}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    user: [
      `# Slot ${args.slot.id}`,
      `Instruction: ${args.slot.instruction}`,
      `Heading path: ${args.slot.headingPath.join(' > ') || '(root)'}`,
      'Surrounding template text:',
      args.slot.surroundingText,
      '',
      'Relevant wiki context:',
      context,
      '',
      '# Output rules',
      '- Return only markdown content for this slot.',
      '- No JSON, no markdown fence, no explanation before or after the fragment.',
      '- Avoid raw HTML. Use plain Markdown only. Keep blank lines around headings.',
    ].join('\n'),
  };
}
