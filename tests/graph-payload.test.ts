import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  JSON_GZIP_THRESHOLD,
  sendJsonPayload,
} from '../src/serve/http/sendJsonPayload.ts';
import { createSnapshot } from '../src/graph/wiki/snapshot.ts';
import type { WikiGraphEdge, WikiGraphNode } from '../src/graph/wiki/projection.ts';

function fakeResponse() {
  const chunks: Buffer[] = [];
  return {
    status: 0,
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    buffer: () => Buffer.concat(chunks),
  };
}

const request = (encoding?: string) =>
  ({ headers: encoding ? { 'accept-encoding': encoding } : {} }) as never;

function corpus(pages: number) {
  const nodes: WikiGraphNode[] = [];
  const edges: WikiGraphEdge[] = [];
  for (let index = 0; index < pages; index += 1) {
    const group = `Domaine ${index % 12}`;
    const id = `wiki/concepts/${group.toLowerCase().replace(' ', '-')}/page-${index}.md`;
    nodes.push({
      id,
      title: `Page ${index} — un titre de longueur réaliste`,
      type: 'wiki',
      href: `/${id}`,
      preview: 'x'.repeat(400),
      raw: 'y'.repeat(800),
      html: '<p>z</p>',
      group,
      community: { communityId: `domaine-${index % 12}`, communityLabel: group, assignment: 'explicit' },
      degree: 3,
      x: 0,
      y: 0,
      r: 10,
      ring: 1,
      secondary: id,
      inbound: 1,
      outbound: 2,
    });
    if (index > 0) {
      edges.push({ from: nodes[index - 1]!.id, to: id, type: 'links_to' });
      if (index % 7 === 0) edges.push({ from: id, to: nodes[0]!.id, type: 'cites' });
    }
  }
  return createSnapshot('etag', { nodes, edges }, { workspace: 'mesure' });
}

describe('charge utile du snapshot', () => {
  it('laisse une petite réponse en clair', async () => {
    const res = fakeResponse();
    await sendJsonPayload(request('gzip'), res as never, 200, { ok: true });

    expect(res.headers['Content-Encoding']).toBeUndefined();
    expect(JSON.parse(res.buffer().toString())).toEqual({ ok: true });
  });

  it('ne compresse jamais pour un client qui ne l’accepte pas', async () => {
    const res = fakeResponse();
    await sendJsonPayload(request(), res as never, 200, corpus(200));

    expect(res.headers['Content-Encoding']).toBeUndefined();
    expect(() => JSON.parse(res.buffer().toString())).not.toThrow();
  });

  it('compresse un snapshot et annonce la variation', async () => {
    const res = fakeResponse();
    const snapshot = corpus(200);
    await sendJsonPayload(request('gzip, deflate'), res as never, 200, snapshot);

    expect(res.headers['Content-Encoding']).toBe('gzip');
    // Sans Vary, un cache intermédiaire peut servir la variante compressée à
    // un client qui ne la comprend pas.
    expect(res.headers.Vary).toBe('Accept-Encoding');
    expect(JSON.parse(gunzipSync(res.buffer()).toString())).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('franchit le seuil sur une réponse à peine plus grande', async () => {
    const small = fakeResponse();
    await sendJsonPayload(request('gzip'), small as never, 200, { pad: 'x'.repeat(JSON_GZIP_THRESHOLD - 64) });
    expect(small.headers['Content-Encoding']).toBeUndefined();

    const large = fakeResponse();
    await sendJsonPayload(request('gzip'), large as never, 200, { pad: 'x'.repeat(JSON_GZIP_THRESHOLD * 2) });
    expect(large.headers['Content-Encoding']).toBe('gzip');
  });

  /*
   Mesure de référence pour le critère de bascule vers un delta (§5.3 du plan).

   Le client refait un snapshot COMPLET à chaque révision. Ce test n'impose pas
   une limite de performance : il fige les ordres de grandeur, de sorte qu'une
   régression de charge — un champ ajouté au contrat, du contenu qui repasse
   dans le snapshot — se voie ici plutôt que sur le poste de quelqu'un.

   Il rappelle aussi ce que gzip ne règle pas : la taille après JSON.parse, qui
   est celle qui compte pour la mémoire de l'iframe.
  */
  it('fige les ordres de grandeur de la charge utile', async () => {
    for (const pages of [200, 1_000]) {
      const snapshot = corpus(pages);
      const raw = Buffer.byteLength(JSON.stringify(snapshot));
      const res = fakeResponse();
      await sendJsonPayload(request('gzip'), res as never, 200, snapshot);
      const compressed = res.buffer().length;

      // Le contenu des pages ne doit jamais repartir dans le snapshot : c'est
      // ce qui ferait exploser la charge à chaque révision.
      expect(JSON.stringify(snapshot)).not.toContain('yyyy');
      // Un graphe reste largement compressible : chemins, types et libellés
      // se répètent d'un nœud à l'autre.
      expect(compressed).toBeLessThan(raw / 4);
      // Garde-fou de régression, très au-dessus des valeurs observées.
      expect(raw / pages).toBeLessThan(700);
    }
  });
});
