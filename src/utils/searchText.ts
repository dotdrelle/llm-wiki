/**
 * Small, locale-neutral tokenizer for lexical ranking. It preserves Unicode
 * letters and marks; semantic cross-language matching remains the vector
 * retriever's responsibility rather than a hand-maintained synonym table.
 */
export function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’']/g, ' ')
    .match(/[\p{L}\p{M}\p{N}]{2,}/gu) ?? [];
}
