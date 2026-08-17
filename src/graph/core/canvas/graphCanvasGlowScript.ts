/** Projection-agnostic glow and rounded-rect primitives shared by both Canvas graphs. */
export function graphCanvasGlowScript(): string {
  return String.raw`
// 'roundRect' is recent (Safari 16+): a browser without it throws mid-frame and
// the scheduler freezes the graph after a few failures — the "black empty
// canvas" symptom. Fall back to a plain rect so cards still render everywhere.
function graphRoundedRect(context,x,y,w,h,r){if(typeof context.roundRect==='function'){context.roundRect(x,y,w,h,r)}else{context.rect(x,y,w,h)}}
/*
 Pre-rendered halos, shared by the wiki and the run/task graphs.

 shadowBlur is a full-frame gaussian blur per fill call. Applied to every node
 on every frame, the cost is permanent, not occasional. A halo depends only on a
 color, so it is rendered once in an offscreen canvas and copied back at the
 desired scale.

 steps is the quantization grain for the animated alpha, and it is a
 PER-CALLER decision: a small star can step coarsely, a large card pulse must
 not. The wiki keeps the coarse default (20, ~12 levels over its 0→.55 twinkle);
 the run/task graph passes a finer grain (100) because its pulse sweeps only
 0.24→0.44 and five levels would read as five visible jerks on a card.
*/
function createGraphGlow(context,steps){
  const q=steps||20;
  const rgba=(hex,alpha)=>{const value=parseInt(hex.slice(1),16);return'rgba('+((value>>16)&255)+','+((value>>8)&255)+','+(value&255)+','+alpha+')'};
  const sprites=new Map();
  function glowSprite(hex,inner,mid){
    // Quantize the intensity: an animated halo (a running node's pulse, a
    // twinkling star) would otherwise mint a new key every frame, each
    // allocating a fresh offscreen canvas the cache never reused — unbounded
    // growth that eventually killed the tab. A glow's alpha needs no
    // sub-percent precision.
    const key=hex+'|'+Math.round(inner*q)+'|'+Math.round(mid*q),cached=sprites.get(key);if(cached)return cached;
    const size=64,off=document.createElement('canvas');off.width=size;off.height=size;
    const paint=off.getContext('2d'),gradient=paint.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,rgba(hex,inner));gradient.addColorStop(.45,rgba(hex,mid));gradient.addColorStop(1,rgba(hex,0));
    paint.fillStyle=gradient;paint.fillRect(0,0,size,size);sprites.set(key,off);return off}
  function glow(hex,inner,mid,x,y,radius){if(radius<=0)return;context.drawImage(glowSprite(hex,inner,mid),x-radius,y-radius,radius*2,radius*2)}
  return{glow,rgba}}
`;
}
