'use strict';
(()=>{
 const root=document.getElementById('pulse'),arc=document.getElementById('pulse-panel-arc');if(!root||!arc)return;
 const buttons=[...root.querySelectorAll('[data-pulse-chain]')],panels=buttons.map(button=>document.getElementById(button.getAttribute('aria-controls')));
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let active=0,animation;
 const fallback=[['pulse-week','🔥 LATEST MOVES'],['pulse-new','🧭 ECOSYSTEM'],['pulse-unlock','🔎 DEEP DIVE']];
 const edition=Number(new URLSearchParams(location.search).get('pulseEdition'));
 const projectsMode=!(Number.isSafeInteger(edition)&&edition>0);
 if(projectsMode){
  // The weekly loader still supplies ARCY Take and archive navigation.
  const legacyGrid=arc.querySelector('#pulseGrid'),grid=legacyGrid.cloneNode(false);
  grid.id='pulseProjectGrid';legacyGrid.replaceWith(grid);
 }
 const chains=[['arc',5042,'Arc'],['ethereum',1,'Ethereum'],['robinhood',4663,'Robinhood Chain']];
 const categories=['ACHIEVED','UPCOMING','RISK_ALERT'];
 const categoryStyles=['pulse-achieved','pulse-upcoming','pulse-risk-alert'];
 const categoryIcons=['✓','↗','!'];
 const grades={
  ACHIEVED:{PUBLISHED_RELEASE:'Published release',MERGED_CODE:'Merged code',PUBLISHER_REPORTED_COMPLETION:'Publisher-reported completion'},
  UPCOMING:{OFFICIAL_ANNOUNCEMENT:'Official announcement'},
  RISK_ALERT:{OFFICIAL_ADVISORY:'Official advisory or incident report'},
 };
 // Keep this host allowlist aligned with the first-party feeds on the server.
 const sourcePaths={
  'www.arc.io':/^\/blog\/[a-z0-9-]+\/?$/,
  'blog.ethereum.org':/^\/en\/20\d\d\/\d\d\/\d\d\/[a-z0-9-]+\/?$/,
  'github.com':/^\/(?:ethereum\/go-ethereum\/(?:releases\/tag\/v[0-9.]+|security\/advisories\/GHSA(?:-[a-z0-9]{4}){3})|Uniswap\/v4-core\/commit\/[0-9a-f]{40})$/,
  'robinhood.com':/^\/(?:us\/en\/)?newsroom\/[a-z0-9-]+\/?$/,
  'status.arc.io':/^\/incidents\/[a-z0-9]{8,20}$/,
  'status.robinhoodchain.offchain.io':/^\/incident\/[a-z0-9-]{3,80}\/?$/,
  'governance.aave.com':/^\/t\/[a-z0-9-]+\/[1-9][0-9]{0,10}$/,
  'morpho.org':/^\/blog\/[a-z0-9-]+\/?$/,
  'blog.uniswap.org':/^\/[a-z0-9-]+\/?$/,
 };
 const messages={
  LOADING:['Checking for current signals','Reviewing available primary sources.'],
  NO_VERIFIED_SIGNAL:['No verified signal','No eligible event met the evidence requirements in the reviewed sources.'],
  SOURCE_UNAVAILABLE:['Sources unavailable','Coverage could not be established from the reviewed sources.'],
  STALE:['Source check expired','A fresh source check is needed before this category can show an event.'],
 };
 const reasons={
  PARTIAL_SOURCE_COVERAGE:'Some reviewed sources could not be checked.',
  SOURCE_REVIEW_REQUIRED:'Available reports need more evidence.',
  SOURCE_COVERAGE_UNAVAILABLE:'The reviewed sources could not be checked.',
  NO_ELIGIBLE_EVENT:'No eligible event met the evidence requirements in the reviewed sources.',
  SNAPSHOT_EXPIRED:'The previous source check has expired.',
 };
 const titles={FRESH:'Sources checked.',PARTIAL:'Some sources could not be checked.',STALE:'Source check expired.',UNAVAILABLE:'Source coverage unavailable.'};
 const plans={PROPOSED:'Proposed',ANNOUNCED:'Announced',SCHEDULED:'Scheduled'};
 const incidents={INVESTIGATING:'Investigating',IDENTIFIED:'Identified',MONITORING:'Monitoring',RESOLVED:'Resolved',ACTIVE:'Active',
  POSTMORTEM:'Postmortem',PUBLISHED:'Advisory published'};
 const POLL_MS=5*60000,RETRY_MS=30000,MAX_RETRY_AFTER_MS=3600000,REQUEST_TIMEOUT_MS=6000;
 const data=chains.map(()=>({nextAt:0,expiresAt:0,failures:0,lastSuccessfulAt:null}));
 let timer,request;
 function node(tag,text,cls){const element=document.createElement(tag);if(text)element.textContent=text;if(cls)element.className=cls;return element;}
 function primaryUrl(value){
  if(typeof value!=='string'||value.length>360)return null;
  try{
   const url=new URL(value);
   return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&
    Object.hasOwn(sourcePaths,url.hostname)&&sourcePaths[url.hostname].test(url.pathname)?url.href:null;
  }catch{return null;}
 }
 function cleanText(text){return typeof text==='string'&&text.trim()&&text.length<=1000;}
 function instant(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return NaN;
  const ms=Date.parse(value);
  return Number.isFinite(ms)&&new Date(ms).toISOString()===(value.length===20?value.replace('Z','.000Z'):value)?ms:NaN;
 }
 function dateOnly(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(instant(value+'T00:00:00Z'));
 }
 function time(value,clock=false){
  const label=clock?value.slice(0,10)+' '+value.slice(11,16)+' UTC':value.slice(0,10);
  const element=node('time',label);element.dateTime=value;return element;
 }
 function eventParts(event,category,used,checkedAt){
  const source=primaryUrl(event?.url);
  const grade=event?.evidenceGrade;
  const published=event?.publishedAt;
  const displayedDate=dateOnly(published)?instant(published+'T00:00:00Z'):instant(published);
  if(!event||!source||used.has(source)||!Object.hasOwn(grades[category],grade)||!Number.isFinite(displayedDate)||displayedDate>checkedAt||
    ![event.project,event.publisher,event.title,event.summary,event.limitation].every(cleanText))return null;
  const upcoming=category==='UPCOMING';
  const targetExpires=dateOnly(event.targetAt)?Date.parse(event.targetAt)+86400000:instant(event.targetAt);
  if(upcoming?(!Object.hasOwn(plans,event.targetStatus)||(event.targetAt!==null&&!Number.isFinite(targetExpires))):
      (event.targetStatus!==null||event.targetAt!==null))return null;
  if(upcoming&&event.targetAt!==null&&targetExpires<=Date.now())return null;
  used.add(source);
  const body=node('dl',null,'pulse-project-details');
  if(upcoming){
   body.append(node('dt','Plan status'),node('dd',plans[event.targetStatus]),node('dt','Announced target'));
   const target=node('dd');target.append(event.targetAt?time(event.targetAt,!dateOnly(event.targetAt)):'No target date stated');body.append(target);
  }
  if(category==='RISK_ALERT'&&Object.hasOwn(incidents,event.incidentStatus))body.append(node('dt','Publisher status'),node('dd',incidents[event.incidentStatus]));
  if(cleanText(event.reference)&&event.reference.length<=100)body.append(node('dt','Source reference'),node('dd',event.reference));
  body.append(node('dt','Evidence limits'),node('dd',event.limitation));
  const footer=node('footer',null,'pulse-project-source');
  const publishedLine=node('small','Published ');publishedLine.append(time(published));
  const link=node('a','VIEW PRIMARY SOURCE');link.href=source;link.target='_blank';link.rel='noopener noreferrer';
  link.setAttribute('aria-label','View '+event.publisher+' primary source');
  footer.append(node('small',grades[category][grade]+' · '+event.publisher),publishedLine);
  const alsoReported=Array.isArray(event.corroboratingPublishers)?event.corroboratingPublishers.slice(0,3).filter(cleanText):[];
  if(alsoReported.length)footer.append(node('small','Also reported by '+alsoReported.join(', ')));
  footer.append(link);
  return [node('small',event.project,'pulse-owner'),node('h4',event.title),node('p',event.summary,'pulse-project-purpose'),body,footer];
 }
 function renderProjects(index,{projectCards=[],freshness='UNAVAILABLE',lastSuccessfulAt=null,checkedAt=null}={},status){
  const panel=panels[index],grid=panel.querySelector('.pulse-grid'),desc=panel.querySelector('.head p'),used=new Set();
  desc.textContent=status==='LOADING'?'Checking reviewed primary sources.':titles[freshness];
  if(lastSuccessfulAt)desc.append(' Last successful check ',time(lastSuccessfulAt,true),'.');
  for(const [slot,category] of categories.entries()){
   const card=grid.children[slot],item=projectCards[slot];
   let state=status||item?.state;
   const eligible=!status&&item?.category===category&&state==='VERIFIED'&&(freshness==='FRESH'||freshness==='PARTIAL');
   const parts=eligible?eventParts(item.event,category,used,Date.parse(checkedAt)):null;
   if(!parts&&(!Object.hasOwn(messages,state)||(!status&&item?.category!==category)))state='SOURCE_UNAVAILABLE';
   if(!parts&&status!=='LOADING'&&freshness==='STALE')state='STALE';
   if(!parts&&freshness==='UNAVAILABLE'&&state!=='LOADING')state='SOURCE_UNAVAILABLE';
   const name=chains[index][2],reason=item?.state===state?item?.reasonCode:null;
   const description=Object.hasOwn(reasons,reason)?reasons[reason]:messages[state]?.[1];
   const content=parts||[node('small',name,'pulse-owner'),node('h4',messages[state][0]),node('p',description)];
   if(!parts&&category==='RISK_ALERT'&&state!=='LOADING')content.push(node('p','Coverage is limited to reviewed sources.'));
   card.dataset.pulseState=state;
   if(state==='LOADING')card.setAttribute('aria-busy','true');else card.removeAttribute('aria-busy');
   const label=node('span'),icon=node('span',categoryIcons[slot],'v8-pulse-icon');icon.setAttribute('aria-hidden','true');
   label.append(icon,node('span',category));
   const children=[label,...content],art=card.querySelector(':scope > img[aria-hidden="true"]');
   if(art)children.push(art);
   if(children.length!==card.children.length||children.some((child,i)=>!child.isEqualNode(card.children[i])))card.replaceChildren(...children);
  }
  sizes();
 }
 function validateSnapshot(value,index,now){
  const [chain,chainId]=chains[index];
  if(value?.ok!==true||value.projectSchemaVersion!==2||value.chain!==chain||value.chainId!==chainId||
    !Object.hasOwn(titles,value.freshness)||!Array.isArray(value.projectCards)||value.projectCards.length!==3||
    value.projectCards.some((item,i)=>item?.category!==categories[i]))throw Error('Invalid Pulse category response');
  const checked=instant(value.checkedAt),success=instant(value.lastSuccessfulAt),expires=instant(value.expiresAt);
  if((value.checkedAt!==null&&(!Number.isFinite(checked)||checked>now+60000))||
    (value.lastSuccessfulAt!==null&&(!Number.isFinite(success)||!Number.isFinite(checked)||success>checked))||
    (value.expiresAt!==null&&(!Number.isFinite(expires)||expires>checked+45*60000)))throw Error('Invalid Pulse source check times');
  if((value.freshness==='FRESH'||value.freshness==='PARTIAL')&&(!Number.isFinite(expires)||!Number.isFinite(checked)))throw Error('Missing Pulse expiry');
  return expires;
 }
 function schedule(){
  clearTimeout(timer);
  if(!projectsMode||document.hidden)return;
  const state=data[active];
  if(request?.index===active&&!state.expiresAt)return;
  const next=request?.index===active?state.expiresAt:Math.min(state.nextAt,state.expiresAt||Infinity);
  timer=setTimeout(loadProjects,Math.max(0,next-Date.now()));
 }
 function cancelRequest(){clearTimeout(timer);request?.controller.abort();request=null;}
 async function loadProjects(){
  if(!projectsMode||document.hidden)return;
  const index=active,state=data[index],now=Date.now();
  if(state.expiresAt&&state.expiresAt<=now){
   state.expiresAt=0;
   renderProjects(index,{freshness:'STALE',lastSuccessfulAt:state.lastSuccessfulAt},'STALE');
  }
  if(request||state.nextAt>now){schedule();return;}
  const controller=new AbortController(),task={index,controller};request=task;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  state.nextAt=now+RETRY_MS;
  if(!state.expiresAt&&state.failures===0)renderProjects(index,{},'LOADING');
  let retryAfter=0;
  schedule();
  try{
   const response=await fetch('/api/pulse?view=projects&chain='+chains[index][0],{cache:'no-store',signal});
   if(!response.ok){
    if(response.status===429){
     const header=response.headers.get('retry-after');
     retryAfter=header&&/^\d+$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-Date.now())||0;
    }
    throw Error('Pulse sources unavailable');
   }
   const value=await response.json();
   if(request!==task)return;
   const completedAt=Date.now(),expires=validateSnapshot(value,index,completedAt);
   state.lastSuccessfulAt=value.lastSuccessfulAt;
   if(value.freshness==='UNAVAILABLE'||value.freshness==='STALE'||expires<=completedAt){
    state.expiresAt=0;
    renderProjects(index,{...value,freshness:value.freshness==='UNAVAILABLE'?'UNAVAILABLE':'STALE'});
    state.nextAt=completedAt+Math.min(POLL_MS,RETRY_MS*2**Math.min(state.failures++,4));
   }else{
    state.failures=0;
    state.expiresAt=expires;
    state.nextAt=completedAt+POLL_MS;
    renderProjects(index,value);
   }
  }catch{
   if(request!==task)return;
   state.expiresAt=0;
   state.nextAt=Date.now()+Math.max(Math.min(MAX_RETRY_AFTER_MS,retryAfter),Math.min(POLL_MS,RETRY_MS*2**Math.min(state.failures++,4)));
   renderProjects(index,{lastSuccessfulAt:state.lastSuccessfulAt});
  }finally{
   if(request===task){request=null;schedule();}
  }
 }
 function skeleton(panel,name){
  const eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent='VERIFIED '+name.toUpperCase()+' SIGNAL';
  const head=document.createElement('div');head.className='head';const title=document.createElement('h3'),desc=document.createElement('p');const y=document.createElement('span');y.className='arcy-wordmark-y';y.textContent='Y';title.append(document.createTextNode('ARC'),y,document.createTextNode(' '+name.toUpperCase()+' PULSE'));desc.textContent='Latest dated announcements, useful ecosystem links and independently inspectable sources.';head.append(title,desc);
  const grid=document.createElement('div');grid.className='pulse-grid';
  for(const[cls,label]of fallback){const card=document.createElement('article');card.className='pulse-card '+cls;const heading=document.createElement('span'),owner=document.createElement('small'),h=document.createElement('h4'),p=document.createElement('p'),source=document.createElement('div');heading.textContent=label;owner.className='pulse-owner';owner.textContent=name.toUpperCase()+' · LOADING';h.textContent='Loading verified research…';p.textContent='Fetching the latest signed or first-party reviewed edition.';source.className='pulse-source-placeholder';source.textContent='Sources loading';card.dataset.pulseState='loading';card.setAttribute('aria-busy','true');card.append(heading,owner,h,p,source);grid.append(card);}
  const take=document.createElement('div');take.className='pulse-take';const label=document.createElement('b'),text=document.createElement('p'),small=document.createElement('small');label.textContent='🦉 ARCY TAKE';text.textContent='Loading the latest verified edition…';small.textContent='No hype. Just signal. • arcyusdc.xyz';take.append(label,text,small);panel.append(eyebrow,head,grid,take);
 }
 skeleton(panels[1],'Ethereum');skeleton(panels[2],'Robinhood Chain');
 if(projectsMode){
  panels.forEach((panel,index)=>{
   const grid=panel.querySelector('.pulse-grid');
   grid.replaceChildren(...categoryStyles.map(cls=>node('article',null,'pulse-card pulse-project-card '+cls)));
   renderProjects(index,{},'LOADING');
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelRequest();else loadProjects();});
  addEventListener('pagehide',cancelRequest);
  addEventListener('pageshow',event=>{if(event.persisted)loadProjects();});
 }
 // Honest failure state: a request that failed is UNAVAILABLE, never "not connected" and never substituted news.
 function unavailable(panel,name){
  if(!panel||panel.dataset.pulsePublication==='published'||(!projectsMode&&!panel.querySelector('.pulse-card[data-pulse-state="loading"]')))return;
  if(!projectsMode)for(const card of panel.querySelectorAll('.pulse-card[data-pulse-state="loading"]')){card.dataset.pulseState='unavailable';card.removeAttribute('aria-busy');card.querySelector('.pulse-owner').textContent=name.toUpperCase()+' · SOURCE STATUS';card.querySelector('h4').textContent='Pulse temporarily unavailable';card.querySelector('p').textContent='The verified edition could not be loaded. No news has been substituted.';card.querySelector('.pulse-source-placeholder').textContent='SOURCE STATUS · NOT A NEWS ITEM';}
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
   panel.dataset.pulsePublication='published';
   panel.querySelector('.pulse-take p').textContent=value.take;
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
 function select(index,focus=false){if(index===active){if(focus)buttons[index].focus();loadProjects();return;}const direction=index>active?1:-1;animation?.cancel();cancelRequest();active=index;
  panels.forEach((panel,i)=>{panel.inert=i!==index;panel.setAttribute('aria-hidden',String(i!==index));buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});
  loadProjects();
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
