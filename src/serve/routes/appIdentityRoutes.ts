import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { appDisplayName, appIconSvgMarkup, buildWebManifest } from '../html/appIdentity.ts';

/*
 The two routes that make `serve` installable as a chromeless desktop app
 rather than a browser tab: the PWA manifest and the icon it points at.

 They live beside `appIdentity.ts` — the single place that derives the name,
 the mark and the manifest from the environment — so the tab title, the
 favicon, the taskbar/Dock icon and the installed window cannot drift apart.
*/
export type AppIdentityRoutesDeps = { rootDir: string };

// Long enough that a reload does not refetch, short enough that renaming the
// workspace shows up without clearing the browser's cache.
const IDENTITY_CACHE_CONTROL = 'public, max-age=3600';

export function handleAppIdentityRoutes(
  res: ServerResponse,
  urlPath: string,
  { rootDir }: AppIdentityRoutesDeps,
): boolean {
  if (urlPath === '/manifest.webmanifest') {
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': IDENTITY_CACHE_CONTROL,
    });
    res.end(JSON.stringify(buildWebManifest(appDisplayName(path.basename(rootDir)))));
    return true;
  }

  if (urlPath === '/assets/icon.svg') {
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': IDENTITY_CACHE_CONTROL,
    });
    res.end(appIconSvgMarkup());
    return true;
  }

  return false;
}
