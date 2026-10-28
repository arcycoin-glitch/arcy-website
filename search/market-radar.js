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
 const subtitle=el('p','arcy-radar-intro','Most active observed DEX pools · 24H USD volume · Source-limited');
 const chainNav=el('div','arcy-radar-networks');
 chainNav.setAttribute('role','group');chainNav.setAttribute('aria-label','Market Radar network');
 const chains=[['arc','Arc'],['ethereum','Ethereum'],['robinhood','Robinhood']];
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
 const foot=el('p','arcy-radar-disclaimer',
  'Source: CoinGecko Onchain · Ranked by the single largest observed pool for each base token, not total token volume across the chain. This is discovery, not an investment recommendation.');
 const credit=el('a','arcy-radar-credit','Data powered by CoinGecko ↗');
 credit.href='https://www.coingecko.com/en/api';credit.target='_blank';credit.rel='noopener noreferrer';
 panel.append(title,subtitle,chainNav,status,rows,pager,foot,credit);
 detail.prepend(panel);detail.prepend(switcher);
 let selected='arc',active='research',page=0,sequence=0,items=[],loadedNetwork=null;
 const USD=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
 const PRICE=new Intl.NumberFormat('en-US',{maximumSignificantDigits:5});
 const PCT=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1,signDisplay:'exceptZero'});
 const money=n=>typeof n==='number'&&Number.isFinite(n)?USD.format(n):'—';
 const price=n=>typeof n==='number'&&Number.isFinite(n)?'$'+PRICE.format(n):'—';
 const pct=n=>typeof n==='number'&&Number.isFinite(n)?PCT.format(n)+'%':'—';
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
   link.setAttribute('aria-label','Research '+item.symbol+' on '+chains.find(x=>x[0]===item.network)[1]);
   const rank=el('span','arcy-radar-rank',String(item.rank));
   const ticker=el('span','arcy-radar-ticker',item.symbol);
   const name=el('span','arcy-radar-token-name',item.name);
   const identity=el('span','arcy-radar-identity');identity.append(ticker,name);
   const stats=el('span','arcy-radar-stat-block');
   const volume=el('span','arcy-radar-primary',money(item.volume24hUsd));
   const small=el('span','arcy-radar-secondary','Price '+price(item.priceUsd)+' · Liq '+money(item.liquidityUsd));
   stats.append(volume,small);
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
  status.textContent='Checking licensed source for '+chains.find(x=>x[0]===network)[1]+'…';
  try{
   const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),12000);
   let response,body;
   try{
    response=await fetch('/api/market-radar?network='+encodeURIComponent(network),{signal:ctl.signal,cache:'no-store',headers:{accept:'application/json'}});
    body=await response.json();
   }finally{clearTimeout(timeout)}
   if(mine!==sequence)return;
   if(!response.ok||body?.ok!==true||body.network!==network||
      !Array.isArray(body.tokens)||body.tokens.length>10||
      body.chainId!==({arc:5042,ethereum:1,robinhood:4663})[network])
    throw Error(body?.error==='RADAR_NOT_CONFIGURED'?'Live radar is awaiting an approved data license.':'Verified ranking is currently unavailable.');
   items=body.tokens.filter(item=>item?.network===network&&/^0x[0-9a-f]{40}$/i.test(item.address)&&
      Number.isFinite(item.volume24hUsd)&&item.volume24hUsd>0);
   loadedNetwork=network;
   status.textContent=items.length+' verified candidates · '+body.poolsInspected+' provider-returned pools inspected · Checked '+new Date(body.asOf).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
   if(!items.length)status.textContent='No verified ranking returned for this network.';
   render();
  }catch(e){
   if(mine!==sequence)return;
   items=[];loadedNetwork=null;render();
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
})();
