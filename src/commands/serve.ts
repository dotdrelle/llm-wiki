import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AppConfig } from '../types.ts';
import { loadConfig } from '../config/loadConfig.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { pathExists, safeWriteFile } from '../utils/fs.ts';
import { resolveInside, toPosix } from '../utils/path.ts';
import {
  extractIndexTiles,
  isRawDownloadRequestPath,
  isRawUntrackedReference,
  localHref,
  serveMd,
} from '../serve/html/wikiHtml.ts';
import type { RuntimeProxyDeps } from '../serve/proxy/runtimeProxy.ts';
import { handleChatHistoryApi } from '../serve/routes/chatHistoryRoutes.ts';
import { handleChatRoutes } from '../serve/routes/chatRoutes.ts';
import { handleConfigRoutes } from '../serve/routes/configRoutes.ts';
import { handleGraphRoutes } from '../serve/routes/graphRoutes.ts';
import { handleMcpRoutes } from '../serve/routes/mcpRoutes.ts';
import { handleRuntimeRoutes } from '../serve/routes/runtimeRoutes.ts';
import { handleUploadRoutes, type ExternalMcpEndpoint } from '../serve/routes/uploadRoutes.ts';
import { handleWikiRoutes } from '../serve/routes/wikiRoutes.ts';

export { extractIndexTiles, isRawDownloadRequestPath, isRawUntrackedReference, localHref, serveMd };

const mcpWikiPort = () => process.env.WIKI_MCP_HTTP_PORT ?? process.env.WIKI_MCP_PORT ?? '3101';
const mcpProductionPort = () => process.env.PRODUCTION_MCP_PORT ?? '3102';
const hubPort = () => process.env.HUB_PORT ?? null;
const hubToken = () => process.env.HUB_TOKEN ?? null;
const hubInternalHost = () => process.env.HUB_INTERNAL_HOST ?? '127.0.0.1';
const runtimeUrl = () => process.env.WIKI_MANAGER_RUNTIME_URL ?? process.env.RUNTIME_URL ?? null;
const runtimeToken = () => process.env.WIKI_MANAGER_RUNTIME_TOKEN ?? process.env.RUNTIME_AUTH_TOKEN ?? null;
const workspaceNameFromEnv = () => process.env.WORKSPACE_NAME ?? null;
function resolveDocumentInputDir(rootDir: string): string {
  return process.env.DOCUMENT_INPUT_DIR ?? path.join(rootDir, '.wiki', 'documents', 'input');
}
function resolveDocumentUploadsDir(rootDir: string): string {
  return process.env.DOCUMENT_UPLOADS_DIR ?? path.join(rootDir, '.wiki', 'documents', 'uploads');
}
const documentMaxUploadBytes = () => Number(process.env.DOCUMENT_MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);

const require = createRequire(import.meta.url);
const D3_DIST_PATH = path.resolve(
  path.dirname(require.resolve('d3')),
  '../dist/d3.min.js',
);
const MARKED_DIST_PATH = path.resolve(
  path.dirname(require.resolve('marked')),
  'marked.umd.js',
);
const SKILLS_DIR = path.join('.wiki', 'skills');
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,60}$/;
const LLM_WIKI_VERSION = '0.11.10';

type SkillMeta = {
  name: string;
  description: string;
  params: string[];
  body: string;
  scope: 'workspace';
};

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const sep = expr.indexOf(':-');
    if (sep !== -1) return process.env[expr.slice(0, sep)] ?? expr.slice(sep + 2);
    return process.env[expr] ?? '';
  });
}

function normalizeMcpHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => key && typeof value === 'string')
      .map(([key, value]) => [key.toLowerCase(), interpolateEnv(value as string)])
      .filter(([, value]) => value.trim() && !/^Bearer\s*$/i.test(value)),
  );
}

async function loadExternalMcpEndpoints(rootDir: string): Promise<ExternalMcpEndpoint[]> {
  const candidates = [
    path.join(rootDir, '.wiki', 'mcp.endpoints.json'),
    '/mcp.endpoints.json',
    path.join(process.cwd(), 'mcp.endpoints.json'),
  ];
  for (const filePath of candidates) {
    try {
      const info = await stat(filePath);
      if (!info.isFile()) continue;
      const raw = JSON.parse(await readFile(filePath, 'utf8'));
      const servers = raw?.mcpServers ?? raw?.servers ?? {};
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
      return Object.entries(servers)
        .filter(([, endpoint]) => endpoint && typeof endpoint === 'object' && 'url' in endpoint)
        .map(([name, endpoint]) => {
          const headers = normalizeMcpHeaders((endpoint as { headers?: unknown }).headers);
          const authHeader = headers['authorization'] ?? '';
          const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
          return {
            name,
            url: interpolateEnv(String((endpoint as { url?: unknown }).url)),
            headers,
            bearer,
          };
        })
        .filter((endpoint) => endpoint.url);
    } catch {
      // Missing or invalid external endpoint files are ignored; workspace MCPs still work.
    }
  }
  return [];
}

function assertSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) throw new Error('INVALID_SKILL_NAME');
}

function skillFilePath(rootDir: string, name: string): string {
  return path.join(rootDir, SKILLS_DIR, `${name}.md`);
}

function parseSkillFile(name: string, raw: string): SkillMeta {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = (fmMatch ? fmMatch[2] : raw).trim();
  let description = '';
  const params: string[] = [];
  let inParams = false;
  for (const line of fm.split('\n')) {
    const t = line.trim();
    if (t.startsWith('description:')) {
      description = t.slice(12).trim();
      inParams = false;
    } else if (t === 'params:') {
      inParams = true;
    } else if (inParams && t.startsWith('- ')) {
      params.push(t.slice(2).trim());
    } else if (t && !t.startsWith('#') && !t.startsWith('- ')) {
      inParams = false;
    }
  }
  return { name, description, params, body, scope: 'workspace' };
}

function formatSkillFile(skill: {
  name: string;
  description: string;
  params: string[];
  body: string;
}): string {
  const paramsYaml = skill.params.length
    ? `\nparams:\n${skill.params.map((p) => `  - ${p}`).join('\n')}`
    : '';
  return `---\nname: ${skill.name}\ndescription: ${skill.description}${paramsYaml}\n---\n${skill.body}\n`;
}

async function listSkills(rootDir: string): Promise<SkillMeta[]> {
  const dir = path.join(rootDir, SKILLS_DIR);
  if (!(await pathExists(dir))) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const skills: SkillMeta[] = [];
  for (const file of files) {
    const name = file.slice(0, -3);
    try {
      assertSkillName(name);
      const raw = await readFile(path.join(dir, file), 'utf8');
      skills.push(parseSkillFile(name, raw));
    } catch {
      /* skip invalid */
    }
  }
  return skills;
}

async function readSkillByName(rootDir: string, name: string): Promise<SkillMeta | null> {
  assertSkillName(name);
  const fp = skillFilePath(rootDir, name);
  if (!(await pathExists(fp))) return null;
  return parseSkillFile(name, await readFile(fp, 'utf8'));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return (await readRequestBuffer(req)).toString('utf8');
}

async function readRequestBuffer(req: IncomingMessage, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (maxBytes && total > maxBytes) {
      throw new Error(`Request body is too large: ${total} bytes (max ${maxBytes}).`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    end: (c?: string) => void;
  },
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const runtimeProxyDeps: RuntimeProxyDeps = {
  runtimeUrl,
  runtimeToken,
  readRequestBuffer,
  sendJson,
};

async function handleUntrackedApi(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
): Promise<boolean> {
  const match = urlPath.match(/^\/api\/untracked\/(.+)$/);
  if (!match || req.method !== 'DELETE') return false;
  const relativePath = toPosix(match[1] ?? '').replace(/^\/+|\/+$/g, '');
  if (!relativePath.endsWith('.md') || !relativePath.startsWith('raw/untracked/')) {
    sendJson(res, 400, { ok: false, error: 'invalid untracked markdown path' });
    return true;
  }
  try {
    const absolute = resolveInside(rootDir, relativePath);
    await rm(absolute, { force: true });
    await removeEmptyUntrackedParents(rootDir, path.dirname(relativePath));
    sendJson(res, 200, { ok: true, path: relativePath });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

async function removeEmptyUntrackedParents(rootDir: string, relativeDir: string): Promise<void> {
  const untrackedRoot = resolveInside(rootDir, 'raw/untracked');
  let current = resolveInside(rootDir, relativeDir);
  while (current !== untrackedRoot && current.startsWith(`${untrackedRoot}${path.sep}`)) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    await rm(current, { recursive: false });
    current = path.dirname(current);
  }
}
// ── Perf helpers ──────────────────────────────────────────────────────────────

function acceptsGzip(req: IncomingMessage): boolean {
  return (req.headers['accept-encoding'] ?? '').includes('gzip');
}

async function sendGzippedHtml(
  req: IncomingMessage,
  res: ServerResponse,
  html: string,
  extraHeaders: Record<string, string> = {},
  status = 200,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...extraHeaders,
  };
  if (acceptsGzip(req)) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    const gz = createGzip({ level: 6 });
    gz.pipe(res);
    gz.end(html);
  } else {
    res.writeHead(status, headers);
    res.end(html);
  }
}

function parseTraceFields(rest: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of rest.matchAll(/(\w+)=((?:"[^"]*")|(?:\[[^\]]*\])|(?:\S+))/g)) {
    fields[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return fields;
}

async function readProductionTraceStatus(
  rootDir: string,
  traceFile: string,
): Promise<Record<string, unknown>> {
  const tracePath = resolveInside(rootDir, traceFile);
  if (
    !tracePath ||
    !tracePath.startsWith(path.join(rootDir, '.wiki', 'logs') + path.sep)
  ) {
    throw new Error('INVALID_TRACE_PATH');
  }
  const lines = (await readFile(tracePath, 'utf8')).split(/\r?\n/).filter(Boolean);
  let lastEvent = '';
  let lastEventAt = '';
  let waitMs: number | undefined;
  let retryAt: string | undefined;
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+\+\d+ms\s+\S+\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    const [, at, event, rest] = match;
    lastEvent = event;
    lastEventAt = at;
    if (event !== 'provider:throttle') {
      waitMs = undefined;
      retryAt = undefined;
      continue;
    }
    const fields = parseTraceFields(rest);
    const parsedWaitMs = Number(fields.waitMs);
    waitMs = Number.isFinite(parsedWaitMs) ? parsedWaitMs : undefined;
    retryAt = fields.retryAt;
    if (!retryAt && waitMs !== undefined) {
      retryAt = new Date(Date.parse(at) + waitMs).toISOString();
    }
  }
  return { ok: true, traceFile, lastEvent, lastEventAt, waitMs, retryAt };
}

async function handleSkillsApi(
  rootDir: string,
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h?: Record<string, string>) => void;
    end: (c?: string) => void;
  },
  urlPath: string,
): Promise<boolean> {
  if (urlPath !== '/api/skills' && !urlPath.startsWith('/api/skills/')) return false;
  const name = urlPath.replace(/^\/api\/skills\/?/, '').replace(/\/+$/, '');
  try {
    if (!name) {
      if (req.method === 'GET') {
        sendJson(res, 200, await listSkills(rootDir));
        return true;
      }
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    assertSkillName(name);
    if (req.method === 'GET') {
      const skill = await readSkillByName(rootDir, name);
      if (!skill) {
        sendJson(res, 404, { error: 'Skill not found' });
        return true;
      }
      sendJson(res, 200, skill);
      return true;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readRequestBody(req);
      const data = JSON.parse(raw) as {
        description?: string;
        params?: unknown;
        body?: string;
      };
      const skill = {
        name,
        description: String(data.description ?? ''),
        params: Array.isArray(data.params) ? data.params.map(String) : [],
        body: String(data.body ?? ''),
      };
      await mkdir(path.join(rootDir, SKILLS_DIR), { recursive: true });
      await safeWriteFile(skillFilePath(rootDir, name), formatSkillFile(skill));
      sendJson(res, 200, { ...skill, scope: 'workspace' as const });
      return true;
    }
    if (req.method === 'DELETE') {
      await rm(skillFilePath(rootDir, name), { force: true });
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, message === 'INVALID_SKILL_NAME' ? 400 : 500, { error: message });
    return true;
  }
}

async function proxyPost(
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    write: (c: Uint8Array) => void;
    end: () => void;
    headersSent?: boolean;
  },
  targetUrl: string,
  extraHeaders: Record<string, string> = {},
  options: { retry429?: boolean; retryNetwork?: boolean } = {},
): Promise<void> {
  const body = await readRequestBuffer(req);

  const headers: Record<string, string> = {
    'content-type': (req.headers['content-type'] as string) ?? 'application/json',
    accept: (req.headers['accept'] as string) ?? 'application/json, text/event-stream',
  };
  // Forward browser Authorization only when server doesn't override it
  if (!extraHeaders['authorization'] && req.headers['authorization']) {
    headers['authorization'] = req.headers['authorization'] as string;
  }
  Object.assign(headers, extraHeaders);
  const sid = req.headers['mcp-session-id'];
  if (sid) headers['mcp-session-id'] = sid as string;

  const rateLimitAttempts = options.retry429
    ? Math.max(
        1,
        Number(
          process.env.LLM_WIKI_CHAT_RATE_LIMIT_RETRY_MAX_ATTEMPTS ??
            process.env.LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS ??
            '10',
        ),
      )
    : 1;
  const maxAttempts = Math.max(rateLimitAttempts, options.retryNetwork ? 2 : 1);
  let upstream: Response | undefined;
  let networkFailures = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      upstream = await fetch(targetUrl, { method: 'POST', headers, body });
    } catch (err) {
      if (options.retryNetwork && networkFailures < 1) {
        networkFailures += 1;
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const message = upstreamFetchFailureMessage(targetUrl, err);
      console.warn(`[wiki serve] ${message}`);
      sendJson(res, 502, {
        error: message,
        hint:
          'Check that the LLM service is running and reachable from the wiki container/WSL environment. For Docker/Rancher, use the container network hostname, not 127.0.0.1 unless the LLM runs in the same container.',
      });
      return;
    }
    if (upstream.status !== 429 || attempt >= maxAttempts) break;
    const retryAfter = upstream.headers.get('retry-after');
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    const retryAfterDate = retryAfter ? Date.parse(retryAfter) : NaN;
    const fallbackMs = Math.max(
      0,
      Number(
        process.env.LLM_WIKI_RATE_LIMIT_RETRY_MS ??
          process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS ??
          '60000',
      ),
    );
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds * 1000)
      : Number.isFinite(retryAfterDate)
        ? Math.max(0, retryAfterDate - Date.now())
        : fallbackMs;
    await upstream.text().catch(() => '');
    console.warn(
      `wiki serve proxy rate limited: ${targetUrl} attempt=${attempt}/${maxAttempts} waitMs=${waitMs}`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  if (!upstream) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.write(new TextEncoder().encode('Upstream request was not attempted.'));
    res.end();
    return;
  }
  const ct = upstream.headers.get('content-type') ?? 'application/json';
  const respSid = upstream.headers.get('mcp-session-id');
  const respHeaders: Record<string, string> = { 'content-type': ct };
  if (respSid) respHeaders['mcp-session-id'] = respSid;
  for (const header of ['location', 'www-authenticate']) {
    const value = upstream.headers.get(header);
    if (value) respHeaders[header] = value;
  }

  res.writeHead(upstream.status, respHeaders);
  if (upstream.body) {
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (err) {
      console.warn(`[wiki serve] ${upstreamFetchFailureMessage(targetUrl, err)}`);
    }
  }
  res.end();
}

function upstreamFetchFailureMessage(targetUrl: string, err: unknown): string {
  let target = targetUrl;
  try {
    const parsed = new URL(targetUrl);
    target = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    /* keep raw target */
  }
  const cause = (err as { cause?: unknown })?.cause;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'object' && cause && 'message' in cause
        ? String((cause as { message?: unknown }).message)
        : '';
  const raw = causeMessage || (err instanceof Error ? err.message : String(err));
  const detail = /fetch failed|econnrefused|connection refused/i.test(raw)
    ? 'connection refused (service not running?)'
    : /enotfound|getaddrinfo/i.test(raw)
      ? 'host not found'
      : /timeout|timedout|etimedout/i.test(raw)
        ? 'connection timed out'
        : raw;
  return `Upstream unreachable (${target}): ${detail}`;
}

function openAppMode(url: string): void {
  const platform = process.platform;

  if (platform === 'darwin') {
    // Try Chrome, then Edge, then Safari
    const fallback = () => {
      spawn('open', ['-a', 'Safari', url], { stdio: 'ignore', detached: true }).unref();
    };
    const openEdge = () => {
      const edgeTry = spawn('open', ['-na', 'Microsoft Edge', '--args', `--app=${url}`], {
        stdio: 'ignore',
        detached: true,
      });
      edgeTry.on('error', fallback);
      edgeTry.on('close', (code) => {
        if (code !== 0) fallback();
      });
      edgeTry.unref();
    };
    const chromiumTry = spawn(
      'open',
      ['-na', 'Google Chrome', '--args', `--app=${url}`],
      {
        stdio: 'ignore',
        detached: true,
      },
    );
    chromiumTry.on('error', openEdge);
    chromiumTry.on('close', (code) => {
      if (code !== 0) openEdge();
    });
    chromiumTry.unref();
    return;
  }

  if (platform === 'linux') {
    // Try Chrome, then Edge, then xdg-open
    const chromeCandidates = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
    ];
    const edgeCandidates = ['microsoft-edge', 'microsoft-edge-stable'];

    function tryNext(candidates: string[], fallback: () => void): void {
      const [cmd, ...rest] = candidates;
      if (!cmd) {
        fallback();
        return;
      }
      const proc = spawn(cmd, [`--app=${url}`], { stdio: 'ignore', detached: true });
      proc.on('error', () => tryNext(rest, fallback));
      proc.unref();
    }

    tryNext(chromeCandidates, () => {
      tryNext(edgeCandidates, () => {
        spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
      });
    });
    return;
  }

  if (platform === 'win32') {
    // Try Chrome, then Edge, then start default
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    function tryNext(paths: string[], fallback: () => void): void {
      const [exe, ...rest] = paths;
      if (!exe) {
        fallback();
        return;
      }
      const proc = spawn(exe, [`--app=${url}`], { stdio: 'ignore', detached: true });
      proc.on('error', () => tryNext(rest, fallback));
      proc.unref();
    }

    tryNext(chromePaths, () => {
      tryNext(edgePaths, () => {
        spawn('cmd', ['/c', 'start', '', url], {
          stdio: 'ignore',
          detached: true,
          shell: true,
        }).unref();
      });
    });
    return;
  }

  // Fallback: best-effort open
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

async function serveTlsOptions(config: AppConfig): Promise<{ cert: Buffer; key: Buffer; ca?: Buffer } | undefined> {
  const { certPath, keyPath, caPath } = config.serve?.tls ?? {};
  if (!certPath && !keyPath && !caPath) return undefined;
  if (!certPath || !keyPath) {
    throw new Error('serve.tls.certPath and serve.tls.keyPath must both be set for HTTPS.');
  }
  const resolvePath = (value: string) =>
    path.isAbsolute(value) ? value : resolveInside(config.wikiRoot, value);
  const cert = await readFile(resolvePath(certPath));
  const key = await readFile(resolvePath(keyPath));
  const ca = caPath ? await readFile(resolvePath(caPath)) : undefined;
  return ca ? { cert, key, ca } : { cert, key };
}

export default async function serveCmd(
  config: AppConfig,
  options: { port?: number; open?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const rootDir = workspace.paths.rootDir;
  const port = options.port ?? 3000;
  const externalMcpEndpoints = await loadExternalMcpEndpoints(rootDir);
  const tls = await serveTlsOptions(config);
  const server = tls ? createHttpsServer(tls) : createServer();
  let configWatcher: FSWatcher | undefined;

  const runtimePathForWorkspace = (pathname: string): string => {
    const wsName = workspaceNameFromEnv();
    if (!wsName) return pathname;
    const separator = pathname.includes('?') ? '&' : '?';
    return `${pathname}${separator}workspace=${encodeURIComponent(wsName)}`;
  };

  const restartConfigWatcher = (): void => {
    configWatcher?.close();
    configWatcher = watchConfigReload(config, rootDir);
  };

  const resolveProfileConfigPath = (fileName: unknown): string => {
    if (typeof fileName !== 'string' || !fileName.trim()) {
      throw new Error('runtime config switch did not return a profile fileName');
    }
    const clean = toPosix(fileName.trim());
    if (clean !== '.wikirc.yaml' && !clean.startsWith('.wikirc.yaml.')) {
      throw new Error(`invalid runtime config profile fileName: ${clean}`);
    }
    resolveInside(rootDir, clean); // throws on path traversal
    return clean;
  };

  const mirrorRuntimeConfig = async (payload: unknown): Promise<AppConfig> => {
    const fileName = resolveProfileConfigPath((payload as { fileName?: unknown })?.fileName);
    const previousConfigPath = process.env.WIKI_CONFIG_PATH;
    config.configPath = path.resolve(rootDir, fileName);
    process.env.WIKI_CONFIG_PATH = fileName;
    let fresh: AppConfig;
    try {
      fresh = await loadConfig(rootDir);
    } finally {
      if (previousConfigPath === undefined) delete process.env.WIKI_CONFIG_PATH;
      else process.env.WIKI_CONFIG_PATH = previousConfigPath;
    }
    Object.assign(config, fresh);
    restartConfigWatcher();
    return fresh;
  };

  server.on('request', async (req, res) => {
    try {
      const urlPath = decodeURIComponent(
        new URL(req.url ?? '/', `http://localhost`).pathname,
      );

      if (await handleChatHistoryApi(rootDir, req, res, urlPath, readRequestBody, sendJson)) {
        return;
      }

      if (await handleSkillsApi(rootDir, req, res, urlPath)) {
        return;
      }

      if (await handleUploadRoutes(req, res, urlPath, {
        rootDir,
        externalMcpEndpoints,
        workspaceNameFromEnv,
        documentInputDir: resolveDocumentInputDir,
        documentUploadsDir: resolveDocumentUploadsDir,
        documentMaxUploadBytes,
        version: LLM_WIKI_VERSION,
        readRequestBuffer,
        sendJson,
      })) {
        return;
      }

      if (await handleUntrackedApi(rootDir, req, res, urlPath)) {
        return;
      }

      if (req.method === 'GET' && urlPath === '/api/production/trace') {
        try {
          const traceFile =
            new URL(req.url ?? '/', 'http://localhost').searchParams.get('path') ?? '';
          sendJson(res, 200, await readProductionTraceStatus(rootDir, traceFile));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, message === 'INVALID_TRACE_PATH' ? 400 : 404, {
            ok: false,
            error: message,
          });
        }
        return;
      }

      if (await handleRuntimeRoutes(req, res, urlPath, {
        proxyDeps: runtimeProxyDeps,
        runtimePathForWorkspace,
        workspaceNameFromEnv,
      })) {
        return;
      }

      if (await handleConfigRoutes(req, res, urlPath, {
        config,
        proxyDeps: runtimeProxyDeps,
        runtimePathForWorkspace,
        workspaceNameFromEnv,
        mirrorRuntimeConfig,
        readRequestBody,
        sendJson,
      })) {
        return;
      }

      // ── Hub proxy (same-origin facade over the host-side hub.js) ──────────
      if (hubPort() && hubToken() && urlPath.startsWith('/api/hub/')) {
        // CSRF guard: custom header required; reject cross-origin POSTs
        if (!req.headers['x-llm-wiki-hub']) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return;
        }
        if (req.method === 'POST') {
          const origin = req.headers['origin'] as string | undefined;
          const host = req.headers.host;
          let allowedOrigin = !origin;
          if (origin && host) {
            try {
              const parsedOrigin = new URL(origin);
              const [hostName, hostPort = ''] = host.split(':');
              const sameHost =
                origin === `http://${host}` || origin === `https://${host}`;
              const sameLoopbackPort =
                ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname) &&
                ['localhost', '127.0.0.1'].includes(hostName ?? '') &&
                parsedOrigin.port === hostPort;
              allowedOrigin = sameHost || sameLoopbackPort;
            } catch {
              allowedOrigin = false;
            }
          }
          if (!allowedOrigin) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
        }
        const hubPath = urlPath.slice('/api/hub'.length);
        const hubBody = await readRequestBuffer(req);
        try {
          const upstream = await fetch(
            `http://${hubInternalHost()}:${hubPort()}${hubPath}`,
            {
              method: req.method ?? 'GET',
              headers: {
                authorization: `Bearer ${hubToken()}`,
                'content-type': 'application/json',
              },
              body: hubBody.length > 0 ? hubBody : undefined,
            },
          );
          const data = await upstream.text();
          res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
          res.end(data);
        } catch {
          sendJson(res, 503, { ok: false, error: 'hub unavailable' });
        }
        return;
      }

      if (await handleChatRoutes(req, res, urlPath, {
        config,
        externalMcpEndpoints,
        mcpWikiPort,
        mcpProductionPort,
        proxyPost,
        rootDir,
        runtimeUrl,
        sendGzippedHtml,
        sendJson,
        workspace,
        workspaceNameFromEnv,
      })) {
        return;
      }

      // ── Server-side proxies (avoid CORS + Docker internal URLs) ────────────
      if (req.method === 'POST') {
        if (await handleMcpRoutes(req, res, urlPath, {
          mcpAccessKey: () => config.mcp.accessKey,
          externalMcpEndpoints,
          mcpWikiPort,
          mcpProductionPort,
          proxyPost,
        })) {
          return;
        }
      }

      if (urlPath === '/assets/d3.min.js') {
        const js = await readFile(D3_DIST_PATH, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(js);
        return;
      }

      if (urlPath === '/assets/marked.min.js') {
        const js = await readFile(MARKED_DIST_PATH, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(js);
        return;
      }

      if (await handleGraphRoutes(req, res, urlPath, {
        rootDir,
        sendJson,
        sendGzippedHtml,
      })) return;

      if (await handleWikiRoutes(req, res, urlPath, {
        rootDir,
        readRequestBody,
        sendGzippedHtml,
        sendJson,
      })) return;
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    const url = `${tls ? 'https' : 'http'}://localhost:${port}`;
    console.log(`wiki serve  →  ${url}`);
    console.log('Ctrl-C to stop.');
    if (options.open) openAppMode(url);
  });

  let shuttingDown = false;
  configWatcher = watchConfigReload(config, rootDir);

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`wiki serve stopping (${signal})...`);
    configWatcher?.close();
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 5_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export function watchConfigReload(config: AppConfig, rootDir: string): FSWatcher | undefined {
  if (!config.configPath) return undefined;

  const configFileName = path.basename(config.configPath);
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(path.dirname(config.configPath), (_eventType, filename) => {
    if (filename && filename.toString() !== configFileName) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        const fresh = await loadConfig(rootDir);
        Object.assign(config, fresh);
        console.log('[wiki serve] Config reloaded from .wikirc.yaml');
      } catch (err) {
        console.warn('[wiki serve] Config reload failed:', err instanceof Error ? err.message : err);
      }
    }, 300);
  });

  watcher.on('close', () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
    }
  });

  return watcher;
}
