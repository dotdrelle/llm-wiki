/**
 * The base URL as it may be shown to a MODEL. A `baseUrl` can carry a secret of
 * its own — `https://user:token@host/v1`, or a gateway key in the query string
 * (`?api-key=…`) — and a system prompt is repeated in answers, persisted with
 * the conversation, and sent onward by an AI gateway. Keep scheme, host, port
 * and path; drop userinfo, query and fragment, and say so. An unparseable value
 * is withheld whole rather than echoed.
 *
 * Mirrors `promptSafeBaseUrl` in llm-wiki-manager `src/core/wikirc.js`, which
 * builds the same fact for Donna — change both together.
 */
export function promptSafeBaseUrl(baseUrl: string | undefined | null): string {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return 'unset';
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return '(withheld: not a parseable URL)';
  }
  const withheld: string[] = [];
  if (url.username || url.password) withheld.push('credentials');
  if (url.search) withheld.push('query');
  if (url.hash) withheld.push('fragment');
  const safe = `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  return withheld.length ? `${safe} (${withheld.join(', ')} withheld)` : safe;
}
