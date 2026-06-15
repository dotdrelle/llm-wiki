# Repository Guide

## Purpose

`llm-wiki` is the local-first workspace engine. It ingests Markdown sources into
a persistent wiki, builds retrieval indexes, and regenerates deliverables from
workspace templates and build context.

The repository should stay usable as a standalone CLI and as the engine called
by `llm-wiki-manager`.

## Architecture

```text
bin/wiki.ts              Commander CLI entrypoint
src/commands/           Thin command wrappers
src/config/             .wikirc.yaml loading, defaults, schema
src/services/           Main orchestration and IO
src/prompts/            Prompt builders
src/utils/              Path safety, fs, hashing, markdown, JSON helpers
src/chat/               Browser chat UI generation; chatHtml.ts contains a self-contained event bus (createChatAgentEvent / dispatchChatAgentEvent / applyChatAgentEvent) mirroring the manager's AgentRunEvent contract
scaffold/workspace/     Default workspace copied by `wiki init`
tests/                  Vitest coverage
docs/                   User-facing references
```

## Commands

- `init`: copy `scaffold/workspace` into the workspace.
- `add-skill`: install a workspace skill from a directory, local zip, or HTTP(S)
  zip URL.
- `doctor`: validate config/provider/retrieval/build planning.
- `ingest`: read `raw/untracked/`, create/update wiki pages, archive sources.
- `index`: build/update `.wiki/vector-index`.
- `query`: answer a question from wiki context.
- `build`: generate deliverables from `templates/`.
- `refresh`: rebuild stale deliverables from `.wiki/build-state.json`.
- `export`: expand citations into source detail, optionally polish.
- `lint`: static and optional semantic checks.
- `serve`: local web UI, graph, chat (event-driven trace), skill editor, API proxy.
- `mcp`: stdio MCP server.
- `mcp-http`: Streamable HTTP MCP server.

## Skill Model

A workspace skill is a complete installable method. It uses the same path layout
as the workspace:

```text
skill.yaml
templates/
build-context/
.wiki/skills/
.wiki/system-prompt.md  # optional
CLAUDE.md               # optional
```

`wiki add-skill` behavior:

- validates the package before writing;
- rejects path traversal and symlinks;
- backs up every replaced path under `.wiki/tmp/add-skill-*/backup`;
- replaces only standard paths present in the package;
- writes `.wiki/skill-install.json`;
- appends a wiki log entry.

This is one-skill-per-workspace. Do not implement multi-skill merging unless the
whole model is deliberately redesigned.

The default scaffold is a minimal English `basic` skill. Keep it small and
generic.

## Important Services

- `workspaceService.ts`: workspace paths, source resolution, wiki writes,
  build-context reads, skill installation.
- `ingestService.ts`: source-to-wiki LLM pipeline.
- `buildService.ts`: template slot batching and generation. Slot replacements
  are normalized before insertion: escaped Markdown newlines are restored,
  headings that repeat the template slot heading are removed, and generated
  subheadings are shifted below the template heading level.
- `refreshService.ts`: stale deliverable detection.
- `exportService.ts`: citation expansion and polish.
- `retrievalService.ts`: lexical/vector context assembly.
- `vectorIndexService.ts`: LanceDB index management. Oversized chunks (token limit errors from the embedding API) are skipped for vector indexing only — lexical search still covers them. Non-limit errors (auth, network, config) remain blocking. `VectorIndexBuildResult` exposes `skippedChunks`, `skippedPages`, and `warnings`; the `index` command prints a warning when chunks are skipped.
- `embeddingService.ts`: OpenAI-compatible embeddings.
- `rerankService.ts`: optional reranking endpoint.
- `llmService.ts`: provider abstraction.
- `mcpServer.ts`: MCP tools for reading/searching/writing wiki content.

## Serve Chat — Event System

`chatHtml.ts` embeds a self-contained typed event bus that mirrors the
`llm-wiki-manager` `AgentRunEvent` contract:

```
run_started          clears chain, activities, plan, summary (stale state guard)
tool_call_started    adds a running step to the trace chain
tool_call_result     finalises the step (done / failed)
trace_step_upsert    upserts a derived production/observer step
activity_upserted    registers activity in state.activities
run_summary          stores the final assistant text
run_done / run_error marks the run terminal
```

All trace card mutations in `sendMessage` go through `dispatchChatAgentEvent`.
`trace.steps` is kept as an alias for `trace.agentProjection.chain` so existing
renderers (`renderTrace`, `traceStepHTML`, etc.) continue to work unchanged.

Do not add direct `trace.steps.push()` calls outside the event handlers. Use
`dispatchChatAgentEvent(trace, 'trace_step_upsert', { origin, payload: { step } })`
instead.

## Config and Environment

- `WIKI_CONFIG_PATH`: if set, resolves relative to the workspace root and loads
  that file instead of searching for `.wikirc.yaml`. Used by
  `agent-wiki-production` to pass a specific config profile (e.g.
  `.wikirc.yaml.openai`) per job.
- `WIKI_RUN_CALLER`: if set (to a job ID by `agent-wiki-production`), included
  in `trace:init` log events as `caller`. Used to link CLI trace files back to
  the production job that launched them.

Trace logger (`src/services/traceLogger.ts`) enriches `trace:init` events with
`configFile`, `provider`, `model`, and `caller` when available, so logs are
attributable to their source workspace, provider, and job.

## Safety Rules

- Never write outside the workspace root.
- Treat `raw/untracked/` as the only ingest input area.
- Treat `deliverables/` as generated and reproducible.
- Do not invent facts in generated content; cite available context.
- Preserve MCP bearer-token behavior: the browser must not receive workspace MCP
  tokens.
- Keep skill package installation constrained to the standard layout.
- Do not allow skill zips or directories to install symlinks.
- Keep Docker one-shot CLI usage separate from long-running `serve`.

## Validation

Run before committing changes:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Focused checks:

```bash
pnpm exec vitest run tests/workspace.test.ts
pnpm dev add-skill ./path/to/skill
pnpm dev build --plan
```

## Docker Notes

The runtime image must include production dependencies. The built CLI imports
runtime packages, and `serve` resolves browser assets from `node_modules`.

`EXPOSE 3000` does not start `wiki serve`. Compose services must explicitly run
the desired command.
