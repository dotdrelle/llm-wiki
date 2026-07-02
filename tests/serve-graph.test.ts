import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function serveSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/commands/serve.ts'), 'utf8');
}

describe('serve graph ui', () => {
  it('renders sidebar chat and graph actions as two wide buttons', async () => {
    const source = await serveSource();

    expect(source).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(source).toContain('min-height: 2.75rem;');
    expect(source).toContain('<span>Chat</span>');
    expect(source).toContain('<span>Graph</span>');
  });

  it('renders a persistent draggable main sidebar resizer', async () => {
    const source = await serveSource();

    expect(source).toContain('grid-template-columns: var(--wiki-sidebar-w, 280px) 6px minmax(0, 1fr);');
    expect(source).toContain('class="wiki-main-resizer" data-wiki-main-resizer');
    expect(source).toContain('role="separator" aria-orientation="vertical"');
    expect(source).toContain('function initMainSidebarResizer()');
    expect(source).toContain("const WKEY = 'llm-wiki:sidebar:width';");
    expect(source).toContain('return Math.max(220, Math.min(px, window.innerWidth - 420));');
    expect(source).toContain("shell.style.setProperty('--wiki-sidebar-w', v + 'px');");
    expect(source).toContain("document.body.style.cursor = 'col-resize';");
  });

  it('renders a persistent draggable Pending panel resizer', async () => {
    const source = await serveSource();

    expect(source).toContain('data-pending-resizer');
    expect(source).toContain("role=\"separator\" aria-orientation=\"horizontal\"");
    expect(source).toContain('flex: 0 0 var(--pending-height, 32vh);');
    expect(source).toContain("const PKEY = 'llm-wiki:sidebar:pendingHeight';");
    expect(source).toContain('startH + (startY - e.clientY)');
    expect(source).toContain("panel.addEventListener('toggle', syncResizer);");
  });

  it('opens Pending markdown in the editor and keeps save/cancel on valid routes', async () => {
    const source = await serveSource();

    expect(source).toContain('href="${escapeHref(`/${file}`)}"');
    expect(source).toContain('title="${safePath}"');
    expect(source).toContain("const cancelHref = isRawUntrackedReference(cleanRelativePath) ? '/'");
    expect(source).toContain('const redirectAfterSave = isRawUntrackedReference(savedRelative)');
    expect(source).toContain('? escapeHref(editHref(savedRelative))');
  });

  it('groups concept tiles from frontmatter or concept subfolders', async () => {
    const source = await serveSource();

    expect(source).toContain('async function hydrateConceptTileGroups');
    expect(source).toContain("parsed.data.group");
    expect(source).toContain("href.startsWith('/wiki/concepts/')");
    expect(source).toContain('await hydrateConceptTileGroups(rootDir, indexTiles);');
    expect(source).toContain('section-browser-group');
  });

  it('uses concept groups and wiki links in graph data', async () => {
    const source = await serveSource();

    expect(source).toContain('function graphWikiTargetPath');
    expect(source).toContain('extractWikiLinks(markdown)');
    expect(source).toContain('function graphConceptGroup');
    expect(source).toContain('group: groups.get(file)');
    expect(source).toContain("node.group ? node.group + ' · ' + node.id : node.id");
  });

  it('refreshes graph data without reloading the page', async () => {
    const source = await serveSource();

    expect(source).toContain("await reloadGraphData(payload.etag);");
    expect(source).toContain("fetch('/api/graph-data', { cache: 'no-store' })");
    expect(source).toContain('simulation?.stop();');
    expect(source).not.toContain('window.location.reload();');
  });

  it('shows direct node open link and concise relation actions', async () => {
    const source = await serveSource();

    expect(source).toContain('data-relation-node-open');
    expect(source).toContain('class="relation-title"');
    expect(source).toContain('class="relation-subpath"');
    expect(source).toContain("querySelector('.relation-title').textContent = from.title");
    expect(source).toContain('<span class="relation-arrow">↓</span>');
    expect(source).toContain('type="button">Open</button>');
    expect(source).not.toContain('Afficher les markdown');
    expect(source).not.toContain('relie a');
  });

  it('can expand the graph to use most of the page', async () => {
    const source = await serveSource();

    expect(source).toContain('data-graph-expand');
    expect(source).toContain('graph-page-expanded');
    expect(source).toContain('graphLayout.classList.toggle');
    expect(source).toContain("graphPage?.classList.toggle('graph-page-expanded'");
    expect(source).toContain('height: calc(100vh - 9.5rem);');
  });

  it('anchors the expanded graph legend to the actual graph panel', async () => {
    const source = await serveSource();

    expect(source).toContain('left: var(--graph-legend-left, 1rem);');
    expect(source).toContain('graphPanel.getBoundingClientRect().left + 12');
    expect(source).toContain("window.addEventListener('resize', syncExpandedLegendPosition);");
    expect(source).toContain('-webkit-backdrop-filter: blur(6px);');
  });
});

describe('serve command palette', () => {
  it('locks background scroll and preserves keyboard navigation', async () => {
    const source = await serveSource();

    expect(source).toContain("document.body.style.overflow = 'hidden';");
    expect(source).toContain('document.body.style.overflow = previousOverflow;');
    expect(source).toContain('input.focus({ preventScroll: true });');
    expect(source).not.toContain("backdrop.addEventListener('wheel'");
    expect(source).toContain('function moveSelection(delta)');
    expect(source).toContain('function openSelected()');
  });

  it('keeps sidebar file paths available to the palette', async () => {
    const source = await serveSource();

    expect(source).toContain('data-side-path="${safePath}"');
    expect(source).toContain("document.querySelectorAll('[data-side-path]')");
  });

  it('serves markdown pages without browser cache so sidebar changes are fresh', async () => {
    const source = await serveSource();

    expect(source).toContain("'Cache-Control': 'no-store, no-cache, must-revalidate'");
    expect(source).toContain('const html = await serveMd(rootDir, absolute, urlPath);');
    expect(source).toContain('await sendGzippedHtml(req, res, html);');
    expect(source).not.toContain('async function navigationEtag(rootDir: string)');
    expect(source).not.toContain('function pageEtag(');
    expect(source).not.toContain('function requestHasEtag(');
  });

  it('keeps wiki editor actions sticky and shows file freshness', async () => {
    const source = await serveSource();

    expect(source).toContain('.edit-form .hero {');
    expect(source).toContain('position: sticky;');
    expect(source).toContain('.edit-file-state');
    expect(source).toContain('function fileStateLabel');
    expect(source).toContain("label: `${isNew ? 'new' : 'updated'} ${relativeTimeLabel(updatedAt)}`");
    expect(source).toContain('<span class="edit-path-label"><span>${escapeHtml(cleanRelativePath)}</span>${fileStateHtml}</span>');
  });
});

describe('serve deliverables ui', () => {
  it('labels deliverables by production type and avoids stale delete redirects', async () => {
    const source = await serveSource();

    expect(source).toContain("if (base.endsWith('.export.polished')) return 'polish';");
    expect(source).toContain("if (base.endsWith('.export')) return 'export';");
    expect(source).toContain("return 'build';");
    expect(source).toContain('data-deliverable-kind="${deliverableKind(file)}"');
    expect(source).toContain("'Cache-Control': 'no-store, no-cache, must-revalidate'");
    expect(source).toContain(
      "return collection === 'templates' || collection === 'build-context';",
    );
    expect(source).toContain("segment.startsWith('.tmp.') || segment.startsWith('.changes.')");
    expect(source).toContain('depth === 0 && isCreatableCollection(node.name)');
    expect(source).not.toContain("node.name !== 'deliverables'");
    expect(source).not.toContain("cleanRelativePath !== 'deliverables'");
    expect(source).toContain('class="delete-confirm"');
    expect(source).toContain('delete-confirm-panel');
    expect(source).not.toContain("confirm('Delete this file?')");
  });
});

describe('serve missing feature endpoints', () => {
  it('exposes template rename and llm config controls', async () => {
    const source = await serveSource();

    expect(source).toContain('function renameHref(relativePath: string)');
    expect(source).toContain("urlPath.startsWith('/rename/')");
    expect(source).toContain('async function renameTemplate()');
    expect(source).toContain("urlPath === '/api/llm-config'");
    expect(source).toContain("req.headers['x-llm-wiki-llm-base-url']");
  });

  it('explains pending raw sources in the dashboard', async () => {
    const source = await serveSource();

    expect(source).toContain('Sources in raw/untracked');
  });
});

describe('serve chat proxy', () => {
  it('reports unreachable LLM upstreams as a gateway error with Docker guidance', async () => {
    const source = await serveSource();

    expect(source).toContain('function upstreamFetchFailureMessage');
    expect(source).toContain("sendJson(res, 502");
    expect(source).toContain('retryNetwork?: boolean');
    expect(source).toContain('setTimeout(resolve, 250)');
    expect(source).toContain('Upstream unreachable (${target}): ${detail}');
    expect(source).toContain('retryNetwork: true');
    expect(source).toContain('use the container network hostname, not 127.0.0.1');
    expect(source).toContain('process.env.WIKI_MCP_HTTP_PORT ?? process.env.WIKI_MCP_PORT');
    expect(source).toContain('try {');
    expect(source).toContain('const { done, value } = await reader.read();');
    expect(source).toContain('function chatProxyErrorStatus');
    expect(source).toContain("message === 'INVALID_LLM_BASE_URL' ? 400 : 502");
  });
});

describe('serve config reload', () => {
  it('watches the config directory and mutates the live config object', async () => {
    const source = await serveSource();

    expect(source).toContain('export function watchConfigReload');
    expect(source).toContain('watch(path.dirname(config.configPath)');
    expect(source).toContain('if (filename && filename.toString() !== configFileName) return;');
    expect(source).toContain('}, 300);');
    expect(source).toContain('Object.assign(config, fresh);');
    expect(source).toContain('configWatcher?.close();');
  });

  it('proxies config profile switching through the manager runtime and mirrors returned config', async () => {
    const source = await serveSource();

    expect(source).toContain("urlPath === '/api/config/profiles'");
    expect(source).toContain("urlPath === '/api/config/use'");
    expect(source).toContain("runtimePathForWorkspace('/config/profiles')");
    expect(source).toContain("runtimePathForWorkspace('/config/use')");
    expect(source).toContain('const resolveProfileConfigPath');
    expect(source).toContain('const mirrorRuntimeConfig = async');
    expect(source).toContain('process.env.WIKI_CONFIG_PATH = fileName;');
    expect(source).toContain('fresh = await loadConfig(rootDir);');
    expect(source).toContain('Object.assign(config, fresh);');
    expect(source).not.toContain('Object.assign(config, nextConfig);');
    expect(source).toContain('restartConfigWatcher();');
  });

  it('proxies limited runtime control without touching config mirroring', async () => {
    const source = await serveSource();

    expect(source).toContain("urlPath === '/api/runtime/control'");
    expect(source).toContain("runtimePathForWorkspace('/control')");
    expect(source).toContain("req.method === 'GET' || req.method === 'POST'");
  });

  it('scopes runtime state, events and cancel proxies to the active workspace', async () => {
    const source = await serveSource();

    expect(source).toContain("runtimePathForWorkspace('/state')");
    expect(source).toContain("runtimePathForWorkspace('/events/stream')");
    expect(source).toContain("runtimePathForWorkspace('/cancel')");
    expect(source).toContain("async function proxyRuntimeEvents(req: IncomingMessage, res: ServerResponse, pathname = '/events/stream')");
  });
});
