import path from 'node:path';
import { pathExists } from '../../utils/fs.ts';
import { resolveInside, toPosix } from '../../utils/path.ts';

const EXTERNAL_LINK = /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i;
// Single source of truth for the two local-link syntaxes. Shared between the
// matchAll (collect hrefs) and replace (strip broken) passes so a syntax tweak
// can never drift between "recognized as broken" and "actually stripped".
// Both are global (/g); matchAll clones internally and replace resets lastIndex,
// so reusing one instance across both calls is safe.
const INLINE_LINK = /(?<!!)\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
// Workspace-relative roots whose links resolve against the workspace root
// rather than the current page directory. `raw` covers every raw/ subfolder
// (ingested, untracked, and any producer-specific one), not just a fixed pair.
const WORKSPACE_PATH = /^(?:wiki|deliverables|templates|build-context|raw)(?:\/|$)/;

function targetPath(href: string, currentDir: string): string | null {
  let decoded: string;
  try { decoded = decodeURI(href); } catch { decoded = href; }
  decoded = decoded.replace(/[?#].*$/, '').trim();
  if (!decoded || EXTERNAL_LINK.test(decoded)) return null;
  const isWorkspacePath = WORKSPACE_PATH.test(decoded);
  const relative = decoded.startsWith('/') || isWorkspacePath
    ? decoded.replace(/^\/+/, '')
    : path.posix.join(currentDir || 'wiki', decoded.replace(/^\.\//, ''));
  return toPosix(path.posix.normalize(relative));
}

async function targetExists(rootDir: string, href: string, currentDir: string): Promise<boolean> {
  const relative = targetPath(href, currentDir);
  if (!relative) return true;
  try {
    return await pathExists(resolveInside(rootDir, relative));
  } catch {
    return false;
  }
}

/** Remove broken local link syntax while preserving its readable label. */
export async function removeBrokenWikiLinks(
  raw: string,
  currentDir: string,
  rootDir: string,
): Promise<string> {
  const inline = [...raw.matchAll(INLINE_LINK)];
  const wiki = [...raw.matchAll(WIKI_LINK)];
  const targets = new Map<string, Promise<boolean>>();
  for (const match of inline) {
    const href = match[2];
    if (href && !targets.has(href)) targets.set(href, targetExists(rootDir, href, currentDir));
  }
  for (const match of wiki) {
    const href = match[1];
    if (href && !targets.has(href)) targets.set(href, targetExists(rootDir, href, currentDir));
  }
  const validity = new Map(await Promise.all(
    [...targets].map(async ([href, exists]) => [href, await exists] as const),
  ));
  const withoutInline = raw.replace(
    INLINE_LINK,
    (match, label: string, href: string) => validity.get(href) === false ? label : match,
  );
  return withoutInline.replace(
    WIKI_LINK,
    (match, href: string, label?: string) => validity.get(href) === false ? (label?.trim() || href.trim()) : match,
  );
}
