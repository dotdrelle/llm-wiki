import type { ServerResponse } from 'node:http';

/*
 * Headers every serve response carries. Deliberately no `script-src` yet: the
 * pages still use inline scripts and ~125 inline event handlers, which a nonce
 * does not cover; that directive follows their move to `addEventListener`.
 * What is here breaks nothing the pages do: no plugin objects, no `<base>`
 * hijack, forms post to serve only, and only serve itself may frame its pages
 * (the shell embeds the wiki in its centre frame, same origin).
 */
export const SERVE_CONTENT_SECURITY_POLICY = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', SERVE_CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
}
