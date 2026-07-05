import os from 'node:os';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { splitByHeadings, splitSourceSections } from '../utils/markdown.ts';
import { BuildService } from '../services/buildService.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { LLMService } from '../services/llmService.ts';
import { RerankService } from '../services/rerankService.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import {
  EMBED_BATCH_MAX_CHARS,
  EMBED_BATCH_SIZE,
  VectorIndexService,
} from '../services/vectorIndexService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import type { AppConfig } from '../types.ts';
import { pathExists, safeWriteFile } from '../utils/fs.ts';

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

const doctorStatus = { warnings: 0, errors: 0 };

function resetDoctorStatus(): void {
  doctorStatus.warnings = 0;
  doctorStatus.errors = 0;
}

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => {
  doctorStatus.warnings += 1;
  console.log(`  ⚠ ${msg}`);
};
const err = (msg: string) => {
  doctorStatus.errors += 1;
  console.log(`  ✗ ${msg}`);
};
const row = (label: string, value: string) =>
  console.log(`  ${label.padEnd(24)} ${value}`);

function printDoctorStatus(): void {
  console.log('\n── Doctor status ───────────────────────────────────────────');
  if (doctorStatus.errors > 0) {
    console.log(
      `  ✗ ${doctorStatus.errors} error(s), ${doctorStatus.warnings} warning(s)`,
    );
  } else if (doctorStatus.warnings > 0) {
    console.log(`  ⚠ 0 error(s), ${doctorStatus.warnings} warning(s)`);
  } else {
    console.log('  ✓ all checks passed');
  }
}

type SuggestedConfig = Record<string, Record<string, boolean | string | number>>;

function modelNamesFromModelsResponse(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const rawModels = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  return rawModels
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return undefined;
      const model = entry as Record<string, unknown>;
      return typeof model.id === 'string'
        ? model.id
        : typeof model.name === 'string'
          ? model.name
          : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
}

async function responseTextOrJson(res: Response): Promise<unknown> {
  const raw = await res.text();
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function recommendedMaxInputTokens(config: AppConfig): number {
  if (/albert\.api\.etalab\.gouv\.fr/i.test(config.llm.baseUrl)) {
    return 120000;
  }
  if (config.llm.provider === 'ollama' && config.llm.numCtx) {
    return Math.max(1000, Math.floor(config.llm.numCtx * 0.9));
  }
  return config.limits.maxInputTokensPerCall;
}

function recommendedTargetInputTokens(maxInputTokensPerCall: number): number {
  if (maxInputTokensPerCall >= 50000) {
    return 40000;
  }
  return Math.max(1000, Math.floor((maxInputTokensPerCall * 0.8) / 1000) * 1000);
}

function printYamlBlock(value: unknown): void {
  const yaml = YAML.stringify(value).trimEnd();
  for (const line of yaml.split('\n')) {
    console.log(`  ${line}`);
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry !== 'undefined'),
  ) as Partial<T>;
}

function sameConfigValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffConfigPatch(
  current: unknown,
  recommended: unknown,
): Record<string, unknown> | undefined {
  if (
    !recommended ||
    typeof recommended !== 'object' ||
    Array.isArray(recommended) ||
    !current ||
    typeof current !== 'object' ||
    Array.isArray(current)
  ) {
    return sameConfigValue(current, recommended)
      ? undefined
      : (recommended as Record<string, unknown>);
  }

  const patch: Record<string, unknown> = {};
  const currentRecord = current as Record<string, unknown>;
  for (const [key, value] of Object.entries(recommended as Record<string, unknown>)) {
    if (typeof value === 'undefined') continue;
    const childPatch = diffConfigPatch(currentRecord[key], value);
    if (typeof childPatch !== 'undefined') patch[key] = childPatch;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function deepMergeConfig(current: unknown, patch: unknown): Record<string, unknown> {
  const base =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (typeof value === 'undefined') continue;
    const currentValue = base[key];
    base[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
        ? deepMergeConfig(currentValue, value)
        : value;
  }

  return base;
}

async function applyRecommendedConfig(
  config: AppConfig,
  recommendedConfig: Record<string, unknown>,
): Promise<void> {
  const configPath = config.configPath ?? path.join(config.wikiRoot, '.wikirc.yaml');
  const rawText = (await pathExists(configPath))
    ? await readFile(configPath, 'utf8')
    : '';
  const rawConfig = rawText.trim() ? YAML.parse(rawText) : {};
  const nextConfig = deepMergeConfig(rawConfig, recommendedConfig);
  await safeWriteFile(configPath, YAML.stringify(nextConfig));
  ok(`Updated ${configPath}`);
}

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
        if (res.ok) {
          const models = modelNamesFromModelsResponse(await responseTextOrJson(res));
          if (models.length > 0 && !models.includes(model)) {
            err(
              `Model ${model} not listed by provider — available: ${models
                .slice(0, 5)
                .join(', ')}`,
            );
          } else if (models.includes(model)) {
            ok(`Model ${model} listed by provider`);
          }
        }
      } else if (res.status === 401 || res.status === 403) {
        ok(`${provider} reachable at ${baseUrl}`);
        err('API key invalid or missing');
      } else if (res.status === 429) {
        warn(`${provider} quota or rate limit reached while checking /models`);
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

export default async function doctorCmd(
  config: AppConfig,
  options: { apply?: boolean } = {},
): Promise<void> {
  resetDoctorStatus();
  console.log('\n── Config ──────────────────────────────────────────────────');
  row('provider:', config.llm.provider);
  row('model:', config.llm.model);
  row('language:', config.language);
  if (config.llm.numCtx) row('numCtx:', config.llm.numCtx.toLocaleString());
  row('temperature:', String(config.llm.temperature));
  row('requestsPerMinute:', String(config.limits.requestsPerMinute));
  row('maxInFlightRequests:', String(config.limits.maxInFlightRequests ?? 3));
  if (config.limits.dailyInputTokens) {
    row('dailyInputTokens:', config.limits.dailyInputTokens.toLocaleString());
  }
  row(
    'targetInputTokensPerCall:',
    config.limits.targetInputTokensPerCall.toLocaleString(),
  );
  row('maxInputTokensPerCall:', config.limits.maxInputTokensPerCall.toLocaleString());
  row('refreshOnIngest:', String(config.build.refreshOnIngest));
  row('slotBatchSize:', String(config.build.slotBatchSize));
  row('maxContextFiles:', String(config.retrieval.maxContextFiles));
  row('maxChunksPerPage:', String(config.retrieval.maxChunksPerPage));
  row('maxChunkChars:', String(config.retrieval.maxChunkChars));
  row('maxSourceChars:', String(config.retrieval.maxSourceChars));
  row('vector.enabled:', String(config.retrieval.vector.enabled));
  row('vector.baseUrl:', config.retrieval.vector.baseUrl);
  row('vector.embedding:', config.retrieval.vector.embeddingModel);
  row('vector.rerankEnabled:', String(config.retrieval.vector.rerankEnabled));
  row('vector.reranker:', config.retrieval.vector.rerankerModel);
  row('vector.topK:', String(config.retrieval.vector.topK));
  row('vector.rerankTopK:', String(config.retrieval.vector.rerankTopK));
  row('vector.maxResults:', String(config.retrieval.vector.maxResults));

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
    if ((config.build.slotBatchSize ?? 1) > 1) {
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
    warn(
      'wiki/index.md missing — run `wiki init` to create it (continuing with partial data)',
    );
  }

  const [pages, indexContent, untrackedPaths, buildContext] = await Promise.all([
    workspace.listWikiPages(),
    workspace.readIndex(),
    workspace.listUntrackedSourcePaths(),
    workspace.readBuildContext(),
  ]);

  const untrackedContents = await Promise.all(
    untrackedPaths.map(async (p) => {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(p, 'utf8');
      return { path: p, size: content.length, content };
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
  row(
    'pending ingest:',
    `${untrackedPaths.length} file(s) in raw/untracked${untrackedSizes.length > 0 ? ` (avg ${avg(untrackedSizes)} chars, max ${maxUntracked} chars)` : ''}`,
  );

  const largeUntracked = untrackedContents.filter(
    (u) => u.size > config.retrieval.maxSourceChars,
  );
  const largeUntrackedSections = largeUntracked.flatMap((source) =>
    splitSourceSections(source.content, config.retrieval.maxSourceChars),
  );
  if (largeUntracked.length > 0) {
    warn(
      `${largeUntracked.length} pending file(s) in raw/untracked exceed maxSourceChars (${config.retrieval.maxSourceChars}) — ingest will split them into ~${largeUntrackedSections.length} LLM section call(s); only oversized unsplittable sections are truncated`,
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

  console.log('\n── Vector retrieval ────────────────────────────────────────');
  const vectorIndex = new VectorIndexService(
    config,
    workspace,
    new EmbeddingService(config),
    new RerankService(config),
  );
  const vectorStats = await vectorIndex.stats();
  row('enabled:', String(config.retrieval.vector.enabled));
  row('index path:', vectorStats.path ?? workspace.paths.vectorIndexDir);
  row('index:', vectorStats.exists ? `${vectorStats.rows} chunk(s)` : 'missing');
  row(
    'batch size:',
    `${EMBED_BATCH_SIZE} chunks / ${EMBED_BATCH_MAX_CHARS.toLocaleString('en-US')} chars`,
  );
  row('fallback:', 'lexical search remains active on vector errors');
  if (vectorStats.metadata) {
    row('index embedding:', vectorStats.metadata.embeddingModel);
    row('index provider:', vectorStats.metadata.provider);
    row('index dimensions:', String(vectorStats.metadata.dimension));
    row('index built:', vectorStats.metadata.builtAt);
  } else if (vectorStats.exists) {
    warn(
      'vector index metadata missing — run `wiki index` to rebuild with current metadata',
    );
  }
  if (config.retrieval.vector.enabled) {
    if (!vectorStats.exists) {
      warn(
        'vector retrieval enabled but index missing — run `wiki index`; lexical fallback is active until the index exists',
      );
    }
    try {
      const embeddings = await new EmbeddingService(config).embed([
        'doctor vector check',
      ]);
      const embeddingDimension = embeddings[0]?.length ?? 0;
      ok(
        `embedding ${config.retrieval.vector.embeddingModel} OK (${embeddingDimension} dimensions)`,
      );
      const expectedProvider = config.retrieval.vector.baseUrl.replace(/\/+$/, '');
      if (vectorStats.metadata) {
        if (
          vectorStats.metadata.provider !== expectedProvider ||
          vectorStats.metadata.embeddingModel !==
            config.retrieval.vector.embeddingModel ||
          vectorStats.metadata.dimension !== embeddingDimension
        ) {
          warn(
            'vector index embedding settings differ from current config — run `wiki index`',
          );
        }
      }
    } catch (error) {
      warn(
        `embedding check failed for ${config.retrieval.vector.embeddingModel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (config.retrieval.vector.rerankEnabled === false) {
      ok('reranker check skipped; reranking disabled');
    } else {
      try {
        const rerank = await new RerankService(config).rerank(
          'doctor vector check',
          ['relevant wiki context', 'unrelated text'],
          2,
        );
        ok(
          `reranker ${config.retrieval.vector.rerankerModel} OK (${rerank.length} result(s))`,
        );
      } catch (error) {
        warn(
          `reranker check failed for ${config.retrieval.vector.rerankerModel}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } else {
    ok('vector retrieval disabled; lexical fallback is active');
  }

  console.log('\n── Build plan ──────────────────────────────────────────────');
  row('source:', 'templates/ + wiki/ + build-context/');
  row('raw/ingested:', 'ignored here; already represented by wiki/sources');
  row('planner:', 'same batching logic with fast local context approximation');
  console.log('  … simulating build batches and provider budget');
  try {
    const buildPlan = await new BuildService(
      config,
      workspace,
      new LLMService(config),
      new RetrievalService(workspace, config),
    ).planBuild({ fastContext: true });
    row('templates:', String(buildPlan.templates.length));
    row('planned requests:', String(buildPlan.estimatedRequests));
    row(
      'estimated input:',
      `~${buildPlan.estimatedInputTokens.toLocaleString()} token(s)`,
    );
    row(
      'request rate:',
      `${config.limits.requestsPerMinute} req/min → minimum ~${Math.ceil(
        (buildPlan.estimatedRequests / config.limits.requestsPerMinute) * 60,
      )}s if throttled`,
    );
    if (config.limits.dailyInputTokens) {
      const percent = Math.round(
        (buildPlan.estimatedInputTokens / config.limits.dailyInputTokens) * 100,
      );
      row(
        'daily budget:',
        `${percent}% of ${config.limits.dailyInputTokens.toLocaleString()} input token(s)`,
      );
    }
    for (const templatePlan of buildPlan.templates) {
      const largestBatch = Math.max(
        0,
        ...templatePlan.batches.map((batch) => batch.estimatedInputTokens),
      );
      row(
        templatePlan.template.replace(/^templates\//, ''),
        `${templatePlan.instructions} slot(s), ${templatePlan.batches.length} request(s), largest ~${largestBatch.toLocaleString()} input token(s)`,
      );
    }
    const overTarget = buildPlan.templates.flatMap((templatePlan) =>
      templatePlan.batches
        .filter((batch) => batch.exceedsTarget)
        .map((batch) => `${templatePlan.template} batch ${batch.index + 1}`),
    );
    const overMax = buildPlan.templates.flatMap((templatePlan) =>
      templatePlan.batches
        .filter((batch) => batch.exceedsMax)
        .map((batch) => `${templatePlan.template} batch ${batch.index + 1}`),
    );
    if (overMax.length > 0) {
      err(
        `${overMax.length} planned batch(es) exceed maxInputTokensPerCall: ${overMax
          .slice(0, 5)
          .join(', ')}`,
      );
    } else {
      ok('planned build fits maxInputTokensPerCall');
    }
    if (overTarget.length > 0) {
      warn(
        `${overTarget.length} planned batch(es) exceed targetInputTokensPerCall but remain under the hard max`,
      );
    }

    console.log('\n── Recommended config ──────────────────────────────────────');
    console.log('  … deriving minimal config patch from the build plan');
    const largestBatch = Math.max(
      0,
      ...buildPlan.templates.flatMap((templatePlan) =>
        templatePlan.batches.map((batch) => batch.estimatedInputTokens),
      ),
    );
    const recommendedHardLimit = recommendedMaxInputTokens(config);
    const recommendedTarget = recommendedTargetInputTokens(recommendedHardLimit);
    const recommendedBuildContextChars = Math.max(
      1000,
      roundUp(
        Math.max(buildContext.rawTotalChars, buildContext.content.length) + 2000,
        1000,
      ),
    );
    const recommendedChunkChars = Math.max(
      1000,
      Math.min(6000, roundUp(pct(chunkSizes, 95) + 200, 100)),
    );
    const recommendedSourceChars =
      maxUntracked > 0
        ? Math.max(config.retrieval.maxSourceChars, roundUp(maxUntracked + 1000, 1000))
        : config.retrieval.maxSourceChars;
    const vectorRecommendation = compactObject({
      enabled: config.retrieval.vector.enabled,
      baseUrl: config.retrieval.vector.baseUrl,
      embeddingModel: config.retrieval.vector.embeddingModel,
      rerankEnabled: config.retrieval.vector.rerankEnabled,
      rerankerModel: config.retrieval.vector.rerankerModel,
      topK: config.retrieval.vector.topK,
      rerankTopK: config.retrieval.vector.rerankTopK,
      maxResults: config.retrieval.vector.maxResults,
    });
    const recommendedConfig = {
      limits: {
        requestsPerMinute: config.limits.requestsPerMinute,
        ...(config.limits.dailyInputTokens
          ? { dailyInputTokens: config.limits.dailyInputTokens }
          : {}),
        maxInputTokensPerCall: recommendedHardLimit,
        targetInputTokensPerCall: recommendedTarget,
      },
      build: {
        slotBatchSize: 50,
        refreshOnIngest: config.build.refreshOnIngest,
        maxBuildContextChars: recommendedBuildContextChars,
      },
      retrieval: {
        maxContextFiles: Math.max(config.retrieval.maxContextFiles, 8),
        maxChunkChars: recommendedChunkChars,
        maxSourceChars: recommendedSourceChars,
        vector: vectorRecommendation,
      },
    };
    const currentComparableConfig = {
      limits: config.limits,
      build: config.build,
      retrieval: {
        maxContextFiles: config.retrieval.maxContextFiles,
        maxChunkChars: config.retrieval.maxChunkChars,
        maxSourceChars: config.retrieval.maxSourceChars,
        vector: vectorRecommendation,
      },
    };
    const recommendedPatch =
      diffConfigPatch(currentComparableConfig, recommendedConfig) ?? {};
    if (config.llm.provider !== 'ollama' && config.llm.numCtx) {
      warn(
        'llm.numCtx is only used for Ollama; for remote providers use limits.maxInputTokensPerCall',
      );
    }
    row(
      'basis:',
      `largest planned batch ~${largestBatch.toLocaleString()} input token(s)`,
    );
    row(
      'action:',
      options.apply
        ? 'applying to .wikirc.yaml'
        : 'run `wiki doctor --apply` to write these values',
    );
    if (Object.keys(recommendedPatch).length > 0) {
      printYamlBlock(recommendedPatch);
    } else {
      ok('No config changes recommended');
    }
    if (options.apply) {
      if (Object.keys(recommendedPatch).length > 0) {
        await applyRecommendedConfig(config, recommendedPatch);
      } else {
        ok('No changes written.');
      }
    }
  } catch (error) {
    warn(`build plan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  printDoctorStatus();
  console.log('');
}
