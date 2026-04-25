import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { marked } from 'marked';
import type { AppConfig } from '../types.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { pathExists } from '../utils/fs.ts';
import { toPosix } from '../utils/path.ts';

const SERVED_DIRS = ['wiki', 'deliverables', 'templates'];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.7; }
    nav { margin-bottom: 1.5rem; font-size: 0.9rem; color: #666; }
    nav a { color: inherit; }
    nav a + a::before { content: " / "; }
    h1, h2, h3 { line-height: 1.2; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    @media (prefers-color-scheme: dark) { pre { background: #1e1e1e; } body { color: #e0e0e0; background: #121212; } }
    code { font-size: 0.88em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.8rem; text-align: left; }
    blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 1rem; color: #555; }
    .file-list { list-style: none; padding: 0; }
    .file-list li { padding: 0.15rem 0; }
    .dir-label { font-weight: bold; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin: 1.5rem 0 0.4rem; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function breadcrumb(urlPath: string): string {
  const parts = urlPath.split('/').filter(Boolean);
  let href = '';
  const links = ['<a href="/">index</a>'];
  for (const part of parts) {
    href += `/${part}`;
    links.push(`<a href="${escapeHtml(href)}">${escapeHtml(part)}</a>`);
  }
  return `<nav>${links.join('')}</nav>`;
}

async function generateIndex(rootDir: string): Promise<string> {
  const sections: string[] = [];
  for (const dir of SERVED_DIRS) {
    const files = await fg(`${dir}/**/*.md`, { cwd: rootDir, dot: false });
    files.sort();
    if (files.length === 0) continue;
    const items = files
      .map((f) => `<li><a href="/${toPosix(f)}">${toPosix(f)}</a></li>`)
      .join('\n');
    sections.push(`<p class="dir-label">${dir}</p><ul class="file-list">${items}</ul>`);
  }
  return layout('wiki', `<h1>wiki</h1>${sections.join('')}`);
}

async function serveMd(filePath: string, urlPath: string): Promise<string> {
  const raw = await readFile(filePath, 'utf8');
  const html = await marked(raw, { gfm: true });
  const title = path.basename(filePath, '.md');
  return layout(title, `${breadcrumb(urlPath)}<article>${html}</article>`);
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

      if (urlPath === '/') {
        const html = await generateIndex(rootDir);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const relative = urlPath.replace(/^\//, '');
      const topDir = relative.split('/')[0];
      if (!SERVED_DIRS.includes(topDir ?? '')) {
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

      if (!absolute.endsWith('.md')) {
        res.writeHead(415, { 'Content-Type': 'text/plain' });
        res.end('Only .md files are served');
        return;
      }

      const html = await serveMd(absolute, urlPath);
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
