/*
 Packing a source into ingestion batches.

 The previous splitting cut at each `##`, then at each `###` of a block that was
 still too large, and never re-packed. The granularity produced therefore
 depended on the document's formatting rather than its volume: measured on a
 real corpus, one document (14,868 characters) yielded twelve calls while a
 longer sibling (19,838) yielded five. Editorially sibling documents received a very different
 number of LLM decisions, and the resulting imbalance of concepts was then read
 as a difference of richness.

 The planner below is PURE — same input, same plan — because `wiki doctor` must
 announce exactly what ingestion will execute. Two estimates computed any other
 way would be worse than no estimate at all.
*/

/** Why this pack exists: it is what the diagnostics must be able to explain. */
export type PackReason =
  /** The whole source fits in a single pack. */
  | 'whole'
  /** Several adjacent sections gathered up to the limit. */
  | 'packed'
  /** A whole `##` section. */
  | 'section'
  /** A `###` subsection of an oversized section. */
  | 'subsection'
  /** Paragraphs of an even larger subsection. */
  | 'paragraph'
  /** An indivisible block larger than the limit: truncated, and said. */
  | 'atomic';

export type SourcePack = {
  /** Text exactly as it will go to the prompt, prefixes included. */
  text: string;
  chars: number;
  /** Covered heading path, from the document's `#` down to the last included heading. */
  headingPath: string[];
  reason: PackReason;
  truncated: boolean;
};

export type SourcePackDiagnostics = {
  normalizedChars: number;
  headings: number;
  packs: number;
  packChars: number[];
  truncatedBlocks: number;
  reasons: Partial<Record<PackReason, number>>;
  maxChars: number;
  /** Budget consumed by the prompt envelope, excluding the source text. */
  overhead: number;
};

export type SourcePackPlan = {
  packs: SourcePack[];
  diagnostics: SourcePackDiagnostics;
};

/**
 * Indivisible unit of the plan: a body, and the headings that give it meaning.
 *
 * Separating the two is what allows both re-packing — several units in one
 * pack — and preserving context: a unit taken from the middle of a section
 * stays preceded by its headings, otherwise the fragment sent to the model
 * would talk about nothing.
 */
type Atom = {
  headingLines: string[];
  body: string;
  reason: Exclude<PackReason, 'whole' | 'packed'>;
};

const TRUNCATION_SUFFIX = '\n...[section truncated]';

/** Potential opening or closing: the character and its length. */
function fenceMarker(line: string): { char: '`' | '~'; length: number } | null {
  const match = /^(`{3,}|~{3,})/.exec(line.trim());
  return match ? { char: match[1]![0] as '`' | '~', length: match[1]!.length } : null;
}

/**
 * State tracking of code blocks, backticks **or** tildes.
 *
 * CommonMark accepts both, and `~~~` is the usual fallback when the block
 * itself contains backticks — therefore precisely in documents that quote
 * Markdown, the ones where an example `##` is most likely.
 *
 * A block only closes with the SAME character, at least as long: a `~~~`
 * encountered inside a block opened by ``` is content, and counting it as a
 * closing would reopen the door we just closed.
 */
function createFenceTracker(): (line: string) => boolean {
  let open: { char: '`' | '~'; length: number } | null = null;
  return (line: string): boolean => {
    const marker = fenceMarker(line);
    if (!marker) return open !== null;
    if (!open) {
      open = marker;
      return true;
    }
    if (marker.char === open.char && marker.length >= open.length) open = null;
    return true;
  };
}

/**
 * Splits at a heading level, **outside code blocks**.
 *
 * A `## ` in the first column of a `~~~` block is text, not a heading.
 * Cutting on it produced a pack starting in the middle of an example and
 * another whose block closing no longer existed.
 */
function splitAtLevel(lines: string[], level: number): Array<{ heading: string | null; lines: string[] }> {
  const marker = `${'#'.repeat(level)} `;
  const blocks: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  const fenced = createFenceTracker();

  for (const line of lines) {
    if (fenced(line)) {
      current.lines.push(line);
      continue;
    }
    if (line.startsWith(marker)) {
      if (current.heading !== null || current.lines.some((item) => item.trim())) blocks.push(current);
      current = { heading: line.trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.heading !== null || current.lines.some((item) => item.trim())) blocks.push(current);
  return blocks;
}

/** Paragraphs separated by a blank line, code blocks kept whole. */
function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const fenced = createFenceTracker();

  for (const line of text.split('\n')) {
    if (fenced(line)) {
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      if (current.length) paragraphs.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(current.join('\n').trim());
  return paragraphs.filter(Boolean);
}

function render(titlePrefix: string, atoms: Atom[]): string {
  const parts: string[] = [];
  let emitted: string[] = [];
  for (const atom of atoms) {
    // Headings already written by the previous unit are not repeated: the
    // budget must pay for context once, not once per paragraph.
    const missing = atom.headingLines.filter((line, index) => emitted[index] !== line);
    if (missing.length) parts.push(missing.join('\n'));
    if (atom.body) parts.push(atom.body);
    emitted = atom.headingLines;
  }
  return `${titlePrefix}${parts.join('\n\n')}`.trim();
}

function truncate(body: string, budget: number): string {
  if (budget <= TRUNCATION_SUFFIX.length) return body.slice(0, Math.max(0, budget));
  return `${body.slice(0, budget - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}`;
}

/**
 * Builds the units of a section, descending only as needed.
 *
 * `##` first, `###` only for an oversized section, paragraphs only for an even
 * larger subsection. Descending earlier would multiply calls without gaining
 * anything; descending later would force truncating perfectly splittable text.
 */
function atomsFor(
  headingLines: string[],
  lines: string[],
  fits: (atoms: Atom[]) => boolean,
  level: number,
  reason: Atom['reason'],
): Atom[] {
  const body = lines.join('\n').trim();
  const whole: Atom = { headingLines, body, reason };
  if (!body || fits([whole])) return [whole];

  if (level <= 6) {
    const blocks = splitAtLevel(lines, level);
    const headed = blocks.filter((block) => block.heading !== null);
    /*
     A single headed block still advances the descent: its heading enters the
     context and the next level is examined. Requiring two blocks let a single
     oversized section fall straight into paragraph splitting — which then
     separated its own heading from its body.
    */
    if (headed.length > 0) {
      return blocks.flatMap((block) => atomsFor(
        block.heading ? [...headingLines, block.heading] : headingLines,
        block.lines,
        fits,
        level + 1,
        block.heading ? (level >= 3 ? 'subsection' : 'section') : reason,
      ));
    }
  }

  const paragraphs = splitParagraphs(body);
  if (paragraphs.length > 1) {
    return paragraphs.map((paragraph) => ({ headingLines, body: paragraph, reason: 'paragraph' }));
  }
  // Genuinely indivisible block: truncation is the last resort, and it is
  // flagged rather than suffered.
  return [{ headingLines, body, reason: 'atomic' }];
}

/**
 * Packing plan for one source.
 *
 * `maxChars` is the limit of the text sent; `overhead` reserves what the prompt
 * envelope already consumes. Measuring on the rendered text — title prefix and
 * context headings included — is what guarantees that the announced limit is
 * the one that applies.
 */
export function planSourcePacks(
  content: string,
  options: { maxChars: number; overhead?: number },
): SourcePackPlan {
  const overhead = Math.max(0, options.overhead ?? 0);
  const budget = Math.max(1, options.maxChars - overhead);

  const normalized = content.replace(/\r\n?/g, '\n').trim();
  const titleMatch = /^(# .+?)(?:\n|$)/.exec(normalized);
  const titlePrefix = titleMatch ? `${titleMatch[1]}\n\n` : '';
  const documentTitle = titleMatch ? titleMatch[1].replace(/^#\s+/, '').trim() : null;
  const body = titleMatch ? normalized.slice(titleMatch[0].length).trim() : normalized;

  // Counted outside code blocks, like the splitting itself: a diagnostic that
  // counted an example `##` would announce cuts that will never happen.
  const headings = ((): number => {
    const fenced = createFenceTracker();
    let count = 0;
    for (const line of body.split('\n')) {
      if (!fenced(line) && /^#{1,6}\s+\S/.test(line)) count += 1;
    }
    return count;
  })();
  const diagnostics = (packs: SourcePack[]): SourcePackDiagnostics => ({
    normalizedChars: normalized.length,
    headings,
    packs: packs.length,
    packChars: packs.map((pack) => pack.chars),
    truncatedBlocks: packs.filter((pack) => pack.truncated).length,
    reasons: packs.reduce<Partial<Record<PackReason, number>>>((acc, pack) => {
      acc[pack.reason] = (acc[pack.reason] ?? 0) + 1;
      return acc;
    }, {}),
    maxChars: options.maxChars,
    overhead,
  });

  if (!body) {
    const packs: SourcePack[] = titlePrefix
      ? [{
          text: titlePrefix.trim(),
          chars: titlePrefix.trim().length,
          headingPath: documentTitle ? [documentTitle] : [],
          reason: 'whole',
          truncated: false,
        }]
      : [];
    return { packs, diagnostics: diagnostics(packs) };
  }

  const fits = (atoms: Atom[]): boolean => render(titlePrefix, atoms).length <= budget;
  const lines = body.split('\n');
  const atoms = atomsFor([], lines, fits, 2, 'section');

  const whole = render(titlePrefix, atoms);
  if (whole.length <= budget) {
    const packs: SourcePack[] = [{
      text: whole,
      chars: whole.length,
      headingPath: documentTitle ? [documentTitle] : [],
      reason: 'whole',
      truncated: false,
    }];
    return { packs, diagnostics: diagnostics(packs) };
  }

  /*
   Greedy grouping of adjacent units.

   This is the half that was missing: without it, ten small sections made ten
   calls when one sufficed, and the number of calls became a property of the
   formatting.
  */
  const packs: SourcePack[] = [];
  let current: Atom[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = render(titlePrefix, current);
    /*
     A pack exceeds the limit only if it contained a single unit that no cut
     could reduce. Testing it on length rather than reason is what makes the
     guarantee unconditional: a single paragraph larger than the budget is as
     indivisible as a code block, whatever path produced it.
    */
    const truncated = text.length > budget;
    const finalText = truncated ? truncate(text, budget) : text;
    packs.push({
      text: finalText,
      chars: finalText.length,
      headingPath: [
        ...(documentTitle ? [documentTitle] : []),
        ...current[0]!.headingLines.map((line) => line.replace(/^#+\s+/, '')),
      ],
      reason: truncated ? 'atomic' : current.length > 1 ? 'packed' : current[0]!.reason,
      truncated,
    });
    current = [];
  };

  for (const atom of atoms) {
    if (!current.length) {
      current = [atom];
      // A lone unit that already exceeds is indivisible: it goes as is,
      // truncated if necessary, and drags nobody along with it.
      if (!fits(current)) flush();
      continue;
    }
    if (fits([...current, atom])) {
      current.push(atom);
      continue;
    }
    flush();
    current = [atom];
    if (!fits(current)) flush();
  }
  flush();

  return { packs, diagnostics: diagnostics(packs) };
}

/**
 * "Texts only" view of the plan.
 *
 * One implementation, two readings: ingestion, `wiki doctor` and the historical
 * tests all go through the same planner. A second splitting path would reopen
 * the gap between what is announced and what is executed.
 */
export function splitSourceSections(content: string, maxChars: number): string[] {
  return planSourcePacks(content, { maxChars }).packs.map((pack) => pack.text);
}
