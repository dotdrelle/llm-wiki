import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';

const compress = promisify(gzip);

/**
 * Below this, the header and the CPU cost exceed the gain. Small JSON responses
 * — a status, an error — have nothing to gain from it.
 */
export const JSON_GZIP_THRESHOLD = 1_024;

export function acceptsGzip(req: IncomingMessage): boolean {
  return (req.headers['accept-encoding'] ?? '').includes('gzip');
}

/**
 * JSON response compressed when the client accepts it and the size justifies
 * it.
 *
 * `sendJson` does not know `Accept-Encoding`: it never received the request.
 * This did not matter while `/api/graph/overview` was only read when the graph
 * opened; since the client re-takes a full snapshot on every revision, the same
 * payload goes back out on every publication — nodes, edges and communities,
 * uncompressed, in an iframe.
 *
 * Careful about what this does NOT fix: gzip reduces the network, not the
 * object size after `JSON.parse`, nor the memory peak while the old and new
 * scenes coexist. It is the cheapest measure, not the sizing answer — see the
 * criteria for switching to a delta.
 */
export async function sendJsonPayload(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const body = JSON.stringify(data);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  };

  if (!acceptsGzip(req) || Buffer.byteLength(body) < JSON_GZIP_THRESHOLD) {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }

  const compressed = await compress(body);
  headers['Content-Encoding'] = 'gzip';
  // Vary is necessary as soon as a response depends on a request header:
  // without it, an intermediate cache can serve the compressed variant to a
  // client that does not understand it.
  headers.Vary = 'Accept-Encoding';
  res.writeHead(status, headers);
  res.end(compressed);
}
