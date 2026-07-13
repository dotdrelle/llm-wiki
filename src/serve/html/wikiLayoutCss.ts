import { WIKI_CSS_VARS } from '../../chat/theme.ts';

export const WIKI_LAYOUT_CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');
    ${WIKI_CSS_VARS}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Inter, system-ui, sans-serif;
      line-height: 1.65;
    }
    a { color: var(--link); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
    .wiki-theme-toggle, .wiki-help-toggle {
      position: fixed; top: 9px; z-index: 1000;
      width: 38px; height: 34px; padding: 0;
      border: 1px solid var(--border); border-radius: 6px;
      background: var(--panel-soft); color: var(--text);
      font: inherit; font-size: 17px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      text-decoration: none; line-height: 1;
    }
    .wiki-theme-toggle { right: 12px; }
    .wiki-help-toggle { right: 58px; font-weight: 800; }
    .wiki-theme-toggle:hover, .wiki-help-toggle:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .source-citation {
      display: inline-block;
      max-width: 100%;
      padding: 0.08rem 0.28rem;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--panel-soft);
      color: var(--link);
      font-size: 0.86em;
      line-height: 1.35;
      overflow-wrap: anywhere;
      vertical-align: baseline;
      text-decoration: none;
    }
    .source-citation:hover { border-color: var(--accent); background: var(--accent-soft); }
    .source-citation-stale,
    .stale-reference {
      display: inline-block;
      max-width: 100%;
      padding: 0.08rem 0.28rem;
      border: 1px dashed var(--border);
      border-radius: 5px;
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 0.86em;
      line-height: 1.35;
      overflow-wrap: anywhere;
      vertical-align: baseline;
      text-decoration: none;
      cursor: help;
    }
    .stale-reference::after {
      content: " unavailable";
      color: var(--muted);
      font-size: 0.72em;
      font-weight: 680;
    }
    .app-shell { min-height: 100vh; display: grid; grid-template-columns: var(--wiki-sidebar-w, 280px) 6px minmax(0, 1fr); }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 1.25rem;
      background: #fbfcfd;
    }
    .wiki-main-resizer {
      position: sticky;
      top: 0;
      height: 100vh;
      cursor: col-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      border-left: 1px solid var(--border);
      border-right: 1px solid var(--border);
      background: #fbfcfd;
      touch-action: none;
      z-index: 2;
    }
    .wiki-main-resizer:hover,
    .wiki-main-resizer.dragging { background: var(--panel-soft); }
    .wiki-main-resizer::before {
      content: '';
      width: 3px;
      height: 34px;
      border-radius: 99px;
      background: var(--border);
    }
    .wiki-main-resizer:hover::before,
    .wiki-main-resizer.dragging::before { background: var(--muted); }
    .brand { display: block; margin-bottom: 0.8rem; color: var(--text); text-decoration: none; }
    .brand-title {
      display: block;
      font-family: "Playfair Display", sans-serif;
      font-size: 1.28rem;
      font-weight: 700;
      line-height: 1.08;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }
    .side-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .side-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-width: 0;
      min-height: 2.75rem;
      padding: 0 0.65rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 0.86rem;
      font-weight: 720;
    }
    .side-action:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .side-action svg { width: 1.05rem; height: 1.05rem; stroke: currentColor; flex-shrink: 0; }
    .side-action span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .side-search {
      margin: 0.9rem 0 0.65rem;
    }
    .side-search-input {
      width: 100%;
      min-height: 2.25rem;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      outline: none;
    }
    .side-search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .side-search-status {
      display: none;
      margin: 0.45rem 0 0;
      color: var(--muted);
      font-size: 0.78rem;
    }
    .side-search-status.is-visible { display: block; }
    .side-tree { margin-top: 1rem; font-size: 0.9rem; flex: 1 1 0; min-height: 0; overflow-y: auto; }
    .side-folder { margin: 0.08rem 0; }
    .side-folder summary {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      min-height: 2rem;
      padding: 0.28rem 0.45rem;
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .side-folder summary::-webkit-details-marker { display: none; }
    .side-folder summary::before {
      content: "▸";
      width: 0.8rem;
      color: var(--muted);
      font-size: 0.74rem;
      transition: transform 120ms ease;
    }
    .side-folder[open] > summary::before { transform: rotate(90deg); }
    .side-folder summary:hover { background: var(--panel-soft); color: var(--accent); }
    .side-folder-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 680;
    }
    .side-folder-action {
      margin-left: auto;
      min-width: 1.45rem;
      height: 1.45rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 760;
      line-height: 1;
    }
    .side-folder-action:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .side-folder-children {
      margin-left: 0.85rem;
      padding-left: 0.35rem;
      border-left: 1px solid var(--border);
    }
    .side-file {
      display: block;
      min-height: 1.85rem;
      padding: 0.24rem 0.45rem 0.24rem 1.2rem;
      border-radius: 6px;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-decoration: none;
      position: relative;
    }
    .side-file::before {
      content: "";
      position: absolute;
      left: 0.45rem;
      top: 0.78rem;
      width: 0.38rem;
      height: 0.38rem;
      border-radius: 999px;
      background: var(--muted);
      opacity: 0.55;
    }
    .side-file:hover, .side-file.is-active {
      background: var(--panel-soft);
      color: var(--accent);
    }
    .side-file.is-active { font-weight: 720; }
    .side-file.is-active::before { background: var(--accent); opacity: 1; }
    .side-file[data-deliverable-kind="build"]::before { background: #6b7f2a; opacity: 0.8; }
    .side-file[data-deliverable-kind="export"]::before { background: #176b87; opacity: 0.85; }
    .side-file[data-deliverable-kind="polish"]::before { background: #8b5cf6; opacity: 0.85; }
    .side-folder.is-search-hidden, .side-file.is-search-hidden { display: none; }
    .side-pending-resizer {
      display: none;
      flex-shrink: 0;
      height: 8px;
      cursor: row-resize;
      align-items: center;
      justify-content: center;
      touch-action: none;
    }
    .side-pending-resizer.is-visible { display: flex; }
    .side-pending-resizer:hover,
    .side-pending-resizer.dragging { background: var(--panel-soft); }
    .side-pending-resizer::before {
      content: '';
      width: 34px;
      height: 3px;
      border-radius: 99px;
      background: var(--border);
    }
    .side-pending-resizer:hover::before,
    .side-pending-resizer.dragging::before { background: var(--muted); }
    .side-untracked {
      flex: 0 0 auto;
      margin-top: 0;
      padding-top: 0.4rem;
      border-top: 1px solid var(--border);
      min-height: 0;
    }
    .side-untracked[open] {
      flex: 0 0 var(--pending-height, 32vh);
      overflow: hidden;
    }
    .side-untracked summary {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2rem;
      padding: 0.28rem 0.45rem;
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      list-style: none;
      user-select: none;
      font-weight: 760;
    }
    .side-untracked summary::-webkit-details-marker { display: none; }
    .side-untracked summary::before {
      content: "▸";
      width: 0.8rem;
      color: var(--muted);
      font-size: 0.74rem;
      transition: transform 120ms ease;
    }
    .side-untracked[open] > summary::before { transform: rotate(90deg); }
    .side-untracked summary:hover { background: var(--panel-soft); color: var(--accent); }
    .side-untracked-count {
      margin-left: auto;
      min-width: 1.45rem;
      height: 1.45rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.76rem;
      font-weight: 820;
    }
    .side-untracked-list {
      overflow-y: auto;
      scrollbar-width: thin;
      max-height: calc(var(--pending-height, 32vh) - 3rem);
      margin: 0.25rem 0 0;
      padding: 0 0 0.25rem;
      list-style: none;
    }
    .side-untracked-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      min-height: 1.55rem;
      border-radius: 5px;
    }
    .side-untracked-link {
      flex: 1;
      min-width: 0;
      padding: 0.15rem 1.2rem 0.15rem 1rem;
      color: var(--text);
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-decoration: none;
      position: relative;
    }
    .side-untracked-link::before {
      content: "";
      position: absolute;
      left: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      width: 0.32rem;
      height: 0.32rem;
      border-radius: 999px;
      background: #b7791f;
      opacity: 0.85;
    }
    .side-untracked-link:hover {
      background: var(--panel-soft);
      color: var(--accent);
    }
    .side-untracked-link:hover::after {
      content: "✏";
      position: absolute;
      right: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.7rem;
      opacity: 0.55;
    }
    .side-untracked-delete {
      flex: 0 0 auto;
      width: 1.55rem;
      height: 1.55rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      border-radius: 5px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: 1rem;
      line-height: 1;
    }
    .side-untracked-delete:hover { border-color: var(--err); background: color-mix(in srgb, var(--err) 10%, var(--panel)); color: var(--err); }
    .side-untracked-empty {
      margin: 0.45rem 0.45rem 0;
      color: var(--muted);
      font-size: 0.82rem;
    }
    .side-link {
      display: block;
      margin: 0.45rem 0;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 680;
    }
    .side-link:hover { border-color: var(--accent); background: var(--accent-soft); }
    .ws-switcher { flex-shrink: 0; padding-top: 0.75rem; border-top: 1px solid var(--border); }
    .ws-switcher-title { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.4rem; padding: 0 0.2rem; }
    .ws-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; border-radius: 5px; font-size: 0.85rem; }
    .ws-item.ws-active { background: var(--accent-soft); font-weight: 680; }
    .ws-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
    .ws-dot.running { background: #4caf50; }
    .ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .ws-btn { font-size: 0.72rem; padding: 0.15rem 0.45rem; border: 1px solid var(--border); border-radius: 4px; background: var(--panel); color: var(--text); cursor: pointer; white-space: nowrap; }
    .ws-btn:hover:not(:disabled) { border-color: var(--accent); }
    .ws-btn:disabled { opacity: 0.45; cursor: default; }
    .content { min-width: 0; padding: 2rem clamp(1rem, 3vw, 3rem) 3rem; }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .topbar nav { min-width: 0; }
    .topbar nav a { color: inherit; }
    .topbar nav a + a::before { content: " / "; color: var(--muted); }
    .page-actions { display: flex; gap: 0.5rem; align-items: center; }
    .page-actions form { margin: 0; }
    .action-link, .action-button {
      display: inline-flex;
      align-items: center;
      min-height: 2rem;
      padding: 0.35rem 0.65rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 0.86rem;
      font-weight: 680;
      text-decoration: none;
      cursor: pointer;
    }
    .action-link:hover, .action-button:hover {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .action-danger { color: var(--err); border-color: color-mix(in srgb, var(--err) 55%, var(--border)); }
    .action-danger:hover { border-color: var(--err); background: color-mix(in srgb, var(--err) 10%, var(--panel)); color: var(--err); }
    .delete-confirm { position: relative; }
    .delete-confirm-panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.45rem);
      z-index: 20;
      width: min(20rem, calc(100vw - 2rem));
      padding: 0.8rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
    }
    .delete-confirm-panel[hidden] { display: none; }
    .delete-confirm-title { margin: 0 0 0.25rem; font-weight: 760; color: var(--text); }
    .delete-confirm-text { margin: 0 0 0.7rem; color: var(--muted); font-size: 0.84rem; line-height: 1.45; }
    .delete-confirm-actions { display: flex; justify-content: flex-end; gap: 0.45rem; }
    .hero {
      margin-bottom: 1.5rem;
      padding: clamp(1.3rem, 3vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .hero h1 { margin: 0; font-family: "Playfair Display", sans-serif; font-size: clamp(1.7rem, 3vw, 2.55rem); line-height: 1.05; letter-spacing: 0; }
    .hero p { max-width: 72ch; margin: 0.75rem 0 0; color: var(--muted); }
    .index-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
      gap: 1rem;
      align-items: start;
    }
    .index-aside {
      position: sticky;
      top: 1rem;
      min-width: 0;
    }
    .index-aside-title {
      margin: 0 0 0.7rem;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 780;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .section-browser {
      margin: 0 0 0.75rem;
    }
    .section-browser summary {
      list-style: none;
      cursor: pointer;
    }
    .section-browser summary::-webkit-details-marker { display: none; }
    .section-browser-summary {
      display: flex;
      min-height: 72px;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.9rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 1px 1px rgba(23, 32, 42, 0.04);
    }
    .section-browser summary:hover .section-browser-summary,
    .section-browser[open] .section-browser-summary {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .section-browser-title { font-weight: 760; overflow-wrap: anywhere; }
    .section-browser-meta { margin-top: 0.45rem; color: var(--muted); font-size: 0.82rem; }
    .section-browser-tiles {
      margin-top: 0.6rem;
      display: grid;
      gap: 0.6rem;
    }
    .section-browser-group {
      margin-top: 0.55rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .section-browser-group summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 2.2rem;
      padding: 0.55rem 0.7rem;
      color: var(--text);
      font-size: 0.86rem;
      font-weight: 730;
    }
    .section-browser-group summary span:last-child {
      color: var(--muted);
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
      font-weight: 650;
    }
    .section-browser-group .section-browser-tiles {
      margin: 0;
      padding: 0.6rem;
      border-top: 1px solid var(--border);
      background: var(--panel-soft);
    }
    .tile-section { margin: 1.5rem 0 2rem; }
    .index-aside .tile-section { margin: 0 0 1rem; }
    .section-title { margin: 0 0 0.65rem; font-size: 0.98rem; color: var(--muted); font-weight: 760; }
    .tile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.8rem;
    }
    .index-aside .tile-grid { grid-template-columns: 1fr; }
    .tile {
      display: flex;
      min-height: 92px;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.95rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      box-shadow: 0 1px 1px rgba(23, 32, 42, 0.04);
    }
    .tile[href]:hover { border-color: var(--accent); background: var(--accent-soft); }
    .tile-title { font-weight: 720; line-height: 1.25; overflow-wrap: anywhere; }
    .tile-meta { margin-top: 0.7rem; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
    .article {
      max-width: 960px;
      padding: clamp(1.1rem, 2.6vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .article h1, .article h2, .article h3 { line-height: 1.2; letter-spacing: 0; }
    .article h1 { margin-top: 0; }
    .article img { max-width: 100%; }
    .index-layout .article ul { columns: 2; column-gap: 2rem; }
    .index-layout .article ul li { break-inside: avoid; }
    .log-article {
      max-width: 1160px;
      padding: clamp(1.1rem, 2.6vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .log-article h1 {
      margin: 0 0 1rem;
      font-family: "Playfair Display", sans-serif;
      line-height: 1.05;
      letter-spacing: 0;
    }
    .log-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.7rem;
    }
    .log-entry {
      display: grid;
      gap: 0.55rem;
      padding: 0.8rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
    }
    .log-entry-system { display: flex; align-items: center; gap: 0.6rem; }
    .log-entry-head {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      flex-wrap: wrap;
    }
    .log-date {
      font: 0.78rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      color: var(--muted);
    }
    .log-kind {
      display: inline-flex;
      align-items: center;
      min-height: 1.35rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.72rem;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .log-flow {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto minmax(0, 1fr);
      gap: 0.35rem 0.55rem;
      align-items: center;
      font-size: 0.84rem;
    }
    .log-flow-label {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .log-path {
      min-width: 0;
      padding: 0.28rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: 0.78rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
      text-decoration: none;
    }
    a.log-path:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .log-arrow { color: var(--muted); font-weight: 760; }
    .log-summary {
      margin: 0;
      color: var(--text);
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .edit-form {
      display: grid;
      gap: 0.85rem;
    }
    .edit-form .hero {
      position: sticky;
      top: 0.75rem;
      z-index: 8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-width: 0;
      padding: 0.85rem 1rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 94%, transparent);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
    }
    .edit-form .hero .page-actions {
      flex-shrink: 0;
    }
    .edit-path-label {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      color: var(--muted);
      word-break: break-all;
    }
    .edit-file-state {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      padding: 0.12rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      background: var(--panel-soft);
      font-family: inherit;
      font-size: 0.72rem;
      font-weight: 760;
      line-height: 1.35;
      white-space: nowrap;
    }
    .edit-file-state.is-new {
      border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
      color: var(--accent);
      background: var(--accent-soft);
    }
    .edit-textarea {
      width: 100%;
      min-height: min(66vh, 760px);
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      font: 0.92rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      line-height: 1.55;
      resize: vertical;
      outline: none;
    }
    .edit-textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .field-label { font-size: 0.82rem; font-weight: 700; color: var(--muted); margin-bottom: -0.45rem; display: block; }
    .field-input {
      width: 100%;
      min-height: 2.35rem;
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      outline: none;
    }
    .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    pre { background: #edf1f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
    th, td { border: 1px solid var(--border); padding: 0.45rem 0.75rem; text-align: left; }
    blockquote { border-left: 3px solid var(--accent); margin: 1rem 0; padding-left: 1rem; color: var(--muted); }
    .empty { color: var(--muted); }
    .not-found-panel {
      max-width: 760px;
      padding: clamp(1.4rem, 3vw, 2rem);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .not-found-path {
      display: block;
      margin: 1rem 0;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-soft);
      color: var(--muted);
      font: 0.82rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
    }
    .graph-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .graph-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      gap: 1rem;
      align-items: stretch;
    }
    .graph-layout.relations-collapsed { grid-template-columns: minmax(0, 1fr) 2.8rem; }
    .graph-page-expanded .hero { display: none; }
    .graph-page-expanded { padding-top: 1rem; padding-bottom: 1rem; }
    .graph-page-expanded .graph-legend {
      position: fixed;
      bottom: 1.1rem;
      left: var(--graph-legend-left, 1rem);
      z-index: 5;
      max-width: calc(100vw - var(--graph-legend-left, 1rem) - 1rem);
      margin: 0;
      padding: 0.35rem 0.85rem;
      background: color-mix(in srgb, var(--panel) 90%, transparent);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.78rem;
      gap: 0.55rem;
    }
    .graph-layout.graph-expanded { grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); }
    .graph-layout.graph-expanded.relations-collapsed { grid-template-columns: minmax(0, 1fr) 2.8rem; }
    .graph-layout.graph-expanded .graph-stage { height: calc(100vh - 9.5rem); max-height: none; }
    .graph-layout.graph-expanded .relation-panel { max-height: calc(100vh - 9.5rem); }
    .graph-stage { height: min(68vh, 720px); min-height: 440px; touch-action: none; }
    .graph-svg.is-panning { cursor: grabbing; }
    .graph-svg { display: block; width: 100%; height: 100%; background: radial-gradient(circle at 50% 50%, var(--panel-soft), transparent 68%); }
    .graph-link { stroke: var(--border); stroke-width: 1.2; opacity: 0.72; }
    .graph-link.is-connected { stroke: var(--accent); stroke-width: 2.2; opacity: 1; }
    .graph-link.is-hovered { stroke: #2f9e44; stroke-width: 3; opacity: 1; }
    .graph-node { cursor: grab; }
    .graph-node.is-dragging { cursor: grabbing; }
    .graph-node.is-dimmed { opacity: 0.25; }
    .graph-node circle { stroke: var(--panel); stroke-width: 2.5; }
    .graph-node text { fill: var(--text); font-size: 12px; font-weight: 680; paint-order: stroke; stroke: var(--panel); stroke-width: 4px; }
    .graph-node:hover circle { stroke: var(--accent); stroke-width: 3; }
    .graph-node.is-selected circle { stroke: var(--accent); stroke-width: 4; }
    .graph-node.is-hovered circle { stroke: #2f9e44; stroke-width: 4; }
    .graph-node.raw-source circle { fill: #d7663b; }
    .graph-node.wiki-source circle { fill: #0e7490; }
    .graph-node.wiki circle { fill: #c8a500; }
    .graph-node.template circle { fill: #7c3aed; }
    .graph-node.build-context circle { fill: #2563eb; }
    .graph-node.deliverable circle { fill: #6b7f2a; }
    .graph-node-secondary { fill: var(--muted) !important; font-size: 9px !important; font-weight: 520 !important; }
    .graph-link.cites { stroke-dasharray: 4 4; }
    .graph-link.generated_from,
    .graph-link.uses_template,
    .graph-link.uses_context { stroke: #64748b; }
    .graph-link.produces { stroke: #6b7f2a; }
    .graph-search-wrapper { padding: 0.65rem 0.75rem; }
    .graph-toolbar { display: flex; gap: 0.4rem; align-items: center; }
    .graph-search-field { position: relative; flex: 1 1 0; min-width: 0; }
    .graph-search-input { width: 100%; padding: 0.45rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; font-size: 0.9rem; box-sizing: border-box; }
    .graph-search-input:focus { outline: none; border-color: var(--accent); }
    .graph-search-dropdown { position: absolute; top: calc(100% + 2px); left: 0; right: 0; z-index: 10; list-style: none; margin: 0; padding: 0.3rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); box-shadow: var(--shadow); max-height: 240px; overflow: auto; }
    .graph-mode-group { display: inline-flex; gap: 0.2rem; padding: 0.16rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-soft); }
    .graph-mode-btn { min-height: 1.68rem; padding: 0 0.45rem; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font: inherit; font-size: 0.76rem; font-weight: 760; cursor: pointer; }
    .graph-mode-btn.is-active { background: var(--panel); color: var(--text); box-shadow: 0 0 0 1px var(--border); }
    .graph-ctrl-group { display: flex; gap: 0.25rem; flex: 0 0 auto; }
    .graph-ctrl-btn { width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--text); font: inherit; font-size: 1rem; font-weight: 760; cursor: pointer; padding: 0; line-height: 1; }
    .graph-ctrl-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
    .graph-search-result { display: grid; grid-template-columns: 0.65rem 1fr; grid-template-rows: auto auto; gap: 0 0.5rem; padding: 0.45rem 0.55rem; border-radius: 5px; cursor: pointer; align-items: center; }
    .graph-search-result:hover { background: var(--accent-soft); }
    .graph-search-result-dot { grid-row: 1 / 3; width: 0.65rem; height: 0.65rem; border-radius: 999px; background: var(--accent); align-self: center; }
    .graph-search-result-dot.raw-source { background: #d7663b; }
    .graph-search-result-dot.wiki-source { background: #0e7490; }
    .graph-search-result-dot.wiki { background: #c8a500; }
    .graph-search-result-dot.template { background: #7c3aed; }
    .graph-search-result-dot.build-context { background: #2563eb; }
    .graph-search-result-dot.deliverable { background: #6b7f2a; }
    .graph-search-result-title { font-size: 0.88rem; font-weight: 620; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-search-result-path { font-size: 0.76rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-search-empty { padding: 0.55rem 0.65rem; color: var(--muted); font-size: 0.88rem; }
    .graph-legend { display: flex; flex-wrap: wrap; gap: 0.65rem; margin: 0.75rem 0 1.25rem; color: var(--muted); font-size: 0.9rem; }
    .legend-item::before { content: ""; display: inline-block; width: 0.7rem; height: 0.7rem; margin-right: 0.35rem; border-radius: 999px; vertical-align: -0.05rem; background: var(--accent); }
    .legend-item.raw-source::before { background: #d7663b; }
    .legend-item.wiki-source::before { background: #0e7490; }
    .legend-item.wiki::before { background: #c8a500; }
    .legend-item.template::before { background: #7c3aed; }
    .legend-item.build-context::before { background: #2563eb; }
    .legend-item.deliverable::before { background: #6b7f2a; }
    .relation-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
      min-height: 440px;
      max-height: min(68vh, 720px);
      display: flex;
      flex-direction: column;
    }
    .graph-layout.relations-collapsed .relation-panel { min-width: 2.8rem; }
    .relation-panel-header {
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
    }
    .relation-panel-copy { min-width: 0; flex: 1; }
    .relation-toggle {
      flex: 0 0 auto;
      width: 1.9rem;
      height: 1.9rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      cursor: pointer;
      font: inherit;
      font-size: 1rem;
      line-height: 1;
    }
    .relation-toggle:hover { border-color: var(--accent); background: var(--accent-soft); }
    .graph-layout.relations-collapsed .relation-panel-header {
      height: auto;
      padding: 0.55rem 0.45rem;
      align-items: flex-start;
      justify-content: center;
      border-bottom: 0;
      writing-mode: vertical-rl;
    }
    .graph-layout.relations-collapsed .relation-panel-copy,
    .graph-layout.relations-collapsed .relation-list { display: none; }
    .graph-layout.relations-collapsed .relation-toggle {
      writing-mode: horizontal-tb;
      transform: rotate(90deg);
    }
    .relation-panel-title { margin: 0; font-size: 1rem; }
    .relation-panel-meta { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.82rem; }
    .relation-inspector { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.18rem 0.5rem; margin: 0.55rem 0 0; font-size: 0.76rem; }
    .relation-inspector dt { color: var(--muted); font-weight: 760; }
    .relation-inspector dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .relation-node-open {
      display: inline-flex;
      margin-top: 0.45rem;
      color: var(--link);
      font-size: 0.86rem;
      font-weight: 680;
      text-decoration: underline;
      text-underline-offset: 0.18em;
    }
    .relation-node-open[hidden] { display: none; }
    .relation-list { list-style: none; margin: 0; padding: 0.65rem; overflow: auto; display: grid; gap: 0.55rem; }
    .relation-item {
      padding: 0.7rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
    }
    .relation-item.is-active { border-color: var(--accent); background: var(--accent-soft); }
    .relation-item.is-hovered { border-color: #2f9e44; box-shadow: inset 3px 0 0 #2f9e44; }
    .relation-kind { display: inline-flex; margin-bottom: 0.42rem; padding: 0.08rem 0.38rem; border-radius: 999px; background: var(--panel-soft); color: var(--muted); font-size: 0.68rem; font-weight: 780; text-transform: uppercase; }
    .relation-group-label {
      margin: 0.35rem 0 0.15rem;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 760;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .relation-path { display: block; color: var(--text); font-size: 0.86rem; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-title { display: block; color: var(--text); font-size: 0.9rem; font-weight: 720; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-subpath { display: block; margin-top: 0.12rem; color: var(--muted); font-size: 0.74rem; line-height: 1.25; overflow-wrap: anywhere; }
    .relation-arrow { display: block; margin: 0.3rem 0; color: var(--muted); font-size: 1rem; text-align: center; line-height: 1; }
    .relation-open {
      margin-top: 0.55rem;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--link);
      font: inherit;
      font-size: 0.86rem;
      font-weight: 680;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 0.18em;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      background: rgba(10, 14, 18, 0.58);
    }
    .modal-backdrop.is-open { display: flex; }
    .relation-modal {
      width: min(1120px, 100%);
      max-height: min(86vh, 900px);
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .modal-title { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
    .modal-close {
      flex: 0 0 auto;
      width: 2rem;
      height: 2rem;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      font-weight: 680;
      cursor: pointer;
    }
    .modal-close:hover { border-color: var(--accent); background: var(--accent-soft); }
    .modal-body { min-height: 0; overflow: auto; }
    .modal-doc { min-width: 0; padding: 0.85rem 0.95rem; }
    .modal-doc-title { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.76rem; overflow-wrap: anywhere; }
    .modal-markdown { overflow-wrap: anywhere; font-size: 0.88rem; line-height: 1.45; }
    .modal-markdown h1, .modal-markdown h2, .modal-markdown h3 { line-height: 1.18; margin: 0.85rem 0 0.38rem; font-size: 1rem; }
    .modal-markdown h1:first-child, .modal-markdown h2:first-child, .modal-markdown h3:first-child { margin-top: 0; }
    .modal-markdown p, .modal-markdown ul, .modal-markdown ol { margin: 0.5rem 0; }
    .modal-markdown li { margin: 0.2rem 0; }
    .modal-markdown pre { white-space: pre-wrap; font-size: 0.78rem; line-height: 1.4; }
    @media (max-width: 760px) {
      .app-shell { display: block; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
      .wiki-main-resizer { display: none; }
      .content { padding: 1rem; }
      .topbar { display: block; }
      .index-layout { grid-template-columns: 1fr; }
      .index-aside { position: static; }
      .graph-layout { grid-template-columns: 1fr; }
      .log-flow { grid-template-columns: 1fr; }
      .log-arrow { display: none; }
    }
    @media (prefers-color-scheme: dark) {
      .sidebar, .wiki-main-resizer { background: #121820; }
      pre { background: #101419; }
    }
    :root.theme-light .sidebar, :root.theme-light .wiki-main-resizer { background: #fbfcfd; }
    :root.theme-light pre { background: #f4f6f8; }
    :root.theme-dark .sidebar, :root.theme-dark .wiki-main-resizer { background: #121820; }
    :root.theme-dark pre { background: #101419; }
    /* ── Dashboard stats ──────────────────────────────────────── */
    .ws-stats{display:flex;flex-wrap:wrap;gap:.65rem;margin-bottom:1.5rem}
    .ws-stat{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:88px;padding:.75rem 1rem;border:1px solid var(--border);border-radius:8px;background:var(--panel);text-align:center;gap:.2rem}
    .ws-stat-n{font-size:1.6rem;font-weight:800;line-height:1;color:var(--accent)}
    .ws-stat-l{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
    .ws-stat-warn .ws-stat-n{color:#c07000}
    .ws-stat-warn{border-color:rgba(192,112,0,.25)}
    .ws-stat-muted .ws-stat-n{font-size:.95rem;font-weight:700}
    /* ── Onboarding ───────────────────────────────────────────── */
    .onboarding{max-width:720px}
    .onboarding-steps{display:grid;gap:.75rem;margin-top:1.25rem}
    .onboarding-step{display:flex;gap:.9rem;align-items:flex-start;padding:.9rem 1rem;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
    .onboarding-step-num{width:2rem;height:2rem;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem;flex-shrink:0;margin-top:.1rem}
    .onboarding-step-body{min-width:0}
    .onboarding-step-title{font-weight:760;margin-bottom:.3rem}
    .onboarding-step-desc{font-size:.88rem;color:var(--muted);line-height:1.5}
    .onboarding-step-code{font-family:ui-monospace,monospace;font-size:.82rem;background:var(--panel-soft);border:1px solid var(--border);padding:.1rem .38rem;border-radius:4px;color:var(--text)}
    /* ── ⌘K Palette ──────────────────────────────────────────── */
    .palette-backdrop{position:fixed;inset:0;z-index:9000;display:none;align-items:flex-start;justify-content:center;padding-top:10vh;background:rgba(10,14,18,.42);backdrop-filter:blur(3px)}
    .palette-backdrop.is-open{display:flex}
    .palette{width:min(700px,calc(100vw - 2rem));border:1px solid var(--border);border-radius:14px;background:var(--panel);box-shadow:0 24px 64px rgba(0,0,0,.22),0 4px 12px rgba(0,0,0,.1);overflow:hidden;animation:paletteIn .13s ease}
    @keyframes paletteIn{from{opacity:0;transform:translateY(-10px) scale(.97)}to{opacity:1;transform:none}}
    .palette-head{display:flex;align-items:center;gap:.65rem;padding:1rem 1.2rem;border-bottom:1px solid var(--border)}
    .palette-search-icon{color:var(--muted);flex-shrink:0}
    .palette-input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font:inherit;font-size:1.05rem}
    .palette-input::placeholder{color:var(--muted)}
    .palette-esc{font-size:.72rem;font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.15rem .42rem;border-radius:4px;color:var(--muted)}
    .palette-results{max-height:min(58vh,480px);overflow-y:auto;padding:.5rem}
    .palette-item{display:flex;align-items:center;gap:.6rem;padding:.5rem .65rem;border-radius:7px;cursor:pointer;text-decoration:none;color:var(--text)}
    .palette-item.is-sel,.palette-item:hover{background:var(--accent-soft);color:var(--accent)}
    .palette-item-icon{width:1.9rem;height:1.9rem;border-radius:6px;background:var(--panel-soft);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0}
    .palette-item-body{min-width:0;flex:1}
    .palette-item-title{font-size:.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .palette-item-path{font-size:.73rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,monospace}
    .palette-item.is-sel .palette-item-path,.palette-item:hover .palette-item-path{opacity:.7;color:inherit}
    .palette-tag{font-size:.66rem;font-weight:700;padding:.1rem .38rem;border-radius:99px;flex-shrink:0}
    .palette-tag.wiki{background:rgba(200,165,0,.14);color:#9a7a00}
    .palette-tag.deliverables{background:rgba(107,127,42,.14);color:#5a6820}
    .palette-tag.templates{background:rgba(23,107,135,.14);color:var(--accent)}
    .palette-tag.build-context{background:rgba(120,80,200,.14);color:#6040b0}
    .palette-empty{padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.9rem}
    .palette-footer{display:flex;gap:1rem;padding:.5rem 1rem;border-top:1px solid var(--border);background:var(--bg)}
    .palette-hint{display:flex;align-items:center;gap:.38rem;font-size:.73rem;color:var(--muted)}
    .palette-hint kbd{font-family:ui-monospace,monospace;background:var(--panel-soft);border:1px solid var(--border);padding:.1rem .38rem;border-radius:4px;font-size:.7rem}
    @media(prefers-color-scheme:dark){.palette-tag.wiki{color:#d4a800}.palette-tag.deliverables{color:#9abc40}}
    /* ── TOC ──────────────────────────────────────────────────── */
    .doc-toc{position:fixed;top:5rem;right:1.5rem;width:200px;max-height:calc(100vh - 8rem);overflow-y:auto;display:flex;flex-direction:column;gap:.15rem;padding:.75rem;background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .doc-toc-title{font-size:.7rem;font-weight:780;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 .5rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)}
    .doc-toc-item{font-size:.8rem;color:var(--muted);text-decoration:none;line-height:1.35;padding:.18rem .3rem;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .doc-toc-item:hover,.doc-toc-item.is-active{color:var(--accent);background:var(--accent-soft)}
    .doc-toc-h3{padding-left:1rem;font-size:.76rem}
    @media(max-width:1280px){.doc-toc{display:none}}
    /* ── Stabilize tags ───────────────────────────────────────── */
    .section-tag{display:inline-flex;align-items:center;margin-left:.5rem;padding:.08rem .42rem;border:1px solid var(--border);border-radius:999px;background:var(--panel-soft);color:var(--muted);font-size:.58rem;font-weight:760;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5}
    .section-tag-modified{border-color:color-mix(in srgb,var(--accent) 35%,var(--border));color:var(--accent);background:var(--accent-soft)}
    .section-tag-inserted{border-color:color-mix(in srgb,#22c55e 35%,var(--border));color:#16a34a;background:rgba(34,197,94,.08)}
    .stabilize-badge{display:inline-flex;align-items:center;gap:.4rem;padding:.28rem .65rem;margin-bottom:1rem;border:1px solid var(--border);border-radius:6px;background:var(--panel-soft);color:var(--muted);font-size:.78rem}
    /* ── Print ─────────────────────────────────────────────────── */
    @media print{.sidebar,.page-actions,.palette-backdrop,.doc-toc{display:none!important}.app-shell{display:block}.content{padding:0}.article{border:none;border-radius:0;max-width:100%;box-shadow:none}body{font-size:11pt;line-height:1.5}.topbar{display:none}}
`;
