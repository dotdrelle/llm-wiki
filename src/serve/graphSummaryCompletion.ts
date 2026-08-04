/**
 * Pont entre les routes du graphe et le LLM configuré.
 *
 * `graph/wiki/summary.ts` ne connaît ni la configuration ni le fournisseur :
 * il reçoit une fonction de complétion ou rien. C'est ce qui le rend testable
 * sans réseau, et c'est ici qu'on lui donne son moteur.
 */
import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';

// Un service par configuration : il porte un client HTTP et une clé de
// limitation de débit, les reconstruire à chaque requête reviendrait à ouvrir
// une nouvelle connexion par fiche ouverte.
const services = new WeakMap<AppConfig, LLMService>();

export function graphSummaryCompletion(
  config: AppConfig,
): ((request: { system: string; user: string }) => Promise<string>) | undefined {
  if (!config.llm?.baseUrl || !config.llm?.model) return undefined;
  return async ({ system, user }) => {
    let service = services.get(config);
    if (!service) {
      service = new LLMService(config);
      services.set(config, service);
    }
    return service.completeText({
      system,
      user,
      temperature: 0.2,
      // Une fiche de contexte fait trois lignes. Sans plafond, un modèle
      // bavard bloquerait l'ouverture de la carte le temps d'écrire une page.
      maxOutputTokens: 260,
      label: 'graph-context-summary',
    });
  };
}
