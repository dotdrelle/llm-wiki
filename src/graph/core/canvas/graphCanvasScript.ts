import { graphCameraScript } from './graphCameraScript.ts';
import { graphFrameScript } from './graphFrameScript.ts';
import { graphCanvasGlowScript } from './graphCanvasGlowScript.ts';

/** Projection-agnostic browser primitives. No wiki or runtime vocabulary here. */
export function graphCanvasScript(): string {
  return `${graphFrameScript()}\n${graphCameraScript()}\n${graphCanvasGlowScript()}`;
}
