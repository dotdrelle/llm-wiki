import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { safeWriteFile } from '../utils/fs.ts';
import { labelTerms } from '../utils/labelTerms.ts';
import { toPosix } from '../utils/path.ts';
import {
  CONCEPT_GRID_RELATIVE_PATH,
  MAX_GRID_CLASSES,
  MIN_GRID_CLASSES,
  parseConceptGrid,
} from './conceptGrid.ts';
import { isValidProvenanceValue, normalizeProvenanceValue } from './provenance.ts';
import { forbiddenLabelReason, labelShapeIssue } from '../graph/wiki/taxonomy/schema.ts';

/*
 The concepts pass: build the workspace's closed set of ranking classes.

 This is the one decision the consolidation could never make. Ingest sees one
 document at a time, so it can only name what that document names — hence a
 wiki of entity pages, one per product or per ticket, where a filing
 plan was needed. A filing plan is a statement about the WHOLE corpus, so it
 gets its own pass, run rarely and deliberately, over everything at once.

 Two choices here are worth their justification.

 INPUT IS THE RAW DOCUMENTS, not the source notes. Measured on a real corpus:
 a grid built from its 13 source notes recovered 13 of the 14 target classes but
 loses the one about roles and responsibilities, because the notes keep a single
 line of it — one note reads literally "Extracted facts: None". Building the
 grid on the notes would make it inherit the extraction's holes in silence,
 and the grid is the artefact everything else is checked against.

 DOCUMENTS ARE SENT AS OUTLINE + SAMPLED BODY, not in full. 13 raw documents
 are 232 KB — minutes of prefill on a local engine, for a task that does not
 need every sentence.

 The body is SAMPLED ACROSS the document, never taken from its opening. An
 exported page opens with a breadcrumb and a table of child links, which is the
 export tree restated in prose — the very thing R5 forbids the classes to
  mirror. Feeding it fed the defect: a local engine, given a corpus whose
  visible signal was its folder structure, answered with the folder structure.
 Paragraphs drawn from across the document say what it is ABOUT; its first
 lines say where it sits in a directory.
*/

/** How much body prose to send per document, gathered across the whole file. */
const BODY_CHARS = 900;
/** How many places in the document that prose is drawn from. */
const BODY_SAMPLES = 6;
/** How many headings of a document to send. Beyond this an outline is noise. */
const MAX_HEADINGS = 40;
/** A heading is a few words. Anything longer is a paragraph that wears a `#`. */
const MAX_HEADING_CHARS = 120;

/**
 * Whether a heading is really an inline table of contents.
 *
 * Confluence exports the page TOC as a single heading whose text is the entire
 * TOC — on a real corpus that is one ~2 700-character "heading" per document,
 * duplicating the outline that follows it and swallowing a large share of the
 * prompt. Left in, the biggest documents spend most of their budget restating
 * their own titles in anchor form.
 */
function isTableOfContents(text: string): boolean {
  return (text.match(/\]\(#/g) ?? []).length >= 2;
}
/** Bounded pool: an unbounded `Promise.all` would open one `readFile` per document. */
const READ_CONCURRENCY = 8;
/** Reject-and-retry, same discipline as the taxonomy synthesis. */
const MAX_ATTEMPTS = 3;
/** A label is a name, not a sentence. */
export const MAX_CLASS_LABEL_TERMS = 2;
/** Enough future documents to prove a class is a container, not a detail. */
export const MIN_CLASS_EXTENSIONS = 3;

export const RAW_DOCUMENT_PATTERNS = ['raw/ingested/**/*.md'];

export const conceptGridProposalSchema = z.object({
  classes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    covers: z.string(),
    criterion: z.string(),
    extensions: z.array(z.string()).default([]),
  })).min(1),
  assignments: z.record(z.string(), z.object({
    primary: z.string(),
    secondary: z.array(z.string()).default([]),
  })),
  outOfScope: z.array(z.string()).default([]),
});

export type ConceptGridProposal = z.infer<typeof conceptGridProposalSchema>;

export type DocumentBrief = {
  path: string;
  title: string;
  headings: string[];
  opening: string;
};

export async function listRawDocuments(rootDir: string): Promise<string[]> {
  const files = await fg(RAW_DOCUMENT_PATTERNS, {
    cwd: rootDir,
    dot: false,
    onlyFiles: true,
  });
  return files.map(toPosix).sort();
}

export async function readDocumentBriefs(
  rootDir: string,
  files: string[],
): Promise<DocumentBrief[]> {
  return mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
    const raw = await readFile(path.join(rootDir, file), 'utf8');
    return documentBrief(file, raw);
  });
}

export function documentBrief(file: string, raw: string): DocumentBrief {
  const lines = raw.split(/\r?\n/);
  const headings: string[] = [];
  const prose: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const text = heading[2]!;
      if (headings.length < MAX_HEADINGS && !isTableOfContents(text)) {
        headings.push(`${'  '.repeat(heading[1]!.length - 1)}${text.slice(0, MAX_HEADING_CHARS)}`);
      }
      continue;
    }
    if (line.trim()) prose.push(line.trim());
  }
  const title = headings[0]?.trim() || path.basename(file).replace(/\.md$/, '');
  return {
    path: file,
    title,
    headings,
    opening: sampleBody(prose),
  };
}

/**
 * Draws prose from across the document instead of from its head.
 *
 * `BODY_SAMPLES` evenly spaced windows, each cleaned of export furniture. The
 * first window still starts at the top — an author's first real paragraph is
 * usually their best statement of purpose — but it no longer gets the whole
 * budget, so a breadcrumb can never be the only thing the model sees.
 */
function sampleBody(prose: string[]): string {
  const usable = prose.map(cleanOpening).filter((line) => line.length > 20);
  if (!usable.length) return '';
  const perSample = Math.max(80, Math.floor(BODY_CHARS / BODY_SAMPLES));
  const step = Math.max(1, Math.floor(usable.length / BODY_SAMPLES));
  const parts: string[] = [];
  for (let i = 0; i < usable.length && parts.length < BODY_SAMPLES; i += step) {
    parts.push(usable[i]!.slice(0, perSample));
  }
  return parts.join(' … ').slice(0, BODY_CHARS);
}

/**
 * Strips the navigation furniture out of a document's opening.
 *
 * Measured on a real corpus: the opening of a root note is almost entirely
 * an Obsidian breadcrumb and a table of child links — percent-encoded URLs,
 * `<br/>`, pipes. That is the export tool talking, not the author, and it is
 * the single least informative text in the file. Sending it costs the budget
 * that the outline should be spending, and worse, it names other documents,
 * which invites the model to file this one by its neighbours.
 */
export function cleanOpening(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[|>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SYSTEM_TEMPLATE = [
  'You are an information architect. You are given every document of one corpus.',
  'You extract from it a reusable CONCEPTUAL GRID.',
  '',
  'A concept here is NOT a glossary entry and NOT a named thing. It is a FILING',
  'CLASS: a container meant to receive many documents, the ones that exist today',
  'and the ones that do not exist yet.',
  'A proper noun — one product, one supplier, one ticket, one person — is a',
  'SUBJECT, and a subject belongs IN a class, it is never a class itself. A class',
  'names the kind of question a set of documents answers, so its label is a common',
  'noun phrase that would still make sense if every proper noun in this corpus were',
  'replaced by another.',
  '',
  'CORPUS: {{N_DOCUMENTS}} documents. Language for every label and sentence: {{LANGUAGE}}.',
  '',
  'RULES:',
  'R1. Between {{MIN_CLASSES}} and {{MAX_CLASSES}} classes. ONE LEVEL: no nesting,',
  '    no sub-class, no family grouping several classes.',
  'R2. Labels of at most {{MAX_LABEL_TERMS}} terms. NON-OVERLAPPING: no term may be',
  '    reused from one label to another, and two classes never designate the same',
  '    perimeter.',
  'R3. GENERIC level. Elimination test: if you cannot name {{MIN_EXTENSIONS}}',
  '    plausible FUTURE documents for a class, it is too fine — merge it or raise it',
  '    one level. List those future documents in "extensions".',
  'R4. "criterion" is ONE closed question, answerable yes/no, that decides where to',
  '    file a new document without arbitration. It must end with a question mark.',
  'R5. Do NOT follow the folder tree: it reflects the history of the corpus, not its',
  '    structure of meaning. Look at what each document DOES and what question it',
  '    answers.',
  'R6. Keep the distinctions the corpus itself makes and a naive filing would erase:',
  '    two notions that look alike but involve different instructions, different',
  '    interlocutors or different calendars stay two classes.',
  'R7. COVERAGE: every document gets exactly one "primary" class. A document that',
  '    plainly belongs to no class goes in "outOfScope" — never forced into one.',
  '    "secondary" lists the other classes it also speaks to.',
  'R8. "assignments" keys are the DOCUMENT IDs listed below, copied VERBATIM.',
  '    Never invent, shorten or translate an id.',
  'R9. Every class must hold at least one document as primary.',
  '',
  'Return ONLY this JSON, nothing else:',
  '{"classes":[{"id":"kebab-case-id","label":"…","covers":"…","criterion":"… ?","extensions":["…","…","…"]}],',
  ' "assignments":{"<document id>":{"primary":"kebab-case-id","secondary":[]}},',
  ' "outOfScope":[]}',
].join('\n');

export function buildGridSystemPrompt(documentCount: number, language: string): string {
  return SYSTEM_TEMPLATE
    .replaceAll('{{N_DOCUMENTS}}', String(documentCount))
    .replaceAll('{{LANGUAGE}}', language)
    .replaceAll('{{MIN_CLASSES}}', String(MIN_GRID_CLASSES))
    .replaceAll('{{MAX_CLASSES}}', String(MAX_GRID_CLASSES))
    .replaceAll('{{MAX_LABEL_TERMS}}', String(MAX_CLASS_LABEL_TERMS))
    .replaceAll('{{MIN_EXTENSIONS}}', String(MIN_CLASS_EXTENSIONS));
}

export function buildGridUserPrompt(documents: DocumentBrief[]): string {
  return [
    `Documents (${documents.length}):`,
    '',
    ...documents.map((document, index) => [
      `## ${opaqueDocumentId(index)}`,
      document.opening || '(empty)',
      '',
    ].join('\n')),
  ].join('\n');
}

/**
 * The id a document wears in the grid prompt.
 *
 * The real path names the folder it came from — exactly the structure the
 * classes must NOT mirror — so the model is given an opaque id and only the
 * document's body. The id is mapped back to the real path after the proposal
 * comes back, so nothing downstream ever sees it.
 */
export function opaqueDocumentId(index: number): string {
  return `doc-${index + 1}`;
}

/**
 * Maps a proposal's document keys back from the opaque ids the model saw to the
 * real paths the rest of the chain works on. An id the model invented (never a
 * real path, never a shown id) passes through untouched, so `validateGridProposal`
 * still flags it as unknown rather than silently dropping it.
 */
export function translateGridProposal(
  proposal: ConceptGridProposal,
  idToPath: ReadonlyMap<string, string>,
): ConceptGridProposal {
  const translate = (key: string): string => idToPath.get(key) ?? key;
  return {
    ...proposal,
    assignments: Object.fromEntries(
      Object.entries(proposal.assignments).map(([key, value]) => [translate(key), value]),
    ),
    outOfScope: proposal.outOfScope.map(translate),
  };
}

/**
 * The retry prompt.
 *
 * Re-lists the ground truth — the document paths and the numeric rules — on
 * every attempt. Each call is a fresh, stateless completion: a retry carrying
 * only the list of violations asks the model to fix identity errors while blind
 * to the correct identities, which is exactly how the taxonomy's retry loop
 * used to fail before `buildRetryPrompt` was fixed.
 */
export function buildGridRetryPrompt(documents: DocumentBrief[], issues: string[]): string {
  return [
    'Your previous answer was rejected.',
    '',
    'Valid document ids — copy EXACTLY, do not invent:',
    ...documents.map((document, index) => `- ${opaqueDocumentId(index)}`),
    '',
    `Structure: ${MIN_GRID_CLASSES} to ${MAX_GRID_CLASSES} classes, one level,`,
    `labels of at most ${MAX_CLASS_LABEL_TERMS} terms sharing no term with each other,`,
    `a closed yes/no question per class, at least ${MIN_CLASS_EXTENSIONS} future documents per class,`,
    'every document assigned exactly once, every class holding at least one document.',
    '',
    'Fix EXACTLY these problems and return the complete JSON only:',
    ...issues.map((issue) => `- ${issue}`),
  ].join('\n');
}

/** Terms ignored when checking that two labels share no term. */
// `labelTerms` is shared with the derived taxonomy (see `utils/labelTerms.ts`),
// so the grid and the community non-overlap rules can never diverge again.
export { labelTerms } from '../utils/labelTerms.ts';

export type GridValidation = { issues: string[]; warnings: string[] };

/**
 * Deterministic check of a proposal.
 *
 * As in the taxonomy synthesis, it is this loop — not the prompt wording —
 * that guarantees a conformant grid. The split between `issues` (re-ask) and
 * `warnings` (publish, stay visible) is the same discipline as the
 * consolidation's: a structural violation blocks, a defensible imbalance is
 * reported. A class carried by a single document is the second kind: a class
 * can legitimately rest on one document today and hold five next quarter.
 */
/**
 * Classes that merely rename a folder of the corpus.
 *
 * R5 asks the model not to reproduce the export tree. Stated in the prompt, it
 * is a plea; a local engine given a corpus whose loudest signal is its folder
 * names answers with the folder names, and nothing catches it — a real run
 * published three classes that were, exactly, the three source directories
 * with their prefixes trimmed.
 *
 * That last detail is why this compares TOKENS, not identifiers. The classes
 * that run produced were `solution-externe`, `developpement-interne` and
 * `demande-fonctionnelle`, against folders named
 * `synthese-solutions-externes` and `synthese-option-developpement-interne`:
 * an exact match sees nothing, while "every significant word of the class
 * appears in one folder's name" catches all three. A trailing `s` is dropped
 * so a plural folder and a singular class still meet.
 *
 * It fires only when half the grid or more is mirrored: one class legitimately
 * carrying a folder's words is a coincidence worth allowing — a well-organised
 * corpus has folders that mean something — while half of them is the defect.
 */
function mirroredFolderClasses(
  proposal: ConceptGridProposal,
  documents: DocumentBrief[],
): string[] {
  const folderTokens: Set<string>[] = [];
  for (const document of documents) {
    for (const part of document.path.split('/').filter(Boolean)) {
      const tokens = significantTokens(part.replace(/\.md$/, ''));
      if (tokens.size) folderTokens.push(tokens);
    }
  }
  return proposal.classes
    .filter((entry) => {
      const tokens = [...significantTokens(entry.id)];
      if (!tokens.length) return false;
      return folderTokens.some((folder) => tokens.every((token) => folder.has(token)));
    })
    .map((entry) => entry.id);
}

/** Words of an identifier, singularized just enough for a plural folder to match. */
function significantTokens(value: string): Set<string> {
  return new Set(
    labelTerms(value)
      .filter((token) => token.length > 3)
      .map((token) => (token.endsWith('s') ? token.slice(0, -1) : token)),
  );
}

export function validateGridProposal(
  proposal: ConceptGridProposal,
  documents: DocumentBrief[],
): GridValidation {
  const issues: string[] = [];
  const warnings: string[] = [];
  const documentPaths = new Set(documents.map((document) => document.path));

  const mirrored = mirroredFolderClasses(proposal, documents);
  if (mirrored.length * 2 >= proposal.classes.length) {
    issues.push(
      `${mirrored.length} of ${proposal.classes.length} classes reproduce a folder of the corpus`
      + ` (${mirrored.join(', ')}) — the export tree records the history of the corpus,`
      + ' not its structure of meaning. Name what the documents are ABOUT.',
    );
  }

  if (proposal.classes.length < MIN_GRID_CLASSES) {
    issues.push(`too few classes: ${proposal.classes.length} < ${MIN_GRID_CLASSES}`);
  }
  if (proposal.classes.length > MAX_GRID_CLASSES) {
    issues.push(`too many classes: ${proposal.classes.length} > ${MAX_GRID_CLASSES}`);
  }

  const ids = new Set<string>();
  const termOwner = new Map<string, string>();
  for (const entry of proposal.classes) {
    const id = normalizeProvenanceValue(entry.id || entry.label);
    if (!id || !isValidProvenanceValue(id)) {
      issues.push(`class "${entry.id}" has no usable identifier`);
      continue;
    }
    if (ids.has(id)) {
      issues.push(`class "${id}" is declared twice`);
      continue;
    }
    ids.add(id);

    const shape = labelShapeIssue(entry.label);
    if (shape) issues.push(`invalid label "${entry.label}": ${shape}`);
    const forbidden = forbiddenLabelReason(entry.label);
    if (forbidden) issues.push(forbidden);

    const terms = labelTerms(entry.label);
    if (!terms.length) {
      issues.push(`class "${id}" has an empty label`);
    }
    if (terms.length > MAX_CLASS_LABEL_TERMS) {
      issues.push(
        `label "${entry.label}" has ${terms.length} terms, limit is ${MAX_CLASS_LABEL_TERMS}`,
      );
    }
    for (const term of terms) {
      const owner = termOwner.get(term);
      if (owner && owner !== id) {
        issues.push(`labels "${owner}" and "${id}" both use the term "${term}"`);
      }
      termOwner.set(term, id);
    }
    if (!entry.criterion.trim().endsWith('?')) {
      issues.push(`class "${id}" has no closed membership question (it must end with "?")`);
    }
    if (entry.extensions.filter((value) => value.trim()).length < MIN_CLASS_EXTENSIONS) {
      issues.push(
        `class "${id}" lists fewer than ${MIN_CLASS_EXTENSIONS} expected future documents`
        + ' — it is probably too fine to be a filing class',
      );
    }
  }

  const outOfScope = new Set(proposal.outOfScope);
  for (const at of outOfScope) {
    if (!documentPaths.has(at)) issues.push(`unknown document declared out of scope: ${at}`);
  }

  const primaryCount = new Map<string, number>();
  for (const [at, assignment] of Object.entries(proposal.assignments)) {
    if (!documentPaths.has(at)) {
      issues.push(`unknown document assigned: ${at}`);
      continue;
    }
    if (outOfScope.has(at)) {
      issues.push(`document "${at}" is both assigned and declared out of scope`);
    }
    const primary = normalizeProvenanceValue(assignment.primary);
    if (!ids.has(primary)) {
      issues.push(`document "${at}" assigned to unknown class "${assignment.primary}"`);
      continue;
    }
    primaryCount.set(primary, (primaryCount.get(primary) ?? 0) + 1);
    for (const raw of assignment.secondary) {
      const secondary = normalizeProvenanceValue(raw);
      if (!ids.has(secondary)) {
        issues.push(`document "${at}" names an unknown secondary class "${raw}"`);
      } else if (secondary === primary) {
        issues.push(`document "${at}" names "${primary}" as both primary and secondary`);
      }
    }
  }

  for (const document of documents) {
    if (!outOfScope.has(document.path) && !(document.path in proposal.assignments)) {
      issues.push(`unassigned document: ${document.path}`);
    }
  }

  for (const id of ids) {
    const count = primaryCount.get(id) ?? 0;
    if (count === 0) issues.push(`class "${id}" holds no document`);
    else if (count === 1) warnings.push(`class "${id}" rests on a single document`);
  }

  return { issues, warnings };
}

/** The grid as it is written to disk, and as `parseConceptGrid` reads it back. */
export function renderConceptGrid(
  proposal: ConceptGridProposal,
  documents: DocumentBrief[],
  meta: { language: string; warnings: string[] },
): string {
  const byPrimary = new Map<string, string[]>();
  for (const [at, assignment] of Object.entries(proposal.assignments)) {
    const primary = normalizeProvenanceValue(assignment.primary);
    byPrimary.set(primary, [...(byPrimary.get(primary) ?? []), at]);
  }

  const lines: string[] = [
    '# Conceptual grid',
    '',
    `Closed set of ranking classes for this workspace, synthesized over ${documents.length}`,
    'raw document(s). Every concept page is filed under exactly one of these classes.',
    '',
    'This file is the source of truth read by the ingest. It can be corrected by hand:',
    'the `class:` block below is what the engine reads, the rest is documentation.',
    '',
  ];

  for (const entry of proposal.classes) {
    const id = normalizeProvenanceValue(entry.id || entry.label);
    lines.push(
      `## ${entry.label}`,
      '',
      `**id.** \`${id}\``,
      `**Covers.** ${entry.covers.trim()}`,
      `**Membership criterion.** *${entry.criterion.trim()}*`,
      `**Documents.** ${(byPrimary.get(id) ?? []).join(' · ') || '(none yet)'}`,
      `**Expected extensions.** ${entry.extensions.filter(Boolean).join(' · ')}`,
      '',
    );
  }

  if (proposal.outOfScope.length) {
    lines.push('## Out of scope', '', ...proposal.outOfScope.map((at) => `- ${at}`), '');
  }
  if (meta.warnings.length) {
    lines.push('## Reservations', '', ...meta.warnings.map((warning) => `- ${warning}`), '');
  }

  lines.push(
    '## Controlled vocabulary',
    '',
    '```yaml',
    'class:',
    ...proposal.classes.map(
      (entry) => `  - ${normalizeProvenanceValue(entry.id || entry.label)}`,
    ),
    '```',
    '',
    '## Filing procedure',
    '',
    '1. Ask the membership criteria in order; the FIRST positive answer gives the',
    '   primary class.',
    '2. The following positive answers give the secondary classes.',
    '3. No positive answer means the document is out of scope — say so, never force it.',
    '4. If three consecutive documents hesitate between the same two classes, a class',
    '   is missing: propose it rather than forcing the filing.',
    '',
  );
  return lines.join('\n');
}

export type GridSynthesisOutcome =
  | { status: 'written'; classes: number; documents: number; warnings: string[]; added: string[]; removed: string[] }
  | { status: 'skipped'; reason: 'no_llm' | 'empty_corpus' }
  | { status: 'rejected'; issues: string[] };

export type GridSynthesisDeps = {
  /** Structured JSON completion of the configured LLM. Absent ⇒ nothing is attempted. */
  propose?: (request: { system: string; user: string }) => Promise<ConceptGridProposal>;
};

/**
 * Builds and writes the grid.
 *
 * Never merges with the existing grid: a grid is a whole, and a class silently
 * carried over from a previous corpus would be a class nobody decided for this
 * one. What the previous grid buys is a DIFF, reported to the caller — because
 * removing a class invalidates every page filed under it, and that must be
 * said out loud rather than discovered at the next ingest.
 */
export async function synthesizeConceptGrid(
  rootDir: string,
  options: { language: string },
  deps: GridSynthesisDeps,
): Promise<GridSynthesisOutcome> {
  if (!deps.propose) return { status: 'skipped', reason: 'no_llm' };
  const files = await listRawDocuments(rootDir);
  if (!files.length) return { status: 'skipped', reason: 'empty_corpus' };
  const documents = await readDocumentBriefs(rootDir, files);

  const system = buildGridSystemPrompt(documents.length, options.language);
  const idToPath = new Map(
    documents.map((document, index) => [opaqueDocumentId(index), document.path]),
  );
  let user = buildGridUserPrompt(documents);
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let proposal: ConceptGridProposal;
    try {
      proposal = await deps.propose({ system, user });
    } catch (error) {
      lastIssues = [`llm: ${error instanceof Error ? error.message : String(error)}`];
      user = buildGridRetryPrompt(documents, lastIssues);
      continue;
    }
    // The model answered under the opaque ids it was shown; validation and
    // rendering work on real paths.
    const translated = translateGridProposal(proposal, idToPath);
    const { issues, warnings } = validateGridProposal(translated, documents);
    if (!issues.length) {
      const previous = await readPreviousClasses(rootDir);
      const next = proposal.classes.map(
        (entry) => normalizeProvenanceValue(entry.id || entry.label),
      );
      await safeWriteFile(
        path.join(rootDir, CONCEPT_GRID_RELATIVE_PATH),
        renderConceptGrid(translated, documents, { language: options.language, warnings }),
      );
      return {
        status: 'written',
        classes: next.length,
        documents: documents.length,
        warnings,
        added: next.filter((id) => !previous.includes(id)),
        removed: previous.filter((id) => !next.includes(id)),
      };
    }
    lastIssues = issues;
    user = buildGridRetryPrompt(documents, issues);
  }
  return { status: 'rejected', issues: lastIssues };
}

async function readPreviousClasses(rootDir: string): Promise<string[]> {
  try {
    const content = await readFile(path.join(rootDir, CONCEPT_GRID_RELATIVE_PATH), 'utf8');
    const parsed = parseConceptGrid(content);
    return parsed.status === 'ok' ? [...parsed.grid.classes] : [];
  } catch {
    // No previous grid is the normal first run; an unreadable one is reported
    // by `readConceptGrid` at ingest time, not silently repaired here.
    return [];
  }
}
