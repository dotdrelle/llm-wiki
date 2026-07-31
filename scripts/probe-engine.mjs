#!/usr/bin/env node
/**
 * Sonde de moteur — remplace probe-reasoning.mjs.
 *
 * Elle répond en une commande à deux familles de questions, sur l'endpoint
 * réel plutôt que sur la documentation :
 *
 *  A. RAISONNEMENT — le serveur émet-il le raisonnement dans un champ séparé,
 *     sous quel nom et sous quelle forme, est-il compté dans l'usage, et
 *     `reasoning_effort` est-il honoré ?
 *
 *  B. MOTEUR — les quatre contournements hérités du groupe `openai-compatible`
 *     sont-ils justifiés pour CE serveur ? Ils sont aujourd'hui appliqués à
 *     `albert`, `vllm`, `mlx` et `generic` sans avoir jamais été vérifiés
 *     ailleurs que sur mlx_lm :
 *       M1 · repli du rôle `system` dans `user`
 *       M2 · `response_format: json_object` désactivé
 *       M3 · réparation JSON par le modèle désactivée
 *       M4 · rendu slot unique (sérialise le build)
 *
 * Aucune écriture, aucune modification de config. La clé n'est jamais affichée.
 *
 * Usage :
 *   node scripts/probe-engine.mjs --workspace /chemin/vers/workspace
 *   node scripts/probe-engine.mjs --base-url URL --api-key KEY --model NAME
 *
 * Options :
 *   --only reasoning|engine   ne lancer qu'une famille
 *   --effort high             effort demandé pour la passe de raisonnement
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

/** Lecture minimaliste du bloc `llm:`, sans dépendance YAML. */
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

// ── affichage ────────────────────────────────────────────────────────────────

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
 * Mesure d'une valeur de delta, quelle que soit sa forme.
 *
 * Correctif : la version précédente ne comptait que les chaînes. Or LiteLLM
 * expose le raisonnement d'Anthropic dans `thinking_blocks`, qui est un
 * **tableau structuré** — il apparaissait donc comme « clé présente, zéro
 * caractère », ce qui est pire que de ne rien voir.
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

/** Parcourt le flux SSE et inventorie toutes les clés vues dans `delta`. */
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
 * Question à plusieurs étapes, choisie pour déclencher un raisonnement réel.
 *
 * Correctif : le prompt précédent était trop facile — gpt-5.4 l'a résolu en
 * 4 tokens avec `reasoning_tokens: 0`, ce qui rendait la passe non concluante.
 * On ne peut pas conclure « pas de raisonnement » d'un modèle à qui on n'a
 * rien demandé de dur.
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
  section('A · Raisonnement');

  const effort = CFG.effort;
  const base = await streamProbe({
    messages: messages(HARD.system, HARD.user),
    max_tokens: 2048,
    ...(effort ? { reasoning_effort: effort } : {}),
  });
  if (base.httpError) {
    bad(`HTTP ${base.httpError}: ${base.detail}`);
    record('A', 'endpoint injoignable ou requête rejetée');
    return;
  }

  row('chunks:', String(base.chunks));
  row('delta keys:', Object.keys(base.fields).join(', ') || '(none)');
  for (const [key, value] of Object.entries(base.fields)) {
    row(`  ${key}:`, `${value.chars} chars${value.items ? `, ${value.items} item(s)` : ''} (1er chunk ${base.firstSeenAt[key]})`);
  }
  if (base.finishReason) row('finish_reason:', base.finishReason);
  if (base.usage) row('usage:', JSON.stringify(base.usage));

  const key = REASONING_KEYS.find((candidate) => base.fields[candidate]);
  const contentChars = base.fields.content?.chars ?? 0;
  const reasoningChars = key ? base.fields[key].chars : 0;
  const reportedReasoningTokens =
    base.usage?.completion_tokens_details?.reasoning_tokens;

  // Coupure par le plafond pendant le raisonnement : le contenu n'arrive
  // jamais, sans erreur HTTP. C'est le risque actif sur exportService
  // (max_tokens: 3000).
  if (base.finishReason === 'length' && contentChars === 0 && reasoningChars > 0) {
    bad(
      'COUPURE : max_tokens épuisé pendant le raisonnement, aucun contenu produit. Une section vide serait écrite sans erreur.',
    );
    record('A′', 'le plafond de sortie peut être consommé entièrement par le raisonnement — CONFIRMÉ');
  }

  if (key) {
    const value = base.fields[key];
    bad(`Raisonnement émis dans delta.${key} — llmService ne lit que delta.content, ce flux est jeté.`);
    if (value.items > 0) {
      warn(`${key} est un tableau (${value.items} bloc(s)) : le drain ne peut pas concaténer des chaînes naïvement.`);
    }
    row('  raisonnement / contenu:', `${reasoningChars} / ${contentChars} chars`);
    if (contentChars === 0) {
      bad('content VIDE sur tout le flux : toute réponse de ce modèle arrive vide côté llm-wiki.');
    }
    if (reportedReasoningTokens === undefined) {
      warn('usage ne rapporte aucun reasoning_tokens : le coût du raisonnement est invisible.');
      record('C', `${key} non compté dans l'usage — estimation nécessaire`);
    }
    record('A', `drainer delta.${key}${value.items ? ' (tableau)' : ''}`);
  } else if (reportedReasoningTokens > 0) {
    ok(`Pas de trace exposée, mais reasoning_tokens=${reportedReasoningTokens} : le raisonnement a lieu et est facturé.`);
    record('C', 'lire completion_tokens_details.reasoning_tokens — le drain est inutile ici');
  } else if (reportedReasoningTokens === 0) {
    warn('reasoning_tokens=0 : ce modèle n\'a pas raisonné, même sur une question à étapes. Non concluant plutôt que négatif.');
    record('A', 'non concluant sur cet endpoint — relancer avec --effort high');
  } else {
    ok('Aucun champ de raisonnement, aucun compteur. Moteur sans raisonnement.');
    record('A', 'inutile pour cet endpoint');
  }

  // Effort : mesurable seulement si on a quelque chose à mesurer.
  const low = await streamProbe({
    messages: messages(HARD.system, HARD.user),
    max_tokens: 2048,
    reasoning_effort: 'low',
  });
  if (low.httpError) {
    bad(`reasoning_effort REJETÉ (HTTP ${low.httpError}) — ne pas l'envoyer ici. ${low.detail}`);
    record('B', 'reasoning_effort rejeté — supportsReasoningEffort = false');
    return;
  }
  const lowChars = key ? (low.fields[key]?.chars ?? 0) : 0;
  const lowTokens = low.usage?.completion_tokens_details?.reasoning_tokens;
  const baseMetric = reasoningChars || reportedReasoningTokens || 0;
  const lowMetric = lowChars || lowTokens || 0;

  if (baseMetric > 0 && lowMetric < baseMetric * 0.8) {
    ok(`reasoning_effort honoré (${baseMetric} → ${lowMetric}).`);
    record('B', 'reasoning_effort honoré — supportsReasoningEffort = true');
  } else if (baseMetric > 0) {
    warn(`Accepté mais sans effet net (${baseMetric} → ${lowMetric}) : probablement ignoré. Ne pas fonder de budget dessus.`);
    record('B', 'reasoning_effort accepté mais non honoré — indice, pas contrat');
  } else {
    warn('Rien à mesurer : effet de reasoning_effort invérifiable sur cet endpoint.');
  }
}

// ── B · contournements moteur ────────────────────────────────────────────────

async function probeEngine() {
  section('B · Contournements hérités du groupe openai-compatible');

  // M1 · le rôle system en tête est-il rejeté ou mal interprété ?
  //
  // Le plafond doit être large : sur un moteur à raisonnement, un `max_tokens`
  // serré est consommé par le raisonnement avant qu'un seul caractère de
  // contenu soit émis — observé chez Albert/gpt-oss avec 64. La sonde
  // concluait alors « consigne non suivie » alors qu'elle mesurait une
  // coupure. Un contenu vide ici reste donc suspect et doit être signalé
  // comme tel, pas interprété.
  const marker = 'ZKQ7';
  const m1 = await jsonProbe({
    messages: messages(`Reply with exactly this token and nothing else: ${marker}`, 'Go.'),
    max_tokens: 2048,
  });
  if (m1.httpError) {
    warn(`M1 · rôle system : HTTP ${m1.httpError} — repli justifié. ${m1.detail}`);
    record('M1', 'foldsSystemIntoUser = true (le serveur rejette le rôle system)');
  } else if (contentOf(m1.payload).includes(marker)) {
    ok('M1 · rôle system honoré — le repli system→user est inutile.');
    record('M1', 'foldsSystemIntoUser = FALSE (repli inutile)');
  } else if (!contentOf(m1.payload).trim()) {
    warn(
      'M1 · contenu VIDE malgré un plafond large — probablement une coupure pendant le raisonnement, pas un problème de rôle system. Verdict non concluant.',
    );
    record('M1', 'foldsSystemIntoUser = NON CONCLUANT (contenu vide, cause à isoler)');
  } else {
    warn(`M1 · rôle system accepté mais consigne non suivie (${JSON.stringify(contentOf(m1.payload).slice(0, 60))}) — repli prudent.`);
    record('M1', 'foldsSystemIntoUser = à garder (consigne system ignorée)');
  }

  // M2 · response_format json_object
  const m2 = await jsonProbe({
    messages: messages('Reply with JSON only.', 'Return {"answer": 42} and nothing else.'),
    response_format: { type: 'json_object' },
    max_tokens: 128,
  });
  if (m2.httpError) {
    warn(`M2 · response_format rejeté (HTTP ${m2.httpError}) — désactivation justifiée.`);
    record('M2', 'supportsJsonResponseFormat = false');
  } else {
    let valid = false;
    try {
      valid = typeof JSON.parse(contentOf(m2.payload)) === 'object';
    } catch {
      valid = false;
    }
    if (valid) {
      ok('M2 · response_format: json_object accepté et respecté — la désactivation coûte du mode JSON natif.');
      record('M2', 'supportsJsonResponseFormat = TRUE (à réactiver)');
    } else {
      warn('M2 · accepté mais la réponse n\'est pas du JSON valide — désactivation prudente.');
      record('M2', 'supportsJsonResponseFormat = à garder à false');
    }
  }

  // M3 · réparation JSON par le modèle — reproduit exactement l'appel réel.
  const broken = '{"replacements": [{"id": "instruction-1", "content": "il a dit "bonjour" hier"}]}';
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
    warn(`M3 · appel de réparation : HTTP ${m3.httpError}`);
    record('M3', 'supportsModelJsonRepair = indéterminé');
  } else {
    const text = contentOf(m3.payload);
    if (!text.trim()) {
      bad('M3 · réparation : contenu VIDE — la désactivation est justifiée, et la cause est identifiée.');
      record('M3', 'supportsModelJsonRepair = false (contenu vide confirmé)');
    } else {
      let repaired = false;
      try {
        JSON.parse(text.replace(/```(?:json)?|```/g, '').trim());
        repaired = true;
      } catch {
        repaired = false;
      }
      if (repaired) {
        ok('M3 · réparation JSON fonctionnelle — la désactivation prive ce moteur d\'un filet utile.');
        record('M3', 'supportsModelJsonRepair = TRUE (à réactiver)');
      } else {
        warn('M3 · réponse non vide mais non réparée — désactivation défendable.');
        record('M3', 'supportsModelJsonRepair = à garder à false');
      }
    }
  }

  // M4 · plusieurs slots dans un seul appel JSON, proxy du rendu slot unique.
  const m4 = await jsonProbe({
    messages: messages(
      'Reply with JSON only, no prose.',
      'Return {"replacements":[{"id":"a","content":"A"},{"id":"b","content":"B"},{"id":"c","content":"C"}]} exactly.',
    ),
    max_tokens: 256,
  });
  if (m4.httpError) {
    warn(`M4 · HTTP ${m4.httpError}`);
    record('M4', 'prefersSingleSlotTextRendering = indéterminé');
  } else {
    let count = 0;
    try {
      const parsed = JSON.parse(contentOf(m4.payload).replace(/```(?:json)?|```/g, '').trim());
      count = Array.isArray(parsed.replacements) ? parsed.replacements.length : 0;
    } catch {
      count = 0;
    }
    if (count === 3) {
      ok('M4 · lot JSON multi-slots restitué intact — le rendu slot unique sérialise le build pour rien.');
      record('M4', 'prefersSingleSlotTextRendering = FALSE (débit récupérable)');
    } else {
      warn(`M4 · lot multi-slots dégradé (${count}/3) — le rendu slot unique se justifie.`);
      record('M4', 'prefersSingleSlotTextRendering = à garder');
    }
  }
}

// ── programme ────────────────────────────────────────────────────────────────

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

  section('Verdict — à reporter dans engineCapabilities.ts');
  if (verdicts.length === 0) console.log('  (rien à conclure)');
  for (const verdict of verdicts) console.log(`  ${verdict}`);
  console.log(
    '\n  Chaque ligne vaut pour CE serveur et CE modèle. Relancer la sonde sur\n' +
      '  chaque endpoint réellement utilisé avant de généraliser.',
  );
}

main().catch((error) => {
  bad(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
