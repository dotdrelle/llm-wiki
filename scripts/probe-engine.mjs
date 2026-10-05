#!/usr/bin/env node
/**
 * Engine probe — replaces probe-reasoning.mjs.
 *
 * It answers two families of questions in one command, against the real
 * endpoint rather than the documentation:
 *
 *  A. REASONING — does the server emit reasoning in a separate field, under
 *     what name and in what shape, is it counted in usage, and is
 *     `reasoning_effort` honoured?
 *
 *  B. ENGINE — are the four workarounds inherited from the `openai-compatible`
 *     group justified for THIS server? They are currently applied to `albert`,
 *     `vllm`, `mlx` and `generic` without ever having been verified anywhere
 *     but on mlx_lm:
 *       M1 · folding the `system` role into `user`
 *       M2 · `response_format: json_object` disabled
 *       M3 · model-side JSON repair disabled
 *       M4 · single-slot rendering (serializes the build)
 *
 * No writes, no config change. The key is never printed.
 *
 * Usage:
 *   node scripts/probe-engine.mjs --workspace /path/to/workspace
 *   node scripts/probe-engine.mjs --base-url URL --api-key KEY --model NAME
 *
 * Options:
 *   --only reasoning|engine   run a single family
 *   --effort high             effort requested for the reasoning pass
 *   --timeout 120000
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ── arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

/** Minimalist reader for the `llm:` block, with no YAML dependency. */
function readWikircLlm(workspacePath) {
  const configPath = path.join(workspacePath, '.wikirc.yaml');
  if (!existsSync(configPath)) throw new Error(`no .wikirc.yaml in ${workspacePath}`);
  const llm = {};
  let inLlm = false;
  for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    if (/^llm:\s*$/.test(line)) {
      inLlm = true;
      continue;
    }
    if (inLlm && /^\S/.test(line)) break;
    if (!inLlm) continue;
    const match = /^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(line);
    if (match) llm[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return llm;
}

// ── output ──────────────────────────────────────────────────────────────────

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);
const bad = (msg) => console.log(`  ✗ ${msg}`);
const row = (label, value) => console.log(`  ${String(label).padEnd(30)} ${value}`);
const section = (title) =>
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const verdicts = [];
const record = (id, text) => verdicts.push(`${id} · ${text}`);

// ── transport ────────────────────────────────────────────────────────────────

let CFG = {};

async function post(body, stream) {
  return fetch(`${CFG.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CFG.apiKey ? { Authorization: `Bearer ${CFG.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: CFG.model, stream: Boolean(stream), ...body }),
    signal: AbortSignal.timeout(CFG.timeoutMs),
  });
}

/**
 * Measures a delta value, whatever its shape.
 *
 * Fix: the previous version only counted strings. But LiteLLM exposes
 * Anthropic's reasoning in `thinking_blocks`, which is a **structured
 * array** — it therefore showed up as "key present, zero characters",
 * which is worse than seeing nothing.
 */
function measure(value) {
  if (typeof value === 'string') return { chars: value.length, items: 0, text: value };
  if (Array.isArray(value)) {
    const text = value
      .map((item) =>
        typeof item === 'string'
          ? item
          : (item?.thinking ?? item?.text ?? JSON.stringify(item)),
      )
      .join('');
    return { chars: text.length, items: value.length, text };
  }
  if (value && typeof value === 'object') {
    const text = JSON.stringify(value);
    return { chars: text.length, items: 1, text };
  }
  return { chars: 0, items: 0, text: '' };
}

/** Walks the SSE stream and inventories every key seen in `delta`. */
async function streamProbe(body) {
  const res = await post(body, true);
  if (!res.ok) return { httpError: res.status, detail: (await res.text()).slice(0, 300) };

  const fields = {};
  let chunks = 0;
  let usage;
  let finishReason;
  const firstSeenAt = {};

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed.usage) usage = parsed.usage;
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta;
      if (!delta) continue;
      chunks += 1;
      for (const [key, value] of Object.entries(delta)) {
        if (value === null || value === undefined || value === '') continue;
        const measured = measure(value);
        if (measured.chars === 0 && measured.items === 0) continue;
        fields[key] ??= { chars: 0, items: 0, text: '' };
        fields[key].chars += measured.chars;
        fields[key].items += measured.items;
        fields[key].text += measured.text;
        firstSeenAt[key] ??= chunks;
      }
    }
  }
  return { fields, chunks, usage, finishReason, firstSeenAt };
}

async function jsonProbe(body) {
  const res = await post(body, false);
  const text = await res.text();
  if (!res.ok) return { httpError: res.status, detail: text.slice(0, 300) };
  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { httpError: 0, detail: text.slice(0, 300) };
  }
}

const contentOf = (payload) => payload?.choices?.[0]?.message?.content ?? '';

const REASONING_KEYS = ['reasoning', 'reasoning_content', 'thinking_blocks', 'thinking'];

// ── A · raisonnement ─────────────────────────────────────────────────────────

/**
 * Multi-step question, chosen to trigger real reasoning.
 *
 * Fix: the previous prompt was too easy — gpt-5.4 solved it in 4 tokens
 * with `reasoning_tokens: 0`, which made the pass inconclusive. You cannot
 * conclude "no reasoning" from a model that was never asked anything hard.
 */
const HARD = {
  system: 'Think it through, then answer with the final number only.',
  user: [
    'Three warehouses each receive a shipment.',
    'Warehouse A gets 7 crates of 12 units; 3 units per crate are damaged.',
    'Warehouse B gets 40% more undamaged units than A, rounded down.',
    'Warehouse C gets half of B, rounded up, then loses 11 units.',
    'How many undamaged units are there in total across A, B and C?',
  ].join(' '),
};

function messages(system, user) {
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

async function probeReasoning() {
  section('A · Reasoning');

  const effort = CFG.effort;
  const base = await streamProbe({
    messages: messages(HARD.system, HARD.user),
    max_tokens: 2048,
    ...(effort ? { reasoning_effort: effort } : {}),
  });
  if (base.httpError) {
    bad(`HTTP ${base.httpError}: ${base.detail}`);
    record('A', 'endpoint unreachable or request rejected');
    return;
  }

  row('chunks:', String(base.chunks));
  row('delta keys:', Object.keys(base.fields).join(', ') || '(none)');
  for (const [key, value] of Object.entries(base.fields)) {
    row(`  ${key}:`, `${value.chars} chars${value.items ? `, ${value.items} item(s)` : ''} (first chunk ${base.firstSeenAt[key]})`);
  }
  if (base.finishReason) row('finish_reason:', base.finishReason);
  if (base.usage) row('usage:', JSON.stringify(base.usage));

  const key = REASONING_KEYS.find((candidate) => base.fields[candidate]);
  const contentChars = base.fields.content?.chars ?? 0;
  const reasoningChars = key ? base.fields[key].chars : 0;
  const reportedReasoningTokens =
    base.usage?.completion_tokens_details?.reasoning_tokens;

  // Cut off by the cap during reasoning: content never arrives, without an
  // HTTP error. This is the live risk on exportService (max_tokens: 3000).
  if (base.finishReason === 'length' && contentChars === 0 && reasoningChars > 0) {
    bad(
      'CUT-OFF: max_tokens exhausted during reasoning, no content produced. An empty section would be written without error.',
    );
    record('A′', 'the output cap can be fully consumed by reasoning — CONFIRMED');
  }

  if (key) {
    const value = base.fields[key];
    bad(`Reasoning emitted in delta.${key} — llmService only reads delta.content, this stream is discarded.`);
    if (value.items > 0) {
      warn(`${key} is an array (${value.items} block(s)): the drain cannot concatenate strings naively.`);
    }
    row('  reasoning / content:', `${reasoningChars} / ${contentChars} chars`);
    if (contentChars === 0) {
      bad('EMPTY content over the whole stream: every response from this model reaches llm-wiki empty.');
    }
    if (reportedReasoningTokens === undefined) {
      warn('usage reports no reasoning_tokens: the cost of reasoning is invisible.');
      record('C', `${key} not counted in usage — estimation required`);
    }
    record('A', `drain delta.${key}${value.items ? ' (array)' : ''}`);
  } else if (reportedReasoningTokens > 0) {
    ok(`No exposed trace, but reasoning_tokens=${reportedReasoningTokens}: reasoning happens and is billed.`);
    record('C', 'read completion_tokens_details.reasoning_tokens — the drain is useless here');
  } else if (reportedReasoningTokens === 0) {
    warn('reasoning_tokens=0: this model did not reason, even on a multi-step question. Inconclusive rather than negative.');
    record('A', 'inconclusive on this endpoint — rerun with --effort high');
  } else {
    ok('No reasoning field, no counter. Engine without reasoning.');
    record('A', 'useless for this endpoint');
  }

  // Effort: measurable only if there is something to measure.
  const low = await streamProbe({
    messages: messages(HARD.system, HARD.user),
    max_tokens: 2048,
    reasoning_effort: 'low',
  });
  if (low.httpError) {
    bad(`reasoning_effort REJECTED (HTTP ${low.httpError}) — do not send it here. ${low.detail}`);
    record('B', 'reasoning_effort rejected — supportsReasoningEffort = false');
    return;
  }
  const lowChars = key ? (low.fields[key]?.chars ?? 0) : 0;
  const lowTokens = low.usage?.completion_tokens_details?.reasoning_tokens;
  const baseMetric = reasoningChars || reportedReasoningTokens || 0;
  const lowMetric = lowChars || lowTokens || 0;

  if (baseMetric > 0 && lowMetric < baseMetric * 0.8) {
    ok(`reasoning_effort honoured (${baseMetric} → ${lowMetric}).`);
    record('B', 'reasoning_effort honoured — supportsReasoningEffort = true');
  } else if (baseMetric > 0) {
    warn(`Accepted but with no clear effect (${baseMetric} → ${lowMetric}): probably ignored. Do not build a budget on it.`);
    record('B', 'reasoning_effort accepted but not honoured — a hint, not a contract');
  } else {
    warn('Nothing to measure: effect of reasoning_effort unverifiable on this endpoint.');
  }
}

// ── B · engine workarounds ───────────────────────────────────────────────────

async function probeEngine() {
  section('B · Workarounds inherited from the openai-compatible group');

  // M1 · is a leading system role rejected or misinterpreted?
  //
  // The cap must be generous: on a reasoning engine, a tight `max_tokens`
  // is consumed by reasoning before a single character of content is
  // emitted — observed on Albert/gpt-oss with 64. The probe then concluded
  // "instruction not followed" when it was measuring a cut-off. Empty
  // content here therefore stays suspect and must be reported as such, not
  // interpreted.
  const marker = 'ZKQ7';
  const m1 = await jsonProbe({
    messages: messages(`Reply with exactly this token and nothing else: ${marker}`, 'Go.'),
    max_tokens: 2048,
  });
  if (m1.httpError) {
    warn(`M1 · system role: HTTP ${m1.httpError} — fallback justified. ${m1.detail}`);
    record('M1', 'foldsSystemIntoUser = true (the server rejects the system role)');
  } else if (contentOf(m1.payload).includes(marker)) {
    ok('M1 · system role honoured — the system→user fallback is useless.');
    record('M1', 'foldsSystemIntoUser = FALSE (useless fallback)');
  } else if (!contentOf(m1.payload).trim()) {
    warn(
      'M1 · EMPTY content despite a generous cap — probably a cut-off during reasoning, not a system role problem. Inconclusive verdict.',
    );
    record('M1', 'foldsSystemIntoUser = INCONCLUSIVE (empty content, cause to isolate)');
  } else {
    warn(`M1 · system role accepted but instruction not followed (${JSON.stringify(contentOf(m1.payload).slice(0, 60))}) — prudent fallback.`);
    record('M1', 'foldsSystemIntoUser = keep (system instruction ignored)');
  }

  // M2 · response_format json_object
  const m2 = await jsonProbe({
    messages: messages('Reply with JSON only.', 'Return {"answer": 42} and nothing else.'),
    response_format: { type: 'json_object' },
    max_tokens: 128,
  });
  if (m2.httpError) {
    warn(`M2 · response_format rejected (HTTP ${m2.httpError}) — disabling justified.`);
    record('M2', 'supportsJsonResponseFormat = false');
  } else {
    let valid = false;
    try {
      valid = typeof JSON.parse(contentOf(m2.payload)) === 'object';
    } catch {
      valid = false;
    }
    if (valid) {
      ok('M2 · response_format: json_object accepted and honoured — disabling it costs native JSON mode.');
      record('M2', 'supportsJsonResponseFormat = TRUE (re-enable)');
    } else {
      warn('M2 · accepted but the answer is not valid JSON — prudent disabling.');
      record('M2', 'supportsJsonResponseFormat = keep at false');
    }
  }

  // M3 · model-side JSON repair — reproduces the real call exactly.
  const broken = '{"replacements": [{"id": "instruction-1", "content": "he said "hello" yesterday"}]}';
  const m3 = await jsonProbe({
    messages: messages(
      [
        'You repair malformed JSON.',
        'Return only valid JSON.',
        'Do not explain anything.',
        'Preserve the original keys and values as much as possible.',
      ].join('\n'),
      `Repair the following malformed JSON-like response into strict valid JSON only:\n\n${broken}`,
    ),
    max_tokens: 512,
  });
  if (m3.httpError) {
    warn(`M3 · repair call: HTTP ${m3.httpError}`);
    record('M3', 'supportsModelJsonRepair = indeterminate');
  } else {
    const text = contentOf(m3.payload);
    if (!text.trim()) {
      bad('M3 · repair: EMPTY content — disabling is justified, and the cause is identified.');
      record('M3', 'supportsModelJsonRepair = false (empty content confirmed)');
    } else {
      let repaired = false;
      try {
        JSON.parse(text.replace(/```(?:json)?|```/g, '').trim());
        repaired = true;
      } catch {
        repaired = false;
      }
      if (repaired) {
        ok('M3 · JSON repair functional — disabling it deprives this engine of a useful safety net.');
        record('M3', 'supportsModelJsonRepair = TRUE (re-enable)');
      } else {
        warn('M3 · non-empty response but not repaired — defensible disabling.');
        record('M3', 'supportsModelJsonRepair = keep at false');
      }
    }
  }

  // M4 · several slots in a single JSON call, proxy for single-slot rendering.
  const m4 = await jsonProbe({
    messages: messages(
      'Reply with JSON only, no prose.',
      'Return {"replacements":[{"id":"a","content":"A"},{"id":"b","content":"B"},{"id":"c","content":"C"}]} exactly.',
    ),
    max_tokens: 256,
  });
  if (m4.httpError) {
    warn(`M4 · HTTP ${m4.httpError}`);
    record('M4', 'prefersSingleSlotTextRendering = indeterminate');
  } else {
    let count = 0;
    try {
      const parsed = JSON.parse(contentOf(m4.payload).replace(/```(?:json)?|```/g, '').trim());
      count = Array.isArray(parsed.replacements) ? parsed.replacements.length : 0;
    } catch {
      count = 0;
    }
    if (count === 3) {
      ok('M4 · multi-slot JSON batch returned intact — single-slot rendering serializes the build for nothing.');
      record('M4', 'prefersSingleSlotTextRendering = FALSE (throughput recoverable)');
    } else {
      warn(`M4 · multi-slot batch degraded (${count}/3) — single-slot rendering is justified.`);
      record('M4', 'prefersSingleSlotTextRendering = keep');
    }
  }
}

// ── program ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let baseUrl = args['base-url'] ?? process.env.WIKI_LLM_BASE_URL;
  let apiKey = args['api-key'] ?? process.env.WIKI_LLM_API_KEY;
  let model = args.model ?? process.env.WIKI_LLM_MODEL;

  if (args.workspace) {
    const llm = readWikircLlm(String(args.workspace));
    baseUrl ??= llm.baseUrl;
    apiKey ??= llm.apiKey;
    model ??= llm.model;
    row('provider (wikirc):', llm.provider ?? '-');
    row('engine (wikirc):', llm.engine ?? '-');
  }

  if (!baseUrl || !model) {
    console.error('Missing --base-url / --model (or --workspace).');
    process.exit(2);
  }

  CFG = {
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number(args.timeout ?? 120000),
    effort: typeof args.effort === 'string' ? args.effort : undefined,
  };

  row('baseUrl:', baseUrl);
  row('model:', model);
  row('apiKey:', apiKey ? '(set)' : '(none)');
  if (CFG.effort) row('reasoning_effort:', CFG.effort);

  const only = args.only;
  if (only !== 'engine') await probeReasoning();
  if (only !== 'reasoning') await probeEngine();

  section('Verdict — to report in engineCapabilities.ts');
  if (verdicts.length === 0) console.log('  (nothing to conclude)');
  for (const verdict of verdicts) console.log(`  ${verdict}`);
  console.log(
    '\n  Each line holds for THIS server and THIS model. Rerun the probe on\n' +
      '  every endpoint actually used before generalizing.',
  );
}

main().catch((error) => {
  bad(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
