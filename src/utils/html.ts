/*
 * HTML text/attribute escaping.
 *
 * One implementation: this was copied six times — four server-side modules and
 * two browser script fragments — and one of the copies omitted the quotes, a
 * difference that matters the moment the value lands in an attribute rather
 * than text. Escaping the union (`& < > " '`) is safe in both positions, so
 * every caller can share this.
 */
export function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
