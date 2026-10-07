import type matter from 'gray-matter';

/**
 * A wiki page's display title: the frontmatter `title` field, else its first
 * H1 heading, else ''. Shared by every reader that names a page in a generated
 * listing — duplicating this check let them drift on what "the title" means.
 */
export function pageTitle(parsed: matter.GrayMatterFile<string>): string {
  if (typeof parsed.data?.title === 'string' && parsed.data.title.trim()) {
    return parsed.data.title.trim();
  }
  const heading = parsed.content.match(/^#\s+(.+)$/m);
  return heading ? heading[1]!.trim() : '';
}

/**
 * Removes the Markdown emphasis a source heading may carry as literal text.
 * Confluence exports title sections as `# **5.5.Vue physique**`; taken as a
 * title that becomes the fiche's `title:` and file name, and the reader sees
 * the asterisks. Wrapping marker runs are stripped pair by pair first, then
 * any remaining `**`/`__` run (a title bolding several words) is collapsed —
 * a single `*` or `_` may be a literal and is left alone.
 */
export function stripTitleMarkup(value: string): string {
  let text = (value ?? '').trim();
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(/^(\*{1,3}|_{1,3})(?=\S)([\s\S]*?)(?<=\S)\1$/, '$2').trim();
  }
  return text
    .replace(/\*{2,}/g, ' ')
    .replace(/_{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
