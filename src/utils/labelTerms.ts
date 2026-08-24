/*
 Significant terms of a label, for the non-overlap rule.

 Two labels may not share a significant term: if they do, they are almost always
 one class (or community) split in two for symmetry, and the pair reads as a
 distinction the corpus never made. An article or a preposition is not
 significant, and neither is a one- or two-letter fragment — so stopwords and
 short tokens are dropped before the comparison.

 This is the single tokenizer for every non-overlap check (the concept grid and
 the derived taxonomy communities). It used to be two divergent copies — one
 dropped stopwords, the other dropped short tokens — so a term like "des" or
 "os" counted as significant in one place and noise in the other. Keep them one.
 */

const LABEL_STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'aux',
  'of', 'the', 'and',
]);

export function labelTerms(label: string): string[] {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !LABEL_STOPWORDS.has(term));
}
