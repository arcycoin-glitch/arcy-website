'use strict';
(()=>{
 const nav=document.getElementById('reportNavigation'),report=document.getElementById('deepResearch'),cards=document.getElementById('cards'),status=document.getElementById('reportNavigationStatus');
 if(!nav||!report||!cards)return;
 nav.lang='en';nav.setAttribute('translate','no');nav.classList.add('notranslate');cards.lang='en';
 const order=['liquidity','holders','mechanics','supply','activity'],definitions=window.ARCYEthLabSchema||[],links=new Map(),groupStates=new Map(),motion=matchMedia('(prefers-reduced-motion: reduce)');
 let activeId=order[0],slides=[],pending=false,rebuilding=false,intended=null;
 cards.classList.add('report-carousel');cards.setAttribute('role','region');cards.setAttribute('aria-roledescription','carousel');cards.setAttribute('aria-label','Token analysis cards');cards.tabIndex=0;
 const controls=document.createElement('div');controls.className='report-carousel-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Swipe or use the arrows to explore all available analyses');
 const previous=document.createElement('button'),next=document.createElement('button'),position=document.createElement('span');
 previous.type=next.type='button';previous.className=next.className='report-carousel-arrow';previous.textContent='← Previous';next.textContent='Next →';previous.setAttribute('aria-label','Previous analysis');next.setAttribute('aria-label','Next analysis');previous.setAttribute('aria-controls','cards');next.setAttribute('aria-controls','cards');position.setAttribute('role','status');position.setAttribute('aria-live','polite');controls.append(previous,position,next);cards.before(controls);
 const title=id=>definitions.find(spec=>spec.id===id)?.title||id;
 function activeIndex(){return slides.findIndex(slide=>slide.dataset.reportCard===activeId);}
 function activate(index){
  if(index<0||!slides[index])return;activeId=slides[index].dataset.reportCard;
  slides.forEach((slide,i)=>{slide.inert=i!==index;slide.setAttribute('aria-hidden',String(i!==index));});
  for(const[id,link]of links)if(id===activeId)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
  const disclosure=slides[index].querySelector(':scope > .report-card-disclosure');if(disclosure)disclosure.open=true;
  previous.disabled=index===0;next.disabled=index===slides.length-1;position.textContent=(index+1)+' / '+slides.length+' · '+title(activeId);
 }
 function align(index,smooth=false){if(index<0||!slides[index])return;activate(index);intended=smooth&&!motion.matches?index:null;cards.scrollTo({left:slides[index].offsetLeft,behavior:intended!==null?'smooth':'instant'});}
 function select(id,focus=false){
  report.open=true;const index=slides.findIndex(slide=>slide.dataset.reportCard===id);
  if(index<0){status.textContent=title(id)+': '+(document.getElementById('evidenceCount')?.textContent||'No report available yet.');return;}
  status.textContent='';requestAnimationFrame(()=>{align(index,true);if(focus){const card=slides[index].querySelector('[data-card-id]');card.focus({preventScroll:true});}const rect=cards.getBoundingClientRect();if(rect.top<0||rect.top>innerHeight-100)controls.scrollIntoView({block:'start',behavior:motion.matches?'instant':'smooth'});});
 }
 for(const id of order){const spec=definitions.find(x=>x.id===id);if(!spec)continue;const link=document.createElement('a'),icon=document.createElement('span'),label=document.createElement('span'),[symbol,...words]=spec.title.split(' ');icon.textContent=symbol;icon.setAttribute('aria-hidden','true');label.textContent=words.join(' ');link.href='#research-'+id;link.append(icon,label);nav.append(link);links.set(id,link);link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();select(id,true);});}
 previous.addEventListener('click',()=>align(activeIndex()-1,true));next.addEventListener('click',()=>align(activeIndex()+1,true));
 function keyboard(event){if(event.altKey||event.ctrlKey||event.metaKey)return;if(event.currentTarget===cards&&event.target!==cards&&!event.target.matches('[data-card-id]'))return;let index=activeIndex();if(event.key==='ArrowRight')index++;else if(event.key==='ArrowLeft')index--;else if(event.key==='Home')index=0;else if(event.key==='End')index=slides.length-1;else return;event.preventDefault();align(Math.max(0,Math.min(slides.length-1,index)),true);}
 nav.addEventListener('keydown',keyboard);controls.addEventListener('keydown',keyboard);cards.addEventListener('keydown',keyboard);
 function bind(){
  if(rebuilding)return;const nodes=[...cards.querySelectorAll('[data-card-id]')].sort((a,b)=>order.indexOf(a.dataset.cardId)-order.indexOf(b.dataset.cardId));
  for(const node of nodes){node.id='research-'+node.dataset.cardId;node.tabIndex=-1;}
  if(nodes.some(node=>!node.closest('.report-carousel-slide'))){
   rebuilding=true;const fragment=document.createDocumentFragment();
   for(const node of nodes){const id=node.dataset.cardId,sourceGroup=node.closest('.unverifiedModules'),slide=document.createElement('div');slide.className='report-carousel-slide';slide.dataset.reportCard=id;slide.setAttribute('role','group');slide.setAttribute('aria-roledescription','slide');slide.setAttribute('aria-label',title(id));
    if(sourceGroup){const disclosure=document.createElement('details'),summary=document.createElement('summary');disclosure.className='unverifiedModules report-card-disclosure';summary.textContent=title(id)+' · No source-backed metrics · Review reasons';disclosure.open=groupStates.get(id)??true;disclosure.append(summary,node);disclosure.addEventListener('toggle',()=>groupStates.set(id,disclosure.open));slide.append(disclosure);}else slide.append(node);
    fragment.append(slide);
   }
   cards.replaceChildren(fragment);rebuilding=false;
  }
  slides=[...cards.children].filter(node=>node.classList.contains('report-carousel-slide'));for(const[id,link]of links){const unavailable=!nodes.some(node=>node.dataset.cardId===id);link.dataset.unavailable=String(unavailable);if(unavailable)link.setAttribute('aria-describedby','evidenceCount');else link.removeAttribute('aria-describedby');}
  if(slides.length){status.textContent='';const index=activeIndex();align(index<0?0:index);}else{previous.disabled=next.disabled=true;position.textContent='No research cards available';}
 }
 new MutationObserver(bind).observe(cards,{childList:true,subtree:true});
 cards.addEventListener('scroll',()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;if(!slides.length)return;if(intended!==null){if(Math.abs(slides[intended].offsetLeft-cards.scrollLeft)>1)return;intended=null;}let nearest=0;for(let i=1;i<slides.length;i++)if(Math.abs(slides[i].offsetLeft-cards.scrollLeft)<Math.abs(slides[nearest].offsetLeft-cards.scrollLeft))nearest=i;if(nearest!==activeIndex())activate(nearest);});},{passive:true});
 cards.addEventListener('pointerdown',()=>{intended=null;},{passive:true});cards.addEventListener('wheel',event=>{if(event.deltaX)intended=null;},{passive:true});
 let width=0;if('ResizeObserver'in window)new ResizeObserver(entries=>{const nextWidth=entries[0].contentRect.width;if(Math.abs(nextWidth-width)>.5){width=nextWidth;align(activeIndex());}}).observe(cards);else addEventListener('resize',()=>align(activeIndex()));
 motion.addEventListener('change',()=>{if(motion.matches)align(activeIndex());});report.addEventListener('toggle',()=>{if(report.open)requestAnimationFrame(()=>align(activeIndex()));});bind();
})();
