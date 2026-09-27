# Retrieval evaluation

`pnpm eval:retrieval <cases.json>` replays workspace questions against the
configured retrieval stack and reports hit rate, mean reciprocal rank (MRR),
and whether a result contains the expected evidence quote. It does not call a
chat model. A configured vector search may call the configured embedding and
reranking endpoints and populate the query-embedding cache, so use workspace
copies for evaluations that must not write to the source workspace. Use
`--lexical-only` for a fully local BM25-only pass, or `--json` for a
machine-readable report.
Each case also reports the effective path (`hybrid`, `lexical`, or
`lexical-fallback`) and a bounded fallback reason. This prevents a lexical
fallback from being reported as a successful configured vector evaluation.
Cases may include a `language` label so translated query variants against the
same expected pages can be measured separately. It is evaluation metadata only;
it does not select rules or vocabularies in the engine.
When each workspace copy was produced with a different ingestion model, cases
may also include `producerModel`; the report then includes per-model metrics.
That label records provenance for the evaluation and does not change retrieval.
Cases for a model comparison should use identical query text, language, expected
paths, and evidence quotes across the model-produced workspace copies. The JSON
report adds `matchedScenarios` only for cases with that exact shared signature;
each model's scores then sit side by side. An optional `scenarioId` gives a
human-readable label, but does not make different queries or expectations count
as the same scenario.

Keep evaluation fixtures outside production prompts and configuration. Each
fixture should contain cases sampled from multiple workspaces; expected paths
and quotes belong to that workspace's evaluation data and are not general
product vocabulary.

```json
{
  "schemaVersion": 1,
  "limit": 10,
  "cases": [
    {
      "id": "distinctive-detail-1",
      "workspace": "/path/to/workspace-copy",
      "language": "fr",
      "producerModel": "<model label used to prepare this workspace copy>",
      "scenarioId": "<optional label shared by copies of the same evaluation case>",
      "query": "A question phrased as a user would ask it",
      "expected": [
        {
          "path": "raw/ingested/original-document.md",
          "quote": "A short exact passage from the archived source"
        }
      ]
    }
  ]
}
```

`hitRate` measures whether any expected page appears in the top results. `MRR`
rewards higher rank. `quoteHitRate` checks the returned chunk or page text for
the expected passage, guarding against a path-only hit that did not retrieve
the useful evidence. Review each case's ranked excerpts before treating a
score as acceptance: these metrics do not judge whether a generated answer is
faithful. The command exits non-zero if a case misses its expected page or
quote; use `--allow-misses` only when collecting a diagnostic report.
To evaluate multilingual retrieval, add separate cases with the same expected
archive path and quote, varying only the query and `language` value. The JSON
report includes both per-workspace and per-language metrics.
When supplied, `producerModel` adds a per-model comparison over the same
questions and expected passages. `matchedScenarios` verifies this pairing at
the case level; cases that do not have an identical counterpart for another
producer model are still included in the workspace and per-model summaries.
