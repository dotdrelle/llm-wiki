import { readFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pathExists, safeWriteFile } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';
import { applyProvenance, readProvenance } from '../ingest/provenance.ts';
import {
  conceptPagePath,
  readConceptGrid,
  UNCLASSIFIED_CLASS,
  type ConceptGrid,
} from '../ingest/conceptGrid.ts';
import { rewriteWikiLinks } from './wikiLinkRewrite.ts';
import type { WorkspaceService } from './workspaceService.ts';

/*
 Reclassifies concept pages filed under `unclassified` against the workspace's
 CURRENT grid.

 A page lands there for one reason only: it was ingested while no grid existed
 (or its subject genuinely fit no class at the time). Re-ingesting its source
 does not fix this reliably — the consolidation prompt tells the model to
 update an existing leaf AT ITS EXISTING PATH, so it can just keep refreshing
 the unclassified copy instead of moving it. This pass is deterministic where
 that one is not: it reads the page ONCE, asks a single closed question
 (which class of the CURRENT grid, if any), and — on a positive answer — moves
 the file and rewrites the two frontmatter fields the move changes. Nothing
 here re-extracts or rewrites the leaf's own content.
*/

const EXCERPT_CHARS = 1200;
const MAX_ATTEMPTS = 3;

export type UnclassifiedPage = {
  path: string;
  subject: string;
  excerpt: string;
};

export type ReclassifyMove = { path: string; subject: string; to: string; class: string };
export type ReclassifySkip = { path: string; subject: string; reason: string };
export type ReclassifyPlan = { moves: ReclassifyMove[]; skipped: ReclassifySkip[] };

export type ReclassifyDeps = {
  /** Structured JSON completion of the configured LLM. Absent ⇒ nothing is attempted. */
  propose?: (request: { system: string; user: string }) => Promise<ReclassifyProposal>;
};

export const reclassifyProposalSchema = z.object({
  /** page path -> class id from the grid, or the reserved unclassified id */
  assignments: z.record(z.string(), z.string()),
});
export type ReclassifyProposal = z.infer<typeof reclassifyProposalSchema>;

export type ReclassifyOutcome =
  | { status: 'reclassified'; plan: ReclassifyPlan }
  | { status: 'skipped'; reason: 'no_llm' | 'no_grid' | 'nothing_to_reclassify' }
  | { status: 'rejected'; issues: string[] };

export async function listUnclassifiedPages(workspace: WorkspaceService, grid: ConceptGrid): Promise<UnclassifiedPage[]> {
  const pages = await workspace.listWikiPages();
  const result: UnclassifiedPage[] = [];
  const conceptsPrefix = 'wiki/concepts/';
  for (const page of pages) {
    if (!page.relativePath.startsWith(conceptsPrefix)) continue;
    const provenance = readProvenance(page.content);
    if (!provenance.subject) continue;
    // Needs reclassification either way: literally filed under the reserved
    // `unclassified/` class, OR filed under a class the CURRENT grid no
    // longer declares. The second case is not a corner case — `wiki concepts
    // --apply` rebuilding the grid with a different vocabulary (a renamed or
    // dropped class) orphans every page filed under the old one, and nothing
    // else ever re-files them: they are not under `unclassified/` so a
    // path-only scan misses them, and re-ingesting the source updates the
    // leaf at its EXISTING path instead of moving it. `grid.set` never
    // contains the reserved unclassified id, so this one check covers both.
    if (provenance.class && grid.set.has(provenance.class)) continue;
    // Frontmatter stripped, same excerpt discipline as the taxonomy briefs:
    // enough to judge the membership question, not the whole page. Citations
    // are stripped BEFORE truncating, not after: a real leaf repeats its
    // `[src: raw/ingested/…]` path on nearly every bullet (measured: 174
    // characters, longer than most of the sentences it follows), so a plain
    // character-count slice spent most of EXCERPT_CHARS on repeated citation
    // paths and never reached the sections further down the page — the ones
    // that made the membership question answerable.
    const body = page.content
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      .replace(/\s*\[src:[^\]]*\]/gi, '')
      .trim();
    result.push({ path: page.relativePath, subject: provenance.subject, excerpt: body.slice(0, EXCERPT_CHARS) });
  }
  return result;
}

export function buildReclassifySystemPrompt(language: string): string {
  return [
    'You FILE existing wiki pages into a CLOSED set of ranking classes — you do',
    'not judge quality or rewrite anything, only decide where each page belongs.',
    `Answer in ${language} is not required: class ids are copied verbatim from`,
    'the list below, never translated or invented.',
    '',
    'For each page, ask the membership questions IN ORDER; the FIRST class whose',
    `question gets a positive answer is the page's class. If none apply, answer`,
    `the reserved id "${UNCLASSIFIED_CLASS}" — never force a page into the`,
    'nearest class.',
    '',
    'Return ONLY this JSON, nothing else:',
    '{"assignments":{"<page path>":"<class id>"}}',
    'One entry per page listed below, using its path VERBATIM as the key.',
  ].join('\n');
}

function describeClass(grid: ConceptGrid, id: string): string {
  const info = grid.info?.get(id);
  if (!info) return `- \`${id}\``;
  return `- \`${id}\` — ${info.label}${info.criterion ? ` · ${info.criterion}` : ''}`;
}

export function buildReclassifyUserPrompt(pages: UnclassifiedPage[], grid: ConceptGrid): string {
  const lines = ['Classes, in question order:', ...grid.classes.map((id) => describeClass(grid, id)), '', 'Pages:'];
  for (const page of pages) {
    lines.push(`### ${page.path}`, page.excerpt || '(empty)', '');
  }
  return lines.join('\n');
}

export function buildReclassifyRetryPrompt(pages: UnclassifiedPage[], grid: ConceptGrid, issues: string[]): string {
  return [
    'Your previous answer was rejected.',
    '',
    'Valid page paths — copy EXACTLY:',
    ...pages.map((page) => `- ${page.path}`),
    '',
    `Valid class ids — copy EXACTLY, or "${UNCLASSIFIED_CLASS}":`,
    ...grid.classes.map((id) => `- ${id}`),
    '',
    'Fix EXACTLY these problems and return the complete JSON only:',
    ...issues.map((issue) => `- ${issue}`),
  ].join('\n');
}

export function validateReclassifyProposal(
  proposal: ReclassifyProposal,
  pages: UnclassifiedPage[],
  grid: ConceptGrid,
): string[] {
  const issues: string[] = [];
  const pagePaths = new Set(pages.map((page) => page.path));
  const known = (value: string) => value === UNCLASSIFIED_CLASS || grid.set.has(value);

  for (const [pagePath, classId] of Object.entries(proposal.assignments)) {
    if (!pagePaths.has(pagePath)) issues.push(`unknown page: ${pagePath}`);
    if (!known(classId)) issues.push(`page "${pagePath}" assigned to unknown class "${classId}"`);
  }
  for (const page of pages) {
    if (!(page.path in proposal.assignments)) issues.push(`page not assigned: ${page.path}`);
  }
  return issues;
}

/**
 * Turns a validated proposal into a plan, and checks the three things the
 * proposal itself cannot know: whether the target path is already taken by
 * another leaf, whether two pages IN THIS SAME BATCH were assigned the same
 * target, and whether the answer actually changes anything.
 */
async function buildPlan(
  workspace: WorkspaceService,
  pages: UnclassifiedPage[],
  proposal: ReclassifyProposal,
): Promise<ReclassifyPlan> {
  const moves: ReclassifyMove[] = [];
  const skipped: ReclassifySkip[] = [];
  // Two distinct pages sharing a `subject` (the still-open concept-homonym
  // case) can be assigned the same class, producing the identical target
  // path. Checking `pathExists` alone misses this: neither target exists on
  // disk yet when each is checked, so both would be queued, and applying them
  // in sequence would silently overwrite the first page's freshly-written
  // content with the second's, after already deleting the first's source.
  const claimedTargets = new Set<string>();
  for (const page of pages) {
    const classId = proposal.assignments[page.path]!;
    if (classId === UNCLASSIFIED_CLASS) {
      skipped.push({ path: page.path, subject: page.subject, reason: 'no class fits' });
      continue;
    }
    const target = conceptPagePath(classId, page.subject);
    if (claimedTargets.has(target)) {
      skipped.push({ path: page.path, subject: page.subject, reason: `target already claimed by another page in this batch: ${target}` });
      continue;
    }
    if (await pathExists(resolveInside(workspace.paths.rootDir, target))) {
      skipped.push({ path: page.path, subject: page.subject, reason: `target exists: ${target}` });
      continue;
    }
    claimedTargets.add(target);
    moves.push({ path: page.path, subject: page.subject, to: target, class: classId });
  }
  return { moves, skipped };
}

async function applyPlan(workspace: WorkspaceService, plan: ReclassifyPlan): Promise<void> {
  for (const move of plan.moves) {
    const source = resolveInside(workspace.paths.rootDir, move.path);
    const target = resolveInside(workspace.paths.rootDir, move.to);
    const content = await readFile(source, 'utf8');
    const rewritten = applyProvenance(content, {
      subject: null,
      collection: null,
      scope: null,
      kind: null,
      class: move.class,
      classSecondary: [],
    });
    // Write-then-delete, not rename: the target's content differs from the
    // source's (the `class` field changed), so a plain rename would overwrite
    // the just-written target with the source's stale bytes.
    await mkdir(path.dirname(target), { recursive: true });
    await safeWriteFile(target, rewritten);
    await unlink(source);
  }
  await rewriteWikiLinks(workspace, plan.moves.map((move) => ({ source: move.path, target: move.to })));
}

export async function reclassifyConcepts(
  workspace: WorkspaceService,
  options: { language: string },
  deps: ReclassifyDeps,
): Promise<ReclassifyOutcome> {
  const gridRead = await readConceptGrid(workspace.paths.rootDir);
  if (gridRead.status !== 'ok') return { status: 'skipped', reason: 'no_grid' };

  const pages = await listUnclassifiedPages(workspace, gridRead.grid);
  if (!pages.length) return { status: 'skipped', reason: 'nothing_to_reclassify' };
  if (!deps.propose) return { status: 'skipped', reason: 'no_llm' };

  const grid = gridRead.grid;
  const system = buildReclassifySystemPrompt(options.language);
  let proposal: ReclassifyProposal | null = null;
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let parsed: ReclassifyProposal;
    try {
      const answer = await deps.propose({
        system,
        user: attempt === 0 ? buildReclassifyUserPrompt(pages, grid) : buildReclassifyRetryPrompt(pages, grid, lastIssues),
      });
      parsed = reclassifyProposalSchema.parse(answer);
    } catch (error) {
      lastIssues = [`llm: ${error instanceof Error ? error.message : String(error)}`];
      continue;
    }
    const issues = validateReclassifyProposal(parsed, pages, grid);
    if (issues.length === 0) {
      proposal = parsed;
      break;
    }
    lastIssues = issues;
  }
  if (!proposal) return { status: 'rejected', issues: lastIssues };

  const plan = await buildPlan(workspace, pages, proposal);
  await applyPlan(workspace, plan);
  return { status: 'reclassified', plan };
}
