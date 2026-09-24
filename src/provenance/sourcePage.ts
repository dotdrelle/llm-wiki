import matter from 'gray-matter';
import { splitMarkdownSections } from '../utils/markdown.ts';
import { extractBodyCitations } from './derive.ts';

/*
 * Lot 2 of `plan-provenance-feuilles.md`: the source page is the harmonized,
 * weakly-interpretive reading sheet of ONE document. This module holds the
 * deterministic half — the template and the contract validation. The writer
 * prompt that produces the prose is wired at the ingest step, not here.
 *
 * Deterministic and therefore enforceable: one document per page, `subject`
 * names the document, and every factual section is backed by an ANCHORED
 * citation to that same archive.
 */

export const SOURCE_PAGE_TEMPLATE = [
  '---',
  'title: <titre du document>',
  'subject: <identite-du-document>',
  'type: source',
  'sources:',
  '  - path: raw/ingested/.../<document>.md',
  '---',
  '',
  '# <titre du document>',
  '',
  '## Résumé',
  '',
  '<portée du document, courte>',
  '',
  '## <thème réellement présent>',
  '',
  '<lecture fidèle ; chiffres, dates et réserves exacts>',
  '',
  '[src: raw/ingested/.../<document>.md#<adresse précise>]',
].join('\n');

/** A `Résumé` section is kept as a section under the document title. */
const SUMMARY_HEADING = /^(r[ée]sum[ée]|summary)$/i;
/** The taxo pipeline's placeholder H1 — replaced outright by the title. */
const PLACEHOLDER_HEADING = /^source note$/i;

function isStructuralTitle(value: string): boolean {
  return SUMMARY_HEADING.test(value.trim()) || PLACEHOLDER_HEADING.test(value.trim());
}

/**
 * Seeds the source note's displayed title from the ingested document's title.
 *
 * The writer prompt opens the source note on a `## Résumé`, which
 * `normalizeGeneratedMarkdown` promotes to the page's first H1; the tree, the
 * graph and the wiki index all read that H1, so every source note read
 * "Résumé" whatever document it described. The document's real title is known
 * at ingest time, so the engine writes it: frontmatter `title` and body H1 both
 * carry it, and a structural summary heading is demoted to a section under it
 * (the taxo placeholder `# Source note` is dropped). A true, non-structural H1
 * the model chose as the page title is left in place; only the frontmatter is
 * completed. Idempotent.
 */
export function stampSourcePageTitle(content: string, title: string): string {
  const wanted = (title ?? '').trim();
  if (!wanted) return content;
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };
  const existingTitle = typeof data.title === 'string' ? data.title.trim() : '';
  if (!existingTitle || isStructuralTitle(existingTitle)) {
    data.title = wanted;
  }

  const source = parsed.content.replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  let inFence = false;
  let firstIndex = -1;
  let firstMarks = '';
  let firstText = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^`{3,}/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      firstIndex = index;
      firstMarks = match[1];
      firstText = match[2].trim();
      break;
    }
  }

  let body: string;
  if (firstIndex < 0) {
    body = `# ${wanted}\n\n${source.trim()}`.trimEnd();
  } else if (SUMMARY_HEADING.test(firstText)) {
    const preamble = lines.slice(0, firstIndex).join('\n').trim();
    const rest = lines.slice(firstIndex + 1).join('\n').replace(/^\n+/, '').trimEnd();
    const parts = [`# ${wanted}`];
    if (preamble) parts.push(preamble);
    parts.push(`## ${firstText}`);
    if (rest) parts.push(rest);
    body = parts.join('\n\n');
  } else if (PLACEHOLDER_HEADING.test(firstText)) {
    const rest = lines.slice(firstIndex + 1).join('\n').replace(/^\n+/, '').trimEnd();
    body = [`# ${wanted}`, rest].filter(Boolean).join('\n\n');
  } else if (firstMarks.length === 1) {
    body = source.trim();
  } else {
    body = `# ${wanted}\n\n${source.trim()}`.trimEnd();
  }

  return matter.stringify(body, data);
}

export interface SourcePageIssue {
  code:
    | 'type'
    | 'single-source'
    | 'raw-source'
    | 'subject'
    | 'foreign-citation'
    | 'anchored-citation'
    | 'uncited-section';
  message: string;
}

export interface SourcePageValidation {
  ok: boolean;
  issues: SourcePageIssue[];
}

/** A `Résumé` may summarise without a citation; a factual section may not. */
function isStructuralHeading(heading: string): boolean {
  return /^(r[ée]sum[ée]|summary)$/i.test(heading.trim());
}

function declaredSourcePaths(data: Record<string, unknown>): string[] {
  const raw = data.sources;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string') {
        return (entry as { path: string }).path;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\\/g, '/'));
}

export function validateSourcePage(content: string): SourcePageValidation {
  const issues: SourcePageIssue[] = [];
  const { data } = matter(content);
  const frontmatter = (data ?? {}) as Record<string, unknown>;

  if (frontmatter.type !== 'source') {
    issues.push({ code: 'type', message: 'type must be "source"' });
  }
  if (typeof frontmatter.subject !== 'string' || frontmatter.subject.trim() === '') {
    issues.push({ code: 'subject', message: 'subject (the document identity) is required' });
  }

  const declared = declaredSourcePaths(frontmatter);
  if (declared.length !== 1) {
    issues.push({
      code: 'single-source',
      message: `a source page represents exactly one document, found ${declared.length}`,
    });
  }
  const archive = declared[0];
  if (archive && !/^raw\/ingested\//.test(archive)) {
    issues.push({ code: 'raw-source', message: `the declared source must be a raw/ingested archive: ${archive}` });
  }

  for (const citation of extractBodyCitations(content)) {
    if (archive && citation.path !== archive) {
      issues.push({ code: 'foreign-citation', message: `cites a foreign document: ${citation.path}` });
    }
    if (citation.anchor === null) {
      issues.push({ code: 'anchored-citation', message: `citation to ${citation.path} carries no #section anchor` });
    }
  }

  const { sections } = splitMarkdownSections(content);
  for (const section of sections) {
    if (isStructuralHeading(section.headingText)) continue;
    // Strip the heading line itself; only a section with a real body is factual.
    const body = section.markdown.replace(/^#{1,6}\s+.*$/m, '').trim();
    if (body === '') continue;
    if (extractBodyCitations(section.markdown).length === 0) {
      issues.push({ code: 'uncited-section', message: `section "${section.headingText}" has no anchored citation` });
    }
  }

  return { ok: issues.length === 0, issues };
}
