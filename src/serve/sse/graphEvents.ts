import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTaxonomyWatcher, type TaxonomyWatcher } from '../../graph/wiki/taxonomy/watcher.ts';
import type { TaxonomyMarker } from '../../graph/wiki/taxonomy/store.ts';

/**
 * Below the shortest inactivity tolerated by common intermediaries.
 *
 * Unlike `/api/runtime/events`, Serve is here the **origin** of the stream: it
 * has no upstream whose frames would pace the connection. Between two
 * ingestions — that is, nearly all the time — nothing would flow, and a proxy
 * would end up cutting a connection it believes dead.
 */
export const GRAPH_KEEPALIVE_MS = 20_000;
/**
 * Reconnection backoff imposed on the client. Without `retry:`, the browser
 * applies its default and a Serve restart produces a burst of reconnections
 * from every open tab.
 */
export const GRAPH_RETRY_MS = 3_000;

type Client = { res: ServerResponse; keepAlive: NodeJS.Timeout };

/**
 * Graph revision broadcaster.
 *
 * One watcher per workspace, whatever the number of clients: watching is a
 * server cost, not a per-tab cost. The watcher only exists while at least one
 * client listens — no point polling a disk nobody is watching.
 */
export function createGraphEventHub(rootDir: () => string) {
  const clients = new Set<Client>();
  let watcher: TaxonomyWatcher | null = null;
  let lastMarker: TaxonomyMarker | null = null;

  function broadcast(marker: TaxonomyMarker): void {
    lastMarker = marker;
    /*
     A single event type.

     Eight types would mean eight client paths and eight ways to desynchronize.
     The client already knows how to reconcile one scene against another: it
     only needs to know there is something new, and at which revision. `kind`
     travels as an animation hint, not as a separate contract.
    */
    const payload = JSON.stringify({
      revision: marker.revision,
      corpus: marker.corpus,
      synthesized: Boolean(marker.registryRef),
      publishedAt: marker.publishedAt,
    });
    for (const client of clients) {
      client.res.write(`event: graph.revision\ndata: ${payload}\n\n`);
    }
  }

  function ensureWatcher(): void {
    if (watcher) return;
    watcher = createTaxonomyWatcher({ rootDir: rootDir(), onRevision: broadcast });
  }

  function release(client: Client): void {
    clearInterval(client.keepAlive);
    clients.delete(client);
    if (clients.size === 0) {
      watcher?.stop();
      watcher = null;
    }
  }

  return {
    get clientCount(): number {
      return clients.size;
    },
    /**
     * Force an immediate check, without waiting for the debounce or the poll.
     * Useful to a caller that just wrote and knows there is something new — and
     * the only way to write a test that doesn't chase a clock.
     */
    async check(): Promise<void> {
      await watcher?.check();
    },
    subscribe(req: IncomingMessage, res: ServerResponse): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Neutralizes a reverse proxy's buffer that would hold frames until it
        // has "enough" of them, which defeats the whole point of the stream.
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: ${GRAPH_RETRY_MS}\n\n`);

      const client: Client = {
        res,
        keepAlive: setInterval(() => res.write(': keep-alive\n\n'), GRAPH_KEEPALIVE_MS),
      };
      client.keepAlive.unref?.();
      clients.add(client);
      ensureWatcher();

      // A client arriving after a publication must know the current state
      // without waiting for the next revision, which may never come.
      if (lastMarker) {
        res.write(
          `event: graph.revision\ndata: ${JSON.stringify({
            revision: lastMarker.revision,
            corpus: lastMarker.corpus,
            synthesized: Boolean(lastMarker.registryRef),
            publishedAt: lastMarker.publishedAt,
          })}\n\n`,
        );
      }

      req.on('close', () => release(client));
      res.on('error', () => release(client));
    },
    stop(): void {
      for (const client of [...clients]) {
        clearInterval(client.keepAlive);
        client.res.end();
      }
      clients.clear();
      watcher?.stop();
      watcher = null;
    },
  };
}

export type GraphEventHub = ReturnType<typeof createGraphEventHub>;
