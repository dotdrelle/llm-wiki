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

// References only: Donna receives at most five paths and chooses which
// generic wiki read tool to call. Contents are never read or injected here.
const PAGE_CONTEXT_LIMIT=5;
let pageContexts=[];
function validPageContext(path) {
  const value=String(path||'').replace(/^\\//,'');
  if(value.includes('..')||!value.endsWith('.md')) return null;
  return value.startsWith('wiki/')||value.startsWith('raw/untracked/')?value:null;
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
  host.innerHTML=paths.map(path=>\`<span class="page-context-chip" title="Donna utilisera ses outils de lecture pour ce document"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="page-context-label">\${esc(path)}</span><button class="page-context-clear" type="button" title="Retirer ce document du contexte" aria-label="Retirer \${esc(path)} du contexte" onclick="removePageContext(\${esc(JSON.stringify(path))})">&times;</button></span>\`).join('');
}
window.addEventListener('llmwiki:wikiPathChanged',(e)=>{
  if(typeof e.detail==='string') addPageContext(e.detail);
});
window.addEventListener('hashchange',()=>{ const path=openWikiPageForChat(); if(path) addPageContext(path); });
setTimeout(()=>{ const path=openWikiPageForChat(); if(path) addPageContext(path); },0);

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
  }
});
`;
