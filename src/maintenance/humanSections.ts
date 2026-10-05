import { normalizeHeadingPathKey, splitMarkdownSections, type MarkdownSection } from '../utils/markdown.ts';

/** Stable key of a section: its heading path, normalized. */
export function sectionKeyOf(section: MarkdownSection): string {
  return normalizeHeadingPathKey(section.headingPath);
}

/** The section keys a template render produced — recorded in the build state. */
export function producedSectionKeys(markdown: string): string[] {
  return splitMarkdownSections(markdown).sections.map(sectionKeyOf);
}

export interface PreservedSections {
  markdown: string;
  /** Labels of the hand-added sections carried over into the new output. */
  preserved: string[];
}

/**
 * Keep the sections a human added to a generated deliverable.
 *
 * A section of the existing file that the template did NOT produce at the
 * last build (`producedKeys`) can only have been written by hand: it is
 * carried over, after the section that preceded it in the existing file (or at
 * the end). A section the template produced before and no longer produces is a
 * template change and is dropped. Without a record of the produced sections
 * (a build state older than this rule) nothing can be told apart, so nothing
 * is carried over — the caller says so.
 *
 * Deterministic, no model call: what a human wrote is copied verbatim.
 */
export function preserveHumanSections(
  existing: string,
  rendered: string,
  producedKeys: readonly string[] | undefined,
): PreservedSections {
  if (!producedKeys) return { markdown: rendered, preserved: [] };
  const produced = new Set(producedKeys);
  const before = splitMarkdownSections(existing);
  const after = splitMarkdownSections(rendered);
  const renderedKeys = new Set(after.sections.map(sectionKeyOf));
  const human = before.sections.filter((section) => {
    const key = sectionKeyOf(section);
    return !produced.has(key) && !renderedKeys.has(key);
  });
  if (human.length === 0) return { markdown: rendered, preserved: [] };

  const output: Array<{ key: string; markdown: string }> = after.sections.map((section) => ({
    key: sectionKeyOf(section),
    markdown: section.markdown,
  }));
  const humanKeys = new Set(human.map(sectionKeyOf));
  for (const section of human) {
    const key = sectionKeyOf(section);
    // Anchor on the closest earlier section of the existing file that is in
    // the output (a template section or an already carried hand section).
    const index = before.sections.findIndex((candidate) => sectionKeyOf(candidate) === key);
    let insertAt = output.length;
    for (let i = index - 1; i >= 0; i--) {
      const anchor = sectionKeyOf(before.sections[i]!);
      const position = output.findIndex((entry) => entry.key === anchor);
      if (position !== -1) {
        insertAt = position + 1;
        // Skip past anchored sub-sections so a hand section never splits a
        // template section from its own children.
        while (insertAt < output.length && !humanKeys.has(output[insertAt]!.key)
          && output[insertAt]!.key.startsWith(`${anchor} > `)) insertAt++;
        break;
      }
    }
    output.splice(insertAt, 0, { key, markdown: section.markdown });
  }

  const markdown = [after.frontmatter.trimEnd(), after.preamble.trim(), ...output.map((entry) => entry.markdown.trim())]
    .filter(Boolean)
    .join('\n\n')
    .trim()
    .concat('\n');
  return { markdown, preserved: human.map((section) => section.headingPath.join(' > ') || '(document)') };
}

