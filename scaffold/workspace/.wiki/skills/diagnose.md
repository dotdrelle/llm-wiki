---
name: diagnose
description: Run wiki doctor and report configuration issues with recommendations
params: []
---
Run a full diagnostic of this wiki workspace:

1. Call wiki_doctor (if available via the llm-wiki MCP server). List every warning and error it returns.
2. For each issue found, explain what it means in plain language and propose a concrete fix.
3. If no MCP tools are available, ask the user to run `wiki doctor` in the terminal and share the output.
4. Pay particular attention to: context window size vs. batch size consistency, missing or misconfigured vector index, provider connectivity, and fill ratio warnings above 90%.

End with a prioritized list: critical issues first, then warnings, then suggestions.
