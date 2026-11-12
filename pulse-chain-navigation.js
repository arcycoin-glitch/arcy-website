'use strict';
(()=>{
 const root=document.getElementById('pulse'),arc=document.getElementById('pulse-panel-arc');if(!root||!arc)return;
 const buttons=[...root.querySelectorAll('[data-pulse-chain]')],panels=buttons.map(button=>document.getElementById(button.getAttribute('aria-controls')));
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let active=0,animation;
 const fallback=[['pulse-week','🔥 LATEST MOVES'],['pulse-new','🧭 ECOSYSTEM'],['pulse-unlock','🔎 DEEP DIVE']];
 const edition=Number(new URLSearchParams(location.search).get('pulseEdition'));
 const projectsMode=!(Number.isSafeInteger(edition)&&edition>0);
 if(projectsMode){
  // The old weekly loader and fallback own the archived mounts. Detach their grid on the current view.
  const legacyGrid=arc.querySelector('#pulseGrid'),grid=legacyGrid.cloneNode(false);
  grid.id='pulseProjectGrid';legacyGrid.replaceWith(grid);
  const title=arc.querySelector('#pulseTitle');title.id='pulseProjectTitle';title.lang='en';title.translate=false;
  arc.querySelector('#pulseTake').id='pulseProjectTake';
 }
 const chains=[['arc',5042,'Arc'],['ethereum',1,'Ethereum'],['robinhood',4663,'Robinhood Chain']];
 const takes=[
  'New Arc lending and swap integrations give builders more options. Check executable liquidity before treating an integration as usable at size.',
  'More venues and market configurations can improve choice. Compare their collateral rules, pricing and execution before relying on them.',
  'Stock-token collateral, routing and price feeds support different parts of a trade. Check the exact market and token before drawing conclusions about access or depth.',
 ];
 const sourceHosts=new Set(['www.aave.com','governance.aave.com','morpho.org','docs.uniswap.org','blog.uniswap.org','docs.robinhood.com','www.prnewswire.com']);
 const states={RECENT:'Dated development',HISTORICAL:'Project profile · historical',SOURCE_UNAVAILABLE:'Project profile · source unavailable',UNVERIFIED:'Project profile · unverified development'};
 const visits=new Map();
 function node(tag,text,cls){const element=document.createElement(tag);if(text)element.textContent=text;if(cls)element.className=cls;return element;}
 function projectUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&sourceHosts.has(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.search?url.href:null;}catch{return null;}}
 function projectCard(item,index,name,used){
  const card=node('article',null,'pulse-card pulse-project-card '+fallback[index][0]);
  const source=projectUrl(item?.source?.url),profile=projectUrl(item?.identityUrl),status=item?.developmentStatus;
  const dated=status==='RECENT'||status==='HISTORICAL',date=item?.source?.date;
  const valid=item&&typeof item.projectId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(item.projectId)&&!used.has(item.projectId)&&
    Object.hasOwn(states,status)&&source&&profile&&item.contentType===(status==='RECENT'?'DATED_DEVELOPMENT':'PROJECT_PROFILE')&&
    [item.name,item.purpose,item.change,item.implication,item.limitation,item.source.publisher].every(text=>typeof text==='string'&&text.trim()&&text.length<=240)&&
    (dated?typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&item.source.evidence==='SOURCE_VERIFIED_PUBLICATION':date===null&&item.source.evidence==='PROJECT_IDENTITY');
  if(!valid){
   const loading=item?.contentType==='LOADING';
   if(loading)card.setAttribute('aria-busy','true');
   card.append(node('small',name,'pulse-owner'),node('h4',loading?'Loading project research…':'Project coverage unavailable'),
    node('p',loading?'Checking reviewed primary sources.':item?.reason==='INSUFFICIENT_REVIEWED_PROJECTS'?
      'There is no additional reviewed project for this network.':'This project slot could not be validated.'));
   return card;
  }
  used.add(item.projectId);card.dataset.projectId=item.projectId;card.dataset.developmentStatus=status;
  const heading=node('h4',item.name),body=node('dl',null,'pulse-project-details');
  for(const [label,value]of [['What changed',item.change],['Why it matters',item.implication],['Risk / not proven',item.limitation]]){
   body.append(node('dt',label),node('dd',value));
  }
  const footer=node('footer',null,'pulse-project-source');
  footer.append(node('small',(dated?'Source-verified publication · ':'Reviewed project identity · ')+item.source.publisher));
  if(dated){const time=node('time',date);time.dateTime=date;footer.append(time);}
  const link=node('a','VIEW SOURCE');link.href=source;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','View '+item.name+' primary source');
  footer.append(link);
  card.append(node('small',name+' · '+states[status],'pulse-owner'),heading,node('p',item.purpose,'pulse-project-purpose'),body,footer);
  return card;
 }
 function renderProjects(index,items){
  const panel=panels[index],grid=panel.querySelector('.pulse-grid'),used=new Set();
  panel.querySelector('.head p').textContent='What each project builds, its latest reviewed update and what still needs checking.';
  panel.querySelector('.pulse-take p').textContent=takes[index];
  grid.replaceChildren(...fallback.map((_,slot)=>projectCard(items[slot],slot,chains[index][2],used)));
 }
 function loadProjects(index){
  if(!projectsMode||visits.has(index))return;
  const [chain,chainId]=chains[index];
  renderProjects(index,Array(3).fill({contentType:'LOADING'}));
  const task=fetch('/api/pulse?view=projects&chain='+chain,{signal:AbortSignal.timeout(6000)}).then(async response=>{
   if(!response.ok)throw Error('Pulse project request failed');
   const value=await response.json();
   if(value.ok!==true||value.projectSchemaVersion!==1||value.chain!==chain||value.chainId!==chainId||!Array.isArray(value.projectCards)||value.projectCards.length!==3)throw Error('Invalid Pulse project response');
   renderProjects(index,value.projectCards);
  }).catch(()=>{renderProjects(index,[]);visits.delete(index);});
  visits.set(index,task);
 }
 function skeleton(panel,name){
  const eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent='VERIFIED '+name.toUpperCase()+' SIGNAL';
  const head=document.createElement('div');head.className='head';const title=document.createElement('h3'),desc=document.createElement('p');const y=document.createElement('span');y.className='arcy-wordmark-y';y.textContent='Y';title.append(document.createTextNode('ARC'),y,document.createTextNode(' '+name.toUpperCase()+' PULSE'));desc.textContent='Latest dated announcements, useful ecosystem links and independently inspectable sources.';head.append(title,desc);
  const grid=document.createElement('div');grid.className='pulse-grid';
  for(const[cls,label]of fallback){const card=document.createElement('article');card.className='pulse-card '+cls;const heading=document.createElement('span'),owner=document.createElement('small'),h=document.createElement('h4'),p=document.createElement('p'),source=document.createElement('div');heading.textContent=label;owner.className='pulse-owner';owner.textContent=name.toUpperCase()+' · LOADING';h.textContent='Loading verified research…';p.textContent='Fetching the latest signed or first-party reviewed edition.';source.className='pulse-source-placeholder';source.textContent='Sources loading';card.dataset.pulseState='loading';card.setAttribute('aria-busy','true');card.append(heading,owner,h,p,source);grid.append(card);}
  const take=document.createElement('div');take.className='pulse-take';const label=document.createElement('b'),text=document.createElement('p'),small=document.createElement('small');label.textContent='🦉 ARCY TAKE';text.textContent='Loading the latest verified edition…';small.textContent='No hype. Just signal. • arcyusdc.xyz';take.append(label,text,small);panel.append(eyebrow,head,grid,take);
 }
 skeleton(panels[1],'Ethereum');skeleton(panels[2],'Robinhood Chain');
 // Honest failure state: a request that failed is UNAVAILABLE, never "not connected" and never substituted news.
 function unavailable(panel,name){
  if(projectsMode)return;
  if(!panel||!panel.querySelector('.pulse-card[data-pulse-state="loading"]'))return;
  for(const card of panel.querySelectorAll('.pulse-card[data-pulse-state="loading"]')){card.dataset.pulseState='unavailable';card.removeAttribute('aria-busy');card.querySelector('.pulse-owner').textContent=name.toUpperCase()+' · SOURCE STATUS';card.querySelector('h4').textContent='Pulse temporarily unavailable';card.querySelector('p').textContent='The verified edition could not be loaded. No news has been substituted.';card.querySelector('.pulse-source-placeholder').textContent='SOURCE STATUS · NOT A NEWS ITEM';}
  const take=panel.querySelector('.pulse-take p');if(take)take.textContent='ARCY Take unavailable: the verified edition did not load. No stale news was presented as current.';
 }
 addEventListener('arcy-pulse-networks-failed',()=>{unavailable(panels[1],'Ethereum');unavailable(panels[2],'Robinhood Chain');});
 function publications(values){
  if(document.readyState==='loading')return;
  for(const [chain,chainId,index]of [['ethereum',1,1],['robinhood',4663,2]]){
   const value=values?.[chain],panel=panels[index];if(value?.chain!==chain||value.chainId!==chainId||!Array.isArray(value.cards)||value.cards.length!==3){if(values&&typeof values==='object')unavailable(panel,index===1?'Ethereum':'Robinhood Chain');continue;}
   const title=panel.querySelector('.head h3');title.querySelector('[data-pulse-number]')?.remove();
   if(!projectsMode&&Number.isSafeInteger(value.number)&&value.number>0){const edition=document.createElement('span');edition.dataset.pulseNumber='';edition.textContent=' #'+String(value.number).padStart(3,'0');title.append(edition);}
   if(!projectsMode)panel.querySelector('.head p').textContent=value.contentNotice||'Verified weekly publication unavailable. No news has been substituted.';
   for(const [i,card]of (projectsMode?[]:[...panel.querySelectorAll('.pulse-card')]).entries()){
    const item=value.cards[i];card.dataset.pulseState='published';card.removeAttribute('aria-busy');card.querySelector('.pulse-owner').textContent=(item.owner||'SOURCE STATUS')+(item.publishedAt?' · '+item.publishedAt.slice(0,10):'');card.querySelector('h4').textContent=item.title;card.querySelector('p').textContent=item.summary;
    const old=card.querySelector('.pulse-source-placeholder'),link=document.createElement(item.url?'a':'div');link.className='pulse-source-placeholder';
    let url;try{url=new URL(item.url);if(url.protocol!=='https:')url=null;}catch{}
    if(url){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.linkLabel||'READ PRIMARY SOURCE ↗';}else link.textContent='SOURCE STATUS · NOT A NEWS ITEM';old.replaceWith(link);
   }
   if(!projectsMode)panel.querySelector('.pulse-take p').textContent=value.take;
   let archive=panel.querySelector('.pulse-archive-link');if(!archive){archive=document.createElement('a');archive.className='pulse-archive-link';panel.querySelector('.pulse-take').append(archive);}
   const params=new URLSearchParams(location.search),archived=params.get('pulseChain')===chain&&Number.isSafeInteger(Number(params.get('pulseEdition')))&&Number(params.get('pulseEdition'))>0;
   archive.hidden=!archived&&!(value.number>1);archive.href='/?pulseChain='+chain+(archived?'':'&pulseEdition='+(value.number-1))+'#pulse';archive.textContent=archived?'CURRENT EDITION':'PREVIOUS EDITION #'+String(value.number-1).padStart(3,'0');
  }
  sizes();
 }
 addEventListener('arcy-pulse-networks',event=>publications(event.detail));
 function initialize(){publications(window.ARCYPulseNetworks);const chain=new URLSearchParams(location.search).get('pulseChain');const index=chains.findIndex(row=>row[0]===chain);select(index<0?0:index);}
 if(document.readyState==='loading')addEventListener('DOMContentLoaded',initialize,{once:true});else queueMicrotask(initialize);
 // Mirror only category labels/classes. Never copy Arc news, source URLs or editions.
 function sizes(){for(const panel of panels.slice(1)){for(const selector of['.head','.pulse-take'])panel.querySelector(selector).style.minHeight=arc.querySelector(selector).getBoundingClientRect().height+'px';const source=[...arc.querySelectorAll('.pulse-card')];panel.querySelectorAll('.pulse-card').forEach((card,i)=>{card.style.minHeight=(source[i]?.getBoundingClientRect().height||0)+'px';});}}
 function headings(){if(projectsMode)return;const cards=[...arc.querySelectorAll('.pulse-card')];if(cards.length!==3)return;for(const panel of panels.slice(1))for(const[i,card]of [...panel.querySelectorAll('.pulse-card')].entries()){card.firstElementChild.textContent=fallback[i][1];card.className=cards[i].className;}sizes();}
 if(!projectsMode){new MutationObserver(headings).observe(document.getElementById('pulseGrid'),{childList:true,subtree:true,characterData:true});headings();}
 if('ResizeObserver'in window){const observer=new ResizeObserver(sizes);for(const selector of['.head','.pulse-take','.pulse-grid'])observer.observe(arc.querySelector(selector));}else addEventListener('resize',sizes);
 function select(index,focus=false){loadProjects(index);if(index===active){if(focus)buttons[index].focus();return;}const direction=index>active?1:-1;animation?.cancel();active=index;
  panels.forEach((panel,i)=>{panel.inert=i!==index;panel.setAttribute('aria-hidden',String(i!==index));buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});
  if(focus)buttons[index].focus();if(!reduced.matches)animation=panels[index].animate([{transform:'translateX('+direction*12+'px)',opacity:.7},{transform:'translateX(0)',opacity:1}],{duration:180,easing:'ease-out'});
 }
 // Mobile carousel applies to RESEARCH CARDS inside each chain, NOT the chain tabs.
 // Keep the existing network selector, Pulse source data and ARCY TAKE unchanged.
 function initResearchCarousel(panel){
  const grid=panel.querySelector('.pulse-grid');
  if(!grid)return;
  const controls=document.createElement('nav');
  controls.className='pulse-card-controls';
  controls.setAttribute('aria-label','Pulse research card navigation');
  const previous=document.createElement('button'),next=document.createElement('button'),counter=document.createElement('span');
  previous.type='button';next.type='button';
  previous.textContent='‹ Previous';next.textContent='Next ›';
  previous.setAttribute('aria-label','Previous Pulse research card');
  next.setAttribute('aria-label','Next Pulse research card');
  counter.className='pulse-card-counter';counter.setAttribute('aria-live','polite');
  controls.append(previous,counter,next);
  grid.insertAdjacentElement('afterend',controls);
  const slides=()=>[...grid.querySelectorAll(':scope > .pulse-card')];
  function positionOf(card,first){return card.offsetLeft-first.offsetLeft;}
  function selectedIndex(items){
   if(!items.length)return 0;
   const initial=items[0],left=grid.scrollLeft;
   let chosen=0,best=Infinity;
   items.forEach((item,i)=>{const distance=Math.abs(positionOf(item,initial)-left);if(distance<best){best=distance;chosen=i;}});
   return chosen;
  }
  function sync(){
   const items=slides(),index=selectedIndex(items);
   previous.disabled=index===0;
   next.disabled=index>=items.length-1;
   counter.textContent=items.length?(index+1)+' / '+items.length:'0 / 0';
  }
  function step(direction){
   const items=slides();if(!items.length)return;
   const index=Math.max(0,Math.min(items.length-1,selectedIndex(items)+direction));
   grid.scrollTo({left:positionOf(items[index],items[0]),behavior:reduced.matches?'instant':'smooth'});
   previous.disabled=index===0;next.disabled=index===items.length-1;
   counter.textContent=(index+1)+' / '+items.length;
  }
  previous.addEventListener('click',()=>step(-1));
  next.addEventListener('click',()=>step(1));
  let frame=0;
  grid.addEventListener('scroll',()=>{
   if(frame)return;
   frame=requestAnimationFrame(()=>{frame=0;sync();});
  },{passive:true});
  new MutationObserver(()=>{grid.scrollLeft=0;sync();}).observe(grid,{childList:true});
  addEventListener('resize',sync,{passive:true});
  sync();
 }
 panels.forEach(initResearchCarousel);
 buttons.forEach((button,index)=>{button.addEventListener('click',()=>select(index));button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();select(next,true);});});
 reduced.addEventListener('change',()=>{if(reduced.matches)animation?.cancel();});
})();
