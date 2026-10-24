'use strict';
(()=>{
 const nav=document.getElementById('reportNavigation'),report=document.getElementById('deepResearch'),cards=document.getElementById('cards'),status=document.getElementById('reportNavigationStatus');
 if(!nav||!report||!cards)return;
 const order=['liquidity','holders','mechanics','supply','activity'];
 const definitions=window.ARCYEthLabSchema||[];
 const links=new Map();let navigatingUntil=0;
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
    navigatingUntil=performance.now()+700;offset();target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    target.focus({preventScroll:true});activate(id);
   });
  });
 }
 function activate(id){for(const[key,link]of links)if(key===id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
 function offset(){let bottom=0;for(const header of document.querySelectorAll('header')){const style=getComputedStyle(header),rect=header.getBoundingClientRect();if(['fixed','sticky'].includes(style.position)&&rect.top<=0&&rect.bottom>0)bottom=Math.max(bottom,rect.bottom);}cards.style.setProperty('--report-header-offset',(bottom+20)+'px');return bottom+20;}
 let pending=false;
 function update(){pending=false;const top=offset();if(performance.now()<navigatingUntil)return;const visible=[...cards.querySelectorAll('[data-card-id]')].filter(el=>el.getClientRects().length);if(!visible.length){activate(null);return;}let chosen=visible[0];for(const el of visible)if(el.getBoundingClientRect().top<=top+30)chosen=el;const current=visible.find(el=>links.get(el.dataset.cardId)?.hasAttribute('aria-current'));if(current&&Math.abs(current.getBoundingClientRect().top-chosen.getBoundingClientRect().top)<2)chosen=current;activate(chosen.dataset.cardId);}
 function schedule(){if(performance.now()<navigatingUntil)navigatingUntil=performance.now()+700;if(!pending){pending=true;requestAnimationFrame(update);}}
 function bind(){status.textContent='';for(const el of cards.querySelectorAll('[data-card-id]')){el.id='research-'+el.dataset.cardId;el.tabIndex=-1;}schedule();}
 new MutationObserver(bind).observe(cards,{childList:true,subtree:true});
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);report.addEventListener('toggle',schedule);bind();
 addEventListener('wheel',()=>{navigatingUntil=0;schedule();},{passive:true});addEventListener('touchstart',()=>{navigatingUntil=0;},{passive:true});addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)){navigatingUntil=0;schedule();}});
})();
