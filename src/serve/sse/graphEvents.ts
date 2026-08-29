import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Below the shortest inactivity tolerated by common intermediaries.
 */
export const GRAPH_KEEPALIVE_MS = 20_000;
/**
 * Reconnection backoff imposed on the client.
 */
export const GRAPH_RETRY_MS = 3_000;

type Client = { res: ServerResponse; keepAlive: NodeJS.Timeout };

/**
 * Graph revision broadcaster.
 *
 * There is no registry to watch any more: the graph is a direct reading of the
 * concept folders. The hub keeps one SSE connection per client alive and
 * broadcasts a monotonic revision on `check()` — called by the graph routes
 * after a write — so the client re-fetches the snapshot.
 */
export function createGraphEventHub(rootDir: () => string) {
  void rootDir;
  const clients = new Set<Client>();
  let revision = 0;

  function broadcast(): void {
    revision += 1;
    const payload = JSON.stringify({ revision, corpus: '', synthesized: false, publishedAt: Date.now() });
    for (const client of clients) {
      client.res.write(`event: graph.revision\ndata: ${payload}\n\n`);
    }
  }

  function release(client: Client): void {
    clearInterval(client.keepAlive);
    clients.delete(client);
  }

  return {
    get clientCount(): number {
      return clients.size;
    },
    async check(): Promise<void> {
      broadcast();
    },
    subscribe(req: IncomingMessage, res: ServerResponse): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: ${GRAPH_RETRY_MS}\n\n`);

      const client: Client = {
        res,
        keepAlive: setInterval(() => res.write(': keep-alive\n\n'), GRAPH_KEEPALIVE_MS),
      };
      client.keepAlive.unref?.();
      clients.add(client);

      req.on('close', () => release(client));
      res.on('error', () => release(client));
    },
    stop(): void {
      for (const client of [...clients]) {
        clearInterval(client.keepAlive);
        client.res.end();
      }
      clients.clear();
    },
  };
}

export type GraphEventHub = ReturnType<typeof createGraphEventHub>;
