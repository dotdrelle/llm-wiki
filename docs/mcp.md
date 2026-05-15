# MCP integration

`llm-wiki` exposes the wiki workspace as an MCP server so AI assistants (Claude Desktop, Claude Code, OpenWebUI) can read and update the wiki directly without leaving the conversation.

Two transports are available:

| Command         | Transport       | Use when                                                         |
| --------------- | --------------- | ---------------------------------------------------------------- |
| `wiki mcp`      | stdio           | The MCP client can launch a local process (Claude Desktop/Code)  |
| `wiki mcp-http` | Streamable HTTP | The client connects over HTTP (remote Claude, Docker, OpenWebUI) |

## Exposed tools

| Tool                         | Description                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `wiki_list_pages`            | List all pages under `wiki/` with their type                                                                                          |
| `wiki_read_page`             | Read a page by relative path (e.g. `wiki/concepts/foo.md`)                                                                            |
| `wiki_read_pages`            | Read multiple wiki pages by relative path in one call                                                                                 |
| `wiki_write_page`            | Write or update a page — restricted to `wiki/*` paths                                                                                 |
| `wiki_list_ingested_sources` | List ingested source documents in `raw/ingested/`                                                                                     |
| `wiki_read_ingested_source`  | Read an ingested source by relative path when raw source inspection is needed                                                         |
| `wiki_search_context`        | Search wiki pages (excluding `wiki/answers/`) and return ranked paths, excerpts, and `relatedPaths`. Uses vector search when enabled. |
| `wiki_collect_context`       | Search wiki pages, read up to 10 returned pages by default, and report coverage in one call                                           |

Write operations go through the same path guards as `wiki ingest`: `resolveInside` rejects `../../` traversal and `applyWikiOperations` refuses paths outside `wiki/`.

**Recommended search flow for simple lookup:**

1. Call `wiki_search_context` with the user question.
2. Inspect returned paths, scores, excerpts, and `[src: ...]` citations.
3. Call `wiki_read_page` or `wiki_read_pages` for the pages you want to read in full.
4. Produce the answer from that context.

**Recommended search flow for synthesis, architecture, audit, functional analysis, or comparison:**

1. Call `wiki_collect_context` with the user question.
2. Use `readPagePaths` as the authoritative list of pages opened by the tool.
3. Use `readPages` as the primary evidence.
4. Treat `candidateResults.excerpt` as search trace only: it explains why pages were selected but is not the main evidence.
5. If coverage is insufficient, call `wiki_search_context`, `wiki_read_page`, `wiki_read_pages`, or `wiki_read_ingested_source` to gather the missing evidence.
6. End with a short coverage note that distinguishes pages read in full, pages truncated, and `raw/ingested/` sources cited but not read.

Manual equivalent:

1. Call `wiki_search_context`.
2. Select the relevant `wiki/**` paths.
3. Call `wiki_read_pages` with those paths.
4. Answer only from the pages read in full and report coverage.

Do not use `wiki_search_context` excerpts alone as the evidence base for synthesis-style answers. Excerpts are for triage and path selection.

## Browser chat UI

`wiki serve` also exposes `/chat`, a browser client for OpenAI-compatible chat
completion endpoints with MCP tool calling.

The chat UI:

- connects to Streamable HTTP MCP servers from the browser through the local
  `/api/mcp` proxy;
- exposes discovered MCP tools as OpenAI-compatible `tools`;
- loops over `assistant.tool_calls`, calls MCP `tools/call`, appends `role: tool`
  results, and asks the model again until it answers or the turn limit is reached;
- shows a visual MCP chain for observable tool activity;
- renders tool results in compact cards, with raw JSON collapsed by default;
- turns local `wiki/**` and `raw/ingested/**` paths into rendered Markdown modals;
- provides an editable system-instructions drawer for MCP workflow guidance.

The visual chain reports actual model-requested tools. For `wiki_collect_context`,
the chain also shows derived internal read coverage such as `readPages`, truncated
pages, and raw sources referenced but not opened. These derived tiles are not
separate MCP calls; they come from the `wiki_collect_context` result payload.

`tool_choice` remains `auto`, so the model decides whether a second tool call is
needed. If `wiki_collect_context` returns enough `readPages`, a later
`wiki_read_pages` call may not happen.

## `wiki mcp` — stdio

The server must be launched from inside the workspace (or a subdirectory) so it can locate `.wikirc.yaml`.

### Claude Code

Add to `.claude/settings.json` at the root of your wiki workspace:

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "wiki",
      "args": ["mcp"],
      "type": "stdio",
      "env": { "WIKI_MCP_AUTH_TOKEN": "your-secret-key" }
    }
  }
}
```

`cwd` is not needed — Claude Code runs in the workspace directory and finds `.wikirc.yaml` automatically. Omit `env` if no `accessKey` is configured.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "/absolute/path/to/wiki",
      "args": ["mcp"],
      "type": "stdio",
      "cwd": "/absolute/path/to/your/wiki-workspace",
      "env": { "WIKI_MCP_AUTH_TOKEN": "your-secret-key" }
    }
  }
}
```

`cwd` must point to the workspace containing `.wikirc.yaml`. Use `which wiki` to find the binary path, or point directly at `dist/bin/wiki.js`.

### Prerequisites

`wiki` must be available in the PATH used by the MCP host:

```bash
cd /path/to/llm-wiki
pnpm build
pnpm link --global
```

Restart Claude Desktop (or reload Claude Code) after editing the config.

## `wiki mcp-http` — Streamable HTTP

```bash
wiki mcp-http
wiki mcp-http --host 0.0.0.0 --port 3333 --path /mcp
```

| Option   | Description        | Default     |
| -------- | ------------------ | ----------- |
| `--host` | Address to bind    | `127.0.0.1` |
| `--port` | TCP port           | `3333`      |
| `--path` | HTTP endpoint path | `/mcp`      |

Authentication uses a Bearer token:

```
Authorization: Bearer <mcp.accessKey>
```

If `mcp.accessKey` is not set, the endpoint accepts unauthenticated connections — only do this on a trusted network.

### HTTPS / TLS

Provide `certPath` and `keyPath` together; `caPath` is optional for mutual TLS.

```yaml
mcp:
  accessKey: your-secret-key
  tls:
    certPath: /certs/fullchain.pem
    keyPath: /certs/privkey.pem
    caPath: /certs/ca.pem # optional
```

Environment variable equivalents: `WIKI_MCP_TLS_CERT_PATH`, `WIKI_MCP_TLS_KEY_PATH`, `WIKI_MCP_TLS_CA_PATH`.

Relative paths are resolved against the workspace root; absolute paths (e.g. Docker volume mounts) are used as-is.

### Docker

```bash
docker compose --profile mcp-http up mcp-http
# → http://localhost:3101/mcp
```

See [docker.md](./docker.md) for the TLS variant.

## Access key

Set an optional access key in `.wikirc.yaml`:

```yaml
mcp:
  accessKey: your-secret-key
```

Pass the same value as `WIKI_MCP_AUTH_TOKEN` in the MCP client config. If the key is configured but the env var is absent or mismatched, the server exits immediately with an error.
