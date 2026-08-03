import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, writeIfChanged } from '../../utils/fs.ts';
import { normalizeSafeRelativePath, resolveInside, toPosix } from '../../utils/path.ts';
import {
  createMarkdownDocument,
  deleteMarkdownDocument,
  escapeHref,
  generateDirectoryPage,
  generateEditPage,
  generateIndex,
  generateNewMarkdownPage,
  buildPagesIndex,
  generateHelpChapter,
  generateHelpIndex,
  generateNotFoundPage,
  generateSidebarPanelPage,
  isRawDownloadRequestPath,
  isRawUntrackedReference,
  isServedRelativePath,
  renameTemplateDocument,
  resolveEditableMarkdown,
  serveMd,
} from '../html/wikiHtml.ts';
import { generateSkillsPage } from '../html/wikiSkillsPage.ts';
import { listHelpChapters, readHelpChapter } from '../../utils/helpDoc.ts';
import { HistoryService } from '../../services/historyService.ts';
import type { HistoryConfig } from '../../types.ts';

function escapeHistoryHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type WikiRoutesDeps = {
  rootDir: string;
  historyConfig?: HistoryConfig;
  submitHistoryRestore?: (res: ServerResponse, payload: { file?: string; run?: string; to?: string; dryRun?: boolean; intent?: string }) => Promise<void>;
  readRequestBody: (req: IncomingMessage) => Promise<string>;
  sendGzippedHtml: (
    req: IncomingMessage,
    res: ServerResponse,
    html: string,
    extraHeaders?: Record<string, string>,
    status?: number,
  ) => Promise<void>;
  sendJson: (
    res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void },
    status: number,
    data: unknown,
  ) => void;
};

export async function handleWikiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: WikiRoutesDeps,
): Promise<boolean> {
  const { rootDir } = deps;

  if (urlPath === '/history' && req.method === 'GET') {
    const history = new HistoryService(rootDir, deps.historyConfig);
    const status = await history.status();
    const commits = status.initialized ? await history.log({ limit: 50 }) : [];
    const rows = commits.length
      ? commits.map((commit) => `<tr><td><code>${escapeHistoryHtml(commit.shortSha)}</code></td><td>${escapeHistoryHtml(commit.date)}</td><td>${escapeHistoryHtml(commit.subject)}</td><td>${escapeHistoryHtml(commit.runId ?? '')}</td><td><button type="button" data-sha="${escapeHistoryHtml(commit.sha)}">Restore run</button></td></tr>`).join('')
      : '<tr><td colspan="5">No workspace history available.</td></tr>';
    const html = `<!doctype html><meta charset="utf-8"><title>Workspace history</title><style>body{font:14px system-ui;margin:2rem;color:#222}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.6rem;text-align:left}button{cursor:pointer}#status{margin:.8rem 0;color:#555}</style><h1>Workspace history</h1><p><a href="/">Back to wiki</a></p><p id="status">${escapeHistoryHtml(status.reason ? `History: ${status.reason}` : `${commits.length} commit(s)`)}</p><table><thead><tr><th>Commit</th><th>Date</th><th>Subject</th><th>Run</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table><script>
const post=(body)=>fetch('/api/history/restore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const say=(t)=>{document.querySelector('#status').textContent=t;};
document.querySelectorAll('button[data-sha]').forEach(b=>b.addEventListener('click',async()=>{
  const run=b.dataset.sha;
  if(!confirm('Restore this run? A new commit will be created.'))return;
  b.disabled=true;
  try{
    let r=await post({run});
    // A run is already active: the restore cannot start now, but it can be
    // queued as a future run with its capability plan carried through.
    if(r.status===409){
      if(!confirm('A run is currently active. Queue this restore to start when it finishes?')){say('Restore cancelled.');return;}
      r=await post({run,intent:'enqueue'});
      say(r.ok?'Restore queued — it will start after the current run.':((await r.json()).error||'Could not queue the restore.'));
      return;
    }
    say(r.ok?'Restore submitted for approval':((await r.json()).error||'Restore submission failed'));
  }finally{b.disabled=false;}
}));
</script>`;
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  if (urlPath === '/api/history' && req.method === 'GET') {
    const requestUrl = new URL(req.url ?? '/api/history', 'http://localhost');
    const file = requestUrl.searchParams.get('file') ?? undefined;
    const rawLimit = Number.parseInt(requestUrl.searchParams.get('limit') ?? '20', 10);
    const history = new HistoryService(rootDir, deps.historyConfig);
    const status = await history.status();
    deps.sendJson(res, 200, {
      status,
      commits: status.initialized ? await history.log({ file, limit: rawLimit }) : [],
    });
    return true;
  }

  if (urlPath === '/api/history/show' && req.method === 'GET') {
    const requestUrl = new URL(req.url ?? '/api/history/show', 'http://localhost');
    const sha = requestUrl.searchParams.get('sha');
    const file = requestUrl.searchParams.get('file') ?? undefined;
    if (!sha) {
      deps.sendJson(res, 400, { error: 'Missing sha' });
      return true;
    }
    try {
      const content = await new HistoryService(rootDir, deps.historyConfig).show(sha, file);
      deps.sendJson(res, 200, { sha, file: file ?? null, content });
    } catch (error) {
      deps.sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (urlPath === '/api/history/restore' && req.method === 'POST') {
    try {
      const payload = JSON.parse(await deps.readRequestBody(req)) as { file?: string; run?: string; to?: string; dryRun?: boolean; intent?: string };
      if ((!payload.run && !(payload.file && payload.to)) || (payload.run && payload.file)) {
        deps.sendJson(res, 400, { error: 'Provide run, or file and to.' });
        return true;
      }
      if (!deps.submitHistoryRestore) {
        deps.sendJson(res, 503, { ok: false, error: 'History restore requires the runtime approval service.' });
        return true;
      }
      await deps.submitHistoryRestore(res, payload);
    } catch (error) {
      deps.sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  // Product help API (JSON) for the in-app help panel.
  if (urlPath === '/api/help' && req.method === 'GET') {
    const chapters = await listHelpChapters();
    deps.sendJson(res, 200, { chapters });
    return true;
  }

  // Served-documents index (JSON) for the chat shell's command palette.
  if (urlPath === '/api/pages' && req.method === 'GET') {
    deps.sendJson(res, 200, { pages: await buildPagesIndex(rootDir) });
    return true;
  }
  if (urlPath.startsWith('/api/help/') && req.method === 'GET') {
    const id = decodeURIComponent(urlPath.slice('/api/help/'.length).replace(/\/+$/, ''));
    const chapter = await readHelpChapter(id);
    if (!chapter.found) {
      deps.sendJson(res, 404, { error: chapter.error ?? 'Not found' });
      return true;
    }
    deps.sendJson(res, 200, { id: chapter.id, title: chapter.title, markdown: chapter.content });
    return true;
  }

  if (urlPath.startsWith('/new/')) {
    const collection = urlPath.replace(/^\/new\//, '').replace(/\/+$/, '');
    if (req.method === 'GET') {
      try {
        const html = await generateNewMarkdownPage(rootDir, collection);
        await deps.sendGzippedHtml(req, res, html);
      } catch {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
      }
      return true;
    }
    if (req.method === 'POST') {
      try {
        const relativePath = await createMarkdownDocument(
          rootDir,
          collection,
          await deps.readRequestBody(req),
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
      return true;
    }
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return true;
  }

  if (urlPath.startsWith('/delete/')) {
    const relative = urlPath.replace(/^\/delete\//, '').replace(/\/+$/, '');
    if (req.method === 'POST') {
      try {
        const collection = await deleteMarkdownDocument(rootDir, relative);
        res.writeHead(303, {
          Location: escapeHref(`/${collection}`),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end();
      } catch {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
      }
      return true;
    }
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return true;
  }

  if (urlPath.startsWith('/rename/')) {
    const relative = urlPath.replace(/^\/rename\//, '').replace(/\/+$/, '');
    if (req.method === 'PATCH') {
      try {
        const renamedPath = await renameTemplateDocument(
          rootDir,
          relative,
          await deps.readRequestBody(req),
        );
        deps.sendJson(res, 200, { ok: true, path: renamedPath });
      } catch (err) {
        deps.sendJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }
    deps.sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  if (urlPath.startsWith('/edit/')) {
    const relative = urlPath.replace(/^\/edit\//, '').replace(/\/+$/, '');
    if (req.method === 'GET') {
      try {
        const html = await generateEditPage(rootDir, relative);
        await deps.sendGzippedHtml(req, res, html);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith('FORBIDDEN_EDIT_PATH') ? 403 : 404;
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(status === 403 ? 'Forbidden' : 'Not found');
      }
      return true;
    }

    if (req.method === 'POST') {
      try {
        const absolute = resolveEditableMarkdown(rootDir, relative);
        const body = await deps.readRequestBody(req);
        const params = new URLSearchParams(body);
        const content = params.get('content');
        if (content === null) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing content field');
          return true;
        }
        // Manual edits must round-trip exactly; generated Markdown is normalized elsewhere.
        await writeIfChanged(absolute, content);
        const savedRelative = toPosix(relative);
        const redirectAfterSave = isRawUntrackedReference(savedRelative)
          ? escapeHref(`/edit/${savedRelative}`)
          : escapeHref(`/${savedRelative}`);
        res.writeHead(303, { Location: redirectAfterSave });
        res.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith('FORBIDDEN_EDIT_PATH') ? 403 : 404;
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(status === 403 ? 'Forbidden' : 'Not found');
      }
      return true;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return true;
  }

  if (req.method === 'GET' && isRawDownloadRequestPath(urlPath)) {
    const rawRelative = toPosix(urlPath.replace(/^\/raw\//, '').replace(/\/+$/, ''));
    if (rawRelative.endsWith('.md') && isServedRelativePath(rawRelative)) {
      const normalizedRawRelative = normalizeSafeRelativePath(rawRelative);
      if (normalizedRawRelative === null) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return true;
      }
      const absolute = resolveInside(rootDir, normalizedRawRelative);
      if (await pathExists(absolute)) {
        const content = await readFile(absolute, 'utf8');
        const filename = path.basename(normalizedRawRelative);
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        });
        res.end(content);
        return true;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }

  if (urlPath === '/') {
    const html = await generateIndex(rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  if (urlPath === '/skills') {
    const html = await generateSkillsPage(rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  // Sidebar-only page used by the app shell (/chat) as its left "Wiki" tab.
  if (urlPath === '/embed/sidebar' && req.method === 'GET') {
    const html = await generateSidebarPanelPage(rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  if (urlPath === '/help' || urlPath === '/help/') {
    const html = await generateHelpIndex(rootDir);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  if (urlPath.startsWith('/help/')) {
    const id = decodeURIComponent(urlPath.slice('/help/'.length).replace(/\/+$/, ''));
    const html = await generateHelpChapter(rootDir, id);
    if (html === null) {
      const notFound = await generateNotFoundPage(rootDir, urlPath);
      await deps.sendGzippedHtml(req, res, notFound, {}, 404);
      return true;
    }
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  const relative = toPosix(urlPath.replace(/^\//, '').replace(/\/+$/, ''));
  const normalizedRelative = normalizeSafeRelativePath(relative);
  if (normalizedRelative === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return true;
  }
  if (!isServedRelativePath(normalizedRelative)) {
    const html = await generateNotFoundPage(rootDir, urlPath);
    await deps.sendGzippedHtml(req, res, html, {}, 404);
    return true;
  }

  const absolute = resolveInside(rootDir, normalizedRelative);

  if (!(await pathExists(absolute))) {
    const html = await generateNotFoundPage(rootDir, urlPath);
    await deps.sendGzippedHtml(req, res, html, {}, 404);
    return true;
  }

  const absoluteStats = await stat(absolute);
  if (absoluteStats.isDirectory()) {
    const html =
      relative === 'wiki'
        ? await generateIndex(rootDir)
        : await generateDirectoryPage(rootDir, normalizedRelative);
    await deps.sendGzippedHtml(req, res, html);
    return true;
  }

  if (!absolute.endsWith('.md')) {
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    res.end('Only .md files are served');
    return true;
  }

  const html = await serveMd(rootDir, absolute, urlPath);
  await deps.sendGzippedHtml(req, res, html);
  return true;
}
