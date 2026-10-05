import path from 'node:path';
import { readFile, stat, realpath } from 'node:fs/promises';
import fg from 'fast-glob';
import { hashText } from '../utils/hash.ts';
import { safeWriteFile } from '../utils/fs.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import type { AppConfig } from '../types.ts';
import { outputSnapshot } from './outputGuard.ts';
import { publicationState } from './publications.ts';
import { knowledgeUnchanged, outputEditedSinceBuild } from './buildInputs.ts';
import { exportOutputPath } from '../services/exportService.ts';
import { pathExists } from '../utils/fs.ts';

export async function pendingSources(root: string, quietMs = 600_000) {
  let protectedPaths: string[] = []; let markerInvalid = false;
  try {
    const marker = JSON.parse(await readFile(path.join(root, '.wiki', 'cme-sync.json'), 'utf8'));
    if (!Array.isArray(marker.modifiedLocally)) throw new Error('invalid_marker');
    protectedPaths = marker.modifiedLocally.map(String);
  } catch (error) { markerInvalid = (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
  const files = await fg('**/*.md', { cwd: path.join(root, 'raw/untracked'), onlyFiles: true, followSymbolicLinks: false });
  const canonical = await realpath(root);
  const records = [];
  for (const file of files.sort()) {
    const relative = 'raw/untracked/' + file;
    const absolute = path.join(root, relative);
    if (!(await realpath(absolute)).startsWith(canonical + path.sep)) continue;
    const info = await stat(absolute);
    const content = await readFile(absolute, 'utf8');
    const protectedLocal = markerInvalid || protectedPaths.includes(file) || protectedPaths.includes(relative);
    records.push({ path: relative, hash: hashText(content), stable: quietMs <= 0 || Date.now() - info.mtimeMs >= quietMs,
      protected: protectedLocal, reason: markerInvalid ? 'sync_marker_invalid' : protectedLocal ? 'modified_locally' : null });
  }
  return records;
}
export async function validateMaintenanceSources(root: string, selection: Array<{path: string; hash: string}>, quietMs: number) {
  if (!selection.length) throw new Error('maintenance_empty_selection');
  const current = await pendingSources(root, quietMs);
  for (const expected of selection) {
    const actual = current.find((item) => item.path === expected.path);
    if (!actual || !actual.stable || actual.protected || actual.hash !== expected.hash) throw new Error(`maintenance_source_changed_or_protected: ${expected.path}`);
  }
}
export async function vectorInputHash(workspace: WorkspaceService) {
  const pages = [...await workspace.listWikiPages(), ...await workspace.listIngestedSourcePages()];
  return hashText(JSON.stringify(pages.sort((a,b) => a.relativePath.localeCompare(b.relativePath)).map((p) => [p.relativePath, hashText(p.content)])));
}
export async function recordVectorFreshness(workspace: WorkspaceService, config: AppConfig) {
  await safeWriteFile(path.join(workspace.paths.internalDir, 'vector-freshness.json'), JSON.stringify({ inputHash: await vectorInputHash(workspace), model: config.retrieval.vector.embeddingModel, at: new Date().toISOString() }));
}
export async function maintenanceState(config: AppConfig, quietMinutes = 10) {
  const workspace = new WorkspaceService(config);
  const root = workspace.paths.rootDir;
  const wikiPages = await workspace.listWikiPages();
  const wikiHash = await workspace.computeWikiHash(wikiPages);
  const legacyWikiHash = await workspace.computeLegacyWikiHash(wikiPages);
  const builds = await workspace.readBuildState();
  const sections = await workspace.readBuildContextSections();
  const global = workspace.composeBuildContext(sections);
  const deliverables = [];
  for (const file of await workspace.listTemplatePaths()) {
    const template = await workspace.readTemplateDocument(file);
    const context = workspace.resolveTemplateBuildContext(sections, template.frontmatter, global).context;
    const templateHash = await workspace.computeTemplateHash(template);
    const prior = builds.deliverables[template.relativePath];
    const content = await outputSnapshot(template.outputAbsolutePath);
    const reasons = [];
    if (!prior) reasons.push('build_not_tracked');
    if (content === null) reasons.push('output_missing');
    if (prior && prior.templateHash !== templateHash) reasons.push('template_changed');
    if (prior && !knowledgeUnchanged(prior.wikiHash, wikiHash, legacyWikiHash)) reasons.push('knowledge_changed');
    if (prior && prior.buildContextHash !== context.hash) reasons.push('context_changed');
    if (prior && content !== null && outputEditedSinceBuild(prior, content)) reasons.push('output_modified');
    // Which publications already exist: maintenance only keeps those current,
    // a first export or polish stays a human decision.
    const artifacts = {
      export: await pathExists(path.join(root, exportOutputPath(template.outputRelativePath))),
      polish: await pathExists(path.join(root, exportOutputPath(template.outputRelativePath, { polish: true }))),
    };
    deliverables.push({ template: template.relativePath, output: template.outputRelativePath, artifacts,
      // Whether a rebuild can tell hand-added sections apart (and keep them).
      handSectionsTracked: Array.isArray(prior?.producedSections),
      version: hashText(JSON.stringify([templateHash, wikiHash, context.hash, content])), fresh: !reasons.length, reasons });
  }
  let vectorFresh = !config.retrieval.vector.enabled;
  if (!vectorFresh) {
    try { const receipt = JSON.parse(await readFile(path.join(root, '.wiki/vector-freshness.json'), 'utf8')); vectorFresh = receipt.inputHash === await vectorInputHash(workspace) && receipt.model === config.retrieval.vector.embeddingModel; } catch { /* missing = repair required */ }
  }
  const publications = await publicationState(root, { language: config.language });
  const proposals = await fg('*.json', { cwd: path.join(root, '.wiki/agent-proposals') });
  return { schemaVersion: 1, observedAt: new Date().toISOString(), wikiHash,
    pending: await pendingSources(root, quietMinutes * 60_000), deliverables, publications,
    index: { enabled: config.retrieval.vector.enabled, fresh: vectorFresh }, proposals };
}
