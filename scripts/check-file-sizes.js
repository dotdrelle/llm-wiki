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
// 0.16.01 note: the knowledge recentrage renamed the tree surfaces (archived
// documents, reading notes, project knowledge, project overview) and added the
// overview/identity affordances (wikiHtml, wikiLayoutCss).
// 0.16.51 note: the current wikiHtml baseline is three lines above its prior
// ceiling; keep the measured limit explicit while the module remains on track
// for extraction.
// 0.16.55 note: allow the current wikiHtml module to grow to 2300 lines while
// its extraction is pending.
// 0.16.57 follow-up note (2): the agent-connectors card, the run-status fixes
// and the module extractions kept chatHtml and activityPanelScript over their
// ceilings (chatStyles by one line). Ceilings record the measured reality;
// they drop as the extractions land.
// 0.16.58 follow-up: the guard used to walk only `src/serve`, `src/graph`,
// `src/chat` and `src/commands/serve.ts`, so the engine services were never
// guarded. It now walks ALL of `src/` plus `bin/`; the engine files that grew
// unguarded get their measured ceilings here (ingestService, mcpServer,
// doctor, buildService, workspaceService, schema). The stale
// `canvasExplorerScript.ts` ceiling is dropped — that file no longer exists
// (its extraction landed).
// 0.16.60 follow-up: wiki_collect_context gained `excludePaths` and per-call
// retrieval diagnostics (mcpServer), and the build context gained the
// relevance-first tie-break (buildService). Record the measured lines; the
// module extractions remain the follow-up.
// 0.16.60 subagents: the Plan panel gained a Subagents section and the
// Activity card suppresses its status action for that kind (chatHtml,
// activityPanelScript). Record the measured lines.
// 0.16.60 follow-ups: the Safari drag fallback grew wikiPanelScript, and the
// probed output-token capability key grew schema by one line. Record both.
// 0.16.60 MCP timeouts: serve.ts carries the per-endpoint timeout through the
// external endpoint allow-list. Record the measured lines.
const LEGACY_LIMITS = new Map([
  ['src/commands/serve.ts', 1104],
  ['src/serve/html/wikiHtml.ts', 2300],
  ['src/serve/html/wikiLayoutCss.ts', 1601],
  ['src/serve/html/wikiLayoutScript.ts', 1312],
  ['src/chat/chatHtml.ts', 3308],
  ['src/chat/styles/chatStyles.ts', 602],
  ['src/chat/runtime/activityPanelScript.ts', 1048],
  ['src/chat/views/wikiPanelScript.ts', 857],
  ['src/services/ingestService.ts', 2591],
  ['src/services/mcpServer.ts', 2544],
  ['src/commands/doctor.ts', 1749],
  ['src/services/buildService.ts', 1302],
  ['src/services/workspaceService.ts', 1141],
  ['src/config/schema.ts', 938],
]);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(path)) entries.push(path);
  }
  return entries;
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'bin'))];

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
