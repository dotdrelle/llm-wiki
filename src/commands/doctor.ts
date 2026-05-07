import os from 'node:os';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import YAML from 'yaml';
import { splitByHeadings } from '../utils/markdown.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import type { AppConfig } from '../types.ts';
import { pathExists, safeWriteFile } from '../utils/fs.ts';

const CHARS_PER_TOKEN = 4;
const OUTPUT_RESERVE = 0.25;
const SYSTEM_PROMPT_OVERHEAD = 2000;

// Bits per weight for common GGUF quantizations (including block overhead)
const QUANT_BITS: Record<string, number> = {
  Q2_K: 2.6,
  Q3_K_S: 3.0,
  Q3_K_M: 3.35,
  Q3_K_L: 3.6,
  Q4_0: 4.5,
  Q4_K_S: 4.37,
  Q4_K_M: 4.5,
  Q4_K_L: 4.9,
  Q5_0: 5.5,
  Q5_K_S: 5.5,
  Q5_K_M: 5.68,
  Q6_K: 6.56,
  Q8_0: 8.5,
  F16: 16.0,
  BF16: 16.0,
  F32: 32.0,
};

// Bytes per KV element based on OLLAMA_KV_CACHE_TYPE
const KV_CACHE_BYTES: Record<string, number> = {
  f16: 2.0,
  q8_0: 1.0,
  q4_0: 0.5,
};

interface OllamaModelInfo {
  parameterCount: number;
  quantization: string;
  nativeCtx: number;
  blockCount: number;
  embeddingLength: number;
  headCount: number;
  kvHeadCount: number;
  modelfileNumCtx?: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(Math.floor((sorted.length * p) / 100), sorted.length - 1)] ?? 0;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function parseParamSize(raw: string): number {
  const m = /^([\d.]+)\s*([BbMm]?)/.exec(raw);
  if (!m) return 0;
  const n = parseFloat(m[1] ?? '0');
  const unit = (m[2] ?? '').toUpperCase();
  return unit === 'B' ? n * 1e9 : unit === 'M' ? n * 1e6 : n;
}

function contextWindowTokens(config: AppConfig): number | undefined {
  if (config.llm.provider === 'ollama') return config.llm.numCtx;
  if (config.llm.provider === 'openai') return 1_000_000;
  if (config.llm.provider === 'anthropic') return 200_000;
  return config.llm.numCtx;
}

function omitsTemperature(config: AppConfig): boolean {
  return config.llm.provider === 'openai' && /^gpt-5(?:[.-]|$)/i.test(config.llm.model);
}

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ⚠ ${msg}`);
const err = (msg: string) => console.log(`  ✗ ${msg}`);
const row = (label: string, value: string) =>
  console.log(`  ${label.padEnd(24)} ${value}`);

type SuggestedConfig = Record<string, Record<string, boolean | string | number>>;

// ── Ollama /api/show ──────────────────────────────────────────────────────────

async function fetchOllamaModelInfo(
  baseUrl: string,
  model: string,
): Promise<OllamaModelInfo | undefined> {
  try {
    const apiBase = baseUrl.replace(/\/v1\/?$/, '');
    const res = await fetch(`${apiBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return undefined;

    const data = (await res.json()) as {
      details?: { parameter_size?: string; quantization_level?: string; family?: string };
      parameters?: string;
      model_info?: Record<string, unknown>;
    };

    const details = data.details ?? {};
    const modelInfo = data.model_info ?? {};

    // Detect architecture prefix from model_info
    const arch =
      (modelInfo['general.architecture'] as string | undefined) ?? details.family ?? '';

    // Parameter count — prefer exact value from model_info
    const parameterCount =
      (modelInfo['general.parameter_count'] as number | undefined) ??
      parseParamSize(details.parameter_size ?? '0');

    const quantization = details.quantization_level ?? 'F16';

    // Native context length
    const nativeCtx =
      (modelInfo[`${arch}.context_length`] as number | undefined) ??
      (modelInfo['llama.context_length'] as number | undefined) ??
      0;

    // Architecture dimensions for KV cache estimation
    const blockCount =
      (modelInfo[`${arch}.block_count`] as number | undefined) ??
      (modelInfo['llama.block_count'] as number | undefined) ??
      0;
    const embeddingLength =
      (modelInfo[`${arch}.embedding_length`] as number | undefined) ??
      (modelInfo['llama.embedding_length'] as number | undefined) ??
      0;
    const headCount =
      (modelInfo[`${arch}.attention.head_count`] as number | undefined) ??
      (modelInfo['llama.attention.head_count'] as number | undefined) ??
      0;
    const kvHeadCount =
      (modelInfo[`${arch}.attention.head_count_kv`] as number | undefined) ??
      (modelInfo['llama.attention.head_count_kv'] as number | undefined) ??
      headCount;

    // num_ctx set in modelfile/parameters
    const numCtxMatch = /^num_ctx\s+(\d+)/m.exec(data.parameters ?? '');
    const modelfileNumCtx = numCtxMatch ? parseInt(numCtxMatch[1] ?? '0', 10) : undefined;

    return {
      parameterCount,
      quantization,
      nativeCtx,
      blockCount,
      embeddingLength,
      headCount,
      kvHeadCount,
      modelfileNumCtx,
    };
  } catch {
    return undefined;
  }
}

function estimateModelVram(info: OllamaModelInfo): number {
  const bitsPerWeight = QUANT_BITS[info.quantization] ?? 8;
  return Math.round((info.parameterCount * bitsPerWeight) / 8);
}

function estimateKvCache(
  info: OllamaModelInfo,
  numCtx: number,
  kvCacheType: string,
): number {
  if (!info.blockCount || !info.embeddingLength || !info.headCount) return 0;
  const headDim = Math.round(info.embeddingLength / info.headCount);
  const bytesPerElement = KV_CACHE_BYTES[kvCacheType] ?? 2;
  // KV: 2 (K+V) × numCtx × n_layers × n_kv_heads × head_dim × bytes
  return Math.round(
    2 * numCtx * info.blockCount * info.kvHeadCount * headDim * bytesPerElement,
  );
}

// ── Ollama env resolution ─────────────────────────────────────────────────────

interface ResolvedOllamaEnv {
  source: string;
  env: Partial<Record<string, string>>;
  isRemote: boolean;
}

function isRemoteOllama(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return !['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function isLocalHostUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function looksLikeMlx(config: AppConfig): boolean {
  return (
    config.llm.provider === 'openai-compatible' &&
    (config.llm.model.toLowerCase().includes('mlx') ||
      config.llm.baseUrl?.includes(':8080') ||
      isLocalHostUrl(config.llm.baseUrl))
  );
}

function resolveOllamaEnv(
  detected: { source: string; env: Partial<Record<string, string>> },
  config: AppConfig,
): ResolvedOllamaEnv {
  const isRemote = isRemoteOllama(config.llm.baseUrl);
  const merged: Partial<Record<string, string>> = isRemote ? {} : { ...detected.env };
  let wikircOverride = false;

  if (config.llm.flashAttention !== undefined) {
    merged.OLLAMA_FLASH_ATTENTION = config.llm.flashAttention ? '1' : '0';
    wikircOverride = true;
  }
  if (config.llm.kvCacheType) {
    merged.OLLAMA_KV_CACHE_TYPE = config.llm.kvCacheType;
    wikircOverride = true;
  }

  const source = isRemote ? 'remote-wikirc' : wikircOverride ? 'wikirc' : detected.source;

  return { source, env: merged, isRemote };
}

// ── Ollama process env ────────────────────────────────────────────────────────

const OLLAMA_ENV_KEYS = [
  'OLLAMA_CONTEXT_LENGTH',
  'OLLAMA_FLASH_ATTENTION',
  'OLLAMA_KV_CACHE_TYPE',
] as const;

function readOllamaProcessEnv(): {
  source: 'ollama-process' | 'cli-shell';
  env: Partial<Record<string, string>>;
} {
  try {
    const pidStr = execSync('pgrep -n -f "ollama serve"', {
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pid = parseInt(pidStr, 10);
    if (!pid || isNaN(pid)) return { source: 'cli-shell', env: process.env };

    const platform = os.platform();
    let text: string;
    if (platform === 'darwin') {
      text = execSync(`ps eww -p ${pid}`, {
        timeout: 2000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } else if (platform === 'linux') {
      text = execSync(`cat /proc/${pid}/environ`, {
        timeout: 2000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).replace(/\0/g, ' ');
    } else {
      return { source: 'cli-shell', env: process.env };
    }

    const found: Partial<Record<string, string>> = {};
    for (const key of OLLAMA_ENV_KEYS) {
      const match = new RegExp(`${key}=(\\S+)`).exec(text);
      if (match?.[1]) found[key] = match[1];
    }
    return { source: 'ollama-process', env: found };
  } catch {
    return { source: 'cli-shell', env: process.env };
  }
}

function printSuggestions(suggestions: SuggestedConfig): void {
  console.log('\n── Suggested .wikirc.yaml changes ───────────────────────────');
  for (const [section, keys] of Object.entries(suggestions)) {
    console.log(`  ${section}:`);
    for (const [key, value] of Object.entries(keys)) {
      console.log(`    ${key}: ${value}`);
    }
  }
}

function applySuggestionsToObject(
  rawConfig: unknown,
  suggestions: SuggestedConfig,
): Record<string, unknown> {
  const next =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? { ...(rawConfig as Record<string, unknown>) }
      : {};

  for (const [section, keys] of Object.entries(suggestions)) {
    const currentSection =
      next[section] && typeof next[section] === 'object' && !Array.isArray(next[section])
        ? { ...(next[section] as Record<string, unknown>) }
        : {};
    for (const [key, value] of Object.entries(keys)) {
      currentSection[key] = value;
    }
    next[section] = currentSection;
  }

  return next;
}

async function confirmApplySuggestions(
  config: AppConfig,
  suggestions: SuggestedConfig,
): Promise<void> {
  if (Object.keys(suggestions).length === 0) return;
  if (!process.stdin.isTTY) return;

  const configPath = config.configPath ?? path.join(config.wikiRoot, '.wikirc.yaml');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\nApply these changes to ${configPath}? [y/N] `);
    if (!/^(y|yes|o|oui)$/i.test(answer.trim())) {
      console.log('No changes written.');
      return;
    }
  } finally {
    rl.close();
  }

  const rawText = (await pathExists(configPath))
    ? await readFile(configPath, 'utf8')
    : '';
  const rawConfig = rawText.trim() ? YAML.parse(rawText) : {};
  const nextConfig = applySuggestionsToObject(rawConfig, suggestions);
  await safeWriteFile(configPath, YAML.stringify(nextConfig));
  ok(`Updated ${configPath}`);
}

// ── provider connectivity ─────────────────────────────────────────────────────

async function checkProvider(
  config: AppConfig,
  ollamaEnv: ResolvedOllamaEnv,
): Promise<{
  ollamaInfo?: OllamaModelInfo;
  effectiveNumCtx?: number;
  effectiveNumCtxSource?: string;
}> {
  const { provider, baseUrl, apiKey, model } = config.llm;

  if (provider !== 'ollama') {
    try {
      const url = `${baseUrl}/models`;
      const headers: Record<string, string> =
        provider === 'anthropic'
          ? { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${apiKey ?? ''}` };
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok || res.status === 400) {
        ok(`${provider} reachable at ${baseUrl}`);
        ok('API key accepted');
      } else if (res.status === 401 || res.status === 403) {
        ok(`${provider} reachable at ${baseUrl}`);
        err('API key invalid or missing');
      } else {
        warn(`${provider} responded with HTTP ${res.status}`);
      }
    } catch (e) {
      err(
        `${provider} not reachable at ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return {};
  }

  // Ollama: connectivity + model check
  const apiBase = baseUrl!.replace(/\/v1\/?$/, '');
  let modelFound = false;
  try {
    const res = await fetch(`${apiBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    ok(`Ollama reachable at ${baseUrl}`);
    modelFound = models.some(
      (m) => m.name === model || m.name.startsWith(model.split(':')[0] ?? model),
    );
    if (modelFound) {
      ok(`Model ${model} available`);
    } else {
      const names = models
        .slice(0, 5)
        .map((m) => m.name)
        .join(', ');
      warn(`Model ${model} not found — available: ${names || '(none)'}`);
    }
  } catch (e) {
    err(
      `Ollama not reachable at ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return {};
  }

  if (!modelFound) return {};

  // Fetch model details
  const ollamaInfo = await fetchOllamaModelInfo(baseUrl!, model);
  if (!ollamaInfo) {
    warn('Could not fetch model details from /api/show');
    return {};
  }

  // Effective numCtx priority: .wikirc.yaml (sent per-request) > local Ollama
  // process env > modelfile > model native. For remote Ollama, the server env
  // is intentionally unknown unless numCtx is configured explicitly.
  const envCtxVal = ollamaEnv.env.OLLAMA_CONTEXT_LENGTH
    ? parseInt(ollamaEnv.env.OLLAMA_CONTEXT_LENGTH, 10)
    : undefined;
  const effectiveNumCtx =
    config.llm.numCtx ??
    envCtxVal ??
    ollamaInfo.modelfileNumCtx ??
    (ollamaInfo.nativeCtx > 0 ? ollamaInfo.nativeCtx : undefined);
  const effectiveNumCtxSource = config.llm.numCtx
    ? '.wikirc.yaml'
    : envCtxVal
      ? 'OLLAMA_CONTEXT_LENGTH'
      : ollamaInfo.modelfileNumCtx
        ? 'modelfile'
        : 'Ollama default';

  return { ollamaInfo, effectiveNumCtx, effectiveNumCtxSource };
}

// ── hardware section (Ollama only) ────────────────────────────────────────────

function printOllamaHardware(
  config: AppConfig,
  info: OllamaModelInfo,
  effectiveNumCtx: number | undefined,
  effectiveNumCtxSource: string,
  suggestions: SuggestedConfig,
  resolvedEnv: ResolvedOllamaEnv,
): void {
  console.log('\n── System & model ───────────────────────────────────────────');

  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  row('System RAM:', `${gb(totalRam)} total, ${gb(freeRam)} free`);
  row('Platform:', `${os.platform()} ${os.arch()}`);

  const paramStr =
    info.parameterCount > 0 ? `${(info.parameterCount / 1e9).toFixed(1)}B` : '(unknown)';
  row('Model:', `${paramStr} params, ${info.quantization}`);

  if (info.nativeCtx > 0) {
    row('Native ctx length:', `${info.nativeCtx.toLocaleString()} tokens`);
  }

  const { source, env: ollamaEnv, isRemote } = resolvedEnv;
  const envCtx = isRemote ? undefined : ollamaEnv.OLLAMA_CONTEXT_LENGTH;
  const envFlash = ollamaEnv.OLLAMA_FLASH_ATTENTION;
  const envKvTypeRaw = ollamaEnv.OLLAMA_KV_CACHE_TYPE;
  const envKvType = (envKvTypeRaw ?? 'f16').toLowerCase();

  if (isRemote) {
    warn(
      `Remote Ollama server (${config.llm.baseUrl}) — OLLAMA_* env vars cannot be auto-detected`,
    );
    warn(
      '  Set flashAttention and kvCacheType in .wikirc.yaml for accurate recommendations',
    );
  }

  const wikiRcSuffix = (field: boolean) => (field ? ' (from .wikirc.yaml)' : '');
  row(
    'OLLAMA_CONTEXT_LENGTH:',
    isRemote
      ? '(unknown — remote server, numCtx takes precedence)'
      : (envCtx ?? '(not set — Ollama default)'),
  );
  row(
    'OLLAMA_FLASH_ATTENTION:',
    envFlash
      ? `${envFlash}${wikiRcSuffix(config.llm.flashAttention !== undefined)}`
      : isRemote
        ? '(not configured — set flashAttention in .wikirc.yaml)'
        : '(not set)',
  );
  row(
    'OLLAMA_KV_CACHE_TYPE:',
    envKvTypeRaw
      ? `${envKvType}${wikiRcSuffix(!!config.llm.kvCacheType)}`
      : isRemote
        ? '(not configured — set kvCacheType in .wikirc.yaml)'
        : envKvType,
  );

  const displayNumCtx = effectiveNumCtx ?? 2048;
  row(
    'Effective numCtx:',
    `${displayNumCtx.toLocaleString()} tokens (from ${effectiveNumCtxSource})`,
  );

  // VRAM estimates
  const modelVram = info.parameterCount > 0 ? estimateModelVram(info) : 0;
  const kvCacheBytes =
    info.blockCount > 0 ? estimateKvCache(info, displayNumCtx, envKvType) : 0;
  const totalEstimate = modelVram + kvCacheBytes;

  if (modelVram > 0) {
    row('Estimated model RAM:', gb(modelVram));
  }
  if (kvCacheBytes > 0) {
    row(
      'Estimated KV cache:',
      `${gb(kvCacheBytes)} (${envKvType}, ctx=${displayNumCtx.toLocaleString()})`,
    );
  }
  if (totalEstimate > 0) {
    row('Estimated total RAM:', gb(totalEstimate));
    if (totalEstimate > freeRam) {
      warn(
        `Estimated RAM (${gb(totalEstimate)}) exceeds free RAM (${gb(freeRam)}) — model may be slow or crash`,
      );
    } else if (totalEstimate > totalRam * 0.8) {
      warn(
        `Estimated RAM (${gb(totalEstimate)}) is >80% of total (${gb(totalRam)}) — little headroom`,
      );
    } else {
      ok(`RAM looks sufficient (${gb(totalEstimate)} needed, ${gb(freeRam)} free)`);
    }
  }

  // Cross-checks and recommendations
  const envSource = isRemote
    ? '(remote Ollama — config from .wikirc.yaml)'
    : source === 'wikirc'
      ? '(local Ollama — overrides from .wikirc.yaml)'
      : source === 'ollama-process'
        ? '(Ollama process)'
        : '(CLI shell — may differ from Ollama server)';
  console.log(`\n── Ollama checks ${envSource} ──────────────────────────────`);

  if (!config.llm.numCtx) {
    err(
      `numCtx not set in .wikirc.yaml — effective ctx is ${displayNumCtx.toLocaleString()} tokens (from ${effectiveNumCtxSource})`,
    );
    const suggested = info.nativeCtx > 0 ? Math.min(info.nativeCtx, 32768) : 32768;
    (suggestions.llm ??= {}).numCtx = suggested;
  } else if (info.nativeCtx > 0 && config.llm.numCtx > info.nativeCtx) {
    warn(
      `numCtx ${config.llm.numCtx.toLocaleString()} > model native max ${info.nativeCtx.toLocaleString()} — Ollama will cap it`,
    );
    (suggestions.llm ??= {}).numCtx = info.nativeCtx;
  } else {
    ok(
      `numCtx ${config.llm.numCtx?.toLocaleString()} (model native max: ${info.nativeCtx > 0 ? info.nativeCtx.toLocaleString() : '?'})`,
    );
  }

  if (!envFlash) {
    const fix = isRemote
      ? 'add  flashAttention: true  in .wikirc.yaml (llm section)'
      : 'launchctl setenv OLLAMA_FLASH_ATTENTION 1';
    warn(`OLLAMA_FLASH_ATTENTION not set — recommended for faster inference: ${fix}`);
  } else if (envFlash === '1') {
    ok('OLLAMA_FLASH_ATTENTION=1');
  }

  if (!envKvTypeRaw || envKvType === 'f16') {
    const fix = isRemote
      ? 'add  kvCacheType: q8_0  in .wikirc.yaml (llm section)'
      : 'set OLLAMA_KV_CACHE_TYPE=q8_0 in your Ollama server environment';
    warn(
      `OLLAMA_KV_CACHE_TYPE=f16 ${isRemote ? '(assumed default)' : '(default)'} — q8_0 halves KV cache memory with minimal quality loss`,
    );
    if (kvCacheBytes > 0) {
      const saved = kvCacheBytes / 2;
      warn(`  → ${fix} would save ~${gb(saved)} of KV cache`);
    }
  } else {
    ok(`OLLAMA_KV_CACHE_TYPE=${envKvType}`);
  }

  if (info.modelfileNumCtx && !config.llm.numCtx) {
    ok(`Modelfile num_ctx: ${info.modelfileNumCtx.toLocaleString()}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

export default async function doctorCmd(config: AppConfig): Promise<void> {
  console.log('\n── Config ──────────────────────────────────────────────────');
  row('provider:', config.llm.provider);
  row('model:', config.llm.model);
  row('language:', config.language);
  if (config.llm.numCtx) row('numCtx:', config.llm.numCtx.toLocaleString());
  row('temperature:', String(config.llm.temperature));
  row('refreshOnIngest:', String(config.build.refreshOnIngest));
  row('slotBatchSize:', String(config.build.slotBatchSize));
  row('maxContextFiles:', String(config.retrieval.maxContextFiles));
  row('maxChunksPerPage:', String(config.retrieval.maxChunksPerPage));
  row('maxChunkChars:', String(config.retrieval.maxChunkChars));
  row('maxSourceChars:', String(config.retrieval.maxSourceChars));

  console.log('\n── Provider ────────────────────────────────────────────────');
  const rawOllamaEnv = readOllamaProcessEnv();
  const resolvedOllamaEnv = resolveOllamaEnv(rawOllamaEnv, config);
  const suggestions: SuggestedConfig = {};
  const { ollamaInfo, effectiveNumCtx, effectiveNumCtxSource } = await checkProvider(
    config,
    resolvedOllamaEnv,
  );

  if (config.llm.provider === 'ollama' && ollamaInfo) {
    printOllamaHardware(
      config,
      ollamaInfo,
      effectiveNumCtx,
      effectiveNumCtxSource ?? 'Ollama default',
      suggestions,
      resolvedOllamaEnv,
    );
  }

  if (looksLikeMlx(config)) {
    console.log('\n── OpenAI-compatible local server ───────────────────────────');
    warn(
      'Local OpenAI-compatible server detected. For MLX, .wikirc llm.numCtx is advisory only; set the runtime context/output limit on mlx_lm.server.',
    );
    if ((config.llm.numCtx ?? 0) >= 32768) {
      warn(
        `numCtx ${config.llm.numCtx?.toLocaleString()} with MLX can encourage oversized prompts and high KV memory use`,
      );
      (suggestions.llm ??= {}).numCtx = 8192;
    }
    if (config.build.slotBatchSize > 1) {
      warn(
        `slotBatchSize ${config.build.slotBatchSize} → 1 recommended for local MLX JSON reliability and lower memory pressure`,
      );
      (suggestions.build ??= {}).slotBatchSize = 1;
    }
    if (config.retrieval.maxContextFiles > 4) {
      warn(
        `maxContextFiles ${config.retrieval.maxContextFiles} → 4 recommended for local MLX; raise gradually if refresh is stable`,
      );
      (suggestions.retrieval ??= {}).maxContextFiles = 4;
    }
    if (config.retrieval.maxChunkChars > 1200) {
      warn(
        `maxChunkChars ${config.retrieval.maxChunkChars} → 1200 recommended for local MLX/Metal memory headroom`,
      );
      (suggestions.retrieval ??= {}).maxChunkChars = 1200;
    }
    if (config.retrieval.maxSourceChars > 8000) {
      warn(
        `maxSourceChars ${config.retrieval.maxSourceChars} → 8000 recommended for local MLX ingest prompts`,
      );
      (suggestions.retrieval ??= {}).maxSourceChars = 8000;
    }
    console.log('  Suggested MLX server command:');
    console.log(
      `    mlx_lm.server --model ${config.llm.model} --port 8080 --max-tokens 4096`,
    );
    console.log('  If stable, try --max-tokens 8192 before raising retrieval limits.');
  }

  // ── wiki content ────────────────────────────────────────────────────────────
  console.log('\n── Wiki content ────────────────────────────────────────────');
  const workspace = new WorkspaceService(config);
  if (!(await pathExists(workspace.paths.wikiIndexPath))) {
    warn('wiki/index.md missing — run `wiki init` to create it (continuing with partial data)');
  }

  const [pages, rawIngestedPages, indexContent, untrackedPaths, buildContext] =
    await Promise.all([
      workspace.listWikiPages(),
      workspace.listIngestedSourcePages(),
      workspace.readIndex(),
      workspace.listUntrackedSourcePaths(),
      workspace.readBuildContext(),
    ]);

  const untrackedContents = await Promise.all(
    untrackedPaths.map(async (p) => {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(p, 'utf8');
      return { path: p, size: content.length };
    }),
  );

  const pageSizes = pages.map((p) => p.content.length);
  const allChunks = pages.flatMap((p) => splitByHeadings(p.content));
  const chunkSizes = allChunks.map((c) => c.content.length);
  const untrackedSizes = untrackedContents.map((u) => u.size);
  const maxUntracked = untrackedSizes.length > 0 ? Math.max(...untrackedSizes) : 0;

  row(
    'wiki pages:',
    `${pages.length} (avg ${avg(pageSizes)} chars, max ${pageSizes.length > 0 ? Math.max(...pageSizes) : 0} chars)`,
  );
  row(
    'chunks:',
    `${allChunks.length} (avg ${avg(chunkSizes)} chars, p95 ${pct(chunkSizes, 95)} chars, max ${chunkSizes.length > 0 ? Math.max(...chunkSizes) : 0} chars)`,
  );
  row('index.md:', `${indexContent.length} chars`);
  row(
    'build-context:',
    buildContext.truncated
      ? `${buildContext.fileCount} file(s), ${buildContext.rawTotalChars}/${config.build.maxBuildContextChars} chars (truncated)`
      : `${buildContext.fileCount} file(s), ${buildContext.content.length}/${config.build.maxBuildContextChars} chars`,
  );
  row('ingested (archive):', `${rawIngestedPages.length} file(s) in raw/ingested`);
  row(
    'pending ingest:',
    `${untrackedPaths.length} file(s) in raw/untracked${untrackedSizes.length > 0 ? ` (avg ${avg(untrackedSizes)} chars, max ${maxUntracked} chars)` : ''}`,
  );

  const largeUntracked = untrackedContents.filter(
    (u) => u.size > config.retrieval.maxSourceChars,
  );
  if (largeUntracked.length > 0) {
    warn(
      `${largeUntracked.length} pending file(s) in raw/untracked exceed maxSourceChars (${config.retrieval.maxSourceChars}) — body will be truncated at ingest`,
    );
  }
  const truncatedChunks = allChunks.filter(
    (c) => c.content.length > config.retrieval.maxChunkChars,
  );
  if (truncatedChunks.length > 0) {
    warn(
      `${truncatedChunks.length}/${allChunks.length} chunks exceed maxChunkChars and will be truncated`,
    );
  }

  // ── context budget ───────────────────────────────────────────────────────────
  const numCtxTokens = effectiveNumCtx ?? contextWindowTokens(config);
  const SAFE_FILL = 0.9;
  const slotContent = config.retrieval.maxContextFiles * config.retrieval.maxChunkChars;
  const baseOverhead = indexContent.length + SYSTEM_PROMPT_OVERHEAD;
  const buildContextChars = buildContext.content.length;
  const overhead = baseOverhead + buildContextChars;

  let available = 0;
  let buildBudget = 0;
  let optimalSlotBatchSize = 1;
  let safeBatchSize = 1;
  let perSlotBudget = 0;
  let fillRatio = 0;

  if (!numCtxTokens) {
    warn(
      'Context window unknown for openai-compatible — set numCtx in .wikirc.yaml for full budget analysis',
    );
  } else {
    const totalChars = numCtxTokens * CHARS_PER_TOKEN;
    available = Math.round(totalChars * (1 - OUTPUT_RESERVE));
    buildBudget = available - overhead;

    console.log('\n── Context budget ───────────────────────────────────────────');
    row(
      'context window:',
      `${numCtxTokens.toLocaleString()} tokens → ~${Math.round(totalChars / 1000)}k chars`,
    );
    row(
      'output reserve:',
      `${OUTPUT_RESERVE * 100}% → ~${Math.round(available / 1000)}k chars available`,
    );
    row(
      'fixed overhead:',
      `~${Math.round(overhead / 1000)}k chars (index + build-context + system)`,
    );
    row(
      'overhead detail:',
      `index ${indexContent.length} + build-context ${buildContextChars} + system ~${SYSTEM_PROMPT_OVERHEAD} chars`,
    );
    if (buildContext.truncated) {
      warn(
        `build-context truncated: ${buildContext.rawTotalChars} chars in build-context/, maxBuildContextChars=${config.build.maxBuildContextChars}`,
      );
    }
    row(
      'slot content:',
      `${config.retrieval.maxContextFiles} files × ${config.retrieval.maxChunkChars} chars = ~${Math.round(slotContent / 1000)}k chars/slot`,
    );

    if (buildBudget <= 0) {
      err(
        `fixed overhead exceeds available context by ~${Math.round(Math.abs(buildBudget) / 1000)}k chars`,
      );
      (suggestions.llm ??= {}).numCtx = Math.ceil(
        overhead / (1 - OUTPUT_RESERVE) / CHARS_PER_TOKEN,
      );
      printSuggestions(suggestions);
      await confirmApplySuggestions(config, suggestions);
      console.log('');
      return;
    }

    optimalSlotBatchSize = Math.max(1, Math.min(Math.floor(buildBudget / slotContent), 20));
    safeBatchSize = Math.max(
      1,
      Math.min(Math.floor((buildBudget * SAFE_FILL) / slotContent), 20),
    );
    perSlotBudget = Math.floor(buildBudget / config.build.slotBatchSize);
    fillRatio = (config.build.slotBatchSize * slotContent) / buildBudget;
    row(
      'max slotBatchSize:',
      `${optimalSlotBatchSize} (100% fill), ${safeBatchSize} safe (${SAFE_FILL * 100}% fill)`,
    );
    row(
      'current fill:',
      `${Math.round(fillRatio * 100)}% — ${config.build.slotBatchSize} slots × ~${Math.round(slotContent / 1000)}k = ~${Math.round((config.build.slotBatchSize * slotContent) / 1000)}k / ~${Math.round(buildBudget / 1000)}k chars`,
    );
    row(
      'per-slot budget:',
      `~${Math.round(perSlotBudget / 1000)}k chars (with current slotBatchSize=${config.build.slotBatchSize})`,
    );
  }

  // ── recommendations ──────────────────────────────────────────────────────────
  console.log('\n── Recommendations ──────────────────────────────────────────');
  let hasWarnings = false;
  const canRecommendLargerPrompts =
    config.llm.provider === 'ollama' || config.llm.provider === 'openai-compatible';

  if (omitsTemperature(config)) {
    ok(
      `temperature ${config.llm.temperature} omitted for ${config.llm.provider}/${config.llm.model}`,
    );
  } else if (config.llm.temperature > 0.15) {
    warn(
      `temperature ${config.llm.temperature} → 0.1 recommended for structured JSON tasks`,
    );
    (suggestions.llm ??= {}).temperature = 0.1;
    hasWarnings = true;
  } else {
    ok(`temperature ${config.llm.temperature}`);
  }

  const p95chunk = pct(chunkSizes, 95);
  const recommendedChunkChars =
    chunkSizes.length > 0 ? Math.max(Math.min(p95chunk + 200, 6000), 800) : 3000;
  if (
    recommendedChunkChars < config.retrieval.maxChunkChars - 500 ||
    (canRecommendLargerPrompts &&
      recommendedChunkChars > config.retrieval.maxChunkChars + 500)
  ) {
    warn(
      `maxChunkChars ${config.retrieval.maxChunkChars} → ${recommendedChunkChars} (p95 chunk: ${p95chunk} chars)`,
    );
    (suggestions.retrieval ??= {}).maxChunkChars = recommendedChunkChars;
    hasWarnings = true;
  } else if (recommendedChunkChars > config.retrieval.maxChunkChars + 500) {
    ok(
      `maxChunkChars ${config.retrieval.maxChunkChars} (p95 chunk ${p95chunk} chars; keeping remote-provider prompt size conservative)`,
    );
  } else {
    ok(`maxChunkChars ${config.retrieval.maxChunkChars} (p95 chunk: ${p95chunk} chars)`);
  }

  const sourceBudgetCap = available > 0 ? Math.floor(available * 0.15) : 50_000;
  const recommendedSourceChars =
    untrackedSizes.length > 0
      ? Math.max(
          config.retrieval.maxSourceChars,
          Math.min(maxUntracked + 500, sourceBudgetCap),
        )
      : config.retrieval.maxSourceChars;
  if (maxUntracked > config.retrieval.maxSourceChars) {
    if (recommendedSourceChars > config.retrieval.maxSourceChars) {
      warn(
        `maxSourceChars ${config.retrieval.maxSourceChars} → ${recommendedSourceChars} (largest pending source: ${maxUntracked} chars)`,
      );
      (suggestions.retrieval ??= {}).maxSourceChars = recommendedSourceChars;
    } else {
      warn(
        `largest pending source (${maxUntracked} chars) exceeds maxSourceChars ${config.retrieval.maxSourceChars}, but the context budget does not leave room to raise it safely`,
      );
    }
    hasWarnings = true;
  } else if (untrackedSizes.length > 0) {
    ok(
      `maxSourceChars ${config.retrieval.maxSourceChars} (largest pending source: ${maxUntracked} chars)`,
    );
  } else {
    ok(
      `maxSourceChars ${config.retrieval.maxSourceChars} (no pending sources in raw/untracked)`,
    );
  }

  if (numCtxTokens && buildBudget > 0) {
    const currentPerSlotUsage = slotContent;
    const effectiveChunkSize = Math.max(avg(chunkSizes) || recommendedChunkChars, 400);
    const recommendedMaxContextFiles = Math.min(
      Math.floor(perSlotBudget / effectiveChunkSize),
      16,
    );
    if (currentPerSlotUsage > perSlotBudget) {
      err(
        `maxContextFiles ${config.retrieval.maxContextFiles} × maxChunkChars ${config.retrieval.maxChunkChars} = ${currentPerSlotUsage} chars/slot exceeds per-slot budget (~${perSlotBudget} chars)`,
      );
      (suggestions.retrieval ??= {}).maxContextFiles = Math.max(
        Math.floor(perSlotBudget / config.retrieval.maxChunkChars),
        1,
      );
      hasWarnings = true;
    } else if (
      canRecommendLargerPrompts &&
      recommendedMaxContextFiles > config.retrieval.maxContextFiles + 1
    ) {
      warn(
        `maxContextFiles ${config.retrieval.maxContextFiles} → ${recommendedMaxContextFiles} (budget allows, avg chunk ${effectiveChunkSize} chars)`,
      );
      (suggestions.retrieval ??= {}).maxContextFiles = recommendedMaxContextFiles;
      hasWarnings = true;
    } else {
      ok(
        `maxContextFiles ${config.retrieval.maxContextFiles} (${Math.round(currentPerSlotUsage / 1000)}k / ~${Math.round(perSlotBudget / 1000)}k chars per slot)`,
      );
    }

    if (config.build.slotBatchSize > optimalSlotBatchSize) {
      err(
        `slotBatchSize ${config.build.slotBatchSize} overflows context window (max ${optimalSlotBatchSize} slots fit)` +
          ` — reduce to ${safeBatchSize} to leave ${Math.round((1 - SAFE_FILL) * 100)}% headroom`,
      );
      (suggestions.build ??= {}).slotBatchSize = safeBatchSize;
      hasWarnings = true;
    } else if (config.build.slotBatchSize > safeBatchSize) {
      warn(
        `slotBatchSize ${config.build.slotBatchSize} fills ${Math.round(fillRatio * 100)}% of context budget` +
          ` — instruction text and JSON overhead may push past the limit (HTTP 500).` +
          ` Reduce to ${safeBatchSize} for a safe margin.`,
      );
      (suggestions.build ??= {}).slotBatchSize = safeBatchSize;
      hasWarnings = true;
    } else if (
      canRecommendLargerPrompts &&
      optimalSlotBatchSize > config.build.slotBatchSize + 1 &&
      fillRatio < 0.7
    ) {
      const ollamaNoFlash =
        config.llm.provider === 'ollama' &&
        resolvedOllamaEnv.env.OLLAMA_FLASH_ATTENTION !== '1';
      if (ollamaNoFlash) {
        ok(
          `slotBatchSize ${config.build.slotBatchSize} (${Math.round(fillRatio * 100)}% fill — enable OLLAMA_FLASH_ATTENTION before increasing batch size)`,
        );
      } else {
        warn(
          `slotBatchSize ${config.build.slotBatchSize} → ${safeBatchSize} recommended` +
            ` — context window could fit more slots, fewer LLM calls per template`,
        );
        (suggestions.build ??= {}).slotBatchSize = safeBatchSize;
        hasWarnings = true;
      }
    } else {
      ok(
        `slotBatchSize ${config.build.slotBatchSize} (${Math.round(fillRatio * 100)}% fill, safe up to ${safeBatchSize})`,
      );
    }

    const BUILD_CONTEXT_FRACTION = 0.15;
    const currentBatchContent = config.build.slotBatchSize * slotContent;
    const maxBuildContextForCurrentConfig = Math.max(
      0,
      Math.floor(available - baseOverhead - currentBatchContent / SAFE_FILL),
    );
    const fractionalBuildContextChars =
      Math.round((available * BUILD_CONTEXT_FRACTION) / 500) * 500;
    const recommendedBuildContextChars = Math.floor(
      Math.max(
        0,
        Math.min(
          maxBuildContextForCurrentConfig >= 4000 ? fractionalBuildContextChars : 0,
          maxBuildContextForCurrentConfig,
        ),
      ),
    );
    if (buildContext.truncated) {
      if (
        canRecommendLargerPrompts &&
        recommendedBuildContextChars > config.build.maxBuildContextChars
      ) {
        warn(
          `build.maxBuildContextChars ${config.build.maxBuildContextChars} → ${recommendedBuildContextChars}` +
            ` — ${buildContext.rawTotalChars} chars in build-context/ exceed the limit` +
            ` (capped by current build/retrieval limits and ≈${BUILD_CONTEXT_FRACTION * 100}% of available context)`,
        );
        (suggestions.build ??= {}).maxBuildContextChars = recommendedBuildContextChars;
        hasWarnings = true;
      } else {
        warn(
          `build-context ${buildContext.rawTotalChars} chars exceeds maxBuildContextChars (${config.build.maxBuildContextChars})` +
            (canRecommendLargerPrompts
              ? ` — current build/retrieval limits leave at most ${recommendedBuildContextChars} safe chars for build-context/; trim files or reduce slot/context limits`
              : ` — keeping remote-provider prompt size conservative; trim build-context/ files or raise maxBuildContextChars manually`),
        );
        hasWarnings = true;
      }
    } else if (buildContextChars > maxBuildContextForCurrentConfig) {
      warn(
        `build-context uses ${buildContextChars} chars, but current build/retrieval limits leave at most ${maxBuildContextForCurrentConfig} safe chars` +
          ` — reduce maxBuildContextChars, slotBatchSize, maxContextFiles, or maxChunkChars`,
      );
      if (maxBuildContextForCurrentConfig < config.build.maxBuildContextChars) {
        (suggestions.build ??= {}).maxBuildContextChars = maxBuildContextForCurrentConfig;
      }
      hasWarnings = true;
    } else {
      ok(
        `maxBuildContextChars ${config.build.maxBuildContextChars} (${buildContextChars} chars used, safe up to ${maxBuildContextForCurrentConfig})`,
      );
    }
  } else if (!numCtxTokens) {
    if (buildContext.truncated) {
      warn(
        `build-context ${buildContext.rawTotalChars} chars exceeds maxBuildContextChars (${config.build.maxBuildContextChars}) — raise to at least ${buildContext.rawTotalChars}`,
      );
      (suggestions.build ??= {}).maxBuildContextChars = buildContext.rawTotalChars + 500;
      hasWarnings = true;
    }
    warn(
      'Set numCtx in .wikirc.yaml to enable slotBatchSize, maxContextFiles, and context budget recommendations',
    );
  }

  // ── Ollama inference speed ───────────────────────────────────────────────────
  if (config.llm.provider === 'ollama' && ollamaInfo) {
    console.log('\n── Ollama inference speed ───────────────────────────────────');

    const flashEnabled = resolvedOllamaEnv.env.OLLAMA_FLASH_ATTENTION === '1';
    const kvType = (resolvedOllamaEnv.env.OLLAMA_KV_CACHE_TYPE ?? 'f16').toLowerCase();
    const { isRemote: isRemoteServer } = resolvedOllamaEnv;

    if (isRemoteServer && !config.llm.flashAttention && !config.llm.kvCacheType) {
      warn(
        'Remote Ollama — flashAttention and kvCacheType not set in .wikirc.yaml; speed analysis uses defaults (f16, no flash attention)',
      );
    }

    // Primary driver of per-call latency
    const retrievalCharsPerBatch =
      config.build.slotBatchSize *
      config.retrieval.maxContextFiles *
      config.retrieval.maxChunkChars;
    const inputCharsPerBatch = retrievalCharsPerBatch + overhead;
    const inputTokensPerBatch = Math.round(inputCharsPerBatch / CHARS_PER_TOKEN);
    row(
      'Input context/batch:',
      `${config.build.slotBatchSize} slots × ${config.retrieval.maxContextFiles} files × ${config.retrieval.maxChunkChars} chars` +
        ` + ~${Math.round(overhead / 1000)}k fixed` +
        ` ≈ ${Math.round(inputCharsPerBatch / 1000)}k chars (~${inputTokensPerBatch.toLocaleString()} tokens)`,
    );

    // Priority 1: flash attention — O(n²) → O(n) prefill, no quality or context loss
    if (!flashEnabled) {
      err(
        `OLLAMA_FLASH_ATTENTION not set — at ~${inputTokensPerBatch.toLocaleString()} tokens/batch, prefill scales O(n²) and is likely the main per-call bottleneck`,
      );
      if (isRemoteServer) {
        console.log('    Fix: add  flashAttention: true  in .wikirc.yaml (llm section)');
      } else {
        console.log('    Fix: launchctl setenv OLLAMA_FLASH_ATTENTION 1');
        console.log('         then restart Ollama');
      }
      hasWarnings = true;
    } else {
      ok('OLLAMA_FLASH_ATTENTION=1 — prefill scales linearly, not quadratically');
    }

    // Priority 2: numCtx vs actual prompt — oversized numCtx wastes KV cache, no quality loss
    const totalInputTokens = inputTokensPerBatch;
    const ctxUtilization = effectiveNumCtx ? totalInputTokens / effectiveNumCtx : 1;
    if (effectiveNumCtx && ctxUtilization < 0.5 && effectiveNumCtx > 8192) {
      const suggestedCtx = Math.max(
        4096,
        Math.ceil((totalInputTokens * 1.5) / 1024) * 1024,
      );
      const kvBefore =
        ollamaInfo.blockCount > 0
          ? estimateKvCache(ollamaInfo, effectiveNumCtx, kvType)
          : 0;
      const kvAfter =
        ollamaInfo.blockCount > 0 ? estimateKvCache(ollamaInfo, suggestedCtx, kvType) : 0;
      const savedKv = kvBefore > 0 ? ` — saves ~${gb(kvBefore - kvAfter)} KV cache` : '';
      const suggestedSlotBatchSize =
        typeof suggestions.build?.slotBatchSize === 'number'
          ? suggestions.build.slotBatchSize
          : config.build.slotBatchSize;
      const suggestedMaxContextFiles =
        typeof suggestions.retrieval?.maxContextFiles === 'number'
          ? suggestions.retrieval.maxContextFiles
          : config.retrieval.maxContextFiles;
      const suggestedMaxChunkChars =
        typeof suggestions.retrieval?.maxChunkChars === 'number'
          ? suggestions.retrieval.maxChunkChars
          : config.retrieval.maxChunkChars;
      const suggestedInputChars =
        suggestedSlotBatchSize * suggestedMaxContextFiles * suggestedMaxChunkChars;
      const suggestedBuildBudget =
        suggestedCtx * CHARS_PER_TOKEN * (1 - OUTPUT_RESERVE) - overhead;
      const suggestedConfigFits =
        suggestedBuildBudget > 0 &&
        suggestedInputChars <= suggestedBuildBudget * SAFE_FILL;
      const suffix = suggestedConfigFits
        ? savedKv
        : ' if current retrieval/build limits are kept';
      warn(
        `numCtx ${effectiveNumCtx.toLocaleString()} but prompt uses ~${totalInputTokens.toLocaleString()} tokens` +
          ` (${Math.round(ctxUtilization * 100)}%) — numCtx ${suggestedCtx.toLocaleString()} is sufficient${suffix}`,
      );
      if (!suggestions.llm?.numCtx && suggestedConfigFits) {
        (suggestions.llm ??= {}).numCtx = suggestedCtx;
      }
      hasWarnings = true;
    } else if (effectiveNumCtx) {
      ok(
        `numCtx ${effectiveNumCtx.toLocaleString()} — prompt uses ~${totalInputTokens.toLocaleString()} tokens (${Math.round(ctxUtilization * 100)}%)`,
      );
    }

    // Priority 3: maxContextFiles — quality tradeoff, presented as option (not auto-suggested)
    const OLLAMA_FAST_TARGET_TOKENS = 4000;
    if (inputTokensPerBatch > OLLAMA_FAST_TARGET_TOKENS) {
      const fastRetrievalBudgetChars = Math.max(
        0,
        OLLAMA_FAST_TARGET_TOKENS * CHARS_PER_TOKEN - overhead,
      );
      const fastFiles = Math.max(
        1,
        Math.floor(
          fastRetrievalBudgetChars /
            (config.build.slotBatchSize * config.retrieval.maxChunkChars),
        ),
      );
      if (fastFiles < config.retrieval.maxContextFiles) {
        warn(
          `Speed option (quality tradeoff): maxContextFiles ${config.retrieval.maxContextFiles} → ${fastFiles}` +
            ` — reduces context/batch to ~${OLLAMA_FAST_TARGET_TOKENS.toLocaleString()} tokens` +
            `, fewer wiki pages per slot`,
        );
        hasWarnings = true;
      }
    } else {
      ok(
        `Context/batch ~${inputTokensPerBatch.toLocaleString()} tokens — reasonable for local inference`,
      );
    }
  }

  if (!hasWarnings && Object.keys(suggestions).length === 0) {
    ok('Configuration looks good for the current wiki');
  }

  if (Object.keys(suggestions).length > 0) {
    printSuggestions(suggestions);
    await confirmApplySuggestions(config, suggestions);
  }

  console.log('');
}
