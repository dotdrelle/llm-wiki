// App shell: wiki and chat coexist in one page, no top bar.
// - Left column: tabs [Wiki][Chat] switch ONLY the left panel content.
//   The Wiki tab hosts the existing wiki sidebar page (/embed/sidebar) in its
//   own iframe: full CSS/JS isolation, links retargeted to the central
//   "wiki-frame" via <base target>.
// - Central zone: follows clicks, not tabs. A wiki navigation shows the wiki
//   page (unchanged behavior); opening a conversation shows the chat.
// - Right rail: Activity / Help / theme, always available.
// Also owns the center view switching (chat / connectors / execution / wiki),
// moved here from chatHtml.ts.
export const WIKI_PANEL_SCRIPT = `
// ── Shell state ─────────────────────────────────────────────────────────────
const SHELL_LEFT_KEY = 'llm-wiki:shell:leftTab';
const SHELL_CENTER_KEY = 'llm-wiki:shell:center';
const SHELL_WIKI_PATH_KEY = 'llm-wiki:shell:wikiPath';
const SHELL_SPLIT_KEY = 'llm-wiki:shell:split';
const SHELL_SPLIT_W_KEY = 'llm-wiki:shell:splitW';

function shellStore(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch {}
  return null;
}

function sanitizeWikiPath(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

function wikiHashPath() {
  const match = location.hash.match(/^#wiki=(.+)$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function currentWikiPath() {
  return sanitizeWikiPath(wikiHashPath()) || sanitizeWikiPath(shellStore(SHELL_WIKI_PATH_KEY)) || '/';
}

function decodeWikiPath(value) {
  let decoded=String(value||'');
  try { decoded=decodeURIComponent(decoded); } catch {}
  return decoded.replace(/\\\\/g,'/');
}

// References only: Donna receives at most five paths and chooses which
// generic wiki read tool to call. Contents are never read or injected here.
const PAGE_CONTEXT_LIMIT=5;
let pageContexts=[];
function validPageContext(path) {
  const value=decodeWikiPath(path).replace(/^\\//,'');
  if(value.includes('..')||!value.endsWith('.md')) return null;
  return value.startsWith('wiki/')||value.startsWith('raw/untracked/')?value:null;
}
function pageContextFileName(path) {
  const decoded=decodeWikiPath(path);
  return decoded.split('/').filter(Boolean).pop()||decoded;
}
function openWikiPageForChat() { return validPageContext(currentWikiPath()); }
function addPageContext(path) {
  const value=validPageContext(path);
  if(!value) return;
  pageContexts=[...pageContexts.filter(item=>item!==value),value].slice(-PAGE_CONTEXT_LIMIT);
  refreshPageContextChip();
}
function removePageContext(path) {
  pageContexts=pageContexts.filter(item=>item!==path);
  refreshPageContextChip();
}
function activePageContexts() { return agentMode?[]:pageContexts.slice(0,PAGE_CONTEXT_LIMIT); }
function refreshPageContextChip() {
  const host=$('page-context-chips');
  if(!host) return;
  const paths=activePageContexts();
  host.hidden=!paths.length;
  host.innerHTML=paths.map(path=>{const fileName=pageContextFileName(path);return \`<span class="page-context-chip" title="\${esc(path)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="page-context-label">\${esc(fileName)}</span><button class="page-context-clear" type="button" title="Remove this document from the context" aria-label="Remove \${esc(fileName)} from the context" onclick="removePageContext(\${esc(JSON.stringify(path))})">&times;</button></span>\`;}).join('');
}
// Deliberate opt-in only: navigating never adds a chip. The user adds a page
// from the "+ Context" button in the wiki page's own action bar (see
// wikiHtml/wikiLayoutScript), which posts llmwiki:addContext to this shell.

function alignWikiRail() {
  const frame = document.getElementById('wiki-frame');
  const rail = document.getElementById('right-rail');
  if (!frame || !rail) return;
  let top = 64;
  try {
    const article = frame.contentWindow?.document.querySelector('.article');
    if (article) top = Math.max(10, article.getBoundingClientRect().top - 15);
  } catch {}
  rail.style.setProperty('--wiki-rail-top', top + 'px');
}

// ── Left panel tabs (do NOT touch the central zone) ─────────────────────────
function setLeftTab(tab) {
  const wiki = tab === 'wiki';
  document.body.classList.toggle('left-wiki', wiki);
  document.getElementById('shell-tab-wiki')?.classList.toggle('active', wiki);
  document.getElementById('shell-tab-chat')?.classList.toggle('active', !wiki);
  shellStore(SHELL_LEFT_KEY, wiki ? 'wiki' : 'chat');
  if (wiki) {
    const sideFrame = document.getElementById('wiki-side-frame');
    if (sideFrame && !sideFrame.getAttribute('src')) {
      sideFrame.addEventListener('load', () => {
        sideFrame.contentWindow?.postMessage(
          { type: 'llmwiki:active', path: currentWikiPath() }, location.origin);
      });
      sideFrame.setAttribute('src', '/embed/sidebar');
    }
  }
}

// ── Split view: wiki page and chat side by side ─────────────────────────────
// Pure layout modifier over the existing center switching: body.split-wiki
// only takes effect while center-wiki is active (see the CSS grid rules).
// Below 900px the media query ignores it and the full-page wiki view wins.
function splitWikiEnabled() { return shellStore(SHELL_SPLIT_KEY) === '1'; }
function applySplitWiki() {
  const on = splitWikiEnabled();
  document.body.classList.toggle('split-wiki', on);
  document.getElementById('split-toggle')?.classList.toggle('active', on);
}
function toggleSplitWiki() {
  shellStore(SHELL_SPLIT_KEY, splitWikiEnabled() ? '0' : '1');
  applySplitWiki();
  // Turning split on while the chat fills the center: bring the last wiki
  // page alongside so the toggle has a visible effect immediately.
  if (splitWikiEnabled() && !document.body.classList.contains('center-wiki')) {
    const last = sanitizeWikiPath(shellStore(SHELL_WIKI_PATH_KEY));
    if (last && last !== '/') setCenterWiki(last);
  }
}
function initWikiSplitResizer() {
  const handle = document.getElementById('wiki-split-resizer');
  const main = document.getElementById('main');
  if (!handle || !main) return;
  const setW = (px, persist) => {
    const clamped = Math.max(280, Math.min(px, Math.max(330, main.clientWidth - 380)));
    main.style.setProperty('--split-wiki-w', clamped + 'px');
    if (persist) shellStore(SHELL_SPLIT_W_KEY, String(Math.round(clamped)));
  };
  const saved = Number(shellStore(SHELL_SPLIT_W_KEY));
  if (Number.isFinite(saved) && saved > 0) setW(saved);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
    // Iframes swallow pointer events mid-drag; disable them until release.
    document.body.classList.add('iframe-drag');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    handle.setPointerCapture?.(e.pointerId);
    const origin = main.getBoundingClientRect().left;
    const move = (ev) => setW(ev.clientX - origin, true);
    const up = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('iframe-drag');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
setTimeout(() => { applySplitWiki(); initWikiSplitResizer(); }, 0);

// ── Command palette (Ctrl/Cmd+K) ────────────────────────────────────────────
// Shell-level palette over pages (via /api/pages), conversations and actions.
// Embedded wiki iframes forward their Ctrl+K here (llmwiki:palette) so one
// palette serves the whole app.
let cmdkPages = [];
let cmdkItems = [];
let cmdkSel = 0;
let cmdkFetchedAt = 0;
function cmdkNorm(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
}
function cmdkOpen() {
  const backdrop = document.getElementById('cmdk-backdrop');
  const input = document.getElementById('cmdk-input');
  if (!backdrop || !input) return;
  backdrop.hidden = false;
  input.value = '';
  cmdkSel = 0;
  cmdkRefreshPages();
  cmdkRender('');
  requestAnimationFrame(() => input.focus());
}
function cmdkClose() {
  const backdrop = document.getElementById('cmdk-backdrop');
  if (backdrop) backdrop.hidden = true;
}
function cmdkToggle() {
  const backdrop = document.getElementById('cmdk-backdrop');
  if (!backdrop) return;
  if (backdrop.hidden) cmdkOpen(); else cmdkClose();
}
function cmdkRefreshPages() {
  const now = Date.now();
  if (now - cmdkFetchedAt < 15000) return;
  cmdkFetchedAt = now;
  fetch('/api/pages').then((r) => r.json()).then((data) => {
    cmdkPages = Array.isArray(data?.pages) ? data.pages : [];
    const input = document.getElementById('cmdk-input');
    const backdrop = document.getElementById('cmdk-backdrop');
    if (backdrop && !backdrop.hidden) cmdkRender(input ? input.value : '');
  }).catch(() => {});
}
function cmdkActions() {
  return [
    { type: 'action', title: 'New conversation', sub: 'Chat', run: () => newConversation() },
    { type: 'action', title: 'Toggle split document + chat', sub: 'Layout', run: () => toggleSplitWiki() },
    { type: 'action', title: 'Toggle agent mode', sub: 'Chat', run: () => toggleAgentMode() },
    { type: 'action', title: 'Connectors', sub: 'View', run: () => showConnectorsView() },
    { type: 'action', title: 'Execution', sub: 'View', run: () => showExecutionView() },
    { type: 'action', title: 'Help & documentation', sub: 'View', run: () => toggleHelpPanel() },
    { type: 'action', title: 'Switch theme', sub: 'View', run: () => toggleTheme() },
  ];
}
function cmdkCollect(query) {
  const nq = cmdkNorm(query).trim();
  const match = (text) => !nq || cmdkNorm(text).includes(nq);
  const pages = cmdkPages
    .filter((p) => match(p.path + ' ' + p.title))
    .slice(0, nq ? 9 : 5)
    .map((p) => ({ type: 'page', title: p.title || p.path, sub: p.path, tag: p.kind || 'page', path: p.path }));
  const summaries = typeof historySummaries !== 'undefined' && Array.isArray(historySummaries) ? historySummaries : [];
  const convs = summaries
    .filter((c) => match(c.title || ''))
    .slice(0, nq ? 5 : 3)
    .map((c) => ({ type: 'conv', title: c.title || 'New conversation', sub: 'Conversation', tag: 'chat', id: c.id }));
  const actions = cmdkActions().filter((a) => match(a.title));
  return [...pages, ...convs, ...(nq ? actions.slice(0, 5) : actions.slice(0, 4))];
}
function cmdkRender(query) {
  const host = document.getElementById('cmdk-results');
  if (!host) return;
  cmdkItems = cmdkCollect(query);
  if (cmdkSel >= cmdkItems.length) cmdkSel = 0;
  if (!cmdkItems.length) { host.innerHTML = '<div class="cmdk-empty">No results</div>'; return; }
  host.innerHTML = cmdkItems.map((item, i) => (
    '<button class="cmdk-item' + (i === cmdkSel ? ' is-sel' : '') + '" data-ci="' + i + '" type="button">'
    + '<div class="cmdk-item-body"><div class="cmdk-item-title">' + esc(item.title) + '</div>'
    + (item.sub ? '<div class="cmdk-item-sub">' + esc(item.sub) + '</div>' : '')
    + '</div><span class="cmdk-tag">' + esc(item.tag || 'action') + '</span></button>'
  )).join('');
  host.querySelectorAll('[data-ci]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      cmdkSel = Number(el.dataset.ci);
      host.querySelectorAll('.cmdk-item').forEach((item) => {
        item.classList.toggle('is-sel', Number(item.dataset.ci) === cmdkSel);
      });
    });
    el.addEventListener('click', (event) => cmdkRun(Number(el.dataset.ci), event.ctrlKey || event.metaKey));
  });
  host.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
}
function cmdkMove(delta) {
  if (!cmdkItems.length) return;
  cmdkSel = (cmdkSel + delta + cmdkItems.length) % cmdkItems.length;
  cmdkRender(document.getElementById('cmdk-input')?.value || '');
}
function cmdkRun(index, addToContext) {
  const item = cmdkItems[index];
  if (!item) return;
  cmdkClose();
  if (item.type === 'page') {
    if (addToContext) {
      const contextPath = validPageContext(item.path);
      if (contextPath) {
        addPageContext(contextPath);
        if (typeof notify === 'function') notify('Document added to Donna\\'s context');
      } else if (typeof notify === 'function') {
        notify('Only wiki/ and pending documents can join the context', 'e');
      }
      return;
    }
    setCenterWiki('/' + item.path);
    return;
  }
  if (item.type === 'conv') { loadConversation(item.id); return; }
  if (typeof item.run === 'function') item.run();
}
function initCmdk() {
  const backdrop = document.getElementById('cmdk-backdrop');
  const input = document.getElementById('cmdk-input');
  if (!backdrop || !input) return;
  input.addEventListener('input', () => { cmdkSel = 0; cmdkRender(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdkMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); cmdkRun(cmdkSel, e.ctrlKey || e.metaKey); }
    else if (e.key === 'Escape') { e.preventDefault(); cmdkClose(); }
  });
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) cmdkClose(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); cmdkToggle(); }
    else if (e.key === 'Escape' && !backdrop.hidden) cmdkClose();
  });
}
setTimeout(initCmdk, 0);

// ── Central zone ────────────────────────────────────────────────────────────
function leaveChatOnlyPaths() {
  if (['/chat/connectors', '/chat/execution'].includes(location.pathname.replace(/\\/+$/, ''))) {
    history.pushState(null, '', '/chat');
  }
}

function setCenterWiki(path) {
  const target = sanitizeWikiPath(path) || currentWikiPath();
  document.body.classList.remove('connectors-mode', 'execution-mode');
  $('connectors-link')?.classList.remove('active');
  document.body.classList.add('center-wiki');
  const frame = document.getElementById('wiki-frame');
  if (frame) {
    if (!frame.dataset.railBound) {
      frame.addEventListener('load', () => requestAnimationFrame(alignWikiRail));
      frame.dataset.railBound = '1';
    }
    let loadedPath = null;
    try {
      loadedPath = frame.contentWindow && frame.contentWindow.location.href !== 'about:blank'
        ? frame.contentWindow.location.pathname + frame.contentWindow.location.search + frame.contentWindow.location.hash
        : null;
    } catch {}
    if (loadedPath !== target) frame.setAttribute('src', target);
    else requestAnimationFrame(alignWikiRail);
  }
  leaveChatOnlyPaths();
  history.replaceState(null, '', '#wiki=' + encodeURIComponent(target));
  shellStore(SHELL_CENTER_KEY, 'wiki');
  shellStore(SHELL_WIKI_PATH_KEY, target);
  window.dispatchEvent(new CustomEvent('llmwiki:wikiPathChanged', { detail: target }));
}

function setCenterChat() {
  document.body.classList.remove('center-wiki');
  shellStore(SHELL_CENTER_KEY, 'chat');
  if (location.hash.startsWith('#wiki=')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  window.dispatchEvent(new CustomEvent('llmwiki:wikiPathChanged', { detail: null }));
}

// ── Center view switching (chat family) ─────────────────────────────────────
function initPageMode() {
  const path = location.pathname.replace(/\\/+$/, '') || '/chat';
  const isConnectors = path === '/chat/connectors';
  const isExecution = path === '/chat/execution';
  const isWiki = !isConnectors && !isExecution &&
    (path === '/' || location.hash.startsWith('#wiki='));
  if (isWiki) { setCenterWiki(wikiHashPath() || '/'); return; }
  document.body.classList.remove('center-wiki');
  document.body.classList.toggle('connectors-mode', isConnectors);
  document.body.classList.toggle('execution-mode', isExecution);
  $('connectors-link')?.classList.toggle('active', isConnectors);
  if (isConnectors) { renderCards(); renderSkillsManager(); }
  if (isExecution) openActivityPanel();
  // Also handles browser Back/Forward, which re-enters via this popstate handler.
  activityView=isExecution?'graph':'list';
  renderActivities();
}

function showConnectorsView(event) {
  event?.preventDefault();
  setCenterChat();
  document.body.classList.add('connectors-mode');
  document.body.classList.remove('execution-mode');
  $('connectors-link')?.classList.add('active');
  renderCards();
  renderSkillsManager();
  activityView='list';
  renderActivities();
  if (location.pathname.replace(/\\/+$/, '') !== '/chat/connectors') {
    history.pushState(null, '', '/chat/connectors');
  }
}

function showChatView() {
  // Active split: the chat column is already on screen next to the page, so
  // opening/loading a conversation must not tear the wiki side down. Below
  // 900px the grid is inactive (wiki fills the page) — switch normally.
  if (splitWikiEnabled() && window.innerWidth >= 900
    && document.body.classList.contains('center-wiki')
    && !document.body.classList.contains('connectors-mode')
    && !document.body.classList.contains('execution-mode')) {
    return;
  }
  setCenterChat();
  document.body.classList.remove('connectors-mode');
  document.body.classList.remove('execution-mode');
  $('connectors-link')?.classList.remove('active');
  leaveChatOnlyPaths();
  // Entering Execution view forces activityView to 'graph' in memory for the
  // current page session, but never reset it on the way out — the Activity
  // panel was left rendering its execution-mode graph+inspector layout
  // inside the normal-width sidebar instead of the plain card list.
  activityView='list';
  renderActivities();
}

function showExecutionView(event) {
  event?.preventDefault();
  setCenterChat();
  document.body.classList.remove('connectors-mode');
  document.body.classList.add('execution-mode');
  $('connectors-link')?.classList.remove('active');
  activityView='graph';
  openActivityPanel();
  renderActivities();
  if (location.pathname.replace(/\\/+$/, '') !== '/chat/execution') {
    history.pushState(null, '', '/chat/execution');
  }
}

// ── Boot: restore left tab and center (hash deep-link wins) ─────────────────
function initShellTabs() {
  setLeftTab(shellStore(SHELL_LEFT_KEY) === 'chat' ? 'chat' : 'wiki');
  const path = location.pathname.replace(/\\/+$/, '') || '/chat';
  if (path === '/chat' && !location.hash.startsWith('#wiki=') &&
      shellStore(SHELL_CENTER_KEY) !== 'chat') {
    setCenterWiki(currentWikiPath());
  }
  // Mirror the Activity badge (rendered in the chat topbar) onto the rail.
  const source = document.getElementById('tb-act-badge');
  const mirror = document.getElementById('rail-act-badge');
  if (source && mirror) {
    const sync = () => {
      mirror.textContent = source.textContent;
      mirror.classList.toggle('show', Boolean(source.textContent));
    };
    new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
    sync();
  }
}

// ── Shell <-> wiki iframes messaging ────────────────────────────────────────
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'llmwiki:nav') {
    // A wiki page loaded in the central frame (click in the wiki panel or in
    // a page): bring the wiki to the center and highlight the active file.
    const navPath = sanitizeWikiPath(data.path);
    if (!navPath) return;
    setCenterWiki(navPath);
    document.getElementById('wiki-side-frame')?.contentWindow?.postMessage(
      { type: 'llmwiki:active', path: navPath }, location.origin);
  } else if (data.type === 'llmwiki:navigate') {
    // Wiki panel asks for a JS-driven navigation (search palette, shortcuts).
    const href = sanitizeWikiPath(data.href);
    if (!href) return;
    setCenterWiki(href);
  } else if (data.type === 'llmwiki:addContext') {
    // "+ Context" clicked inside the central wiki page iframe or the tree menu.
    const contextPath = validPageContext(data.path);
    if (!contextPath) return;
    const already = pageContexts.includes(contextPath);
    addPageContext(contextPath);
    if (typeof notify === 'function') {
      notify(already ? 'Document already in Donna\\'s context' : 'Document added to Donna\\'s context');
    }
  } else if (data.type === 'llmwiki:palette') {
    // Ctrl/Cmd+K pressed inside an embedded wiki iframe.
    cmdkToggle();
  }
});
`;
