/** Browser-side invalidation scheduler shared by Canvas graph renderers. */
export function graphFrameScript(): string {
  return String.raw`
function createGraphFrameScheduler(draw){
  let frame=0,dirty=true,animateUntil=0,destroyed=false,failures=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function request(){if(!frame&&!destroyed&&!document.hidden)frame=requestAnimationFrame(run)}
  /*
   Une image qui échoue ne doit pas emporter la boucle.

   La relance était placée après l'appel à draw : la moindre exception — une
   variable renommée à moitié, par exemple — arrêtait le rendu pour de bon.
   Le symptôme visible n'avait alors plus rien à voir avec la cause : la scène
   s'affichait à moitié, l'animation ne repartait qu'au passage de la souris
   (chaque invalidation redemandant une image), et le clic ne répondait plus
   puisque les cibles ne sont posées qu'à l'image complète. Trois régressions
   apparentes pour une seule ligne.

   La relance passe donc dans un finally, et l'erreur continue de remonter.
   Après quelques échecs consécutifs on s'arrête pour de bon : mieux vaut une
   vue figée qu'une exception soixante fois par seconde dans la console.
  */
  function run(now){
    frame=0;if(destroyed||document.hidden)return;
    const animating=!reduced.matches&&now<animateUntil;
    let failed=true;
    try{
      if(dirty||animating){dirty=false;draw(now,{animating,reducedMotion:reduced.matches})}
      failed=false
    }finally{
      failures=failed?failures+1:0;
      // L'image n'a pas eu lieu : dirty avait pourtant déjà été consommé. Sans
      // cette remise, même une relance ne redessinerait rien.
      if(failed)dirty=true;
      if(failures>=5)destroyed=true;
      else if(dirty||animating)request()
    }
  }
  function invalidate(){dirty=true;request()}
  function animate(duration=260){if(!reduced.matches)animateUntil=Math.max(animateUntil,performance.now()+duration);invalidate()}
  function visibility(){if(!document.hidden)invalidate()}
  document.addEventListener('visibilitychange',visibility);
  reduced.addEventListener?.('change',invalidate);
  request();
  return{invalidate,animate,get reducedMotion(){return reduced.matches},destroy(){destroyed=true;if(frame)cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener?.('change',invalidate)}}
}`;
}
