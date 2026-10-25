'use strict';
(()=>{
 const nav=document.getElementById('reportNavigation'),report=document.getElementById('deepResearch'),cards=document.getElementById('cards'),status=document.getElementById('reportNavigationStatus');
 if(!nav||!report||!cards)return;
 const order=['liquidity','holders','mechanics','supply','activity'];
 const definitions=window.ARCYEthLabSchema||[];
 const links=new Map();
 let navigatingUntil=0,pending=false;
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const behavior=()=>reduced()?'auto':'smooth';
 const visibleCards=()=>[...cards.querySelectorAll('[data-card-id]')].filter(el=>el.getClientRects().length);
 nav.lang='en';nav.setAttribute('translate','no');nav.classList.add('notranslate');
 cards.lang='en';cards.setAttribute('role','region');cards.setAttribute('aria-label','On-chain research cards. Swipe left or right to see more analysis.');
 cards.tabIndex=0;
 function activate(id){for(const[key,link]of links)if(key===id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
 function offset(){let bottom=0;for(const header of document.querySelectorAll('header')){const style=getComputedStyle(header),rect=header.getBoundingClientRect();if(['fixed','sticky'].includes(style.position)&&rect.top<=0&&rect.bottom>0)bottom=Math.max(bottom,rect.bottom);}cards.style.setProperty('--report-header-offset',(bottom+20)+'px');return bottom+20;}
 function slideTo(target,mode=behavior()){
  if(!target)return;
  const rect=cards.getBoundingClientRect(),targetRect=target.getBoundingClientRect();
  // Layout-safe offset; never refetches, moves only the scrollable card rail.
  cards.scrollTo({left:cards.scrollLeft+targetRect.left-rect.left,behavior:mode});
  activate(target.dataset.cardId);
 }
 function currentCard(){
  const items=visibleCards();if(!items.length)return null;
  const left=cards.getBoundingClientRect().left;
  return items.reduce((best,item)=>Math.abs(item.getBoundingClientRect().left-left)<Math.abs(best.getBoundingClientRect().left-left)?item:best,items[0]);
 }
 // Clear affordances on desktop and mobile; native swipe still works without JS.
 const controls=document.createElement('div');controls.className='report-carousel-controls';
 controls.innerHTML='<span class="report-carousel-caption">Swipe or use the arrows to explore all available analyses</span>';
 const prev=document.createElement('button'),next=document.createElement('button');
 for(const [button,dir,name,glyph]of [[prev,-1,'Previous analysis','←'],[next,1,'Next analysis','→']]){
  button.type='button';button.className='report-carousel-arrow';button.textContent=glyph;button.setAttribute('aria-label',name);
  button.addEventListener('click',()=>move(dir));controls.append(button);
 }
 report.insertBefore(controls,cards);
 function updateControls(){
  const items=visibleCards(),chosen=currentCard(),idx=items.indexOf(chosen);
  prev.disabled=idx<=0;next.disabled=idx<0||idx>=items.length-1;
  controls.hidden=items.length<=1;
 }
 function move(dir){
  report.open=true;
  const items=visibleCards(),chosen=currentCard();
  if(!items.length)return;
  const nextIndex=Math.min(items.length-1,Math.max(0,items.indexOf(chosen)+dir));
  const target=items[nextIndex];navigatingUntil=performance.now()+650;
  slideTo(target);target.focus({preventScroll:true});updateControls();
 }
 for(const id of order){
  const spec=definitions.find(x=>x.id===id);if(!spec)continue;
  const link=document.createElement('a'),icon=document.createElement('span'),label=document.createElement('span');
  const [symbol,...words]=spec.title.split(' ');icon.textContent=symbol;icon.setAttribute('aria-hidden','true');label.textContent=words.join(' ');
  link.href='#research-'+id;link.append(icon,label);nav.append(link);links.set(id,link);
  link.addEventListener('click',event=>{
   if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
   event.preventDefault();report.open=true;
   const target=cards.querySelector('[data-card-id="'+id+'"]');
   if(!target){status.textContent=label.textContent+': '+(document.getElementById('evidenceCount')?.textContent||'No report available yet.');return;}
   status.textContent='';
   for(let parent=target.parentElement;parent&&parent!==report;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
   requestAnimationFrame(()=>{
    navigatingUntil=performance.now()+700;offset();
    // The overview stays in view; the selected research card slides horizontally.
    report.scrollIntoView({block:'start',behavior:behavior()});
    slideTo(target);target.focus({preventScroll:true});updateControls();
   });
  });
 }
 function update(){
  pending=false;offset();updateControls();
  if(performance.now()<navigatingUntil)return;
  activate(currentCard()?.dataset.cardId||null);
 }
 function schedule(){if(!pending){pending=true;requestAnimationFrame(update);}}
 function bind(){status.textContent='';for(const el of cards.querySelectorAll('[data-card-id]')){el.id='research-'+el.dataset.cardId;el.tabIndex=-1;}schedule();}
 new MutationObserver(bind).observe(cards,{childList:true,subtree:true});
 cards.addEventListener('scroll',schedule,{passive:true});
 cards.addEventListener('keydown',e=>{
  if(e.target!==cards||!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();move(e.key==='ArrowRight'?1:-1);
 });
 addEventListener('scroll',schedule,{passive:true});
 addEventListener('resize',schedule);report.addEventListener('toggle',schedule);bind();
 addEventListener('wheel',()=>{navigatingUntil=0;schedule();},{passive:true});
 addEventListener('touchstart',()=>{navigatingUntil=0;},{passive:true});
})();
