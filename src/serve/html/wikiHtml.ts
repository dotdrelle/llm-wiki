import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { marked } from 'marked';
import { WIKI_CSS_VARS } from '../../chat/theme.ts';
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

export { graphEtag, graphEtagForFiles, listGraphFiles };

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
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');
    ${WIKI_CSS_VARS}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Inter, system-ui, sans-serif;
      line-height: 1.65;
    }
    a { color: var(--link); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
    .source-citation {
      display: inline-block;
      max-width: 100%;
      padding: 0.08rem 0.28rem;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--panel-soft);
      color: var(--link);
      font-size: 0.86em;
      line-height: 1.35;
      overflow-wrap: anywhere;
      vertical-align: baseline;
      text-decoration: none;
    }
    .source-citation:hover { border-color: var(--accent); background: var(--accent-soft); }
    .source-citation-stale,
    .stale-reference {
      display: inline-block;
      max-width: 100%;
      padding: 0.08rem 0.28rem;
      border: 1px dashed var(--border);
      border-radius: 5px;
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 0.86em;
      line-height: 1.35;
      overflow-wrap: anywhere;
      vertical-align: baseline;
      text-decoration: none;
      cursor: help;
    }
    .stale-reference::after {
      content: " unavailable";
      color: var(--muted);
      font-size: 0.72em;
      font-weight: 680;
    }
    .app-shell { min-height: 100vh; display: grid; grid-template-columns: var(--wiki-sidebar-w, 280px) 6px minmax(0, 1fr); }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 1.25rem;
      background: #fbfcfd;
    }
    .wiki-main-resizer {
      position: sticky;
      top: 0;
      height: 100vh;
      cursor: col-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      border-left: 1px solid var(--border);
      border-right: 1px solid var(--border);
      background: #fbfcfd;
      touch-action: none;
      z-index: 2;
    }
    .wiki-main-resizer:hover,
    .wiki-main-resizer.dragging { background: var(--panel-soft); }
    .wiki-main-resizer::before {
      content: '';
      width: 3px;
      height: 34px;
      border-radius: 99px;
      background: var(--border);
    }
    .wiki-main-resizer:hover::before,
    .wiki-main-resizer.dragging::before { background: var(--muted); }
    .brand { display: block; margin-bottom: 0.8rem; color: var(--text); text-decoration: none; }
    .brand-title {
      display: block;
      font-family: "Playfair Display", sans-serif;
      font-size: 1.28rem;
      font-weight: 700;
      line-height: 1.08;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }
    .side-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .side-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-width: 0;
      min-height: 2.75rem;
      padding: 0 0.65rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 0.86rem;
      font-weight: 720;
    }
    .side-action:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .side-action svg { width: 1.05rem; height: 1.05rem; stroke: currentColor; flex-shrink: 0; }
    .side-action span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .side-search {
      margin: 0.9rem 0 0.65rem;
    }
    .side-search-input {
      width: 100%;
      min-height: 2.25rem;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      outline: none;
    }
    .side-search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .side-search-status {
      display: none;
      margin: 0.45rem 0 0;
      color: var(--muted);
      font-size: 0.78rem;
    }
    .side-search-status.is-visible { display: block; }
    .side-tree { margin-top: 1rem; font-size: 0.9rem; flex: 1 1 0; min-height: 0; overflow-y: auto; }
    .side-folder { margin: 0.08rem 0; }
    .side-folder summary {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      min-height: 2rem;
      padding: 0.28rem 0.45rem;
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .side-folder summary::-webkit-details-marker { display: none; }
    .side-folder summary::before {
      content: "▸";
      width: 0.8rem;
      color: var(--muted);
      font-size: 0.74rem;
      transition: transform 120ms ease;
    }
    .side-folder[open] > summary::before { transform: rotate(90deg); }
    .side-folder summary:hover { background: var(--panel-soft); color: var(--accent); }
    .side-folder-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 680;
    }
    .side-folder-action {
      margin-left: auto;
      min-width: 1.45rem;
      height: 1.45rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 760;
      line-height: 1;
    }
    .side-folder-action:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .side-folder-children {
      margin-left: 0.85rem;
      padding-left: 0.35rem;
      border-left: 1px solid var(--border);
    }
    .side-file {
      display: block;
      min-height: 1.85rem;
      padding: 0.24rem 0.45rem 0.24rem 1.2rem;
      border-radius: 6px;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-decoration: none;
      position: relative;
    }
    .side-file::before {
      content: "";
      position: absolute;
      left: 0.45rem;
      top: 0.78rem;
      width: 0.38rem;
      height: 0.38rem;
      border-radius: 999px;
      background: var(--muted);
      opacity: 0.55;
    }
    .side-file:hover, .side-file.is-active {
      background: var(--panel-soft);
      color: var(--accent);
    }
    .side-file.is-active { font-weight: 720; }
    .side-file.is-active::before { background: var(--accent); opacity: 1; }
    .side-file[data-deliverable-kind="build"]::before { background: #6b7f2a; opacity: 0.8; }
    .side-file[data-deliverable-kind="export"]::before { background: #176b87; opacity: 0.85; }
    .side-file[data-deliverable-kind="polish"]::before { background: #8b5cf6; opacity: 0.85; }
    .side-folder.is-search-hidden, .side-file.is-search-hidden { display: none; }
    .side-pending-resizer {
      display: none;
      flex-shrink: 0;
      height: 8px;
      cursor: row-resize;
      align-items: center;
      justify-content: center;
      touch-action: none;
    }
    .side-pending-resizer.is-visible { display: flex; }
    .side-pending-resizer:hover,
    .side-pending-resizer.dragging { background: var(--panel-soft); }
    .side-pending-resizer::before {
      content: '';
      width: 34px;
      height: 3px;
      border-radius: 99px;
      background: var(--border);
    }
    .side-pending-resizer:hover::before,
    .side-pending-resizer.dragging::before { background: var(--muted); }
    .side-untracked {
      flex: 0 0 auto;
      margin-top: 0;
      padding-top: 0.4rem;
      border-top: 1px solid var(--border);
      min-height: 0;
    }
    .side-untracked[open] {
      flex: 0 0 var(--pending-height, 32vh);
      overflow: hidden;
    }
    .side-untracked summary {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2rem;
      padding: 0.28rem 0.45rem;
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      list-style: none;
      user-select: none;
      font-weight: 760;
    }
    .side-untracked summary::-webkit-details-marker { display: none; }
    .side-untracked summary::before {
      content: "▸";
      width: 0.8rem;
      color: var(--muted);
      font-size: 0.74rem;
      transition: transform 120ms ease;
    }
    .side-untracked[open] > summary::before { transform: rotate(90deg); }
    .side-untracked summary:hover { background: var(--panel-soft); color: var(--accent); }
    .side-untracked-count {
      margin-left: auto;
      min-width: 1.45rem;
      height: 1.45rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.76rem;
      font-weight: 820;
    }
    .side-untracked-list {
      overflow-y: auto;
      scrollbar-width: thin;
      max-height: calc(var(--pending-height, 32vh) - 3rem);
      margin: 0.25rem 0 0;
      padding: 0 0 0.25rem;
      list-style: none;
    }
    .side-untracked-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      min-height: 1.55rem;
      border-radius: 5px;
    }
    .side-untracked-link {
      flex: 1;
      min-width: 0;
      padding: 0.15rem 1.2rem 0.15rem 1rem;
      color: var(--text);
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-decoration: none;
      position: relative;
    }
    .side-untracked-link::before {
      content: "";
      position: absolute;
      left: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      width: 0.32rem;
      height: 0.32rem;
      border-radius: 999px;
      background: #b7791f;
      opacity: 0.85;
    }
    .side-untracked-link:hover {
      background: var(--panel-soft);
      color: var(--accent);
    }
    .side-untracked-link:hover::after {
      content: "✏";
      position: absolute;
      right: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.7rem;
      opacity: 0.55;
    }
    .side-untracked-delete {
      flex: 0 0 auto;
      width: 1.55rem;
      height: 1.55rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      border-radius: 5px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: 1rem;
      line-height: 1;
    }
    .side-untracked-delete:hover { border-color: var(--err); background: color-mix(in srgb, var(--err) 10%, var(--panel)); color: var(--err); }
    .side-untracked-empty {
      margin: 0.45rem 0.45rem 0;
      color: var(--muted);
      font-size: 0.82rem;
    }
    .side-link {
      display: block;
      margin: 0.45rem 0;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 680;
    }
    .side-link:hover { border-color: var(--accent); background: var(--accent-soft); }
    .ws-switcher { flex-shrink: 0; padding-top: 0.75rem; border-top: 1px solid var(--border); }
    .ws-switcher-title { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.4rem; padding: 0 0.2rem; }
    .ws-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; border-radius: 5px; font-size: 0.85rem; }
    .ws-item.ws-active { background: var(--accent-soft); font-weight: 680; }
    .ws-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
    .ws-dot.running { background: #4caf50; }
    .ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .ws-btn { font-size: 0.72rem; padding: 0.15rem 0.45rem; border: 1px solid var(--border); border-radius: 4px; background: var(--panel); color: var(--text); cursor: pointer; white-space: nowrap; }
    .ws-btn:hover:not(:disabled) { border-color: var(--accent); }
    .ws-btn:disabled { opacity: 0.45; cursor: default; }
    .content { min-width: 0; padding: 2rem clamp(1rem, 3vw, 3rem) 3rem; }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .topbar nav { min-width: 0; }
    .topbar nav a { color: inherit; }
    .topbar nav a + a::before { content: " / "; color: var(--muted); }
    .page-actions { display: flex; gap: 0.5rem; align-items: center; }
    .page-actions form { margin: 0; }
    .action-link, .action-button {
      display: inline-flex;
      align-items: center;
      min-height: 2rem;
      padding: 0.35rem 0.65rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 0.86rem;
      font-weight: 680;
      text-decoration: none;
      cursor: pointer;
    }
    .action-link:hover, .action-button:hover {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .action-danger { color: var(--err); border-color: color-mix(in srgb, var(--err) 55%, var(--border)); }
    .action-danger:hover { border-color: var(--err); background: color-mix(in srgb, var(--err) 10%, var(--panel)); color: var(--err); }
    .delete-confirm { position: relative; }
    .delete-confirm-panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.45rem);
      z-index: 20;
      width: min(20rem, calc(100vw - 2rem));
      padding: 0.8rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
    }
    .delete-confirm-panel[hidden] { display: none; }
    .delete-confirm-title { margin: 0 0 0.25rem; font-weight: 760; color: var(--text); }
    .delete-confirm-text { margin: 0 0 0.7rem; color: var(--muted); font-size: 0.84rem; line-height: 1.45; }
    .delete-confirm-actions { display: flex; justify-content: flex-end; gap: 0.45rem; }
    .hero {
      margin-bottom: 1.5rem;
      padding: clamp(1.3rem, 3vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .hero h1 { margin: 0; font-family: "Playfair Display", sans-serif; font-size: clamp(1.7rem, 3vw, 2.55rem); line-height: 1.05; letter-spacing: 0; }
    .hero p { max-width: 72ch; margin: 0.75rem 0 0; color: var(--muted); }
    .index-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
      gap: 1rem;
      align-items: start;
    }
    .index-aside {
      position: sticky;
      top: 1rem;
      min-width: 0;
    }
    .index-aside-title {
      margin: 0 0 0.7rem;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 780;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .section-browser {
      margin: 0 0 0.75rem;
    }
    .section-browser summary {
      list-style: none;
      cursor: pointer;
    }
    .section-browser summary::-webkit-details-marker { display: none; }
    .section-browser-summary {
      display: flex;
      min-height: 72px;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.9rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 1px 1px rgba(23, 32, 42, 0.04);
    }
    .section-browser summary:hover .section-browser-summary,
    .section-browser[open] .section-browser-summary {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .section-browser-title { font-weight: 760; overflow-wrap: anywhere; }
    .section-browser-meta { margin-top: 0.45rem; color: var(--muted); font-size: 0.82rem; }
    .section-browser-tiles {
      margin-top: 0.6rem;
      display: grid;
      gap: 0.6rem;
    }
    .section-browser-group {
      margin-top: 0.55rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .section-browser-group summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 2.2rem;
      padding: 0.55rem 0.7rem;
      color: var(--text);
      font-size: 0.86rem;
      font-weight: 730;
    }
    .section-browser-group summary span:last-child {
      color: var(--muted);
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
      font-weight: 650;
    }
    .section-browser-group .section-browser-tiles {
      margin: 0;
      padding: 0.6rem;
      border-top: 1px solid var(--border);
      background: var(--panel-soft);
    }
    .tile-section { margin: 1.5rem 0 2rem; }
    .index-aside .tile-section { margin: 0 0 1rem; }
    .section-title { margin: 0 0 0.65rem; font-size: 0.98rem; color: var(--muted); font-weight: 760; }
    .tile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.8rem;
    }
    .index-aside .tile-grid { grid-template-columns: 1fr; }
    .tile {
      display: flex;
      min-height: 92px;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.95rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      box-shadow: 0 1px 1px rgba(23, 32, 42, 0.04);
    }
    .tile[href]:hover { border-color: var(--accent); background: var(--accent-soft); }
    .tile-title { font-weight: 720; line-height: 1.25; overflow-wrap: anywhere; }
    .tile-meta { margin-top: 0.7rem; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
    .article {
      max-width: 960px;
      padding: clamp(1.1rem, 2.6vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .article h1, .article h2, .article h3 { line-height: 1.2; letter-spacing: 0; }
    .article h1 { margin-top: 0; }
    .article img { max-width: 100%; }
    .index-layout .article ul { columns: 2; column-gap: 2rem; }
    .index-layout .article ul li { break-inside: avoid; }
    .log-article {
      max-width: 1160px;
      padding: clamp(1.1rem, 2.6vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .log-article h1 {
      margin: 0 0 1rem;
      font-family: "Playfair Display", sans-serif;
      line-height: 1.05;
      letter-spacing: 0;
    }
    .log-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.7rem;
    }
    .log-entry {
      display: grid;
      gap: 0.55rem;
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
    }
    .log-entry-system { display: flex; align-items: center; gap: 0.6rem; }
    .log-entry-head {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      flex-wrap: wrap;
    }
    .log-date {
      font: 0.78rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      color: var(--muted);
    }
    .log-kind {
      display: inline-flex;
      align-items: center;
      min-height: 1.35rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.72rem;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .log-flow {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto minmax(0, 1fr);
      gap: 0.35rem 0.55rem;
      align-items: center;
      font-size: 0.84rem;
    }
    .log-flow-label {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .log-path {
      min-width: 0;
      padding: 0.28rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: 0.78rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
      text-decoration: none;
    }
    a.log-path:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .log-arrow { color: var(--muted); font-weight: 760; }
    .log-summary {
      margin: 0;
      color: var(--text);
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .edit-form {
      display: grid;
      gap: 0.85rem;
    }
    .edit-form .hero {
      position: sticky;
      top: 0.75rem;
      z-index: 8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-width: 0;
      padding: 0.85rem 1rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 94%, transparent);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
    }
    .edit-form .hero .page-actions {
      flex-shrink: 0;
    }
    .edit-path-label {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      color: var(--muted);
      word-break: break-all;
    }
    .edit-file-state {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      padding: 0.12rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      background: var(--panel-soft);
      font-family: inherit;
      font-size: 0.72rem;
      font-weight: 760;
      line-height: 1.35;
      white-space: nowrap;
    }
    .edit-file-state.is-new {
      border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
      color: var(--accent);
      background: var(--accent-soft);
    }
    .edit-textarea {
      width: 100%;
      min-height: min(66vh, 760px);
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      font: 0.92rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      line-height: 1.55;
      resize: vertical;
      outline: none;
    }
    .edit-textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .field-label { font-size: 0.82rem; font-weight: 700; color: var(--muted); margin-bottom: -0.45rem; display: block; }
    .field-input {
      width: 100%;
      min-height: 2.35rem;
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      outline: none;
    }
    .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    pre { background: #edf1f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
    th, td { border: 1px solid var(--border); padding: 0.45rem 0.75rem; text-align: left; }
    blockquote { border-left: 3px solid var(--accent); margin: 1rem 0; padding-left: 1rem; color: var(--muted); }
    .empty { color: var(--muted); }
    .not-found-panel {
      max-width: 760px;
      padding: clamp(1.4rem, 3vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .not-found-path {
      display: block;
      margin: 1rem 0;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-soft);
      color: var(--muted);
      font: 0.82rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
    }
    .graph-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .graph-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      gap: 1rem;
      align-items: stretch;
    }
    .graph-layout.relations-collapsed { grid-template-columns: minmax(0, 1fr) 2.8rem; }
    .graph-page-expanded .hero { display: none; }
    .graph-page-expanded { padding-top: 1rem; padding-bottom: 1rem; }
    .graph-page-expanded .graph-legend {
      position: fixed;
      bottom: 1.1rem;
      left: var(--graph-legend-left, 1rem);
      z-index: 5;
      max-width: calc(100vw - var(--graph-legend-left, 1rem) - 1rem);
      margin: 0;
      padding: 0.35rem 0.85rem;
      background: color-mix(in srgb, var(--panel) 90%, transparent);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.78rem;
      gap: 0.55rem;
    }
    .graph-layout.graph-expanded { grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); }
    .graph-layout.graph-expanded.relations-collapsed { grid-template-columns: minmax(0, 1fr) 2.8rem; }
    .graph-layout.graph-expanded .graph-stage { height: calc(100vh - 9.5rem); max-height: none; }
    .graph-layout.graph-expanded .relation-panel { max-height: calc(100vh - 9.5rem); }
    .graph-stage { height: min(68vh, 720px); min-height: 440px; touch-action: none; }
    .graph-svg.is-panning { cursor: grabbing; }
    .graph-svg { display: block; width: 100%; height: 100%; background: radial-gradient(circle at 50% 50%, var(--panel-soft), transparent 68%); }
    .graph-link { stroke: var(--border); stroke-width: 1.2; opacity: 0.72; }
    .graph-link.is-connected { stroke: var(--accent); stroke-width: 2.2; opacity: 1; }
    .graph-link.is-hovered { stroke: #2f9e44; stroke-width: 3; opacity: 1; }
    .graph-node { cursor: grab; }
    .graph-node.is-dragging { cursor: grabbing; }
    .graph-node.is-dimmed { opacity: 0.25; }
    .graph-node circle { stroke: var(--panel); stroke-width: 2.5; }
    .graph-node text { fill: var(--text); font-size: 12px; font-weight: 680; paint-order: stroke; stroke: var(--panel); stroke-width: 4px; }
    .graph-node:hover circle { stroke: var(--accent); stroke-width: 3; }
    .graph-node.is-selected circle { stroke: var(--accent); stroke-width: 4; }
    .graph-node.is-hovered circle { stroke: #2f9e44; stroke-width: 4; }
    .graph-node.raw-source circle { fill: #d7663b; }
    .graph-node.wiki-source circle { fill: #0e7490; }
    .graph-node.wiki circle { fill: #c8a500; }
    .graph-node.template circle { fill: #7c3aed; }
    .graph-node.build-context circle { fill: #2563eb; }
    .graph-node.deliverable circle { fill: #6b7f2a; }
    .graph-node-secondary { fill: var(--muted) !important; font-size: 9px !important; font-weight: 520 !important; }
    .graph-link.cites { stroke-dasharray: 4 4; }
    .graph-link.generated_from,
    .graph-link.uses_template,
    .graph-link.uses_context { stroke: #64748b; }
    .graph-link.produces { stroke: #6b7f2a; }
    .graph-search-wrapper { padding: 0.65rem 0.75rem; }
    .graph-toolbar { display: flex; gap: 0.4rem; align-items: center; }
    .graph-search-field { position: relative; flex: 1 1 0; min-width: 0; }
    .graph-search-input { width: 100%; padding: 0.45rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; font-size: 0.9rem; box-sizing: border-box; }
    .graph-search-input:focus { outline: none; border-color: var(--accent); }
    .graph-search-dropdown { position: absolute; top: calc(100% + 2px); left: 0; right: 0; z-index: 10; list-style: none; margin: 0; padding: 0.3rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); box-shadow: var(--shadow); max-height: 240px; overflow: auto; }
    .graph-mode-group { display: inline-flex; gap: 0.2rem; padding: 0.16rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-soft); }
    .graph-mode-btn { min-height: 1.68rem; padding: 0 0.45rem; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font: inherit; font-size: 0.76rem; font-weight: 760; cursor: pointer; }
    .graph-mode-btn.is-active { background: var(--panel); color: var(--text); box-shadow: 0 0 0 1px var(--border); }
    .graph-ctrl-group { display: flex; gap: 0.25rem; flex: 0 0 auto; }
    .graph-ctrl-btn { width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--text); font: inherit; font-size: 1rem; font-weight: 760; cursor: pointer; padding: 0; line-height: 1; }
    .graph-ctrl-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
    .graph-search-result { display: grid; grid-template-columns: 0.65rem 1fr; grid-template-rows: auto auto; gap: 0 0.5rem; padding: 0.45rem 0.55rem; border-radius: 5px; cursor: pointer; align-items: center; }
    .graph-search-result:hover { background: var(--accent-soft); }
    .graph-search-result-dot { grid-row: 1 / 3; width: 0.65rem; height: 0.65rem; border-radius: 999px; background: var(--accent); align-self: center; }
    .graph-search-result-dot.raw-source { background: #d7663b; }
    .graph-search-result-dot.wiki-source { background: #0e7490; }
    .graph-search-result-dot.wiki { background: #c8a500; }
    .graph-search-result-dot.template { background: #7c3aed; }
    .graph-search-result-dot.build-context { background: #2563eb; }
    .graph-search-result-dot.deliverable { background: #6b7f2a; }
    .graph-search-result-title { font-size: 0.88rem; font-weight: 620; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-search-result-path { font-size: 0.76rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-search-empty { padding: 0.55rem 0.65rem; color: var(--muted); font-size: 0.88rem; }
    .graph-legend { display: flex; flex-wrap: wrap; gap: 0.65rem; margin: 0.75rem 0 1.25rem; color: var(--muted); font-size: 0.9rem; }
    .legend-item::before { content: ""; display: inline-block; width: 0.7rem; height: 0.7rem; margin-right: 0.35rem; border-radius: 999px; vertical-align: -0.05rem; background: var(--accent); }
    .legend-item.raw-source::before { background: #d7663b; }
    .legend-item.wiki-source::before { background: #0e7490; }
    .legend-item.wiki::before { background: #c8a500; }
    .legend-item.template::before { background: #7c3aed; }
    .legend-item.build-context::before { background: #2563eb; }
    .legend-item.deliverable::before { background: #6b7f2a; }
    .graph-list-view { position: absolute; inset: 3.7rem 0 0; overflow: auto; padding: 0.7rem; background: var(--panel); }
    .graph-list-row { width: 100%; display: grid; grid-template-columns: 0.8rem 1fr auto; gap: 0.55rem; align-items: center; padding: 0.55rem 0.65rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); text-align: left; font: inherit; cursor: pointer; }
    .graph-list-row + .graph-list-row { margin-top: 0.45rem; }
    .graph-list-row small { display: block; margin-top: 0.12rem; color: var(--muted); font-size: 0.74rem; overflow-wrap: anywhere; }
    .graph-list-row em { color: var(--muted); font-size: 0.72rem; font-style: normal; font-weight: 760; }
    .graph-list-row.is-dimmed { opacity: 0.32; }
    .relation-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
      min-height: 440px;
      max-height: min(68vh, 720px);
      display: flex;
      flex-direction: column;
    }
    .graph-layout.relations-collapsed .relation-panel { min-width: 2.8rem; }
    .relation-panel-header {
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
    }
    .relation-panel-copy { min-width: 0; flex: 1; }
    .relation-toggle {
      flex: 0 0 auto;
      width: 1.9rem;
      height: 1.9rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      cursor: pointer;
      font: inherit;
      font-size: 1rem;
      line-height: 1;
    }
    .relation-toggle:hover { border-color: var(--accent); background: var(--accent-soft); }
    .graph-layout.relations-collapsed .relation-panel-header {
      height: auto;
      padding: 0.55rem 0.45rem;
      align-items: flex-start;
      justify-content: center;
      border-bottom: 0;
      writing-mode: vertical-rl;
    }
    .graph-layout.relations-collapsed .relation-panel-copy,
    .graph-layout.relations-collapsed .relation-list { display: none; }
    .graph-layout.relations-collapsed .relation-toggle {
      writing-mode: horizontal-tb;
      transform: rotate(90deg);
    }
    .relation-panel-title { margin: 0; font-size: 1rem; }
    .relation-panel-meta { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.82rem; }
    .relation-inspector { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.18rem 0.5rem; margin: 0.55rem 0 0; font-size: 0.76rem; }
    .relation-inspector dt { color: var(--muted); font-weight: 760; }
    .relation-inspector dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .relation-node-open {
      display: inline-flex;
      margin-top: 0.45rem;
      color: var(--link);
      font-size: 0.86rem;
      font-weight: 680;
      text-decoration: underline;
      text-underline-offset: 0.18em;
    }
    .relation-node-open[hidden] { display: none; }
    .relation-list { list-style: none; margin: 0; padding: 0.65rem; overflow: auto; display: grid; gap: 0.55rem; }
    .relation-item {
      padding: 0.7rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
    }
    .relation-item.is-active { border-color: var(--accent); background: var(--accent-soft); }
    .relation-item.is-hovered { border-color: #2f9e44; box-shadow: inset 3px 0 0 #2f9e44; }
    .relation-kind { display: inline-flex; margin-bottom: 0.42rem; padding: 0.08rem 0.38rem; border-radius: 999px; background: var(--panel-soft); color: var(--muted); font-size: 0.68rem; font-weight: 780; text-transform: uppercase; }
    .relation-group-label {
      margin: 0.35rem 0 0.15rem;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 760;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .relation-path { display: block; color: var(--text); font-size: 0.86rem; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-title { display: block; color: var(--text); font-size: 0.9rem; font-weight: 720; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-subpath { display: block; margin-top: 0.12rem; color: var(--muted); font-size: 0.74rem; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-arrow { display: block; margin: 0.3rem 0; color: var(--muted); font-size: 1rem; text-align: center; line-height: 1; }
    .relation-open {
      margin-top: 0.55rem;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--link);
      font: inherit;
      font-size: 0.86rem;
      font-weight: 680;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 0.18em;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      background: rgba(10, 14, 18, 0.58);
    }
    .modal-backdrop.is-open { display: flex; }
    .relation-modal {
      width: min(1120px, 100%);
      max-height: min(86vh, 900px);
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .modal-title { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
    .modal-close {
      flex: 0 0 auto;
      width: 2rem;
      height: 2rem;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      font-weight: 680;
      cursor: pointer;
    }
    .modal-close:hover { border-color: var(--accent); background: var(--accent-soft); }
    .modal-body { min-height: 0; overflow: auto; }
    .modal-doc { min-width: 0; padding: 0.85rem 0.95rem; }
    .modal-doc-title { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.76rem; overflow-wrap: anywhere; }
    .modal-markdown { overflow-wrap: anywhere; font-size: 0.88rem; line-height: 1.45; }
    .modal-markdown h1, .modal-markdown h2, .modal-markdown h3 { line-height: 1.18; margin: 0.85rem 0 0.38rem; font-size: 1rem; }
    .modal-markdown h1:first-child, .modal-markdown h2:first-child, .modal-markdown h3:first-child { margin-top: 0; }
    .modal-markdown p, .modal-markdown ul, .modal-markdown ol { margin: 0.5rem 0; }
    .modal-markdown li { margin: 0.2rem 0; }
    .modal-markdown pre { white-space: pre-wrap; font-size: 0.78rem; line-height: 1.4; }
    @media (max-width: 760px) {
      .app-shell { display: block; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
      .wiki-main-resizer { display: none; }
      .content { padding: 1rem; }
      .topbar { display: block; }
      .index-layout { grid-template-columns: 1fr; }
      .index-aside { position: static; }
      .graph-layout { grid-template-columns: 1fr; }
      .log-flow { grid-template-columns: 1fr; }
      .log-arrow { display: none; }
    }
    @media (prefers-color-scheme: dark) {
      .sidebar, .wiki-main-resizer { background: #121820; }
      pre { background: #101419; }
    }
    /* ── Dashboard stats ──────────────────────────────────────── */
    .ws-stats{display:flex;flex-wrap:wrap;gap:.65rem;margin-bottom:1.5rem}
    .ws-stat{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:88px;padding:.75rem 1rem;border:1px solid var(--border);border-radius:8px;background:var(--panel);text-align:center;gap:.2rem}
    .ws-stat-n{font-size:1.6rem;font-weight:800;line-height:1;color:var(--accent)}
    .ws-stat-l{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
    .ws-stat-warn .ws-stat-n{color:#c07000}
    .ws-stat-warn{border-color:rgba(192,112,0,.25)}
    .ws-stat-muted .ws-stat-n{font-size:.95rem;font-weight:700}
    /* ── Onboarding ───────────────────────────────────────────── */
    .onboarding{max-width:720px}
    .onboarding-steps{display:grid;gap:.75rem;margin-top:1.25rem}
    .onboarding-step{display:flex;gap:.9rem;align-items:flex-start;padding:.9rem 1rem;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
    .onboarding-step-num{width:2rem;height:2rem;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem;flex-shrink:0;margin-top:.1rem}
    .onboarding-step-body{min-width:0}
    .onboarding-step-title{font-weight:760;margin-bottom:.3rem}
    .onboarding-step-desc{font-size:.88rem;color:var(--muted);line-height:1.5}
    .onboarding-step-code{font-family:ui-monospace,monospace;font-size:.82rem;background:var(--panel-soft);border:1px solid var(--border);padding:.1rem .38rem;border-radius:4px;color:var(--text)}
    /* ── ⌘K Palette ──────────────────────────────────────────── */
    .palette-backdrop{position:fixed;inset:0;z-index:9000;display:none;align-items:flex-start;justify-content:center;padding-top:10vh;background:rgba(10,14,18,.42);backdrop-filter:blur(3px)}
    .palette-backdrop.is-open{display:flex}
    .palette{width:min(700px,calc(100vw - 2rem));border:1px solid var(--border);border-radius:14px;background:var(--panel);box-shadow:0 24px 64px rgba(0,0,0,.22),0 4px 12px rgba(0,0,0,.1);overflow:hidden;animation:paletteIn .13s ease}
    @keyframes paletteIn{from{opacity:0;transform:translateY(-10px) scale(.97)}to{opacity:1;transform:none}}
    .palette-head{display:flex;align-items:center;gap:.65rem;padding:1rem 1.2rem;border-bottom:1px solid var(--border)}
    .palette-search-icon{color:var(--muted);flex-shrink:0}
    .palette-input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font:inherit;font-size:1.05rem}
    .palette-input::placeholder{color:var(--muted)}
    .palette-esc{font-size:.72rem;font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px;color:var(--muted)}
    .palette-results{max-height:min(58vh,480px);overflow-y:auto;padding:.5rem}
    .palette-item{display:flex;align-items:center;gap:.6rem;padding:.5rem .65rem;border-radius:7px;cursor:pointer;text-decoration:none;color:var(--text)}
    .palette-item.is-sel,.palette-item:hover{background:var(--accent-soft);color:var(--accent)}
    .palette-item-icon{width:1.9rem;height:1.9rem;border-radius:6px;background:var(--panel-soft);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0}
    .palette-item-body{min-width:0;flex:1}
    .palette-item-title{font-size:.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .palette-item-path{font-size:.73rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,monospace}
    .palette-item.is-sel .palette-item-path,.palette-item:hover .palette-item-path{opacity:.7;color:inherit}
    .palette-tag{font-size:.66rem;font-weight:700;padding:.1rem .38rem;border-radius:99px;flex-shrink:0}
    .palette-tag.wiki{background:rgba(200,165,0,.14);color:#9a7a00}
    .palette-tag.deliverables{background:rgba(107,127,42,.14);color:#5a6820}
    .palette-tag.templates{background:rgba(23,107,135,.14);color:var(--accent)}
    .palette-tag.build-context{background:rgba(120,80,200,.14);color:#6040b0}
    .palette-empty{padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.9rem}
    .palette-footer{display:flex;gap:1rem;padding:.5rem 1rem;border-top:1px solid var(--border);background:var(--bg)}
    .palette-hint{display:flex;align-items:center;gap:.38rem;font-size:.73rem;color:var(--muted)}
    .palette-hint kbd{font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.1rem .38rem;border-radius:4px;font-size:.7rem}
    @media(prefers-color-scheme:dark){.palette-tag.wiki{color:#d4a800}.palette-tag.deliverables{color:#9abc40}}
    /* ── TOC ──────────────────────────────────────────────────── */
    .doc-toc{position:fixed;top:5rem;right:1.5rem;width:200px;max-height:calc(100vh - 8rem);overflow-y:auto;display:flex;flex-direction:column;gap:.15rem;padding:.75rem;background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .doc-toc-title{font-size:.7rem;font-weight:780;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 .5rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)}
    .doc-toc-item{font-size:.8rem;color:var(--muted);text-decoration:none;line-height:1.35;padding:.18rem .3rem;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .doc-toc-item:hover,.doc-toc-item.is-active{color:var(--accent);background:var(--accent-soft)}
    .doc-toc-h3{padding-left:1rem;font-size:.76rem}
    @media(max-width:1280px){.doc-toc{display:none}}
    /* ── Stabilize tags ───────────────────────────────────────── */
    .section-tag{display:inline-flex;align-items:center;margin-left:.5rem;padding:.08rem .42rem;border:1px solid var(--border);border-radius:999px;background:var(--panel-soft);color:var(--muted);font-size:.58rem;font-weight:760;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5}
    .section-tag-modified{border-color:color-mix(in srgb,var(--accent) 35%,var(--border));color:var(--accent);background:var(--accent-soft)}
    .section-tag-inserted{border-color:color-mix(in srgb,#22c55e 35%,var(--border));color:#16a34a;background:rgba(34,197,94,.08)}
    .stabilize-badge{display:inline-flex;align-items:center;gap:.4rem;padding:.28rem .65rem;margin-bottom:1rem;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--muted);font-size:.78rem}
    /* ── Print ─────────────────────────────────────────────────── */
    @media print{.sidebar,.page-actions,.palette-backdrop,.doc-toc{display:none!important}.app-shell{display:block}.content{padding:0}.article{border:none;border-radius:0;max-width:100%;box-shadow:none}body{font-size:11pt;line-height:1.5}.topbar{display:none}}
  </style>
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
<script>
(() => {
  const storagePrefix = 'llm-wiki:sidebar:';
  const searchKey = storagePrefix + 'search';
  const scrollKey = storagePrefix + 'scrollTop';
  const currentPath = decodeURIComponent(window.location.pathname).replace(/^\\//, '');
  const sidebar = document.querySelector('.sidebar');
  const sideTree = document.querySelector('.side-tree');
  const searchInput = document.querySelector('[data-side-search]');
  const searchStatus = document.querySelector('[data-side-search-status]');
  const sideFiles = [...document.querySelectorAll('[data-side-path]')];
  const sideFolders = [...document.querySelectorAll('[data-tree-id]')];
  function saveSidebarState() {
    if (searchInput) localStorage.setItem(searchKey, searchInput.value);
    if (sideTree) localStorage.setItem(scrollKey, String(sideTree.scrollTop));
  }
  document.querySelectorAll('[data-tree-id]').forEach((details) => {
    const id = details.getAttribute('data-tree-id');
    const key = storagePrefix + id;
    const saved = localStorage.getItem(key);
    if (saved === 'open') details.open = true;
    if (saved === 'closed') details.open = false;
    if (currentPath && (currentPath === id || currentPath.startsWith(id + '/'))) {
      details.open = true;
    }
    details.addEventListener('toggle', () => {
      localStorage.setItem(key, details.open ? 'open' : 'closed');
    });
  });
  document.querySelectorAll('[data-side-path]').forEach((link) => {
    if (link.getAttribute('data-side-path') === currentPath) {
      link.classList.add('is-active');
    }
    link.addEventListener('click', saveSidebarState);
  });
  function syncUntrackedCount() {
    const countEl = document.querySelector('[data-untracked-count]');
    const list = document.querySelector('[data-untracked-list]');
    if (!countEl || !list) return;
    const next = list.querySelectorAll('.side-untracked-item').length;
    countEl.textContent = String(next);
    if (next === 0) list.innerHTML = '<li class="side-untracked-empty">No pending sources.</li>';
  }
  document.querySelectorAll('[data-untracked-delete]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const relativePath = button.getAttribute('data-untracked-delete') || '';
      if (!relativePath) return;
      if (!confirm('Delete this pending source?\\n' + relativePath)) return;
      button.disabled = true;
      try {
        const response = await fetch('/api/untracked/' + encodeURIComponent(relativePath), { method: 'DELETE' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Delete failed');
        button.closest('.side-untracked-item')?.remove();
        syncUntrackedCount();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
        button.disabled = false;
      }
    });
  });
  function folderHasVisibleFile(folder) {
    return Boolean(folder.querySelector('[data-side-path]:not(.is-search-hidden)'));
  }
  function applySidebarSearch() {
    const query = window.WikiUi.normalizeSearch(searchInput?.value.trim() || '');
    let matchCount = 0;
    if (!query) {
      sideFiles.forEach((link) => link.classList.remove('is-search-hidden'));
      sideFolders.forEach((folder) => folder.classList.remove('is-search-hidden'));
      searchStatus?.classList.remove('is-visible');
      return;
    }
    for (const link of sideFiles) {
      const haystack = window.WikiUi.normalizeSearch((link.getAttribute('data-side-path') || '') + ' ' + link.textContent);
      const matches = haystack.includes(query);
      link.classList.toggle('is-search-hidden', !matches);
      if (matches) {
        matchCount += 1;
        link.closest('[data-tree-id]')?.setAttribute('open', '');
      }
    }
    for (const folder of [...sideFolders].reverse()) {
      const visible = folderHasVisibleFile(folder);
      folder.classList.toggle('is-search-hidden', !visible);
      if (visible) folder.open = true;
    }
    if (searchStatus) {
      searchStatus.textContent = matchCount === 0 ? 'No matching files.' : matchCount + ' matching file' + (matchCount > 1 ? 's.' : '.');
      searchStatus.classList.add('is-visible');
    }
  }
  if (searchInput) {
    searchInput.value = localStorage.getItem(searchKey) || '';
    searchInput.addEventListener('input', () => {
      localStorage.setItem(searchKey, searchInput.value);
      applySidebarSearch();
    });
  }
  sideTree?.addEventListener('scroll', () => {
    localStorage.setItem(scrollKey, String(sideTree.scrollTop));
  }, { passive: true });
  window.addEventListener('beforeunload', saveSidebarState);
  applySidebarSearch();
  requestAnimationFrame(() => {
    const savedScroll = Number(localStorage.getItem(scrollKey) || '0');
    if (sideTree && Number.isFinite(savedScroll)) sideTree.scrollTop = savedScroll;
  });

  // ── main sidebar resizer ─────────────────────────────────────────────────
  (function initMainSidebarResizer() {
    const shell = document.querySelector('.app-shell');
    const handle = document.querySelector('[data-wiki-main-resizer]');
    if (!shell || !sidebar || !handle) return;
    const WKEY = 'llm-wiki:sidebar:width';
    function clamp(px) {
      return Math.max(220, Math.min(px, window.innerWidth - 420));
    }
    function applyWidth(px, persist) {
      const v = clamp(px);
      shell.style.setProperty('--wiki-sidebar-w', v + 'px');
      if (persist) localStorage.setItem(WKEY, String(Math.round(v)));
    }
    const savedWidth = Number(localStorage.getItem(WKEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) applyWidth(savedWidth, false);
    const onMove = e => applyWidth(e.clientX, true);
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', e => {
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
  })();

  // ── pending panel resizer ─────────────────────────────────────────────────
  (function initPendingResizer() {
    const sb = document.querySelector('.sidebar');
    const handle = document.querySelector('[data-pending-resizer]');
    const panel = document.querySelector('[data-untracked-panel]');
    if (!sb || !handle || !panel) return;
    const PKEY = 'llm-wiki:sidebar:pendingHeight';
    function clamp(px) {
      return Math.max(60, Math.min(px, sb.clientHeight * 0.72));
    }
    function applyHeight(px, persist) {
      const v = clamp(px);
      sb.style.setProperty('--pending-height', v + 'px');
      if (persist) localStorage.setItem(PKEY, String(Math.round(v)));
    }
    function syncResizer() {
      handle.classList.toggle('is-visible', panel.open);
      if (!panel.open) {
        sb.style.removeProperty('--pending-height');
      } else {
        const saved = Number(localStorage.getItem(PKEY));
        if (Number.isFinite(saved) && saved > 0) applyHeight(saved);
        else applyHeight(panel.offsetHeight);
      }
    }
    panel.addEventListener('toggle', syncResizer);
    syncResizer();
    let startY = 0, startH = 0, dragging = false;
    const onMove = e => {
      if (!dragging) return;
      applyHeight(startH + (startY - e.clientY), true);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', e => {
      startY = e.clientY;
      startH = parseFloat(sb.style.getPropertyValue('--pending-height')) || panel.offsetHeight;
      dragging = true;
      handle.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
    window.addEventListener('resize', syncResizer);
  })();

  // ── workspace switcher ────────────────────────────────────────────────────
  (function initWsSwitcher() {
    const el = document.getElementById('ws-switcher');
    if (!el) return;
    const current = el.dataset.current || '';
    let polling = false;
    const locallyOpenedUntil = new Map();

    function markLocallyOpened(wsName) {
      locallyOpenedUntil.set(wsName, Date.now() + 20000);
    }

    function isLocallyOpened(wsName) {
      const until = locallyOpenedUntil.get(wsName) || 0;
      if (until > Date.now()) return true;
      locallyOpenedUntil.delete(wsName);
      return false;
    }

    async function heartbeat() {
      if (!current) return;
      try {
        await fetch('/api/hub/workspaces/' + encodeURIComponent(current) + '/heartbeat', { method: 'POST', headers: { 'X-LLM-WIKI-HUB': '1' } });
      } catch {}
    }

    function render(workspaces) {
      const title = document.createElement('p');
      title.className = 'ws-switcher-title';
      title.textContent = 'Workspaces';
      el.innerHTML = '';
      el.appendChild(title);

      workspaces.forEach(ws => {
        const isActive  = ws.name === current;
        const isRunning = ws.running;
        const isOpened  = Boolean(ws.opened || isLocallyOpened(ws.name));

        const row = document.createElement('div');
        row.className = 'ws-item' + (isActive ? ' ws-active' : '');

        const dot = document.createElement('span');
        dot.className = 'ws-dot' + (isRunning ? ' running' : '');

        const nameEl = document.createElement('span');
        nameEl.className = 'ws-name';
        nameEl.textContent = ws.name;

        const btn = document.createElement(isActive || (isRunning && isOpened) ? 'span' : 'button');
        btn.className = 'ws-btn';
        if (isActive) {
          btn.textContent = 'active';
          btn.style.cssText = 'opacity:0.4;cursor:default';
        } else if (isRunning && isOpened) {
          btn.textContent = 'open';
          btn.style.cssText = 'opacity:0.45;cursor:default';
        } else {
          btn.textContent = isRunning ? 'Open' : 'Start';
          btn.dataset.action = isRunning ? 'open' : 'start';
          btn.dataset.ws = ws.name;
          btn.addEventListener('click', () => onAction(btn.dataset.action, btn.dataset.ws, btn));
        }

        row.appendChild(dot);
        row.appendChild(nameEl);
        row.appendChild(btn);
        el.appendChild(row);
      });
    }

    async function onAction(action, wsName, btn) {
      btn.disabled = true;
      btn.textContent = action === 'start' ? 'Starting...' : 'Opening...';
      try {
        await fetch('/api/hub/workspaces/' + encodeURIComponent(wsName) + '/' + action, { method: 'POST', headers: { 'X-LLM-WIKI-HUB': '1' } });
        if (action === 'open') {
          markLocallyOpened(wsName);
          btn.textContent = 'open';
        }
        if (action === 'start') {
          btn.textContent = 'Waiting...';
          // Poll until running then open
          for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const list = await fetchWorkspaces();
            if (!list) break;
            const ws = list.find(w => w.name === wsName);
            if (ws?.running) {
              await fetch('/api/hub/workspaces/' + encodeURIComponent(wsName) + '/open', { method: 'POST', headers: { 'X-LLM-WIKI-HUB': '1' } });
              markLocallyOpened(wsName);
              break;
            }
          }
        }
      } catch {}
      refresh();
    }

    async function fetchWorkspaces() {
      try {
        const r = await fetch('/api/hub/workspaces', { headers: { 'X-LLM-WIKI-HUB': '1' } });
        if (!r.ok) return null;
        return (await r.json()).workspaces || null;
      } catch { return null; }
    }

    async function refresh() {
      if (polling) return;
      polling = true;
      const list = await fetchWorkspaces();
      polling = false;
      if (list) render(list);
    }

    heartbeat();
    refresh();
    setInterval(heartbeat, 5000);
    setInterval(refresh, 5000);
  })();
})();

// ── Global keyboard shortcuts ────────────────────────────────────────────────
(function initShortcuts() {
  document.addEventListener('keydown', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    // ? -> help modal
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const m = document.getElementById('shortcuts-modal');
      if (m) m.classList.toggle('is-open');
      return;
    }
    // Cmd/Ctrl+E -> edit the current page
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      const editLink = document.querySelector('a.action-link[href^="/edit/"]');
      if (editLink) { e.preventDefault(); window.location.href = editLink.getAttribute('href'); }
      return;
    }
    // Cmd/Ctrl+B -> toggle sidebar
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      const sb = document.querySelector('.sidebar');
      if (sb) sb.style.display = sb.style.display === 'none' ? '' : 'none';
      return;
    }
    // G → graph
    if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      window.location.href = '/graph';
    }
    // Escape → fermer modal d'aide
    if (e.key === 'Escape') {
      const m = document.getElementById('shortcuts-modal');
      if (m && m.classList.contains('is-open')) { m.classList.remove('is-open'); }
    }
  });
})();

// ── Palette ⌘K ──────────────────────────────────────────────────────────────
(function initPalette() {
  const backdrop = document.getElementById('palette-backdrop');
  const input = document.getElementById('palette-input');
  const results = document.getElementById('palette-results');
  if (!backdrop || !input || !results) return;

  const allFiles = [...document.querySelectorAll('[data-side-path]')].map(function(el) {
    const p = el.getAttribute('data-side-path') || '';
    return { path: p, title: (el.textContent || '').trim(), href: '/' + p, type: p.split('/')[0] || 'wiki' };
  });
  const ICONS = { wiki: '📄', deliverables: '📦', templates: '📋', 'build-context': '🧩' };
  let selIdx = 0, cur = [];
  let previousOverflow = '';
  let previousActiveElement = null;

  function open() {
    previousActiveElement = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    backdrop.classList.add('is-open');
    input.value = '';
    show('');
    requestAnimationFrame(function() { input.focus({ preventScroll: true }); });
  }
  function close() {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = previousOverflow;
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus({ preventScroll: true });
    }
    previousActiveElement = null;
  }

  function show(q) {
    const nq = window.WikiUi.normalizeSearch(q.trim());
    cur = nq
      ? allFiles.filter(function(f) { return window.WikiUi.normalizeSearch(f.path + ' ' + f.title).includes(nq); }).slice(0, 12)
      : allFiles.slice(0, 8);
    selIdx = 0;
    render();
  }

  function render() {
    if (!cur.length) { results.innerHTML = '<div class="palette-empty">No results</div>'; return; }
    results.innerHTML = cur.map(function(f, i) {
      const icon = ICONS[f.type] || '📄';
      const sel = i === selIdx ? ' is-sel' : '';
      return '<a class="palette-item' + sel + '" href="' + window.WikiUi.escapeHtml(encodeURI(f.href)) + '" data-pi="' + i + '">' +
        '<div class="palette-item-icon">' + window.WikiUi.escapeHtml(icon) + '</div>' +
        '<div class="palette-item-body">' +
          '<div class="palette-item-title">' + window.WikiUi.escapeHtml(f.title || f.path.split('/').pop() || '') + '</div>' +
          '<div class="palette-item-path">' + window.WikiUi.escapeHtml(f.path) + '</div>' +
        '</div>' +
        '<span class="palette-tag ' + window.WikiUi.escapeHtml(f.type) + '">' + window.WikiUi.escapeHtml(f.type) + '</span>' +
      '</a>';
    }).join('');
    results.querySelectorAll('[data-pi]').forEach(function(el) {
      el.addEventListener('mouseenter', function() {
        selIdx = Number(el.dataset.pi);
        results.querySelectorAll('.palette-item').forEach(function(item) {
          item.classList.toggle('is-sel', Number(item.dataset.pi) === selIdx);
        });
      });
      el.addEventListener('click', function() { close(); });
    });
    results.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }

  function moveSelection(delta) {
    if (!cur.length) return;
    selIdx = (selIdx + delta + cur.length) % cur.length;
    render();
  }

  function openSelected() {
    if (!cur[selIdx]) return;
    window.location.href = cur[selIdx].href;
    close();
  }

  input.addEventListener('input', function() { show(input.value); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    else if (e.key === 'Escape') { close(); }
  });
  backdrop.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); backdrop.classList.contains('is-open') ? close() : open(); }
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) { close(); }
  });
})();
</script>
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
  for (const section of sections) {
    const isConceptSection = section.heading.toLowerCase().includes('concept');
    for (const tile of section.tiles) {
      if (!tile.href?.startsWith('/wiki/concepts/')) continue;
      tile.group =
        (await readPageGroup(rootDir, tile.href)) ||
        (isConceptSection ? 'Concepts' : section.heading);
    }
  }
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

async function renderSidebar(rootDir: string): Promise<string> {
  const [navFiles, untrackedPanel] = await Promise.all([
    fg(NAV_PATTERNS, { cwd: rootDir, dot: false }),
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
  const sidebar = await renderSidebar(rootDir);
  const graphFiles = await listGraphFiles(rootDir);
  const { nodes, edges } = await buildGraph(rootDir, graphFiles);
  const etag = await graphEtagForFiles(rootDir, graphFiles);
  const rawSourceCount = nodes.filter((node) => node.type === 'raw-source').length;
  const wikiSourceCount = nodes.filter((node) => node.type === 'wiki-source').length;
  const templateCount = nodes.filter((node) => node.type === 'template').length;
  const contextCount = nodes.filter((node) => node.type === 'build-context').length;
  const graph =
    nodes.length > 0
      ? renderWikiGraphApp(nodes, edges, etag)
      : '<p class="empty">No Markdown documents to display in the graph.</p>';
  const body = `${sidebar}<main class="content"><div class="hero"><h1>Wiki Graph</h1><p>Pages, sources, templates, build context and deliverables are represented as document relations. Use Radial, DAG or Liste mode to inspect the same wiki projection.</p></div><div class="graph-legend"><span class="legend-item raw-source">${rawSourceCount} raw source(s)</span><span class="legend-item wiki-source">${wikiSourceCount} wiki source(s)</span><span class="legend-item wiki">wiki</span><span class="legend-item template">${templateCount} template(s)</span><span class="legend-item build-context">${contextCount} context file(s)</span><span class="legend-item deliverable">deliverables</span><span>${edges.length} relation(s)</span></div>${graph}</main>`;
  return layout('Source Graph', body);
}

export async function generateIndex(rootDir: string): Promise<string> {
  // ── Stats ──────────────────────────────────────────────────────────────────
  const [wikiFiles, delivFiles, templFiles, untrackedFiles, lastIngest] = await Promise.all([
    fg('wiki/**/*.md', { cwd: rootDir, dot: false }),
    fg('deliverables/**/*.md', { cwd: rootDir, dot: false }),
    fg('templates/**/*.md', { cwd: rootDir, dot: false }),
    fg('raw/untracked/**/*.md', { cwd: rootDir, dot: false, onlyFiles: true }),
    getLastIngestTime(rootDir),
  ]);
  const statsBar = renderWsStats({
    wikiPages: wikiFiles.length,
    deliverables: delivFiles.length,
    templates: templFiles.length,
    untracked: untrackedFiles.length,
    lastIngest,
  });

  const sidebar = await renderSidebar(rootDir);

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
