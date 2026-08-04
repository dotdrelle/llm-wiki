export function canvasExplorerScript(): string {
  return String.raw`
let canvasExplorer=null;
/*
 Emplacement stable d'un domaine sur la carte.

 La position venait du rang dans la liste filtrée : ajouter un domaine — ce
 que fait chaque ingest — redistribuait TOUS les autres sur le cercle. Suivre
 l'arrivée des bulles était impossible, puisque la carte entière changeait à
 chaque passe.

 Chaque domaine reçoit donc un emplacement à sa première apparition et le
 garde. La spirale d'angle d'or place les nouveaux venus vers l'extérieur sans
 jamais aligner deux points ni déplacer les précédents ; on abandonne au
 passage le cercle autour d'un centre, qui n'apportait rien de plus.
*/
const canvasExplorerSlots=new Map();
function canvasExplorerSlot(id){
  if(!canvasExplorerSlots.has(id))canvasExplorerSlots.set(id,canvasExplorerSlots.size);
  return canvasExplorerSlots.get(id)}
function seedCanvasExplorerSlots(){(data?.communities||[]).forEach(item=>canvasExplorerSlot(item.id))}
function canvasExplorerSlotPosition(id){
  const slot=canvasExplorerSlot(id),angle=slot*2.399963-Math.PI/2,radius=slot?.135+Math.sqrt(slot)*.112:0;
  return{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius*.72}}
// La position mémorisée d'une fiche ne dépend plus de la topologie : elle
// changeait à chaque ingest, donc tout placement manuel était perdu au moment
// précis où le graphe évoluait — c'est-à-dire quand il servait le plus.
function canvasExplorerPositionKey(id){return'llm-wiki:graph:canvas:'+encodeURIComponent(data?.workspace||'wiki')+':'+encodeURIComponent(id)}
function readCanvasExplorerPosition(id){try{const value=JSON.parse(localStorage.getItem(canvasExplorerPositionKey(id))||'null');return Number.isFinite(value?.x)&&Number.isFinite(value?.y)?value:null}catch{return null}}
function saveCanvasExplorerPosition(node){try{localStorage.setItem(canvasExplorerPositionKey(node.id),JSON.stringify({x:node.x,y:node.y}))}catch{}}
// La vue liste n'a pas de bulle à laquelle s'ancrer : la fiche partirait avec
// l'explorateur et resterait posée au milieu d'un tableau.
function destroyCanvasExplorer(){closeGraphContextCard();canvasExplorer?.destroy();canvasExplorer=null}
function separateCanvasExplorerNodes(nodes){const detailed=nodes.slice(0,50);for(let pass=0;pass<90;pass++){let moved=false;for(let i=0;i<detailed.length;i++)for(let j=i+1;j<detailed.length;j++){const a=detailed[i],b=detailed[j],dx=b.x-a.x,dy=b.y-a.y,minX=.142,minY=.078;if(Math.abs(dx)>=minX||Math.abs(dy)>=minY)continue;moved=true;if(minX-Math.abs(dx)<minY-Math.abs(dy)){const push=(dx<0?-1:1)*(minX-Math.abs(dx))*.51;a.x-=push;b.x+=push}else{const push=(dy<0?-1:1)*(minY-Math.abs(dy))*.51;a.y-=push;b.y+=push}}if(!moved)break}return nodes}
function createCanvasExplorer(host){
  // Plus de mini-carte : sur une vue qui tient déjà entière dans le cadre, elle
  // n'aidait à rien et occupait un coin. Le cadrage et le fil d'Ariane
  // remplissent son rôle d'orientation.
  host.innerHTML='<canvas class="graph-explorer-canvas" tabindex="0" role="application" aria-label="Interactive knowledge graph. Use arrow keys to pan, plus or minus to zoom."></canvas><div class="graph-explorer-a11y" role="tree" aria-label="Visible graph nodes"></div>';
  const surface=host.querySelector('.graph-explorer-canvas'),a11y=host.querySelector('.graph-explorer-a11y');
  const context=surface.getContext('2d');
  const state={scene:null,signature:'',nodeIds:null,width:0,height:0,ratio:1,hits:[],labels:[],anchor:null,pointer:null,dragged:false,hover:null,viewports:new Map,clock:0};
  let scheduler,camera;
  const nodeById=new Map(data.nodes.map(node=>[node.id,node]));
  const color=index=>colors[index%colors.length];
  const light=()=>document.body.classList.contains('theme-light');
  const rgba=(hex,alpha)=>{const value=parseInt(hex.slice(1),16);return 'rgba('+((value>>16)&255)+','+((value>>8)&255)+','+(value&255)+','+alpha+')'};
  /*
   Halos pré-rendus.

   Le scintillement d'un amas posait shadowBlur sur CHAQUE étoile : jusqu'à
   48 membres × 6 domaines, soit près de 300 flous gaussiens plein cadre par
   image. C'est l'opération la plus coûteuse de l'API Canvas, et elle était
   dans la boucle la plus chaude — d'où les à-coups.

   Un halo est une image qui ne dépend que d'une couleur : on la rend une fois
   dans un canevas hors écran et on la recopie à l'échelle voulue. drawImage
   est accéléré, createRadialGradient et shadowBlur ne le sont pas.
  */
  const sprites=new Map();
  function glowSprite(hex,inner,mid){
    const key=hex+'|'+inner+'|'+mid,cached=sprites.get(key);if(cached)return cached;
    const size=64,off=document.createElement('canvas');off.width=size;off.height=size;
    const paint=off.getContext('2d'),gradient=paint.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,rgba(hex,inner));gradient.addColorStop(.45,rgba(hex,mid));gradient.addColorStop(1,rgba(hex,0));
    paint.fillStyle=gradient;paint.fillRect(0,0,size,size);sprites.set(key,off);return off}
  function paintGlow(hex,inner,mid,x,y,radius){
    if(radius<=0)return;context.drawImage(glowSprite(hex,inner,mid),x-radius,y-radius,radius*2,radius*2)}
  // findIndex par document et par image : linéaire dans le nombre de domaines,
  // exécuté des milliers de fois par seconde pour un résultat immuable.
  const communityRank=new Map(data.communities.map((item,index)=>[item.id,index]));
  const communityIndex=id=>communityRank.get(id)??0;
  function resize(){const rect=surface.getBoundingClientRect(),ratio=Math.min(2,devicePixelRatio||1);state.width=rect.width;state.height=rect.height;state.ratio=ratio;surface.width=Math.max(1,Math.round(rect.width*ratio));surface.height=Math.max(1,Math.round(rect.height*ratio));context.setTransform(ratio,0,0,ratio,0,0);measureFrame();scheduler.invalidate()}
  /*
   Le cadre utile n'est pas le canevas.

   Le fil d'Ariane, la barre d'outils et l'inspecteur sont posés PAR-DESSUS le
   canevas, qui occupe toute la scène. Le cadrage se calculait pourtant sur le
   canevas entier et centrait sur son milieu : un tiers du graphe se rangeait
   sous l'inspecteur, et l'espace laissé libre à gauche restait vide. Le bouton
   « Fit » recadrait consciencieusement sur une zone en partie masquée.

   On mesure donc les panneaux qui mordent sur un bord et on travaille dans ce
   qui reste. Un panneau flottant au milieu, lui, est ignoré : le retrancher
   des deux côtés ne laisserait rien.
  */
  function measureFrame(){
    const rect=surface.getBoundingClientRect();
    let left=10,right=state.width-10,top=10,bottom=state.height-10;
    (host.parentElement||host).querySelectorAll('.inspector,.stage-title,.stage-tools').forEach(panel=>{
      const box=panel.getBoundingClientRect();
      if(!box.width||!box.height||panel.hidden)return;
      const x0=box.left-rect.left,x1=box.right-rect.left,y0=box.top-rect.top,y1=box.bottom-rect.top;
      if(x1<=0||y1<=0||x0>=state.width||y0>=state.height)return;
      if(box.height>box.width){if(x0>state.width*.5)right=Math.min(right,x0-14);else left=Math.max(left,x1+14)}
      else if(y0>state.height*.5)bottom=Math.min(bottom,y0-14);
      else top=Math.max(top,y1+14)});
    const width=right-left,height=bottom-top;
    // Garde-fou : sur une fenêtre étroite, les panneaux peuvent couvrir presque
    // tout. Mieux vaut alors cadrer large et laisser un recouvrement partiel
    // que réduire le graphe à un timbre-poste.
    state.frame=width<state.width*.45||height<state.height*.45
      ?{x:state.width/2,y:state.height/2,width:Math.max(240,state.width-24),height:Math.max(200,state.height-52)}
      :{x:(left+right)/2,y:(top+bottom)/2,width,height}}
  const frame=()=>state.frame||{x:state.width/2,y:state.height/2,width:Math.max(240,state.width-24),height:Math.max(200,state.height-52)};
  function project(point){const scale=Math.min(state.width,state.height)*camera.state.scale,box=frame();return{x:box.x+(point.x-camera.state.x)*scale,y:box.y+(point.y-camera.state.y)*scale,scale:camera.state.scale*(point.depth||1)}}
  function communityRadius(node){return 28+Math.min(34,Math.sqrt(node.community.nodeIds.length)*7)}
  // Débord d'un nœud, en pixels et par côté, à une échelle donnée. Un halo de
  // constellation grandit avec le zoom, une fiche non : les deux ne se
  // calculent pas pareil. Depuis que le libellé peut se poser de n'importe quel
  // côté, la réserve n'est plus dissymétrique vers le bas — elle l'était quand
  // le texte s'écrivait forcément sous le nœud.
  function overflow(node,scale){
    if(node.type==='community'){const r=communityRadius(node)*scale+8;return{left:r+22,right:r+22,top:r+18,bottom:r+30}}
    const half=cardWidth(node)/2+8;return{left:half,right:half,top:24,bottom:26}}
  /*
   Cadrage par point fixe.

   L'échelle dépend de l'emprise, qui dépend de l'échelle : c'est une équation
   implicite, pas une division. On la résolvait en supposant que le nœud le
   plus large occupait les deux extrémités à la fois, et le nœud le plus haut
   les deux autres — une majoration qui n'arrive jamais et qui coûtait
   systématiquement du zoom. D'où les deux clics sur « + » après chaque
   navigation.

   On itère donc jusqu'au point fixe : à chaque passe on mesure l'emprise
   réelle à l'échelle courante et on la rapporte au cadre. Trois passes
   suffisent en pratique, la suite est contractante.

   Le centre est celui de l'ENVELOPPE, pas celui des positions : un libellé
   sous un amas décale l'ensemble vers le bas, et le graphe se retrouvait haut
   dans le cadre même après un « Fit ».
  */
  function bounds(nodes){
    if(!nodes.length)return{x:0,y:0,scale:1};
    const size=Math.min(state.width,state.height)||1,box=frame(),inner=box.width,tall=box.height;
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    nodes.forEach(node=>{x0=Math.min(x0,node.x);x1=Math.max(x1,node.x);y0=Math.min(y0,node.y);y1=Math.max(y1,node.y)});
    const cx=(x0+x1)/2,cy=(y0+y1)/2;
    const envelope=scale=>{
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      nodes.forEach(node=>{
        const px=(node.x-cx)*size*scale,py=(node.y-cy)*size*scale,pad=overflow(node,scale);
        left=Math.min(left,px-pad.left);right=Math.max(right,px+pad.right);
        top=Math.min(top,py-pad.top);bottom=Math.max(bottom,py+pad.bottom)});
      return{left,right,top,bottom}};
    let scale=1;
    for(let pass=0;pass<8;pass++){
      const shape=envelope(scale);
      const next=Math.max(.35,Math.min(9,scale*Math.min(inner/Math.max(1,shape.right-shape.left),tall/Math.max(1,shape.bottom-shape.top))));
      const settled=Math.abs(next-scale)<=scale*.002;
      scale=next;
      if(settled)break}
    const shape=envelope(scale);
    return{x:cx+(shape.left+shape.right)/2/(size*scale),y:cy+(shape.top+shape.bottom)/2/(size*scale),scale:scale*.99}
  }
  // Poussière d'étoiles déterministe : hachage plutôt que Math.random, donc la
  // même image à chaque rendu et aucune allocation par frame. Le même principe
  // que stableUnit côté projection, transposé au navigateur.
  const noise=(i,salt)=>{let h=(2166136261^salt)>>>0;const t=String(i);for(let k=0;k<t.length;k++){h=(h^t.charCodeAt(k))>>>0;h=Math.imul(h,16777619)>>>0}return h/4294967295};
  const dust=Array.from({length:150},(_,i)=>({x:noise(i,7),y:noise(i,31),z:noise(i,53),a:.10+noise(i,97)*.35}));
  // Le fond ne dépend que du format et du thème : le dégradé est reconstruit
  // quand l'un des deux change, pas soixante fois par seconde.
  let backdrop=null,backdropKey='';
  function drawBackground(){
    const pale=light(),key=state.width+'x'+state.height+(pale?'l':'d');
    if(key!==backdropKey){
      backdrop=context.createRadialGradient(state.width*.5,state.height*.42,0,state.width*.5,state.height*.45,Math.max(state.width,state.height)*.75);
      backdrop.addColorStop(0,pale?'#ffffff':'#101827');
      backdrop.addColorStop(.55,pale?'#f4f7fb':'#0a0e18');
      backdrop.addColorStop(1,pale?'#e7edf4':'#06080d');
      backdropKey=key}
    context.fillStyle=backdrop;context.fillRect(0,0,state.width,state.height);
    // Sur fond clair une poussière lumineuse serait du bruit : on s'en passe.
    if(pale||state.scene?.level!=='map')return;
    dust.forEach(star=>{const x=(star.x*state.width+state.clock*6*star.z)%state.width;
      context.fillStyle='rgba(190,205,235,'+star.a*.5+')';context.fillRect(x,star.y*state.height,1.2,1.2)})}
  function curvedEdge(from,to,edge){const a=project(from),b=project(to),cx=(a.x+b.x)/2-(b.y-a.y)*.11,cy=(a.y+b.y)/2+(b.x-a.x)*.11,active=edge.active||from.status==='running'||to.status==='running';context.beginPath();context.moveTo(a.x,a.y);context.quadraticCurveTo(cx,cy,b.x,b.y);context.strokeStyle=active?'rgba(77,156,255,.9)':(light()?'rgba(92,116,148,.34)':'rgba(126,151,185,.28)');context.lineWidth=Math.min(4,1+Math.sqrt(edge.weight||1)*.45);if(edge.type==='related_to')context.setLineDash([3,6]);context.stroke();context.setLineDash([])}
  /*
   Lien agrégé entre deux domaines.

   Il empruntait le rendu des liens de documents : un gris uniforme qui dit
   « il existe un lien » sans dire entre qui. Un dégradé d'une couleur de
   domaine vers l'autre le dit sans légende, et le compteur — demandé par la
   spécification — donne le poids de la relation. La particule indique le sens
   de lecture sans ajouter de flèche, qui alourdirait la vue d'ensemble.
  */
  function communityEdge(from,to,edge,indexFrom,indexTo){
    const a=project(from),b=project(to),cx=(a.x+b.x)/2-(b.y-a.y)*.13,cy=(a.y+b.y)/2+(b.x-a.x)*.13;
    const count=edge.weight||edge.count||1,pale=light();
    const gradient=context.createLinearGradient(a.x,a.y,b.x,b.y);
    gradient.addColorStop(0,rgba(color(indexFrom),pale?.5:.36));
    gradient.addColorStop(.5,pale?'rgba(120,138,166,.16)':'rgba(150,165,200,.10)');
    gradient.addColorStop(1,rgba(color(indexTo),pale?.5:.36));
    context.strokeStyle=gradient;context.lineWidth=.7+Math.min(2.8,Math.sqrt(count)*.9);
    context.beginPath();context.moveTo(a.x,a.y);context.quadraticCurveTo(cx,cy,b.x,b.y);context.stroke();
    const t=(Math.sin(state.clock*1.6+indexFrom*1.3+indexTo)*.5+.5),u=1-t;
    context.fillStyle=pale?'rgba(70,92,124,.65)':'rgba(220,232,255,.55)';
    context.beginPath();context.arc(u*u*a.x+2*u*t*cx+t*t*b.x,u*u*a.y+2*u*t*cy+t*t*b.y,1.6,0,Math.PI*2);context.fill();
    if(count>1){context.textAlign='center';context.font='10px ui-sans-serif,system-ui';
      context.fillStyle=pale?'rgba(70,92,124,.9)':'rgba(163,178,203,.85)';
      context.fillText(count,(a.x+b.x)/2-(b.y-a.y)*.065,(a.y+b.y)/2+(b.x-a.x)*.065)}}
  /*
   Une constellation, pas un cadran.

   Les membres étaient répartis sur un cercle parfait, à pas régulier et rayon
   constant : l'œil y lit une horloge, pas un amas. L'angle d'or (2.39996 rad)
   combiné à un rayon en racine carrée remplit le disque sans jamais aligner
   deux points, ce qui est exactement ce qui distingue une constellation d'une
   figure géométrique.

   Le scintillement est désynchronisé par nœud : c'est ce qui donne de la
   matière à un amas immobile, à un coût nul puisque le rendu est déjà animé.
  */
  // Les membres d'un domaine ne changent pas d'une image à l'autre ; les
  // recalculer soixante fois par seconde par un map/filter sur tout l'index
  // était du travail pur perte.
  const membersOf=node=>{
    if(!node.members)node.members=node.community.nodeIds.map(id=>nodeById.get(id)).filter(Boolean).slice(0,48);
    return node.members};
  function drawCommunity(node,index){
    const point=project(node),shown=membersOf(node);
    const radius=communityRadius(node)*point.scale,paint=color(index),hot=state.hover===node.id,pale=light();
    const beat=state.clock;
    // Trois arrêts : un cœur dense, une décroissance à mi-course, une extinction
    // complète. Deux arrêts donnaient une chute linéaire, qui se lit comme un
    // disque plat au lieu d'une nébuleuse.
    paintGlow(paint,hot?.34:.22,pale?.10:.07,point.x,point.y,radius*2.1);
    shown.forEach((member,memberIndex)=>{
      const angle=memberIndex*2.399963,spread=radius*(.24+Math.sqrt(memberIndex/Math.max(1,shown.length))*.66);
      const qx=point.x+Math.cos(angle)*spread,qy=point.y+Math.sin(angle)*spread*.66;
      const twinkle=.62+.38*Math.sin(beat*3.1+memberIndex*1.7);
      const core=1.5+Math.min(3,Math.sqrt(member.degree||0))*.9;
      paintGlow(paint,.55*twinkle,.18*twinkle,qx,qy,core*3.4);
      context.fillStyle=pale?rgba(paint,.55+.35*twinkle):'rgba(237,245,255,'+(.55+.45*twinkle)+')';
      context.beginPath();context.arc(qx,qy,core,0,Math.PI*2);context.fill()});
    context.strokeStyle=rgba(paint,hot?.9:.4);context.lineWidth=hot?1.6:.9;context.setLineDash([2,5]);
    context.beginPath();context.arc(point.x,point.y,radius,0,Math.PI*2);context.stroke();context.setLineDash([]);
    // Le libellé n'est plus écrit ici : il part dans la file de placement, qui
    // le posera à l'extérieur de l'amas en évitant ses voisins. L'écrire sur
    // place, sous le nœud, tassait les textes les uns sur les autres dès que
    // la carte se remplissait — c'est-à-dire dès qu'elle devenait utile.
    // Le compte affiché est celui du domaine, pas celui des étoiles dessinées :
    // la constellation est plafonnée à 48 points, le domaine ne l'est pas.
    state.labels.push({x:point.x,y:point.y,radius,weight:1e6+node.community.nodeIds.length,always:true,lines:[
      {text:node.label.toUpperCase(),font:'500 13px ui-sans-serif,system-ui',height:15,color:hot?(pale?'#0d1826':'#f4f7fc'):(pale?'#2a3a4d':'#c9d3e2')},
      {text:node.community.nodeIds.length+' pages',font:'11px ui-sans-serif,system-ui',height:13,color:rgba(paint,pale?.95:.8)}]});
    state.hits.push({node,x:point.x,y:point.y,r:Math.max(28,radius*1.1)})}
  function cardWidth(node){return Math.min(210,82+String(node.label).length*5.8)}
  function drawDocument(node,index){const point=project(node),paint=color(communityIndex(node.communityId)),selectedNode=selected?.id===node.id,detail=point.scale>1.55,w=cardWidth(node),h=38;if(detail){
      // Le flou d'ombre est réservé à la fiche sélectionnée — une seule. Sur les
      // autres, un halo pré-rendu donne le même relief sans repasser un flou
      // gaussien par fiche et par image.
      if(!selectedNode)paintGlow(paint,.20,.07,point.x,point.y,Math.max(w,h)*.78);
      else{context.shadowBlur=24;context.shadowColor=rgba(paint,.8)}
      context.fillStyle='rgba(16,23,34,.96)';context.beginPath();context.roundRect(point.x-w/2,point.y-h/2,w,h,9);context.fill();context.shadowBlur=0;context.strokeStyle=rgba(paint,selectedNode?1:.55);context.lineWidth=selectedNode?2:1;context.stroke();context.fillStyle=paint;context.fillRect(point.x-w/2+3,point.y-h/2+7,3,h-14);context.textAlign='left';context.font='600 11.5px ui-sans-serif,system-ui';context.fillStyle='#edf3fb';let label=node.label;while(context.measureText(label).width>w-28&&label.length>5)label=label.slice(0,-2);context.fillText(label+(label!==node.label?'…':''),point.x-w/2+13,point.y-2);context.font='10px ui-sans-serif,system-ui';context.fillStyle=rgba(paint,.9);context.fillText((node.degree||0)+' relations',point.x-w/2+13,point.y+12);state.hits.push({node,x:point.x,y:point.y,w,h})}else{const core=3+Math.sqrt(node.degree||0);paintGlow(paint,.5,.16,point.x,point.y,core*3.6);context.fillStyle='#f4f8ff';context.beginPath();context.arc(point.x,point.y,core,0,Math.PI*2);context.fill();if(point.scale>1.02)state.labels.push({x:point.x,y:point.y,radius:core+3,weight:(node.degree||0)+(selectedNode||state.hover===node.id?1e5:0),always:selectedNode||state.hover===node.id,lines:[{text:node.label.length>22?node.label.slice(0,21)+'…':node.label,font:'10px ui-sans-serif,system-ui',height:12,color:light()?'rgba(44,60,80,.88)':'rgba(220,229,242,.78)'}]});state.hits.push({node,x:point.x,y:point.y,r:15})}}
  /*
   Placement des libellés, en une passe après les nœuds.

   Un libellé écrit au moment où l'on dessine son nœud ne peut rien savoir de
   ceux qui suivent : c'est ce qui les empilait. On les collecte donc tous,
   puis on les pose du plus important au moins important, en réservant à chacun
   son rectangle. La direction préférée est celle qui éloigne du barycentre du
   nuage — un libellé posé vers l'extérieur ne rencontre rien —, les huit
   directions cardinales servant de recours, puis un éloignement progressif.

   Ce qui ne trouve pas de place n'est pas superposé : il disparaît. Un nœud
   important garde toujours son libellé, un point isolé le retrouve au survol
   ou à la sélection, et la colonne de gauche reste l'index exhaustif. Un texte
   illisible n'informe personne, deux textes superposés informent moins que un.
  */
  function drawLabels(){
    const queue=state.labels;
    if(!queue.length)return;
    let cx=0,cy=0;
    queue.forEach(item=>{cx+=item.x/queue.length;cy+=item.y/queue.length});
    const placed=[];
    const collides=box=>placed.some(other=>Math.abs(box.x-other.x)<(box.w+other.w)/2+5&&Math.abs(box.y-other.y)<(box.h+other.h)/2+4);
    const outside=box=>box.x-box.w/2<-40||box.x+box.w/2>state.width+40||box.y-box.h/2<-20||box.y+box.h/2>state.height+20;
    queue.sort((a,b)=>b.weight-a.weight).forEach(item=>{
      let width=0,height=0;
      item.lines.forEach(line=>{context.font=line.font;width=Math.max(width,context.measureText(line.text).width);height+=line.height});
      const dx=item.x-cx,dy=item.y-cy,length=Math.hypot(dx,dy)||1;
      const headings=[{x:dx/length,y:dy/length},{x:0,y:1},{x:0,y:-1},{x:1,y:0},{x:-1,y:0},{x:.71,y:.71},{x:-.71,y:.71},{x:.71,y:-.71},{x:-.71,y:-.71}];
      let box=null;
      for(const heading of headings){
        for(let step=0;step<3;step++){
          const reach=item.radius+7+step*(height*.75+7);
          const candidate={x:item.x+heading.x*(reach+width/2*Math.abs(heading.x)),y:item.y+heading.y*(reach+height/2*Math.abs(heading.y)),w:width,h:height};
          if(collides(candidate)||outside(candidate))continue;
          box=candidate;break}
        if(box)break}
      if(!box){
        if(!item.always)return;
        box={x:item.x,y:item.y+item.radius+7+height/2,w:width,h:height}}
      placed.push(box);
      let top=box.y-height/2;
      context.textAlign='center';
      item.lines.forEach(line=>{context.font=line.font;context.fillStyle=line.color;context.fillText(line.text,box.x,top+line.height*.78);top+=line.height})})}
  // Position écran d'un nœud, rayon compris. Un appelant extérieur — la fiche
  // de contexte — n'a pas à connaître la caméra ni le cadre pour se poser à
  // côté d'une bulle.
  function locateNode(id){
    const node=state.scene?.nodes.find(item=>item.id===id);
    if(!node)return null;
    const point=project(node);
    const radius=node.type==='community'?communityRadius(node)*point.scale:point.scale>1.55?cardWidth(node)/2:3+Math.sqrt(node.degree||0);
    if(point.x<-radius||point.y<-radius||point.x>state.width+radius||point.y>state.height+radius)return null;
    return{x:point.x,y:point.y,r:radius}}
  function renderA11y(){a11y.innerHTML=state.scene.nodes.map(node=>'<button type="button" role="treeitem" data-canvas-node="'+esc(node.id)+'">'+esc(node.label)+'</button>').join('')}
  function draw(now){
    // Le planificateur demande une image dès sa construction, avant que la
    // caméra soit affectée et avant le premier setScene. Aujourd'hui rien ne
    // casse parce que requestAnimationFrame est asynchrone et que setScene
    // suit immédiatement — c'est une chance de calendrier, pas une garantie.
    if(!camera||!state.scene)return;
    camera.tick(now);state.clock=now/1000;state.hits=[];state.labels=[];
    context.clearRect(0,0,state.width,state.height);drawBackground();
    const byId=new Map(state.scene.nodes.map(node=>[node.id,node]));
    // L'index de couleur d'un domaine doit venir de sa place dans la liste, pas
    // de son rang de dessin : ce dernier change avec le tri par profondeur, et
    // la couleur sauterait d'une image à l'autre.
    const rank=new Map(state.scene.nodes.filter(node=>node.type==='community').map((node,i)=>[node.id,i]));
    state.scene.edges.forEach(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to);if(!from||!to)return;
      if(from.type==='community'&&to.type==='community')communityEdge(from,to,edge,rank.get(from.id)||0,rank.get(to.id)||0);
      else curvedEdge(from,to,edge)});
    // Relations vers les domaines restés repliés. Elles ne figurent pas dans
    // scene.edges : leur extrémité n'est pas un document mais une
    // constellation, et elles agrègent plusieurs relations en une.
    state.scene.nodes.forEach((node,index)=>{
      if(!node.collapsed||!node.links)return;
      node.links.forEach(link=>{const from=byId.get(link.from);
        if(from)communityEdge(from,node,{weight:link.count},rank.get(node.id)??index,rank.get(node.id)??index)})});
    state.scene.nodes.slice().sort((a,b)=>(a.depth||1)-(b.depth||1))
      .forEach((node,index)=>{
        node.type==='community'?drawCommunity(node,rank.get(node.id)??index):drawDocument(node,index);
        // Ce qui vient d'apparaître pendant un ingest se signale sur place : le
        // lecteur voit la page arriver dans son domaine sans que rien d'autre
        // ne bouge. Le halo s'éteint tout seul.
        const fresh=graphNodeFreshness(node.id);
        if(!fresh)return;
        const spot=project(node),ring=(node.type==='community'?communityRadius(node)*spot.scale:9)+7+(1-fresh)*10;
        context.strokeStyle='rgba(116,195,101,'+(fresh*.85).toFixed(3)+')';context.lineWidth=2;
        context.beginPath();context.arc(spot.x,spot.y,ring,0,Math.PI*2);context.stroke()});
    drawLabels();
    // L'ancre est relevée à l'image, pas à l'événement : le zoom, le
    // déplacement et le recadrage animé passent tous par le dessin, et un seul
    // point de mesure évite qu'une fiche flottante se désolidarise de sa bulle
    // pendant une transition.
    if(state.anchor)state.anchor.notify(locateNode(state.anchor.id));
    /*
     Ce qui s'anime, c'est une constellation — pas un niveau de vue.

     La condition portait sur level==='map'. Depuis qu'un domaine ouvert
     affiche ses voisins restés repliés, la vue « community » contient elle
     aussi des amas scintillants et des particules sur les liens : ils étaient
     dessinés une fois puis figés en pleine oscillation, ce qui se voit comme
     une animation qui s'arrête.
    */
    if(state.animated||hasFreshGraphNodes())scheduler.animate(260)}
  scheduler=createGraphFrameScheduler(draw);camera=createGraphCamera(scheduler);resize();
  function hit(x,y){return [...state.hits].reverse().find(item=>item.w?Math.abs(x-item.x)<=item.w/2&&Math.abs(y-item.y)<=item.h/2:Math.hypot(x-item.x,y-item.y)<=item.r)}
  function coordinates(event){const rect=surface.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top}}
  // Le double-clic descend aussi loin qu'il peut, mais pas dans une page sans
  // relation : la vue focus y serait vide. Voir selectDocument.
  function activate(node,deep=false){if(node.type==='community')selectCommunity(node.id);else if(deep&&documentHasRelations(node.id)){selected=node;selectedCommunity=node.communityId;view='focus';render()}else selectDocument(node)}
  /*
   Fin de geste, en un seul endroit.

   Le graphe restait accroché au curseur après le relâchement : il fallait
   recliquer pour s'en défaire. pointerup remettait bien state.pointer à
   null, mais il ne libérait jamais la capture, et surtout pointercancel
   n'était écouté nulle part. Un geste annulé par le navigateur — changement
   d'onglet, interruption tactile, bouton relâché hors du cadre — laissait donc
   l'état de déplacement actif indéfiniment.
  */
  function endPointerGesture(event,point){
    if(!state.pointer)return;
    const dragging=state.pointer.target&&state.pointer.target.node.type!=='community';
    if(state.dragged&&dragging)saveCanvasExplorerPosition(state.pointer.target.node);
    // Un clic dans le vide ferme la fiche de contexte : c'est le geste par
    // lequel on referme n'importe quel calque, et la croix reste pour ceux qui
    // ne l'essaient pas.
    else if(!state.dragged&&point){const target=hit(point.x,point.y);if(target)activate(target.node);else closeGraphContextCard()}
    // L'identifiant est mémorisé à la prise, pas relu sur l'événement : un
    // relâchement hors du canevas n'en fournit aucun, et la capture resterait
    // pendante — le canevas continuerait d'intercepter les événements destinés
    // aux panneaux qui le survolent.
    const captured=state.pointer.pointerId;
    state.pointer=null;state.dragged=false;
    if(captured!==undefined&&surface.hasPointerCapture?.(captured))surface.releasePointerCapture(captured);
    scheduler.invalidate()
  }
  surface.addEventListener('pointerdown',event=>{const point=coordinates(event),target=hit(point.x,point.y);state.pointer={...point,lastX:point.x,lastY:point.y,target,pointerId:event.pointerId};state.dragged=false;surface.setPointerCapture(event.pointerId)});
  surface.addEventListener('pointermove',event=>{const point=coordinates(event);
    if(!state.pointer){const target=hit(point.x,point.y);state.hover=target?.node.id||null;scheduler.invalidate();return}
    // Le déplacement n'est valide que tant que le bouton est enfoncé. Ce
    // contrôle rend le geste indépendant de la bonne réception d'un
    // événement de relâchement : si le bouton est levé, on lâche, point.
    if(event.buttons===0){endPointerGesture(event,null);return}
    const dx=point.x-state.pointer.lastX,dy=point.y-state.pointer.lastY;if(Math.abs(point.x-state.pointer.x)+Math.abs(point.y-state.pointer.y)>4)state.dragged=true;if(state.pointer.target&&state.pointer.target.node.type!=='community'){const modelScale=Math.min(state.width,state.height)*camera.state.scale;state.pointer.target.node.x+=dx/modelScale;state.pointer.target.node.y+=dy/modelScale}else camera.pan(-dx/(Math.min(state.width,state.height)*camera.state.scale),-dy/(Math.min(state.width,state.height)*camera.state.scale));state.pointer.lastX=point.x;state.pointer.lastY=point.y;scheduler.invalidate()});
  surface.addEventListener('pointerup',event=>endPointerGesture(event,coordinates(event)));
  surface.addEventListener('pointercancel',event=>endPointerGesture(event,null));
  // Dernier filet : un relâchement survenu hors du canevas, sur un panneau ou
  // en dehors de la fenêtre, n'atteint jamais les gestionnaires ci-dessus.
  // Ces écouteurs vivent sur window, donc ils survivraient à l'explorateur :
  // on les garde pour pouvoir les retirer dans destroy().
  const releaseOutside=()=>{if(state.pointer)endPointerGesture(null,null)};
  window.addEventListener('pointerup',releaseOutside);
  window.addEventListener('blur',releaseOutside);
  surface.addEventListener('dblclick',event=>{const point=coordinates(event),target=hit(point.x,point.y);if(target)activate(target.node,true);else camera.moveTo(bounds(state.scene.nodes),280)});
  surface.addEventListener('wheel',event=>{event.preventDefault();const point=coordinates(event),size=Math.min(state.width,state.height),box=frame(),worldX=camera.state.x+(point.x-box.x)/(size*camera.state.scale),worldY=camera.state.y+(point.y-box.y)/(size*camera.state.scale);camera.zoomAt(event.deltaY<0?1.14:1/1.14,worldX,worldY)},{passive:false});
  surface.addEventListener('keydown',event=>{const step=.06/camera.state.scale;if(event.key==='ArrowLeft')camera.pan(-step,0);else if(event.key==='ArrowRight')camera.pan(step,0);else if(event.key==='ArrowUp')camera.pan(0,-step);else if(event.key==='ArrowDown')camera.pan(0,step);else if(event.key==='+'||event.key==='=')camera.zoomAt(1.2,camera.state.x,camera.state.y);else if(event.key==='-')camera.zoomAt(1/1.2,camera.state.x,camera.state.y);else if(event.key==='Home')camera.moveTo(bounds(state.scene.nodes),260);else return;event.preventDefault()});
  a11y.addEventListener('click',event=>{const button=event.target.closest('[data-canvas-node]'),node=state.scene.nodes.find(item=>item.id===button?.dataset.canvasNode);if(node)activate(node)});
  // Les panneaux sont observés au même titre que le canevas : leur taille
  // change avec leur contenu (un domaine de 12 documents n'occupe pas la place
  // d'un domaine de 3), et c'est cette taille qui définit le cadre utile.
  const observer=new ResizeObserver(resize);observer.observe(host);
  (host.parentElement||host).querySelectorAll('.inspector,.stage-title,.stage-tools').forEach(panel=>observer.observe(panel));const themeObserver=new MutationObserver(()=>scheduler.invalidate());themeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  /*
   Une nouvelle scène se recadre ; la même scène garde son cadrage.

   Le repère mémorisé était le NIVEAU de vue. Passer d'un domaine à un autre ne
   changeait donc pas de niveau : aucune des deux branches ne se déclenchait et
   la caméra restait telle quelle, cadrée sur le domaine précédent. Il fallait
   recentrer et rezoomer à la main à chaque entité — et revenir sur un domaine
   déjà visité restaurait le cadrage d'un autre, ce qui est pire que rien.

   Le repère est maintenant le contenu de la scène. Un contenu inédit se cadre
   automatiquement, un contenu déjà quitté retrouve le cadrage qu'on lui avait
   donné, et un simple redessin ne bouge pas la caméra — sans quoi le
   déplacement manuel d'une fiche relancerait un recadrage à chaque image.
  */
  /*
   Une scène qui s'enrichit n'est pas une nouvelle scène.

   Le repère est la liste des nœuds : l'arrivée d'un document pendant un ingest
   la change, et la caméra se recadrait donc à chaque nouvelle page — au milieu
   de la lecture, en annulant zoom et déplacement. Or ajouter n'est pas
   naviguer. Tant que tout ce qui était affiché l'est encore, on garde le
   cadrage ; le nouveau venu se signale par son halo, pas en déplaçant le
   reste.
  */
  return{host,setScene(scene){
    const signature=scene.level+'#'+scene.nodes.map(node=>node.id).join('|');
    if(state.signature)state.viewports.set(state.signature,{...camera.state});
    const previous=state.signature,previousIds=state.nodeIds;
    const nodeIds=new Set(scene.nodes.map(node=>node.id));
    const grew=!!previousIds&&scene.level===state.scene?.level&&[...previousIds].every(id=>nodeIds.has(id));
    state.scene=scene;state.signature=signature;state.nodeIds=nodeIds;
    state.animated=scene.nodes.some(node=>node.type==='community')||hasFreshGraphNodes();
    renderA11y();measureFrame();
    if(signature!==previous&&!grew){const saved=state.viewports.get(signature);camera.moveTo(saved||bounds(scene.nodes),saved?260:320)}
    scheduler.invalidate()},
  anchor(id,notify){state.anchor=id?{id,notify}:null;if(id)scheduler.invalidate()},
  locate:locateNode,
  fit(){measureFrame();camera.moveTo(bounds(state.scene.nodes),280)},zoom(factor){camera.zoomAt(factor,camera.state.x,camera.state.y)},destroy(){observer.disconnect();themeObserver.disconnect();window.removeEventListener('pointerup',releaseOutside);window.removeEventListener('blur',releaseOutside);scheduler.destroy()},invalidate:scheduler.invalidate}
}
function renderCanvasExplorer(){
  if(!canvasExplorer||canvasExplorer.host!==canvas||!canvasExplorer.host.isConnected){destroyCanvasExplorer();canvasExplorer=createCanvasExplorer(canvas)}
  canvasExplorer.setScene(view==='map'?canvasExplorerSceneMap():canvasExplorerSceneDocuments())
}
function canvasExplorerSceneMap(){const graph=visible(),ids=new Set(graph.nodes.map(node=>node.id)),communities=data.communities.filter(item=>item.nodeIds.some(id=>ids.has(id))),nodes=communities.map((item,index)=>{const spot=canvasExplorerSlotPosition(item.id);return{id:item.id,label:item.label,type:'community',community:item,x:spot.x,y:spot.y,depth:.92+(index%4)*.04}}),visibleIds=new Set(nodes.map(node=>node.id));return{level:'map',nodes,edges:(data.communityEdges||[]).filter(edge=>visibleIds.has(edge.from)&&visibleIds.has(edge.to)).map(edge=>({...edge,weight:edge.count}))}}
function canvasExplorerSceneDocuments(){const graph=visible(),community=data.communities.find(item=>item.id===selectedCommunity)||(selected?data.communities.find(item=>item.nodeIds.includes(selected.id)):null);if(!community)return{level:view,nodes:[],edges:[]};let ids=new Set(community.nodeIds);if(view==='focus'&&selected){ids=new Set([selected.id]);data.edges.forEach(edge=>{if(edge.from===selected.id)ids.add(edge.to);if(edge.to===selected.id)ids.add(edge.from)})}const source=graph.nodes.filter(node=>ids.has(node.id)).sort((a,b)=>Number(b.id===selected?.id)-Number(a.id===selected?.id)||(b.degree||0)-(a.degree||0)||a.id.localeCompare(b.id)).slice(0,50),count=Math.max(1,source.length),typeColumns={'raw-source':-.36,'wiki-source':-.3,template:-.12,'build-context':-.08,wiki:.15,deliverable:.36},nodes=source.map((node,index)=>{let x,y;if(view==='focus'&&selected){if(node.id===selected.id){x=0;y=0}else{const angle=Math.PI*2*index/count-Math.PI/2;x=typeColumns[node.type]??Math.cos(angle)*.34;y=Math.sin(angle)*.28}}else{const angle=index*2.399963,r=.04+Math.sqrt(index)*.048;x=Math.cos(angle)*r;y=Math.sin(angle)*r*.8}const saved=readCanvasExplorerPosition(node.id);if(saved){x=saved.x;y=saved.y}return{...node,label:node.title,x,y,depth:.9+(index%5)*.04,communityId:node.community?.communityId}});separateCanvasExplorerNodes(nodes);const visibleIds=new Set(nodes.map(node=>node.id));
  const edges=data.edges.filter(edge=>visibleIds.has(edge.from)&&visibleIds.has(edge.to));
  return{level:view,nodes:[...nodes,...collapsedNeighbourGroups(nodes,visibleIds,edges)],edges}}

/*
 Domaines voisins, laissés repliés en périphérie.

 Ouvrir un domaine filtrait toutes les relations qui en sortent : on perdait
 l'information la plus utile de la vue — « cette page renvoie aussi ailleurs ».
 Le lecteur ne pouvait pas le deviner, rien à l'écran ne le suggérait.

 On ajoute donc une constellation repliée par domaine voisin, posée sur un
 anneau autour du groupe ouvert, et on rebranche dessus les relations
 sortantes. Un clic l'ouvre à son tour, ce qui rend la navigation latérale
 possible sans repasser par la carte.
*/
function collapsedNeighbourGroups(inner,visibleIds,edges){
  const home=new Map();data.communities.forEach(item=>item.nodeIds.forEach(id=>home.set(id,item.id)));
  const openIds=new Set(inner.map(node=>node.id));
  const reach=new Map();
  data.edges.forEach(edge=>{
    const insideFrom=openIds.has(edge.from),insideTo=openIds.has(edge.to);
    if(insideFrom===insideTo)return;
    const outsideId=insideFrom?edge.to:edge.from,insideId=insideFrom?edge.from:edge.to;
    const groupId=home.get(outsideId);
    // Un voisin déjà affiché n'a pas à être représenté deux fois, et une page
    // sans domaine n'a pas de constellation où se ranger.
    if(!groupId||visibleIds.has(outsideId)||openIds.has(outsideId))return;
    if(!reach.has(groupId))reach.set(groupId,{ids:new Set(),from:new Map()});
    const entry=reach.get(groupId);entry.ids.add(outsideId);
    entry.from.set(insideId,(entry.from.get(insideId)||0)+1)});
  if(!reach.size)return[];
  /*
   Chaque voisin se pose du côté par lequel il est relié.

   Ils étaient répartis à pas régulier sur un cercle de rayon uniforme, dans
   l'ordre alphabétique : la position d'un domaine ne disait donc rien de sa
   relation au groupe ouvert. Un voisin accroché en bas à gauche pouvait
   atterrir plein nord, son lien traversant tout le nuage, pendant qu'un
   secteur libre restait vide — et le cadrage devait englober un anneau dont
   l'essentiel ne contenait rien.

   La direction vient maintenant du barycentre des pages qui le citent,
   pondéré par le nombre de liens. La distance suit la silhouette réelle du
   nuage dans cette direction, pas son rayon maximal : un nuage allongé ne
   repousse plus ses voisins latéraux à la distance de sa pointe. Les liens
   sont courts, ils ne traversent plus rien, et l'espace libre est occupé
   là où il se trouve.
  */
  const position=new Map(inner.map(node=>[node.id,node]));
  const centre=inner.reduce((sum,node)=>({x:sum.x+node.x/inner.length,y:sum.y+node.y/inner.length}),{x:0,y:0});
  const innerRadius=Math.max(.12,...inner.map(node=>Math.hypot(node.x-centre.x,node.y-centre.y)));
  const margin=Math.max(.10,innerRadius*.38);
  const groups=[...reach].sort(([a],[b])=>a.localeCompare(b));
  const placed=groups.map(([groupId,entry],index)=>{
    const item=data.communities.find(candidate=>candidate.id===groupId);
    if(!item)return null;
    let ax=0,ay=0,weight=0;
    entry.from.forEach((count,id)=>{const node=position.get(id);if(!node)return;
      ax+=(node.x-centre.x)*count;ay+=(node.y-centre.y)*count;weight+=count});
    let dx=weight?ax/weight:0,dy=weight?ay/weight:0,length=Math.hypot(dx,dy);
    // Un voisin accroché au centre exact — ou à des pages qui s'annulent deux à
    // deux — n'a pas de direction propre : on lui en donne une, stable.
    if(length<1e-4){const angle=Math.PI*2*index/groups.length-Math.PI/2;dx=Math.cos(angle);dy=Math.sin(angle)*.68;length=Math.hypot(dx,dy)||1}
    dx/=length;dy/=length;
    let silhouette=0;
    inner.forEach(node=>{silhouette=Math.max(silhouette,(node.x-centre.x)*dx+(node.y-centre.y)*dy)});
    const base=Math.max(innerRadius*.5,silhouette)+margin;
    return{id:groupId,label:item.label,type:'community',community:item,collapsed:true,depth:.86,
      x:centre.x+dx*base,y:centre.y+dy*base,base,
      links:[...entry.from].map(([from,count])=>({from,count}))}}).filter(Boolean);
  // Deux voisins accrochés au même endroit se superposeraient : on les écarte,
  // puis on les remet hors du nuage, l'écartement pouvant les y ramener.
  const gap=margin*1.4;
  for(let pass=0;pass<24;pass++){
    let moved=false;
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){
      const a=placed[i],b=placed[j];
      let dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy);
      if(distance>=gap)continue;
      // Deux voisins cités par les mêmes pages tombent au même point : il n'y a
      // alors aucune direction où pousser. On en fabrique une, dérivée de la
      // paire pour rester stable d'un rendu à l'autre.
      if(distance<1e-6){const angle=(i*3+j)*2.399963;dx=Math.cos(angle);dy=Math.sin(angle);distance=1}
      moved=true;const push=(gap-distance)/2/distance;
      a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push}
    placed.forEach(group=>{const dx=group.x-centre.x,dy=group.y-centre.y,distance=Math.hypot(dx,dy)||1e-4;
      if(distance<group.base){group.x=centre.x+dx/distance*group.base;group.y=centre.y+dy/distance*group.base}});
    if(!moved)break}
  return placed}
`;
}
