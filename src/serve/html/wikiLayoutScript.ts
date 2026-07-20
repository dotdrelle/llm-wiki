export const WIKI_LAYOUT_SCRIPT = `
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
  const currentPath = decodeURIComponent(window.location.pathname).replace(/^\\//, '');
  const sidebar = document.querySelector('.sidebar');
  const sideTree = document.querySelector('.side-tree');
  const searchInput = document.querySelector('[data-side-search]');
  const searchStatus = document.querySelector('[data-side-search-status]');
  const sideFiles = [...document.querySelectorAll('.side-tree [data-side-path]')];
  const sideFolders = [...document.querySelectorAll('[data-tree-id]')];
  function saveSidebarState() {
    if (searchInput) localStorage.setItem(searchKey, searchInput.value);
    if (sideTree) localStorage.setItem(scrollKey, String(sideTree.scrollTop));
  }
  document.querySelectorAll('[data-tree-id]').forEach((details) => {
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
  });
  document.querySelectorAll('[data-side-path]').forEach((link) => {
    if (link.getAttribute('data-side-path') === currentPath) {
      link.classList.add('is-active');
    }
    link.addEventListener('click', saveSidebarState);
  });
  function syncUntrackedCount() {
    const countEl = document.querySelector('[data-untracked-count]');
    const list = document.querySelector('[data-untracked-list]');
    if (!countEl || !list) return;
    const next = list.querySelectorAll('.side-untracked-item').length;
    countEl.textContent = String(next);
    if (next === 0) list.innerHTML = '<li class="side-untracked-empty">No pending sources.</li>';
  }
  document.querySelectorAll('[data-untracked-delete]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const relativePath = button.getAttribute('data-untracked-delete') || '';
      if (!relativePath) return;
      if (!confirm('Delete this pending source?\\n' + relativePath)) return;
      button.disabled = true;
      try {
        const response = await fetch('/api/untracked/' + encodeURIComponent(relativePath), { method: 'DELETE' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Delete failed');
        button.closest('.side-untracked-item')?.remove();
        syncUntrackedCount();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
        button.disabled = false;
      }
    });
  });
  function folderHasVisibleFile(folder) {
    return Boolean(folder.querySelector('[data-side-path]:not(.is-search-hidden)'));
  }
  function applySidebarSearch() {
    const query = window.WikiUi.normalizeSearch(searchInput?.value.trim() || '');
    let matchCount = 0;
    if (!query) {
      sideFiles.forEach((link) => link.classList.remove('is-search-hidden'));
      sideFolders.forEach((folder) => folder.classList.remove('is-search-hidden'));
      searchStatus?.classList.remove('is-visible');
      return;
    }
    for (const link of sideFiles) {
      const haystack = window.WikiUi.normalizeSearch((link.getAttribute('data-side-path') || '') + ' ' + link.textContent);
      const matches = haystack.includes(query);
      link.classList.toggle('is-search-hidden', !matches);
      if (matches) {
        matchCount += 1;
        link.closest('[data-tree-id]')?.setAttribute('open', '');
      }
    }
    for (const folder of [...sideFolders].reverse()) {
      const visible = folderHasVisibleFile(folder);
      folder.classList.toggle('is-search-hidden', !visible);
      if (visible) folder.open = true;
    }
    if (searchStatus) {
      searchStatus.textContent = matchCount === 0 ? 'No matching files.' : matchCount + ' matching file' + (matchCount > 1 ? 's.' : '.');
      searchStatus.classList.add('is-visible');
    }
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
    // Escape → fermer modal d'aide
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
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); backdrop.classList.contains('is-open') ? close() : open(); }
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) { close(); }
  });
})();

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
  }

  // Sidebar panel: reflect the active file when the shell reports navigation.
  if (embedded && isSidebarPanel) {
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
