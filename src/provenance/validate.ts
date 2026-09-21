import { extractBodyCitations } from './derive.ts';
import { resolveAnchor } from './locators.ts';

/*
 * Lot 1/5 enforcement: the model does not reliably anchor its citations, so a
 * prompt instruction is not enough. In provenance mode every citation is
 * checked against the document it names: an unanchored citation is a
 * degradation, and an anchor that resolves nowhere or ambiguously is refused —
 * never silently widened.
 */

export type CitationIssueCode = 'unanchored' | 'ambiguous' | 'missing';

export interface CitationIssue {
  citation: string;
  code: CitationIssueCode;
  message: string;
}

export function validateAnchoredCitations(
  content: string,
  loadDocument: (documentPath: string) => string | null,
): CitationIssue[] {
  const issues: CitationIssue[] = [];
  for (const citation of extractBodyCitations(content)) {
    const label = citation.anchor ? `${citation.path}#${citation.anchor}` : citation.path;
    if (citation.anchor === null) {
      // A legacy whole-file citation is readable but cannot carry a precise
      // proof; the new mode must say so rather than accept it silently.
      issues.push({ citation: label, code: 'unanchored', message: 'citation carries no #section anchor' });
      continue;
    }
    const document = loadDocument(citation.path);
    if (document === null) {
      issues.push({ citation: label, code: 'missing', message: `cited document is unreadable: ${citation.path}` });
      continue;
    }
    const resolution = resolveAnchor(document, citation.anchor);
    if (resolution.status !== 'resolved') {
      issues.push({
        citation: label,
        code: resolution.status === 'ambiguous' ? 'ambiguous' : 'missing',
        message: resolution.status === 'ambiguous'
          ? `anchor matches several sections: ${citation.anchor}`
          : `anchor matches no section: ${citation.anchor}`,
      });
    }
  }
  return issues;
}
