import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathExists, safeWriteFile } from '../../utils/fs.ts';

export type ExternalMcpEndpoint = {
  name: string;
  url: string;
  headers: Record<string, string>;
  bearer?: string;
};

export function resolveMcpTargets(
  mcpWikiPort: () => string,
  mcpProductionPort: () => string,
): { wikiTarget: string; productionTarget: string } {
  return {
    wikiTarget: process.env.WIKI_MCP_PROXY_URL ?? `http://localhost:${mcpWikiPort()}/mcp`,
    productionTarget:
      process.env.PRODUCTION_MCP_PROXY_URL ?? `http://localhost:${mcpProductionPort()}/mcp/`,
  };
}

export type DocumentUploadRecord = {
  id: string;
  workspace: string;
  filename: string;
  storedPath: string;
  agentPath: string;
  status: 'stored' | 'converting' | 'converted' | 'failed';
  provider: string | null;
  outputPath: string | null;
  method: string | null;
  bytes: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type UploadRoutesDeps = {
  rootDir: string;
  externalMcpEndpoints: ExternalMcpEndpoint[];
  workspaceNameFromEnv: () => string | null;
  documentInputDir: (rootDir: string) => string;
  documentUploadsDir: (rootDir: string) => string;
  documentMaxUploadBytes: () => number;
  version: string;
  readRequestBuffer: (req: IncomingMessage, maxBytes?: number) => Promise<Buffer>;
  sendJson: (
    res: {
      writeHead: (s: number, h: Record<string, string>) => void;
      end: (c?: string) => void;
    },
    status: number,
    data: unknown,
  ) => void;
};

const DOCUMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.rtf',
  '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp',
  '.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.odt', '.ods', '.odp',
  '.pdf',
]);

function sanitizeUploadFilename(filename: string): string {
  const name = path.basename(filename || 'upload.bin')
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/g, '')
    .slice(0, 120);
  return name || 'upload.bin';
}

function assertDocumentUpload(filename: string, bytes: number, documentMaxUploadBytes: () => number): void {
  const ext = path.extname(filename).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(ext)) throw new Error(`Unsupported document type: ${ext || 'no extension'}`);
  const configuredMax = documentMaxUploadBytes();
  const max = Number.isFinite(configuredMax) && configuredMax > 0
    ? configuredMax
    : 50 * 1024 * 1024;
  if (bytes > max) throw new Error(`Document is too large: ${bytes} bytes (max ${max}).`);
}

function documentManifestPath(rootDir: string, workspaceName: string, documentUploadsDir: (rootDir: string) => string): string {
  return path.join(documentUploadsDir(rootDir), `${workspaceName}.jsonl`);
}

async function readDocumentUploads(rootDir: string, workspaceName: string, deps: Pick<UploadRoutesDeps, 'documentUploadsDir'>): Promise<DocumentUploadRecord[]> {
  const filePath = documentManifestPath(rootDir, workspaceName, deps.documentUploadsDir);
  if (!(await pathExists(filePath))) return [];
  const raw = await readFile(filePath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as DocumentUploadRecord];
    } catch {
      return [];
    }
  });
}

async function writeDocumentUploads(
  rootDir: string,
  workspaceName: string,
  records: DocumentUploadRecord[],
  deps: Pick<UploadRoutesDeps, 'documentUploadsDir'>,
): Promise<void> {
  const filePath = documentManifestPath(rootDir, workspaceName, deps.documentUploadsDir);
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  await safeWriteFile(filePath, body ? `${body}\n` : '');
}

async function upsertDocumentUpload(
  rootDir: string,
  record: DocumentUploadRecord,
  deps: Pick<UploadRoutesDeps, 'documentUploadsDir'>,
): Promise<DocumentUploadRecord> {
  const records = await readDocumentUploads(rootDir, record.workspace, deps);
  const index = records.findIndex((item) => item.id === record.id);
  if (index === -1) records.unshift(record);
  else records[index] = { ...records[index], ...record };
  await writeDocumentUploads(rootDir, record.workspace, records, deps);
  return record;
}

async function removeDocumentUploadsForFilename(
  rootDir: string,
  workspaceName: string,
  filename: string,
  deps: Pick<UploadRoutesDeps, 'documentUploadsDir'>,
): Promise<void> {
  const records = await readDocumentUploads(rootDir, workspaceName, deps);
  const removed = records.filter((item) => item.filename === filename);
  if (removed.length === 0) return;
  for (const record of removed) {
    for (const filePath of [record.storedPath, record.outputPath]) {
      if (filePath) await rm(filePath, { force: true }).catch(() => {});
    }
  }
  await writeDocumentUploads(rootDir, workspaceName, records.filter((item) => item.filename !== filename), deps);
}

function parseMultipartUpload(body: Buffer, contentType: string): { filename: string; content: Buffer } {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1]
    ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error('Missing multipart boundary.');
  const marker = Buffer.from(`--${boundary}`);
  let offset = 0;
  while (offset < body.length) {
    const start = body.indexOf(marker, offset);
    if (start === -1) break;
    const headerStart = start + marker.length;
    if (body.slice(headerStart, headerStart + 2).toString() === '--') break;
    const partStart = body.slice(headerStart, headerStart + 2).toString() === '\r\n'
      ? headerStart + 2
      : headerStart;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) break;
    const headers = body.slice(partStart, headerEnd).toString('utf8');
    const filename = headers.match(/filename="([^"]+)"/i)?.[1];
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const next = body.indexOf(marker, headerEnd + 4);
    if (next === -1) break;
    let content = body.slice(headerEnd + 4, next);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    if (filename && (!name || name === 'file')) {
      return { filename, content };
    }
    offset = next;
  }
  throw new Error('No file part found.');
}

function parseMcpPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  const isSSE = firstLine.startsWith('event:') || firstLine.startsWith('data:') || firstLine.startsWith(':');
  if (isSSE) {
    const data = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(trimmed);
}

async function postMcp(endpoint: ExternalMcpEndpoint & { sessionId?: string }, method: string, params: unknown, version: string): Promise<unknown> {
  const headers = () => ({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...endpoint.headers,
    ...(endpoint.sessionId ? { 'mcp-session-id': endpoint.sessionId } : {}),
  });
  const request = async (rpcMethod: string, rpcParams?: unknown) => {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: rpcMethod, params: rpcParams }),
    });
    const sid = response.headers.get('mcp-session-id');
    if (sid) endpoint.sessionId = sid;
    const text = await response.text();
    return { response, text };
  };
  let { response, text } = await request(method, params);
  if (response.status === 400 && /session ID/i.test(text)) {
    endpoint.sessionId = undefined;
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'llm-wiki-serve', version },
    });
    if (!init.response.ok || !endpoint.sessionId) throw new Error(`initialize failed: ${init.response.status}`);
    await request('notifications/initialized', {});
    ({ response, text } = await request(method, params));
  }
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 160)}`.trim());
  const payload = parseMcpPayload(text) as { error?: { message?: string }; result?: unknown } | null;
  if (payload?.error) throw new Error(payload.error.message ?? JSON.stringify(payload.error));
  return payload?.result ?? null;
}

function isMcpUnavailable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|timeout|initialize failed|502|503|504/i.test(text);
}

function mcpTextResult(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return JSON.stringify(result ?? {}, null, 2);
  return content
    .map((item) => {
      if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
        return String((item as { text?: unknown }).text ?? '');
      }
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join('\n\n');
}

async function pollDocumentConversionJob(
  endpoint: ExternalMcpEndpoint & { sessionId?: string },
  jobId: string,
  version: string,
  maxWaitMs = 300_000,
): Promise<{ ok: boolean; outputPath?: string; method?: string; error?: string }> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2500));
    try {
      const result = await postMcp(endpoint, 'tools/call', {
        name: 'documents_conversion_status',
        arguments: { jobId },
      }, version);
      const poll = JSON.parse(mcpTextResult(result) || '{}') as { ok?: boolean; error?: string; outputPath?: string; method?: string; _activity?: { terminal?: boolean; status?: string; error?: string } };
      const activity = poll._activity;
      if (activity?.terminal) {
        if (poll.ok === false || activity.status === 'failed' || activity.status === 'error') {
          return { ok: false, error: poll.error ?? activity.error ?? 'conversion failed' };
        }
        return { ok: true, outputPath: poll.outputPath, method: poll.method };
      }
    } catch {
      // transient poll error - retry
    }
  }
  return { ok: false, error: 'conversion timeout' };
}

async function convertDocumentUpload(rootDir: string, record: DocumentUploadRecord, deps: UploadRoutesDeps): Promise<DocumentUploadRecord> {
  const endpoint = deps.externalMcpEndpoints.find((item) => item.name === 'documents');
  if (!endpoint) {
    record.status = 'stored';
    record.provider = null;
    record.error = 'documents MCP endpoint is not configured';
    record.updatedAt = new Date().toISOString();
    return upsertDocumentUpload(rootDir, record, deps);
  }
  record.status = 'converting';
  record.provider = 'documents';
  record.error = null;
  record.updatedAt = new Date().toISOString();
  await upsertDocumentUpload(rootDir, record, deps);
  try {
    const stem = record.filename.replace(/\.[^.]+$/, '');
    const sessionEndpoint: ExternalMcpEndpoint & { sessionId?: string } = { ...endpoint };
    const result = await postMcp(sessionEndpoint, 'tools/call', {
      name: 'documents_convert_to_markdown',
      arguments: {
        workspace: record.workspace,
        filePath: record.agentPath,
        outputFilename: `${record.id}-${stem}.md`,
      },
    }, deps.version);
    const parsed = JSON.parse(mcpTextResult(result) || '{}') as { ok?: boolean; error?: string; outputPath?: string; method?: string; jobId?: string; _activity?: { terminal?: boolean } };
    if (parsed.ok === false) throw new Error(parsed.error || 'documents conversion failed');

    let outputPath = parsed.outputPath;
    let method = parsed.method;

    if (parsed.jobId && !parsed._activity?.terminal) {
      const poll = await pollDocumentConversionJob(sessionEndpoint, parsed.jobId, deps.version);
      if (!poll.ok) throw new Error(poll.error || 'conversion failed');
      outputPath = poll.outputPath;
      method = poll.method;
    }

    record.status = 'converted';
    record.outputPath = outputPath ?? null;
    record.method = method ?? null;
    record.error = null;
  } catch (err) {
    record.status = isMcpUnavailable(err) ? 'stored' : 'failed';
    record.error = err instanceof Error ? err.message : String(err);
  }
  record.updatedAt = new Date().toISOString();
  return upsertDocumentUpload(rootDir, record, deps);
}

export async function handleUploadRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: UploadRoutesDeps,
): Promise<boolean> {
  const workspaceName = deps.workspaceNameFromEnv() ?? path.basename(process.env.WIKI_WORKSPACE_PATH ?? process.cwd());
  if (urlPath === '/api/uploads' && req.method === 'GET') {
    deps.sendJson(res, 200, { ok: true, uploads: await readDocumentUploads(deps.rootDir, workspaceName, deps) });
    return true;
  }
  if (urlPath === '/api/upload' && req.method === 'POST') {
    try {
      const contentType = String(req.headers['content-type'] ?? '');
      const configuredMax = deps.documentMaxUploadBytes();
      const maxUploadBytes = Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : 50 * 1024 * 1024;
      const { filename: rawFilename, content } = parseMultipartUpload(await deps.readRequestBuffer(req, maxUploadBytes + 1024 * 1024), contentType);
      const filename = sanitizeUploadFilename(rawFilename);
      assertDocumentUpload(filename, content.length, deps.documentMaxUploadBytes);
      await removeDocumentUploadsForFilename(deps.rootDir, workspaceName, filename, deps);
      const id = randomUUID().slice(0, 8);
      const storedFilename = `${id}-${filename}`;
      const inputDir = path.join(deps.documentInputDir(deps.rootDir), workspaceName);
      await mkdir(inputDir, { recursive: true });
      const storedPath = path.join(inputDir, storedFilename);
      await writeFile(storedPath, content);
      const now = new Date().toISOString();
      let record: DocumentUploadRecord = {
        id,
        workspace: workspaceName,
        filename,
        storedPath,
        agentPath: `${deps.documentInputDir(deps.rootDir)}/${workspaceName}/${storedFilename}`,
        status: 'stored',
        provider: null,
        outputPath: null,
        method: null,
        bytes: content.length,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await upsertDocumentUpload(deps.rootDir, record, deps);
      record = await convertDocumentUpload(deps.rootDir, record, deps);
      deps.sendJson(res, 200, { ok: true, upload: record });
    } catch (err) {
      deps.sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }
  const convertMatch = urlPath.match(/^\/api\/uploads\/([^/]+)\/convert$/);
  if (convertMatch && req.method === 'POST') {
    const id = convertMatch[1];
    const record = (await readDocumentUploads(deps.rootDir, workspaceName, deps)).find((item) => item.id === id);
    if (!record) deps.sendJson(res, 404, { ok: false, error: 'upload not found' });
    else deps.sendJson(res, 200, { ok: true, upload: await convertDocumentUpload(deps.rootDir, record, deps) });
    return true;
  }
  return false;
}
