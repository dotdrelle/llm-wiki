import type { LlmConfig } from '../types.ts';

/**
 * Capacités et contournements par moteur.
 *
 * Source unique de vérité pour tout ce que le code faisait auparavant en
 * testant `config.llm.provider`. La séparation des deux axes est la raison
 * d'être de ce module :
 *
 * - `provider` dit **où** l'on tape (serveur direct ou AI gateway) ;
 * - `engine` dit **comment se comporte** le serveur en face.
 *
 * Derrière une gateway (`provider: 'ai-gateway'`), il n'existe pas un moteur
 * mais un par modèle : le même endpoint route vers gpt-5 (qui refuse
 * `temperature`) et vers claude (qui l'accepte). Aucune décision statique n'est
 * possible, donc **aucun contournement n'est appliqué** : on suppose une
 * sémantique OpenAI propre et on délègue la normalisation des paramètres à la
 * gateway (`drop_params: true` chez LiteLLM — prérequis documenté du mode
 * gateway, pas une option).
 */

function isGateway(llm: LlmConfig): boolean {
  return llm.provider === 'ai-gateway';
}

/**
 * Moteurs auparavant regroupés sous `provider: 'openai-compatible'`, c'est-à-dire
 * les serveurs d'inférence locaux ou auto-hébergés. Ce sont eux qui portent les
 * contournements historiques.
 *
 * `albert` en faisait partie par héritage, jamais par mesure. La sonde
 * `scripts/probe-engine.mjs` a montré qu'il n'en avait besoin pour aucun des
 * trois contournements testables — voir les prédicats concernés.
 */
function isLocalServer(llm: LlmConfig): boolean {
  if (isGateway(llm)) return false;
  return (
    llm.engine === 'mlx' ||
    llm.engine === 'vllm' ||
    llm.engine === 'albert' ||
    llm.engine === 'generic'
  );
}

/**
 * Serveur distant, mutualisé, à la sémantique OpenAI complète — par opposition
 * aux serveurs d'inférence bruts. Mesuré sur Albert : rôle `system` accepté,
 * `response_format: json_object` respecté, réparation JSON fonctionnelle, lot
 * JSON multi-slots restitué intact.
 *
 * Volontairement limité à `albert` : `vllm`, `mlx` et `generic` n'ont pas été
 * sondés, et leur accorder les mêmes capacités sans mesure reproduirait
 * exactement l'erreur qu'on est en train de corriger.
 */
function isManagedOpenAiCompatible(llm: LlmConfig): boolean {
  return !isGateway(llm) && llm.engine === 'albert';
}

/**
 * `temperature` est refusée par les modèles gpt-5 d'OpenAI.
 *
 * Le test porte sur le segment final du nom du modèle : derrière une gateway un
 * modèle s'appelle `openai/gpt-5-mini`, et l'ancienne regex ancrée en début de
 * chaîne ne matchait pas — la température partait et OpenAI rejetait la requête
 * (bug B-A). Le préfixe est donc retiré avant le test, ce qui rend la règle
 * valable dans les deux modes.
 */
export function supportsTemperature(llm: LlmConfig): boolean {
  const bareModel = llm.model.slice(llm.model.lastIndexOf('/') + 1);
  const isGpt5 = /^gpt-5(?:[.-]|$)/i.test(bareModel);
  if (!isGpt5) return true;
  // Un gpt-5 servi par OpenAI, en direct ou derrière une gateway.
  return !(isGateway(llm) || llm.engine === 'openai');
}

/**
 * En-têtes du client de génération, ajoutés à l'authentification du SDK OpenAI
 * (qui pose déjà `Authorization: Bearer`).
 */
export function engineHeaders(llm: LlmConfig): Record<string, string> | undefined {
  if (isGateway(llm)) return undefined;
  if (llm.engine === 'anthropic') return { 'anthropic-version': '2023-06-01' };
  return undefined;
}

/**
 * En-têtes d'un appel `fetch` brut vers l'API du moteur — sondage `/models` de
 * `doctor`, par exemple.
 *
 * Distinct de `engineHeaders` à dessein : là-bas le SDK OpenAI fournit
 * `Authorization`, ici personne ne le fait. Anthropic authentifie d'ailleurs
 * son API native par `x-api-key`, pas par un Bearer. Les deux fonctions
 * cohabitent donc au lieu d'être fusionnées, mais elles vivent côte à côte
 * pour qu'un changement de contrat les rende toutes deux visibles.
 */
export function engineFetchHeaders(
  llm: LlmConfig,
  apiKey: string | undefined,
): Record<string, string> {
  if (!isGateway(llm) && llm.engine === 'anthropic') {
    return { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' };
  }
  return { Authorization: `Bearer ${apiKey ?? ''}` };
}

/**
 * Certains serveurs (mlx_lm notamment) rejettent un rôle `system` en tête, ou
 * le traitent comme un tour utilisateur, produisant deux messages `user`
 * consécutifs. On replie alors le system dans le user.
 */
export function foldsSystemIntoUser(llm: LlmConfig): boolean {
  return isLocalServer(llm);
}

/** `response_format: { type: 'json_object' }` en mode JSON. */
export function supportsJsonResponseFormat(llm: LlmConfig): boolean {
  if (isGateway(llm)) return true;
  if (llm.engine === 'anthropic') return false;
  // Albert documente et respecte `json_object` (mesuré, M2). La désactivation
  // héritée lui coûtait le mode JSON natif pour rien.
  if (isManagedOpenAiCompatible(llm)) return true;
  return !isLocalServer(llm);
}

/** `stream_options: { include_usage: true }` pour récupérer l'usage en streaming. */
export function supportsStreamOptions(llm: LlmConfig): boolean {
  if (isGateway(llm)) return true;
  return llm.engine !== 'anthropic';
}

/** OpenAI attend `max_completion_tokens` là où les autres attendent `max_tokens`. */
export function usesMaxCompletionTokens(llm: LlmConfig): boolean {
  if (isGateway(llm)) return false;
  return llm.engine === 'openai';
}

/** `options.num_ctx`, propre au protocole Ollama. */
export function supportsNumCtx(llm: LlmConfig): boolean {
  return isOllamaEngine(llm);
}

/**
 * Réparation JSON par un second appel au modèle. Inutilisable sur les serveurs
 * locaux : les modèles à thinking (Qwen3 par exemple) renvoient un contenu vide
 * pour l'appel de réparation, ce qui la rend peu fiable et coûteuse.
 */
export function supportsModelJsonRepair(llm: LlmConfig): boolean {
  // Mesuré sur Albert (M3) : l'appel de réparation renvoie du JSON valide. Le
  // contournement visait mlx_lm et des Qwen3 locaux, pas ce moteur.
  if (isManagedOpenAiCompatible(llm)) return true;
  return !isLocalServer(llm);
}

/**
 * Rendu d'un slot unique par un prompt texte dédié, sans passer par du JSON.
 * Gain de fiabilité sur les serveurs locaux — mais il sérialise le batch, donc
 * il ne doit **jamais** s'activer derrière une gateway, où ce serait une
 * régression de débit pure.
 */
export function prefersSingleSlotTextRendering(llm: LlmConfig): boolean {
  // Mesuré sur Albert (M4) : un lot JSON multi-slots est restitué intact. Le
  // rendu slot unique sérialisait le build sur une API cloud à RPM 100, sans
  // le gain de fiabilité qui le justifie sur un serveur local.
  if (isManagedOpenAiCompatible(llm)) return false;
  return isLocalServer(llm);
}

/**
 * Ollama joint en direct. Conditionne le protocole (`options.num_ctx`), les
 * diagnostics d'erreur et tout le sous-système matériel de `doctor` : lecture
 * de l'environnement du process, `/api/show`, calcul du cache KV, alertes RAM.
 */
export function isOllamaEngine(llm: LlmConfig): boolean {
  return !isGateway(llm) && llm.engine === 'ollama';
}

/** Diagnostics d'erreur propres à Ollama (contexte dépassé, RAM insuffisante). */
export function hasOllamaDiagnostics(llm: LlmConfig): boolean {
  return isOllamaEngine(llm);
}

/**
 * Le plafond de sortie couvre-t-il aussi le raisonnement ?
 *
 * Oui presque partout : `max_tokens` (vLLM, Albert, Ollama) et
 * `max_completion_tokens` (OpenAI) bornent le **total généré**, raisonnement
 * compris. Anthropic fait exception, son budget de réflexion étant un
 * paramètre distinct.
 *
 * Conséquence : un plafond dimensionné pour le contenu seul peut être épuisé
 * avant qu'un caractère utile soit écrit. Mesuré sur Albert / gpt-oss-120b, où
 * le contenu n'arrive qu'au chunk 221 sur 222.
 */
export function outputCapIncludesReasoning(llm: LlmConfig): boolean {
  if (isGateway(llm)) return true;
  return llm.engine !== 'anthropic';
}

/**
 * Marge appliquée au plafond de sortie pour absorber le raisonnement.
 *
 * **Valeur provisoire.** Le facteur juste dépend du modèle et de la longueur
 * de la section, et n'a pas encore été mesuré (cf. §5.2 de
 * `plan-implementation-reasoning.md`). Le défaut de 3 est un ordre de grandeur,
 * pas une mesure — il est donc réglable par `llm.reasoningOutputMultiplier`.
 *
 * Élargir un plafond ne fait perdre qu'une protection contre l'emballement, et
 * la validation de section borne déjà la sortie par ailleurs. Le vrai garde-fou
 * est l'erreur explicite levée en cas de coupure, pas cette marge.
 */
export function reasoningOutputMultiplier(llm: LlmConfig): number {
  if (!outputCapIncludesReasoning(llm)) return 1;
  return llm.reasoningOutputMultiplier ?? 3;
}

/** Plafond de sortie effectif pour un budget de contenu donné. */
export function reasoningAwareOutputCap(llm: LlmConfig, contentTokens: number): number {
  return Math.ceil(contentTokens * reasoningOutputMultiplier(llm));
}

/** Étiquette affichée à l'utilisateur : le moteur est plus parlant que le routage. */
export function describeTarget(llm: LlmConfig): string {
  return isGateway(llm) ? 'ai-gateway' : llm.engine;
}
