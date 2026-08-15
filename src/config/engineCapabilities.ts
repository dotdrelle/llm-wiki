import type { LlmConfig } from '../types.ts';

/**
 * Per-engine capabilities and workarounds.
 *
 * Single source of truth for everything the code previously did by testing
 * `config.llm.provider`. The separation of the two axes is the very purpose of
 * this module:
 *
 * - `provider` says **where** requests are sent (direct server or AI gateway);
 * - `engine` says **how** the server in front behaves.
 *
 * Behind a gateway (`provider: 'ai-gateway'`), there is not one engine but one
 * per model: the same endpoint routes to gpt-5 (which refuses `temperature`)
 * and to claude (which accepts it). No static decision is possible, so **no
 * workaround is applied**: we assume clean OpenAI semantics and delegate
 * parameter normalization to the gateway (`drop_params: true` on LiteLLM —
 * documented prerequisite of gateway mode, not an option).
 */

function isGateway(llm: LlmConfig): boolean {
  return llm.provider === 'ai-gateway';
}

/**
 * Engines previously grouped under `provider: 'openai-compatible'`, that is
 * local or self-hosted inference servers. These are the ones that carry the
 * historical workarounds.
 *
 * `albert` was part of it by inheritance, never by measure. The
 * `scripts/probe-engine.mjs` probe showed that it needed none of the three
 * testable workarounds — see the relevant predicates.
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
 * Remote, shared server with full OpenAI semantics — as opposed to raw
 * inference servers. Measured on Albert: `system` role accepted,
 * `response_format: json_object` respected, JSON repair functional, multi-slot
 * JSON batch returned intact.
 *
 * Deliberately limited to `albert`: `vllm`, `mlx` and `generic` have not been
 * probed, and granting them the same capabilities without measurement would
 * reproduce exactly the error we are correcting.
 */
function isManagedOpenAiCompatible(llm: LlmConfig): boolean {
  return !isGateway(llm) && llm.engine === 'albert';
}

/**
 * `temperature` is refused by OpenAI gpt-5 models.
 *
 * The test targets the final segment of the model name: behind a gateway a
 * model is called `openai/gpt-5-mini`, and the old regex anchored at the start
 * of the string did not match — the temperature went through and OpenAI rejected
 * the request (bug B-A). The prefix is therefore removed before the test, which
 * makes the rule valid in both modes.
 */
export function supportsTemperature(llm: LlmConfig): boolean {
  const bareModel = llm.model.slice(llm.model.lastIndexOf('/') + 1);
  const isGpt5 = /^gpt-5(?:[.-]|$)/i.test(bareModel);
  if (!isGpt5) return true;
  // A gpt-5 served by OpenAI, directly or behind a gateway.
  return !(isGateway(llm) || llm.engine === 'openai');
}

/**
 * Generation client headers, added on top of the OpenAI SDK authentication
 * (which already sets `Authorization: Bearer`).
 */
export function engineHeaders(llm: LlmConfig): Record<string, string> | undefined {
  if (isGateway(llm)) return undefined;
  if (llm.engine === 'anthropic') return { 'anthropic-version': '2023-06-01' };
  return undefined;
}

/**
 * Headers for a raw `fetch` call to the engine API — the `/models` probe of
 * `doctor`, for example.
 *
 * Distinct from `engineHeaders` on purpose: there the OpenAI SDK provides
 * `Authorization`, here nobody does. Anthropic authenticates its native API via
 * `x-api-key`, not a Bearer. The two functions therefore coexist instead of
 * being merged, but they live side by side so that a contract change makes them
 * both visible.
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
 * Some servers (mlx_lm in particular) reject a leading `system` role, or treat
 * it as a user turn, producing two consecutive `user` messages. We then fold
 * the system into the user.
 */
export function foldsSystemIntoUser(llm: LlmConfig): boolean {
  return isLocalServer(llm);
}

/** `response_format: { type: 'json_object' }` en mode JSON. */
export function supportsJsonResponseFormat(llm: LlmConfig): boolean {
  if (isGateway(llm)) return true;
  if (llm.engine === 'anthropic') return false;
  // Albert documents and respects `json_object` (measured, M2). The inherited
  // deactivation cost it the native JSON mode for nothing.
  if (isManagedOpenAiCompatible(llm)) return true;
  return !isLocalServer(llm);
}

/** `stream_options: { include_usage: true }` to get usage in streaming. */
export function supportsStreamOptions(llm: LlmConfig): boolean {
  if (isGateway(llm)) return true;
  return llm.engine !== 'anthropic';
}

/** OpenAI expects `max_completion_tokens` where the others expect `max_tokens`. */
export function usesMaxCompletionTokens(llm: LlmConfig): boolean {
  if (isGateway(llm)) return false;
  return llm.engine === 'openai';
}

/** `options.num_ctx`, specific to the Ollama protocol. */
export function supportsNumCtx(llm: LlmConfig): boolean {
  return isOllamaEngine(llm);
}

/**
 * JSON repair by a second call to the model. Unusable on local servers:
 * thinking models (Qwen3 for example) return empty content for the repair call,
 * which makes it unreliable and costly.
 */
export function supportsModelJsonRepair(llm: LlmConfig): boolean {
  // Measured on Albert (M3): the repair call returns valid JSON. The workaround
  // targeted mlx_lm and local Qwen3s, not this engine.
  if (isManagedOpenAiCompatible(llm)) return true;
  return !isLocalServer(llm);
}

/**
 * Rendering of a single slot via a dedicated text prompt, without going through
 * JSON. A reliability gain on local servers — but it serializes the batch, so
 * it must **never** activate behind a gateway, where it would be a pure
 * throughput regression.
 */
export function prefersSingleSlotTextRendering(llm: LlmConfig): boolean {
  // Measured on Albert (M4): a multi-slot JSON batch is returned intact.
  // Single-slot rendering serialized the build on a cloud API at RPM 100,
  // without the reliability gain that justifies it on a local server.
  if (isManagedOpenAiCompatible(llm)) return false;
  return isLocalServer(llm);
}

/**
 * Ollama reached directly. Conditions the protocol (`options.num_ctx`), the
 * error diagnostics and the whole `doctor` hardware subsystem: process
 * environment reading, `/api/show`, KV cache computation, RAM alerts.
 */
export function isOllamaEngine(llm: LlmConfig): boolean {
  return !isGateway(llm) && llm.engine === 'ollama';
}

/** Error diagnostics specific to Ollama (context exceeded, insufficient RAM). */
export function hasOllamaDiagnostics(llm: LlmConfig): boolean {
  return isOllamaEngine(llm);
}

/**
 * Does the output cap also cover reasoning?
 *
 * Yes almost everywhere: `max_tokens` (vLLM, Albert, Ollama) and
 * `max_completion_tokens` (OpenAI) bound the **generated total**, reasoning
 * included. Anthropic is the exception, its reflection budget being a distinct
 * parameter.
 *
 * Consequence: a cap sized for content alone can be exhausted before a single
 * useful character is written. Measured on Albert / gpt-oss-120b, where the
 * content only arrives at chunk 221 of 222.
 */
export function outputCapIncludesReasoning(llm: LlmConfig): boolean {
  if (isGateway(llm)) return true;
  return llm.engine !== 'anthropic';
}

/**
 * Margin applied to the output cap to absorb reasoning.
 *
 * **Provisional value.** The right factor depends on the model and the section
 * length, and has not been measured yet (cf. §5.2 of
 * `plan-implementation-reasoning.md`). The default of 3 is an order of
 * magnitude, not a measurement — it is therefore adjustable via
 * `llm.reasoningOutputMultiplier`.
 *
 * Widening a cap only loses a protection against runaway generation, and
 * section validation already bounds the output elsewhere. The real guard is the
 * explicit error raised on cutoff, not this margin.
 */
export function reasoningOutputMultiplier(llm: LlmConfig): number {
  if (!outputCapIncludesReasoning(llm)) return 1;
  return llm.reasoningOutputMultiplier ?? 3;
}

/** Effective output cap for a given content budget. */
export function reasoningAwareOutputCap(llm: LlmConfig, contentTokens: number): number {
  return Math.ceil(contentTokens * reasoningOutputMultiplier(llm));
}

/** Label shown to the user: the engine is more telling than the routing. */
export function describeTarget(llm: LlmConfig): string {
  return isGateway(llm) ? 'ai-gateway' : llm.engine;
}
