// The browser tab/window title, the favicon, the PWA manifest's name and its
// icon all name the same running workspace and must agree — this is the one
// place that derives them from env, so the wiki reader (`wikiHtml.ts`), the
// chat shell (`chatRoutes.ts`) and the manifest/icon routes (`serve.ts`)
// never compute a second, slightly different label.
import { escapeHtml } from '../../utils/html.ts';
import { WIKI_BG_LIGHT } from '../../chat/theme.ts';

const serveTitle = () => process.env.WIKI_SERVE_TITLE ?? null;
const serveLogo = () => process.env.WIKI_SERVE_LOGO ?? '🧠';
const workspaceNameFromEnv = () => process.env.WORKSPACE_NAME ?? null;

export function appDisplayName(fallback: string): string {
  return serveTitle() ?? workspaceNameFromEnv() ?? fallback;
}

function iconLabel(): string {
  return (serveLogo().trim() || appDisplayName('W')).slice(0, 2).toUpperCase();
}

// One 32x32 mark, vector, so the tab favicon, the taskbar/dock icon and the
// installed app window can all be the same file at any size the OS asks for.
export function appIconSvgMarkup(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#176b87"/><text x="16" y="22.5" font-size="17" font-family="system-ui,sans-serif" font-weight="900" text-anchor="middle" fill="white">${escapeHtml(iconLabel())}</text></svg>`;
}

export function appFaviconHref(): string {
  return `data:image/svg+xml,${encodeURIComponent(appIconSvgMarkup())}`;
}

export function buildWebManifest(displayName: string): Record<string, unknown> {
  const shortName = displayName.slice(0, 24) || 'Donna';
  return {
    name: `Donna — ${displayName}`,
    short_name: shortName,
    description: 'Donna — local-first workspace wiki and agent chat.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Chromium desktop reads display_override first and, when it supports
    // window-controls-overlay, launches straight into it (see the
    // `#wco-titlebar` CSS in chatStyles.ts). Every other engine (Safari,
    // Firefox, older Chromium) doesn't recognize the value and falls back to
    // `display` above — standalone, unchanged.
    display_override: ['window-controls-overlay', 'standalone'],
    background_color: WIKI_BG_LIGHT,
    theme_color: WIKI_BG_LIGHT,
    icons: [{ src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
