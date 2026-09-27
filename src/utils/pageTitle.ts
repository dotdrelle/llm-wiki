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
