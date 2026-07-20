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
  generateSkillsPage,
  isRawDownloadRequestPath,
  isRawUntrackedReference,
  isServedRelativePath,
  renameTemplateDocument,
  resolveEditableMarkdown,
  serveMd,
} from '../html/wikiHtml.ts';
import { listHelpChapters, readHelpChapter } from '../../utils/helpDoc.ts';

export type WikiRoutesDeps = {
  rootDir: string;
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
