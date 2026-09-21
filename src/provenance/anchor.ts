import { resolveAnchor, serializeHeadingPath } from './locators.ts';
import { splitMarkdownSections } from '../utils/markdown.ts';

/*
 * Engine-side anchoring. The model does not reliably anchor its citations on
 * its own (measured), so rather than trust the prompt we resolve,
 * deterministically, which section of the cited document actually backs the
 * claim: score the claim's significant tokens against each section's, and
 * anchor to the best one when the match is confident.
 *
 * It handles two inputs: a BARE citation (`[src: path]`), and a citation whose
 * anchor does NOT resolve (`[src: path#<fabricated path>]` — the model mixing a
 * document title with a deeper section). The latter is re-anchored when
 * confident, otherwise STRIpped to a bare citation rather than kept as a false
 * precision. No confident match -> reported, never anchored at random.
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
  /** Citations given a section anchor by this pass (including re-anchoring). */
  anchored: number;
  /** Fabricated anchors dropped to a bare citation (a false precision removed). */
  stripped: number;
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
  let anchored = 0;
  let stripped = 0;
  const unresolved: string[] = [];
  const noSection: string[] = [];

  const documents = new Map<string, string | null>();
  const documentOf = (documentPath: string): string | null => {
    if (!documents.has(documentPath)) documents.set(documentPath, loadDocument(documentPath));
    return documents.get(documentPath) ?? null;
  };
  const sectionCache = new Map<string, Array<{ key: string; tokens: Set<string> }> | null>();
  const sectionsOf = (documentPath: string): Array<{ key: string; tokens: Set<string> }> | null => {
    if (sectionCache.has(documentPath)) return sectionCache.get(documentPath) ?? null;
    const document = documentOf(documentPath);
    if (document === null) {
      sectionCache.set(documentPath, null);
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

  const next = String(content ?? '').replace(
    /\[src:\s*([^\]#\s]+)(?:#([^\]]+))?\]/g,
    (match, path: string, anchor: string | undefined, offset: number) => {
      if (!/^raw\/ingested\//.test(path)) return match;
      const document = documentOf(path);
      if (document === null) return match;
      // An already-resolvable anchor is left exactly as written.
      if (anchor && resolveAnchor(document, anchor).status === 'resolved') return match;

      const sections = sectionsOf(path);
      // A document whose only heading is its title has nothing to point at.
      if (!sections || sections.length < 2) {
        noSection.push(path);
        // Never keep a fabricated anchor on a document with no sub-section.
        if (anchor) stripped += 1;
        return anchor ? `[src: ${path}]` : match;
      }

      const before = content.slice(0, offset);
      const boundary = Math.max(before.lastIndexOf('[src:'), before.lastIndexOf('\n## '), before.lastIndexOf('\n# '));
      const claim = significantTokens(before.slice(boundary + 1).replace(/\[src:[^\]]*\]/g, ' '));
      if (claim.size > 0) {
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
          anchored += 1;
          return `[src: ${path}#${best.key}]`;
        }
      }

      unresolved.push(path);
      // A fabricated anchor is dropped: an invalid "precise" citation is worse
      // than an honestly bare one. The validator then reports it.
      if (anchor) stripped += 1;
      return anchor ? `[src: ${path}]` : match;
    },
  );

  return { content: next, anchored, stripped, unresolved, noSection };
}
