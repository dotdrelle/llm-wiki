// Structural node/edge shape only — no projection-specific fields (no "wiki
// page", "citation", etc.). Any projection's node/edge type is usable here as
// long as it has these fields; `type`/relation `type` stay plain strings so a
// future projection (e.g. the 0.10.2 Run/Task graph) isn't forced into the
// wiki vocabulary. Column ordering and relation labels for a given `type`
// vocabulary are supplied by the caller via GraphRenderDeps, not hardcoded
// here.
export interface GraphNode {
  id: string;
  title: string;
  type: string;
  href: string;
  preview: string;
  raw: string;
  html: string;
  group?: string;
  degree: number;
  x: number;
  y: number;
  r: number;
  ring: number;
  secondary: string;
  inbound: number;
  outbound: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

export type GraphRenderDeps = {
  escapeAttr: (value: string) => string;
  escapeScriptJson: (value: string) => string;
  /** DAG mode column order, left to right, by node `type`. */
  dagColumnOrder: string[];
  /** Human-readable label per edge `type`, shown in the relation panel. */
  relationLabels: Record<string, string>;
};
