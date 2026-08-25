import { readFile } from 'node:fs/promises';
import { safeWriteFile } from '../utils/fs.ts';
import type { WorkspaceService } from './workspaceService.ts';

export type WikiLinkMove = { source: string; target: string };

/**
 * Rewrites every wiki page's reference to a moved page's old path into its
 * new one — both the `wiki/`-prefixed form and the bare form links commonly
 * use. Shared by every service that moves a page after publication
 * (`ConceptGroupingService`, `conceptReclassifyService`): duplicating this
 * loop let the two drift, one fix applied to only one copy.
 */
export async function rewriteWikiLinks(workspace: WorkspaceService, moves: WikiLinkMove[]): Promise<void> {
  if (!moves.length) return;
  const pages = await workspace.listWikiPages();
  for (const page of pages) {
    let content = await readFile(page.absolutePath, 'utf8');
    const before = content;
    for (const move of moves) {
      const sourceNoWiki = move.source.replace(/^wiki\//, '');
      const targetNoWiki = move.target.replace(/^wiki\//, '');
      content = content
        .replaceAll(move.source, move.target)
        .replaceAll(sourceNoWiki, targetNoWiki);
    }
    if (content !== before) {
      await safeWriteFile(page.absolutePath, content);
    }
  }
}
