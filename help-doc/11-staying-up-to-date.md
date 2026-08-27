# Staying up to date

This chapter answers one question: when a source changes, how does the
documentation follow — and how much of that is automatic.

## The short answer

DONNA **detects** drift automatically, and **regenerates** on request. Nothing
watches the source tree and rebuilds on its own: an update is a deliberate,
approval-gated action, or a scheduled headless command. "Documentation always up
to date" is therefore true as *detectable and re-generable in one command*, not
as a continuous background sync.

## How drift is detected

Detection is deterministic and costs nothing — none of it calls the LLM:

- **Deliverables.** Every build records the hash of its template, of the wiki it
  was built from, and of its build context. `wiki refresh` compares these and
  rebuilds only what changed; `wiki lint` lists the deliverables that no longer
  match their inputs.
- **Taxonomy.** Publishing the taxonomy freezes a **knowledge fingerprint** of
  the corpus. If the corpus moves afterwards, the `/graph` view flags the
  taxonomy as stale, and the coverage counts show which pages are unclassified
  or still pending.
- **Sources.** A source whose produced pages have disappeared is re-ingested on
  the next sync instead of being skipped as "unchanged".

## How to update on demand

- `wiki refresh` — rebuild only the stale deliverables.
- `wiki build`, or `/wiki-build [template]` — rebuild everything, or one template.
- `wiki ingest`, or `/wiki-ingest [files]` — turn new or edited sources into
  wiki pages.
- `/wiki-sync [source]` — export Confluence sources, then ingest, refresh the
  concept grid and republish the taxonomy.
- `/pipeline` — the whole chain in one run: ingest, taxonomy, build, export,
  polish.

The full default chain is: ingest, concepts, reclassify-concepts, taxonomy,
build, export, polish (see `03-content-lifecycle.md`).

## Automating it (headless)

For a cron job or CI, run the headless manager. Two commands cover the whole
loop:

```bash
# knowledge: sources -> wiki -> concept grid -> taxonomy
wiki-manager --headless --workspace <name> --skill "wiki-sync" --auto-approve --timeout 3600

# deliverables: build -> export -> polish
wiki-manager --headless --workspace <name> --skill "pipeline" --auto-approve --timeout 3600
```

Why two commands: `wiki-sync` never builds deliverables, and `pipeline` does not
export Confluence — each covers one half of the loop.

- `--auto-approve` is required: mutations are approval-gated by default, and
  headless is the explicit opt-in for unattended runs.
- The wait is chain-scoped: the command exits non-zero if a step of the chain
  failed.

## Optimized for agents

The same pages that stay up to date are the ones an AI agent reads. Read-only
MCP tools (`wiki_read_page`, `wiki_collect_context`, `wiki_outline`, …) and
mandatory `[src: …]` citations make every generated statement traceable to a
source. Up-to-dateness and agent-readability are the same property here: a page
is either anchored in a source, or visibly out of date.

See `07-commands-shell.md` and `08-commands-serve.md` for the exact commands.
