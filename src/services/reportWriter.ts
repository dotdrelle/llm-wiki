import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import matter from 'gray-matter';

import { resolveInside, slugify } from '../utils/path.ts';

/**
 * Donna's reports — a summary asked for, an agent's long result — live in the
 * ingestion inbox, LOCKED: `raw/untracked/Donna/<date>-<title>.md.lock`.
 *
 * A long result pushed into the chat swelled the thread and every later model
 * context; kept here, the thread carries one sentence and a link, and the
 * report sits in Pending, greyed, out of every ingest (they all glob `*.md`),
 * readable, draggable as context, deletable. Unlocking it is the reader's
 * decision to make it a source.
 *
 * Its OKF front matter says what it is — `type: report`, `generated` by Donna,
 * `status: draft`, and the documents it was drawn from in `sources` — because
 * once unlocked and ingested, a model-written text becomes an archived
 * original: the header is what keeps it from passing for first-hand evidence.
 */
export const REPORTS_DIR = 'raw/untracked/Donna';
export const REPORT_LOCK_SUFFIX = '.md.lock';
const MAX_TITLE_CHARS = 160;
const MAX_SOURCES = 40;

export interface DonnaReportInput {
  title: string;
  content: string;
  sources?: string[];
  generatedBy?: string;
  now?: Date;
}

export interface DonnaReportResult {
  relativePath: string;
  absolutePath: string;
  bytes: number;
  title: string;
}

function reportFileStem(title: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const slug = slugify(title).slice(0, 60) || 'report';
  return `${date}-${slug}`;
}

export function donnaReportMarkdown(input: DonnaReportInput): string {
  const now = input.now ?? new Date();
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  const sources = (input.sources ?? [])
    .map((source) => String(source ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_SOURCES);
  const frontmatter: Record<string, unknown> = {
    type: 'report',
    title,
    generated: { by: input.generatedBy ?? 'donna', at: now.toISOString() },
    status: 'draft',
    ...(sources.length ? { sources } : {}),
  };
  const body = String(input.content ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  return matter.stringify(`${body}\n`, frontmatter);
}

/** Writes a new report; never overwrites one — a same-day homonym gets a suffix. */
export async function writeDonnaReport(rootDir: string, input: DonnaReportInput): Promise<DonnaReportResult> {
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('A report needs a title.');
  if (!String(input.content ?? '').trim()) throw new Error('A report needs content.');
  const now = input.now ?? new Date();
  const dir = resolveInside(rootDir, REPORTS_DIR);
  await mkdir(dir, { recursive: true });
  const markdown = donnaReportMarkdown({ ...input, title, now });
  const stem = reportFileStem(title, now);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const fileName = `${stem}${attempt ? `-${attempt + 1}` : ''}${REPORT_LOCK_SUFFIX}`;
    const absolutePath = path.join(dir, fileName);
    try {
      await writeFile(absolutePath, markdown, { encoding: 'utf8', flag: 'wx' });
      return {
        relativePath: `${REPORTS_DIR}/${fileName}`,
        absolutePath,
        bytes: Buffer.byteLength(markdown, 'utf8'),
        title,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Too many reports named "${title}" today.`);
}
