import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';

const compress = promisify(gzip);

/**
 * En dessous, l'en-tête et le coût CPU dépassent le gain. Les petites réponses
 * JSON — un statut, une erreur — n'ont rien à y gagner.
 */
export const JSON_GZIP_THRESHOLD = 1_024;

export function acceptsGzip(req: IncomingMessage): boolean {
  return (req.headers['accept-encoding'] ?? '').includes('gzip');
}

/**
 * Réponse JSON compressée quand le client l'accepte et que la taille le
 * justifie.
 *
 * `sendJson` ne connaît pas `Accept-Encoding` : il n'a jamais reçu la requête.
 * Ce n'était pas gênant tant que `/api/graph/overview` n'était lu qu'à
 * l'ouverture du graphe ; depuis que le client refait un snapshot complet à
 * chaque révision, la même charge repart à chaque publication — nœuds, arêtes
 * et communautés, non compressés, dans une iframe.
 *
 * Attention à ce que cela ne règle PAS : gzip réduit le réseau, pas la taille
 * de l'objet après `JSON.parse`, ni le pic mémoire pendant la coexistence de
 * l'ancienne et de la nouvelle scène. C'est la mesure la moins chère, pas la
 * réponse au dimensionnement — voir le critère de bascule vers un delta.
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
  // Vary est nécessaire dès qu'une réponse dépend d'un en-tête de requête :
  // sans lui, un cache intermédiaire peut servir la variante compressée à un
  // client qui ne la comprend pas.
  headers.Vary = 'Accept-Encoding';
  res.writeHead(status, headers);
  res.end(compressed);
}
