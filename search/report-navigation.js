'use strict';
// Live Trading (Final Engine): first report card. Verified on-chain swaps for the exact contract in the URL, from
// GET /api/search?action=trades (existing Search function). Rendering uses textContent only; links are validated https.
// Polling is bounded: only while the report is open and the page is visible, 30 s base, exponential backoff to 5 min.
window.ARCYLiveTrading=(()=>{
 const SVG_NS='http://www.w3.org/2000/svg';
 // Original mark: three candlesticks with a buy (up) and sell (down) arrow, ARCY turquoise palette.
 function icon(size=20){
  const svg=document.createElementNS(SVG_NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));
  svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('lt-icon');
  const parts=[['path',{d:'M5 4v16M12 2v20M19 5v14',stroke:'#4fd8e8','stroke-width':'1.4','stroke-linecap':'round',opacity:'.7'}],
   ['rect',{x:'3.3',y:'8',width:'3.4',height:'7',rx:'.8',fill:'#22d4ff'}],['rect',{x:'10.3',y:'5',width:'3.4',height:'9',rx:'.8',fill:'#0b2a3a',stroke:'#22d4ff','stroke-width':'1.3'}],
   ['rect',{x:'17.3',y:'9',width:'3.4',height:'6',rx:'.8',fill:'#22d4ff'}],
   ['path',{d:'M2.5 21.5l3-3 3 3',stroke:'#2fd38a','stroke-width':'1.6',fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}],
   ['path',{d:'M15.5 18.5l3 3 3-3',stroke:'#ff7b7b','stroke-width':'1.6',fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}]];
  for(const [tag,attrs] of parts){const el=document.createElementNS(SVG_NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);}
  return svg;
 }
 const route=()=>{const m=/^\/search\/token\/(arc|ethereum|robinhood)\/(0x[0-9a-fA-F]{40})\/?$/.exec(location.pathname);return m?{network:m[1],address:m[2].toLowerCase()}:null;};
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const safeUrl=u=>{try{const x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password&&x.href.length<400?x.href:null;}catch{return null;}};
 const short=a=>typeof a==='string'&&a.length>12?a.slice(0,6)+'…'+a.slice(-4):String(a||'');
 const shortWallet=a=>/^0x[0-9a-f]{40}$/i.test(a||'')?'0x…'+a.slice(-4):short(a);
 const amount=v=>{if(v===null||v===undefined||v==='')return '—';const n=Number(v);if(!Number.isFinite(n))return String(v||'—');return n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(2)+'K':n>=1?n.toFixed(2):n.toPrecision(3);};
 // Visible text follows the page language: English (PR #244 wording) by default; Turkish when the page is shown in Turkish
 // (e.g. browser translation sets <html lang="tr">). API status codes are unchanged; data cells are marked translate="no".
 const TEXT={
  en:{title:'Live Trading',status:{LIVE:'LIVE',DELAYED:'DELAYED',NO_RECENT_SWAPS:'NO RECENT SWAPS',COVERAGE_INCOMPLETE:'COVERAGE INCOMPLETE',UNSUPPORTED:'LIMITED COVERAGE',UNAVAILABLE:'UNAVAILABLE',BUSY:'LOADING'},
   reason:{NO_VERIFIED_POOL:'No reviewed pool available for this token.',NO_POOL_CANDIDATES:'No supported pool found for this token.',NO_SWAPS_IN_WINDOW:'No swaps in the scanned verified pools.',
    ACTIVE_POOLS_UNSUPPORTED:'Active pools use DEX contracts not yet reviewed; their trades are not shown.',
    LIVE_TRADES_BUSY:'Trade feed busy. Retrying.',RPC_RATE_LIMITED:'Data provider busy. Retrying.',POOL_SOURCE_UNAVAILABLE:'Pool source unavailable.',RPC_HEAD_UNAVAILABLE:'Chain data unavailable.'},
   usd:{STABLECOIN_QUOTED:'Stablecoin-quoted',ORACLE_PRICED:'Chainlink ETH/USD',ORACLE_PRICED_ETH_REFERENCE:'ETH x Chainlink (Ethereum reference)',USD_NOT_VERIFIED:'USD not verified'},
   side:{BUY:'Buy',SELL:'Sell',SWAP:'Swap'},cols:['Trade','Wallet','Amount','Time'],caption:'Recent verified swaps, newest first',view:'view verified transaction',
   delayed:'Last verified trades may be delayed.',last:t=>'Last trade '+t+' ago',since:t=>'No verified swaps since '+t+'.',partial:'Partial coverage',
   evidence:'Evidence Details',ev:{snapshot:'Snapshot',chain:'Network',head:'Head block',window:'Scanned blocks',pools:'Verified pools',excluded:'Not covered',
    method:'Rows are pool Swap events bound to their block hash; wallet = transaction sender. USD only from a stablecoin counter asset or Chainlink ETH/USD. Not every venue or route; not investment advice.'},
   reported:n=>n+' trades/24h reported',unit:{s:'s',m:'m',h:'h',d:'d'}},
  tr:{title:'Canlı İşlemler',status:{LIVE:'CANLI',DELAYED:'GECİKMELİ',NO_RECENT_SWAPS:'SON İŞLEM YOK',COVERAGE_INCOMPLETE:'KAPSAM EKSİK',UNSUPPORTED:'SINIRLI KAPSAM',UNAVAILABLE:'ERİŞİLEMİYOR',BUSY:'YÜKLENİYOR'},
   reason:{NO_VERIFIED_POOL:'Bu token için incelenmiş havuz yok.',NO_POOL_CANDIDATES:'Bu token için desteklenen havuz bulunamadı.',NO_SWAPS_IN_WINDOW:'Taranan doğrulanmış havuzlarda işlem yok.',
    ACTIVE_POOLS_UNSUPPORTED:'Aktif havuzlar henüz incelenmemiş DEX kontratlarında; bu işlemler gösterilmiyor.',
    LIVE_TRADES_BUSY:'İşlem akışı yoğun. Yeniden deneniyor.',RPC_RATE_LIMITED:'Veri sağlayıcı yoğun. Yeniden deneniyor.',POOL_SOURCE_UNAVAILABLE:'Havuz kaynağı erişilemiyor.',RPC_HEAD_UNAVAILABLE:'Zincir verisi erişilemiyor.'},
   usd:{STABLECOIN_QUOTED:'Stablecoin karşılığı',ORACLE_PRICED:'Chainlink ETH/USD',ORACLE_PRICED_ETH_REFERENCE:'ETH x Chainlink (Ethereum referansı)',USD_NOT_VERIFIED:'USD doğrulanmadı'},
   side:{BUY:'Alış',SELL:'Satış',SWAP:'Takas'},cols:['İşlem','Cüzdan','Tutar','Zaman'],caption:'Son doğrulanmış işlemler, en yeni önce',view:'doğrulanmış işlemi görüntüle',
   delayed:'Son doğrulanmış işlemler gecikmeli olabilir.',last:t=>'Son işlem '+t+' önce',since:t=>'Son dönemde doğrulanmış işlem bulunamadı ('+t+' itibarıyla).',partial:'Kısmi kapsam',
   evidence:'Kanıt Ayrıntıları',ev:{snapshot:'Anlık görüntü',chain:'Ağ',head:'Zincir başı',window:'Taranan bloklar',pools:'Doğrulanmış havuzlar',excluded:'Kapsam dışı',
    method:'Satırlar blok hash’ine bağlı havuz Swap olaylarıdır; cüzdan = işlemi gönderen. USD yalnızca stablecoin karşı varlıktan veya Chainlink ETH/USD’den. Tüm piyasalar değildir; yatırım tavsiyesi değildir.'},
   reported:n=>'24 saatte '+n+' işlem bildirildi',unit:{s:' sn',m:' dk',h:' sa',d:' gün'}}
 };
 const lang=()=>/^tr\b/i.test(document.documentElement.lang||'')?'tr':'en',T=()=>TEXT[lang()];
 const ago=iso=>{const ts=Date.parse(iso);if(!Number.isFinite(ts))return '—';const s=Math.max(0,Math.round((Date.now()-ts)/1000)),u=T().unit;return s<60?s+u.s:s<3600?Math.round(s/60)+u.m:s<86400?Math.round(s/3600)+u.h:Math.round(s/86400)+u.d;};
 const nt=n=>{n.setAttribute('translate','no');n.classList.add('notranslate');return n;};
 let lastData=null;
 let node=null,key=null,timer=null,delay=30000,controller=null,report=null,generation=0;
 function build(){
  node=el('section','card live-trading-card');node.dataset.cardId='trades';node.style.setProperty('--accent','#22d4ff');
  const h=el('h2','lt-title');h.append(icon(19),el('span','lt-title-text'));
  const st=el('div','lt-status');st.setAttribute('role','status');st.setAttribute('aria-live','polite');
  const wrap=el('div','lt-table-wrap');wrap.tabIndex=0;wrap.setAttribute('aria-label','Recent verified trades');
  const table=el('table','lt-table'),cap=el('caption','lt-sr','Recent verified swaps, newest first');
  const thead=el('thead','lt-table-head'),tr=el('tr');
  for(const label of ['Trade','Wallet','Amount','Time']){const th=el('th',null,label);th.scope='col';tr.append(th);}
  thead.append(tr);table.append(cap,thead,el('tbody'));wrap.append(table);
  // Technical evidence stays available but collapsed (Data Engine V2).
  const ev=el('details','lt-evidence'),sum=el('summary','lt-evidence-summary'),body=el('div','lt-evidence-body');ev.append(sum,body);ev.hidden=true;
  node.append(h,st,wrap,ev);labels();return node;
 }
 function labels(){
  const t=T();node.querySelector('.lt-title-text').textContent=' '+t.title;node.querySelector('.lt-table-wrap').setAttribute('aria-label',t.caption);
  node.querySelector('caption').textContent=t.caption;node.querySelectorAll('thead th').forEach((th,i)=>{th.textContent=t.cols[i];});node.querySelector('.lt-evidence-summary').textContent=t.evidence;
 }
 function setStatus(state,detail){
  const st=node.querySelector('.lt-status');st.replaceChildren();
  st.append(el('span','lt-badge lt-'+String(state).toLowerCase(),T().status[state]||state));
  if(detail)st.append(el('span','lt-note',detail));
 }
 function paint(data){
  lastData=data;labels();const tx=T();
  const tbody=node.querySelector('tbody'),wrap=node.querySelector('.lt-table-wrap');tbody.replaceChildren();
  const trades=Array.isArray(data?.trades)?data.trades.slice(0,30):[];
  wrap.hidden=!trades.length;
  for(const t of trades){
   const side=t.side==='BUY'?'BUY':t.side==='SELL'?'SELL':'SWAP';
   const row=el('tr','lt-row lt-'+side.toLowerCase());
   const sideCell=el('td','lt-side-cell');
   sideCell.append(el('span','lt-side',tx.side[side]));
   row.append(sideCell);
   const txUrl=safeUrl(t.explorerUrl),base=txUrl?txUrl.replace(/\/tx\/0x[0-9a-f]{64}$/i,''):null;
   const walletCell=el('td','lt-wallet-cell');
   if(base&&/^0x[0-9a-f]{40}$/i.test(t.wallet||'')){
    const wallet=nt(el('a','lt-wallet',shortWallet(t.wallet)));
    wallet.href=base+'/address/'+t.wallet;wallet.target='_blank';wallet.rel='noopener noreferrer';
    wallet.title=t.wallet+' · Open wallet in block explorer';
    wallet.setAttribute('aria-label','Open wallet '+t.wallet+' in block explorer');
    walletCell.append(wallet);
   }else{const wallet=nt(el('span','lt-wallet',shortWallet(t.wallet)));wallet.title=t.wallet||'';walletCell.append(wallet);}
   row.append(walletCell);
   const hasUsd=Number.isFinite(t.usd)&&t.usd>=0;
   const valueText=hasUsd?'$'+t.usd.toLocaleString('en-US',{maximumFractionDigits:t.usd<1?4:2}):amount(t.counterAmount)+(t.counterSymbol?' '+t.counterSymbol:'');
   const valcell=el('td','lt-value-cell'),val=nt(el(txUrl?'a':'span','lt-value'+(hasUsd?'':' lt-unverified'),valueText));
   const description=(tx.usd[t.usdStatus]||t.usdStatus||'')+(t.usdBasis?' · '+t.usdBasis:'');
   val.title=[description,t.tokenAmount+' '+(data.tokenSymbol||''),t.txHash].filter(Boolean).join(' · ');
   if(txUrl){val.href=txUrl;val.target='_blank';val.rel='noopener noreferrer';val.setAttribute('aria-label',valueText+' — '+tx.view);}
   valcell.append(val);row.append(valcell);
   const time=el('td','lt-time',ago(t.timestamp));time.title=(t.timestamp||'')+(t.block?' · block '+t.block:'');row.append(time);
   tbody.append(row);
  }
  // Evidence Details (collapsed): network, head, actual scanned window, verified and uncovered pools, method.
  const body=node.querySelector('.lt-evidence-body');body.replaceChildren();
  const line=(k,v)=>{if(v===null||v===undefined||v==='')return;const p=el('p','lt-ev-line');p.append(el('strong',null,k+': '),nt(el('span',null,String(v))));body.append(p);};
  const activeEx=(data?.excludedPools||[]).filter(x=>(x.providerTrades24h||0)>0);
  if(data?.ok){
   if(data.observedAt)line(tx.ev.snapshot,new Date(data.observedAt).toISOString().replace('T',' ').slice(0,19)+' UTC');
   line(tx.ev.chain,{arc:'Arc 5042',ethereum:'Ethereum 1',robinhood:'Robinhood 4663'}[data.network]||data.network);
   if(data.headBlock)line(tx.ev.head,data.headBlock);
   if(data.window)line(tx.ev.window,(data.window.scannedFromBlock||data.window.fromBlock)+'–'+data.window.toBlock+(data.window.scannedSince?' · '+data.window.scannedSince:''));
   if(Array.isArray(data.pools))line(tx.ev.pools,data.pools.map(p=>(p.protocol||p.kind)+' '+short(p.pool)).join(', ')||'0');
   if(activeEx.length)line(tx.ev.excluded,activeEx.map(x=>(x.dex||'?')+' '+short(x.pool)+' ('+(x.reasonCode?x.reasonCode+' · ':'')+tx.reported(x.providerTrades24h)+')').join(', '));
   body.append(el('p','lt-ev-line lt-ev-method',tx.ev.method));
  }
  node.querySelector('.lt-evidence').hidden=!body.childElementCount;
  const partial=activeEx.length&&trades.length?' · '+tx.partial:'';
  if(data?.status==='LIVE')setStatus('LIVE',(data.lastTradeAt?tx.last(ago(data.lastTradeAt)):'')+partial);
  else if(data?.status==='DELAYED')setStatus('DELAYED',tx.delayed);
  else if(data?.status==='NO_RECENT_SWAPS'&&data.window?.scannedSince)setStatus('NO_RECENT_SWAPS',tx.since(new Date(data.window.scannedSince).toLocaleString(lang()==='tr'?'tr-TR':'en-GB',{dateStyle:'medium',timeStyle:'short'})));
  else setStatus(data?.status||'UNAVAILABLE',tx.reason[data?.reasonCode]||'');
 }
 function schedule(ok){
  clearTimeout(timer);delay=ok?30000:Math.min(300000,delay*2);
  timer=setTimeout(()=>{if(!document.hidden&&(!report||report.open))load();else schedule(true);},delay);
 }
 async function load(){
  const r=route();if(!r||!node)return;const g=++generation;controller?.abort();controller=new AbortController();
  try{
   const res=await fetch('/api/search?action=trades&'+new URLSearchParams({chain:r.network,address:r.address}),{signal:controller.signal,cache:'no-store',headers:{accept:'application/json'}});
   const data=await res.json().catch(()=>null);if(g!==generation)return;
   if(!data||typeof data!=='object')throw Error('bad');paint(data);schedule(res.ok&&data.ok!==false);
  }catch(e){if(g!==generation||e?.name==='AbortError')return;paint({ok:false,status:'UNAVAILABLE',reasonCode:null,trades:[]});schedule(false);}
 }
 function ensure(cards,reportEl){
  report=reportEl||report;const r=route();
  const others=[...cards.querySelectorAll('[data-card-id]')].some(n=>n.dataset.cardId!=='trades');
  if(!r||!others)return null;
  if(!node){build();setStatus('BUSY');}
  const k=r.network+':'+r.address;
  if(k!==key){key=k;delay=30000;clearTimeout(timer);node.querySelector('tbody').replaceChildren();node.querySelector('.lt-table-wrap').hidden=true;setStatus('BUSY');load();}
  if(!cards.contains(node))cards.prepend(node);
  return node;
 }
 new MutationObserver(()=>{if(!node)return;if(lastData)paint(lastData);else labels();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&node&&key&&(!report||report.open)){clearTimeout(timer);load();}});
 return {ensure,icon,route,_paint:d=>{if(!node)build();paint(d);return node;}};
})();
(()=>{
 const nav=document.getElementById('reportNavigation'),report=document.getElementById('deepResearch'),cards=document.getElementById('cards'),status=document.getElementById('reportNavigationStatus');
 if(!nav||!report||!cards)return;
 nav.lang='en';nav.setAttribute('translate','no');nav.classList.add('notranslate');cards.lang='en';
 const order=['trades','liquidity','holders','mechanics','supply','activity'],definitions=window.ARCYEthLabSchema||[],links=new Map(),groupStates=new Map(),motion=matchMedia('(prefers-reduced-motion: reduce)');
 let activeId=order[0],slides=[],pending=false,rebuilding=false,intended=null;
 cards.classList.add('report-carousel');cards.setAttribute('role','region');cards.setAttribute('aria-roledescription','carousel');cards.setAttribute('aria-label','Token analysis cards');cards.tabIndex=0;
 const controls=document.createElement('div');controls.className='report-carousel-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Swipe or use the arrows to explore all available analyses');
 const previous=document.createElement('button'),next=document.createElement('button'),position=document.createElement('span');
 previous.type=next.type='button';previous.className=next.className='report-carousel-arrow';previous.textContent='← Previous';next.textContent='Next →';previous.setAttribute('aria-label','Previous analysis');next.setAttribute('aria-label','Next analysis');previous.setAttribute('aria-controls','cards');next.setAttribute('aria-controls','cards');position.setAttribute('role','status');position.setAttribute('aria-live','polite');controls.append(previous,position,next);cards.before(controls);
 const title=id=>id==='trades'?'Live Trading':(definitions.find(spec=>spec.id===id)?.title||id).replace(/^\S+\s+/,'');
 function activeIndex(){return slides.findIndex(slide=>slide.dataset.reportCard===activeId);}
 function activate(index){
  if(index<0||!slides[index])return;activeId=slides[index].dataset.reportCard;
  slides.forEach((slide,i)=>{slide.inert=i!==index;slide.setAttribute('aria-hidden',String(i!==index));});
  for(const[id,link]of links)if(id===activeId)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
  const disclosure=slides[index].querySelector(':scope > .report-card-disclosure');if(disclosure)disclosure.open=true;
  previous.disabled=index===0;next.disabled=index===slides.length-1;position.textContent=(index+1)+' / '+slides.length+' — '+title(activeId);
 }
 function align(index,smooth=false){if(index<0||!slides[index])return;activate(index);intended=smooth&&!motion.matches?index:null;cards.scrollTo({left:slides[index].offsetLeft,behavior:intended!==null?'smooth':'instant'});}
 function select(id,focus=false){
  report.open=true;const index=slides.findIndex(slide=>slide.dataset.reportCard===id);
  if(index<0){status.textContent=title(id)+': '+(document.getElementById('evidenceCount')?.textContent||'No report available yet.');return;}
  status.textContent='';requestAnimationFrame(()=>{align(index,true);if(focus){const card=slides[index].querySelector('[data-card-id]');card.focus({preventScroll:true});}const rect=cards.getBoundingClientRect();if(rect.top<0||rect.top>innerHeight-100)controls.scrollIntoView({block:'start',behavior:motion.matches?'instant':'smooth'});});
 }
 for(const id of order){const spec=id==='trades'?{id,title:'📈 Live Trading'}:definitions.find(x=>x.id===id);if(!spec)continue;const link=document.createElement('a'),icon=document.createElement('span'),label=document.createElement('span'),[symbol,...words]=spec.title.split(' ');if(id==='trades')icon.append(window.ARCYLiveTrading.icon(19));else icon.textContent=symbol;icon.setAttribute('aria-hidden','true');label.textContent=words.join(' ');link.href='#research-'+id;link.append(icon,label);nav.append(link);links.set(id,link);link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();select(id,true);});}
 previous.addEventListener('click',()=>align(activeIndex()-1,true));next.addEventListener('click',()=>align(activeIndex()+1,true));
 function keyboard(event){if(event.altKey||event.ctrlKey||event.metaKey)return;if(event.currentTarget===cards&&event.target!==cards&&!event.target.matches('[data-card-id]'))return;let index=activeIndex();if(event.key==='ArrowRight')index++;else if(event.key==='ArrowLeft')index--;else if(event.key==='Home')index=0;else if(event.key==='End')index=slides.length-1;else return;event.preventDefault();align(Math.max(0,Math.min(slides.length-1,index)),true);}
 nav.addEventListener('keydown',keyboard);controls.addEventListener('keydown',keyboard);cards.addEventListener('keydown',keyboard);
 function bind(){
  if(rebuilding)return;window.ARCYLiveTrading?.ensure(cards,report);const nodes=[...cards.querySelectorAll('[data-card-id]')].sort((a,b)=>order.indexOf(a.dataset.cardId)-order.indexOf(b.dataset.cardId));
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

/*
 * Discovery badges are presentation of issuer identity, not evidence quality.
 * Keep the immutable search/index.html intact and preserve the data-layer
 * NOT_VERIFIED state. Only re-label indexed search *candidates*.
 */
(()=>{
 const note='Indexed contract candidate; the issuing project is not independently confirmed.';
 function labelCandidates(container){
  // Query results may be rebuilt asynchronously after a typeahead/search.
  for(const badge of container.querySelectorAll('.detail-match-badge')){
   if(!badge.textContent.endsWith(' · NOT VERIFIED'))continue;
   badge.textContent=badge.textContent.replace(/ · NOT VERIFIED$/,' · INDEXED');
   badge.title=note;
   badge.setAttribute('aria-label',badge.textContent+' · issuer identity unconfirmed');
  }
  for(const badge of container.querySelectorAll('.candidate-badge.unknown')){
   if(badge.textContent.trim().toLowerCase()!=='unverified')continue;
   badge.textContent='INDEXED';
   badge.title=note;
   badge.setAttribute('aria-label','INDEXED · issuer identity unconfirmed');
  }
 }
 for(const id of ['matches','detailMatches']){
  const container=document.getElementById(id);
  if(!container)continue;
  const refresh=()=>labelCandidates(container);
  new MutationObserver(refresh).observe(container,{childList:true,subtree:true});
  refresh();
 }
})();
