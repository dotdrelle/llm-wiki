import type { SourceDocument } from '../types.ts';
import { buildSystemPreamble, type PromptContext } from './systemPreamble.ts';

/** Prompt version, carried by the extraction cache. */
export const EXTRACTION_PROMPT_VERSION = 8;

/*
 Extraction prompt: read, do not write.

 The prohibitions below are not stylistic precautions. Each corresponds to an
 observed behavior of the previous path, where the same prompt served to read
 and to decide: a page created per document section, a `wiki/index.md` rewritten
 by each pack in parallel, a concept invented to fill what the fragment did not
 say. Removing the ability to write removes the temptation to decide.
*/
export function buildExtractionPrompt(args: {
  source: SourceDocument;
  body: string;
  /** Headings covered by this pack: the context, not a splitting instruction. */
  headingPath: string[];
  packIndex: number;
  packTotal: number;
  ctx: PromptContext;
}): { system: string; user: string } {
  return {
    system: [
      buildSystemPreamble(args.ctx),
      'You read one fragment of one source document and report what it says.',
      'You do not decide what the wiki looks like. Another step does that, once, for the whole document.',
      '',
      'You MUST NOT output any of the following:',
      '- file paths, output paths, or page names of any kind',
      '- create, update or delete operations',
      '- any change to wiki/index.md',
      '- one subject per heading or section of the document',
      '- any subject, fact or relation that is not present in the fragment you were given',
      '',
      'Subject ids are local to this fragment ("s1", "s2", ...). They are not paths and never become paths here.',
      'relations[].from and relations[].to are subject ids, taken verbatim from subjects[]. Never reuse a fact id (E01, ...), an inline label, or a path.',
      'Every relation also declares kind: a short predicate (snake_case, e.g. integrates, depends_on, supports, replaces). The schema requires it; omit the whole relation only if it cannot be expressed cleanly.',
      'Each fact has exactly this shape: {"statement": "the claim as prose", "subject": "s1", "citation": "<the exact citation path>"}. Use statement, not predicate/object/claim. If a fact cannot produce a prose statement, drop the fact.',
      'facts[].subject and mainSubject must also be subject ids declared in subjects[], never a fact id, a label, or a path.',
      'If a relation cannot point at a declared subject id, omit that relation instead of inventing a target.',
      'Declare only referents needed to attach facts and relations. A subject label describes something the document actually discusses; it does not assign a wiki folder or a permanent identity.',
      'Group facts about the same referent under one subject across the fragment, including when they appear in different sections. Do not create a subject for every heading, row, property, or mention.',
      'Keep distinct referents separate when the document gives them distinct information. Do not merge them based only on a shared word or their position in the document.',
      'Preserve names, codes, dates, and identifiers exactly as written. Subject labels are display metadata and may follow the wording of the source; they are not identity keys.',
      'There is no target number of subjects. Include every distinct referent needed to preserve the facts, and avoid candidates that have no attached fact or relation.',
      'A short rationale is optional and should explain the source evidence for the candidate, not classify it into a fixed vocabulary.',
      'Every fact carries the exact citation path given in the user message, copied verbatim.',
      'If a fragment states no durable knowledge, return empty arrays. That is a valid answer.',
      'Return a strict JSON object with { "facts": [], "subjects": [], "relations": [], "mainSubject": string|null } and no extra text.',
    ].join('\n'),
    user: [
      '# Fragment to read',
      `Citation path (exact — copy this verbatim into every fact): ${args.source.archiveCitationPath}`,
      `Document title: ${args.source.title}`,
      args.packTotal > 1
        ? `Fragment ${args.packIndex + 1} of ${args.packTotal}. Other fragments are read separately; do not try to summarize the whole document.`
        : 'This fragment is the whole document.',
      args.headingPath.length ? `Heading path: ${args.headingPath.join(' > ')}` : '',
      '',
      '## Frontmatter',
      JSON.stringify(args.source.frontmatter, null, 2),
      '',
      '## Body',
      args.body || '(Empty body)',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}
