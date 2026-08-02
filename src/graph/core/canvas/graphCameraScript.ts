/** Browser-side camera with interruptible, reduced-motion-aware transitions. */
export function graphCameraScript(): string {
  return String.raw`
function createGraphCamera(scheduler,initial={x:0,y:0,scale:1}){
  const state={...initial},start={...initial},target={...initial};
  let startedAt=0,duration=0;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function jump(next){Object.assign(state,next);Object.assign(start,state);Object.assign(target,state);duration=0;scheduler.invalidate();return state}
  function moveTo(next,ms=280){
    Object.assign(start,state);Object.assign(target,next);startedAt=performance.now();duration=scheduler.reducedMotion?0:Math.max(0,ms);
    if(!duration)return jump(target);scheduler.animate(duration+34);return state
  }
  function tick(now){
    if(!duration)return false;
    const raw=clamp((now-startedAt)/duration,0,1),t=1-Math.pow(1-raw,3);
    state.x=start.x+(target.x-start.x)*t;state.y=start.y+(target.y-start.y)*t;state.scale=start.scale+(target.scale-start.scale)*t;
    if(raw>=1)duration=0;return duration>0
  }
  function pan(dx,dy){return jump({x:state.x+dx,y:state.y+dy,scale:state.scale})}
  function zoomAt(factor,worldX,worldY){
    const nextScale=clamp(state.scale*factor,.35,9),ratio=state.scale/nextScale;
    return jump({x:worldX-(worldX-state.x)*ratio,y:worldY-(worldY-state.y)*ratio,scale:nextScale})
  }
  return{state,target,jump,moveTo,tick,pan,zoomAt,get moving(){return duration>0}}
}`;
}
