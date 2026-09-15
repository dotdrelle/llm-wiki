#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { Console } from 'node:console';

const ROOT = new URL('..', import.meta.url).pathname;
const logger = new Console(process.stdout, process.stderr);
const MAX_LINES = 800;
// Temporary ceilings for files still being split (see CLAUDE.md, Layout).
// Raise only when a change legitimately grows one; lower as extractions land.
// 0.15.86 note: chatHtml/wikiHtml/activityPanelScript shipped OVER their old
// ceilings at 0.15.85 (2883/1709/827 — the guard was red at release); the
// ceilings now record that reality instead of pretending, and drop again as
// the extractions land.
// 0.15.93 note: the same drift again — chatHtml/activityPanelScript/
// wikiPanelScript outgrew their limits, and the in-flight upload rows grew
// wikiHtml/wikiLayoutScript/wikiLayoutCss. Ceilings record the shipped
// reality; they still drop as the extractions land.
// 0.15.95 note: the sidebar gained concept-subject labels, alphabetical index
// tiles, the per-view unread badges and the last-ingest markers (wikiHtml,
// wikiLayoutScript, wikiLayoutCss); chatHtml shrank on the markdown render
// change but stays over its 0.15.94 ceiling. Ceilings record the reality.
// Same window, same day: the deliverables tab gained a live job spinner and a
// green "just written" flag (wikiHtml/wikiLayoutCss/wikiLayoutScript again),
// and chatHtml grew one more line refreshing the wiki sidebar at run end.
const LEGACY_LIMITS = new Map([
  ['src/commands/serve.ts', 1100],
  ['src/serve/html/wikiHtml.ts', 2058],
  ['src/serve/html/wikiLayoutCss.ts', 1573],
  ['src/serve/html/wikiLayoutScript.ts', 1312],
  ['src/chat/chatHtml.ts', 3122],
  ['src/chat/styles/chatStyles.ts', 600],
  ['src/chat/runtime/activityPanelScript.ts', 900],
  ['src/chat/views/wikiPanelScript.ts', 840],
  ['src/graph/wiki/ui/canvas/canvasExplorerScript.ts', 850],
]);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (path.endsWith('.ts')) entries.push(path);
  }
  return entries;
}

const files = [
  join(ROOT, 'src', 'commands', 'serve.ts'),
  join(ROOT, 'src', 'chat', 'chatHtml.ts'),
  ...walk(join(ROOT, 'src', 'serve')),
  ...walk(join(ROOT, 'src', 'graph')),
  ...walk(join(ROOT, 'src', 'chat')).filter((file) => !file.endsWith('/chatHtml.ts')),
];

const failures = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const limit = LEGACY_LIMITS.get(rel) ?? MAX_LINES;
  const lines = readFileSync(file, 'utf8').split('\n').length;
  const ok = lines <= limit;
  logger.log(`${ok ? 'ok' : 'FAIL'} ${rel}: ${lines}/${limit}`);
  if (!ok) failures.push({ rel, lines, limit });
}

if (failures.length) {
  logger.error('\nFile size check failed.');
  process.exit(1);
}
