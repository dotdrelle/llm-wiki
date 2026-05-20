import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fg from 'fast-glob';
import { marked } from 'marked';
import type { AppConfig } from '../types.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { pathExists, safeWriteFile, writeIfChanged } from '../utils/fs.ts';
import { resolveInside, toPosix } from '../utils/path.ts';
import { WIKI_CSS_VARS } from '../chat/theme.ts';
import { CHAT_HTML } from '../chat/chatHtml.ts';

const MCP_WIKI_PORT = process.env.WIKI_MCP_HTTP_PORT ?? '3101';
const MCP_CME_PORT = process.env.CME_MCP_PORT ?? '3000';
const MCP_MAILER_PORT = process.env.MAILER_MCP_PORT ?? '3335';
const MCP_PRODUCTION_PORT = process.env.PRODUCTION_MCP_PORT ?? '3336';
const HUB_PORT = process.env.HUB_PORT ?? null;
const HUB_TOKEN = process.env.HUB_TOKEN ?? null;
const HUB_INTERNAL_HOST = process.env.HUB_INTERNAL_HOST ?? '127.0.0.1';
const WORKSPACE_NAME = process.env.WORKSPACE_NAME ?? null;

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
const MARKED_DIST_PATH = path.resolve(
  path.dirname(require.resolve('marked')),
  'marked.umd.js',
);
const CHAT_HISTORY_DIR = path.join('.wiki', 'chat-history');
const CHAT_HISTORY_INDEX = 'index.json';
const SKILLS_DIR = path.join('.wiki', 'skills');
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,60}$/;

type SkillMeta = {
  name: string;
  description: string;
  params: string[];
  body: string;
  scope: 'workspace';
};

function assertSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) throw new Error('INVALID_SKILL_NAME');
}

function skillFilePath(rootDir: string, name: string): string {
  return path.join(rootDir, SKILLS_DIR, `${name}.md`);
}

function parseSkillFile(name: string, raw: string): SkillMeta {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = (fmMatch ? fmMatch[2] : raw).trim();
  let description = '';
  const params: string[] = [];
  let inParams = false;
  for (const line of fm.split('\n')) {
    const t = line.trim();
    if (t.startsWith('description:')) {
      description = t.slice(12).trim();
      inParams = false;
    } else if (t === 'params:') {
      inParams = true;
    } else if (inParams && t.startsWith('- ')) {
      params.push(t.slice(2).trim());
    } else if (t && !t.startsWith('#') && !t.startsWith('- ')) {
      inParams = false;
    }
  }
  return { name, description, params, body, scope: 'workspace' };
}

function formatSkillFile(skill: {
  name: string;
  description: string;
  params: string[];
  body: string;
}): string {
  const paramsYaml = skill.params.length
    ? `\nparams:\n${skill.params.map((p) => `  - ${p}`).join('\n')}`
    : '';
  return `---\nname: ${skill.name}\ndescription: ${skill.description}${paramsYaml}\n---\n${skill.body}\n`;
}

async function listSkills(rootDir: string): Promise<SkillMeta[]> {
  const dir = path.join(rootDir, SKILLS_DIR);
  if (!(await pathExists(dir))) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const skills: SkillMeta[] = [];
  for (const file of files) {
    const name = file.slice(0, -3);
    try {
      assertSkillName(name);
      const raw = await readFile(path.join(dir, file), 'utf8');
      skills.push(parseSkillFile(name, raw));
    } catch {
      /* skip invalid */
    }
  }
  return skills;
}

async function readSkillByName(rootDir: string, name: string): Promise<SkillMeta | null> {
  assertSkillName(name);
  const fp = skillFilePath(rootDir, name);
  if (!(await pathExists(fp))) return null;
  return parseSkillFile(name, await readFile(fp, 'utf8'));
}

type ChatHistorySummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolCallCount: number;
};

type ChatConversation = ChatHistorySummary & Record<string, unknown>;

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

function isRawUntrackedReference(value: string): boolean {
  const clean = toPosix(decodeHrefPath(value).replace(/^\/+/, '').replace(/#.*$/, ''));
  return clean.startsWith('raw/untracked/') || clean.startsWith('wiki/raw/untracked/');
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

function isManagedMarkdownRelativePath(relativePath: string): boolean {
  return (
    relativePath.endsWith('.md') &&
    (relativePath.startsWith('deliverables/') ||
      relativePath.startsWith('templates/') ||
      relativePath.startsWith('build-context/'))
  );
}

function isCreatableCollection(collection: string): boolean {
  return (
    collection === 'deliverables' ||
    collection === 'templates' ||
    collection === 'build-context'
  );
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
      return `<span class="source-citation source-citation-stale" title="Source brute archivée ou déplacée">[src: ${escapeHtml(cleanPath)}]</span>`;
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
        : ' title="Source brute archivée ou déplacée"';
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
      : date.toLocaleString('fr-FR', {
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
  const pageTitle = WORKSPACE_NAME ? `${WORKSPACE_NAME} · ${title}` : title;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
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
      content: " indisponible";
      color: var(--muted);
      font-size: 0.72em;
      font-weight: 680;
    }
    .app-shell { min-height: 100vh; display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 1.25rem;
      border-right: 1px solid var(--border);
      background: #fbfcfd;
    }
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
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.45rem;
      margin-bottom: 0.9rem;
    }
    .side-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      min-height: 2.35rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
    }
    .side-action:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .side-action svg { width: 1rem; height: 1rem; stroke: currentColor; }
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
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }
    .edit-form .hero .page-actions {
      flex-shrink: 0;
      justify-content: flex-end;
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
    .graph-node.deliverable circle { fill: #6b7f2a; }
    .graph-node.template circle { fill: #8f5c99; }
    .graph-node.context circle { fill: #a36f18; }
    .graph-search-wrapper { padding: 0.65rem 0.75rem; }
    .graph-toolbar { display: flex; gap: 0.4rem; align-items: center; }
    .graph-search-field { position: relative; flex: 1 1 0; min-width: 0; }
    .graph-search-input { width: 100%; padding: 0.45rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; font-size: 0.9rem; box-sizing: border-box; }
    .graph-search-input:focus { outline: none; border-color: var(--accent); }
    .graph-search-dropdown { position: absolute; top: calc(100% + 2px); left: 0; right: 0; z-index: 10; list-style: none; margin: 0; padding: 0.3rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); box-shadow: var(--shadow); max-height: 240px; overflow: auto; }
    .graph-ctrl-group { display: flex; gap: 0.25rem; flex: 0 0 auto; }
    .graph-ctrl-btn { width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--text); font: inherit; font-size: 1rem; font-weight: 760; cursor: pointer; padding: 0; line-height: 1; }
    .graph-ctrl-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
    .graph-search-result { display: grid; grid-template-columns: 0.65rem 1fr; grid-template-rows: auto auto; gap: 0 0.5rem; padding: 0.45rem 0.55rem; border-radius: 5px; cursor: pointer; align-items: center; }
    .graph-search-result:hover { background: var(--accent-soft); }
    .graph-search-result-dot { grid-row: 1 / 3; width: 0.65rem; height: 0.65rem; border-radius: 999px; background: var(--accent); align-self: center; }
    .graph-search-result-dot.raw-source { background: #d7663b; }
    .graph-search-result-dot.wiki-source { background: #0e7490; }
    .graph-search-result-dot.wiki { background: #c8a500; }
    .graph-search-result-dot.deliverable { background: #6b7f2a; }
    .graph-search-result-dot.template { background: #8f5c99; }
    .graph-search-result-dot.context { background: #a36f18; }
    .graph-search-result-title { font-size: 0.88rem; font-weight: 620; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-search-result-path { font-size: 0.76rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-search-empty { padding: 0.55rem 0.65rem; color: var(--muted); font-size: 0.88rem; }
    .graph-legend { display: flex; flex-wrap: wrap; gap: 0.65rem; margin: 0.75rem 0 1.25rem; color: var(--muted); font-size: 0.9rem; }
    .legend-item::before { content: ""; display: inline-block; width: 0.7rem; height: 0.7rem; margin-right: 0.35rem; border-radius: 999px; vertical-align: -0.05rem; background: var(--accent); }
    .legend-item.raw-source::before { background: #d7663b; }
    .legend-item.wiki-source::before { background: #0e7490; }
    .legend-item.wiki::before { background: #c8a500; }
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
      .content { padding: 1rem; }
      .topbar { display: block; }
      .index-layout { grid-template-columns: 1fr; }
      .index-aside { position: static; }
      .graph-layout { grid-template-columns: 1fr; }
      .log-flow { grid-template-columns: 1fr; }
      .log-arrow { display: none; }
    }
    @media (prefers-color-scheme: dark) {
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
  sideTree?.addEventListener('scroll', () => {
    localStorage.setItem(scrollKey, String(sideTree.scrollTop));
  }, { passive: true });
  window.addEventListener('beforeunload', saveSidebarState);
  applySidebarSearch();
  requestAnimationFrame(() => {
    const savedScroll = Number(localStorage.getItem(scrollKey) || '0');
    if (sideTree && Number.isFinite(savedScroll)) sideTree.scrollTop = savedScroll;
  });

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
          btn.textContent = 'actif';
          btn.style.cssText = 'opacity:0.4;cursor:default';
        } else if (isRunning && isOpened) {
          btn.textContent = 'ouvert';
          btn.style.cssText = 'opacity:0.45;cursor:default';
        } else {
          btn.textContent = isRunning ? 'Ouvrir' : 'Démarrer';
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
      btn.textContent = action === 'start' ? 'Démarrage…' : 'Ouverture…';
      try {
        await fetch('/api/hub/workspaces/' + encodeURIComponent(wsName) + '/' + action, { method: 'POST', headers: { 'X-LLM-WIKI-HUB': '1' } });
        if (action === 'open') {
          markLocallyOpened(wsName);
          btn.textContent = 'ouvert';
        }
        if (action === 'start') {
          btn.textContent = 'Attente…';
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
      const href = localHref(link[2]);
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
      const href = localHref(target);
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
      const srcHref = srcPath ? localHref(srcPath) : undefined;
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

function newMarkdownHref(collection: string): string {
  return `/new/${collection}`;
}

function deleteHref(relativePath: string): string {
  return `/delete/${relativePath}`;
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
  const action =
    depth === 0 && isCreatableCollection(node.name)
      ? `<a class="side-folder-action" href="${escapeHref(newMarkdownHref(node.name))}" title="Créer un markdown" aria-label="Créer dans ${escapeAttr(node.name)}" onclick="event.stopPropagation()">+</a>`
      : '';
  return `<details class="side-folder"${open} data-tree-id="${escapeAttr(node.path)}"><summary><span class="side-folder-label">${escapeHtml(label)}</span>${action}</summary><div class="side-folder-children">${children}</div></details>`;
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

  const wsSwitcher = HUB_PORT
    ? `<div class="ws-switcher" id="ws-switcher" data-current="${escapeAttr(WORKSPACE_NAME ?? '')}"><p class="ws-switcher-title">Workspaces</p><p class="ws-name" style="font-size:0.8rem;color:var(--muted);padding:0 0.2rem">Chargement…</p></div>`
    : '';
  const workspaceName = (WORKSPACE_NAME ?? 'wiki').toUpperCase();
  const graphIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.6 8.1 10.8 15"/><path d="m15.4 8.1-2.2 6.9"/><path d="M9 6h6"/></svg>';
  const chatIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>';
  const mcpIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/></svg>';
  return `<aside class="sidebar"><a class="brand" href="/"><span class="brand-title">${escapeHtml(workspaceName)}</span></a><div class="side-actions" aria-label="Raccourcis"><a class="side-action" href="/graph" title="Graph" aria-label="Graph">${graphIcon}</a><a class="side-action" href="/chat" title="Chat" aria-label="Chat">${chatIcon}</a><a class="side-action" href="http://localhost:${MCP_WIKI_PORT}/mcp" target="_blank" rel="noopener" title="MCP Wiki" aria-label="MCP Wiki">${mcpIcon}</a></div><div class="side-search"><input class="side-search-input" type="search" placeholder="Search files" aria-label="Search files" data-side-search><p class="side-search-status" data-side-search-status>No matching files.</p></div><nav class="side-tree" aria-label="Documents markdown">${tree}</nav>${wsSwitcher}</aside>`;
}

interface GraphNode {
  id: string;
  title: string;
  type: 'raw-source' | 'wiki-source' | 'wiki' | 'deliverable' | 'template' | 'context';
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
  if (relativePath.startsWith('raw/ingested/')) return 'raw-source';
  if (relativePath.startsWith('wiki/sources/')) return 'wiki-source';
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
    if (href && href.endsWith('.md') && !isRawUntrackedReference(href)) {
      targets.add(hrefToRelativePath(href, currentDir));
    }
  }

  for (const match of markdown.matchAll(citationPattern)) {
    const citationPath = match[1]?.trim();
    if (citationPath && !isRawUntrackedReference(citationPath)) {
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
  const graphLayout = document.querySelector('[data-graph-layout]');
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
  const searchInput = document.querySelector('[data-graph-search]');
  const searchDropdown = document.querySelector('[data-graph-search-dropdown]');
  const btnZoomIn = document.querySelector('[data-graph-zoom-in]');
  const btnZoomOut = document.querySelector('[data-graph-zoom-out]');
  const btnCenter = document.querySelector('[data-graph-center]');
  const btnReset = document.querySelector('[data-graph-reset]');
  const btnRelationToggle = document.querySelector('[data-relation-toggle]');
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
  let searchQuery = '';

  function nodeMatchesSearch(node, query) {
    const q = query.toLowerCase();
    return node.id.toLowerCase().includes(q) || node.title.toLowerCase().includes(q);
  }

  function applySearchFilter(query) {
    searchQuery = query;
    if (!query) {
      for (const el of nodeElements.values()) el.classList.remove('is-dimmed');
      for (const entry of linkElements) entry.element.classList.remove('is-dimmed');
      if (selectedId) selectNode(selectedId);
      return;
    }
    const matchingIds = new Set(nodes.filter((n) => nodeMatchesSearch(n, query)).map((n) => n.id));
    for (const [nodeId, el] of nodeElements) {
      el.classList.toggle('is-dimmed', !matchingIds.has(nodeId));
      el.classList.toggle('is-selected', false);
    }
    for (const entry of linkElements) entry.element.classList.remove('is-connected');
  }

  function escapeDropdownHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateDropdown(query) {
    if (!query) { searchDropdown.hidden = true; searchDropdown.innerHTML = ''; return; }
    const matches = nodes.filter((n) => nodeMatchesSearch(n, query)).slice(0, 8);
    if (matches.length === 0) {
      searchDropdown.innerHTML = '<li class="graph-search-empty">Aucun résultat</li>';
    } else {
      searchDropdown.innerHTML = matches.map((n) =>
        '<li class="graph-search-result" data-node-id="' + escapeDropdownHtml(n.id) + '">' +
        '<span class="graph-search-result-dot ' + n.type + '"></span>' +
        '<span class="graph-search-result-title">' + escapeDropdownHtml(n.title) + '</span>' +
        '<span class="graph-search-result-path">' + escapeDropdownHtml(n.id) + '</span>' +
        '</li>'
      ).join('');
    }
    searchDropdown.hidden = false;
  }

  function panToNode(id) {
    const node = byId.get(id);
    if (!node || node.x == null) return;
    view.x = 550 - node.x * view.scale;
    view.y = 360 - node.y * view.scale;
    applyView();
  }

  function clearSearch() {
    if (!searchQuery) return;
    searchQuery = '';
    searchInput.value = '';
    searchDropdown.hidden = true;
  }

  function zoomBy(factor) {
    const nextScale = Math.min(3, Math.max(0.35, view.scale * factor));
    view.x = view.x + 550 * (view.scale - nextScale);
    view.y = view.y + 360 * (view.scale - nextScale);
    view.scale = nextScale;
    applyView();
  }

  function centerSelected() {
    const node = byId.get(selectedId);
    if (!node || node.x == null) return;
    const targetScale = Math.max(view.scale, 1.2);
    view.scale = targetScale;
    view.x = 550 - node.x * targetScale;
    view.y = 360 - node.y * targetScale;
    applyView();
  }

  function resetView() {
    view = { x: 0, y: 0, scale: 1 };
    applyView();
  }

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
        clearSearch();
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
    if (event.key === 'Escape') { closeModal(); clearSearch(); applySearchFilter(''); }
  });

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    applySearchFilter(query);
    updateDropdown(query);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { applySearchFilter(''); updateDropdown(''); searchInput.value = ''; }
  });
  searchDropdown.addEventListener('click', (event) => {
    const result = event.target.closest('[data-node-id]');
    if (!result) return;
    const id = result.dataset.nodeId;
    clearSearch();
    applySearchFilter('');
    selectNode(id);
    panToNode(id);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-graph-search-wrapper]')) {
      searchDropdown.hidden = true;
    }
  });
  btnZoomIn.addEventListener('click', () => zoomBy(1.25));
  btnZoomOut.addEventListener('click', () => zoomBy(1 / 1.25));
  btnCenter.addEventListener('click', centerSelected);
  btnReset.addEventListener('click', resetView);
  btnRelationToggle.addEventListener('click', () => {
    graphLayout.classList.toggle('relations-collapsed');
  });

  render();
})();
</script>`;
}

function renderGraphApp(nodes: GraphNode[], edges: GraphEdge[]): string {
  return `<div class="graph-layout" data-graph-layout><div class="graph-panel"><div class="graph-search-wrapper" data-graph-search-wrapper><div class="graph-toolbar"><div class="graph-search-field"><input class="graph-search-input" type="search" placeholder="Rechercher un n&#x0153;ud&#x2026;" aria-label="Rechercher dans le graph" data-graph-search autocomplete="off"><ul class="graph-search-dropdown" data-graph-search-dropdown hidden></ul></div><div class="graph-ctrl-group"><button class="graph-ctrl-btn" type="button" data-graph-zoom-in title="Zoom avant">+</button><button class="graph-ctrl-btn" type="button" data-graph-zoom-out title="Zoom arri&#xe8;re">&#x2212;</button><button class="graph-ctrl-btn" type="button" data-graph-center title="Centrer sur la s&#xe9;lection" style="font-size:0.9rem">&#x25CE;</button><button class="graph-ctrl-btn" type="button" data-graph-reset title="R&#xe9;initialiser la vue" style="font-size:0.9rem">&#x21BA;</button></div></div></div><div class="graph-stage"><svg class="graph-svg" viewBox="0 0 1100 720" role="img" aria-label="Graph navigable des documents et sources" data-graph-svg><g data-graph-viewport><g data-link-layer></g><g data-node-layer></g></g></svg></div></div><aside class="relation-panel"><div class="relation-panel-header"><button class="relation-toggle" type="button" title="Afficher/masquer les relations" aria-label="Afficher/masquer les relations" data-relation-toggle>&#9776;</button><div class="relation-panel-copy"><h2 class="relation-panel-title">Relations</h2><p class="relation-panel-meta">Ouvrez une relation pour afficher les markdown lies.</p></div></div><ul class="relation-list" data-relation-list></ul></aside></div>
<div class="modal-backdrop" data-relation-modal><section class="relation-modal" role="dialog" aria-modal="true" aria-labelledby="relation-modal-title"><div class="modal-header"><h2 class="modal-title" id="relation-modal-title" data-modal-title>Relation</h2><button class="modal-close" type="button" aria-label="Fermer" data-modal-close>x</button></div><div class="modal-body"><article class="modal-doc"><h3 class="modal-doc-title" data-modal-target-title></h3><div class="modal-markdown" data-modal-target-body></div></article></div></section></div>
${renderGraphScript(nodes, edges)}`;
}

async function generateGraph(rootDir: string): Promise<string> {
  const sidebar = await renderSidebar(rootDir);
  const { nodes, edges } = await buildGraph(rootDir);
  const rawSourceCount = nodes.filter((node) => node.type === 'raw-source').length;
  const wikiSourceCount = nodes.filter((node) => node.type === 'wiki-source').length;
  const graph =
    nodes.length > 0
      ? renderGraphApp(nodes, edges)
      : '<p class="empty">Aucun document markdown à afficher dans le graphe.</p>';
  const body = `${sidebar}<main class="content"><div class="hero"><h1>Graph des sources</h1><p>Les sources et documents du wiki sont représentés par relation. La taille d'un noeud dépend du nombre de liens entrants et sortants. Cliquez sur un noeud pour afficher le markdown associé.</p></div><div class="graph-legend"><span class="legend-item raw-source">${rawSourceCount} source(s) brut(s)</span><span class="legend-item wiki-source">${wikiSourceCount} source(s) wiki</span><span class="legend-item wiki">wiki</span><span class="legend-item deliverable">livrables</span><span class="legend-item template">templates</span><span class="legend-item context">build context</span><span>${edges.length} relation(s)</span></div>${graph}</main>`;
  return layout('Graph des sources', body);
}

async function generateIndex(rootDir: string): Promise<string> {
  const indexPath = path.join(rootDir, 'wiki', 'index.md');
  const raw = (await pathExists(indexPath))
    ? await readFile(indexPath, 'utf8')
    : '# Wiki Index\n\n- wiki/index.md introuvable.';
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
  const sidebar = await renderSidebar(rootDir);
  const body = `${sidebar}<main class="content"><div class="hero"><h1>Wiki Index</h1><p>Point d'entrée du wiki local. L'index complet reste lisible à gauche, avec les principales sections disponibles en tuiles à droite.</p></div><div class="index-layout"><article class="article">${html}</article><aside class="index-aside"><h2 class="index-aside-title">Main sections</h2>${tiles}</aside></div></main>`;
  return layout('wiki', body);
}

async function generateDirectoryPage(
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
  const actions = isCreatableCollection(cleanRelativePath) && cleanRelativePath !== 'deliverables'
    ? `<a class="action-link" href="${escapeHref(newMarkdownHref(cleanRelativePath))}" title="Créer un markdown">+</a>`
    : '';
  const body = `${sidebar}<main class="content">${renderTopbar(`/${cleanRelativePath}`, actions)}<div class="hero"><h1>${escapeHtml(title)}</h1><p>Markdown files under <code>${escapeHtml(cleanRelativePath)}/</code>.</p></div>${content}</main>`;
  return layout(title, body);
}

async function serveMd(
  rootDir: string,
  filePath: string,
  urlPath: string,
): Promise<string> {
  const raw = await readFile(filePath, 'utf8');
  const currentDir = toPosix(path.dirname(urlPath.replace(/^\//, '')));
  const title = path.basename(filePath, '.md');
  const sidebar = await renderSidebar(rootDir);
  const relativePath = urlPath.replace(/^\//, '');
  const html =
    relativePath === 'wiki/log.md'
      ? renderLogMarkdown(raw)
      : await renderMarkdown(raw, currentDir);
  const actions = [
    isEditableRelativePath(relativePath)
      ? `<a class="action-link" href="${escapeHref(editHref(relativePath))}">Edit</a>`
      : '',
    isManagedMarkdownRelativePath(relativePath)
      ? `<form method="post" action="${escapeHref(deleteHref(relativePath))}" onsubmit="return confirm('Supprimer ce fichier ?')"><button class="action-button action-danger" type="submit">Supprimer</button></form>`
      : '',
  ].join('');
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

function chatHistoryDir(rootDir: string): string {
  return path.join(rootDir, CHAT_HISTORY_DIR);
}

function chatHistoryIndexPath(rootDir: string): string {
  return path.join(chatHistoryDir(rootDir), CHAT_HISTORY_INDEX);
}

function assertChatId(id: string): string {
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) {
    throw new Error('INVALID_CHAT_ID');
  }
  return id;
}

function chatConversationPath(rootDir: string, id: string): string {
  return path.join(chatHistoryDir(rootDir), `${assertChatId(id)}.json`);
}

function summarizeConversation(conversation: ChatConversation): ChatHistorySummary {
  return {
    id: String(conversation.id),
    title: String(conversation.title || 'Nouvelle discussion'),
    createdAt: String(conversation.createdAt || new Date().toISOString()),
    updatedAt: String(conversation.updatedAt || new Date().toISOString()),
    messageCount: Number(conversation.messageCount || 0),
    toolCallCount: Number(conversation.toolCallCount || 0),
  };
}

async function readChatHistoryIndex(rootDir: string): Promise<ChatHistorySummary[]> {
  const indexPath = chatHistoryIndexPath(rootDir);
  if (!(await pathExists(indexPath))) return [];
  try {
    const data = JSON.parse(await readFile(indexPath, 'utf8')) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item): item is ChatHistorySummary =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as ChatHistorySummary).id === 'string',
      )
      .map(summarizeConversation)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

async function writeChatHistoryIndex(
  rootDir: string,
  summaries: ChatHistorySummary[],
): Promise<void> {
  await mkdir(chatHistoryDir(rootDir), { recursive: true });
  const deduped = new Map<string, ChatHistorySummary>();
  for (const summary of summaries) deduped.set(summary.id, summary);
  const sorted = [...deduped.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  await safeWriteFile(
    chatHistoryIndexPath(rootDir),
    `${JSON.stringify(sorted, null, 2)}\n`,
  );
}

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((count, message) => {
    if (!message || typeof message !== 'object') return count;
    const msg = message as { role?: string; tool_calls?: unknown };
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
    return count + calls + (msg.role === 'tool' ? 1 : 0);
  }, 0);
}

function normalizeConversationPayload(
  raw: string,
  existing?: ChatConversation,
): ChatConversation {
  const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = assertChatId(String(parsed.id || existing?.id || `conv_${Date.now()}`));
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return {
    ...existing,
    ...parsed,
    id,
    title: String(parsed.title || existing?.title || 'Nouvelle discussion').slice(0, 120),
    createdAt: String(parsed.createdAt || existing?.createdAt || now),
    updatedAt: String(parsed.updatedAt || now),
    messageCount: messages.length,
    toolCallCount: countToolCalls(messages),
  };
}

async function readConversation(
  rootDir: string,
  id: string,
): Promise<ChatConversation | null> {
  const conversationPath = chatConversationPath(rootDir, id);
  if (!(await pathExists(conversationPath))) return null;
  return JSON.parse(await readFile(conversationPath, 'utf8')) as ChatConversation;
}

async function upsertConversation(
  rootDir: string,
  rawBody: string,
  existing?: ChatConversation,
): Promise<ChatConversation> {
  const conversation = normalizeConversationPayload(rawBody, existing);
  await mkdir(chatHistoryDir(rootDir), { recursive: true });
  await safeWriteFile(
    chatConversationPath(rootDir, conversation.id),
    `${JSON.stringify(conversation, null, 2)}\n`,
  );
  const summaries = await readChatHistoryIndex(rootDir);
  await writeChatHistoryIndex(rootDir, [
    summarizeConversation(conversation),
    ...summaries.filter((item) => item.id !== conversation.id),
  ]);
  return conversation;
}

function sendJson(
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    end: (c?: string) => void;
  },
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseTraceFields(rest: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of rest.matchAll(/(\w+)=((?:"[^"]*")|(?:\[[^\]]*\])|(?:\S+))/g)) {
    fields[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return fields;
}

async function readProductionTraceStatus(
  rootDir: string,
  traceFile: string,
): Promise<Record<string, unknown>> {
  const tracePath = resolveInside(rootDir, traceFile);
  if (
    !tracePath ||
    !tracePath.startsWith(path.join(rootDir, '.wiki', 'logs') + path.sep)
  ) {
    throw new Error('INVALID_TRACE_PATH');
  }
  const lines = (await readFile(tracePath, 'utf8')).split(/\r?\n/).filter(Boolean);
  let lastEvent = '';
  let lastEventAt = '';
  let waitMs: number | undefined;
  let retryAt: string | undefined;
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+\+\d+ms\s+\S+\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    const [, at, event, rest] = match;
    lastEvent = event;
    lastEventAt = at;
    if (event !== 'provider:throttle') {
      waitMs = undefined;
      retryAt = undefined;
      continue;
    }
    const fields = parseTraceFields(rest);
    const parsedWaitMs = Number(fields.waitMs);
    waitMs = Number.isFinite(parsedWaitMs) ? parsedWaitMs : undefined;
    retryAt = fields.retryAt;
    if (!retryAt && waitMs !== undefined) {
      retryAt = new Date(Date.parse(at) + waitMs).toISOString();
    }
  }
  return { ok: true, traceFile, lastEvent, lastEventAt, waitMs, retryAt };
}

async function handleChatHistoryApi(
  rootDir: string,
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h?: Record<string, string>) => void;
    end: (c?: string) => void;
  },
  urlPath: string,
): Promise<boolean> {
  if (!urlPath.startsWith('/api/chat/history')) return false;
  try {
    const id = urlPath.replace(/^\/api\/chat\/history\/?/, '').replace(/\/+$/, '');
    if (!id) {
      if (req.method === 'GET') {
        sendJson(res, 200, await readChatHistoryIndex(rootDir));
        return true;
      }
      if (req.method === 'POST') {
        const conversation = await upsertConversation(
          rootDir,
          await readRequestBody(req),
        );
        sendJson(res, 201, summarizeConversation(conversation));
        return true;
      }
    } else {
      assertChatId(id);
      if (req.method === 'GET') {
        const conversation = await readConversation(rootDir, id);
        if (!conversation) {
          sendJson(res, 404, { error: 'Conversation not found' });
          return true;
        }
        sendJson(res, 200, conversation);
        return true;
      }
      if (req.method === 'PUT') {
        const existing = await readConversation(rootDir, id);
        const conversation = await upsertConversation(
          rootDir,
          await readRequestBody(req),
          existing ?? ({ id } as ChatConversation),
        );
        sendJson(res, 200, summarizeConversation(conversation));
        return true;
      }
      if (req.method === 'DELETE') {
        await rm(chatConversationPath(rootDir, id), { force: true });
        const summaries = await readChatHistoryIndex(rootDir);
        await writeChatHistoryIndex(
          rootDir,
          summaries.filter((item) => item.id !== id),
        );
        sendJson(res, 200, { ok: true });
        return true;
      }
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, message === 'INVALID_CHAT_ID' ? 400 : 500, { error: message });
    return true;
  }
}

async function handleSkillsApi(
  rootDir: string,
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h?: Record<string, string>) => void;
    end: (c?: string) => void;
  },
  urlPath: string,
): Promise<boolean> {
  if (urlPath !== '/api/skills' && !urlPath.startsWith('/api/skills/')) return false;
  const name = urlPath.replace(/^\/api\/skills\/?/, '').replace(/\/+$/, '');
  try {
    if (!name) {
      if (req.method === 'GET') {
        sendJson(res, 200, await listSkills(rootDir));
        return true;
      }
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    assertSkillName(name);
    if (req.method === 'GET') {
      const skill = await readSkillByName(rootDir, name);
      if (!skill) {
        sendJson(res, 404, { error: 'Skill not found' });
        return true;
      }
      sendJson(res, 200, skill);
      return true;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readRequestBody(req);
      const data = JSON.parse(raw) as {
        description?: string;
        params?: unknown;
        body?: string;
      };
      const skill = {
        name,
        description: String(data.description ?? ''),
        params: Array.isArray(data.params) ? data.params.map(String) : [],
        body: String(data.body ?? ''),
      };
      await mkdir(path.join(rootDir, SKILLS_DIR), { recursive: true });
      await safeWriteFile(skillFilePath(rootDir, name), formatSkillFile(skill));
      sendJson(res, 200, { ...skill, scope: 'workspace' as const });
      return true;
    }
    if (req.method === 'DELETE') {
      await rm(skillFilePath(rootDir, name), { force: true });
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, message === 'INVALID_SKILL_NAME' ? 400 : 500, { error: message });
    return true;
  }
}

async function proxyPost(
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    write: (c: Uint8Array) => void;
    end: () => void;
    headersSent?: boolean;
  },
  targetUrl: string,
  extraHeaders: Record<string, string> = {},
  options: { retry429?: boolean } = {},
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);

  const headers: Record<string, string> = {
    'content-type': (req.headers['content-type'] as string) ?? 'application/json',
    accept: (req.headers['accept'] as string) ?? 'application/json, text/event-stream',
  };
  // Forward browser Authorization only when server doesn't override it
  if (!extraHeaders['authorization'] && req.headers['authorization']) {
    headers['authorization'] = req.headers['authorization'] as string;
  }
  Object.assign(headers, extraHeaders);
  const sid = req.headers['mcp-session-id'];
  if (sid) headers['mcp-session-id'] = sid as string;

  const maxAttempts = options.retry429
    ? Math.max(
        1,
        Number(
          process.env.LLM_WIKI_CHAT_RATE_LIMIT_RETRY_MAX_ATTEMPTS ??
            process.env.LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS ??
            '10',
        ),
      )
    : 1;
  let upstream: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    upstream = await fetch(targetUrl, { method: 'POST', headers, body });
    if (upstream.status !== 429 || attempt >= maxAttempts) break;
    const retryAfter = upstream.headers.get('retry-after');
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    const retryAfterDate = retryAfter ? Date.parse(retryAfter) : NaN;
    const fallbackMs = Math.max(
      0,
      Number(process.env.LLM_WIKI_RATE_LIMIT_RETRY_MS ?? '65000'),
    );
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds * 1000)
      : Number.isFinite(retryAfterDate)
        ? Math.max(0, retryAfterDate - Date.now())
        : fallbackMs;
    await upstream.text().catch(() => '');
    console.warn(
      `wiki serve proxy rate limited: ${targetUrl} attempt=${attempt}/${maxAttempts} waitMs=${waitMs}`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  if (!upstream) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.write(new TextEncoder().encode('Upstream request was not attempted.'));
    res.end();
    return;
  }
  const ct = upstream.headers.get('content-type') ?? 'application/json';
  const respSid = upstream.headers.get('mcp-session-id');
  const respHeaders: Record<string, string> = { 'content-type': ct };
  if (respSid) respHeaders['mcp-session-id'] = respSid;

  res.writeHead(upstream.status, respHeaders);
  if (upstream.body) {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

function resolveEditableMarkdown(rootDir: string, relativePath: string): string {
  const cleanRelativePath = toPosix(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!isEditableRelativePath(cleanRelativePath)) {
    throw new Error(
      `FORBIDDEN_EDIT_PATH: Editing is only allowed for markdown files under ${EDITABLE_DIRS.join(', ')}`,
    );
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
  const body = `${sidebar}<main class="content">${renderTopbar(`/${cleanRelativePath}`)}<form class="edit-form" method="post" action="${escapeHref(editHref(cleanRelativePath))}"><div class="hero"><h1>Edit ${escapeHtml(cleanRelativePath)}</h1><div class="page-actions"><button class="action-button" type="submit">Save</button><a class="action-link" href="${escapeHref(`/${cleanRelativePath}`)}">Cancel</a></div></div><textarea class="edit-textarea" name="content" spellcheck="false">${escapeHtml(raw)}</textarea></form></main>`;
  return layout(`Edit ${path.basename(cleanRelativePath)}`, body);
}

async function generateNewMarkdownPage(
  rootDir: string,
  collection: string,
): Promise<string> {
  if (!isCreatableCollection(collection)) {
    throw new Error('FORBIDDEN_CREATE_PATH');
  }
  const sidebar = await renderSidebar(rootDir);
  const defaultContent = '# Nouveau document\n\n';
  const body = `${sidebar}<main class="content">${renderTopbar(`/${collection}`)}<form class="edit-form" method="post" action="${escapeHref(newMarkdownHref(collection))}"><div class="hero"><h1>Nouveau ${escapeHtml(collection)}</h1><div class="page-actions"><button class="action-button" type="submit">Créer</button><a class="action-link" href="${escapeHref(`/${collection}`)}">Cancel</a></div></div><label class="field-label" for="new-md-title">Nom du fichier</label><input class="field-input" id="new-md-title" name="title" type="text" placeholder="analyse-fonctionnelle" required autocomplete="off"><textarea class="edit-textarea" name="content" spellcheck="false">${escapeHtml(defaultContent)}</textarea></form></main>`;
  return layout(`New ${collection}`, body);
}

async function createMarkdownDocument(
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
  await safeWriteFile(absolute, content);
  return relativePath;
}

async function deleteMarkdownDocument(
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

async function generateNotFoundPage(rootDir: string, urlPath: string): Promise<string> {
  const sidebar = await renderSidebar(rootDir);
  const cleanPath = toPosix(urlPath.replace(/^\/+/, '')) || '/';
  const rawUntrackedHint = isRawUntrackedReference(cleanPath)
    ? '<p>Cette URL pointe vers <code>raw/untracked</code>. Ces fichiers sont des sources temporaires et peuvent être archivés ou déplacés après ingestion.</p>'
    : '<p>La page demandée n’existe pas dans ce workspace, ou le fichier a été déplacé.</p>';
  const body = `${sidebar}<main class="content"><section class="not-found-panel"><h1>Document introuvable</h1>${rawUntrackedHint}<code class="not-found-path">${escapeHtml(cleanPath)}</code><div class="page-actions"><button class="action-button" type="button" onclick="history.length > 1 ? history.back() : location.assign('/')">Retour</button><a class="action-link" href="/">Accueil</a></div></section></main>`;
  return layout('Document introuvable', body);
}

async function generateSkillsPage(rootDir: string): Promise<string> {
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
<div class="hero"><h1>Skills</h1><p>Commandes réutilisables invocables avec <code style="background:var(--panel-soft);padding:1px 6px;border-radius:4px;font-size:.9em">/nom</code> dans le chat. Le corps du skill remplit le champ message pour lancer une instruction préparée.</p></div>
<div class="page-actions"><button class="action-button" onclick="openEditor(null)">+ Nouveau skill</button></div>
<div id="skills-list"></div>

<div class="editor-overlay" id="editor-overlay" onclick="handleOverlayClick(event)">
  <div class="editor-panel" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div class="editor-title" id="editor-title">Nouveau skill</div>
      <button class="action-button" onclick="closeEditor()">✕</button>
    </div>
    <div>
      <label class="field-label" for="f-name">Nom <span style="color:var(--err)">*</span></label>
      <input class="field-input" id="f-name" type="text" placeholder="pipeline" pattern="[a-zA-Z0-9_-]{1,60}" autocomplete="off">
      <div class="field-sub">Lettres, chiffres, - et _ uniquement. Invoqué avec /nom dans le chat.</div>
    </div>
    <div>
      <label class="field-label" for="f-desc">Description</label>
      <input class="field-input" id="f-desc" type="text" placeholder="Lance le pipeline complet via l'agent production">
    </div>
    <div>
      <label class="field-label" for="f-params">Paramètres <span style="font-weight:400;color:var(--muted)">(séparés par des virgules)</span></label>
      <input class="field-input" id="f-params" type="text" placeholder="space, template">
      <div class="field-sub">Ex : <code style="font-size:.85em">space</code> → référencé dans le corps avec <code style="font-size:.85em">{space}</code>.</div>
    </div>
    <div>
      <label class="field-label" for="f-body">Corps du skill <span style="color:var(--err)">*</span></label>
      <textarea class="field-textarea" id="f-body" placeholder="Vérifie le statut CME avec cme_status, puis lance cme_export_run(source_name=&quot;{space}&quot;)…"></textarea>
      <div class="field-sub">Instructions en langage naturel que le LLM suivra. Les paramètres sont insérés sous forme de placeholders à remplacer avant l'envoi.</div>
    </div>
    <div class="editor-actions">
      <button class="action-button" onclick="closeEditor()">Annuler</button>
      <button class="action-button" style="background:var(--accent);color:#fff;border-color:var(--accent)" onclick="saveSkill()">Enregistrer</button>
    </div>
  </div>
</div>

<script>
function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
let skills=[];

async function loadSkills(){
  const r=await fetch('/api/skills');
  if(!r.ok){document.getElementById('skills-list').innerHTML='<div class="empty-state"><p>Impossible de charger les skills.</p></div>';return;}
  skills=await r.json();
  renderList();
}

function renderList(){
  const el=document.getElementById('skills-list');
  if(!skills.length){
    el.innerHTML='<div class="empty-state"><p>Aucun skill. Créez votre premier skill avec le bouton ci-dessus.</p></div>';
    return;
  }
  el.innerHTML='<div class="skills-grid">'+skills.map(s=>\`
    <div class="skill-card">
      <div class="skill-card-name">/\${escH(s.name)}</div>
      \${s.description?'<div class="skill-card-desc">'+escH(s.description)+'</div>':''}
      \${s.params&&s.params.length?'<div class="skill-card-params">'+s.params.map(p=>'<span class="skill-param">{'+escH(p)+'}</span>').join('')+'</div>':''}
      \${s.body?'<div class="skill-card-body-preview">'+escH(s.body.slice(0,120))+(s.body.length>120?'…':'')+'</div>':''}
      <div class="skill-card-actions">
        <button class="action-button" onclick="openEditorByIndex(\${i})">Modifier</button>
        <button class="action-button del-btn" onclick="deleteSkillByIndex(\${i})">Supprimer</button>
      </div>
    </div>
  \`).join('')+'</div>';
}

function openEditorByIndex(idx){openEditor(skills[idx]);}

function openEditor(skill){
  document.getElementById('editor-title').textContent=skill?'Modifier /'+skill.name:'Nouveau skill';
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
  if(!name){alert('Le nom est requis.');return;}
  if(!body.trim()){alert('Le corps du skill est requis.');return;}
  const r=await fetch('/api/skills/'+encodeURIComponent(name),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({description,params,body}),
  });
  if(!r.ok){const e=await r.json();alert(e.error||'Erreur');return;}
  closeEditor();
  await loadSkills();
}

async function deleteSkill(name){
  if(!confirm('Supprimer le skill /'+name+' ?'))return;
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

function openAppMode(url: string): void {
  const platform = process.platform;

  if (platform === 'darwin') {
    // Try Chrome, then Edge, then Safari
    const fallback = () => {
      spawn('open', ['-a', 'Safari', url], { stdio: 'ignore', detached: true }).unref();
    };
    const openEdge = () => {
      const edgeTry = spawn('open', ['-na', 'Microsoft Edge', '--args', `--app=${url}`], {
        stdio: 'ignore',
        detached: true,
      });
      edgeTry.on('error', fallback);
      edgeTry.on('close', (code) => {
        if (code !== 0) fallback();
      });
      edgeTry.unref();
    };
    const chromiumTry = spawn(
      'open',
      ['-na', 'Google Chrome', '--args', `--app=${url}`],
      {
        stdio: 'ignore',
        detached: true,
      },
    );
    chromiumTry.on('error', openEdge);
    chromiumTry.on('close', (code) => {
      if (code !== 0) openEdge();
    });
    chromiumTry.unref();
    return;
  }

  if (platform === 'linux') {
    // Try Chrome, then Edge, then xdg-open
    const chromeCandidates = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
    ];
    const edgeCandidates = ['microsoft-edge', 'microsoft-edge-stable'];

    function tryNext(candidates: string[], fallback: () => void): void {
      const [cmd, ...rest] = candidates;
      if (!cmd) {
        fallback();
        return;
      }
      const proc = spawn(cmd, [`--app=${url}`], { stdio: 'ignore', detached: true });
      proc.on('error', () => tryNext(rest, fallback));
      proc.unref();
    }

    tryNext(chromeCandidates, () => {
      tryNext(edgeCandidates, () => {
        spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
      });
    });
    return;
  }

  if (platform === 'win32') {
    // Try Chrome, then Edge, then start default
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    function tryNext(paths: string[], fallback: () => void): void {
      const [exe, ...rest] = paths;
      if (!exe) {
        fallback();
        return;
      }
      const proc = spawn(exe, [`--app=${url}`], { stdio: 'ignore', detached: true });
      proc.on('error', () => tryNext(rest, fallback));
      proc.unref();
    }

    tryNext(chromePaths, () => {
      tryNext(edgePaths, () => {
        spawn('cmd', ['/c', 'start', '', url], {
          stdio: 'ignore',
          detached: true,
          shell: true,
        }).unref();
      });
    });
    return;
  }

  // Fallback: best-effort open
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

export default async function serveCmd(
  config: AppConfig,
  options: { port?: number; open?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const rootDir = workspace.paths.rootDir;
  const port = options.port ?? 3000;

  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(
        new URL(req.url ?? '/', `http://localhost`).pathname,
      );

      if (await handleChatHistoryApi(rootDir, req, res, urlPath)) {
        return;
      }

      if (await handleSkillsApi(rootDir, req, res, urlPath)) {
        return;
      }

      if (req.method === 'GET' && urlPath === '/api/production/trace') {
        try {
          const traceFile =
            new URL(req.url ?? '/', 'http://localhost').searchParams.get('path') ?? '';
          sendJson(res, 200, await readProductionTraceStatus(rootDir, traceFile));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, message === 'INVALID_TRACE_PATH' ? 400 : 404, {
            ok: false,
            error: message,
          });
        }
        return;
      }

      // ── Hub proxy (same-origin façade over the host-side hub.js) ──────────
      if (HUB_PORT && HUB_TOKEN && urlPath.startsWith('/api/hub/')) {
        // CSRF guard: custom header required; reject cross-origin POSTs
        if (!req.headers['x-llm-wiki-hub']) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return;
        }
        if (req.method === 'POST') {
          const origin = req.headers['origin'] as string | undefined;
          const host = req.headers.host;
          let allowedOrigin = !origin;
          if (origin && host) {
            try {
              const parsedOrigin = new URL(origin);
              const [hostName, hostPort = ''] = host.split(':');
              const sameHost =
                origin === `http://${host}` || origin === `https://${host}`;
              const sameLoopbackPort =
                ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname) &&
                ['localhost', '127.0.0.1'].includes(hostName ?? '') &&
                parsedOrigin.port === hostPort;
              allowedOrigin = sameHost || sameLoopbackPort;
            } catch {
              allowedOrigin = false;
            }
          }
          if (!allowedOrigin) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
        }
        const hubPath = urlPath.slice('/api/hub'.length);
        const chunks: Buffer[] = [];
        for await (const chunk of req)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const hubBody = Buffer.concat(chunks);
        try {
          const upstream = await fetch(
            `http://${HUB_INTERNAL_HOST}:${HUB_PORT}${hubPath}`,
            {
              method: req.method ?? 'GET',
              headers: {
                authorization: `Bearer ${HUB_TOKEN}`,
                'content-type': 'application/json',
              },
              body: hubBody.length > 0 ? hubBody : undefined,
            },
          );
          const data = await upstream.text();
          res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
          res.end(data);
        } catch {
          sendJson(res, 503, { ok: false, error: 'hub unavailable' });
        }
        return;
      }

      // ── Server-side proxies (avoid CORS + Docker internal URLs) ────────────
      if (req.method === 'POST') {
        if (urlPath === '/api/chat') {
          await proxyPost(
            req,
            res,
            `${config.llm.baseUrl}/chat/completions`,
            {
              authorization: `Bearer ${config.llm.apiKey ?? ''}`,
            },
            { retry429: true },
          );
          return;
        }
        if (urlPath === '/api/mcp') {
          const target =
            new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? '';
          if (!target) {
            res.writeHead(400);
            res.end('url param required');
            return;
          }
          const wikiTarget =
            process.env.WIKI_MCP_PROXY_URL ?? `http://localhost:${MCP_WIKI_PORT}/mcp`;
          const cmeTarget =
            process.env.CME_MCP_PROXY_URL ?? `http://localhost:${MCP_CME_PORT}/mcp/`;
          const mailerTarget =
            process.env.MAILER_MCP_PROXY_URL ??
            `http://localhost:${MCP_MAILER_PORT}/mcp/`;
          const productionTarget =
            process.env.PRODUCTION_MCP_PROXY_URL ??
            `http://localhost:${MCP_PRODUCTION_PORT}/mcp/`;
          const proxyTokens: Record<string, string> = {
            [wikiTarget]: process.env.WIKI_MCP_AUTH_TOKEN || config.mcp.accessKey || '',
            [cmeTarget]: process.env.CME_MCP_AUTH_TOKEN ?? '',
            [mailerTarget]: process.env.MAILER_MCP_AUTH_TOKEN ?? '',
            [productionTarget]: process.env.PRODUCTION_MCP_AUTH_TOKEN ?? '',
          };
          const bearer = proxyTokens[target] ?? '';
          await proxyPost(
            req,
            res,
            target,
            bearer ? { authorization: `Bearer ${bearer}` } : {},
          );
          return;
        }
      }

      if (urlPath.startsWith('/new/')) {
        const collection = urlPath.replace(/^\/new\//, '').replace(/\/+$/, '');
        if (req.method === 'GET') {
          try {
            const html = await generateNewMarkdownPage(rootDir, collection);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
          } catch {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
          }
          return;
        }
        if (req.method === 'POST') {
          try {
            const relativePath = await createMarkdownDocument(
              rootDir,
              collection,
              await readRequestBody(req),
            );
            res.writeHead(303, { Location: escapeHref(`/${relativePath}`) });
            res.end();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const status =
              message === 'MARKDOWN_ALREADY_EXISTS'
                ? 409
                : message === 'INVALID_MARKDOWN_TITLE'
                  ? 400
                  : 403;
            res.writeHead(status, { 'Content-Type': 'text/plain' });
            res.end(
              status === 409
                ? 'File already exists'
                : status === 400
                  ? 'Invalid title'
                  : 'Forbidden',
            );
          }
          return;
        }
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

      if (urlPath.startsWith('/delete/')) {
        const relative = urlPath.replace(/^\/delete\//, '').replace(/\/+$/, '');
        if (req.method === 'POST') {
          try {
            const collection = await deleteMarkdownDocument(rootDir, relative);
            res.writeHead(303, { Location: escapeHref(`/${collection}`) });
            res.end();
          } catch {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
          }
          return;
        }
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

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

      if (urlPath === '/chat' || urlPath === '/chat/connectors') {
        const chatConfig = {
          model: config.llm.model,
          temperature: config.llm.temperature,
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey ?? '',
          language: config.language ?? 'fr',
          workspaceName: WORKSPACE_NAME ?? path.basename(rootDir),
          storageScope: createHash('sha256')
            .update(`${WORKSPACE_NAME ?? ''}:${rootDir}`)
            .digest('hex')
            .slice(0, 16),
          mcpServers: [
            {
              name: 'llm-wiki',
              url:
                process.env.WIKI_MCP_PROXY_URL ?? `http://localhost:${MCP_WIKI_PORT}/mcp`,
            },
            {
              name: 'wiki-production',
              url:
                process.env.PRODUCTION_MCP_PROXY_URL ??
                `http://localhost:${MCP_PRODUCTION_PORT}/mcp/`,
            },
            {
              name: 'agent-cme',
              url:
                process.env.CME_MCP_PROXY_URL ?? `http://localhost:${MCP_CME_PORT}/mcp/`,
            },
            {
              name: 'donna-mailer',
              url:
                process.env.MAILER_MCP_PROXY_URL ??
                `http://localhost:${MCP_MAILER_PORT}/mcp/`,
            },
          ],
        };
        const cfgScript = `<script>window.__WIKI_CONFIG__=${escapeScriptJson(JSON.stringify(chatConfig))};</script>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(CHAT_HTML.replace('</head>', `${cfgScript}</head>`));
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

      if (urlPath === '/assets/marked.min.js') {
        const js = await readFile(MARKED_DIST_PATH, 'utf8');
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

      if (urlPath === '/skills') {
        const html = await generateSkillsPage(rootDir);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const relative = urlPath.replace(/^\//, '').replace(/\/+$/, '');
      if (!isServedRelativePath(relative)) {
        const html = await generateNotFoundPage(rootDir, urlPath);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const absolute = path.resolve(rootDir, relative);
      if (!absolute.startsWith(rootDir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (!(await pathExists(absolute))) {
        const html = await generateNotFoundPage(rootDir, urlPath);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const absoluteStats = await stat(absolute);
      if (absoluteStats.isDirectory()) {
        const html =
          relative === 'wiki'
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
    const url = `http://localhost:${port}`;
    console.log(`wiki serve  →  ${url}`);
    console.log('Ctrl-C to stop.');
    if (options.open) openAppMode(url);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`wiki serve stopping (${signal})...`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 5_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
