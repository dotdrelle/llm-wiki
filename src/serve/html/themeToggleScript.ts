import { WIKI_BG_DARK, WIKI_BG_LIGHT } from '../../chat/theme.ts';

/*
 Light/dark selection for the wiki browser: the class on <html>, the toggle's
 own glyph, the `theme-color` meta the OS reads for the installed app window's
 title bar, and the persisted choice.

 Its own module, and its own IIFE, because it shares nothing with the sidebar
 state below it — and because it must run as early as possible: the class lands
 before first paint, so a dark reader never sees a white flash.

 The cross-tab `storage` listener is what keeps the split view honest: the wiki
 renders in an iframe beside the chat shell, so two documents hold the same
 preference and a toggle in one must reach the other. It re-applies with
 `persist = false` — writing back would bounce the event between the tabs.
*/
export const THEME_TOGGLE_SCRIPT = `
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
    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) themeColorMeta.content = selected === 'dark' ? '${WIKI_BG_DARK}' : '${WIKI_BG_LIGHT}';
    if (persist) localStorage.setItem(THEME_KEY, selected);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || localStorage.getItem('llm-wiki:graph:theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeToggle?.addEventListener('click', () => applyTheme(document.documentElement.classList.contains('theme-dark') ? 'light' : 'dark'));
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY && event.newValue) applyTheme(event.newValue, false);
  });
})();
`;
