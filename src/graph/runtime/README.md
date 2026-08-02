# Runtime graph

The live Run/Task projection is assembled in
`src/chat/runtime/runtimeGraphScript.ts` from `runtimeState.workflow`.

Rendering is Canvas 2.5D through `runtimeCanvasScript.ts`. It shares the
projection-agnostic camera and invalidation scheduler in `graph/core/canvas/`
with the wiki explorer. Activity and Execution reuse the same renderer and
inspector; only their surrounding layout changes.

Runtime SSE updates replace scene data without resetting the camera or saved
node positions. A topology change triggers a fit, while status/progress-only
updates repaint in place. Running nodes animate on demand; idle and hidden
graphs do not keep a permanent animation loop.

Keep runtime vocabulary and hierarchy here. The shared Canvas core must not
contain run, task, agent, wiki, document, or community concepts.
