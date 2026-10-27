import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CHAT_HTML } from '../../chat/chatHtml.ts';
import type { AppConfig } from '../../types.ts';
import { pathExists } from '../../utils/fs.ts';
import { escapeHtml } from '../../utils/html.ts';
import { promptSafeBaseUrl } from '../../utils/promptSafeUrl.ts';
import { writeDonnaReport } from '../../services/reportWriter.ts';
import { escapeScriptJson } from '../html/wikiHtml.ts';
import { appDisplayName, appFaviconHref } from '../html/appIdentity.ts';
import { resolveMcpTargets, type ExternalMcpEndpoint } from './uploadRoutes.ts';

const SYSTEM_PROMPT_MAX_CHARS = 20000;

type ChatWorkspace = {
  paths: { internalDir: string };
  loadProfileSection: (maxChars: number) => Promise<string>;
};

type ChatRoutesDeps = {
  config: AppConfig;
  externalMcpEndpoints: () => Promise<ExternalMcpEndpoint[]>;
  mcpWikiPort: () => string;
  mcpProductionPort: () => string;
  proxyPost: (
    req: IncomingMessage,
    res: {
      writeHead: (s: number, h: Record<string, string>) => void;
      write: (c: Uint8Array) => void;
      end: () => void;
      headersSent?: boolean;
    },
    targetUrl: string,
    extraHeaders?: Record<string, string>,
    options?: { retry429?: boolean; retryNetwork?: boolean },
  ) => Promise<void>;
  rootDir: string;
  runtimeUrl: () => string | null;
  sendGzippedHtml: (
    req: IncomingMessage,
    res: ServerResponse,
    html: string,
    extraHeaders?: Record<string, string>,
    status?: number,
  ) => Promise<void>;
  sendJson: (
    res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void },
    status: number,
    data: unknown,
  ) => void;
  workspace: ChatWorkspace;
  workspaceNameFromEnv: () => string | null;
};

function headerString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  return raw.replace(/[\r\n]/g, '').trim();
}

/** A connector URL is only a label in the browser; serve resolves its name. */
function browserSafeMcpUrl(raw: string): { url: string; hasUrlSecrets: boolean } {
  try {
    const url = new URL(raw);
    const hasUrlSecrets = Boolean(url.username || url.password || url.search || url.hash);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return { url: url.toString(), hasUrlSecrets };
  } catch {
    // Never send an unparseable configured URL to the browser.
    return { url: '', hasUrlSecrets: Boolean(raw) };
  }
}

/*
 * The chat proxy always talks to the configured LLM endpoint, with the
 * configured key added here. It used to accept `x-llm-wiki-llm-base-url` /
 * `x-llm-wiki-llm-api-key` from the browser: no page sent them any more, and a
 * public override target received the configured key. Those headers are now
 * ignored, so no request can choose where the key goes.
 */
function chatLlmProxyTarget(config: AppConfig): {
  url: string;
  headers: Record<string, string>;
} {
  if (!config.llm.baseUrl) throw new Error('LLM_BASE_URL_UNSET');
  return {
    url: `${config.llm.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: config.llm.apiKey ? { authorization: `Bearer ${config.llm.apiKey}` } : {},
  };
}

function chatProxyErrorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  return message === 'LLM_BASE_URL_UNSET' ? 400 : 502;
}

const DEFAULT_PROFILE = `# Workspace Profile

## Summary

No profile summary yet.

## User Preferences

## Working Style

## Project Context

## Maintenance Notes

Keep this file concise. Do not store secrets, tokens, passwords, API keys, or temporary information.
`;

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeForCompare(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatPreference(value: string): string {
  const clean = value.trim().replace(/[.。]\s*$/, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function appendProfilePreference(content: string, preference: string): {
  content: string;
  changed: boolean;
  line: string;
} {
  const line = `- ${formatPreference(preference)}`;
  const normalized = normalizeForCompare(line);
  if (content.split('\n').some((existing) => normalizeForCompare(existing) === normalized)) {
    return { content, changed: false, line };
  }
  const heading = '## User Preferences';
  const index = content.indexOf(heading);
  if (index === -1) {
    const base = content.trimEnd();
    return {
      content: `${base}${base ? '\n\n' : ''}${heading}\n\n${line}\n`,
      changed: true,
      line,
    };
  }
  const afterHeading = index + heading.length;
  const nextHeading = content.slice(afterHeading).search(/\n##\s+/);
  if (nextHeading === -1) {
    return {
      content: `${content.trimEnd()}\n${line}\n`,
      changed: true,
      line,
    };
  }
  const insertAt = afterHeading + nextHeading;
  return {
    content: `${content.slice(0, insertAt).trimEnd()}\n${line}\n${content.slice(insertAt).replace(/^\n+/, '\n')}`,
    changed: true,
    line,
  };
}

export async function handleChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: ChatRoutesDeps,
): Promise<boolean> {
  // The System instructions drawer edits the workspace's own
  // `.wiki/system-prompt.md` — the file the runtime prepends to Donna's
  // prompt at every turn, in chat and agent mode. It used to edit a browser
  // copy that, with the runtime on, reached no model at all.
  if (urlPath === '/api/system-prompt' && (req.method === 'GET' || req.method === 'PUT')) {
    const systemPromptPath = path.join(deps.workspace.paths.internalDir, 'system-prompt.md');
    try {
      if (req.method === 'PUT') {
        const body = JSON.parse(await readRequestBody(req) || '{}') as { content?: unknown };
        if (typeof body.content !== 'string') {
          deps.sendJson(res, 400, { error: 'Missing content.' });
          return true;
        }
        if (body.content.length > SYSTEM_PROMPT_MAX_CHARS) {
          deps.sendJson(res, 413, { error: `System instructions exceed ${SYSTEM_PROMPT_MAX_CHARS} characters.` });
          return true;
        }
        await mkdir(deps.workspace.paths.internalDir, { recursive: true });
        await writeFile(systemPromptPath, body.content.trim() ? `${body.content.trim()}\n` : '', 'utf8');
      }
      const content = (await pathExists(systemPromptPath)) ? await readFile(systemPromptPath, 'utf8') : '';
      deps.sendJson(res, 200, { ok: true, content: content.trim() });
    } catch (err) {
      deps.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && urlPath === '/api/profile/preference') {
    try {
      const body = JSON.parse(await readRequestBody(req) || '{}') as { preference?: unknown };
      const preference = typeof body.preference === 'string' ? body.preference.trim() : '';
      if (!preference) {
        deps.sendJson(res, 400, { error: 'Missing preference.' });
        return true;
      }
      const profilePath = path.join(deps.workspace.paths.internalDir, 'profile.md');
      await mkdir(deps.workspace.paths.internalDir, { recursive: true });
      let before = DEFAULT_PROFILE;
      try {
        before = await readFile(profilePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      }
      const result = appendProfilePreference(before, preference);
      if (result.changed) {
        if (result.content.length > deps.config.limits.maxProfileChars) {
          deps.sendJson(res, 413, {
            error: 'Profile exceeds maxProfileChars limit.',
            maxProfileChars: deps.config.limits.maxProfileChars,
          });
          return true;
        }
        await writeFile(profilePath, result.content, 'utf8');
      }
      deps.sendJson(res, 200, {
        ok: true,
        changed: result.changed,
        preference: result.line.replace(/^- /, ''),
        message: result.changed
          ? `Profile updated: ${result.line.replace(/^- /, '')}`
          : `Profile already up to date: ${result.line.replace(/^- /, '')}`,
      });
    } catch (err) {
      deps.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // The standalone Chat path has no manager runtime to call report_write.
  // Keep its long-answer conversion on the server so reports get the same
  // locked, collision-safe storage and metadata as runtime-written reports.
  if (req.method === 'POST' && urlPath === '/api/chat/report') {
    try {
      const body = JSON.parse(await readRequestBody(req) || '{}') as { title?: unknown; content?: unknown };
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const content = typeof body.content === 'string' ? body.content : '';
      if (!title || !content.trim()) {
        deps.sendJson(res, 400, { error: 'A report needs a title and content.' });
        return true;
      }
      if (content.length > 100_000) {
        deps.sendJson(res, 413, { error: 'Report content exceeds 100000 characters.' });
        return true;
      }
      const report = await writeDonnaReport(deps.rootDir, { title, content });
      deps.sendJson(res, 201, {
        attachment: { kind: 'report', target: report.relativePath, title: report.title },
      });
    } catch (err) {
      deps.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && urlPath === '/api/chat') {
    try {
      const llmTarget = chatLlmProxyTarget(deps.config);
      await deps.proxyPost(req, res, llmTarget.url, llmTarget.headers, {
        retry429: true,
        retryNetwork: true,
      });
    } catch (err) {
      if (!res.headersSent) {
        const status = chatProxyErrorStatus(err);
        deps.sendJson(res, status, {
          error: err instanceof Error ? err.message : String(err),
          ...(status === 502
            ? {
                hint: 'Check that the LLM service is running and reachable from the wiki process.',
              }
            : {}),
        });
      } else {
        res.end();
      }
    }
    return true;
  }

  // The shell is the app: '/' serves it for top-level navigations, while the
  // same URL keeps serving the wiki index when loaded inside the shell's
  // central iframe (Sec-Fetch-Dest: 'document' vs 'iframe'). Requests without
  // the header (curl, tests, old browsers) keep the wiki index — safe default.
  const isRootShell =
    urlPath === '/' && headerString(req.headers['sec-fetch-dest']) === 'document';
  if (urlPath !== '/chat' && urlPath !== '/chat/connectors' && !isRootShell) return false;

  const systemPromptPath = path.join(deps.workspace.paths.internalDir, 'system-prompt.md');
  const systemPromptBase = (await pathExists(systemPromptPath))
    ? (await readFile(systemPromptPath, 'utf8')).trim()
    : undefined;
  const profileSection = await deps.workspace.loadProfileSection(deps.config.limits.maxProfileChars);
  // The model is told its own provider/engine/model here: asked "what is your
  // LLM config?", it otherwise answers from memory and invents one.
  const llmFact = `Active LLM configuration (what YOU run on — answer questions about your own config from here, never from memory): provider=${deps.config.llm.provider ?? 'unset'}, engine=${deps.config.llm.engine ?? 'unspecified'}, model=${deps.config.llm.model ?? 'unset'}, baseUrl=${promptSafeBaseUrl(deps.config.llm.baseUrl)}, temperature=${deps.config.llm.temperature ?? 'unset'}. The vector/embedding model is configured separately and may differ from this chat model.`;
  const systemPrompt = [systemPromptBase, llmFact, profileSection].filter(Boolean).join('\n\n') || undefined;
  // The drawer shows and edits the file alone; the LLM fact and the profile
  // are injected separately (by the runtime, or by the fallback chat below).
  const systemPromptExtras = [llmFact, profileSection].filter(Boolean).join('\n\n');
  const llmConfigured = Boolean(
    deps.config.llm.provider &&
    deps.config.llm.baseUrl &&
    deps.config.llm.apiKey &&
    deps.config.llm.model,
  );
  const { wikiTarget, productionTarget } = resolveMcpTargets(
    deps.mcpWikiPort,
    deps.mcpProductionPort,
  );
  const externalMcpEndpoints = await deps.externalMcpEndpoints();
  // Everything here is serialized into the page: no key, no bearer, and a base
  // URL stripped of the credentials it may carry. /api/chat and /api/mcp add
  // the secrets server-side.
  const chatConfig = {
    provider: deps.config.llm.provider,
    model: deps.config.llm.model,
    temperature: deps.config.llm.temperature,
    baseUrl: promptSafeBaseUrl(deps.config.llm.baseUrl),
    hasApiKey: Boolean(deps.config.llm.apiKey),
    llmConfigured,
    language: deps.config.language ?? 'en',
    workspaceName: deps.workspaceNameFromEnv() ?? path.basename(deps.rootDir),
    ...(systemPrompt ? { systemPrompt } : {}),
    systemPromptFile: systemPromptBase ?? '',
    systemPromptExtras,
    storageScope: createHash('sha256')
      .update(`${deps.workspaceNameFromEnv() ?? ''}:${deps.rootDir}`)
      .digest('hex')
      .slice(0, 16),
    runtime: {
      enabled: Boolean(deps.runtimeUrl()),
    },
    mcpServers: [
      { name: 'llm-wiki', url: wikiTarget, origin: 'builtin' },
      { name: 'wiki-production', url: productionTarget, origin: 'builtin' },
      ...externalMcpEndpoints.map(({ name, url, bearer, timeoutMs, managedBy }) => ({
        name, ...browserSafeMcpUrl(url), origin: managedBy === 'serve-ui' ? 'ui' : 'global',
        hasBearer: Boolean(bearer), ...(timeoutMs ? { timeoutMs } : {}),
      })),
    ],
  };
  const cfgScript = `<script>window.__WIKI_CONFIG__=${escapeScriptJson(JSON.stringify(chatConfig))};</script>`;
  // The tab/window title, favicon and manifest link all name this workspace,
  // not just "Donna" — one installed PWA per workspace should be
  // distinguishable in a taskbar or Dock full of them.
  const displayName = appDisplayName(chatConfig.workspaceName);
  const pageTitle = `Donna — ${displayName}`;
  const headExtras = `<link rel="icon" type="image/svg+xml" href="${appFaviconHref()}">
<link rel="apple-touch-icon" href="${appFaviconHref()}">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(displayName)}">
${cfgScript}`;
  const html = CHAT_HTML
    .replace('<title>Donna</title>', `<title>${escapeHtml(pageTitle)}</title>`)
    .replace('</head>', `${headExtras}</head>`);
  await deps.sendGzippedHtml(req, res, html);
  return true;
}
