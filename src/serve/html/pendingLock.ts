import { PENDING_LOCK_SUFFIX } from '../tree/treeMutations.ts';

/**
 * The Pending panel's lock: `a.md` ⇄ `a.md.lock` (`setSourceLock`). Every
 * ingest path globs `*.md`, so a locked source is skipped by Donna, headless
 * runs and maintenance without any of them knowing about locks; the panel
 * still lists it, greyed and outside its count, so the reader can unlock it.
 */

// Same stroke family as the other sidebar glyphs: closed = excluded from
// ingestion, open = will be ingested.
const LOCK_CLOSED_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const LOCK_OPEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.75-1.4"/></svg>';

/** What the Pending panel lists: the sources, and the locked ones beside them. */
export const PENDING_SOURCE_GLOBS = ['raw/untracked/**/*.md', `raw/untracked/**/*.md${PENDING_LOCK_SUFFIX}`];

export function isLockedSource(file: string): boolean {
  return file.endsWith(PENDING_LOCK_SUFFIX);
}

/** The source's own name, without the lock suffix. */
export function unlockedSourceName(file: string): string {
  return isLockedSource(file) ? file.slice(0, -PENDING_LOCK_SUFFIX.length) : file;
}

/** Lock toggle, placed just before the delete cross. `safePath` is escaped. */
export function pendingLockButton(safePath: string, locked: boolean): string {
  return locked
    ? `<button class="side-tree-lock is-locked" type="button" title="Locked — excluded from ingestion. Click to unlock" aria-label="Unlock ${safePath}" data-tree-lock="${safePath}" data-locked="1">${LOCK_CLOSED_ICON}</button>`
    : `<button class="side-tree-lock" type="button" title="Lock — exclude from ingestion" aria-label="Lock ${safePath}" data-tree-lock="${safePath}" data-locked="0">${LOCK_OPEN_ICON}</button>`;
}

/**
 * A locked row stays a link — a locked source is still read — greyed, and
 * outside the unread count (no `data-pending-at`). Draggable and deletable.
 * `safeHref` is already escaped.
 */
export function lockedPendingRow(safePath: string, safeHref: string, safeTitle: string, deleteButton: string): string {
  return `<div class="side-untracked-item side-untracked-locked" draggable="true" data-tree-drag="${safePath}" data-tree-kind="file"><a class="side-untracked-link" href="${safeHref}" title="${safePath} — locked, excluded from ingestion" data-side-path="${safePath}">${safeTitle}</a>${pendingLockButton(safePath, true)}${deleteButton}</div>`;
}

// Open on hover like the delete cross, closed and always visible once locked;
// a locked row is muted and its status dot greyed.
export const PENDING_LOCK_CSS = `
    .side-tree-lock {
      flex: 0 0 auto;
      width: 1.35rem;
      height: 1.35rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 5px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      opacity: 0;
    }
    .side-tree-lock svg { width: 0.8rem; height: 0.8rem; }
    .side-tree-lock:hover { border-color: var(--border); color: var(--accent); }
    :hover > .side-tree-lock, .side-tree-lock:focus-visible, .side-tree-lock.is-locked { opacity: 1; }
    .side-tree-lock.is-locked { color: #f59e0b; }
    .side-untracked-item.side-untracked-locked .side-untracked-link { color: var(--muted); font-style: italic; }
    .side-untracked-item.side-untracked-locked .side-untracked-link::before { background: var(--muted); opacity: 0.5; }
`;
