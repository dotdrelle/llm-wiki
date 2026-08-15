/** Browser-side invalidation scheduler shared by Canvas graph renderers. */
export function graphFrameScript(): string {
  return String.raw`
function createGraphFrameScheduler(draw){
  let frame=0,timer=0,dirty=true,animateUntil=0,destroyed=false,failures=0,drawing=false;
  /*
   Two animation regimes, because not all animations cost the same.

   A camera transition or a "new" halo are brief and watched: they deserve the
   full cadence. The background twinkle of the constellations, on the other
   hand, is permanent — it has no end — and routing it through animate() kept
   the render process at sixty frames per second as long as the graph stayed
   open, including on a session left aside for hours. Each of those frames
   redraws the whole scene.

   idle() therefore says "something is happening, but nothing urgent": the
   drawing continues at reduced cadence, and above all the scheduler SLEEPS
   between two frames instead of waking up on every screen refresh to do
   nothing.
  */
  let idleUntil=0,idleIntervalMs=80,lastIdle=0,clock=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  /*
   The deadlines are set on the drawing clock, not on another one.

   animate() and idle() are called from draw(), which receives the
   requestAnimationFrame timestamp; run() then compares that same timestamp to
   the deadlines. Taking performance.now() to set them worked by chance — the
   two are the same timeline in a browser — but made the loop depend on a
   coincidence, invisible until a harness provides its own timestamps.
  */
  function stamp(){return drawing?clock:performance.now()}
  function request(){if(!frame&&!destroyed&&!document.hidden)frame=requestAnimationFrame(run)}
  function requestLater(delay){
    if(frame||timer||destroyed||document.hidden)return;
    timer=setTimeout(()=>{timer=0;request()},Math.max(0,delay))}
  /*
   A frame that fails must not take the loop down with it.

   The rescheduling was placed after the draw call: the slightest exception — a
   half-renamed variable, for example — stopped rendering for good. The visible
   symptom then had nothing to do with the cause: the scene displayed half-way,
   the animation only restarted on mouse-over (each invalidation re-requesting a
   frame), and the click no longer responded since the targets are only laid
   down at the complete frame. Three apparent regressions for a single line.

   The rescheduling therefore moves into a finally, and the error keeps
   propagating. After a few consecutive failures we stop for good: a frozen
   view is better than an exception sixty times per second in the console.
  */
  function run(now){
    frame=0;if(destroyed||document.hidden)return;
    clock=now;
    const animating=!reduced.matches&&now<animateUntil;
    const idling=!reduced.matches&&!animating&&now<idleUntil;
    const idleDue=idling&&now-lastIdle>=idleIntervalMs;
    let failed=true;
    try{
      drawing=true;
      // The reduced cadence is measured from the last REAL frame, whatever its
      // reason: otherwise an interaction and the twinkle would draw twice in a
      // row.
      if(dirty||animating||idleDue){dirty=false;lastIdle=now;draw(now,{animating,reducedMotion:reduced.matches})}
      failed=false
    }finally{
      drawing=false;
      failures=failed?failures+1:0;
      // The frame did not happen: dirty had nevertheless already been consumed.
      // Without this reset, even a reschedule would redraw nothing.
      if(failed)dirty=true;
      if(failures>=5)destroyed=true;
      /*
       The deadlines are re-read AFTER the drawing, not before.

       It is draw() that sets them: animate() and idle() are called from it.
       The values computed at the top of run() therefore describe the frame we
       just made, never the one to schedule. animate() masked the defect by
       going through invalidate(), which re-requests a frame anyway; the
       reduced regime, on the other hand, only has this re-read.
      */
      else if(dirty||(!reduced.matches&&now<animateUntil))request();
      // Nothing urgent: we schedule the next reduced frame via a timer, without
      // waking the compositor in between.
      else if(!reduced.matches&&now<idleUntil)requestLater(idleIntervalMs-(now-lastIdle))
    }
  }
  function invalidate(){dirty=true;request()}
  function animate(duration=260){if(!reduced.matches)animateUntil=Math.max(animateUntil,stamp()+duration);invalidate()}
  function idle(duration=260,intervalMs){
    if(reduced.matches)return;
    idleUntil=Math.max(idleUntil,stamp()+duration);
    if(intervalMs>0)idleIntervalMs=intervalMs;
    // During a drawing, it is run()'s finally that schedules the next step:
    // doing it here would set a timer without delay and cancel the reduced
    // cadence.
    if(!drawing)requestLater(idleIntervalMs-(stamp()-lastIdle))}
  function visibility(){if(!document.hidden)invalidate()}
  document.addEventListener('visibilitychange',visibility);
  reduced.addEventListener?.('change',invalidate);
  request();
  return{invalidate,animate,idle,get reducedMotion(){return reduced.matches},destroy(){destroyed=true;if(frame)cancelAnimationFrame(frame);if(timer)clearTimeout(timer);timer=0;document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener?.('change',invalidate)}}
}`;
}
