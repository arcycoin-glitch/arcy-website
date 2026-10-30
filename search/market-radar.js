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
 researchBtn.setAttribute('aria-controls','tokenDetail');
 radarBtn.setAttribute('aria-controls','marketRadarPanel');
 const panel=el('section','arcy-radar-panel');
 panel.id='marketRadarPanel';panel.hidden=true;
 panel.setAttribute('aria-label','Market Radar');
 const hero=el('header','arcy-radar-hero');
 const title=el('h2','','Market Radar');
 const subtitle=el('p','arcy-radar-intro','Zincirlerde öne çıkan tokenlar · Doğrulanabilir fiyat ve 24 saatlik hacim · Eksik veriler gizlenmez');
 const kicker=el('span','arcy-radar-hero-kicker','RESEARCH FIRST · NO HYPE');
 hero.append(title,subtitle,kicker);
 const chainNav=el('div','arcy-radar-networks');
 chainNav.setAttribute('role','group');chainNav.setAttribute('aria-label','Market Radar network');
 const chains=[['pons','Pons Launch'],['arc','Arc'],['ethereum','Ethereum'],['robinhood','Robinhood']];
 const CHAIN_ID={arc:5042,ethereum:1,robinhood:4663,pons:4663},TOKEN_NET={arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'robinhood'};
 const buttons=new Map();
 for(const [id,name] of chains){
  const button=el('button','arcy-radar-network');
  button.translate=false;
  button.type='button';button.dataset.network=id;
  button.setAttribute('aria-label',name+' ağına geç');
  const mark=el('span','arcy-radar-chain-logo arcy-radar-chain-logo-'+id);mark.setAttribute('aria-hidden','true');
  mark.textContent={pons:'P',arc:'◈',ethereum:'◆',robinhood:'R'}[id];
  // Reuse the three network logos already shipped with ARCY Search.
  const logoSrc={arc:'/search/assets/arc-network-mark.svg',ethereum:'/search/assets/ethereum-mark.svg',robinhood:'/search/assets/robinhood-chain-mark.svg'}[id];
  const networkIcon=el('span','arcy-radar-network-icon');
  if(logoSrc){
   const img=el('img','arcy-radar-network-logo');
   img.src=logoSrc;img.alt='';img.width=38;img.height=38;img.loading='lazy';img.decoding='async';
   img.addEventListener('error',()=>{img.remove();networkIcon.append(mark);},{once:true});
   networkIcon.append(img);
  }else{mark.textContent='P';networkIcon.append(mark);}
  const networkCopy=el('span','arcy-radar-network-copy');
  const networkName=el('strong','arcy-radar-network-name',name);
  const networkSub=el('small','arcy-radar-network-sub',{
   pons:'Launchpad · Chain 4663',
   arc:'Mainnet · 5042',
   ethereum:'Mainnet · 1',
   robinhood:'Chain · 4663'
  }[id]);
  networkCopy.append(networkName,networkSub);
  const networkArrow=el('span','arcy-radar-network-arrow','›');networkArrow.setAttribute('aria-hidden','true');
  button.append(networkIcon,networkCopy,networkArrow);
  chainNav.append(button);buttons.set(id,button);
 }
 const overview=el('div','arcy-radar-overview');overview.setAttribute('aria-label','Network market overview');
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
 const foot=el('p','arcy-radar-disclaimer','');
 const FOOT={default:'Ranked by the single largest observed pool for each base token, not total token volume across the chain. Values marked Cross-checked agree between two independent indexers; this is not an onchain proof. Discovery, not an investment recommendation.',pons:'Pons Launch lists only tokens confirmed as launched by the official Pons factory contracts on Robinhood Chain (onchain read), found among the newest and most active pools; tokens still on the bonding curve are not covered and the list is not exhaustive. Discovery, not an investment recommendation.'};
 foot.textContent=FOOT.default;
 const credit=el('p','arcy-radar-credit-row');
 panel.append(hero,chainNav,overview,status,rows,pager,foot,credit);
 detail.prepend(panel);detail.prepend(switcher);
 // Keep both views discoverable immediately. Radar remains disabled until an
 // approved API response supplies real source-backed data (no empty public radar).
 switcher.hidden=false;
 radarBtn.disabled=true;
 radarBtn.title='Checking verified Radar availability…';
 let selected='robinhood',active='research',page=0,sequence=0,items=[],loadedNetwork=null;
 const USD=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
 const PRICE=new Intl.NumberFormat('en-US',{maximumSignificantDigits:5});
 const PCT=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1,signDisplay:'exceptZero'});
 const money=n=>typeof n==='number'&&Number.isFinite(n)?USD.format(n):'—';
 const price=n=>typeof n==='number'&&Number.isFinite(n)?'$'+PRICE.format(n):'—';
 const pct=n=>typeof n==='number'&&Number.isFinite(n)?PCT.format(n)+'%':'—';
 const NV='N/A';
 const networkTheme={arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'pons'};
 const icon={arc:'',ethereum:'',robinhood:'',pons:''};
 const overviewData=new Map();
 let expandedNetwork=null;
 function renderOverview(network,data){
  const card=overview.querySelector('[data-overview="'+network+'"]');
  if(!card)return;
  const list=card.querySelector('.arcy-radar-overview-list');
  list.replaceChildren();
  const headings=el('div','arcy-radar-overview-columns');
  for(const text of ['Token','Fiyat (USD)','24s Değişim','24s Hacim (USD)','']){
   headings.append(el('span','',text));
  }
  list.append(headings);
  if(data?.ok===true&&Array.isArray(data.tokens))overviewData.set(network,data);
  const tokens=Array.isArray(data?.tokens)?data.tokens.slice(0,expandedNetwork===network?10:5):[];
  const total=card.querySelector('.arcy-radar-overview-count');
  const allCount=Array.isArray(data?.tokens)?data.tokens.length:0;
  const lastUpdated=card.querySelector('.arcy-radar-overview-updated');
  const freshness=card.querySelector('.arcy-radar-overview-freshness');
  const hasData=data?.ok===true&&Array.isArray(data?.tokens)&&allCount>0;
  const stamp=Date.parse(data?.asOf||'');
  lastUpdated.textContent=hasData&&Number.isFinite(stamp)?'Son veri: '+new Date(stamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):'Güncel veri doğrulanamadı';
  freshness.textContent=hasData?(data.freshness==='STALE'?'ÖNBELLEK':'DOĞRULANDI'):'VERİ BEKLENİYOR';
  freshness.classList.toggle('is-stale',!hasData||data.freshness==='STALE');
  total.textContent=hasData?allCount+' gözlemlenen token · Veriler yalnızca kaynakların döndürdüğü havuz ve tokenlarla sınırlıdır':'Bu ağda doğrulanmış token listesi henüz alınamadı';
  for(const [index,item] of tokens.entries()){
   const validAddress=typeof item.address==='string'&&/^0x[0-9a-f]{40}$/i.test(item.address)&&!/^0x0{40}$/i.test(item.address);
   const row=el(validAddress?'a':'div','arcy-radar-overview-token');
   if(validAddress){
    row.href='/search/token/'+TOKEN_NET[network]+'/'+item.address;
    row.setAttribute('aria-label','Open '+(item.symbol||'token')+' in ARCY Search');
    row.title='Research token in ARCY Search';
   }
   const identity=el('span','arcy-radar-overview-symbol');identity.translate=false;
   const tokenCopy=el('span','arcy-radar-overview-token-copy');
   const symbol=el('strong','arcy-radar-overview-token-ticker',item.symbol||'—');
   const displayName=el('small','arcy-radar-overview-token-name',item.name&&item.name!==item.symbol?item.name:(validAddress?item.address.slice(0,7)+'…'+item.address.slice(-4):'Native asset'));
   tokenCopy.append(symbol,displayName);
   const volume=el('span','arcy-radar-overview-volume',fieldOk(item,'volume24hUsd')?money(item.volume24hUsd):'N/A');
   const priceLabel=el('span','arcy-radar-overview-price',fieldOk(item,'priceUsd')?price(item.priceUsd):'N/A');
   const change=el('span','arcy-radar-overview-change',fieldOk(item,'change24hPct')?pct(item.change24hPct):'—');
   if(fieldOk(item,'change24hPct'))change.classList.add(item.change24hPct>=0?'positive':'negative');
   const arrow=el('span','arcy-radar-overview-token-arrow',validAddress?'›':'');arrow.setAttribute('aria-hidden','true');
   const rank=el('span','arcy-radar-overview-rank',String(Number.isInteger(item.rank)?item.rank:index+1));
   if(index<3)rank.classList.add('is-top-'+(index+1));
   const logoHosts=new Set(['coin-images.coingecko.com','assets.coingecko.com','assets.geckoterminal.com','cdn.dexscreener.com','dd.dexscreener.com']);
   let logoUrl=null;
   try{const candidate=new URL(item.logo?.url);if(candidate.protocol==='https:'&&logoHosts.has(candidate.hostname))logoUrl=candidate.href;}catch{}
   const logoWrap=el('span','arcy-radar-overview-logo-wrap');
   if(logoUrl){
    const logo=el('img','arcy-radar-overview-token-logo');
    logo.src=logoUrl;logo.alt='';logo.width=34;logo.height=34;logo.loading='lazy';logo.decoding='async';logo.referrerPolicy='no-referrer';
    logo.addEventListener('error',()=>{logo.remove();logoWrap.classList.add('is-placeholder');logoWrap.textContent='•';},{once:true});
    logoWrap.append(logo);
   }else{logoWrap.classList.add('is-placeholder');logoWrap.textContent='•';}
   identity.append(rank,logoWrap,tokenCopy);
   const scope=item.fields?.volume24hUsd?.scope;
   volume.title=scope==='TOKEN'?'Token genelindeki 24 saatlik hacim':scope==='POOL'?'Gözlemlenen havuzun 24 saatlik hacmi':'Sağlayıcının bildirdiği 24 saatlik hacim';
   row.append(identity,priceLabel,change,volume,arrow);list.append(row);
  }
  if(!tokens.length)list.append(el('p','arcy-radar-overview-empty',network==='pons'?'Şu anda bu veri penceresinde factory ile doğrulanmış Pons lansmanı bulunamadı.':'Bu ağ için doğrulanmış sıralama şu anda alınamıyor.'));
 }
 for(const [id,name] of chains){
  const card=el('section','arcy-radar-overview-card arcy-radar-overview-'+networkTheme[id]);
  card.hidden=id!=='pons';
  card.dataset.overview=id;
  const head=el('header','arcy-radar-overview-head');
  const mark=el('span','arcy-radar-overview-mark');mark.setAttribute('aria-hidden','true');
  const markLogo={arc:'/search/assets/arc-network-mark.svg',ethereum:'/search/assets/ethereum-mark.svg',robinhood:'/search/assets/robinhood-chain-mark.svg'}[id];
  if(markLogo){
   const img=el('img','arcy-radar-overview-chain-image');img.alt='';img.src=markLogo;img.width=50;img.height=50;img.loading='lazy';
   img.addEventListener('error',()=>{img.remove();mark.textContent=name.slice(0,1);},{once:true});
   mark.append(img);
  }else mark.textContent='P';
  const headingCopy=el('span','arcy-radar-overview-heading-copy');
  const label=el('strong','arcy-radar-overview-heading-name',name);label.translate=false;
  const description=el('small','arcy-radar-overview-description',{
   pons:'Robinhood Chain üzerindeki doğrulanmış Pons lansmanları',
   arc:'Arc Mainnet üzerindeki gözlemlenen tokenlar',
   ethereum:'Ethereum ana ağında gözlemlenen tokenlar',
   robinhood:'Robinhood Chain üzerindeki gözlemlenen tokenlar'
  }[id]);
  headingCopy.append(label,description);
  const headerMeta=el('span','arcy-radar-overview-header-meta');
  const freshness=el('span','arcy-radar-overview-freshness','VERİ BEKLENİYOR');
  const updated=el('small','arcy-radar-overview-updated','Güncel veri bekleniyor');
  headerMeta.append(freshness,updated);
  head.append(mark,headingCopy,headerMeta);
  const count=el('p','arcy-radar-overview-count','Kaynaklar kontrol ediliyor…');
  const list=el('div','arcy-radar-overview-list');
  const action=el('button','arcy-radar-overview-action','Tümünü Gör →');
  action.type='button';action.addEventListener('click',()=>{
   expandedNetwork=expandedNetwork===id?null:id;
   for(const [key,data] of overviewData)renderOverview(key,data);
   for(const node of overview.children)node.classList.toggle('is-expanded',node.dataset.overview===expandedNetwork);
   action.setAttribute('aria-expanded',String(expandedNetwork===id));
   for(const other of overview.querySelectorAll('.arcy-radar-overview-action'))other.textContent=other.closest('.arcy-radar-overview-card')?.dataset.overview===expandedNetwork?'Daha Az Göster ↑':'Tümünü Gör →';
  });
  action.setAttribute('aria-expanded','false');card.append(head,count,list,action);overview.append(card);
 }

 // Network headings control ONE full-width premium card at a time.
 function selectNetwork(id){
  selected=id;
  expandedNetwork=null;
  for(const [key,btn] of buttons){btn.setAttribute('aria-pressed',String(key===id));}
  for(const card of overview.children){
   const key=card.dataset.overview;
   card.hidden=key!==id;
   card.classList.remove('is-expanded');
   const action=card.querySelector('.arcy-radar-overview-action');
   if(action){action.setAttribute('aria-expanded','false');action.textContent='Tümünü Gör →';}
  }
  for(const [key,data] of overviewData)if(key===id)renderOverview(key,data);
 }
 for(const [id,btn] of buttons)btn.addEventListener('click',()=>selectNetwork(id));
 selectNetwork('robinhood');
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
 function render(){
  rows.replaceChildren();
  const start=page*5;
  const shown=items.slice(start,start+5);
  const dupes=new Map();for(const it of items){const k=String(it.symbol).toLowerCase();dupes.set(k,(dupes.get(k)||0)+1);}
  for(const item of shown){
   const native=/^0x0{40}$/i.test(item.address); // provider lists native ETH under the zero address: no contract to research
   const link=el(native?'div':'a','arcy-radar-row');
   if(!native)link.href='/search/token/'+TOKEN_NET[selected]+'/'+item.address;
   if(!native)link.setAttribute('aria-label','Research '+item.symbol+' on '+chains.find(x=>x[0]===selected)[1]);
   const rank=el('span','arcy-radar-rank',String(item.rank));
   const ticker=el('span','arcy-radar-ticker',item.symbol);ticker.translate=false;
   const name=el('span','arcy-radar-token-name',item.name);name.translate=false;
   const identity=el('span','arcy-radar-identity');identity.append(ticker,name);
   const short=el('span','arcy-radar-secondary',native?'native ETH · no contract':item.address.slice(0,6)+'…'+item.address.slice(-4));short.translate=false;identity.append(short);
   const stats=el('span','arcy-radar-stat-block');
   const volume=el('span','arcy-radar-primary',fieldOk(item,'volume24hUsd')?money(item.volume24hUsd):NV+' · NOT VERIFIED');
   const small=el('span','arcy-radar-secondary','Price '+(fieldOk(item,'priceUsd')?price(item.priceUsd):NV)+' · Liq '+(fieldOk(item,'liquidityUsd')?money(item.liquidityUsd):NV)+(selected==='pons'?' · Launched '+(fieldOk(item,'poolCreatedAt')?ago(item.poolCreatedAt):NV):''));
   const st=item.fields&&item.fields.volume24hUsd?item.fields.volume24hUsd.status:'NOT_VERIFIED',b=BADGE[st]||BADGE.NOT_VERIFIED;
   const badges=el('span','arcy-radar-badge arcy-radar-badge-'+b[1],b[0]);
   const extra=[];
   if(selected==='pons'&&item.launch&&item.launch.status==='ONCHAIN_VERIFIED')extra.push('✓ Onchain launch'+(item.graduation&&item.graduation.graduated?' · Graduated':' · Bonding'));
   const onchain=extra.length?el('span','arcy-radar-secondary',extra.join(' · ')):null;
   const warn=[];
   if((dupes.get(String(item.symbol).toLowerCase())||0)>1)warn.push('⚠ Same ticker as another listed token — check the contract');
   if(fieldOk(item,'volume24hUsd')&&fieldOk(item,'liquidityUsd')&&item.liquidityUsd>0&&item.volume24hUsd/item.liquidityUsd>100)warn.push('⚠ Volume far above liquidity');
   stats.append(volume,small,badges);if(onchain)stats.append(onchain);
   for(const w of warn)stats.append(el('span','arcy-radar-warn',w));
   const change=el('span','arcy-radar-change',fieldOk(item,'change24hPct')?pct(item.change24hPct):NV);
   if(fieldOk(item,'change24hPct')&&typeof item.change24hPct==='number')change.classList.add(item.change24hPct>=0?'positive':'negative');
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
 // Keep the start of the newly selected view visible after its content height changes.
 function moveToViewStart(){
  if(detail.hidden)return;
  const top=detail.getBoundingClientRect().top+window.scrollY;
  window.scrollTo({top:Math.max(0,Math.round(top-8)),behavior:'instant'});
 }
 researchBtn.addEventListener('click',()=>{setView('research');moveToViewStart();});
 radarBtn.addEventListener('click',()=>{setView('radar');moveToViewStart();});
 // Network headings are handled by selectNetwork; no duplicate token-wall request.
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
     if(!response.ok){renderOverview(network,null);return false;}
     const data=await response.json();
     renderOverview(network,data?.ok===true?data:null);
     return data?.ok===true&&data.version===2&&data.network===network&&Array.isArray(data.tokens)&&
      data.tokens.length>0&&data.tokens.every((item,i)=>item?.rank===i+1&&/^0x[0-9a-f]{40}$/i.test(item.address));
    }catch{
     // A single timed-out source must not hide another verified network.
     renderOverview(network,null);
     return false;
    }finally{clearTimeout(timer)}
   }));
   if(all.some(Boolean)){radarBtn.disabled=false;radarBtn.removeAttribute('title');}
   else radarBtn.title='Market Radar is unavailable until verified data is ready';
  }catch{
   radarBtn.title='Market Radar is unavailable until verified data is ready';
  } // Source/license failures must not disturb the existing token research.
 }
 void verifyPublicReadiness();
})();
