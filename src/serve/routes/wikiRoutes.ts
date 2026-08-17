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
import { WIKI_CSS_VARS } from '../../chat/theme.ts';
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
    const release = status.initialized ? await history.latestRelease() : undefined;
    const commits = status.initialized
      ? await history.log({ limit: 50, since: release?.name })
      : [];
    const older = release
      ? await history.log({ limit: 50, until: release.name })
      : [];
    const olderCount = release ? await history.countLog(release.name) : 0;
    const card = (commit: { sha: string; shortSha: string; subject: string; date: string; runId?: string }) =>
      `<article class="history-card"><div class="history-summary"><code class="commit-sha">${escapeHistoryHtml(commit.shortSha)}</code><div class="history-title"><strong>${escapeHistoryHtml(commit.subject)}</strong><span>${escapeHistoryHtml(commit.date)}</span></div><code class="run-id">${escapeHistoryHtml(commit.runId ?? 'No run id')}</code><button class="restore-button" type="button" data-sha="${escapeHistoryHtml(commit.sha)}">Restore run</button></div><details class="change-details" data-sha="${escapeHistoryHtml(commit.sha)}"><summary><span>What will be undone?</span><small>Show the files and textual changes made by this action</small></summary><div class="change-content" data-change-content><p class="loading">Open to load the change details.</p></div></details></article>`;
    /*
     An empty list after a release is not an empty history.

     The page reloads right after "Release this state", and at that instant
     nothing has been committed since the tag. Saying "No workspace history
     available" over a fold that announces N older commits contradicts itself on
     the very first screen the feature shows.
    */
    const rows = commits.length
      ? commits.map(card).join('')
      : `<div class="empty-state">${release
        ? `Nothing changed since ${escapeHistoryHtml(release.name)}. Everything before it is under “Older history”.`
        : 'No workspace history available.'}</div>`;
    // The fold counts every older commit but only renders the last 50: saying
    // one number while showing another is the silent truncation this codebase
    // keeps paying for.
    const olderShown = older.length < olderCount
      ? `<p class="detail-error">Showing the ${older.length} most recent of ${olderCount}.</p>`
      : '';
    const archive = release
      ? `<details class="history-archive"><summary><span>Older history</span><small>${escapeHistoryHtml(olderCount)} commit(s) before ${escapeHistoryHtml(release.name)}</small></summary><div class="history-archive-list">${olderShown}${older.length ? older.map(card).join('') : '<p class="detail-error">No older commits.</p>'}</div></details>`
      : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace history</title><script>try{const t=localStorage.getItem('llm-wiki:theme')||localStorage.getItem('llm-wiki:graph:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.classList.add('theme-'+(t==='dark'?'dark':'light'))}catch{}</script><style>
${WIKI_CSS_VARS}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{width:min(1180px,calc(100% - 40px));margin:0 auto;padding:34px 0 60px}.page-head{margin-bottom:24px}.eyebrow{display:block;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.page h1{margin:.2rem 0 .35rem;font-size:clamp(26px,4vw,38px);line-height:1.1}.lede,#status{margin:.25rem 0;color:var(--muted)}a{color:var(--link)}.release-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:.25rem 0 .5rem}.release-badge{display:inline-flex;align-items:center;gap:10px;padding:6px 12px;border:1px solid var(--accent);border-radius:999px;color:var(--text);font-size:12px}.release-badge code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;color:var(--accent)}.release-badge span{color:var(--muted)}.release-none{color:var(--muted);font-size:12px}#release-button{border:1px solid var(--accent);border-radius:7px;padding:7px 13px;background:var(--accent);color:#fff;font:inherit;font-weight:800;cursor:pointer}#release-button:hover{filter:brightness(1.08)}#release-button:disabled{opacity:.55;cursor:wait}.history-archive{margin-top:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden}.history-archive>summary{display:flex;align-items:center;gap:12px;padding:13px 16px;color:var(--text);cursor:pointer;font-weight:750;list-style-position:inside}.history-archive>summary small{color:var(--muted);font-weight:500}.history-archive-list{display:grid;gap:12px;padding:0 16px 16px}.history-list{display:grid;gap:12px}.history-card{overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}.history-summary{display:grid;grid-template-columns:82px minmax(240px,1fr) minmax(120px,240px) auto;align-items:center;gap:16px;padding:15px 16px}.commit-sha,.run-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.commit-sha{color:var(--accent);font-weight:800}.run-id{overflow:hidden;color:var(--muted);text-overflow:ellipsis;white-space:nowrap}.history-title{min-width:0}.history-title strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-title span{display:block;margin-top:3px;color:var(--muted);font-size:12px}.restore-button{border:1px solid var(--border);border-radius:7px;padding:7px 11px;background:var(--panel-soft);color:var(--text);font:inherit;font-weight:700;cursor:pointer}.restore-button:hover{border-color:var(--accent);color:var(--accent)}.restore-button:disabled{opacity:.55;cursor:wait}.change-details{border-top:1px solid var(--border);background:var(--panel-soft)}.change-details summary{display:flex;align-items:center;gap:12px;padding:11px 16px;color:var(--text);cursor:pointer;font-weight:750;list-style-position:inside}.change-details summary small{color:var(--muted);font-weight:500}.change-content{padding:0 16px 16px}.undo-explanation{margin:2px 0 12px;padding:11px 13px;border-left:3px solid var(--... (line truncated to 2000 chars)
@media(max-width:760px){.page{width:min(100% - 24px,1180px);padding-top:22px}.history-summary{grid-template-columns:70px 1fr}.run-id{grid-column:1/3}.restore-button{grid-column:1/3;justify-self:start}.change-details summary{align-items:flex-start;flex-direction:column;gap:2px}}
</style></head><body><main class="page"><header class="page-head"><span class="eyebrow">Versioned workspace</span><h1>Workspace history</h1><p class="lede"><a href="/">Back to wiki</a> · Review an action before restoring it.</p><div class="release-bar">${release ? `<span class="release-badge">Latest release: <code>${escapeHistoryHtml(release.name)}</code><span>${escapeHistoryHtml(release.date)}</span></span>` : '<span class="release-none">No release yet</span>'}<button id="release-button" type="button">Release this state</button></div><p id="status">${escapeHistoryHtml(status.reason
      ? `History: ${status.reason}`
      // `commits` only counts what followed the release; announcing it bare
      // read as "0 commit(s)" over a workspace with a full history.
      : release
        ? `${commits.length} commit(s) since ${release.name} · ${olderCount} before it`
        : `${commits.length} commit(s)`)}</p></header><section class="history-list">${rows}</section>${archive}</main><script>
const THEME_KEY='llm-wiki:theme';
function applyTheme(theme){const selected=theme==='dark'?'dark':'light';document.documentElement.classList.toggle('theme-dark',selected==='dark');document.documentElement.classList.toggle('theme-light',selected==='light')}
applyTheme(localStorage.getItem(THEME_KEY)||localStorage.getItem('llm-wiki:graph:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));window.addEventListener('storage',event=>{if(event.key===THEME_KEY&&event.newValue)applyTheme(event.newValue)});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function parsePatch(content){const files=[];let current=null;for(const line of String(content||'').split('\\n')){if(line.startsWith('diff --git ')){if(current)files.push(current);const match=/^diff --git a\\/(.+) b\\/(.+)$/.exec(line);current={path:match?match[2]:'Changed file',kind:'modified',lines:[],additions:0,deletions:0};continue}if(!current)continue;if(line.startsWith('new file mode'))current.kind='added';else if(line.startsWith('deleted file mode'))current.kind='deleted';else if(line.startsWith('rename to ')){current.kind='renamed';current.path=line.slice(10)}if(line.startsWith('+')&&!line.startsWith('+++'))current.additions++;if(line.startsWith('-')&&!line.startsWith('---'))current.deletions++;current.lines.push(line)}if(current)files.push(current);return files}
function lineClass(line){if(line.startsWith('+')&&!line.startsWith('+++'))return'diff-add';if(line.startsWith('-')&&!line.startsWith('---'))return'diff-del';if(line.startsWith('@@'))return'diff-hunk';if(/^(index |--- |\\+\\+\\+ |new file|deleted file|similarity|rename )/.test(line))return'diff-meta';return''}
function renderChanges(content){const files=parsePatch(content);const additions=files.reduce((n,file)=>n+file.additions,0);const deletions=files.reduce((n,file)=>n+file.deletions,0);const cards=files.map(file=>'<section class="file-change"><h3><span class="change-kind">'+esc(file.kind)+'</span>'+esc(file.path)+'</h3><pre class="diff">'+file.lines.map(line=>'<span class="diff-line '+lineClass(line)+'">'+esc(line||' ')+'</span>').join('')+'</pre></section>').join('');return '<p class="undo-explanation"><strong>What restore will do:</strong> reverse only the changes recorded by this action and create a new history commit. Existing history is preserved.</p><div class="change-stats"><span class="stat">'+files.length+' file(s)</span><span class="stat">+'+additions+' line(s)</span><span class="stat">−'+deletions+' line(s)</span></div>'+(cards||'<p class="detail-error">No textual file change is recorded for this commit.</p>')}
document.querySelectorAll('details[data-sha]').forEach(details=>details.addEventListener('toggle',async()=>{if(!details.open||details.dataset.loaded==='1')return;details.dataset.loaded='1';const target=details.querySelector('[data-change-content]');target.innerHTML='<p class="loading">Loading the changes…</p>';try{const response=await fetch('/api/history/show?sha='+encodeURIComponent(details.dataset.sha),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load changes.');target.innerHTML=renderChanges(data.content)}catch(error){details.dataset.loaded='0';target.innerHTML='<p class="detail-error">'+esc(error.message||error)+'</p>'}}));
const post=(body)=>fetch('/api/history/restore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const say=(t)=>{document.querySelector('#status').textContent=t;};
const releaseButton=document.querySelector('#release-button');
if(releaseButton)releaseButton.addEventListener('click',async()=>{
  const label=prompt('Name this release (optional — leave empty to auto-number):');
  if(label===null)return;
  releaseButton.disabled=true;
  try{
    const r=await fetch('/api/history/release',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(label?{label}:{})});
    const data=await r.json();
    if(!r.ok){say(data.error||'Release failed.');return;}
    say('Released as '+data.release.name+'. Reloading…');
    location.reload();
  }finally{releaseButton.disabled=false;}
});
document.querySelectorAll('button[data-sha]').forEach(b=>b.addEventListener('click',async()=>{
  const run=b.dataset.sha;
  if(!confirm('Reverse the changes made by this action? A new commit will be created and existing history will be preserved.'))return;
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
</script></body></html>`;
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

  if (urlPath === '/api/history/release' && req.method === 'POST') {
    try {
      const payload = JSON.parse(await deps.readRequestBody(req)) as { label?: string };
      const release = await new HistoryService(rootDir, deps.historyConfig).createRelease(payload.label);
      deps.sendJson(res, 200, { ok: true, release });
    } catch (error) {
      deps.sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
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
