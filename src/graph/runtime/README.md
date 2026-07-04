Intentionally still empty after 0.10.2.

The Run/Task graph landed in `src/chat/runtime/runtimeGraphScript.ts` instead
of here: it renders from live browser-side `runtimeState.workflow` data as
part of the chat runtime UI's script pipeline, not from a Node-side
`buildXGraph()` projection over files the way `graph/wiki/projection.ts`
works — there was no build-time projection to place in this directory.

It still shares the actual D3 socle: `../core/graphForce.ts`
(`computeRadialForceLayout`/`renderForceLinks`/`createForceNode`) holds the
radial force-simulation layout and node/link SVG creation mechanics used by
both this graph and the wiki graph's radial mode. Do not reimplement
`d3.forceSimulation`/SVG node creation in `src/chat/runtime/` again — extend
`graphForce.ts`.
