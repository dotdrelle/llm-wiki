# Industrialisation and multi-user readiness

Version 0.11.0 is an industrialized single-user deployment baseline. This
document specifies the multi-user boundary, but the implementation is planned
for 0.12.0. Until then, runtime write access must stay local/proxied and must
not be exposed as a shared multi-user surface.

## MCP HTTP service sharing

`wiki mcp-http` keeps one shared service context per workspace/config key:

- `WorkspaceService` is shared for filesystem path resolution and workspace
  helpers.
- `RetrievalService` is shared so vector clients, rerank clients, and query
  caches are not recreated for every HTTP request.
- `McpServer` and `StreamableHTTPServerTransport` are still created per request,
  because they own request/transport state and must not leak sessions between
  clients.

The context key includes workspace path and retrieval settings, but not tokens
or API keys. `WIKI_MCP_CONTEXT_TTL_MS` controls context lifetime. Default:
`30000`. Set `0` to keep contexts for the process lifetime.

Write tools invalidate retrieval cache after wiki writes. External filesystem
changes can remain cached until the context TTL expires; use a short TTL in
controlled single-user deployments where files can be modified outside
`wiki mcp-http`.

## Multi-user boundary

Multi-user support is not just multiple browser tabs. A shared deployment needs
explicit ownership and conflict rules before write access is exposed broadly.

Required model:

- identity: authenticated user/service principal on every request;
- rights: workspace membership plus read/write/admin scopes;
- run ownership: `runId`, `turnId`, `workspace`, `caller`, and owner on every
  runtime event and audit record;
- locks: workspace write, wiki page write, deliverable write, and profile write;
- conflicts: optimistic revision or hash checks before write, with diff preview;
- history: append-only audit for reads that export data and all writes;
- cancellation: run owner or admin only, unless a service account policy says
  otherwise.

Until that model is implemented, `wiki mcp-http` and the manager runtime should
be treated as workspace-scoped service endpoints protected by bearer tokens, not
as multi-tenant application boundaries. The manager runtime binds to
`127.0.0.1` by default; exposed-host mode (`--host 0.0.0.0`) is an explicit
deployment choice, not the default.

### Lock model already in production

The production agent (`agent-wiki-production`) already implements the per-run
lock model that the multi-user boundary above names as a requirement. It is
deliberately asymmetric in *severity* but symmetric in *detection*, and this
design is what multi-user ownership must preserve, not reinvent:

- **`workspace-write` is exclusive and excludes *everything*** — another write
  *and* any concurrent read. This serializes `ingest_apply` by design: two
  applies can never hold the workspace write lock at once, so no write starts
  while a parallel plan's read locks are still held.
- **`read` is shared but per-holder**: each read-only job (e.g. a per-file
  `ingest_plan`) gets its own lock file, so several reads coexist instead of
  colliding on a single per-scope file. The detection is still symmetric — a
  write candidate always sees an active read as a conflict.
- **Exclusive scopes are single-file mutexes** created atomically
  (`open(..., "x")`); the second acquirer fails with `target_busy` rather than
  blocking. `deliverable:*`, `template:*` and `ingest-plan:<file>` are a finer
  grain below `workspace-write` for the build/export jobs.
- **Isolation is structural and per-workspace**: locks are scoped by
  `_WORKSPACE_NAME` under the agent's state directory, so the agent of one
  workspace never sees, and is never blocked by, the lock of another workspace.
  Two parallel runs across different workspaces do not contend.

This is the foundation the multi-user model must keep: one workspace at a time
gets a write claim, reads are safe to run in parallel, and no cross-workspace
coupling is introduced by the lock namespace. The multi-user work adds identity,
run ownership and audit on top; it must not weaken this exclusivity.

## Packaging contract

Supported local runtime:

- Node.js 22 or newer;
- package manager: pnpm for this repository;
- Bun is not required by `llm-wiki`; it is used by `llm-wiki-manager`.

Supported Docker runtime:

- entrypoint: `node /app/bin/wiki.js`;
- one-shot commands: `docker compose --profile cli run --rm wiki <command>`;
- long-running UI: `docker compose up serve`;
- long-running MCP HTTP: `docker compose --profile mcp-http up mcp-http`;
- healthchecks use Node's built-in `fetch`, not `curl`.

Images are workspace-agnostic. Mount an initialized workspace at `/workspace`
and set `WIKI_WORKSPACE=/workspace`; do not bake workspace content or secrets
into the image.

## License and product strategy

This repository is licensed under PolyForm Noncommercial 1.0.0. The practical
product rule is:

- personal, educational, research, evaluation, and hobby use are allowed under
  the public license;
- company use, client work, SaaS, paid services, managed hosting, internal
  business workflows, or commercial redistribution require a separate written
  commercial license;
- modified versions and container images keep the same non-commercial
  restriction unless a commercial license says otherwise.

Publish images only with a clear non-commercial notice and a link to
`COMMERCIAL-LICENSE.md`. Do not describe public images as enterprise-ready until
commercial terms, support expectations, and multi-user controls are defined.
