import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGraphEventHub,
  GRAPH_KEEPALIVE_MS,
  GRAPH_RETRY_MS,
} from '../src/serve/sse/graphEvents.ts';
import {
  publishGeneration,
  taxonomyPaths,
  writeGeneration,
} from '../src/graph/wiki/taxonomy/store.ts';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-sse-'));
  await mkdir(taxonomyPaths(root).dir, { recursive: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

function fakeClient() {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const chunks: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    headers: {} as Record<string, string>,
    status: 0,
    ended: false,
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
  });
  return { req, res, chunks, body: () => chunks.join('') };
}

async function publish(label: string, corpus: string) {
  const generation = await writeGeneration(root, { communities: [{ id: 'cmty_1', label }] });
  return publishGeneration(root, {
    corpus,
    registryRef: generation.ref,
    registryHash: generation.hash,
  });
}

describe('flux SSE du graphe', () => {
  it('ouvre un flux d’événements avec un backoff imposé', () => {
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);

      expect(client.res.status).toBe(200);
      expect(client.res.headers['Content-Type']).toBe('text/event-stream');
      // Sans no-transform ni X-Accel-Buffering, un proxy peut retenir les
      // trames jusqu'à en avoir « assez » — ce qui annule le temps réel.
      expect(client.res.headers['Cache-Control']).toContain('no-transform');
      expect(client.res.headers['X-Accel-Buffering']).toBe('no');
      expect(client.body()).toContain(`retry: ${GRAPH_RETRY_MS}`);
    } finally {
      hub.stop();
    }
  });

  it('émet une trame de maintien pendant les longs silences', () => {
    vi.useFakeTimers();
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);
      expect(client.body()).not.toContain(': keep-alive');

      // Entre deux ingestions il ne se passe rien pendant des heures : c'est
      // le régime normal, pas une anomalie.
      vi.advanceTimersByTime(GRAPH_KEEPALIVE_MS * 3 + 1);

      expect(client.body().match(/: keep-alive/g)).toHaveLength(3);
    } finally {
      hub.stop();
    }
  });

  it('annonce une révision à tous les abonnés, en un seul type d’événement', async () => {
    const hub = createGraphEventHub(() => root);
    const a = fakeClient();
    const b = fakeClient();
    try {
      hub.subscribe(a.req as never, a.res as never);
      hub.subscribe(b.req as never, b.res as never);
      expect(hub.clientCount).toBe(2);

      await publish('Solution', 'corpus-1');
      await hub.check();

      for (const client of [a, b]) {
        expect(client.body()).toContain('event: graph.revision');
        const line = client.body().split('\n').find((entry) => entry.startsWith('data: {"revision"'));
        expect(JSON.parse(line!.slice('data: '.length))).toMatchObject({
          revision: 1,
          corpus: 'corpus-1',
          synthesized: true,
        });
      }
      // Un seul type : pas de graph.community-added, graph.merged, etc.
      expect(a.body()).not.toContain('event: graph.community');
    } finally {
      hub.stop();
    }
  });

  /*
   Un onglet ouvert après la publication doit connaître l'état courant sans
   attendre la révision suivante — qui peut ne jamais venir.
  */
  it('rattrape un abonné arrivé après la dernière révision', async () => {
    const hub = createGraphEventHub(() => root);
    const early = fakeClient();
    try {
      hub.subscribe(early.req as never, early.res as never);
      await publish('Solution', 'corpus-1');
      await hub.check();

      const late = fakeClient();
      hub.subscribe(late.req as never, late.res as never);

      expect(late.body()).toContain('"revision":1');
    } finally {
      hub.stop();
    }
  });

  it('libère la surveillance quand le dernier client part', async () => {
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    hub.subscribe(client.req as never, client.res as never);
    expect(hub.clientCount).toBe(1);

    // Fermeture de l'onglet : plus personne ne regarde, plus rien à sonder.
    client.req.emit('close');

    expect(hub.clientCount).toBe(0);
    hub.stop();
  });

  it('n’écrit plus rien dans un client fermé', async () => {
    const hub = createGraphEventHub(() => root);
    const client = fakeClient();
    try {
      hub.subscribe(client.req as never, client.res as never);
      client.req.emit('close');
      const before = client.chunks.length;

      await publish('Solution', 'corpus-1');
      await hub.check();

      expect(client.chunks).toHaveLength(before);
    } finally {
      hub.stop();
    }
  });
});
