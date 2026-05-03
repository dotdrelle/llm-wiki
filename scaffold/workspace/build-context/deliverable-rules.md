# Deliverable Generation Rules

These shared rules apply to the example deliverable templates in `templates/`:
`project-brief.md`, `functional-analysis.md`, and `architecture-overview.md`.

## Evidence

- Use only facts present in the provided wiki context.
- Cite factual claims with `[src: path/to/wiki/page.md]`.
- Do not invent actors, requirements, decisions, dates, metrics, components, or risks.
- If the wiki does not contain enough evidence, state the gap explicitly instead of guessing.

## Gaps And Unknowns

- Keep unknowns factual and actionable.
- Distinguish missing evidence from a documented negative statement.
- Do not turn an open question into a recommendation.

## Analysis And Recommendations

- For functional analysis, separate documented requirements, workflows, constraints, and unresolved points.
- For architecture overview, separate documented architecture, constraints, trade-offs, and recommendations.
- When a proposal or recommendation is not documented, write that no proposal or recommendation is recorded yet.
- Compare options only when the wiki documents more than one option or trade-off.
