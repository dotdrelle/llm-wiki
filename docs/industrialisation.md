# Industrialisation and multi-user readiness

Version 0.11.0 prepares the runtime for shared deployments without changing the
single-workspace local-first contract.

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
shared deployments where files can be modified outside `wiki mcp-http`.

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

Until that model is implemented, `wiki mcp-http` should be treated as a
workspace-scoped service endpoint protected by bearer tokens, not as a
multi-tenant application boundary.

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
