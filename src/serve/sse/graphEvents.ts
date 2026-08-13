import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTaxonomyWatcher, type TaxonomyWatcher } from '../../graph/wiki/taxonomy/watcher.ts';
import type { TaxonomyMarker } from '../../graph/wiki/taxonomy/store.ts';

/**
 * Sous la plus courte inactivité tolérée par les intermédiaires courants.
 *
 * Contrairement à `/api/runtime/events`, Serve est ici l'**origine** du flux :
 * il n'a pas d'amont dont les trames rythmeraient la connexion. Entre deux
 * ingestions — c'est-à-dire la quasi-totalité du temps — rien ne circulerait,
 * et un proxy finirait par couper une connexion qu'il croit morte.
 */
export const GRAPH_KEEPALIVE_MS = 20_000;
/**
 * Backoff de reconnexion imposé au client. Sans `retry:`, le navigateur
 * applique son défaut et un redémarrage de Serve produit une rafale de
 * reconnexions de tous les onglets ouverts.
 */
export const GRAPH_RETRY_MS = 3_000;

type Client = { res: ServerResponse; keepAlive: NodeJS.Timeout };

/**
 * Diffuseur de révisions du graphe.
 *
 * Un seul watcher par workspace, quel que soit le nombre de clients : la
 * surveillance est un coût serveur, pas un coût par onglet. Le watcher n'existe
 * que tant qu'au moins un client écoute — inutile de sonder un disque que
 * personne ne regarde.
 */
export function createGraphEventHub(rootDir: () => string) {
  const clients = new Set<Client>();
  let watcher: TaxonomyWatcher | null = null;
  let lastMarker: TaxonomyMarker | null = null;

  function broadcast(marker: TaxonomyMarker): void {
    lastMarker = marker;
    /*
     Un seul type d'événement.

     Huit types signifieraient huit chemins clients et huit façons de
     désynchroniser. Le client sait déjà réconcilier une scène contre une
     autre : il lui suffit de savoir qu'il y a du neuf, et à quelle révision.
     `kind` voyage comme indice d'animation, pas comme contrat séparé.
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
     * Force une vérification immédiate, sans attendre l'anti-rebond ni le
     * sondage. Utile à un appelant qui vient d'écrire et sait qu'il y a du
     * neuf — et seul moyen d'écrire un test qui ne coure pas après une horloge.
     */
    async check(): Promise<void> {
      await watcher?.check();
    },
    subscribe(req: IncomingMessage, res: ServerResponse): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Neutralise le tampon d'un reverse proxy qui retiendrait les trames
        // jusqu'à en avoir « assez », ce qui annule tout l'intérêt du flux.
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

      // Un client qui arrive après une publication doit connaître l'état
      // courant sans attendre la révision suivante, qui peut ne jamais venir.
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
