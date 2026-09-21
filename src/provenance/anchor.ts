import { serializeHeadingPath } from './locators.ts';
import { splitMarkdownSections } from '../utils/markdown.ts';

/*
 * Engine-side anchoring. The model does not anchor its citations on its own
 * (measured), so rather than trust the prompt we resolve, deterministically,
 * which section of the cited document actually backs the claim: score the
 * claim's significant tokens against each section's, and anchor to the best
 * one when the match is confident. No confident match -> the citation is left
 * as it is and reported, never anchored at random.
 */

const STOPWORDS = new Set([
  'les', 'des', 'une', 'aux', 'sur', 'dans', 'avec', 'pour', 'par', 'est', 'sont', 'que', 'qui', 'dont',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'its', 'leur', 'leurs',
  'platform', 'plateforme', 'solution', 'propose', 'permet', 'peut', 'ainsi',
]);

function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw) && !/^\d+$/.test(raw)) out.add(raw);
  }
  return out;
}

export interface AnchorResult {
  content: string;
  /** Citations given a section anchor by this pass. */
  anchored: number;
  /** Citations left unanchored because no section matched confidently. */
  unresolved: string[];
  /** Citations left alone because the document has no sub-section to point to. */
  noSection: string[];
}

export function anchorCitations(
  content: string,
  loadDocument: (documentPath: string) => string | null,
  options: { minCoverage?: number } = {},
): AnchorResult {
  const minCoverage = options.minCoverage ?? 0.34;
  const anchoredList: string[] = [];
  const unresolved: string[] = [];
  const noSection: string[] = [];

  const sectionCache = new Map<string, Array<{ key: string; tokens: Set<string> }>>();
  const sectionsOf = (documentPath: string): Array<{ key: string; tokens: Set<string> }> | null => {
    if (sectionCache.has(documentPath)) return sectionCache.get(documentPath) ?? null;
    const document = loadDocument(documentPath);
    if (document === null) {
      sectionCache.set(documentPath, []);
      return null;
    }
    const entries = splitMarkdownSections(document).sections
      .filter((section) => section.headingText)
      .map((section) => ({
        key: serializeHeadingPath(section.headingPath),
        tokens: significantTokens(section.markdown.replace(/^#{1,6}\s+.*$/m, '')),
      }));
    sectionCache.set(documentPath, entries);
    return entries;
  };

  const next = String(content ?? '').replace(/\[src:\s*([^\]#\s]+)\]/g, (match, path: string, offset: number) => {
    if (!/^raw\/ingested\//.test(path)) return match;
    const sections = sectionsOf(path);
    // A document whose only heading is its title has nothing to point at.
    if (!sections || sections.length < 2) {
      noSection.push(path);
      return match;
    }
    const before = content.slice(0, offset);
    const boundary = Math.max(before.lastIndexOf('[src:'), before.lastIndexOf('\n## '), before.lastIndexOf('\n# '));
    const claim = significantTokens(before.slice(boundary + 1).replace(/\[src:[^\]]*\]/g, ' '));
    if (claim.size === 0) {
      unresolved.push(`${path}`);
      return match;
    }
    let best: { key: string; coverage: number } | null = null;
    let second = 0;
    for (const section of sections) {
      let shared = 0;
      for (const token of claim) if (section.tokens.has(token)) shared += 1;
      const coverage = shared / claim.size;
      if (!best || coverage > best.coverage) {
        second = best?.coverage ?? 0;
        best = { key: section.key, coverage };
      } else if (coverage > second) {
        second = coverage;
      }
    }
    if (best && best.coverage >= minCoverage && best.coverage > second) {
      anchoredList.push(`${path}#${best.key}`);
      return `[src: ${path}#${best.key}]`;
    }
    unresolved.push(path);
    return match;
  });

  return { content: next, anchored: anchoredList.length, unresolved, noSection };
}
