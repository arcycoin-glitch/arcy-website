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
 function publications(values){
  if(document.readyState==='loading')return;
  for(const [chain,chainId,index]of [['ethereum',1,1],['robinhood',4663,2]]){
   const value=values?.[chain],panel=panels[index];if(value?.chain!==chain||value.chainId!==chainId||!Array.isArray(value.cards)||value.cards.length!==3)continue;
   const title=panel.querySelector('.head h3');title.querySelector('[data-pulse-number]')?.remove();
   if(Number.isSafeInteger(value.number)&&value.number>0){const edition=document.createElement('span');edition.dataset.pulseNumber='';edition.textContent=' #'+String(value.number).padStart(3,'0');title.append(edition);}
   panel.querySelector('.head p').textContent=value.contentNotice||'Verified weekly publication unavailable. No news has been substituted.';
   for(const [i,card]of [...panel.querySelectorAll('.pulse-card')].entries()){
    const item=value.cards[i];card.querySelector('.pulse-owner').textContent=(item.owner||'SOURCE STATUS')+(item.publishedAt?' · '+item.publishedAt.slice(0,10):'');card.querySelector('h4').textContent=item.title;card.querySelector('p').textContent=item.summary;
    const old=card.querySelector('.pulse-source-placeholder'),link=document.createElement(item.url?'a':'div');link.className='pulse-source-placeholder';
    let url;try{url=new URL(item.url);if(url.protocol!=='https:')url=null;}catch{}
    if(url){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.linkLabel||'READ PRIMARY SOURCE ↗';}else link.textContent='SOURCE STATUS · NOT A NEWS ITEM';old.replaceWith(link);
   }
   panel.querySelector('.pulse-take p').textContent=value.take;
   let archive=panel.querySelector('.pulse-archive-link');if(!archive){archive=document.createElement('a');archive.className='pulse-archive-link';panel.querySelector('.pulse-take').append(archive);}
   const params=new URLSearchParams(location.search),archived=params.get('pulseChain')===chain&&Number.isSafeInteger(Number(params.get('pulseEdition')))&&Number(params.get('pulseEdition'))>0;
   archive.hidden=!archived&&!(value.number>1);archive.href='/?pulseChain='+chain+(archived?'':'&pulseEdition='+(value.number-1))+'#pulse';archive.textContent=archived?'CURRENT EDITION':'PREVIOUS EDITION #'+String(value.number-1).padStart(3,'0');
  }
  sizes();
 }
 addEventListener('arcy-pulse-networks',event=>publications(event.detail));
 addEventListener('DOMContentLoaded',()=>{publications(window.ARCYPulseNetworks);const chain=new URLSearchParams(location.search).get('pulseChain');if(chain==='ethereum')select(1);if(chain==='robinhood')select(2);});
 if(document.readyState!=='loading')publications(window.ARCYPulseNetworks);
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
