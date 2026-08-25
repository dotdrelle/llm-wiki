import { CONFIRM_DIALOG_SCRIPT } from '../../chat/confirmDialog.ts';

export const WIKI_LAYOUT_SCRIPT = `
${CONFIRM_DIALOG_SCRIPT}
(() => {
  const THEME_KEY = 'llm-wiki:theme';
  const themeToggle = document.querySelector('[data-theme-toggle]');
  function applyTheme(theme, persist = true) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('theme-dark', selected === 'dark');
    document.documentElement.classList.toggle('theme-light', selected === 'light');
    if (themeToggle) {
      themeToggle.textContent = selected === 'light' ? '☾' : '☀';
      themeToggle.title = selected === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    }
    if (persist) localStorage.setItem(THEME_KEY, selected);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || localStorage.getItem('llm-wiki:graph:theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeToggle?.addEventListener('click', () => applyTheme(document.documentElement.classList.contains('theme-dark') ? 'light' : 'dark'));
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY && event.newValue) applyTheme(event.newValue, false);
  });
  const storagePrefix = 'llm-wiki:sidebar:';
  const searchKey = storagePrefix + 'search';
  const scrollKey = storagePrefix + 'scrollTop';
  const collectionKey = storagePrefix + 'collection';
  let activeCollection = localStorage.getItem(collectionKey) || 'templates';
  const currentPath = decodeURIComponent(window.location.pathname).replace(/^\\//, '');
  const sidebar = document.querySelector('.sidebar');
  const sideTree = document.querySelector('.side-tree');
  const searchInput = document.querySelector('[data-side-search]');
  const searchStatus = document.querySelector('[data-side-search-status]');
  const sideFiles = () => [...document.querySelectorAll('.side-tree [data-side-path]')];
  const sideFolders = () => [...document.querySelectorAll('[data-tree-id]')];
  function saveSidebarState() {
    if (searchInput) localStorage.setItem(searchKey, searchInput.value);
    if (sideTree) localStorage.setItem(scrollKey, String(sideTree.scrollTop));
  }
  function initializeFolder(details) {
    if (details.dataset.sidebarInitialized === '1') return;
    details.dataset.sidebarInitialized = '1';
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
  }
  document.querySelectorAll('[data-tree-id]').forEach(initializeFolder);
  function markActiveSidebarLinks() {
    document.querySelectorAll('[data-side-path]').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('data-side-path') === currentPath);
    });
  }
  markActiveSidebarLinks();
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('[data-side-path]');
    if (link) saveSidebarState();
  });
  // Re-read the panel from the server instead of pruning the clicked node from
  // the DOM. A delete or a move also prunes the parent folders it empties, and
  // those disappearances are invisible to the client — patching locally left
  // the tree showing folders that no longer exist.
  //
  // It used to replace ONLY [data-untracked-list], so refreshing showed the new
  // Pending state above an unchanged wiki/deliverables/templates/build-context
  // tree — the sections an ingest is precisely most likely to have changed.
  // /embed/sidebar already returns the whole thing.
  async function refreshSidebar() {
    const response = await fetch('/embed/sidebar', { cache: 'no-store' });
    if (!response.ok) throw new Error('Refresh failed');
    const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
    // Which folders are open is the reader's place in the tree, not server
    // state: rebuilding the markup must not send them back to the top.
    const openBefore = new Set(
      [...document.querySelectorAll('.side-tree [data-tree-id]')]
        .filter((node) => node.open)
        .map((node) => node.getAttribute('data-tree-id')),
    );
    const pairs = [
      ['nav.side-tree', 'innerHTML'],
      ['[data-untracked-list]', 'innerHTML'],
      ['[data-untracked-count]', 'textContent'],
    ];
    let replaced = 0;
    for (const [selector, property] of pairs) {
      const current = document.querySelector(selector);
      const next = nextDocument.querySelector(selector);
      if (!current || !next) continue;
      current[property] = next[property];
      replaced += 1;
    }
    if (!replaced) throw new Error('Sidebar unavailable');
    document.querySelectorAll('.side-tree [data-tree-id]').forEach((node) => {
      const id = node.getAttribute('data-tree-id');
      if (id && openBefore.size) node.open = openBefore.has(id);
    });
    markActiveSidebarLinks();
    applySidebarSearch();
    // The tree (and the "Build" button it carries) was just rebuilt: re-wire
    // the shell-only launch button, which ships hidden and is revealed only
    // inside the chat shell.
    initBuildConceptsButton();
  }
  document.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-tree-delete]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const relativePath = button.getAttribute('data-tree-delete') || '';
      const kind = button.getAttribute('data-tree-kind') || 'file';
      if (!relativePath) return;
      /*
       What points at it decides whether we ask.

       A folder takes its whole subtree with it, so it always asks. A lone file
       used to go without a word — "cheap to recreate" — but that is only true
       of a page nobody cites. A cited page leaves dead links behind, and those
       degrade to plain text at render time without a single warning: the reader
       would never learn what was lost. So the count decides, and it is named.
      */
      button.disabled = true;
      let citing = [];
      try {
        const found = await fetch('/api/tree/references?path=' + encodeURIComponent(relativePath));
        citing = (await found.json()).pages || [];
      } catch (err) {
        // Unknown is not zero: failing to count must not silence the prompt.
        citing = null;
      }
      const cited = citing === null
        ? '\\nCould not check which pages link to it.'
        : citing.length
          ? '\\n' + citing.length + ' page(s) link to it:\\n· ' + citing.slice(0, 5).join('\\n· ')
            + (citing.length > 5 ? '\\n· …and ' + (citing.length - 5) + ' more' : '')
          : '';
      const mustAsk = kind === 'folder' || citing === null || citing.length > 0;
      if (mustAsk && !(await confirmAction({
        title: kind === 'folder' ? 'Delete folder' : 'Delete page',
        message: (kind === 'folder' ? 'Delete this folder and everything in it?\\n' : 'Delete this page?\\n') + relativePath + cited,
        confirmLabel: 'Delete',
        danger: true,
      }))) { button.disabled = false; return; }
      try {
        const response = await fetch('/api/tree/' + encodeURIComponent(relativePath), { method: 'DELETE' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Delete failed');
        await refreshSidebar();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
        button.disabled = false;
      }
  });

  // Folder creation. A prompt() rather than an inline field: it's a rare
  // action, and a permanent field in the tree would cost a line on every folder
  // for occasional use.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-tree-new-folder]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const parent = button.getAttribute('data-tree-new-folder') || '';
    const name = prompt('New folder in ' + parent);
    if (!name || !name.trim()) return;
    try {
      const response = await fetch('/api/tree/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent, name: name.trim(), kind: 'folder' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Create failed');
      await refreshSidebar();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Sidebar drag & drop ──────────────────────────────────────────────────
  // Drag a document or a folder onto another folder to move it there; drop on
  // a section root to move it back to that section's top level. Identical for
  // Pending and for wiki/templates/build-context/deliverables — the server
  // refuses a move between two sections, so the same handler serves all five.
  let untrackedDragPath = null;
  document.addEventListener('dragstart', (event) => {
    const source = event.target.closest?.('[data-tree-drag]');
    if (!source) return;
    untrackedDragPath = source.getAttribute('data-tree-drag');
    source.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Some browsers cancel a drag with no payload attached.
      event.dataTransfer.setData('text/plain', untrackedDragPath || '');
    }
  });
  document.addEventListener('dragend', () => {
    untrackedDragPath = null;
    document.querySelectorAll('.is-dragging')
      .forEach((node) => node.classList.remove('is-dragging'));
    clearDropTargets();
  });
  function clearDropTargets() {
    document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
  }
  // The deepest [data-tree-drop] under the cursor wins, so dropping on a
  // nested folder does not land in its parent.
  function dropTargetFor(event) {
    if (!untrackedDragPath) return null;
    const target = event.target.closest?.('[data-tree-drop]');
    if (!target) return null;
    const destination = target.getAttribute('data-tree-drop') || '';
    const name = untrackedDragPath.slice(untrackedDragPath.lastIndexOf('/') + 1);
    const currentParent = untrackedDragPath.slice(0, untrackedDragPath.lastIndexOf('/'));
    // No-op drops and folder-into-itself are refused before any round trip.
    if (destination === currentParent) return null;
    if (destination === untrackedDragPath) return null;
    if ((destination + '/').startsWith(untrackedDragPath + '/')) return null;
    return { target, destination, name };
  }
  document.addEventListener('dragover', (event) => {
    const drop = dropTargetFor(event);
    if (!drop) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!drop.target.classList.contains('is-drop-target')) {
      clearDropTargets();
      drop.target.classList.add('is-drop-target');
    }
  });
  document.addEventListener('dragleave', (event) => {
    const target = event.target.closest?.('[data-tree-drop]');
    target?.classList.remove('is-drop-target');
  });
  document.addEventListener('drop', async (event) => {
    const drop = dropTargetFor(event);
    if (!drop) return;
    event.preventDefault();
    const from = untrackedDragPath;
    untrackedDragPath = null;
    clearDropTargets();
    try {
      const response = await fetch('/api/tree/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: drop.destination }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Move failed');
      await refreshSidebar();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  });
  function folderHasVisibleFile(folder) {
    return Boolean(folder.querySelector('[data-side-path]:not(.is-search-hidden)'));
  }
  // build-context / templates / deliverables are three tabs; only the active
  // one is shown. A search query reveals all three so a match in a hidden
  // collection is not silently invisible, and clearing the query restores the
  // single-tab view.
  function applyCollectionTab() {
    const searching = Boolean((searchInput?.value || '').trim());
    document.querySelectorAll('.side-collection-tab').forEach((tab) => {
      const active = tab.getAttribute('data-collection') === activeCollection && !searching;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.side-collection-panel').forEach((panel) => {
      panel.hidden = !searching && panel.getAttribute('data-collection-panel') !== activeCollection;
    });
  }
  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('.side-collection-tab');
    if (!tab) return;
    activeCollection = tab.getAttribute('data-collection') || 'templates';
    try { localStorage.setItem(collectionKey, activeCollection); } catch {}
    applyCollectionTab();
  });
  function applySidebarSearch() {
    const query = window.WikiUi.normalizeSearch(searchInput?.value.trim() || '');
    let matchCount = 0;
    if (!query) {
      sideFiles().forEach((link) => link.classList.remove('is-search-hidden'));
      sideFolders().forEach((folder) => folder.classList.remove('is-search-hidden'));
      searchStatus?.classList.remove('is-visible');
      applyCollectionTab();
      return;
    }
    for (const link of sideFiles()) {
      const haystack = window.WikiUi.normalizeSearch((link.getAttribute('data-side-path') || '') + ' ' + link.textContent);
      const matches = haystack.includes(query);
      link.classList.toggle('is-search-hidden', !matches);
      if (matches) {
        matchCount += 1;
        link.closest('[data-tree-id]')?.setAttribute('open', '');
      }
    }
    for (const folder of [...sideFolders()].reverse()) {
      const visible = folderHasVisibleFile(folder);
      folder.classList.toggle('is-search-hidden', !visible);
      if (visible) folder.open = true;
    }
    if (searchStatus) {
      searchStatus.textContent = matchCount === 0 ? 'No matching files.' : matchCount + ' matching file' + (matchCount > 1 ? 's.' : '.');
      searchStatus.classList.add('is-visible');
    }
    applyCollectionTab();
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
  // Both ↻ reload the SAME complete tree.
  //
  // The Wiki one only replaced the children of [data-tree-id="wiki"]: a file
  // created in templates/, deliverables/ or build-context/ — exactly what a
  // production skill does — never appeared, and the button seemed dead. But
  // /embed/sidebar already returns everything, and refreshSidebar() preserves
  // the open folders, the filter and the active link: refreshing a single
  // section cost code for an incomplete result.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-sidebar-refresh]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    button.classList.add('is-refreshing');
    const label = button.querySelector('.side-refresh-label');
    const originalLabel = label ? label.textContent : null;
    if (label) label.textContent = 'Refreshing…';
    try {
      await refreshSidebar();
      document.querySelectorAll('[data-tree-id]').forEach(initializeFolder);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      button.disabled = false;
      button.classList.remove('is-refreshing');
      if (label && originalLabel) label.textContent = originalLabel;
    }
  });
  applySidebarSearch();
  requestAnimationFrame(() => {
    const savedScroll = Number(localStorage.getItem(scrollKey) || '0');
    if (sideTree && Number.isFinite(savedScroll)) sideTree.scrollTop = savedScroll;
  });

  // ── main sidebar resizer ─────────────────────────────────────────────────
  (function initMainSidebarResizer() {
    const shell = document.querySelector('.app-shell');
    const handle = document.querySelector('[data-wiki-main-resizer]');
    if (!shell || !sidebar || !handle) return;
    const WKEY = 'llm-wiki:sidebar:width';
    function clamp(px) {
      return Math.max(220, Math.min(px, window.innerWidth - 420));
    }
    function applyWidth(px, persist) {
      const v = clamp(px);
      shell.style.setProperty('--wiki-sidebar-w', v + 'px');
      if (persist) localStorage.setItem(WKEY, String(Math.round(v)));
    }
    const savedWidth = Number(localStorage.getItem(WKEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) applyWidth(savedWidth, false);
    const onMove = e => applyWidth(e.clientX, true);
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', e => {
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
  })();

  // ── pending panel resizer ─────────────────────────────────────────────────
  (function initPendingResizer() {
    const sb = document.querySelector('.sidebar');
    const handle = document.querySelector('[data-pending-resizer]');
    const panel = document.querySelector('[data-untracked-panel]');
    if (!sb || !handle || !panel) return;
    const PKEY = 'llm-wiki:sidebar:pendingHeight';
    function clamp(px) {
      return Math.max(60, Math.min(px, sb.clientHeight * 0.72));
    }
    function applyHeight(px, persist) {
      const v = clamp(px);
      sb.style.setProperty('--pending-height', v + 'px');
      if (persist) localStorage.setItem(PKEY, String(Math.round(v)));
    }
    function syncResizer() {
      handle.classList.toggle('is-visible', panel.open);
      if (!panel.open) {
        sb.style.removeProperty('--pending-height');
      } else {
        const saved = Number(localStorage.getItem(PKEY));
        if (Number.isFinite(saved) && saved > 0) applyHeight(saved);
        else applyHeight(panel.offsetHeight);
      }
    }
    panel.addEventListener('toggle', syncResizer);
    syncResizer();
    let startY = 0, startH = 0, dragging = false;
    const onMove = e => {
      if (!dragging) return;
      applyHeight(startH + (startY - e.clientY), true);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', e => {
      startY = e.clientY;
      startH = parseFloat(sb.style.getPropertyValue('--pending-height')) || panel.offsetHeight;
      dragging = true;
      handle.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
    window.addEventListener('resize', syncResizer);
  })();

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
          btn.textContent = 'active';
          btn.style.cssText = 'opacity:0.4;cursor:default';
        } else if (isRunning && isOpened) {
          btn.textContent = 'open';
          btn.style.cssText = 'opacity:0.45;cursor:default';
        } else {
          btn.textContent = isRunning ? 'Open' : 'Start';
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
      btn.textContent = action === 'start' ? 'Starting...' : 'Opening...';
      try {
        await fetch('/api/hub/workspaces/' + encodeURIComponent(wsName) + '/' + action, { method: 'POST', headers: { 'X-LLM-WIKI-HUB': '1' } });
        if (action === 'open') {
          markLocallyOpened(wsName);
          btn.textContent = 'open';
        }
        if (action === 'start') {
          btn.textContent = 'Waiting...';
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

// ── Global keyboard shortcuts ────────────────────────────────────────────────
(function initShortcuts() {
  document.addEventListener('keydown', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    // ? -> help modal
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const m = document.getElementById('shortcuts-modal');
      if (m) m.classList.toggle('is-open');
      return;
    }
    // Cmd/Ctrl+E -> edit the current page
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      const editLink = document.querySelector('a.action-link[href^="/edit/"]');
      if (editLink) { e.preventDefault(); window.location.href = editLink.getAttribute('href'); }
      return;
    }
    // Cmd/Ctrl+B -> toggle sidebar
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      const sb = document.querySelector('.sidebar');
      if (sb) sb.style.display = sb.style.display === 'none' ? '' : 'none';
      return;
    }
    // G → graph
    if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      window.WikiUi.navigate('/graph');
    }
    // Escape → close help modal
    if (e.key === 'Escape') {
      const m = document.getElementById('shortcuts-modal');
      if (m && m.classList.contains('is-open')) { m.classList.remove('is-open'); }
    }
  });
})();

// ── Palette ⌘K ──────────────────────────────────────────────────────────────
(function initPalette() {
  const backdrop = document.getElementById('palette-backdrop');
  const input = document.getElementById('palette-input');
  const results = document.getElementById('palette-results');
  if (!backdrop || !input || !results) return;

  const allFiles = [...document.querySelectorAll('[data-side-path]')].map(function(el) {
    const p = el.getAttribute('data-side-path') || '';
    return { path: p, title: (el.textContent || '').trim(), href: '/' + p, type: p.split('/')[0] || 'wiki' };
  });
  const ICONS = { wiki: '📄', deliverables: '📦', templates: '📋', 'build-context': '🧩' };
  let selIdx = 0, cur = [];
  let previousOverflow = '';
  let previousActiveElement = null;

  function open() {
    previousActiveElement = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    backdrop.classList.add('is-open');
    input.value = '';
    show('');
    requestAnimationFrame(function() { input.focus({ preventScroll: true }); });
  }
  function close() {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = previousOverflow;
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus({ preventScroll: true });
    }
    previousActiveElement = null;
  }

  function show(q) {
    const nq = window.WikiUi.normalizeSearch(q.trim());
    cur = nq
      ? allFiles.filter(function(f) { return window.WikiUi.normalizeSearch(f.path + ' ' + f.title).includes(nq); }).slice(0, 12)
      : allFiles.slice(0, 8);
    selIdx = 0;
    render();
  }

  function render() {
    if (!cur.length) { results.innerHTML = '<div class="palette-empty">No results</div>'; return; }
    results.innerHTML = cur.map(function(f, i) {
      const icon = ICONS[f.type] || '📄';
      const sel = i === selIdx ? ' is-sel' : '';
      return '<a class="palette-item' + sel + '" href="' + window.WikiUi.escapeHtml(encodeURI(f.href)) + '" data-pi="' + i + '">' +
        '<div class="palette-item-icon">' + window.WikiUi.escapeHtml(icon) + '</div>' +
        '<div class="palette-item-body">' +
          '<div class="palette-item-title">' + window.WikiUi.escapeHtml(f.title || f.path.split('/').pop() || '') + '</div>' +
          '<div class="palette-item-path">' + window.WikiUi.escapeHtml(f.path) + '</div>' +
        '</div>' +
        '<span class="palette-tag ' + window.WikiUi.escapeHtml(f.type) + '">' + window.WikiUi.escapeHtml(f.type) + '</span>' +
      '</a>';
    }).join('');
    results.querySelectorAll('[data-pi]').forEach(function(el) {
      el.addEventListener('mouseenter', function() {
        selIdx = Number(el.dataset.pi);
        results.querySelectorAll('.palette-item').forEach(function(item) {
          item.classList.toggle('is-sel', Number(item.dataset.pi) === selIdx);
        });
      });
      el.addEventListener('click', function() { close(); });
    });
    results.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }

  function moveSelection(delta) {
    if (!cur.length) return;
    selIdx = (selIdx + delta + cur.length) % cur.length;
    render();
  }

  function openSelected() {
    if (!cur[selIdx]) return;
    window.WikiUi.navigate(cur[selIdx].href);
    close();
  }

  input.addEventListener('input', function() { show(input.value); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    else if (e.key === 'Escape') { close(); }
  });
  backdrop.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      // Embedded in the chat shell: one palette for the whole app — defer to
      // the shell's Ctrl+K instead of opening the page-local one.
      if (window.self !== window.top) {
        window.parent.postMessage({ type: 'llmwiki:palette' }, window.location.origin);
        return;
      }
      backdrop.classList.contains('is-open') ? close() : open();
    }
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) { close(); }
  });
})();

// "Build" concept grid → reclassify → taxonomy: only meaningful inside the
// chat shell, where Serve owns the LLM config. Ships hidden; revealed and
// wired here. Lives at the TOP level (outside the shell's IIFE) because
// initShellMessaging — also top-level — calls it, and the IIFE closes before
// initShellMessaging runs.
function initBuildConceptsButton() {
  if (window.self === window.top) return;
  if (!document.documentElement.classList.contains('sidebar-panel')) return;
  const buildConceptsBtn = document.querySelector('[data-build-concepts]');
  if (!buildConceptsBtn) return;
  buildConceptsBtn.hidden = false;
  buildConceptsBtn.addEventListener('click', function() {
    window.parent.postMessage({ type: 'llmwiki:buildConcepts' }, window.location.origin);
  });
}

// ── App-shell messaging (no-op on standalone pages) ─────────────────────────
(function initShellMessaging() {
  const embedded = window.self !== window.top;
  const isSidebarPanel = document.documentElement.classList.contains('sidebar-panel');

  // Content page inside the shell's central iframe: report navigations so the
  // shell can sync its URL hash and the sidebar's active file.
  if (embedded && !isSidebarPanel) {
    window.parent.postMessage(
      { type: 'llmwiki:nav', path: window.location.pathname },
      window.location.origin,
    );
    // "+ Context": only meaningful inside the chat shell, so the button
    // ships hidden and is revealed here. Clicking hands the page path to the
    // shell, which validates it and renders the context chip.
    const chatContextBtn = document.querySelector('[data-chat-context]');
    if (chatContextBtn) {
      chatContextBtn.hidden = false;
      chatContextBtn.addEventListener('click', () => {
        window.parent.postMessage(
          { type: 'llmwiki:addContext', path: chatContextBtn.getAttribute('data-chat-context') },
          window.location.origin,
        );
      });
    }
    // "Build": only meaningful inside the chat shell, where Donna owns the
    // launch. Reveal the button and hand the template path to the shell.
    const buildTemplateBtn = document.querySelector('[data-build-template]');
    if (buildTemplateBtn) {
      buildTemplateBtn.hidden = false;
      buildTemplateBtn.addEventListener('click', () => {
        window.parent.postMessage(
          { type: 'llmwiki:buildTemplate', path: buildTemplateBtn.getAttribute('data-build-template') },
          window.location.origin,
        );
      });
    }
  }

  // Sidebar panel: reflect the active file when the shell reports navigation.
  if (embedded && isSidebarPanel) {
    // "Ingest" (⚡) on the Pending panel: only meaningful inside the chat
    // shell, where Donna owns the launch. Reveal the button and hand the
    // request to the shell, which routes it as a /wiki-ingest skill turn.
    const ingestLaunchBtn = document.querySelector('[data-ingest-launch]');
    if (ingestLaunchBtn) {
      ingestLaunchBtn.hidden = false;
      ingestLaunchBtn.addEventListener('click', function() {
        window.parent.postMessage({ type: 'llmwiki:ingest' }, window.location.origin);
      });
    }
    // "Build" concept grid, then file unclassified pages: launches through
    // Donna, like Ingest/Build-template above — not the two chained direct
    // POST calls (with an inline spinner+timer) this used to make. Real
    // orchestration (visible in the Plan, with a proper task dependency
    // chain: concepts -> reclassify-concepts -> taxonomy) won this trade-off
    // over in-place progress.
    initBuildConceptsButton();
    // All local links must go through the shell, including pages such as
    // /graph that do not load WIKI_LAYOUT_SCRIPT and therefore cannot report
    // their own navigation after the iframe has loaded.
    document.addEventListener('click', function(event) {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const href = target ? target.getAttribute('href') : null;
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      event.preventDefault();
      window.WikiUi.navigate(href);
    });

    // Right-click menu on tree files: Open / + Context. Only in the embedded
    // sidebar — the standalone wiki browser has no chat context.
    (function initTreeContextMenu() {
      const style = document.createElement('style');
      style.textContent = '.tree-menu{position:fixed;z-index:400;min-width:180px;background:var(--panel,#fff);border:1px solid var(--border,#ccc);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:4px;display:flex;flex-direction:column}'
        + '.tree-menu button{display:block;width:100%;text-align:left;border:0;background:none;color:var(--text,#222);font:500 .82rem var(--font-sans,sans-serif);padding:7px 10px;border-radius:6px;cursor:pointer}'
        + '.tree-menu button:hover{background:var(--panel-soft,#eee)}'
        + '.tree-menu .tree-menu-path{font-size:.68rem;color:var(--muted,#888);padding:4px 10px 6px;border-bottom:1px solid var(--border,#ccc);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}';
      document.head.appendChild(style);
      let menu = null;
      function closeMenu() { if (menu) { menu.remove(); menu = null; } }
      function addItem(label, onPick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', function() { closeMenu(); onPick(); });
        menu.appendChild(btn);
      }
      document.addEventListener('contextmenu', function(event) {
        const link = event.target instanceof Element ? event.target.closest('[data-side-path]') : null;
        if (!link) return;
        const sidePath = link.getAttribute('data-side-path') || '';
        if (!sidePath.endsWith('.md')) return;
        event.preventDefault();
        closeMenu();
        const eligible = sidePath.indexOf('wiki/') === 0 || sidePath.indexOf('raw/untracked/') === 0;
        menu = document.createElement('div');
        menu.className = 'tree-menu';
        const pathLabel = document.createElement('div');
        pathLabel.className = 'tree-menu-path';
        pathLabel.textContent = sidePath;
        menu.appendChild(pathLabel);
        addItem('Open', function() { window.WikiUi.navigate('/' + sidePath); });
        if (eligible) {
          addItem('+ Context', function() {
            window.parent.postMessage({ type: 'llmwiki:addContext', path: '/' + sidePath }, window.location.origin);
          });
        }
        document.body.appendChild(menu);
        const maxX = window.innerWidth - menu.offsetWidth - 6;
        const maxY = window.innerHeight - menu.offsetHeight - 6;
        menu.style.left = Math.max(4, Math.min(event.clientX, maxX)) + 'px';
        menu.style.top = Math.max(4, Math.min(event.clientY, maxY)) + 'px';
      });
      document.addEventListener('click', closeMenu);
      window.addEventListener('blur', closeMenu);
      document.addEventListener('keydown', function(event) { if (event.key === 'Escape') closeMenu(); });
      document.addEventListener('scroll', closeMenu, true);
    })();

    window.addEventListener('message', function(event) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'llmwiki:active') return;
      const currentPath = decodeURIComponent(String(data.path || '')).replace(/^\\//, '');
      document.querySelectorAll('[data-side-path]').forEach(function(link) {
        const isActive = link.getAttribute('data-side-path') === currentPath;
        link.classList.toggle('is-active', isActive);
        if (isActive) {
          let folder = link.closest('[data-tree-id]');
          while (folder) {
            folder.open = true;
            folder = folder.parentElement ? folder.parentElement.closest('[data-tree-id]') : null;
          }
        }
      });
    });
  }
})();
`;
