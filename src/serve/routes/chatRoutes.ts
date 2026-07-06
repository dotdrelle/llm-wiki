import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CHAT_HTML } from '../../chat/chatHtml.ts';
import type { AppConfig } from '../../types.ts';
import { pathExists } from '../../utils/fs.ts';
import { escapeScriptJson } from '../html/wikiHtml.ts';
import { resolveMcpTargets, type ExternalMcpEndpoint } from './uploadRoutes.ts';

type ChatWorkspace = {
  paths: { internalDir: string };
  loadProfileSection: (maxChars: number) => Promise<string>;
};

type ChatRoutesDeps = {
  config: AppConfig;
  externalMcpEndpoints: ExternalMcpEndpoint[];
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

function chatLlmProxyTarget(req: IncomingMessage, config: AppConfig): {
  url: string;
  headers: Record<string, string>;
} {
  const overrideBaseUrl = headerString(req.headers['x-llm-wiki-llm-base-url']);
  const overrideApiKey = headerString(req.headers['x-llm-wiki-llm-api-key']);
  let baseUrl = config.llm.baseUrl;
  if (overrideBaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(overrideBaseUrl);
    } catch {
      throw new Error('INVALID_LLM_BASE_URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('INVALID_LLM_BASE_URL');
    }
    baseUrl = overrideBaseUrl;
  }
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: {
      authorization: `Bearer ${overrideApiKey ?? config.llm.apiKey ?? ''}`,
    },
  };
}

function chatProxyErrorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  return message === 'INVALID_LLM_BASE_URL' ? 400 : 502;
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
          ? `Profil mis à jour : ${result.line.replace(/^- /, '')}`
          : `Profil déjà à jour : ${result.line.replace(/^- /, '')}`,
      });
    } catch (err) {
      deps.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && urlPath === '/api/chat') {
    try {
      const llmTarget = chatLlmProxyTarget(req, deps.config);
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

  if (urlPath !== '/chat' && urlPath !== '/chat/connectors') return false;

  const systemPromptPath = path.join(deps.workspace.paths.internalDir, 'system-prompt.md');
  const systemPromptBase = (await pathExists(systemPromptPath))
    ? (await readFile(systemPromptPath, 'utf8')).trim()
    : undefined;
  const profileSection = await deps.workspace.loadProfileSection(deps.config.limits.maxProfileChars);
  const systemPrompt = [systemPromptBase, profileSection].filter(Boolean).join('\n\n') || undefined;
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
  const chatConfig = {
    provider: deps.config.llm.provider,
    model: deps.config.llm.model,
    temperature: deps.config.llm.temperature,
    baseUrl: deps.config.llm.baseUrl,
    apiKey: deps.config.llm.apiKey ?? '',
    llmConfigured,
    language: deps.config.language ?? 'fr',
    workspaceName: deps.workspaceNameFromEnv() ?? path.basename(deps.rootDir),
    ...(systemPrompt ? { systemPrompt } : {}),
    storageScope: createHash('sha256')
      .update(`${deps.workspaceNameFromEnv() ?? ''}:${deps.rootDir}`)
      .digest('hex')
      .slice(0, 16),
    runtime: {
      enabled: Boolean(deps.runtimeUrl()),
    },
    mcpServers: [
      { name: 'llm-wiki', url: wikiTarget },
      { name: 'wiki-production', url: productionTarget },
      ...deps.externalMcpEndpoints.map(({ name, url, bearer }) => ({
        name, url, ...(bearer ? { bearer } : {}),
      })),
    ],
  };
  const cfgScript = `<script>window.__WIKI_CONFIG__=${escapeScriptJson(JSON.stringify(chatConfig))};</script>`;
  await deps.sendGzippedHtml(req, res, CHAT_HTML.replace('</head>', `${cfgScript}</head>`));
  return true;
}
