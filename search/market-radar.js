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
 const subtitle=el('p','arcy-radar-intro','Most active observed DEX pools · 24H USD volume · External sources only · Missing fields show NOT VERIFIED');
 const chainNav=el('div','arcy-radar-networks');
 chainNav.setAttribute('role','group');chainNav.setAttribute('aria-label','Market Radar network');
 const chains=[['arc','Arc'],['ethereum','Ethereum'],['robinhood','Robinhood'],['pons','Pons Launch']];
 const CHAIN_ID={arc:5042,ethereum:1,robinhood:4663,pons:4663},TOKEN_NET={arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'robinhood'};
 const buttons=new Map();
 for(const [id,name] of chains){
  const button=el('button','arcy-radar-network',name);
  button.translate=false; // network and launchpad names must not be machine-translated ("Arc" -> "Ark")
  button.type='button';button.dataset.network=id;
  chainNav.append(button);buttons.set(id,button);
 }
 const status=el('p','arcy-radar-status','Select Market Radar to view volume-ranked tokens.');
 status.id='marketRadarStatus';status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 const rows=el('div','arcy-radar-rows');rows.id='marketRadarRows';
 const legend=el('p','arcy-radar-legend');
 const pager=el('div','arcy-radar-pager');
 const prev=el('button','arcy-radar-page','← Previous');
 const current=el('span','arcy-radar-page-status');
 const next=el('button','arcy-radar-page','Next →');
 for(const b of [prev,next])b.type='button';
 pager.append(prev,current,next);
 const foot=el('p','arcy-radar-disclaimer','');
 const FOOT={default:'Ranked by the single largest observed pool for each base token, not total token volume across the chain. Values marked Cross-checked agree between two independent indexers; this is not an onchain proof. Discovery, not an investment recommendation.',pons:'Pons Launch lists only tokens confirmed as launched by the official Pons factory contracts on Robinhood Chain (onchain read), found among the newest and most active pools; tokens still on the bonding curve are not covered and the list is not exhaustive. Discovery, not an investment recommendation.'};
 foot.textContent=FOOT.default;
 const credit=el('p','arcy-radar-credit-row');
 panel.append(title,subtitle,chainNav,status,rows,legend,pager,foot,credit);
 detail.prepend(panel);detail.prepend(switcher);
 // Never advertise an empty Radar as a completed public feature.
 // Activate the switcher when at least one section returns source-backed tokens; sections without data say so honestly.
 switcher.hidden=true;
 let selected='arc',active='research',page=0,sequence=0,items=[],loadedNetwork=null;
 const USD=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
 const PRICE=new Intl.NumberFormat('en-US',{maximumSignificantDigits:5});
 const PCT=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1,signDisplay:'exceptZero'});
 const money=n=>typeof n==='number'&&Number.isFinite(n)?USD.format(n):'—';
 const price=n=>typeof n==='number'&&Number.isFinite(n)?'$'+PRICE.format(n):'—';
 const pct=n=>typeof n==='number'&&Number.isFinite(n)?PCT.format(n)+'%':'—';
 const NV='N/A';
 const BADGE={CROSS_VERIFIED:['✓ Cross-checked','verified'],SOURCE_REPORTED:['Source-reported','reported'],NOT_VERIFIED:['NOT VERIFIED','unverified'],ONCHAIN_VERIFIED:['✓ Onchain','verified']};
 const fieldOk=(item,f)=>item.fields&&item.fields[f]&&item.fields[f].status!=='NOT_VERIFIED'&&item[f]!==null&&item[f]!==undefined;
 const ago=iso=>{const t=Date.parse(iso);if(!Number.isFinite(t))return NV;const m=Math.max(0,Math.round((Date.now()-t)/60000));return m<60?m+'m ago':m<2880?Math.round(m/60)+'h ago':Math.round(m/1440)+'d ago';};
 const safeUrl=u=>typeof u==='string'&&/^https:\/\/[^\s]+$/.test(u)?u:null;
 function setView(view){
  active=view;
  const radar=view==='radar';
  detail.classList.toggle('arcy-radar-active',radar);
  panel.hidden=!radar;
  researchBtn.setAttribute('aria-pressed',String(!radar));
  radarBtn.setAttribute('aria-pressed',String(radar));
  if(radar&&!loadedNetwork)void load(selected);
 }
 const LOGO_HOSTS=['coin-images.coingecko.com','assets.coingecko.com','assets.geckoterminal.com','cdn.dexscreener.com','dd.dexscreener.com'];
 const safeLogo=l=>{try{const u=new URL(l&&l.url);return u.protocol==='https:'&&LOGO_HOSTS.includes(u.hostname)?u.href:null;}catch{return null;}};
 const REASON={SOURCES_DISAGREE:'providers disagree',MARKET_CAP_NOT_PROVIDED:'not published by sources (FDV is a different measure and is not substituted)',FIELD_NOT_PROVIDED:'not provided by sources'};
 const DOT={CROSS_VERIFIED:['verified','Cross-checked: two independent sources agree'],ONCHAIN_VERIFIED:['verified','Read onchain'],SOURCE_REPORTED:['reported','Single source, not cross-checked'],NOT_VERIFIED:['unavailable','Not verified']};
 const FIELD_LABEL={volume24hUsd:'Volume 24H',liquidityUsd:'Liquidity',marketCapUsd:'Market cap',priceUsd:'Price'};
 function chip(item,f,text){
  const info=item.fields&&item.fields[f],st=info&&info.status||'NOT_VERIFIED',ok=fieldOk(item,f);
  const d=DOT[ok?st:'NOT_VERIFIED'],box=el('span','arcy-radar-chip');
  let label=FIELD_LABEL[f];
  if((f==='volume24hUsd'||f==='liquidityUsd')&&info&&info.scope==='POOL')label+=' (pool)';
  const lab=el('span','arcy-radar-chip-label',label),val=el('span','arcy-radar-chip-value'+(ok?'':' is-na'),ok?text:NV);
  const dot=el('span','arcy-radar-dot arcy-radar-dot-'+d[0]);
  box.title=ok?d[1]:(label+': '+(REASON[info&&info.reasonCode]||REASON.FIELD_NOT_PROVIDED));
  const top=el('span','arcy-radar-chip-top');top.append(dot,lab);box.append(top,val);
  return box;
 }
 function logoNode(item){
  const wrap=el('span','arcy-radar-logo'),url=safeLogo(item.logo);
  if(url){
   const img=document.createElement('img');
   img.alt='';img.width=32;img.height=32;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
   img.addEventListener('error',()=>{img.remove();wrap.classList.add('is-empty');},{once:true});
   img.src=url;wrap.append(img);
  }else wrap.classList.add('is-empty');
  return wrap;
 }
 function render(){
  rows.replaceChildren();
  const start=page*5;
  const shown=items.slice(start,start+5);
  const dupes=new Map();for(const it of items){const k=String(it.symbol).toLowerCase();dupes.set(k,(dupes.get(k)||0)+1);}
  const reasons=new Set();
  for(const item of shown){
   const native=/^0x0{40}$/i.test(item.address); // provider lists native ETH under the zero address: no contract to research
   const link=el(native?'div':'a','arcy-radar-row');
   if(!native)link.href='/search/token/'+TOKEN_NET[selected]+'/'+item.address;
   if(!native)link.setAttribute('aria-label','Research '+item.symbol+' on '+chains.find(x=>x[0]===selected)[1]);
   const rank=el('span','arcy-radar-rank',String(item.rank));
   const ticker=el('span','arcy-radar-ticker',item.symbol);ticker.translate=false;
   const name=el('span','arcy-radar-token-name',item.name);name.translate=false;
   const short=el('span','arcy-radar-secondary',native?'native ETH · no contract':item.address.slice(0,6)+'…'+item.address.slice(-4));short.translate=false;
   const identity=el('span','arcy-radar-identity');identity.append(ticker,name,short);
   const metrics=el('span','arcy-radar-metrics');
   metrics.append(chip(item,'volume24hUsd',money(item.volume24hUsd)),chip(item,'liquidityUsd',money(item.liquidityUsd)),chip(item,'marketCapUsd',money(item.marketCapUsd)),chip(item,'priceUsd',price(item.priceUsd)));
   for(const f of ['volume24hUsd','liquidityUsd','marketCapUsd','priceUsd'])if(!fieldOk(item,f)){const c=item.fields&&item.fields[f]&&item.fields[f].reasonCode;reasons.add(FIELD_LABEL[f]+' — '+(REASON[c]||REASON.FIELD_NOT_PROVIDED));}
   const notes=[];
   if(selected==='pons'){
    if(item.launch&&item.launch.status==='ONCHAIN_VERIFIED')notes.push('✓ Onchain launch'+(item.graduation&&item.graduation.graduated?' · Graduated':' · Bonding'));
    notes.push('Pool age '+(fieldOk(item,'poolCreatedAt')?ago(item.poolCreatedAt):NV));
   }
   if((dupes.get(String(item.symbol).toLowerCase())||0)>1)notes.push('⚠ Same ticker as another listed token — check the contract');
   if(fieldOk(item,'volume24hUsd')&&fieldOk(item,'liquidityUsd')&&item.liquidityUsd>0&&item.volume24hUsd/item.liquidityUsd>100)notes.push('⚠ Volume far above liquidity');
   const change=el('span','arcy-radar-change',fieldOk(item,'change24hPct')?pct(item.change24hPct):NV);
   if(fieldOk(item,'change24hPct')&&typeof item.change24hPct==='number')change.classList.add(item.change24hPct>=0?'positive':'negative');
   link.append(rank,logoNode(item),identity,change,el('span','arcy-radar-arrow',native?'':'›'),metrics);
   if(notes.length)link.append(el('span','arcy-radar-notes',notes.join('  ·  ')));
   rows.append(link);
  }
  legend.replaceChildren();
  if(shown.length){
   const key=el('span','arcy-radar-key');
   for(const [cls,text] of [['verified','Cross-checked'],['reported','Single source'],['unavailable','N/A']]){const k=el('span','arcy-radar-key-item');k.append(el('span','arcy-radar-dot arcy-radar-dot-'+cls),document.createTextNode(text));key.append(k);}
   legend.append(key);
   if(reasons.size)legend.append(el('span','arcy-radar-why','N/A: '+[...reasons].join(' · ')));
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
  foot.textContent=selected==='pons'?FOOT.pons:FOOT.default;
  credit.replaceChildren();
  status.textContent='Checking sources for '+chains.find(x=>x[0]===network)[1]+'…';
  try{
   const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),12000);
   let response,body;
   try{
    response=await fetch('/api/search?action=radar&chain='+encodeURIComponent(network),{signal:ctl.signal,cache:'no-store',headers:{accept:'application/json'}});
    body=await response.json();
   }finally{clearTimeout(timeout)}
   if(mine!==sequence)return;
   if(!response.ok||body?.ok!==true||body.network!==network||
      !Array.isArray(body.tokens)||body.tokens.length>10||
      body.chainId!==CHAIN_ID[network]||body.version!==2)
    throw Error(body?.error==='RADAR_NOT_CONFIGURED'?'Live radar is awaiting an approved data license.':'Verified ranking is currently unavailable.');
   items=body.tokens.filter(item=>/^0x[0-9a-f]{40}$/i.test(item?.address)&&typeof item.symbol==='string'&&typeof item.name==='string'&&item.fields&&typeof item.fields==='object');
   loadedNetwork=network;
   const cov=body.coverage||{};
   status.textContent=items.length+' candidates · '+(cov.poolsInspected??'?')+' provider-returned pools inspected · '+(cov.fieldsNotVerified??0)+' fields NOT VERIFIED · '+(body.freshness==='STALE'?'STALE data from ':'As of ')+new Date(body.asOf).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
   if(!items.length)status.textContent=network==='pons'?'No recent Pons launch confirmed onchain right now.':'No verified ranking returned for this network.';
   for(const a of Array.isArray(body.attribution)?body.attribution:[]){const href=safeUrl(a?.url);if(!href||typeof a.text!=='string')continue;const link=el('a','arcy-radar-credit',a.text.slice(0,80)+' ↗');link.href=href;link.target='_blank';link.rel='noopener noreferrer';credit.append(link,document.createTextNode(' '));}
   render();
  }catch(e){
   if(mine!==sequence)return;
   items=[];loadedNetwork=null;render();
   status.textContent=String(e.message).includes('approved data license')?
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
  try{
   const all=await Promise.all(['arc','ethereum','robinhood','pons'].map(async network=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),9500);
    try{
     const response=await fetch('/api/search?action=radar&chain='+network,{signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'});
     if(!response.ok)return false;
     const data=await response.json();
     return data?.ok===true&&data.version===2&&data.network===network&&Array.isArray(data.tokens)&&
      data.tokens.length>0&&data.tokens.every((item,i)=>item?.rank===i+1&&/^0x[0-9a-f]{40}$/i.test(item.address));
    }finally{clearTimeout(timer)}
   }));
   if(all.some(Boolean))switcher.hidden=false;
  }catch{} // Source/license failures must not disturb the existing token research.
 }
 void verifyPublicReadiness();
})();
