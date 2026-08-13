/** Browser-side invalidation scheduler shared by Canvas graph renderers. */
export function graphFrameScript(): string {
  return String.raw`
function createGraphFrameScheduler(draw){
  let frame=0,timer=0,dirty=true,animateUntil=0,destroyed=false,failures=0,drawing=false;
  /*
   Deux régimes d'animation, parce que toutes les animations ne valent pas le
   même prix.

   Une transition de caméra ou un halo « nouveau » sont brefs et regardés : ils
   méritent la pleine cadence. Le scintillement de fond des constellations, lui,
   est permanent — il n'a pas de fin — et le faire passer par animate() gardait
   le processus de rendu à soixante images par seconde tant que le graphe
   restait ouvert, y compris sur une session laissée de côté pendant des heures.
   Chacune de ces images redessine toute la scène.

   idle() exprime donc « il se passe quelque chose, mais rien d'urgent » : le
   dessin continue à cadence réduite, et surtout le planificateur DORT entre
   deux images au lieu de se réveiller à chaque rafraîchissement de l'écran pour
   ne rien faire.
  */
  let idleUntil=0,idleIntervalMs=80,lastIdle=0,clock=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  /*
   Les échéances se posent sur l'horloge du dessin, pas sur une autre.

   animate() et idle() sont appelés depuis draw(), qui reçoit l'estampille de
   requestAnimationFrame ; run() compare ensuite cette même estampille aux
   échéances. Prendre performance.now() pour les poser marchait par chance —
   les deux sont la même ligne de temps dans un navigateur — mais faisait
   dépendre la boucle d'une coïncidence, invisible jusqu'à ce qu'un harnais
   fournisse ses propres estampilles.
  */
  function stamp(){return drawing?clock:performance.now()}
  function request(){if(!frame&&!destroyed&&!document.hidden)frame=requestAnimationFrame(run)}
  function requestLater(delay){
    if(frame||timer||destroyed||document.hidden)return;
    timer=setTimeout(()=>{timer=0;request()},Math.max(0,delay))}
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
    clock=now;
    const animating=!reduced.matches&&now<animateUntil;
    const idling=!reduced.matches&&!animating&&now<idleUntil;
    const idleDue=idling&&now-lastIdle>=idleIntervalMs;
    let failed=true;
    try{
      drawing=true;
      // La cadence réduite se mesure depuis la dernière image RÉELLE, quelle
      // qu'en soit la raison : sinon une interaction et le scintillement
      // dessineraient deux fois de suite.
      if(dirty||animating||idleDue){dirty=false;lastIdle=now;draw(now,{animating,reducedMotion:reduced.matches})}
      failed=false
    }finally{
      drawing=false;
      failures=failed?failures+1:0;
      // L'image n'a pas eu lieu : dirty avait pourtant déjà été consommé. Sans
      // cette remise, même une relance ne redessinerait rien.
      if(failed)dirty=true;
      if(failures>=5)destroyed=true;
      /*
       Les échéances sont relues APRÈS le dessin, pas avant.

       C'est draw() qui les pose : animate() et idle() sont appelés depuis lui.
       Les valeurs calculées en tête de run() décrivent donc l'image qu'on vient
       de faire, jamais celle qu'il faut programmer. animate() masquait le
       défaut en passant par invalidate(), qui redemande une image de toute
       façon ; le régime réduit, lui, n'a que cette relecture.
      */
      else if(dirty||(!reduced.matches&&now<animateUntil))request();
      // Rien d'urgent : on programme la prochaine image réduite par un timer,
      // sans réveiller le compositeur entre-temps.
      else if(!reduced.matches&&now<idleUntil)requestLater(idleIntervalMs-(now-lastIdle))
    }
  }
  function invalidate(){dirty=true;request()}
  function animate(duration=260){if(!reduced.matches)animateUntil=Math.max(animateUntil,stamp()+duration);invalidate()}
  function idle(duration=260,intervalMs){
    if(reduced.matches)return;
    idleUntil=Math.max(idleUntil,stamp()+duration);
    if(intervalMs>0)idleIntervalMs=intervalMs;
    // Pendant un dessin, c'est le finally de run() qui programme la suite : le
    // faire ici poserait un timer sans délai et annulerait la cadence réduite.
    if(!drawing)requestLater(idleIntervalMs-(stamp()-lastIdle))}
  function visibility(){if(!document.hidden)invalidate()}
  document.addEventListener('visibilitychange',visibility);
  reduced.addEventListener?.('change',invalidate);
  request();
  return{invalidate,animate,idle,get reducedMotion(){return reduced.matches},destroy(){destroyed=true;if(frame)cancelAnimationFrame(frame);if(timer)clearTimeout(timer);timer=0;document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener?.('change',invalidate)}}
}`;
}
