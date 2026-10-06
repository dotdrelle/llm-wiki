import type { LlmCapabilities, LlmConfig } from '../types.ts';
import { engineFetchHeaders, supportsTemperature } from './engineCapabilities.ts';

/**
 * Measures what the configured model accepts, by asking it.
 *
 * Static rules (`engineCapabilities.ts`) guess from the engine and the model
 * name; they missed a thinking-mode model refusing a forced `tool_choice`
 * (HTTP 400 "Thinking mode does not support this tool_choice") on juno. Three
 * tiny chat calls settle it, and `wiki doctor --apply` records the result in
 * `llm.capabilities`, read by the engine and by the manager's own client.
 *
 * Tool calling with `tool_choice: "auto"` is REQUIRED — agent mode and the
 * maintenance agent cannot work without it. A forced (named) tool choice is
 * optional: the manager falls back to `auto` when it is refused.
 */

const PROBE_TIMEOUT_MS = 60_000;
const PROBE_TOOL = {
  type: 'function',
  function: {
    name: 'probe_answer',
    description: 'Return the answer.',
    parameters: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  },
} as const;

/** Reasoning outside `content`, under the names real servers use (see llmService.ts). */
const REASONING_KEYS = ['reasoning', 'reasoning_content', 'thinking_blocks', 'thinking'] as const;

export interface ModelProbeResult {
  /** What was measured; a field is absent when its probe could not conclude. */
  capabilities: LlmCapabilities;
  /** `auto` tool calling refused: agent mode and maintenance cannot work. */
  toolCallingUnsupported: boolean;
  /** The provider's own words for that refusal. */
  toolCallingRefusal?: string;
  /** A call that failed for another reason than a refused parameter. */
  failure?: string;
  /**
   * Tool calling only works with the reasoning turned down: the value of
   * `llm.reasoningEffort` that made it work (`--apply` writes it).
   */
  recommendedReasoningEffort?: 'none' | 'minimal';
}

type ProbeFetch = typeof fetch;

interface CallOutcome {
  ok: boolean;
  status?: number;
  body?: string;
  message?: Record<string, unknown>;
  error?: string;
}

async function chat(llm: LlmConfig, body: Record<string, unknown>, fetchImpl: ProbeFetch): Promise<CallOutcome> {
  try {
    const res = await fetchImpl(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { ...engineFetchHeaders(llm.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.model, ...body }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 400) };
    const data = JSON.parse(text) as { choices?: Array<{ message?: Record<string, unknown> }> };
    return { ok: true, status: res.status, message: data.choices?.[0]?.message ?? {} };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A 400/422 is the model refusing the request shape; anything else is not a verdict. */
function refused(outcome: CallOutcome): boolean {
  return !outcome.ok && (outcome.status === 400 || outcome.status === 422);
}

/** The `error.message` of an OpenAI-style error body, else the raw body. */
function providerMessage(outcome: CallOutcome): string {
  try {
    const parsed = JSON.parse(outcome.body ?? '') as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // Not JSON: the raw body is the message.
  }
  return (outcome.body ?? '').trim();
}

function describeFailure(outcome: CallOutcome): string {
  return outcome.error ?? `HTTP ${outcome.status} ${outcome.body ?? ''}`.trim();
}

export function messageShowsThinking(message: Record<string, unknown> | undefined): boolean {
  if (!message) return false;
  for (const key of REASONING_KEYS) {
    const value = message[key];
    if (typeof value === 'string' && value.trim()) return true;
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return typeof message.content === 'string' && /<think>/i.test(message.content);
}

/** Values tried, in order, when tool calling is refused under the model's reasoning. */
const TOOL_FRIENDLY_EFFORTS = ['none', 'minimal'] as const;

function mentionsReasoningEffort(outcome: CallOutcome): boolean {
  return /reasoning[_ ]?effort/i.test(outcome.body ?? '');
}

export async function probeModelCapabilities(
  llm: LlmConfig,
  fetchImpl: ProbeFetch = fetch,
): Promise<ModelProbeResult> {
  const capabilities: LlmCapabilities = { model: llm.model };
  const messages = [{ role: 'user', content: 'Reply with the single word OK.' }];
  // The configured reasoning effort is part of every real call, so it is part
  // of every probe; a refusal naming it settles that the model refuses it.
  let effort: Record<string, unknown> = llm.reasoningEffort ? { reasoning_effort: llm.reasoningEffort } : {};

  // 1. A plain answer, with the configured temperature when the static rule
  //    would send one. A refusal naming the temperature (or the reasoning
  //    effort) settles it; the call is then repeated without it.
  const sendTemperature = supportsTemperature({ ...llm, capabilities: undefined });
  let plain = await chat(llm, { messages, ...(sendTemperature ? { temperature: llm.temperature } : {}), ...effort }, fetchImpl);
  if (refused(plain) && llm.reasoningEffort && mentionsReasoningEffort(plain)) {
    capabilities.reasoningEffort = false;
    effort = {};
    plain = await chat(llm, { messages, ...(sendTemperature ? { temperature: llm.temperature } : {}) }, fetchImpl);
  }
  if (sendTemperature) {
    if (refused(plain) && /temperature/i.test(plain.body ?? '')) {
      capabilities.temperature = false;
      plain = await chat(llm, { messages, ...effort }, fetchImpl);
    } else if (plain.ok) {
      capabilities.temperature = true;
    }
  } else if (plain.ok) {
    const withTemperature = await chat(llm, { messages, temperature: llm.temperature, ...effort }, fetchImpl);
    if (withTemperature.ok) capabilities.temperature = true;
    else if (refused(withTemperature)) capabilities.temperature = false;
  }
  if (!plain.ok) {
    return { capabilities, toolCallingUnsupported: false, failure: describeFailure(plain) };
  }
  if (llm.reasoningEffort && capabilities.reasoningEffort === undefined) capabilities.reasoningEffort = true;
  capabilities.thinking = messageShowsThinking(plain.message);

  // 2. Tool calling. `auto` first — it is the one that is required. Some
  //    reasoning models refuse tools unless their reasoning is turned down
  //    (gpt-6-luna: "Function tools with reasoning_effort are not supported …
  //    set reasoning_effort to 'none'"): try the lowest efforts, and recommend
  //    the first one that works.
  const temperature = capabilities.temperature === false ? {} : { temperature: llm.temperature };
  const toolMessages = [{ role: 'user', content: 'Call probe_answer with answer "OK".' }];
  const autoCall = (extra: Record<string, unknown>) =>
    chat(llm, { messages: toolMessages, tools: [PROBE_TOOL], tool_choice: 'auto', ...temperature, ...extra }, fetchImpl);
  let auto = await autoCall(effort);
  let recommendedReasoningEffort: ModelProbeResult['recommendedReasoningEffort'];
  if (refused(auto) && mentionsReasoningEffort(auto)) {
    for (const candidate of TOOL_FRIENDLY_EFFORTS) {
      if (candidate === llm.reasoningEffort) continue;
      const retried = await autoCall({ reasoning_effort: candidate });
      if (retried.ok) {
        auto = retried;
        effort = { reasoning_effort: candidate };
        recommendedReasoningEffort = candidate;
        capabilities.reasoningEffort = true;
        break;
      }
    }
  }
  if (refused(auto)) return { capabilities, toolCallingUnsupported: true, toolCallingRefusal: providerMessage(auto) };
  if (!auto.ok) return { capabilities, toolCallingUnsupported: false, failure: describeFailure(auto) };

  // 3. A forced (named) tool choice — what thinking mode refuses.
  const named = await chat(llm, {
    messages: toolMessages,
    tools: [PROBE_TOOL],
    tool_choice: { type: 'function', function: { name: PROBE_TOOL.function.name } },
    ...temperature,
    ...effort,
  }, fetchImpl);
  if (named.ok) capabilities.toolChoice = 'named';
  else if (refused(named)) capabilities.toolChoice = 'auto';
  else return { capabilities, toolCallingUnsupported: false, failure: describeFailure(named), recommendedReasoningEffort };

  return { capabilities, toolCallingUnsupported: false, ...(recommendedReasoningEffort ? { recommendedReasoningEffort } : {}) };
}
