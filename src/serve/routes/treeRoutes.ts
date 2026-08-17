import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createEntry,
  deleteEntry,
  moveEntry,
  type TreeResult,
} from '../tree/treeMutations.ts';

/**
 * Left-panel mutation routes, shared by all of its sections.
 *
 * `/api/untracked/*` stays served for Pending — same paths, same contract — but
 * it delegates here. These routes carry no rule: they read the request, call
 * the module, and render the result. Everything that decides (authorized roots,
 * extensions, no-escape) lives in `treeMutations.ts`, so there is only one
 * place to re-read when asking what a browser-supplied path is allowed to be.
 */
export type TreeRoutesDeps = {
  rootDir: string;
  readRequestBuffer: (req: IncomingMessage, maxBytes?: number) => Promise<Buffer>;
  sendJson: (res: ServerResponse, status: number, data: unknown) => void;
  /**
   * An active run modifies the wiki: moving its files under its feet would
   * produce incomprehensible failures. Same refusal as `POST /mcp/endpoints`,
   * and for the same reason.
   */
  isRunActive?: () => Promise<boolean>;
  /**
   * Record a deletion in the workspace history, under its own message.
   *
   * Without it a deletion left no commit at all: the file vanished, `git
   * status` carried it until some later run swept it into an `ingest:` or
   * `build:` commit whose message spoke of something else entirely. The
   * deletion was recoverable and mislabelled, which is the worst of both.
   *
   * Best-effort by contract: a workspace without history, or a failing commit,
   * must not turn a successful deletion into an error — the file IS gone.
   */
  commitDeletion?: (relativePath: string, kind: 'file' | 'folder') => Promise<void>;
  /** Pages linking to a path, for the confirmation the browser shows. */
  countReferences?: (relativePath: string) => Promise<string[]>;
};

function respond(res: ServerResponse, deps: TreeRoutesDeps, result: TreeResult): true {
  if (result.ok) deps.sendJson(res, result.status, { ok: true, ...result.body });
  else deps.sendJson(res, result.status, { ok: false, error: result.error });
  return true;
}

async function readBody(
  req: IncomingMessage,
  deps: TreeRoutesDeps,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await deps.readRequestBuffer(req, 16_384);
    return raw.length > 0 ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

export async function handleTreeApi(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: TreeRoutesDeps,
): Promise<boolean> {
  const isTree = urlPath === '/api/tree/move'
    || urlPath === '/api/tree/create'
    || urlPath.startsWith('/api/tree/')
    || urlPath === '/api/untracked/move'
    || urlPath.startsWith('/api/untracked/');
  if (!isTree) return false;

  const mutating = req.method === 'POST' || req.method === 'DELETE';
  if (mutating && (await deps.isRunActive?.())) {
    deps.sendJson(res, 409, { ok: false, error: 'a run is active — try again once it finishes' });
    return true;
  }

  if ((urlPath === '/api/tree/move' || urlPath === '/api/untracked/move') && req.method === 'POST') {
    const body = await readBody(req, deps);
    if (!body) return respond(res, deps, { ok: false, status: 400, error: 'invalid request' });
    return respond(res, deps, await moveEntry(deps.rootDir, body.from, body.to));
  }

  if (urlPath === '/api/tree/create' && req.method === 'POST') {
    const body = await readBody(req, deps);
    if (!body) return respond(res, deps, { ok: false, status: 400, error: 'invalid request' });
    const kind = body.kind === 'folder' ? 'folder' : 'file';
    return respond(res, deps, await createEntry(deps.rootDir, body.parent, body.name, kind));
  }

  /*
   Who points at this path, before anything is destroyed.

   Read-only, and deliberately answered from the graph snapshot rather than a
   second link parser: the count a reader is shown must be the one the graph
   draws, or the two disagree the day one of them learns a new link syntax.
  */
  if (urlPath === '/api/tree/references' && req.method === 'GET') {
    const raw = new URL(req.url ?? '', 'http://localhost').searchParams.get('path') ?? '';
    const pages = (await deps.countReferences?.(raw)) ?? [];
    deps.sendJson(res, 200, { ok: true, path: raw, count: pages.length, pages: pages.slice(0, 20) });
    return true;
  }

  const deleteMatch = urlPath.match(/^\/api\/(?:tree|untracked)\/(.+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const result = await deleteEntry(deps.rootDir, deleteMatch[1] ?? '');
    if (result.ok) {
      const deleted = String(result.body.path ?? '');
      const kind = result.body.kind === 'folder' ? 'folder' : 'file';
      // Never let the bookkeeping fail the operation it only describes.
      await deps.commitDeletion?.(deleted, kind).catch(() => {});
    }
    return respond(res, deps, result);
  }

  return false;
}
