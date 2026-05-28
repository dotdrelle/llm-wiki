import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function serveSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/commands/serve.ts'), 'utf8');
}

describe('serve graph ui', () => {
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
    expect(source).toContain('<span class="relation-arrow">↓</span>');
    expect(source).toContain('type="button">Ouvrir</button>');
    expect(source).not.toContain('Afficher les markdown');
    expect(source).not.toContain('relie a');
  });
});

describe('serve command palette', () => {
  it('locks background scroll and preserves keyboard navigation', async () => {
    const source = await serveSource();

    expect(source).toContain("document.body.style.overflow = 'hidden';");
    expect(source).toContain('document.body.style.overflow = previousOverflow;');
    expect(source).toContain('input.focus({ preventScroll: true });');
    expect(source).toContain("backdrop.addEventListener('wheel'");
    expect(source).toContain('function moveSelection(delta)');
    expect(source).toContain('function openSelected()');
  });

  it('keeps sidebar file paths available to the palette', async () => {
    const source = await serveSource();

    expect(source).toContain('data-side-path="${safePath}"');
    expect(source).toContain("document.querySelectorAll('[data-side-path]')");
  });

  it('invalidates cached markdown pages when the sidebar file list changes', async () => {
    const source = await serveSource();

    expect(source).toContain('async function navigationEtag(rootDir: string)');
    expect(source).toContain('const etag = pageEtag(fileStat2, await navigationEtag(rootDir));');
    expect(source).toContain('function requestHasEtag(req: IncomingMessage, etag: string)');
    expect(source).toContain("'Cache-Control': 'no-store, no-cache, must-revalidate'");
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
    expect(source).toContain("isCreatableCollection(node.name) && node.name !== 'deliverables'");
    expect(source).toContain('class="delete-confirm"');
    expect(source).toContain('delete-confirm-panel');
    expect(source).not.toContain("confirm('Supprimer ce fichier ?')");
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

    expect(source).toContain('Sources présentes dans raw/untracked');
  });
});

describe('serve chat proxy', () => {
  it('reports unreachable LLM upstreams as a gateway error with Docker guidance', async () => {
    const source = await serveSource();

    expect(source).toContain('function upstreamFetchFailureMessage');
    expect(source).toContain("sendJson(res, 502");
    expect(source).toContain('retryNetwork?: boolean');
    expect(source).toContain('setTimeout(resolve, 250)');
    expect(source).toContain('LLM upstream unreachable at ${target}: ${detail}');
    expect(source).toContain('retryNetwork: true');
    expect(source).toContain('use the container network hostname, not 127.0.0.1');
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
});
