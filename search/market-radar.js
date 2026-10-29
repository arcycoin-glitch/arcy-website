'use strict';
// ARCY SEARCH second-page Market Radar: opt-in, no changes to research report logic.
(()=>{
 const detail=document.getElementById('tokenDetail');
 if(!detail||document.getElementById('marketRadarSwitcher'))return;
 const el=(tag,className,text)=>{
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
 };
 const switcher=el('div','arcy-radar-switcher');
 switcher.id='marketRadarSwitcher';
 switcher.setAttribute('role','group');
 switcher.setAttribute('aria-label','Research view');
 const researchBtn=el('button','arcy-radar-view-button','🔍 Token Research');
 const radarBtn=el('button','arcy-radar-view-button','🔥 Market Radar');
 for(const btn of [researchBtn,radarBtn]){btn.type='button';switcher.append(btn);}
 const panel=el('section','arcy-radar-panel');
 panel.id='marketRadarPanel';panel.hidden=true;
 panel.setAttribute('aria-label','Market Radar');
 const title=el('h2','','🔥 Market Radar');
 const subtitle=el('p','arcy-radar-intro','Most active observed Uniswap v4 pools · 24H USD volume · Source-limited');
 const chainNav=el('div','arcy-radar-networks');
 chainNav.setAttribute('role','group');chainNav.setAttribute('aria-label','Market Radar network');
 const chains=[['arc','Arc'],['ethereum','Ethereum'],['robinhood','Robinhood'],['pons','pons']];
 const CHAIN_IDS={arc:5042,ethereum:1,robinhood:4663,pons:4663};
 const NETWORKS=chains.map(x=>x[0]);
 const FOOT_DEFAULT='Ranked by the single largest observed pool for each token, not total token volume across the chain or all DEXs. Prices and changes are derived from observed swaps, not executable quotes. This is discovery, not an investment recommendation.';
 const FOOT_PONS='pons Launch Radar lists the newest tokens launched through the official pons factories on Robinhood Chain (pons is a launch platform, not a separate blockchain). It is an independent onchain index, not operated or endorsed by pons. Volume and transactions are totals since launch; a new launch is not a quality or safety signal and graduation is not an endorsement. Fields without onchain evidence show N/A. Not investment advice.';
 const buttons=new Map();
 for(const [id,name] of chains){
  const button=el('button','arcy-radar-network',name);
  button.type='button';button.dataset.network=id;
  chainNav.append(button);buttons.set(id,button);
 }
 const status=el('p','arcy-radar-status','Select Market Radar to view volume-ranked tokens.');
 status.id='marketRadarStatus';status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 const rows=el('div','arcy-radar-rows');rows.id='marketRadarRows';
 const pager=el('div','arcy-radar-pager');
 const prev=el('button','arcy-radar-page','← Previous');
 const current=el('span','arcy-radar-page-status');
 const next=el('button','arcy-radar-page','Next →');
 for(const b of [prev,next])b.type='button';
 pager.append(prev,current,next);
 const scope=el('p','arcy-radar-scope','');
 scope.id='marketRadarScope';
 const foot=el('p','arcy-radar-disclaimer',FOOT_DEFAULT);
 const credit=el('a','arcy-radar-credit','');
 credit.hidden=true;credit.target='_blank';credit.rel='noopener noreferrer';
 panel.append(title,subtitle,chainNav,status,scope,rows,pager,foot,credit);
 detail.prepend(panel);detail.prepend(switcher);
 // Never advertise an empty Radar. The switcher appears once at least one network
 // returns verified rows; a network without data says so and never hides the others.
 switcher.hidden=true;
 let selected='arc',active='research',page=0,sequence=0,items=[],loadedNetwork=null;
 const unavailable=new Set();
 const USD=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
 const PRICE=new Intl.NumberFormat('en-US',{maximumSignificantDigits:5});
 const PCT=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1,signDisplay:'exceptZero'});
 const money=n=>typeof n==='number'&&Number.isFinite(n)?USD.format(n):'N/A';
 const price=n=>typeof n==='number'&&Number.isFinite(n)?(n<0.01?'$'+n.toPrecision(3).replace(/\.?0+(e|$)/,'$1'):'$'+PRICE.format(n)):'N/A';
 const short=a=>a.slice(0,6)+'…'+a.slice(-4);
 const safeLogo=u=>typeof u==='string'&&/^\/(?:assets|search\/assets)\/[A-Za-z0-9_\/.-]+$/.test(u)&&!u.includes('..')?u:null;
 const pct=n=>typeof n==='number'&&Number.isFinite(n)?PCT.format(n)+'%':'N/A';
 const validLaunch=item=>item?.network==='pons'&&/^0x[0-9a-f]{40}$/i.test(item.address)&&typeof item.symbol==='string'&&item.symbol&&Number.isFinite(Date.parse(item.launchedAt))&&/^0x[0-9a-f]{64}$/i.test(item.launchTx||'');
 const ago=iso=>{const sec=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(!Number.isFinite(sec))return 'N/A';if(sec<3600)return Math.max(1,Math.round(sec/60))+'m ago';if(sec<172800)return Math.round(sec/3600)+'h ago';return Math.round(sec/86400)+'d ago';};
 function setView(view){
  active=view;
  const radar=view==='radar';
  detail.classList.toggle('arcy-radar-active',radar);
  panel.hidden=!radar;
  researchBtn.setAttribute('aria-pressed',String(!radar));
  radarBtn.setAttribute('aria-pressed',String(radar));
  if(radar&&!loadedNetwork)void load(selected);
 }
 function render(){
  rows.replaceChildren();
  const start=page*5;
  const shown=items.slice(start,start+5);
  for(const item of shown){
   const link=el('a','arcy-radar-row');
   link.href='/search/token/'+item.network+'/'+item.address;
   link.setAttribute('aria-label','Research '+item.symbol+' ('+item.address+') on '+chains.find(x=>x[0]===item.network)[1]);
   const rank=el('span','arcy-radar-rank',String(item.rank));
   const ticker=el('span','arcy-radar-ticker',item.symbol);
   const name=el('span','arcy-radar-token-name',item.name);
   const logoUrl=safeLogo(item.logo);
   let mark;
   if(logoUrl){mark=el('img','arcy-radar-logo');mark.src=logoUrl;mark.alt='';mark.width=22;mark.height=22;mark.loading='lazy';
    mark.addEventListener('error',()=>{const f=el('span','arcy-radar-logo arcy-radar-logo-fallback',String(item.symbol).slice(0,2).toUpperCase());mark.replaceWith(f);},{once:true});}
   else mark=el('span','arcy-radar-logo arcy-radar-logo-fallback',String(item.symbol).slice(0,2).toUpperCase());
   const heading=el('span','arcy-radar-heading');heading.append(mark,ticker);
   const contract=el('span','arcy-radar-contract',short(item.address));
   contract.title=item.address;
   const identity=el('span','arcy-radar-identity');identity.append(heading,name,contract);
   if(item.network==='pons'){
    const stats=el('span','arcy-radar-stat-block');
    const vol=item.fieldStatus?.volumeUsd==='UNAVAILABLE'||!Number.isFinite(item.volumeUsd)?'N/A':money(item.volumeUsd);
    const p=el('span','arcy-radar-primary',vol);
    p.title='Volume since launch'+(vol==='N/A'?' (not verifiable onchain)':'');
    const s1=el('span','arcy-radar-secondary',(Number.isFinite(item.txCount)?item.txCount+' txs':'txs N/A')+' · since launch');
    const s2=el('span','arcy-radar-secondary','Launched '+new Date(item.launchedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · verified');
    stats.append(p,s1,s2);
    const age=el('span','arcy-radar-change',ago(item.launchedAt));age.title='Time since the TokenLaunched event';
    link.href='/search/token/robinhood/'+item.address;
    link.setAttribute('aria-label','Research '+item.symbol+' ('+item.address+') launched on Robinhood Chain via pons');
    link.append(rank,identity,stats,age,el('span','arcy-radar-arrow','›'));
    rows.append(link);continue;
   }
   const stats=el('span','arcy-radar-stat-block');
   const volume=el('span','arcy-radar-primary',money(item.volume24hUsd));
   const small=el('span','arcy-radar-secondary','Price '+price(item.priceUsd)+' · Liq '+money(item.liquidityUsd));
   const venue=el('span','arcy-radar-secondary',(typeof item.dex==='string'?item.dex.slice(0,40):'DEX N/A')+(Number.isFinite(item.swaps24h)?' · '+item.swaps24h+' swaps':''));
   stats.append(volume,small,venue);
   const change=el('span','arcy-radar-change',pct(item.change24hPct));
   if(typeof item.change24hPct==='number')change.classList.add(item.change24hPct>=0?'positive':'negative');
   link.append(rank,identity,stats,change,el('span','arcy-radar-arrow','›'));
   rows.append(link);
  }
  pager.hidden=items.length<=5;
  prev.disabled=page===0;
  next.disabled=start+5>=items.length;
  current.textContent=items.length?'Showing '+(start+1)+'–'+Math.min(start+5,items.length)+' of '+items.length:'';
 }
 async function load(network){
  const mine=++sequence;
  selected=network;page=0;items=[];loadedNetwork=null;
  render();
  for(const [id,btn] of buttons)btn.setAttribute('aria-pressed',String(id===network));
  status.textContent=network==='pons'?'Reading verified pons launch events on Robinhood Chain…':'Reading verified onchain swaps for '+chains.find(x=>x[0]===network)[1]+'…';
  scope.textContent='';credit.hidden=true;
  try{
   const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),58000);
   let response,body;
   try{
    response=await fetch('/api/search?action=radar&chain='+encodeURIComponent(network),{signal:ctl.signal,cache:'no-store',headers:{accept:'application/json'}});
    body=await response.json();
   }finally{clearTimeout(timeout)}
   if(mine!==sequence)return;
   if(!response.ok||body?.ok!==true||body.network!==network||
      !Array.isArray(body.tokens)||body.tokens.length>10||
      body.chainId!==CHAIN_IDS[network])
    throw Error(body?.error==='RADAR_NOT_CONFIGURED'?'Live radar is awaiting an approved data license.':'Verified ranking is currently unavailable.');
   items=(network==='pons'?body.tokens.filter(validLaunch):body.tokens.filter(item=>item?.network===network&&/^0x[0-9a-f]{40}$/i.test(item.address)&&
      typeof item.symbol==='string'&&item.symbol&&Number.isFinite(item.volume24hUsd)&&item.volume24hUsd>0))
      .map((item,i)=>({...item,rank:i+1}));
   loadedNetwork=network;unavailable.delete(network);
   const when=new Date(body.asOf).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
   const cov=body.coverage||{};
   status.textContent=network==='pons'?(items.length?items.length+' newest verified launches · newest first · data as of '+when:'No pons launches observed in the window · data as of '+when):
    items.length?items.length+' of up to 10 verified tokens · '+(cov.poolsResolved??body.poolsInspected)+' pools verified · data as of '+when:'No verified ranking returned for this network.';
   foot.textContent=network==='pons'?FOOT_PONS:FOOT_DEFAULT;
   subtitle.textContent=network==='pons'?'Newest tokens launched via pons on Robinhood Chain · verified launch time · Source-limited':'Most active observed Uniswap v4 pools · 24H USD volume · Source-limited';
   scope.textContent=typeof body.selection==='string'?body.selection.slice(0,420)+(network!=='pons'&&Number.isFinite(cov.swapsIndexed)?' Swaps indexed in the 24h window: '+cov.swapsIndexed+'. Liquidity is N/A (not computed for Uniswap v4).':'')+(typeof cov.scopeNote==='string'?' '+cov.scopeNote.slice(0,260):''):'';
   const credit_=body.attribution;
   if(credit_&&typeof credit_.text==='string'&&/^https:\/\//.test(credit_.url||'')){credit.textContent=credit_.text.slice(0,200)+' ↗';credit.href=credit_.url;credit.hidden=false;}
   render();
  }catch(e){
   if(mine!==sequence)return;
   items=[];loadedNetwork=null;unavailable.add(network);render();
   status.textContent=e.message==='RADAR_NOT_CONFIGURED'||String(e.message).includes('approved data license')?
     'Market Radar is ready for integration. Public data display requires approved source licensing.':
     'Market Radar cannot verify current results for this network. No rankings are guessed.';
  }
 }
 researchBtn.addEventListener('click',()=>setView('research'));
 radarBtn.addEventListener('click',()=>setView('radar'));
 for(const [id,btn] of buttons)btn.addEventListener('click',()=>void load(id));
 prev.addEventListener('click',()=>{if(page>0){page--;render();}});
 next.addEventListener('click',()=>{if((page+1)*5<items.length){page++;render();}});
 setView('research');
 async function verifyPublicReadiness(){
  // Each network is checked independently; one failing chain never hides the others.
  const results=await Promise.all(NETWORKS.map(async network=>{
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),58000);
   try{
    const response=await fetch('/api/search?action=radar&chain='+network,{signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'});
    if(!response.ok)return false;
    const data=await response.json();
    if(network==='pons')return data?.ok===true&&data.network==='pons'&&data.chainId===4663&&Array.isArray(data.tokens)&&data.tokens.length>0&&data.tokens.length<=10&&data.tokens.every(validLaunch);
    return data?.ok===true&&data.network===network&&Array.isArray(data.tokens)&&data.tokens.length>0&&data.tokens.length<=10&&
     data.tokens.every(item=>item?.network===network&&/^0x[0-9a-f]{40}$/i.test(item.address)&&
      typeof item.volume24hUsd==='number'&&Number.isFinite(item.volume24hUsd)&&item.volume24hUsd>0);
   }catch{return false}finally{clearTimeout(timer)}
  }));
  results.forEach((ok,i)=>{if(!ok)unavailable.add(NETWORKS[i]);});
  if(results.some(Boolean)){
   switcher.hidden=false;
   const first=NETWORKS[results.findIndex(Boolean)];
   if(!loadedNetwork&&active!=='radar')selected=first;
  }
 }
 void verifyPublicReadiness();
})();
