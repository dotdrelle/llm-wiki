import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import fg from 'fast-glob';
import { marked } from 'marked';
import type { AppConfig } from '../types.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { pathExists, writeIfChanged } from '../utils/fs.ts';
import { resolveInside, toPosix } from '../utils/path.ts';

const SERVED_DIRS = ['wiki', 'deliverables', 'templates', 'build-context'];
const NAV_PATTERNS = [
  'wiki/**/*.md',
  'deliverables/**/*.md',
  'templates/**/*.md',
  'build-context/**/*.md',
];
const GRAPH_PATTERNS = [
  'wiki/**/*.md',
  'deliverables/**/*.md',
  'templates/**/*.md',
  'build-context/**/*.md',
  'raw/ingested/**/*.md',
];
const EDITABLE_DIRS = ['wiki', 'deliverables', 'templates', 'build-context'];
const require = createRequire(import.meta.url);
const D3_DIST_PATH = path.resolve(
  path.dirname(require.resolve('d3')),
  '../dist/d3.min.js',
);

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

function escapeHref(href: string): string {
  return escapeAttr(encodeURI(decodeHrefPath(href)));
}

function humanTitle(value: string): string {
  return path.basename(value, '.md').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function localHref(href: string, currentDir = ''): string {
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

function isServedRelativePath(relativePath: string): boolean {
  return (
    SERVED_DIRS.some(
      (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`),
    ) || relativePath.startsWith('raw/ingested/')
  );
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

function linkSourceCitations(raw: string, currentDir = ''): string {
  return raw.replace(/\[src:\s*([^\]]+)\]/g, (match, citationPath: string) => {
    const cleanPath = citationPath.trim();
    if (!cleanPath) return '[src:]';
    if (!cleanPath.endsWith('.md')) return match;
    const href = localHref(cleanPath, currentDir);
    return `<a class="source-citation" href="${escapeHref(href)}" title="${escapeAttr(cleanPath)}">[src: ${escapeHtml(cleanPath)}]</a>`;
  });
}

function linkWikiLinks(raw: string): string {
  return raw.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (match, target: string, label?: string) => {
      const cleanTarget = target.trim();
      if (!cleanTarget) return match;
      const text = label?.trim() || cleanTarget;
      return `[${text}](${encodeURI(cleanTarget)})`;
    },
  );
}

async function renderMarkdown(raw: string, currentDir = ''): Promise<string> {
  const renderer = new marked.Renderer();
  renderer.link = ({ href, title, text }) => {
    const safeHref = escapeHref(localHref(href, currentDir));
    const safeTitle = title ? ` title="${escapeAttr(title)}"` : '';
    return `<a href="${safeHref}"${safeTitle}>${text}</a>`;
  };
  return marked(linkSourceCitations(linkWikiLinks(raw), currentDir), { gfm: true, renderer });
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --panel-soft: #eef3f7;
      --text: #17202a;
      --muted: #657184;
      --border: #d8dee7;
      --accent: #176b87;
      --accent-soft: #e1f1f5;
      --link: #0f5f7a;
      --shadow: 0 10px 28px rgba(23, 32, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
    .app-shell { min-height: 100vh; display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
      padding: 1.25rem;
      border-right: 1px solid var(--border);
      background: #fbfcfd;
    }
    .brand { display: block; margin-bottom: 1.4rem; color: var(--text); text-decoration: none; }
    .brand-title { display: block; font-size: 1.05rem; font-weight: 750; }
    .brand-subtitle { display: block; margin-top: 0.1rem; color: var(--muted); font-size: 0.82rem; }
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
    .side-tree { margin-top: 1rem; font-size: 0.9rem; }
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
    .side-folder.is-search-hidden, .side-file.is-search-hidden { display: none; }
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
    .content { min-width: 0; padding: 2rem clamp(1rem, 3vw, 3rem) 3rem; }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.25rem;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .topbar nav a { color: inherit; }
    .topbar nav a + a::before { content: " / "; color: var(--muted); }
    .page-actions { display: flex; gap: 0.5rem; align-items: center; }
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
    .hero {
      margin-bottom: 1.5rem;
      padding: clamp(1.3rem, 3vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .hero h1 { margin: 0; font-size: clamp(1.7rem, 3vw, 2.55rem); line-height: 1.05; letter-spacing: 0; }
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
    .edit-form {
      display: grid;
      gap: 0.85rem;
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
    pre { background: #edf1f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
    th, td { border: 1px solid var(--border); padding: 0.45rem 0.75rem; text-align: left; }
    blockquote { border-left: 3px solid var(--accent); margin: 1rem 0; padding-left: 1rem; color: var(--muted); }
    .empty { color: var(--muted); }
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
    .graph-node.source circle { fill: #d7663b; }
    .graph-node.wiki circle { fill: #176b87; }
    .graph-node.deliverable circle { fill: #6b7f2a; }
    .graph-node.template circle { fill: #8f5c99; }
    .graph-node.context circle { fill: #a36f18; }
    .graph-legend { display: flex; flex-wrap: wrap; gap: 0.65rem; margin: 0.75rem 0 1.25rem; color: var(--muted); font-size: 0.9rem; }
    .legend-item::before { content: ""; display: inline-block; width: 0.7rem; height: 0.7rem; margin-right: 0.35rem; border-radius: 999px; vertical-align: -0.05rem; background: var(--accent); }
    .legend-item.source::before { background: #d7663b; }
    .legend-item.wiki::before { background: #176b87; }
    .legend-item.deliverable::before { background: #6b7f2a; }
    .legend-item.template::before { background: #8f5c99; }
    .legend-item.context::before { background: #a36f18; }
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
    .relation-panel-header {
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .relation-panel-title { margin: 0; font-size: 1rem; }
    .relation-panel-meta { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.82rem; }
    .relation-list { list-style: none; margin: 0; padding: 0.65rem; overflow: auto; display: grid; gap: 0.55rem; }
    .relation-item {
      padding: 0.7rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
    }
    .relation-item.is-active { border-color: var(--accent); background: var(--accent-soft); }
    .relation-item.is-hovered { border-color: #2f9e44; box-shadow: inset 3px 0 0 #2f9e44; }
    .relation-group-label {
      margin: 0.35rem 0 0.15rem;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 760;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .relation-path { display: block; color: var(--text); font-size: 0.86rem; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-arrow { display: block; margin: 0.25rem 0; color: var(--muted); font-size: 0.78rem; }
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
    .modal-doc { min-width: 0; padding: 1rem; }
    .modal-doc-title { margin: 0 0 0.7rem; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
    .modal-markdown { overflow-wrap: anywhere; }
    .modal-markdown h1, .modal-markdown h2, .modal-markdown h3 { line-height: 1.2; margin: 1rem 0 0.45rem; }
    .modal-markdown h1:first-child, .modal-markdown h2:first-child, .modal-markdown h3:first-child { margin-top: 0; }
    .modal-markdown p, .modal-markdown ul, .modal-markdown ol { margin: 0.65rem 0; }
    .modal-markdown pre { white-space: pre-wrap; }
    @media (max-width: 760px) {
      .app-shell { display: block; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
      .content { padding: 1rem; }
      .topbar { display: block; }
      .index-layout { grid-template-columns: 1fr; }
      .index-aside { position: static; }
      .graph-layout { grid-template-columns: 1fr; }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #101418;
        --panel: #171d23;
        --panel-soft: #202a32;
        --text: #e7edf3;
        --muted: #a6b2bf;
        --border: #2e3842;
        --accent: #65b8cf;
        --accent-soft: #18303a;
        --link: #7bd0e8;
        --shadow: none;
      }
      .sidebar { background: #121820; }
      pre { background: #101419; }
    }
  </style>
</head>
<body>
<div class="app-shell">
${body}
</div>
<script>
(() => {
  const storagePrefix = 'llm-wiki:sidebar:';
  const searchKey = storagePrefix + 'search';
  const scrollKey = storagePrefix + 'scrollTop';
  const currentPath = decodeURIComponent(window.location.pathname).replace(/^\\//, '');
  const sidebar = document.querySelector('.sidebar');
  const searchInput = document.querySelector('[data-side-search]');
  const searchStatus = document.querySelector('[data-side-search-status]');
  const sideFiles = [...document.querySelectorAll('[data-side-path]')];
  const sideFolders = [...document.querySelectorAll('[data-tree-id]')];
  function saveSidebarState() {
    if (searchInput) localStorage.setItem(searchKey, searchInput.value);
    if (sidebar) localStorage.setItem(scrollKey, String(sidebar.scrollTop));
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
  function normalize(value) {
    return value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  }
  function folderHasVisibleFile(folder) {
    return Boolean(folder.querySelector('[data-side-path]:not(.is-search-hidden)'));
  }
  function applySidebarSearch() {
    const query = normalize(searchInput?.value.trim() || '');
    let matchCount = 0;
    if (!query) {
      sideFiles.forEach((link) => link.classList.remove('is-search-hidden'));
      sideFolders.forEach((folder) => folder.classList.remove('is-search-hidden'));
      searchStatus?.classList.remove('is-visible');
      return;
    }
    for (const link of sideFiles) {
      const haystack = normalize((link.getAttribute('data-side-path') || '') + ' ' + link.textContent);
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
  sidebar?.addEventListener('scroll', () => {
    localStorage.setItem(scrollKey, String(sidebar.scrollTop));
  }, { passive: true });
  window.addEventListener('beforeunload', saveSidebarState);
  applySidebarSearch();
  requestAnimationFrame(() => {
    const savedScroll = Number(localStorage.getItem(scrollKey) || '0');
    if (sidebar && Number.isFinite(savedScroll)) sidebar.scrollTop = savedScroll;
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
    const target = href === '/wiki' ? '/' : href;
    links.push(`<a href="${escapeHref(target)}">${escapeHtml(part)}</a>`);
  }
  return `<nav>${links.join('')}</nav>`;
}

interface TileSection {
  heading: string;
  tiles: Array<{ title: string; href?: string; meta: string }>;
}

function extractIndexTiles(markdown: string): TileSection[] {
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
      current.tiles.push({
        title: link[1],
        href: localHref(link[2]),
        meta: link[2],
      });
      continue;
    }

    const wikiLink = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(item[1]);
    if (wikiLink?.[1]) {
      const target = wikiLink[1].trim();
      const title = wikiLink[2]?.trim() || humanTitle(target);
      current.tiles.push({
        title,
        href: localHref(target),
        meta: target,
      });
    } else {
      const text = item[1].replace(/`/g, '').trim();
      current.tiles.push({
        title: text,
        meta: current.heading,
      });
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

function renderIndexSectionBrowser(sections: TileSection[]): string {
  if (sections.length === 0) {
    return '<p class="empty">No index sections found.</p>';
  }

  return sections
    .map((section) => {
      const count = section.tiles.length;
      const tiles = section.tiles.length
        ? section.tiles.map(renderTile).join('\n')
        : '<p class="empty">No pages in this section.</p>';
      return `<details class="section-browser"><summary><span class="section-browser-summary"><span class="section-browser-title">${escapeHtml(section.heading)}</span><span class="section-browser-meta">${count} item${count === 1 ? '' : 's'}</span></span></summary><div class="section-browser-tiles">${tiles}</div></details>`;
    })
    .join('\n');
}

function renderTopbar(urlPath: string, actions = ''): string {
  return `<div class="topbar">${breadcrumb(urlPath)}${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

function editHref(relativePath: string): string {
  return `/edit/${relativePath}`;
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
      return `<a class="side-file" href="/${safePath}" title="${safePath}" data-side-path="${safePath}">${escapeHtml(title)}</a>`;
    }),
  ].join('\n');

  const open = depth === 0 ? ' open' : '';
  const label = node.name === 'build-context' ? 'build context' : node.name;
  return `<details class="side-folder"${open} data-tree-id="${escapeAttr(node.path)}"><summary><span class="side-folder-label">${escapeHtml(label)}</span></summary><div class="side-folder-children">${children}</div></details>`;
}

async function renderSidebar(rootDir: string): Promise<string> {
  const root = createNavNode('workspace', '');
  const files = (await fg(NAV_PATTERNS, { cwd: rootDir, dot: false }))
    .map(toPosix)
    .sort();
  for (const file of files) {
    addNavPath(root, file);
  }

  const tree = [...root.dirs.values()]
    .sort((a, b) => SERVED_DIRS.indexOf(a.name) - SERVED_DIRS.indexOf(b.name))
    .map((dir) => renderNavNode(dir))
    .join('\n');

  return `<aside class="sidebar"><a class="brand" href="/"><span class="brand-title">wiki</span><span class="brand-subtitle">index.md comme point d'entrée</span></a><a class="side-link" href="/graph">Graph des sources</a><div class="side-search"><input class="side-search-input" type="search" placeholder="Search files" aria-label="Search files" data-side-search><p class="side-search-status" data-side-search-status>No matching files.</p></div><nav class="side-tree" aria-label="Documents markdown">${tree}</nav></aside>`;
}

interface GraphNode {
  id: string;
  title: string;
  type: 'source' | 'wiki' | 'deliverable' | 'template' | 'context';
  href: string;
  preview: string;
  raw: string;
  html: string;
  degree: number;
  x: number;
  y: number;
  r: number;
}

interface GraphEdge {
  from: string;
  to: string;
}

function graphNodeType(relativePath: string): GraphNode['type'] {
  if (
    relativePath.startsWith('raw/ingested/') ||
    relativePath.startsWith('wiki/sources/')
  ) {
    return 'source';
  }
  if (relativePath.startsWith('deliverables/')) return 'deliverable';
  if (relativePath.startsWith('templates/')) return 'template';
  if (relativePath.startsWith('build-context/')) return 'context';
  return 'wiki';
}

function extractGraphTargets(markdown: string, currentDir: string): string[] {
  const targets = new Set<string>();
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  const citationPattern = /\[src:\s*([^\]]+)\]/g;

  for (const match of markdown.matchAll(markdownLinkPattern)) {
    const href = match[1]?.trim();
    if (href && href.endsWith('.md')) {
      targets.add(hrefToRelativePath(href, currentDir));
    }
  }

  for (const match of markdown.matchAll(citationPattern)) {
    const citationPath = match[1]?.trim();
    if (citationPath) {
      targets.add(hrefToRelativePath(citationPath, currentDir));
    }
  }

  return [...targets];
}

function markdownPreview(markdown: string): string {
  const plain = markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 900 ? `${plain.slice(0, 900)}...` : plain;
}

async function buildGraph(
  rootDir: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const files = (await fg(GRAPH_PATTERNS, { cwd: rootDir, dot: false }))
    .map(toPosix)
    .sort();
  const nodeIds = new Set(files);
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const degree = new Map(files.map((file) => [file, 0]));
  const previews = new Map<string, string>();
  const rawContents = new Map<string, string>();
  const htmlContents = new Map<string, string>();

  for (const file of files) {
    const raw = await readFile(path.join(rootDir, file), 'utf8');
    const currentDir = toPosix(path.posix.dirname(file));
    rawContents.set(file, raw);
    previews.set(file, markdownPreview(raw));
    htmlContents.set(file, await renderMarkdown(raw, currentDir));
    for (const target of extractGraphTargets(raw, currentDir)) {
      if (!nodeIds.has(target) || target === file) continue;
      const edgeKey = [file, target].sort().join('\0');
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ from: file, to: target });
      degree.set(file, (degree.get(file) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }

  const width = 1100;
  const height = 720;
  const cx = width / 2;
  const cy = height / 2;
  const rx = 430;
  const ry = 260;
  const sortedFiles = [...files].sort((a, b) => {
    const typeOrder = graphNodeType(a).localeCompare(graphNodeType(b));
    return typeOrder || a.localeCompare(b);
  });
  const maxDegree = Math.max(1, ...sortedFiles.map((file) => degree.get(file) ?? 0));

  const nodes = sortedFiles.map((file, index): GraphNode => {
    const angle =
      sortedFiles.length > 1
        ? (Math.PI * 2 * index) / sortedFiles.length - Math.PI / 2
        : 0;
    const nodeDegree = degree.get(file) ?? 0;
    return {
      id: file,
      title: humanTitle(file),
      type: graphNodeType(file),
      href: `/${file}`,
      preview: previews.get(file) || '(Aucun contenu lisible dans ce fichier.)',
      raw: rawContents.get(file) ?? '',
      html: htmlContents.get(file) ?? '',
      degree: nodeDegree,
      x: Math.round(cx + Math.cos(angle) * rx),
      y: Math.round(cy + Math.sin(angle) * ry),
      r: Math.round(9 + (nodeDegree / maxDegree) * 20),
    };
  });

  return { nodes, edges };
}

function renderGraphScript(nodes: GraphNode[], edges: GraphEdge[]): string {
  const graphData = JSON.stringify({
    nodes,
    edges: edges.map((edge, index) => ({ ...edge, id: `rel-${index}` })),
  });
  return `<script type="application/json" id="graph-data">${escapeScriptJson(graphData)}</script>
<script src="/assets/d3.min.js"></script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('graph-data').textContent || '{"nodes":[],"edges":[]}');
  if (!window.d3) {
    document.querySelector('[data-relation-list]').innerHTML = '<li class="relation-item">d3-force est indisponible: le bundle local /assets/d3.min.js n a pas pu etre charge.</li>';
    return;
  }
  const svg = document.querySelector('[data-graph-svg]');
  const viewport = document.querySelector('[data-graph-viewport]');
  const linkLayer = document.querySelector('[data-link-layer]');
  const nodeLayer = document.querySelector('[data-node-layer]');
  const relationList = document.querySelector('[data-relation-list]');
  const modal = document.querySelector('[data-relation-modal]');
  const modalTitle = document.querySelector('[data-modal-title]');
  const modalTargetTitle = document.querySelector('[data-modal-target-title]');
  const modalTargetBody = document.querySelector('[data-modal-target-body]');
  const modalClose = document.querySelector('[data-modal-close]');
  const nodes = data.nodes;
  const edges = data.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, source: edge.from, target: edge.to }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const nodeElements = new Map();
  const linkElements = [];
  const relationElements = new Map();
  const relationItems = new Map();
  let simulation = null;
  let selectedId = nodes[0]?.id || null;
  let dragNode = null;
  let panStart = null;
  let view = { x: 0, y: 0, scale: 1 };

  function svgPoint(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = viewport.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : { x: point.x, y: point.y };
  }

  function applyView() {
    viewport.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.scale + ')');
  }

  function render() {
    linkLayer.innerHTML = '';
    nodeLayer.innerHTML = '';
    linkElements.length = 0;
    nodeElements.clear();

    for (const edge of edges) {
      const from = byId.get(edge.source);
      const to = byId.get(edge.target);
      if (!from || !to) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.classList.add('graph-link');
      line.dataset.from = edge.source;
      line.dataset.to = edge.target;
      linkLayer.appendChild(line);
      linkElements.push({ element: line, edge });
    }

    relationList.innerHTML = '';
    relationElements.clear();
    relationItems.clear();
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const item = document.createElement('li');
      item.className = 'relation-item';
      item.dataset.id = edge.id;
      item.innerHTML = '<span class="relation-path"></span><span class="relation-arrow">relie a</span><span class="relation-path"></span><button class="relation-open" type="button">Afficher les markdown</button>';
      const paths = item.querySelectorAll('.relation-path');
      paths[0].textContent = from.id;
      paths[1].textContent = to.id;
      item.querySelector('button').addEventListener('click', () => openRelation(edge.id));
      item.addEventListener('mouseenter', () => highlightRelation(edge.id));
      item.addEventListener('mouseleave', clearRelationHover);
      relationElements.set(edge.id, item);
      relationItems.set(edge.id, { edge, element: item });
    }

    if (edges.length === 0) {
      relationList.innerHTML = '<li class="relation-item">Aucune relation detectee entre les documents markdown.</li>';
    } else {
      sortRelations(selectedId);
    }

    for (const node of nodes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('graph-node', node.type);
      group.dataset.id = node.id;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', String(node.r));
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = node.title;
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = node.id + ' · ' + node.degree + ' lien(s)';

      group.append(title, circle, label);
      group.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        dragNode = node;
        node.fx = node.x;
        node.fy = node.y;
        simulation?.alphaTarget(0.25).restart();
        group.classList.add('is-dragging');
        group.setPointerCapture(event.pointerId);
      });
      group.addEventListener('pointermove', (event) => {
        if (dragNode !== node) return;
        const point = svgPoint(event);
        node.fx = point.x;
        node.fy = point.y;
        updatePositions();
      });
      group.addEventListener('pointerup', (event) => {
        group.classList.remove('is-dragging');
        group.releasePointerCapture(event.pointerId);
        node.fx = null;
        node.fy = null;
        simulation?.alphaTarget(0);
        dragNode = null;
        selectNode(node.id);
      });
      group.addEventListener('dblclick', () => {
        window.location.href = node.href;
      });

      nodeLayer.appendChild(group);
      nodeElements.set(node.id, group);
    }

    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((node) => node.id).distance((edge) => {
        const sourceDegree = edge.source.degree || 0;
        const targetDegree = edge.target.degree || 0;
        return 110 + Math.min(sourceDegree + targetDegree, 10) * 10;
      }).strength(0.55))
      .force('charge', d3.forceManyBody().strength((node) => -260 - node.r * 12))
      .force('center', d3.forceCenter(550, 360))
      .force('collision', d3.forceCollide().radius((node) => node.r + 34).strength(0.9))
      .force('x', d3.forceX(550).strength(0.035))
      .force('y', d3.forceY(360).strength(0.035))
      .on('tick', updatePositions);

    if (selectedId) selectNode(selectedId);
  }

  function updatePositions() {
    for (const entry of linkElements) {
      const line = entry.element;
      const from = typeof entry.edge.source === 'object' ? entry.edge.source : byId.get(entry.edge.source);
      const to = typeof entry.edge.target === 'object' ? entry.edge.target : byId.get(entry.edge.target);
      if (!from || !to) continue;
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
    }

    for (const node of nodes) {
      const group = nodeElements.get(node.id);
      if (!group) continue;
      group.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');
      const label = group.querySelector('text');
      label.setAttribute('y', String(node.r + 16));
    }
  }

  function connectedIds(id) {
    const ids = new Set([id]);
    for (const edge of edges) {
      const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
      if (sourceId === id) ids.add(targetId);
      if (targetId === id) ids.add(sourceId);
    }
    return ids;
  }

  function edgeNodeIds(edge) {
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    return { sourceId, targetId };
  }

  function relationWeight(edge) {
    const { sourceId, targetId } = edgeNodeIds(edge);
    return (byId.get(sourceId)?.degree || 0) + (byId.get(targetId)?.degree || 0);
  }

  function sortedRelationItems(focusId) {
    return [...relationItems.values()].sort((left, right) => {
      const leftIds = edgeNodeIds(left.edge);
      const rightIds = edgeNodeIds(right.edge);
      const leftFocused = focusId && (leftIds.sourceId === focusId || leftIds.targetId === focusId);
      const rightFocused = focusId && (rightIds.sourceId === focusId || rightIds.targetId === focusId);
      if (leftFocused !== rightFocused) return leftFocused ? -1 : 1;
      const weightDiff = relationWeight(right.edge) - relationWeight(left.edge);
      if (weightDiff !== 0) return weightDiff;
      return (leftIds.sourceId + leftIds.targetId).localeCompare(rightIds.sourceId + rightIds.targetId);
    });
  }

  function appendRelationLabel(text) {
    const label = document.createElement('li');
    label.className = 'relation-group-label';
    label.textContent = text;
    relationList.appendChild(label);
  }

  function sortRelations(focusId) {
    if (relationItems.size === 0) return;
    relationList.innerHTML = '';
    let focusedAdded = false;
    let otherAdded = false;
    for (const item of sortedRelationItems(focusId)) {
      const { sourceId, targetId } = edgeNodeIds(item.edge);
      const isFocused = Boolean(focusId && (sourceId === focusId || targetId === focusId));
      if (isFocused && !focusedAdded) {
        appendRelationLabel('Relations du noeud selectionne');
        focusedAdded = true;
      }
      if (!isFocused && !otherAdded) {
        appendRelationLabel(focusedAdded ? 'Autres relations' : 'Relations les plus connectees');
        otherAdded = true;
      }
      relationList.appendChild(item.element);
    }
  }

  function selectNode(id) {
    selectedId = id;
    const node = byId.get(id);
    if (!node) return;
    const connected = connectedIds(id);

    for (const [nodeId, element] of nodeElements) {
      element.classList.toggle('is-selected', nodeId === id);
      element.classList.toggle('is-dimmed', !connected.has(nodeId));
    }
    for (const entry of linkElements) {
      const { sourceId, targetId } = edgeNodeIds(entry.edge);
      const isConnected = sourceId === id || targetId === id;
      entry.element.classList.toggle('is-connected', isConnected);
    }
    for (const [relationId, element] of relationElements) {
      const edge = edges.find((candidate) => candidate.id === relationId);
      if (!edge) continue;
      const { sourceId, targetId } = edgeNodeIds(edge);
      element.classList.toggle('is-active', sourceId === id || targetId === id);
    }
    sortRelations(id);
  }

  function highlightRelation(id) {
    const edge = edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    const { sourceId, targetId } = edgeNodeIds(edge);
    for (const [nodeId, element] of nodeElements) {
      element.classList.toggle('is-hovered', nodeId === sourceId || nodeId === targetId);
    }
    for (const entry of linkElements) {
      entry.element.classList.toggle('is-hovered', entry.edge.id === id);
    }
    for (const [relationId, element] of relationElements) {
      element.classList.toggle('is-hovered', relationId === id);
    }
  }

  function clearRelationHover() {
    for (const element of nodeElements.values()) element.classList.remove('is-hovered');
    for (const entry of linkElements) entry.element.classList.remove('is-hovered');
    for (const element of relationElements.values()) element.classList.remove('is-hovered');
  }

  function openRelation(id) {
    const edge = edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    const { sourceId, targetId } = edgeNodeIds(edge);
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    if (!source || !target) return;
    highlightRelation(id);
    modalTitle.textContent = source.title + ' -> ' + target.title;
    modalTargetTitle.textContent = target.id;
    modalTargetBody.innerHTML = target.html;
    modal.classList.add('is-open');
  }

  function closeModal() {
    modal.classList.remove('is-open');
  }

  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.graph-node')) return;
    panStart = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!panStart) return;
    view.x = panStart.viewX + (event.clientX - panStart.x);
    view.y = panStart.viewY + (event.clientY - panStart.y);
    applyView();
  });
  svg.addEventListener('pointerup', (event) => {
    panStart = null;
    svg.classList.remove('is-panning');
    svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(3, Math.max(0.35, view.scale * delta));
    view.scale = nextScale;
    applyView();
  }, { passive: false });
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  render();
})();
</script>`;
}

function renderGraphApp(nodes: GraphNode[], edges: GraphEdge[]): string {
  return `<div class="graph-layout"><div class="graph-panel"><div class="graph-stage"><svg class="graph-svg" viewBox="0 0 1100 720" role="img" aria-label="Graph navigable des documents et sources" data-graph-svg><g data-graph-viewport><g data-link-layer></g><g data-node-layer></g></g></svg></div></div><aside class="relation-panel"><div class="relation-panel-header"><h2 class="relation-panel-title">Relations</h2><p class="relation-panel-meta">Ouvrez une relation pour afficher les markdown lies.</p></div><ul class="relation-list" data-relation-list></ul></aside></div>
<div class="modal-backdrop" data-relation-modal><section class="relation-modal" role="dialog" aria-modal="true" aria-labelledby="relation-modal-title"><div class="modal-header"><h2 class="modal-title" id="relation-modal-title" data-modal-title>Relation</h2><button class="modal-close" type="button" aria-label="Fermer" data-modal-close>x</button></div><div class="modal-body"><article class="modal-doc"><h3 class="modal-doc-title" data-modal-target-title></h3><div class="modal-markdown" data-modal-target-body></div></article></div></section></div>
${renderGraphScript(nodes, edges)}`;
}

async function generateGraph(rootDir: string): Promise<string> {
  const sidebar = await renderSidebar(rootDir);
  const { nodes, edges } = await buildGraph(rootDir);
  const sourceCount = nodes.filter((node) => node.type === 'source').length;
  const graph =
    nodes.length > 0
      ? renderGraphApp(nodes, edges)
      : '<p class="empty">Aucun document markdown à afficher dans le graphe.</p>';
  const body = `${sidebar}<main class="content"><div class="hero"><h1>Graph des sources</h1><p>Les sources et documents du wiki sont représentés par relation. La taille d'un noeud dépend du nombre de liens entrants et sortants. Cliquez sur un noeud pour afficher le markdown associé.</p></div><div class="graph-legend"><span class="legend-item source">${sourceCount} source(s)</span><span class="legend-item wiki">wiki</span><span class="legend-item deliverable">livrables</span><span class="legend-item template">templates</span><span class="legend-item context">build context</span><span>${edges.length} relation(s)</span></div>${graph}</main>`;
  return layout('Graph des sources', body);
}

async function generateIndex(rootDir: string): Promise<string> {
  const indexPath = path.join(rootDir, 'wiki', 'index.md');
  const raw = (await pathExists(indexPath))
    ? await readFile(indexPath, 'utf8')
    : '# Wiki Index\n\n- wiki/index.md introuvable.';
  const html = await renderMarkdown(raw, 'wiki');
  const tiles = renderIndexSectionBrowser(extractIndexTiles(raw));
  const sidebar = await renderSidebar(rootDir);
  const body = `${sidebar}<main class="content"><div class="hero"><h1>Wiki Index</h1><p>Point d'entrée du wiki local. L'index complet reste lisible à gauche, avec les principales sections disponibles en tuiles à droite.</p></div><div class="index-layout"><article class="article">${html}</article><aside class="index-aside"><h2 class="index-aside-title">Main sections</h2>${tiles}</aside></div></main>`;
  return layout('wiki', body);
}

async function generateDirectoryPage(rootDir: string, relativePath: string): Promise<string> {
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
  const body = `${sidebar}<main class="content"><div class="topbar">${breadcrumb(`/${cleanRelativePath}`)}</div><div class="hero"><h1>${escapeHtml(title)}</h1><p>Markdown files under <code>${escapeHtml(cleanRelativePath)}/</code>.</p></div>${content}</main>`;
  return layout(title, body);
}

async function serveMd(
  rootDir: string,
  filePath: string,
  urlPath: string,
): Promise<string> {
  const raw = await readFile(filePath, 'utf8');
  const currentDir = toPosix(path.dirname(urlPath.replace(/^\//, '')));
  const html = await renderMarkdown(raw, currentDir);
  const title = path.basename(filePath, '.md');
  const sidebar = await renderSidebar(rootDir);
  const relativePath = urlPath.replace(/^\//, '');
  const actions = isEditableRelativePath(relativePath)
    ? `<a class="action-link" href="${escapeHref(editHref(relativePath))}">Edit</a>`
    : '';
  return layout(
    title,
    `${sidebar}<main class="content">${renderTopbar(urlPath, actions)}<article class="article">${html}</article></main>`,
  );
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function resolveEditableMarkdown(rootDir: string, relativePath: string): string {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!isEditableRelativePath(cleanRelativePath)) {
    throw new Error(`FORBIDDEN_EDIT_PATH: Editing is only allowed for markdown files under ${EDITABLE_DIRS.join(', ')}`);
  }

  return resolveInside(rootDir, cleanRelativePath);
}

async function generateEditPage(rootDir: string, relativePath: string): Promise<string> {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '');
  const absolute = resolveEditableMarkdown(rootDir, cleanRelativePath);
  if (!(await pathExists(absolute))) {
    throw new Error(`File not found: ${cleanRelativePath}`);
  }
  const raw = await readFile(absolute, 'utf8');
  const sidebar = await renderSidebar(rootDir);
  const body = `${sidebar}<main class="content">${renderTopbar(`/${cleanRelativePath}`)}<div class="hero"><h1>Edit ${escapeHtml(cleanRelativePath)}</h1><p>Raw Markdown editor for this workspace file.</p></div><form class="edit-form" method="post" action="${escapeHref(editHref(cleanRelativePath))}"><textarea class="edit-textarea" name="content" spellcheck="false">${escapeHtml(raw)}</textarea><div class="page-actions"><button class="action-button" type="submit">Save</button><a class="action-link" href="${escapeHref(`/${cleanRelativePath}`)}">Cancel</a></div></form></main>`;
  return layout(`Edit ${path.basename(cleanRelativePath)}`, body);
}

export default async function serveCmd(config: AppConfig, options: { port?: number }) {
  const workspace = new WorkspaceService(config);
  const rootDir = workspace.paths.rootDir;
  const port = options.port ?? 3000;

  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(
        new URL(req.url ?? '/', `http://localhost`).pathname,
      );

      if (urlPath.startsWith('/edit/')) {
        const relative = urlPath.replace(/^\/edit\//, '').replace(/\/+$/, '');
        if (req.method === 'GET') {
          try {
            const html = await generateEditPage(rootDir, relative);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const status = message.startsWith('FORBIDDEN_EDIT_PATH') ? 403 : 404;
            res.writeHead(status, { 'Content-Type': 'text/plain' });
            res.end(status === 403 ? 'Forbidden' : 'Not found');
          }
          return;
        }

        if (req.method === 'POST') {
          try {
            const absolute = resolveEditableMarkdown(rootDir, relative);
            const body = await readRequestBody(req);
            const params = new URLSearchParams(body);
            const content = params.get('content');
            if (content === null) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing content field');
              return;
            }
            await writeIfChanged(absolute, content);
            res.writeHead(303, { Location: escapeHref(`/${toPosix(relative)}`) });
            res.end();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const status = message.startsWith('FORBIDDEN_EDIT_PATH') ? 403 : 404;
            res.writeHead(status, { 'Content-Type': 'text/plain' });
            res.end(status === 403 ? 'Forbidden' : 'Not found');
          }
          return;
        }

        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

      if (urlPath === '/assets/d3.min.js') {
        const js = await readFile(D3_DIST_PATH, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(js);
        return;
      }

      if (urlPath === '/') {
        const html = await generateIndex(rootDir);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (urlPath === '/graph') {
        const html = await generateGraph(rootDir);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const relative = urlPath.replace(/^\//, '').replace(/\/+$/, '');
      if (!isServedRelativePath(relative)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const absolute = path.resolve(rootDir, relative);
      if (!absolute.startsWith(rootDir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (!(await pathExists(absolute))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const absoluteStats = await stat(absolute);
      if (absoluteStats.isDirectory()) {
        const html = relative === 'wiki'
          ? await generateIndex(rootDir)
          : await generateDirectoryPage(rootDir, relative);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (!absolute.endsWith('.md')) {
        res.writeHead(415, { 'Content-Type': 'text/plain' });
        res.end('Only .md files are served');
        return;
      }

      const html = await serveMd(rootDir, absolute, urlPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    console.log(`wiki serve  →  http://localhost:${port}`);
    console.log('Ctrl-C to stop.');
  });

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}
