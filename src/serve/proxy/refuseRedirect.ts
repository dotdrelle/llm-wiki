/*
 * serve's POST proxy (`proxyPost`) fetches with `redirect: 'manual'`: the target
 * was chosen server side, and following a 3xx would let the upstream pick
 * another one — with the credentials serve attached. A redirect is answered
 * 502 and logged, never relayed.
 */
export async function refuseUpstreamRedirect(
  upstream: Response,
  target: string,
  res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void },
): Promise<boolean> {
  if (upstream.status < 300 || upstream.status >= 400) return false;
  await upstream.body?.cancel().catch(() => {});
  let shown = '(unparseable target)';
  try {
    const url = new URL(target);
    shown = `${url.protocol}//${url.host}${url.pathname}`;
  } catch { /* keep the placeholder: never log a raw target that may carry a secret */ }
  console.warn(`[wiki serve] upstream redirect refused (HTTP ${upstream.status}): ${shown}`);
  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Upstream answered with a redirect (HTTP ${upstream.status}); redirects are not followed.` }));
  return true;
}
