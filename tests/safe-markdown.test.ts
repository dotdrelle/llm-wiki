import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Marked } from 'marked';
import { afterEach, describe, expect, it } from 'vitest';

import { serveMd } from '../src/serve/html/wikiHtml.ts';
import { rawHtmlAsText, SAFE_MARKDOWN_SCRIPT, safeHref, safeImageSrc } from '../src/utils/safeMarkdown.ts';

// One payload per way a rendered page used to run a script or leave the origin.
const HOSTILE = [
  'Hello <img src=x onerror=alert(1)> there',
  '<script>alert(2)</script>',
  '[click](javascript:alert(3))',
  '[click](JAVASCRIPT:alert(4))',
  '[<img src=x onerror=alert(5)>](/wiki/a.md)',
  '[away](//evil.example/x)',
  '![pixel](https://tracker.example/p.gif)',
].join('\n\n');

function assertInert(html: string) {
  expect(html).not.toMatch(/<img[^>]*onerror/i);
  expect(html).not.toMatch(/<script>alert/i);
  expect(html).not.toMatch(/href="javascript:/i);
  expect(html).not.toMatch(/href="\/\/evil/i);
  expect(html).not.toMatch(/src="https:\/\/tracker/i);
}

const REFUSED = ['//evil.example', '\\\\evil.example', '/\\evil.example', 'java\tscript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x', ''];
const ACCEPTED = ['wiki/a.md', '../b.md', '/wiki/c.md', '#anchor', 'https://example.org/x', 'http://example.org', 'mailto:a@example.org'];

// The browser copy, evaluated against its own `marked` instance.
function browserCopy() {
  const marked = new Marked();
  const api = new Function('marked', `${SAFE_MARKDOWN_SCRIPT}; return { safeHref, safeImageSrc, rawHtmlAsText };`)(marked);
  return { marked, ...api } as {
    marked: Marked;
    safeHref: (value: string, options?: { allowExternal?: boolean }) => string | null;
    safeImageSrc: (value: string) => string | null;
    rawHtmlAsText: (value: string) => string;
  };
}

describe('safeHref', () => {
  it('refuses scheme-less off-origin and script URLs', () => {
    for (const value of REFUSED) expect(safeHref(value), JSON.stringify(value)).toBeNull();
  });

  it('keeps relative links and explicit http/https/mailto', () => {
    for (const value of ACCEPTED) expect(safeHref(value), value).toBe(value);
  });

  it('keeps images on the page origin only', () => {
    expect(safeImageSrc('img/a.png')).toBe('img/a.png');
    expect(safeImageSrc('https://tracker.example/p.gif')).toBeNull();
  });

  it('agrees with the browser copy on every case', () => {
    const browser = browserCopy();
    for (const value of [...REFUSED, ...ACCEPTED]) {
      expect(browser.safeHref(value), JSON.stringify(value)).toBe(safeHref(value));
      expect(browser.safeImageSrc(value), JSON.stringify(value)).toBe(safeImageSrc(value));
    }
    for (const html of ['<b>x</b><br/>y<!-- c -->', '<img src=x onerror=alert(1)>']) {
      expect(browser.rawHtmlAsText(html)).toBe(rawHtmlAsText(html));
    }
  });
});

describe('rawHtmlAsText', () => {
  it('shows HTML as text, keeps <br>, drops comments', () => {
    expect(rawHtmlAsText('<b>x</b><br/>y<!-- wiki-index-overview:start -->')).toBe('&lt;b&gt;x&lt;/b&gt;<br>y');
  });
});

describe('chat Markdown (browser marked)', () => {
  it('renders hostile Markdown inert', () => {
    const { marked } = browserCopy();
    const html = String(marked.parse(HOSTILE));
    assertInert(html);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('still renders ordinary links', () => {
    const { marked } = browserCopy();
    expect(String(marked.parse('[ok](https://example.org) [page](wiki/a.md)'))).toContain('href="https://example.org"');
  });
});

describe('wiki page rendering', () => {
  let root = '';
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  async function render(relative: string, content: string) {
    root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-safe-md-'));
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    return serveMd(root, file, `/${relative}`, { documentOnly: true });
  }

  it('renders a hostile pending document inert', async () => {
    // raw/untracked is where collected e-mails and exports land, unreviewed.
    const html = await render('raw/untracked/mail.md', `# Mail\n\n${HOSTILE}\n`);
    assertInert(html);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('keeps the engine citation chips while escaping page HTML', async () => {
    const html = await render(
      'wiki/concepts/a.md',
      '# A\n\nA fact [src: raw/ingested/doc.md#Intro] and <b>raw</b>.\n\n<!-- wiki-index-overview:start -->\n',
    );
    expect(html).toMatch(/<a class="source-citation" href="\/raw\/ingested\/doc\.md#Intro"/);
    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(html).not.toContain('wiki-index-overview');
  });
});

describe('serve security headers', () => {
  it('sets a CSP without script-src (inline handlers still in use) and anti-framing headers', async () => {
    const { applySecurityHeaders } = await import('../src/serve/http/securityHeaders.ts');
    const headers: Record<string, string> = {};
    applySecurityHeaders({ setHeader: (name: string, value: string) => { headers[name] = value; } } as never);
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'self'");
    expect(headers['Content-Security-Policy']).not.toContain('script-src');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
});
