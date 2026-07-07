import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { marked } from 'marked';
import { renderGraphApp } from '../../graph/core/graphLayoutBase.ts';
import {
  buildWikiGraph,
  listWikiGraphFiles as listGraphFiles,
  wikiGraphEtag as graphEtag,
  wikiGraphEtagForFiles as graphEtagForFiles,
  WIKI_GRAPH_DAG_COLUMN_ORDER,
  WIKI_GRAPH_RELATION_LABELS,
  type WikiGraphEdge,
  type WikiGraphNode,
} from '../../graph/wiki/projection.ts';
import { pathExists, safeWriteFile } from '../../utils/fs.ts';
import { resolveInside, toPosix } from '../../utils/path.ts';
import { WIKI_LAYOUT_CSS } from './wikiLayoutCss.ts';
import { WIKI_LAYOUT_SCRIPT } from './wikiLayoutScript.ts';

export { graphEtag, graphEtagForFiles, listGraphFiles, escapeScriptJson };

const serveTitle = () => process.env.WIKI_SERVE_TITLE ?? null;
const serveLogo = () => process.env.WIKI_SERVE_LOGO ?? '🧠';
const hubPort = () => process.env.HUB_PORT ?? null;
const workspaceNameFromEnv = () => process.env.WORKSPACE_NAME ?? null;
const SERVED_DIRS = ['wiki', 'deliverables', 'templates', 'build-context', 'raw/untracked'];
const NAV_PATTERNS = [
  'wiki/**/*.md',
  'deliverables/**/*.md',
  'templates/**/*.md',
  'build-context/**/*.md',
];
const EDITABLE_DIRS = ['wiki', 'deliverables', 'templates', 'build-context', 'raw/untracked'];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function escapeScriptJson(s: string): string {
  return s
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function decodeHrefPath(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

export function escapeHref(href: string): string {
  return escapeAttr(encodeURI(decodeHrefPath(href)));
}

function humanTitle(value: string): string {
  return path.basename(value, '.md').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function deliverableKind(relativePath: string): 'build' | 'export' | 'polish' {
  const base = path.basename(relativePath, '.md');
  if (base.endsWith('.export.polished')) return 'polish';
  if (base.endsWith('.export')) return 'export';
  return 'build';
}

export function localHref(href: string, currentDir = ''): string {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const clean = decodeHrefPath(href.replace(/^\.\//, ''));
  if (clean.startsWith('/')) {
    const absoluteRelativePath = toPosix(clean.replace(/^\/+/, ''));
    if (isServedRelativePath(absoluteRelativePath)) {
      return `/${absoluteRelativePath}`;
    }
    if (currentDir.startsWith('raw/ingested/')) {
      return `/raw/ingested/${absoluteRelativePath}`;
    }
    return clean;
  }
  if (isServedRelativePath(clean)) {
    return `/${toPosix(clean)}`;
  }
  if (currentDir) return `/${toPosix(path.posix.join(currentDir, clean))}`;
  return `/wiki/${toPosix(clean)}`;
}

export function isRawUntrackedReference(value: string): boolean {
  const clean = toPosix(decodeHrefPath(value).replace(/^\/+/, '').replace(/#.*$/, ''));
  return clean.startsWith('raw/untracked/') || clean.startsWith('wiki/raw/untracked/');
}

export function isServedRelativePath(relativePath: string): boolean {
  if (isHiddenDeliverableSupportPath(relativePath)) return false;
  return (
    SERVED_DIRS.some(
      (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`),
    ) || relativePath.startsWith('raw/ingested/')
  );
}

function isHiddenDeliverableSupportPath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some((segment) => segment.startsWith('.tmp.') || segment.startsWith('.changes.'));
}

function hrefToRelativePath(href: string, currentDir = ''): string {
  return localHref(href, currentDir).replace(/^\//, '').replace(/#.*$/, '');
}

function isEditableRelativePath(relativePath: string): boolean {
  return (
    relativePath.endsWith('.md') &&
    EDITABLE_DIRS.some(
      (dir) => relativePath.startsWith(`${dir}/`) || relativePath === `${dir}.md`,
    )
  );
}

function isManagedMarkdownRelativePath(relativePath: string): boolean {
  return (
    relativePath.endsWith('.md') &&
    (relativePath.startsWith('deliverables/') ||
      relativePath.startsWith('templates/') ||
      relativePath.startsWith('build-context/'))
  );
}

function isCreatableCollection(collection: string): boolean {
  return collection === 'templates' || collection === 'build-context';
}

function templateRenameScript(relativePath: string): string {
  return `<script>
async function renameTemplate() {
  const currentName = ${JSON.stringify(path.basename(relativePath, '.md'))};
  const nextName = prompt('Nouveau nom du template', currentName);
  if (!nextName) return;
  const res = await fetch(${JSON.stringify(renameHref(relativePath))}, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nextName })
  });
  if (!res.ok) {
    alert('Renommage impossible');
    return;
  }
  const payload = await res.json();
  window.location.href = '/' + payload.path;
}
</script>`;
}

function slugifyMarkdownTitle(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('INVALID_MARKDOWN_TITLE');
  return `${slug}.md`;
}

function linkSourceCitations(raw: string, currentDir = ''): string {
  return raw.replace(/\[src:\s*([^\]]+)\]/g, (match, citationPath: string) => {
    const cleanPath = citationPath.trim();
    if (!cleanPath) return '[src:]';
    if (!cleanPath.endsWith('.md')) return match;
    const href = localHref(cleanPath, currentDir);
    if (isRawUntrackedReference(cleanPath) || isRawUntrackedReference(href)) {
      return `<span class="source-citation source-citation-stale" title="Raw source archived or moved">[src: ${escapeHtml(cleanPath)}]</span>`;
    }
    return `<a class="source-citation" href="${escapeHref(href)}" title="${escapeAttr(cleanPath)}">[src: ${escapeHtml(cleanPath)}]</a>`;
  });
}

function linkWikiLinks(raw: string): string {
  return raw.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (match, target: string, label?: string) => {
      const cleanTarget = target.trim();
      if (!cleanTarget || cleanTarget.startsWith('INSTRUCTION:')) return match;
      const text = label?.trim() || cleanTarget;
      if (isRawUntrackedReference(cleanTarget)) return text;
      return `[${text}](${encodeURI(cleanTarget)})`;
    },
  );
}

async function renderMarkdown(raw: string, currentDir = ''): Promise<string> {
  const renderer = new marked.Renderer();
  renderer.link = ({ href, title, text }) => {
    const resolvedHref = localHref(href, currentDir);
    if (isRawUntrackedReference(href) || isRawUntrackedReference(resolvedHref)) {
      const safeTitle = title
        ? ` title="${escapeAttr(title)}"`
        : ' title="Raw source archived or moved"';
      return `<span class="stale-reference"${safeTitle}>${text}</span>`;
    }
    const safeHref = escapeHref(resolvedHref);
    const safeTitle = title ? ` title="${escapeAttr(title)}"` : '';
    return `<a href="${safeHref}"${safeTitle}>${text}</a>`;
  };
  return marked(linkSourceCitations(linkWikiLinks(raw), currentDir), {
    gfm: true,
    renderer,
  });
}

function renderLogPath(value: string, currentDir = 'wiki'): string {
  const clean = value.trim();
  if (!clean) return '';
  const href = localHref(clean, currentDir);
  const content = escapeHtml(clean);
  if (
    !isRawUntrackedReference(clean) &&
    !isRawUntrackedReference(href) &&
    isServedRelativePath(href.replace(/^\//, ''))
  ) {
    return `<a class="log-path" href="${escapeHref(href)}">${content}</a>`;
  }
  return `<span class="log-path">${content}</span>`;
}

function renderLogMarkdown(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const heading =
    lines
      .find((line) => line.startsWith('# '))
      ?.replace(/^#\s+/, '')
      .trim() || 'Wiki Log';
  const entries = lines
    .filter((line) => line.trim().startsWith('- '))
    .map((line) => line.trim().replace(/^-\s+/, ''));

  const items = entries.map((entry) => {
    if (entry === 'Workspace initialized.') {
      return `<li class="log-entry log-entry-system"><span class="log-kind">system</span><span class="log-summary">Workspace initialized.</span></li>`;
    }
    const match = entry.match(/^(\S+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/);
    if (!match) {
      return `<li class="log-entry"><span class="log-summary">${escapeHtml(entry)}</span></li>`;
    }

    const [, timestamp, kindRaw, restRaw] = match;
    let rest = restRaw.trim();
    let summary = '';
    const summaryMatch = rest.match(/\s+\((.*)\)$/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      rest = rest.slice(0, summaryMatch.index).trim();
    }
    const arrowIndex = rest.indexOf(' -> ');
    const source = arrowIndex >= 0 ? rest.slice(0, arrowIndex).trim() : rest;
    const target = arrowIndex >= 0 ? rest.slice(arrowIndex + 4).trim() : '';
    const date = new Date(timestamp);
    const displayDate = Number.isNaN(date.getTime())
      ? timestamp
      : date.toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

    return `<li class="log-entry"><div class="log-entry-head"><time class="log-date" datetime="${escapeAttr(timestamp)}">${escapeHtml(displayDate)}</time><span class="log-kind">${escapeHtml(kindRaw.trim())}</span></div><div class="log-flow"><span class="log-flow-label">source</span>${renderLogPath(source)}${target ? `<span class="log-arrow">→</span><span class="log-flow-label">wiki</span>${renderLogPath(target)}` : ''}</div>${summary ? `<p class="log-summary">${escapeHtml(summary)}</p>` : ''}</li>`;
  });

  return `<section class="log-article"><h1>${escapeHtml(heading)}</h1><ol class="log-list">${items.join('\n')}</ol></section>`;
}

function layout(title: string, body: string): string {
  const displayName = serveTitle() ?? workspaceNameFromEnv() ?? null;
  const pageTitle = displayName ? `${displayName} · ${title}` : title;
  const faviconLabel = (serveLogo().trim() || (serveTitle() ?? workspaceNameFromEnv() ?? 'W'))
    .slice(0, 2)
    .toUpperCase();
  const faviconHref = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23176b87'/><text x='16' y='22.5' font-size='17' font-family='system-ui,sans-serif' font-weight='900' text-anchor='middle' fill='white'>${encodeURIComponent(faviconLabel)}</text></svg>`;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="icon" type="image/svg+xml" href="${faviconHref}">
  <meta property="og:title" content="${escapeAttr(pageTitle)}">
  <meta property="og:type" content="website">
  <style>${WIKI_LAYOUT_CSS}</style>
</head>
<body>
<script>
window.WikiUi = window.WikiUi || {
  escapeHtml: function(value) {
    return String(value).replace(/[&<>"']/g, function(char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  },
  normalizeSearch: function(value) {
    return String(value).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  },
};
</script>
<div class="app-shell">
${body}
</div>
<div class="modal-backdrop" id="shortcuts-modal" onclick="if(event.target===this)this.classList.remove('is-open')">
  <div class="relation-modal" style="max-width:420px;max-height:none">
    <div class="modal-header"><h2 class="modal-title">Keyboard shortcuts</h2><button class="modal-close" onclick="document.getElementById('shortcuts-modal').classList.remove('is-open')">✕</button></div>
    <div class="modal-body" style="padding:1rem">
      <table style="width:100%;border-collapse:collapse;font-size:.88rem">
        <tbody>
          <tr><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border)"><kbd style="font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px">⌘K</kbd></td><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border);color:var(--muted)">Global search palette</td></tr>
          <tr><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border)"><kbd style="font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px">⌘E</kbd></td><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border);color:var(--muted)">Edit current page</td></tr>
          <tr><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border)"><kbd style="font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px">⌘B</kbd></td><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border);color:var(--muted)">Hide / show sidebar</td></tr>
          <tr><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border)"><kbd style="font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px">G</kbd></td><td style="padding:.4rem .6rem;border-bottom:1px solid var(--border);color:var(--muted)">Go to source graph</td></tr>
          <tr><td style="padding:.4rem .6rem"><kbd style="font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px">?</kbd></td><td style="padding:.4rem .6rem;color:var(--muted)">Show this help</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
<div class="palette-backdrop" id="palette-backdrop" aria-modal="true" role="dialog" aria-label="Quick search">
  <div class="palette">
    <div class="palette-head">
      <svg class="palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="palette-input" id="palette-input" type="search" placeholder="Search wiki…" autocomplete="off" spellcheck="false">
      <span class="palette-esc">Esc</span>
    </div>
    <div class="palette-results" id="palette-results"></div>
    <div class="palette-footer">
      <span class="palette-hint"><kbd>↵</kbd> open</span>
      <span class="palette-hint"><kbd>Esc</kbd> close</span>
      <span class="palette-hint" style="margin-left:auto"><kbd>⌘K</kbd></span>
    </div>
  </div>
</div>
<script>${WIKI_LAYOUT_SCRIPT}</script>
</body>
</html>`;
}

function breadcrumb(urlPath: string): string {
  const parts = urlPath.split('/').filter(Boolean);
  let href = '';
  const links = ['<a href="/">index</a>'];
  for (const part of parts) {
    href += `/${part}`;
    const relative = href.replace(/^\//, '');
    const target = href === '/wiki' || !isServedRelativePath(relative) ? '/' : href;
    links.push(`<a href="${escapeHref(target)}">${escapeHtml(part)}</a>`);
  }
  return `<nav>${links.join('')}</nav>`;
}

interface TileSection {
  heading: string;
  tiles: Array<{ title: string; href?: string; meta: string; group?: string }>;
}

export function extractIndexTiles(markdown: string, currentDir = 'wiki'): TileSection[] {
  const sections: TileSection[] = [];
  let current: TileSection = { heading: 'Index', tiles: [] };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      if (current.tiles.length > 0) sections.push(current);
      current = { heading: heading[1], tiles: [] };
      continue;
    }

    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!item?.[1]) continue;

    const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(item[1]);
    if (link?.[1] && link[2]) {
      const href = localHref(link[2], currentDir);
      current.tiles.push({
        title: link[1],
        href:
          isRawUntrackedReference(link[2]) || isRawUntrackedReference(href)
            ? undefined
            : href,
        meta: link[2],
      });
      continue;
    }

    const wikiLink = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(item[1]);
    if (wikiLink?.[1]) {
      const target = wikiLink[1].trim();
      const title = wikiLink[2]?.trim() || humanTitle(target);
      const href = localHref(target, currentDir);
      current.tiles.push({
        title,
        href:
          isRawUntrackedReference(target) || isRawUntrackedReference(href)
            ? undefined
            : href,
        meta: target,
      });
    } else {
      const srcMatch = /\[src:\s*([^\]]+)\]/i.exec(item[1]);
      const srcPath = srcMatch?.[1].trim();
      const srcHref = srcPath ? localHref(srcPath, currentDir) : undefined;
      const href =
        srcPath &&
        srcHref &&
        !isRawUntrackedReference(srcPath) &&
        !isRawUntrackedReference(srcHref)
          ? srcHref
          : undefined;
      const stripped = item[1]
        .replace(/\[src:\s*[^\]]+\]/gi, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const emDash = /^(.+?)\s*[–—]\s*(.+)$/.exec(stripped);
      if (emDash) {
        const desc = emDash[2].trim();
        current.tiles.push({
          title: emDash[1].trim(),
          meta: desc.length > 100 ? `${desc.slice(0, 97)}…` : desc,
          href,
        });
      } else {
        current.tiles.push({
          title: stripped.length > 80 ? `${stripped.slice(0, 77)}…` : stripped,
          meta: current.heading,
          href,
        });
      }
    }
  }

  if (current.tiles.length > 0) sections.push(current);
  return sections;
}

function renderTile(tile: { title: string; href?: string; meta: string }): string {
  const content = `<span class="tile-title">${escapeHtml(tile.title)}</span><span class="tile-meta">${escapeHtml(tile.meta)}</span>`;
  return tile.href
    ? `<a class="tile" href="${escapeHref(tile.href)}">${content}</a>`
    : `<div class="tile">${content}</div>`;
}

function conceptGroupFromPath(relativePath: string): string | undefined {
  const parts = toPosix(relativePath).split('/');
  if (parts[0] !== 'wiki' || parts[1] !== 'concepts' || parts.length < 4) {
    return undefined;
  }
  return humanTitle(parts[2]);
}

async function readPageGroup(rootDir: string, href: string): Promise<string | undefined> {
  if (!href.startsWith('/wiki/concepts/')) return undefined;
  const relativePath = href.replace(/^\//, '');
  const pathGroup = conceptGroupFromPath(relativePath);
  try {
    const raw = await readFile(resolveInside(rootDir, relativePath), 'utf8');
    const parsed = matter(raw);
    const group = parsed.data.group;
    if (typeof group === 'string' && group.trim()) return group.trim();
  } catch {
    return pathGroup;
  }
  return pathGroup;
}

async function hydrateConceptTileGroups(
  rootDir: string,
  sections: TileSection[],
): Promise<void> {
  const targets: Array<{
    tile: TileSection['tiles'][number];
    href: string;
    fallback: string;
  }> = [];
  for (const section of sections) {
    const isConceptSection = section.heading.toLowerCase().includes('concept');
    const fallback = isConceptSection ? 'Concepts' : section.heading;
    for (const tile of section.tiles) {
      if (!tile.href?.startsWith('/wiki/concepts/')) continue;
      targets.push({ tile, href: tile.href, fallback });
    }
  }
  await Promise.all(
    targets.map(async ({ tile, href, fallback }) => {
      tile.group = (await readPageGroup(rootDir, href)) || fallback;
    }),
  );
}

function renderIndexSectionBrowser(sections: TileSection[]): string {
  if (sections.length === 0) {
    return '<p class="empty">No index sections found.</p>';
  }

  return sections
    .map((section) => {
      const count = section.tiles.length;
      const grouped = new Map<string, typeof section.tiles>();
      for (const tile of section.tiles) {
        if (!tile.group) continue;
        const tiles = grouped.get(tile.group) ?? [];
        tiles.push(tile);
        grouped.set(tile.group, tiles);
      }
      const groupsHtml = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([group, tiles]) =>
            `<details class="section-browser-group"><summary><span>${escapeHtml(group)}</span><span>${tiles.length}</span></summary><div class="section-browser-tiles">${tiles.map(renderTile).join('')}</div></details>`,
        )
        .join('');
      return `<details class="section-browser"${groupsHtml ? ' open' : ''}><summary><span class="section-browser-summary"><span class="section-browser-title">${escapeHtml(section.heading)}</span><span class="section-browser-meta">${count} item${count === 1 ? '' : 's'}</span></span></summary>${groupsHtml}</details>`;
    })
    .join('\n');
}

function renderTopbar(urlPath: string, actions = ''): string {
  return `<div class="topbar">${breadcrumb(urlPath)}${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

function editHref(relativePath: string): string {
  return `/edit/${relativePath}`;
}

function newMarkdownHref(collection: string): string {
  return `/new/${collection}`;
}

function deleteHref(relativePath: string): string {
  return `/delete/${relativePath}`;
}

function renameHref(relativePath: string): string {
  return `/rename/${relativePath}`;
}

interface NavTreeNode {
  name: string;
  path: string;
  dirs: Map<string, NavTreeNode>;
  files: string[];
}

function createNavNode(name: string, nodePath: string): NavTreeNode {
  return {
    name,
    path: nodePath,
    dirs: new Map(),
    files: [],
  };
}

function addNavPath(root: NavTreeNode, relativePath: string): void {
  const parts = toPosix(relativePath).split('/');
  const fileName = parts.pop();
  if (!fileName) return;

  let current = root;
  const nodeParts: string[] = [];
  for (const part of parts) {
    nodeParts.push(part);
    const nodePath = nodeParts.join('/');
    let next = current.dirs.get(part);
    if (!next) {
      next = createNavNode(part, nodePath);
      current.dirs.set(part, next);
    }
    current = next;
  }
  current.files.push(relativePath);
}

function renderNavNode(node: NavTreeNode, depth = 0): string {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.localeCompare(b));
  const children = [
    ...dirs.map((dir) => renderNavNode(dir, depth + 1)),
    ...files.map((file) => {
      const title = humanTitle(file);
      const safePath = escapeAttr(toPosix(file));
      const kindAttr = file.startsWith('deliverables/')
        ? ` data-deliverable-kind="${deliverableKind(file)}"`
        : '';
      return `<a class="side-file" href="/${safePath}" title="${safePath}" data-side-path="${safePath}"${kindAttr}>${escapeHtml(title)}</a>`;
    }),
  ].join('\n');

  const open = depth === 0 ? ' open' : '';
  const label = node.name === 'build-context' ? 'build context' : node.name;
  const action =
    depth === 0 && isCreatableCollection(node.name)
      ? `<a class="side-folder-action" href="${escapeHref(newMarkdownHref(node.name))}" title="Create Markdown" aria-label="Create in ${escapeAttr(node.name)}" onclick="event.stopPropagation()">+</a>`
      : '';
  return `<details class="side-folder"${open} data-tree-id="${escapeAttr(node.path)}"><summary><span class="side-folder-label">${escapeHtml(label)}</span>${action}</summary><div class="side-folder-children">${children}</div></details>`;
}

async function renderUntrackedSidebar(rootDir: string): Promise<string> {
  const files = (await fg('raw/untracked/**/*.md', { cwd: rootDir, dot: false, onlyFiles: true }))
    .map(toPosix)
    .sort((a, b) => a.localeCompare(b));
  const count = files.length;
  const open = count > 0 ? ' open' : '';
  const items = count > 0
    ? files
      .map((file) => {
        const title = humanTitle(file);
        const safePath = escapeAttr(file);
        return `<li class="side-untracked-item"><a class="side-untracked-link" href="${escapeHref(`/${file}`)}" title="${safePath}" aria-label="${safePath}">${escapeHtml(title)}</a><button class="side-untracked-delete" type="button" title="Delete ${safePath}" aria-label="Delete ${safePath}" data-untracked-delete="${safePath}">×</button></li>`;
      })
      .join('\n')
    : '<li class="side-untracked-empty">No pending sources.</li>';
  return `<div class="side-pending-resizer" data-pending-resizer title="Resize Pending panel" role="separator" aria-orientation="horizontal"></div><details class="side-untracked"${open} data-untracked-panel><summary><span>Pending</span><span class="side-untracked-count" data-untracked-count>${count}</span></summary><ul class="side-untracked-list" data-untracked-list>${items}</ul></details>`;
}

async function renderSidebar(rootDir: string, precomputedNavFiles?: string[]): Promise<string> {
  const [navFiles, untrackedPanel] = await Promise.all([
    precomputedNavFiles ?? fg(NAV_PATTERNS, { cwd: rootDir, dot: false }),
    renderUntrackedSidebar(rootDir),
  ]);
  const root = createNavNode('workspace', '');
  for (const file of navFiles.map(toPosix).sort()) {
    addNavPath(root, file);
  }

  const tree = [...root.dirs.values()]
    .sort((a, b) => SERVED_DIRS.indexOf(a.name) - SERVED_DIRS.indexOf(b.name))
    .map((dir) => renderNavNode(dir))
    .join('\n');

  const wsSwitcher = hubPort()
    ? `<div class="ws-switcher" id="ws-switcher" data-current="${escapeAttr(workspaceNameFromEnv() ?? '')}"><p class="ws-switcher-title">Workspaces</p><p class="ws-name" style="font-size:0.8rem;color:var(--muted);padding:0 0.2rem">Loading...</p></div>`
    : '';
  const configuredServeTitle = serveTitle();
  const workspaceName = configuredServeTitle
    ? configuredServeTitle
    : (workspaceNameFromEnv() ?? 'wiki').toUpperCase();
  const graphIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.6 8.1 10.8 15"/><path d="m15.4 8.1-2.2 6.9"/><path d="M9 6h6"/></svg>';
  const chatIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>';
const kbdHint = `<kbd style="font-size:.68rem;font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.1rem .35rem;border-radius:4px;color:var(--muted);cursor:pointer" title="Open global search (⌘K)" onclick="document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))">⌘K</kbd>`;
  return `<aside class="sidebar"><a class="brand" href="/"><span class="brand-title">${escapeHtml(workspaceName)}</span></a><div class="side-actions" aria-label="Shortcuts"><a class="side-action" href="/graph" title="Graph" aria-label="Graph">${graphIcon}<span>Graph</span></a><a class="side-action" href="/chat" title="Chat" aria-label="Chat">${chatIcon}<span>Chat</span></a></div><div class="side-search" style="display:flex;gap:.4rem;align-items:center"><input class="side-search-input" type="search" placeholder="Filter files..." aria-label="Filter files" data-side-search style="margin:0;flex:1">${kbdHint}</div><p class="side-search-status" data-side-search-status style="margin:.35rem 0 0;font-size:.78rem;color:var(--muted)">No matching files.</p><nav class="side-tree" aria-label="Markdown documents">${tree}</nav>${untrackedPanel}${wsSwitcher}</aside><div class="wiki-main-resizer" data-wiki-main-resizer title="Resize sidebar" role="separator" aria-orientation="vertical"></div>`;
}

type GraphNode = WikiGraphNode;
type GraphEdge = WikiGraphEdge;

export async function buildGraph(
  rootDir: string,
  graphFiles?: string[],
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  return buildWikiGraph(rootDir, {
    decodeHrefPath,
    hrefToRelativePath,
    humanTitle,
    renderMarkdown,
  }, graphFiles);
}

function renderWikiGraphApp(nodes: GraphNode[], edges: GraphEdge[], etag: string): string {
  return renderGraphApp(nodes, edges, etag, {
    escapeAttr,
    escapeScriptJson,
    dagColumnOrder: WIKI_GRAPH_DAG_COLUMN_ORDER,
    relationLabels: WIKI_GRAPH_RELATION_LABELS,
  });
}

// ── Stats helpers ──────────────────────────────────────────────────────────

async function getLastIngestTime(rootDir: string): Promise<Date | null> {
  const logsDir = path.join(rootDir, '.wiki', 'logs');
  if (!(await pathExists(logsDir))) return null;
  try {
    const files = (await readdir(logsDir))
      .filter((f) => f.startsWith('ingest-') && f.endsWith('.log'))
      .sort();
    if (files.length === 0) return null;
    const s = await stat(path.join(logsDir, files[files.length - 1]));
    return s.mtime;
  } catch {
    return null;
  }
}

function relativeTimeLabel(d: Date | null): string {
  if (!d) return 'Never';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return d.toLocaleDateString('en-US');
}

function renderWsStats(opts: {
  wikiPages: number;
  deliverables: number;
  templates: number;
  untracked: number;
  lastIngest: Date | null;
}): string {
  const items: Array<{ n: string; l: string; cls: string; title?: string }> = [
    { n: String(opts.wikiPages), l: 'Wiki pages', cls: '' },
    { n: String(opts.deliverables), l: 'Deliverables', cls: '' },
    { n: String(opts.templates), l: 'Templates', cls: '' },
  ];
  if (opts.untracked > 0)
    items.push({
      n: String(opts.untracked),
      l: 'Pending',
      cls: ' ws-stat-warn',
      title: 'Sources in raw/untracked — run wiki ingest to integrate them into the wiki.',
    });
  items.push({ n: relativeTimeLabel(opts.lastIngest), l: 'Last ingest', cls: ' ws-stat-muted' });
  return `<div class="ws-stats">${items
    .map(
      (s) =>
        `<div class="ws-stat${s.cls}"${s.title ? ` title="${escapeAttr(s.title)}"` : ''}><span class="ws-stat-n">${escapeHtml(s.n)}</span><span class="ws-stat-l">${escapeHtml(s.l)}</span></div>`,
    )
    .join('')}</div>`;
}

function renderOnboarding(title: string): string {
  return `<section class="onboarding"><div class="hero"><h1>${escapeHtml(title)}</h1><p>The wiki is empty. Follow these four steps to get started.</p></div><div class="onboarding-steps">
<div class="onboarding-step"><div class="onboarding-step-num">1</div><div class="onboarding-step-body"><div class="onboarding-step-title">Configure the LLM provider</div><div class="onboarding-step-desc">Edit <code class="onboarding-step-code">.wikirc.yaml</code> to set your provider (Ollama, OpenAI, Anthropic...), then validate with <code class="onboarding-step-code">wiki doctor</code>.</div></div></div>
<div class="onboarding-step"><div class="onboarding-step-num">2</div><div class="onboarding-step-body"><div class="onboarding-step-title">Add sources</div><div class="onboarding-step-desc">Copy your Markdown files into <code class="onboarding-step-code">raw/untracked/</code>. Confluence exports, notes, converted PDFs: all are accepted.</div></div></div>
<div class="onboarding-step"><div class="onboarding-step-num">3</div><div class="onboarding-step-body"><div class="onboarding-step-title">Ingest sources</div><div class="onboarding-step-desc">Run <code class="onboarding-step-code">wiki ingest</code>. The LLM reads each source and populates <code class="onboarding-step-code">wiki/</code> automatically.</div></div></div>
<div class="onboarding-step"><div class="onboarding-step-num">4</div><div class="onboarding-step-body"><div class="onboarding-step-title">Generate deliverables</div><div class="onboarding-step-desc">Create a template in <code class="onboarding-step-code">templates/</code>, then run <code class="onboarding-step-code">wiki build</code> to produce documents from the wiki.</div></div></div>
</div></section>`;
}

// ──────────────────────────────────────────────────────────────────────────────

export async function generateGraph(rootDir: string): Promise<string> {
  const [sidebar, graphFiles] = await Promise.all([
    renderSidebar(rootDir),
    listGraphFiles(rootDir),
  ]);
  const [{ nodes, edges }, etag] = await Promise.all([
    buildGraph(rootDir, graphFiles),
    graphEtagForFiles(rootDir, graphFiles),
  ]);
  const rawSourceCount = nodes.filter((node) => node.type === 'raw-source').length;
  const wikiSourceCount = nodes.filter((node) => node.type === 'wiki-source').length;
  const templateCount = nodes.filter((node) => node.type === 'template').length;
  const contextCount = nodes.filter((node) => node.type === 'build-context').length;
  const graph =
    nodes.length > 0
      ? renderWikiGraphApp(nodes, edges, etag)
      : '<p class="empty">No Markdown documents to display in the graph.</p>';
  const body = `${sidebar}<main class="content"><div class="hero"><h1>Wiki Graph</h1><p>Pages, sources, templates, build context and deliverables are represented as document relations. Use Radial or DAG mode to inspect the same wiki projection.</p></div><div class="graph-legend"><span class="legend-item raw-source">${rawSourceCount} raw source(s)</span><span class="legend-item wiki-source">${wikiSourceCount} wiki source(s)</span><span class="legend-item wiki">wiki</span><span class="legend-item template">${templateCount} template(s)</span><span class="legend-item build-context">${contextCount} context file(s)</span><span class="legend-item deliverable">deliverables</span><span>${edges.length} relation(s)</span></div>${graph}</main>`;
  return layout('Source Graph', body);
}

export async function generateIndex(rootDir: string): Promise<string> {
  // ── Stats ──────────────────────────────────────────────────────────────────
  const [navFiles, untrackedFiles, lastIngest] = await Promise.all([
    fg(NAV_PATTERNS, { cwd: rootDir, dot: false }),
    fg('raw/untracked/**/*.md', { cwd: rootDir, dot: false, onlyFiles: true }),
    getLastIngestTime(rootDir),
  ]);
  const wikiFiles = navFiles.filter((file) => file.startsWith('wiki/'));
  const delivFiles = navFiles.filter((file) => file.startsWith('deliverables/'));
  const templFiles = navFiles.filter((file) => file.startsWith('templates/'));
  const statsBar = renderWsStats({
    wikiPages: wikiFiles.length,
    deliverables: delivFiles.length,
    templates: templFiles.length,
    untracked: untrackedFiles.length,
    lastIngest,
  });

  const sidebar = await renderSidebar(rootDir, navFiles);

  // ── Onboarding si wiki vide ────────────────────────────────────────────────
  const indexPath = path.join(rootDir, 'wiki', 'index.md');
  if (wikiFiles.length === 0) {
    const title = serveTitle() ?? workspaceNameFromEnv() ?? 'Wiki';
    const body = `${sidebar}<main class="content">${statsBar}${renderOnboarding(title)}</main>`;
    return layout('Getting Started', body);
  }

  const raw = (await pathExists(indexPath))
    ? await readFile(indexPath, 'utf8')
    : '# Wiki Index\n\n- wiki/index.md not found.';
  const html = await renderMarkdown(raw, 'wiki');

  const indexTiles = extractIndexTiles(raw);
  const wikiTypeDirs: Array<{ heading: string; glob: string }> = [
    { heading: 'Sources', glob: 'wiki/sources/**/*.md' },
    { heading: 'Answers', glob: 'wiki/answers/**/*.md' },
  ];
  for (const { heading, glob } of wikiTypeDirs) {
    const alreadyListed = indexTiles.some((s) =>
      s.heading.toLowerCase().includes(heading.toLowerCase()),
    );
    if (!alreadyListed) {
      const files = (await fg(glob, { cwd: rootDir, dot: false })).map(toPosix).sort();
      if (files.length > 0) {
        indexTiles.push({
          heading,
          tiles: files.map((f) => ({ title: humanTitle(f), href: `/${f}`, meta: f })),
        });
      }
    }
  }

  await hydrateConceptTileGroups(rootDir, indexTiles);

  const SECTION_RANK = ['concept', 'source', 'answer'];
  indexTiles.sort((a, b) => {
    const ah = a.heading.toLowerCase();
    const bh = b.heading.toLowerCase();
    const ai = SECTION_RANK.findIndex((k) => ah.includes(k));
    const bi = SECTION_RANK.findIndex((k) => bh.includes(k));
    return (
      (ai === -1 ? SECTION_RANK.length : ai) - (bi === -1 ? SECTION_RANK.length : bi)
    );
  });

  const tiles = renderIndexSectionBrowser(indexTiles);
  const body = `${sidebar}<main class="content">${statsBar}<div class="hero"><h1>Wiki Index</h1><p>Entry point for the local wiki. The full index remains readable on the left, with the main sections available as tiles on the right.</p></div><div class="index-layout"><article class="article">${html}</article><aside class="index-aside"><h2 class="index-aside-title">Main sections</h2>${tiles}</aside></div></main>`;
  return layout('wiki', body);
}

export async function generateDirectoryPage(
  rootDir: string,
  relativePath: string,
): Promise<string> {
  const cleanRelativePath = toPosix(relativePath).replace(/\/+$/, '');
  const files = (await fg(`${cleanRelativePath}/**/*.md`, { cwd: rootDir, dot: false }))
    .map(toPosix)
    .sort();
  const tiles = files.map((file) =>
    renderTile({
      title: humanTitle(file),
      href: `/${file}`,
      meta: file,
    }),
  );
  const title = cleanRelativePath === 'wiki' ? 'Wiki Index' : cleanRelativePath;
  const sidebar = await renderSidebar(rootDir);
  const content = tiles.length
    ? `<div class="tile-grid">${tiles.join('\n')}</div>`
    : '<p class="empty">No markdown files found in this folder.</p>';
  const actions = isCreatableCollection(cleanRelativePath)
    ? `<a class="action-link" href="${escapeHref(newMarkdownHref(cleanRelativePath))}" title="Create Markdown">+</a>`
    : '';
  const body = `${sidebar}<main class="content">${renderTopbar(`/${cleanRelativePath}`, actions)}<div class="hero"><h1>${escapeHtml(title)}</h1><p>Markdown files under <code>${escapeHtml(cleanRelativePath)}/</code>.</p></div>${content}</main>`;
  return layout(title, body);
}

function deriveSidecarPath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `.changes.${parsed.name}${parsed.ext}.json`);
}

function normalizeChangedPath(label: string): string {
  return label
    .split(' > ')
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .join(' > ');
}

function injectChangeTags(
  raw: string,
  modifiedPaths: Set<string>,
  insertedPaths: Set<string>,
): string {
  const headingStack: Array<{ depth: number; title: string }> = [];
  let inFence = false;
  return raw
    .split('\n')
    .map((line) => {
      if (/^`{3,}/.test(line.trim())) inFence = !inFence;
      if (inFence) return line;
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!match) return line;
      const depth = match[1].length;
      const title = match[2].trim();
      while (headingStack.length > 0 && headingStack.at(-1)!.depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ depth, title });
      const key = headingStack
        .map((h) => h.title.trim().toLowerCase().replace(/\s+/g, ' '))
        .join(' > ');
      if (modifiedPaths.has(key)) {
        return `${match[1]} ${title} <span class="section-tag section-tag-modified">modified</span>`;
      }
      if (insertedPaths.has(key)) {
        return `${match[1]} ${title} <span class="section-tag section-tag-inserted">new</span>`;
      }
      return line;
    })
    .join('\n');
}

export async function serveMd(
  rootDir: string,
  filePath: string,
  urlPath: string,
): Promise<string> {
  const relativePath = urlPath.replace(/^\//, '');
  const isDeliverable = relativePath.startsWith('deliverables/');
  const [rawContent, sidecarRaw] = await Promise.all([
    readFile(filePath, 'utf8'),
    isDeliverable ? readFile(deriveSidecarPath(filePath), 'utf8').catch(() => null) : Promise.resolve(null),
  ]);
  let raw = rawContent;
  let stabilizeBadge = '';
  if (sidecarRaw) {
    try {
      const sidecar = JSON.parse(sidecarRaw) as {
        stabilizedAt: string;
        kept: string[];
        merged: string[];
        inserted: string[];
        removed: string[];
      };
      const modifiedPaths = new Set((sidecar.merged ?? []).map(normalizeChangedPath));
      const insertedPaths = new Set((sidecar.inserted ?? []).map(normalizeChangedPath));
      if (modifiedPaths.size > 0 || insertedPaths.size > 0) {
        raw = injectChangeTags(raw, modifiedPaths, insertedPaths);
      }
      const parts = [
        sidecar.kept?.length ? `${sidecar.kept.length} kept` : '',
        sidecar.merged?.length ? `${sidecar.merged.length} modified` : '',
        sidecar.inserted?.length ? `${sidecar.inserted.length} inserted` : '',
        sidecar.removed?.length ? `${sidecar.removed.length} removed` : '',
      ].filter(Boolean).join(' · ');
      const date = new Date(sidecar.stabilizedAt).toLocaleString('en-US', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      stabilizeBadge = `<div class="stabilize-badge">Stabilized on ${escapeHtml(date)} · ${escapeHtml(parts)}</div>`;
    } catch {
      // malformed sidecar — ignore
    }
  }
  const currentDir = toPosix(path.dirname(urlPath.replace(/^\//, '')));
  const title = path.basename(filePath, '.md');
  const sidebar = await renderSidebar(rootDir);
  const html =
    relativePath === 'wiki/log.md'
      ? renderLogMarkdown(raw)
      : await renderMarkdown(raw, currentDir);
  const printBtn = `<button class="action-button" onclick="window.print()" title="Print / Export to PDF">↑ PDF</button>`;
  const dlBtn = `<a class="action-link" href="${escapeHref(`/raw/${relativePath}`)}" download title="Download source Markdown file">↓ .md</a>`;
  const renameBtn = relativePath.startsWith('templates/')
    ? `<button class="action-button" type="button" onclick="renameTemplate()">Rename</button>`
    : '';
  const actions = [
    printBtn,
    dlBtn,
    renameBtn,
    isEditableRelativePath(relativePath)
      ? `<a class="action-link" href="${escapeHref(editHref(relativePath))}">Edit</a>`
      : '',
    isManagedMarkdownRelativePath(relativePath)
      ? `<form class="delete-confirm" method="post" action="${escapeHref(deleteHref(relativePath))}"><button class="action-button action-danger" type="button" onclick="this.form.querySelector('.delete-confirm-panel').hidden=false">Delete</button><div class="delete-confirm-panel" hidden><p class="delete-confirm-title">Delete this file?</p><p class="delete-confirm-text">${escapeHtml(relativePath)} will be deleted from the workspace.</p><div class="delete-confirm-actions"><button class="action-button" type="button" onclick="this.closest('.delete-confirm-panel').hidden=true">Cancel</button><button class="action-button action-danger" type="submit">Delete</button></div></div></form>`
      : '',
  ].join('');
  const tocScript = `<script>
(function buildToc() {
  const article = document.querySelector('.article');
  if (!article) return;
  const headings = [...article.querySelectorAll('h2,h3')];
  if (headings.length < 3) return;
  // Ensure IDs
  headings.forEach(function(h, i) {
    if (!h.id) h.id = 'h-' + i + '-' + h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  });
  const toc = document.createElement('nav');
  toc.className = 'doc-toc';
  const tocTitle = document.createElement('p');
  tocTitle.className = 'doc-toc-title';
  tocTitle.textContent = 'Sur cette page';
  toc.appendChild(tocTitle);
  headings.forEach(function(h) {
    const link = document.createElement('a');
    link.className = 'doc-toc-item doc-toc-' + h.tagName.toLowerCase();
    link.href = '#' + h.id;
    link.textContent = h.textContent || '';
    toc.appendChild(link);
  });
  const content = document.querySelector('.content');
  if (content) content.appendChild(toc);
  // Scrollspy
  const obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      const link = toc.querySelector('a[href="#' + e.target.id + '"]');
      if (link) link.classList.toggle('is-active', e.isIntersecting);
    });
  }, { rootMargin: '-10% 0px -80% 0px' });
  headings.forEach(function(h) { obs.observe(h); });
})();
</script>`;
  return layout(
    title,
    `${sidebar}<main class="content">${renderTopbar(urlPath, actions)}${stabilizeBadge}<article class="article">${html}</article>${tocScript}${renameBtn ? templateRenameScript(relativePath) : ''}</main>`,
  );
}


export function isRawDownloadRequestPath(urlPath: string): boolean {
  return urlPath.startsWith('/raw/') && !urlPath.startsWith('/raw/ingested/') && !urlPath.startsWith('/raw/untracked/');
}

export function resolveEditableMarkdown(rootDir: string, relativePath: string): string {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!isEditableRelativePath(cleanRelativePath)) {
    throw new Error(
      `FORBIDDEN_EDIT_PATH: Editing is only allowed for markdown files under ${EDITABLE_DIRS.join(', ')}`,
    );
  }

  return resolveInside(rootDir, cleanRelativePath);
}

function fileStateLabel(info: { birthtimeMs: number; mtime: Date; mtimeMs: number }): {
  state: 'new' | 'updated';
  label: string;
  title: string;
} {
  const createdAt = Number.isFinite(info.birthtimeMs) ? info.birthtimeMs : info.mtimeMs;
  const isNew = Math.abs(info.mtimeMs - createdAt) < 5_000;
  const updatedAt = info.mtime;
  const fullDate = updatedAt.toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    state: isNew ? 'new' : 'updated',
    label: `${isNew ? 'new' : 'updated'} ${relativeTimeLabel(updatedAt)}`,
    title: `Modified ${fullDate}`,
  };
}

export async function generateEditPage(rootDir: string, relativePath: string): Promise<string> {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '');
  const absolute = resolveEditableMarkdown(rootDir, cleanRelativePath);
  const fileInfo = await stat(absolute).catch(() => null);
  if (!fileInfo) {
    throw new Error(`File not found: ${cleanRelativePath}`);
  }
  const raw = await readFile(absolute, 'utf8');
  const sidebar = await renderSidebar(rootDir);
  const cancelHref = isRawUntrackedReference(cleanRelativePath) ? '/' : `/${cleanRelativePath}`;
  const fileState = fileStateLabel(fileInfo);
  const fileStateHtml = `<span class="edit-file-state ${fileState.state === 'new' ? 'is-new' : ''}" title="${escapeAttr(fileState.title)}">${escapeHtml(fileState.label)}</span>`;
  const body = `${sidebar}<main class="content"><form class="edit-form" method="post" action="${escapeHref(editHref(cleanRelativePath))}"><div class="hero"><span class="edit-path-label"><span>${escapeHtml(cleanRelativePath)}</span>${fileStateHtml}</span><div class="page-actions"><button class="action-button" type="submit">Save</button><a class="action-link" href="${escapeHref(cancelHref)}">Cancel</a></div></div><textarea class="edit-textarea" name="content" spellcheck="false">${escapeHtml(raw)}</textarea></form></main>`;
  return layout(`Edit ${path.basename(cleanRelativePath)}`, body);
}

export async function generateNewMarkdownPage(
  rootDir: string,
  collection: string,
): Promise<string> {
  if (!isCreatableCollection(collection)) {
    throw new Error('FORBIDDEN_CREATE_PATH');
  }
  const sidebar = await renderSidebar(rootDir);
  const defaultContent = '# New document\n\n';
  const body = `${sidebar}<main class="content">${renderTopbar(`/${collection}`)}<form class="edit-form" method="post" action="${escapeHref(newMarkdownHref(collection))}"><div class="hero"><h1>New ${escapeHtml(collection)}</h1><div class="page-actions"><button class="action-button" type="submit">Create</button><a class="action-link" href="${escapeHref(`/${collection}`)}">Cancel</a></div></div><label class="field-label" for="new-md-title">File name</label><input class="field-input" id="new-md-title" name="title" type="text" placeholder="functional-analysis" required autocomplete="off"><textarea class="edit-textarea" name="content" spellcheck="false">${escapeHtml(defaultContent)}</textarea></form></main>`;
  return layout(`New ${collection}`, body);
}

export async function createMarkdownDocument(
  rootDir: string,
  collection: string,
  rawBody: string,
): Promise<string> {
  if (!isCreatableCollection(collection)) {
    throw new Error('FORBIDDEN_CREATE_PATH');
  }
  const params = new URLSearchParams(rawBody);
  const title = params.get('title')?.trim() ?? '';
  const content = params.get('content') ?? '';
  const fileName = title.endsWith('.md')
    ? slugifyMarkdownTitle(title.slice(0, -3))
    : slugifyMarkdownTitle(title);
  const relativePath = toPosix(path.posix.join(collection, fileName));
  const absolute = resolveInside(rootDir, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  if (await pathExists(absolute)) {
    throw new Error('MARKDOWN_ALREADY_EXISTS');
  }
  // Manual UI input is preserved verbatim; generated Markdown is normalized at write sites.
  await safeWriteFile(absolute, content);
  return relativePath;
}

export async function deleteMarkdownDocument(
  rootDir: string,
  relativePath: string,
): Promise<string> {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!isManagedMarkdownRelativePath(cleanRelativePath)) {
    throw new Error('FORBIDDEN_DELETE_PATH');
  }
  const absolute = resolveInside(rootDir, cleanRelativePath);
  await rm(absolute, { force: true });
  return cleanRelativePath.split('/')[0] ?? '';
}

export async function renameTemplateDocument(
  rootDir: string,
  relativePath: string,
  rawBody: string,
): Promise<string> {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanRelativePath.startsWith('templates/') || !cleanRelativePath.endsWith('.md')) {
    throw new Error('FORBIDDEN_RENAME_PATH');
  }
  const payload = JSON.parse(rawBody || '{}') as { name?: string };
  const rawName = String(payload.name ?? '').trim();
  const fileName = rawName.endsWith('.md') ? rawName : `${rawName}.md`;
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('INVALID_RENAME_TARGET');
  }
  const source = resolveInside(rootDir, cleanRelativePath);
  if (!(await pathExists(source))) {
    throw new Error('RENAME_SOURCE_NOT_FOUND');
  }
  const targetRelativePath = toPosix(path.posix.join(path.posix.dirname(cleanRelativePath), fileName));
  if (!targetRelativePath.startsWith('templates/') || !targetRelativePath.endsWith('.md')) {
    throw new Error('FORBIDDEN_RENAME_TARGET');
  }
  const target = resolveInside(rootDir, targetRelativePath);
  if (await pathExists(target)) {
    throw new Error('RENAME_TARGET_EXISTS');
  }
  await rename(source, target);
  return targetRelativePath;
}

export async function generateNotFoundPage(rootDir: string, urlPath: string): Promise<string> {
  const sidebar = await renderSidebar(rootDir);
  const cleanPath = toPosix(urlPath.replace(/^\/+/, '')) || '/';
  const rawUntrackedHint = isRawUntrackedReference(cleanPath)
    ? '<p>This URL points to <code>raw/untracked</code>. These files are temporary sources and may be archived or moved after ingestion.</p>'
    : '<p>The requested page does not exist in this workspace, or the file was moved.</p>';
  const body = `${sidebar}<main class="content"><section class="not-found-panel"><h1>Document not found</h1>${rawUntrackedHint}<code class="not-found-path">${escapeHtml(cleanPath)}</code><div class="page-actions"><button class="action-button" type="button" onclick="history.length > 1 ? history.back() : location.assign('/')">Back</button><a class="action-link" href="/">Home</a></div></section></main>`;
  return layout('Document not found', body);
}

export async function generateSkillsPage(rootDir: string): Promise<string> {
  const sidebar = await renderSidebar(rootDir);
  const pageStyles = `<style>
.skills-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-top:1rem}
.skill-card{background:var(--panel-soft);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.5rem}
.skill-card-name{font-weight:750;font-size:1rem;font-family:monospace;color:var(--accent)}
.skill-card-desc{font-size:.88rem;color:var(--muted)}
.skill-card-params{display:flex;flex-wrap:wrap;gap:.3rem}
.skill-param{background:var(--panel);border:1px solid var(--border);border-radius:99px;font-size:.78rem;padding:2px 8px;color:var(--text);font-family:monospace}
.skill-card-actions{display:flex;gap:.5rem;margin-top:auto;padding-top:.5rem;border-top:1px solid var(--border)}
.skill-card-body-preview{font-size:.82rem;color:var(--muted2);font-family:monospace;white-space:pre-wrap;max-height:4em;overflow:hidden;border-left:2px solid var(--border);padding-left:.5rem;margin-top:.15rem}
.editor-overlay{position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:500;display:none;align-items:flex-start;justify-content:center;padding:3rem 1rem;overflow-y:auto}
.editor-overlay.open{display:flex}
.editor-panel{background:var(--panel);border:1px solid var(--border);border-radius:14px;width:min(640px,100%);padding:1.5rem;display:flex;flex-direction:column;gap:1rem;box-shadow:0 18px 60px rgba(0,0,0,.2)}
.editor-title{font-size:1.05rem;font-weight:750}
.field-label{font-size:.82rem;font-weight:700;color:var(--muted);margin-bottom:.25rem;display:block}
.field-sub{font-size:.78rem;color:var(--muted);margin-top:.2rem}
.field-input,.field-textarea{width:100%;padding:.45rem .65rem;border:1px solid var(--border);border-radius:7px;background:var(--panel-soft);color:var(--text);font:inherit;font-size:.9rem;outline:none;box-sizing:border-box}
.field-input:focus,.field-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.field-textarea{font-family:monospace;font-size:.86rem;min-height:200px;resize:vertical;line-height:1.5}
.editor-actions{display:flex;gap:.5rem;justify-content:flex-end}
.empty-state{padding:2.5rem;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:10px}
.del-btn{color:var(--err) !important;border-color:var(--err) !important}
.del-btn:hover{background:rgba(240,107,107,.08) !important}
</style>`;

  const body = `${sidebar}<main class="content">${pageStyles}
<div class="hero"><h1>Skills</h1><p>Reusable commands invoked with <code style="background:var(--panel-soft);padding:1px 6px;border-radius:4px;font-size:.9em">/name</code> in chat. The skill body fills the message field to run a prepared instruction.</p></div>
<div class="page-actions"><button class="action-button" onclick="openEditor(null)">+ New skill</button></div>
<div id="skills-list"></div>

<div class="editor-overlay" id="editor-overlay" onclick="handleOverlayClick(event)">
  <div class="editor-panel" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div class="editor-title" id="editor-title">New skill</div>
      <button class="action-button" onclick="closeEditor()">✕</button>
    </div>
    <div>
      <label class="field-label" for="f-name">Name <span style="color:var(--err)">*</span></label>
      <input class="field-input" id="f-name" type="text" placeholder="pipeline" pattern="[a-zA-Z0-9_-]{1,60}" autocomplete="off">
      <div class="field-sub">Letters, digits, - and _ only. Invoked as /name in chat.</div>
    </div>
    <div>
      <label class="field-label" for="f-desc">Description</label>
      <input class="field-input" id="f-desc" type="text" placeholder="Run the full pipeline through the production agent">
    </div>
    <div>
      <label class="field-label" for="f-params">Parameters <span style="font-weight:400;color:var(--muted)">(comma-separated)</span></label>
      <input class="field-input" id="f-params" type="text" placeholder="space, template">
      <div class="field-sub">Example: <code style="font-size:.85em">space</code> is referenced in the body as <code style="font-size:.85em">{space}</code>.</div>
    </div>
    <div>
      <label class="field-label" for="f-body">Skill body <span style="color:var(--err)">*</span></label>
      <textarea class="field-textarea" id="f-body" placeholder="Check CME status with cme_status, then run cme_export_run(source_name=&quot;{space}&quot;)..."></textarea>
      <div class="field-sub">Natural-language instructions the LLM will follow. Parameters are inserted as placeholders to replace before sending.</div>
    </div>
    <div class="editor-actions">
      <button class="action-button" onclick="closeEditor()">Cancel</button>
      <button class="action-button" style="background:var(--accent);color:#fff;border-color:var(--accent)" onclick="saveSkill()">Save</button>
    </div>
  </div>
</div>

<script>
let skills=[];

async function loadSkills(){
  const r=await fetch('/api/skills');
  if(!r.ok){document.getElementById('skills-list').innerHTML='<div class="empty-state"><p>Unable to load skills.</p></div>';return;}
  skills=await r.json();
  renderList();
}

function renderList(){
  const el=document.getElementById('skills-list');
  if(!skills.length){
    el.innerHTML='<div class="empty-state"><p>No skills. Create your first skill with the button above.</p></div>';
    return;
  }
  el.innerHTML='<div class="skills-grid">'+skills.map(s=>\`
    <div class="skill-card">
      <div class="skill-card-name">/\${window.WikiUi.escapeHtml(s.name)}</div>
      \${s.description?'<div class="skill-card-desc">'+window.WikiUi.escapeHtml(s.description)+'</div>':''}
      \${s.params&&s.params.length?'<div class="skill-card-params">'+s.params.map(p=>'<span class="skill-param">{'+window.WikiUi.escapeHtml(p)+'}</span>').join('')+'</div>':''}
      \${s.body?'<div class="skill-card-body-preview">'+window.WikiUi.escapeHtml(s.body.slice(0,120))+(s.body.length>120?'…':'')+'</div>':''}
      <div class="skill-card-actions">
        <button class="action-button" onclick="openEditorByIndex(\${i})">Edit</button>
        <button class="action-button del-btn" onclick="deleteSkillByIndex(\${i})">Delete</button>
      </div>
    </div>
  \`).join('')+'</div>';
}

function openEditorByIndex(idx){openEditor(skills[idx]);}

function openEditor(skill){
  document.getElementById('editor-title').textContent=skill?'Edit /'+skill.name:'New skill';
  const nameEl=document.getElementById('f-name');
  nameEl.value=skill?.name??'';
  nameEl.disabled=!!skill;
  document.getElementById('f-desc').value=skill?.description??'';
  document.getElementById('f-params').value=(skill?.params??[]).join(', ');
  document.getElementById('f-body').value=skill?.body??'';
  document.getElementById('editor-overlay').classList.add('open');
  (skill?document.getElementById('f-body'):nameEl).focus();
}

function closeEditor(){document.getElementById('editor-overlay').classList.remove('open');}
function handleOverlayClick(e){if(e.target===document.getElementById('editor-overlay'))closeEditor();}

async function saveSkill(){
  const name=document.getElementById('f-name').value.trim();
  const description=document.getElementById('f-desc').value.trim();
  const params=document.getElementById('f-params').value.split(',').map(p=>p.trim()).filter(Boolean);
  const body=document.getElementById('f-body').value;
  if(!name){alert('Name is required.');return;}
  if(!body.trim()){alert('Skill body is required.');return;}
  const r=await fetch('/api/skills/'+encodeURIComponent(name),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({description,params,body}),
  });
  if(!r.ok){const e=await r.json();alert(e.error||'Error');return;}
  closeEditor();
  await loadSkills();
}

async function deleteSkill(name){
  if(!confirm('Delete skill /'+name+'?'))return;
  await fetch('/api/skills/'+encodeURIComponent(name),{method:'DELETE'});
  await loadSkills();
}

function deleteSkillByIndex(idx){
  const skill=skills[idx];
  if(skill) deleteSkill(skill.name);
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEditor();});
loadSkills();
</script>
</main>`;
  return layout('Skills', body);
}
