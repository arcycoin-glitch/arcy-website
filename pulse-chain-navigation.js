'use strict';
(()=>{
 const root=document.getElementById('pulse'),arc=document.getElementById('pulse-panel-arc');if(!root||!arc)return;
 const buttons=[...root.querySelectorAll('[data-pulse-chain]')],panels=buttons.map(button=>document.getElementById(button.getAttribute('aria-controls')));
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let active=0,animation;
 const fallback=[['pulse-week','🔥 THIS WEEK'],['pulse-new','🆕 NEW'],['pulse-unlock',"🔓 WHAT'S UNLOCKING"]];
 function skeleton(panel,name){
  const eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent='WEEKLY '+name.toUpperCase()+' SIGNAL';
  const head=document.createElement('div');head.className='head';const title=document.createElement('h3'),desc=document.createElement('p');const y=document.createElement('span');y.className='arcy-wordmark-y';y.textContent='Y';title.append(document.createTextNode('ARC'),y,document.createTextNode(' '+name.toUpperCase()+' PULSE'));desc.textContent='Verified weekly research has not been connected yet.';head.append(title,desc);
  const grid=document.createElement('div');grid.className='pulse-grid';
  for(const[cls,label]of fallback){const card=document.createElement('article');card.className='pulse-card '+cls;const heading=document.createElement('span'),owner=document.createElement('small'),h=document.createElement('h4'),p=document.createElement('p'),source=document.createElement('div');heading.textContent=label;owner.className='pulse-owner';owner.textContent=name.toUpperCase()+' · NOT CONNECTED';h.textContent='Research not connected';p.textContent='Verified weekly research has not been connected yet.';source.className='pulse-source-placeholder';source.textContent='Sources not connected';card.append(heading,owner,h,p,source);grid.append(card);}
  const take=document.createElement('div');take.className='pulse-take';const label=document.createElement('b'),text=document.createElement('p'),small=document.createElement('small');label.textContent='🦉 ARCY TAKE';text.textContent='Verified weekly research has not been connected yet.';small.textContent='No hype. Just signal. • arcyusdc.xyz';take.append(label,text,small);panel.append(eyebrow,head,grid,take);
 }
 skeleton(panels[1],'Ethereum');skeleton(panels[2],'Robinhood Chain');
 // Mirror only category labels/classes. Never copy Arc news, source URLs or editions.
 function sizes(){for(const panel of panels.slice(1)){for(const selector of['.head','.pulse-take'])panel.querySelector(selector).style.minHeight=arc.querySelector(selector).getBoundingClientRect().height+'px';const source=[...arc.querySelectorAll('.pulse-card')];panel.querySelectorAll('.pulse-card').forEach((card,i)=>{card.style.minHeight=(source[i]?.getBoundingClientRect().height||0)+'px';});}}
 function headings(){const cards=[...arc.querySelectorAll('.pulse-card')];if(cards.length!==3)return;for(const panel of panels.slice(1))for(const[i,card]of [...panel.querySelectorAll('.pulse-card')].entries()){const label=cards[i].querySelector(':scope > span');if(label)card.firstElementChild.textContent=label.textContent;card.className=cards[i].className;}sizes();}
 new MutationObserver(headings).observe(document.getElementById('pulseGrid'),{childList:true,subtree:true,characterData:true});headings();
 if('ResizeObserver'in window){const observer=new ResizeObserver(sizes);for(const selector of['.head','.pulse-take','.pulse-grid'])observer.observe(arc.querySelector(selector));}else addEventListener('resize',sizes);
 function select(index,focus=false){if(index===active){if(focus)buttons[index].focus();return;}const direction=index>active?1:-1;animation?.cancel();active=index;
  panels.forEach((panel,i)=>{panel.inert=i!==index;panel.setAttribute('aria-hidden',String(i!==index));buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});
  if(focus)buttons[index].focus();if(!reduced.matches)animation=panels[index].animate([{transform:'translateX('+direction*12+'px)',opacity:.7},{transform:'translateX(0)',opacity:1}],{duration:180,easing:'ease-out'});
 }
 buttons.forEach((button,index)=>{button.addEventListener('click',()=>select(index));button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();select(next,true);});});
 reduced.addEventListener('change',()=>{if(reduced.matches)animation?.cancel();});
})();
