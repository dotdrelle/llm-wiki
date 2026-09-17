import { z } from 'zod';
import matter from 'gray-matter';
import { buildSystemPreamble, type PromptContext } from '../prompts/systemPreamble.ts';
import { parseConceptPagePath } from './conceptGrid.ts';
import { readProvenance } from './provenance.ts';
import { carryForwardEngineFrontmatter } from '../okf/frontmatter.ts';
import type { LLMService } from '../services/llmService.ts';
import type { TraceLogger } from '../services/traceLogger.ts';
import type { WikiOperation, WikiPage } from '../types.ts';

/*
 The concept vocabulary is the LLM's responsibility, never a table in the code.

 The folder IS the concept. Nothing here knows that "produit" and "product" (or
 "solution-logicielle" and "solutions-externes") mean the same thing: that
 judgement is semantic, language-dependent and editorial, so it is asked of the
 model, on the live corpus, every time the vocabulary could have moved. A
 hand-maintained synonym map was tried and reverted — it was a second source of
 truth that aged silently, and it could not see a folder a sibling source had
 just created.

 This module owns ONE thing: given the concept folders that exist on disk and
 the folders a plan wants to open, ask the model for the single canonical
 folder each one belongs to, in the session language. The engine then rewrites
 the plan's paths and migrates the leaves. Equality (same string, accents/case
 aside) is the only mechanical shortcut, because it needs no judgement.
*/

export type ConceptFolderEntry = {
  folder: string;
  subjects: string[];
  tags: string[];
};

const MAX_SUBJECTS_PER_FOLDER = 12;
const MAX_TAGS_PER_FOLDER = 8;
const MAX_FOLDER_CHARS = 48;

/**
 * The mechanical slug a folder name must have: lowercase, ASCII, kebab-case.
 * This is a shape rule, not a synonym rule — it never decides that two names
 * are the same concept.
 */
export function normalizeConceptFolderName(value: unknown): string | null {
  const raw = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw || raw.length > MAX_FOLDER_CHARS) return null;
  return raw;
}

/**
 * Collects, per concept folder, a small sample of the subjects and tags it
 * holds — enough for the model to recognize that two folders cover the same
 * concept, without shipping the whole corpus into one prompt.
 */
export function collectConceptFolderEntries(pages: WikiPage[]): ConceptFolderEntry[] {
  const byFolder = new Map<string, { subjects: Set<string>; tags: Set<string> }>();
  for (const page of pages) {
    const folder = parseConceptPagePath(page.relativePath)?.class;
    if (!folder) continue;
    const entry = byFolder.get(folder) ?? { subjects: new Set<string>(), tags: new Set<string>() };
    const provenance = readProvenance(page.content);
    if (provenance.subject && entry.subjects.size < MAX_SUBJECTS_PER_FOLDER) {
      entry.subjects.add(provenance.subject);
    }
    for (const tag of provenance.tags) {
      if (entry.tags.size >= MAX_TAGS_PER_FOLDER) break;
      entry.tags.add(tag);
    }
    byFolder.set(folder, entry);
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, entry]) => ({
      folder,
      subjects: [...entry.subjects],
      tags: [...entry.tags],
    }));
}

export const conceptFolderReconcileSchema = z.object({
  folders: z
    .array(
      z.object({
        folder: z.string(),
        canonical: z.string(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
});

export type ConceptFolderReconcilePlan = z.infer<typeof conceptFolderReconcileSchema>;

export function buildConceptFolderReconcilePrompt(args: {
  entries: ConceptFolderEntry[];
  proposed: string[];
  ctx: PromptContext;
}): { system: string; user: string } {
  const lines: string[] = [
    'You are the guarantor of this wiki\'s concept vocabulary.',
    'A concept IS the folder a leaf lives in — a DOMAIN or cross-cutting THEME (security, sovereignty, cost, open-source, saas, integration…), never the KIND of a subject. One concept must have exactly ONE folder, however the subject is worded.',
    `Workspace language: ${args.ctx.language}. Every canonical folder name MUST be in that language.`,
    '',
    'ESTABLISHED concept folders — the vocabulary in force (with a sample of the subjects and tags they hold):',
  ];
  if (args.entries.length === 0) lines.push('(none yet)');
  for (const entry of args.entries) {
    const subjects = entry.subjects.length ? ` — subjects: ${entry.subjects.join(', ')}` : '';
    const tags = entry.tags.length ? ` — tags: ${entry.tags.join(', ')}` : '';
    lines.push(`- ${entry.folder}${subjects}${tags}`);
  }
  lines.push(
    '',
    'A plan proposes to open these NEW folders:',
  );
  if (args.proposed.length === 0) lines.push('(none)');
  for (const folder of args.proposed) lines.push(`- ${folder}`);
  lines.push(
    '',
    'The established folders are the reference: reuse them EXACTLY as written. Never rename one, never merge two of them.',
    'For EVERY proposed folder, name the established folder it duplicates, or its own name when it is a genuinely new concept.',
    '- Two proposed folders that cover the SAME concept must resolve to the same name.',
    '- When an established folder covers the SAME domain, reuse its exact name — even if its wording differs from the proposal.',
    '- When no established folder covers that domain, choose a short kebab-case common noun (singular) in the workspace language.',
    '- A concept is a DOMAIN or cross-cutting THEME, never a KIND: "produit"/"product", "fournisseur"/"vendor", "exigence"/"requirement", "dimension", "scenario", "projet"/"project", "outil"/"tool", "application", "solution" are kinds, not concepts.',
    '- An established KIND folder does NOT cover a proposed DOMAIN: a proposed "saas" or "souverainete" is a genuinely new concept even when an established "produit" or "solution" exists — keep it as its own folder.',
    '- Never invent a name that duplicates an established folder.',
    '',
    'Return strict JSON: { "folders": [ { "folder": "<proposed>", "canonical": "<chosen>", "reason": "<short>" } ] } with one entry per PROPOSED folder, and nothing else.',
  );
  return {
    system: [buildSystemPreamble(args.ctx), ...lines.slice(0, 4)].join('\n'),
    user: lines.join('\n'),
  };
}

/**
 * Resolves the LLM mapping into a fixpoint: `a -> b` and `b -> c` collapse to
 * `a -> c`, so a chain of renames cannot leave a leaf in a folder that is
 * itself being renamed away. Cycles fall back to identity for the members.
 */
function resolveCanonicalChains(mapping: Map<string, string>): Map<string, string> {
  const resolve = (start: string): string => {
    let current = start;
    const seen = new Set<string>();
    for (;;) {
      const next = mapping.get(current);
      if (next === undefined || next === current) return current;
      // A cycle is not a decision: keep the member where it is.
      if (seen.has(current)) return start;
      seen.add(current);
      current = next;
    }
  };
  return new Map([...mapping.keys()].map((start) => [start, resolve(start)]));
}

/**
 * The write operations that move every leaf of a non-canonical folder into its
 * canonical folder. A collision (two leaves that become the same
 * `concept/subject`) is merged through `carryForwardEngineFrontmatter`, so the
 * `sources` union survives; the body is the last leaf's, matching how an
 * ordinary re-ingest update behaves. Taxo leaves (`<concept>_<resume>.md`)
 * rename their concept prefix too.
 */
/**
 * Merges two leaves that become the same `concept/subject`: the engine-owned
 * frontmatter is unioned (`sources`, `verified`), and the two BODIES are
 * concatenated rather than one winning — a re-file is a filing decision, not a
 * reason to drop what one of the two pages documented.
 */
function mergeConceptLeaf(base: string, incoming: string): string {
  const baseParsed = matter(base);
  const incomingParsed = matter(incoming);
  const body = [baseParsed.content.trim(), incomingParsed.content.trim()]
    .filter(Boolean)
    .join('\n\n');
  const combined = matter.stringify(body, incomingParsed.data);
  return carryForwardEngineFrontmatter(base, combined);
}

export function conceptFolderMigrationOperations(
  pages: WikiPage[],
  mapping: Map<string, string>,
): WikiOperation[] {
  const contentByPath = new Map(pages.map((page) => [page.relativePath, page.content]));
  const byTarget = new Map<string, string>();
  const deletes: string[] = [];
  for (const page of pages) {
    const from = parseConceptPagePath(page.relativePath)?.class;
    if (!from) continue;
    const to = mapping.get(from);
    if (!to || to === from) continue;
    const base = page.relativePath.split('/').pop() ?? '';
    const rebased = base.startsWith(`${from}_`) ? `${to}_${base.slice(from.length + 1)}` : base;
    const target = `wiki/concepts/${to}/${rebased}`;
    if (target === page.relativePath) continue;
    // A leaf already at the target, or a sibling migrated earlier in this
    // pass, is merged with this one so nothing is overwritten.
    const prior = byTarget.get(target) ?? contentByPath.get(target) ?? null;
    byTarget.set(target, prior ? mergeConceptLeaf(prior, page.content) : page.content);
    deletes.push(page.relativePath);
  }
  return [
    ...[...byTarget.entries()].map(([target, content]) => ({
      type: 'update' as const,
      path: target,
      content,
    })),
    ...deletes.map((path) => ({ type: 'delete' as const, path })),
  ];
}

/**
 * Asks the model for the canonical folder of the NEW folders a plan proposes.
 *
 * The established folders are the anchor: a folder that already exists is never
 * renamed, never merged into another, and never a migration source. Left free
 * to re-decide them, the model dissolved `solution` into `produit` on one
 * ingest and moved every leaf of an established folder — and the next ingest
 * could move them again, because the vocabulary never settled. Only a proposed
 * folder that does NOT exist yet is arbitrated: it either joins an established
 * folder as a synonym, joins another proposed one, or stays a new folder. On an
 * unavailable or unusable answer the mapping is the identity — a failure to
 * reconcile must never move a leaf on a guess.
 */
export async function reconcileConceptFolders(args: {
  llm: Pick<LLMService, 'completeJson'>;
  entries: ConceptFolderEntry[];
  proposed: string[];
  ctx: PromptContext;
  logger: TraceLogger;
}): Promise<Map<string, string>> {
  const existing = [...new Set(args.entries.map((entry) => entry.folder).filter(Boolean))];
  const existingSet = new Set(existing);
  const arbitrable = [...new Set(
    args.proposed.filter((folder) => folder && !existingSet.has(folder)),
  )];
  const known = [...new Set([...existing, ...arbitrable])].sort();
  const identity = new Map(known.map((folder) => [folder, folder]));
  // Nothing new to arbitrate — every established folder keeps its name.
  if (arbitrable.length === 0 || known.length <= 1) return identity;

  const prompt = buildConceptFolderReconcilePrompt({
    entries: args.entries,
    proposed: arbitrable,
    ctx: args.ctx,
  });

  let plan: ConceptFolderReconcilePlan;
  try {
    plan = await args.llm.completeJson(
      {
        system: prompt.system,
        user: prompt.user,
        label: 'ingest_concept_folders',
        logger: args.logger,
      },
      conceptFolderReconcileSchema,
    );
  } catch (error) {
    await args.logger.warn('ingest:concept-folders-failed', {
      message: error instanceof Error ? error.message : String(error),
      folders: known,
    });
    return identity;
  }

  const raw = new Map<string, string>();
  const arbitrableSet = new Set(arbitrable);
  for (const decision of plan.folders ?? []) {
    const folder = normalizeConceptFolderName(decision.folder);
    const canonical = normalizeConceptFolderName(decision.canonical);
    if (!folder || !canonical) continue;
    // Only a PROPOSED folder can be re-filed: an established folder is never a
    // source, even when the plan also writes into it.
    if (!arbitrableSet.has(folder)) continue;
    raw.set(folder, canonical);
  }
  for (const folder of known) if (!raw.has(folder)) raw.set(folder, folder);
  return resolveCanonicalChains(raw);
}
