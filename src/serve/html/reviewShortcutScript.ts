export const REVIEW_SHORTCUT_SCRIPT = `
// The Agent proposals shortcut is a link, not a view tab, but it follows the
// same emphasis rule: highlighted exactly while its page is the one displayed.
// It used to keep only a hover/focus outline after a click — a half-state that
// looked selected beside the real active tab.
function markReviewShortcut(path) {
  const current = String(path || '');
  const active = current === 'agent-proposals' || current.startsWith('agent-proposals/');
  document.querySelectorAll('.side-view-review').forEach(function(link) {
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}
`;
