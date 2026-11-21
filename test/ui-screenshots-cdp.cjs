// Manual before/after screenshot + measurement driver (Chrome DevTools Protocol, no Playwright). Not part of npm test.
// Usage: node test/ui-screenshots-cdp.cjs <repoDir> <outDir> <label>   (radar fixtures: /tmp/uishot/fx/radar-<net>.json)
// CDP screenshot + measurement driver (no Playwright). Usage: node shots.cjs <repoDir> <outDir> <label>
'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const [repo,out,label]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const FX='/tmp/uishot/fx',PORT=3100+Math.floor(Math.random()*800),CDP=9200+Math.floor(Math.random()*700);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ADDR='0x5a98fcbea516cf06857215779fd812ca3bef1b32';
const holderCands=[{rank:1,address:'0x000000000000000000000000000000000000dead',sharePct:21.4,role:'BURN_ADDRESS',block:'0x1500000'},
 {rank:2,address:'0x3e66b66fd1d0b02fda6c811da9e0547970db2f21',sharePct:12.7,role:'UNKNOWN',block:'0x1500000'},
 {rank:3,address:'0x1111111254eeb25477b68fb85ed929f73a960582',sharePct:6.1,role:'UNKNOWN',block:'0x1500000'}];
function field(value,status='VERIFIED_SOURCE',extra={}){return {value,dataState:value===null?'NOT_VERIFIED':'DATA_FOUND',status:value===null?'NOT_VERIFIED':status,source:value===null?undefined:'Ethereum RPC + verified source',
 reason:value===null?'No source returned this metric for the exact contract.':undefined,chainId:1,network:'ethereum',
 evidence:value===null?[]:[{chainId:1,address:ADDR,block:'0x1500000',sourceUrl:'https://eth.blockscout.com/token/'+ADDR}],...extra};}
const report={ok:true,chainId:1,network:'ethereum',address:ADDR,cardCount:5,block:'0x1500000',scannedAt:'2026-11-21T08:00:00.000Z',
 token:{name:'Lido DAO Token',symbol:'LDO'},tokenIdentity:{status:'NOT_VERIFIED'},
 cards:{supply:{description:'fixture',fields:{totalSupply:field('1000000000'),nonBurnSupply:field(null),burnAddressBalance:field('0'),burnAddressPct:field(0)}},
  holders:{description:'Holder concentration from explorer-ranked candidates reconciled with pinned on-chain balances.',fields:{holderCount:field(38211,'CROSS_VERIFIED'),largestWalletPct:field(21.4,'SOURCE_REPORTED_RPC_RECONCILED'),top10Pct:field(56.3,'SOURCE_REPORTED_RPC_RECONCILED'),top20Pct:field(null)},holderCandidates:holderCands},
  liquidity:{description:'fixture',fields:{liquidityUsd:field(1110000),volume24h:field(199800),dexPairCount:field(12),liquidityTurnover24h:field(null)}},
  activity:{description:'fixture',fields:{priceUsd:field(0.61),valuation:field(null),change24h:field(-5.7),volume24h:field(199800)}},
  mechanics:{description:'Exact-contract mechanics from pinned bytecode and verified source.',researchNotes:['Reviewed source: the _transfer override only updates vote checkpoints; no pause, blacklist or fee control exists.'],
   fields:{tradingTaxes:field('Buy 0% · Sell 0% · Transfer 0%'),mintCapability:field('Role-gated mint (MINTER_ROLE)'),ownerAdmin:field('Owner-governed (mint) · 0x3e40d73eb977dc6a537af587d48316fee66e9c8c'),contractArchitecture:field('EIP-1967 proxy · delegation proven','ONCHAIN_VERIFIED')}}}};
const unlocks={ok:true,live:true,source:'Coinbell public calendar',updatedAt:'2026-11-21T07:00:00Z',generatedAt:'2026-11-21T07:00:00Z',coverage:{independentPublishers:1},windows:{
 today:[{name:'Aptos',symbol:'APT',date:'2026-11-21',amount:'11.31M APT',percent:'1.98%',value:'$62.4M',allocation:'Community'},{name:'Arbitrum',symbol:'ARB',date:'2026-11-21',amount:'92.65M ARB',percent:'2.13%',value:'$31.2M'},{name:'Starknet Token',symbol:'STRK',date:'2026-11-21',amount:'127,000,000 STRK',percent:'',value:'$15.4M'},{name:'Celestia',symbol:'TIA',date:'2026-11-21',amount:'1.87M TIA',percent:'0.35%'},{name:'Immutable X',symbol:'IMX',date:'2026-11-21',amount:'24.52M IMX',percent:'1.33%'}],
 next7:[{name:'Sui',symbol:'SUI',date:'2026-11-24',amount:'64.19M SUI',percent:'1.81%'}],days8to30:[{name:'ZetaChain',symbol:'ZETA',date:'2026-12-01',amount:'44.26M ZETA',percent:'5.37%'}]}};
function fulfil(url){
 const u=new URL(url);if(!u.pathname.startsWith('/api/'))return null;
 const a=u.searchParams.get('action'),c=u.searchParams.get('chain');
 if(u.pathname==='/api/search'&&a==='radar'&&/^(arc|ethereum|robinhood|pons)$/.test(c||''))return [200,fs.readFileSync(path.join(FX,'radar-'+c+'.json'),'utf8')];
 if(u.pathname==='/api/search'&&a==='progress')return [404,'{"ok":false}'];
 if(u.pathname==='/api/search'&&a==='report')return [200,JSON.stringify(report)];
 if(u.pathname==='/api/unlocks')return [200,JSON.stringify(unlocks)];
 return [503,'{"ok":false,"reason":"FIXTURE_UNAVAILABLE"}'];
}
(async()=>{
 const server=spawn(process.execPath,['dev.cjs'],{cwd:repo,env:{...process.env,PORT:String(PORT)},stdio:'ignore'});
 const chrome=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--remote-debugging-port='+CDP,'--user-data-dir=/tmp/uishot/prof-'+CDP,'about:blank'],{stdio:'ignore'});
 await sleep(2500);
 const targets=await (await fetch('http://127.0.0.1:'+CDP+'/json')).json();
 const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.onopen=r);
 let id=0;const pend=new Map(),handlers=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}else for(const h of handlers)h(m);};
 const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
 const evalJs=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});return r.result?.result?.value;};
 const errors=[],external=[];
 handlers.push(m=>{if(m.method==='Fetch.requestPaused'){const p=m.params,f=fulfil(p.request.url);
   if(f)send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:f[0],responseHeaders:[{name:'content-type',value:'application/json'}],body:Buffer.from(f[1]).toString('base64')});
   else{if(!p.request.url.startsWith('http://127.0.0.1'))external.push(p.request.url);
    if(!p.request.url.startsWith('http://127.0.0.1'))send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});else send('Fetch.continueRequest',{requestId:p.requestId});}}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails?.exception?.description?.slice(0,200)||'exception');});
 await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Runtime.enable');await send('Page.enable');
 const base='http://127.0.0.1:'+PORT;
 const results={label,widths:{}};
 async function view(width,mobile){await send('Emulation.setDeviceMetricsOverride',{width,height:mobile?900:1000,deviceScaleFactor:mobile?2:1,mobile});}
 async function go(url){await send('Page.navigate',{url:base+url});await sleep(3500);}
 async function shotEl(sel,name){
  const box=await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;if(e.closest('.report-carousel-slide')&&!document.getElementById('shotStack')){const st=document.createElement('style');st.id='shotStack';st.textContent='#tokenDetail #deepResearch #cards.report-carousel{display:block!important;overflow:visible!important}#tokenDetail #deepResearch #cards>.report-carousel-slide{contain:none!important;margin-bottom:12px}';document.head.append(st);}e.scrollIntoView({block:'start',inline:'start'});const r=e.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:Math.min(r.height,4000)};})()`);
  if(!box)return null;await sleep(400);
  const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:Math.max(0,box.x),y:Math.max(0,box.y),width:Math.max(1,box.w),height:Math.max(1,box.h),scale:1}});
  if(r.result?.data)fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.result.data,'base64'));return box;
 }
 const overflow=`({scroll:document.documentElement.scrollWidth,inner:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})`;
 for(const [w,mobile] of [[320,true],[360,true],[390,true],[412,true],[768,true],[1280,false],[1440,false]]){
  await view(w,mobile);const r={};
  // Token Unlocks (homepage)
  await go('/');
  await evalJs(`document.querySelector('#unlocks')?.scrollIntoView();1`);await sleep(1500);
  r.unlocks=await evalJs(`(()=>{const t=document.querySelector('#unlocks .tablebox'),tb=document.querySelector('#unlocks table');
    const rows=[...document.querySelectorAll('#unlockRows tr')];
    return {tableboxScroll:t?t.scrollWidth:null,tableboxClient:t?t.clientWidth:null,tableWidth:tb?tb.getBoundingClientRect().width:null,
     rows:rows.length,cellsClipped:rows.flatMap(tr=>[...tr.cells]).filter(c=>c.scrollWidth>c.clientWidth+1).length,
     rowHeights:rows.map(tr=>Math.round(tr.getBoundingClientRect().height)),text:rows.map(tr=>tr.innerText.replace(/\\s+/g,' ').trim()),page:${overflow}};})()`);
  if([320,390,768,1440].includes(w))await shotEl('#unlocks .tablebox','unlocks-'+w);
  // Radar (/radar.html, Robinhood card default)
  await go('/radar.html');await sleep(2500);
  r.radar=await evalJs(`(()=>{const s=document.querySelector('.arcy-radar-search');return {search:!!s,cards:[...document.querySelectorAll('.arcy-radar-overview-card')].map(c=>c.dataset.overview+':'+c.querySelectorAll('.arcy-radar-overview-token').length),page:${overflow}};})()`);
  if(r.radar.search){
   r.radarQueries={};
   for(const [net,q] of [['robinhood','fobo'],['robinhood','statics'],['robinhood','0x2d8d6f4a93acd7a916a5a654ec8b690ba3b3eadd'],['robinhood','0x2d8d6f'],['robinhood','priors'],['pons','priors'],['pons','zzzz-not-there']]){
    r.radarQueries[net+':'+q]=await evalJs(`(async()=>{const btn=[...document.querySelectorAll('.arcy-radar-networks button')].find(b=>b.dataset.network===${JSON.stringify(net)});btn&&btn.click();await new Promise(r=>setTimeout(r,500));
      const i=document.querySelector('.arcy-radar-search-input');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,400));
      const card=[...document.querySelectorAll('.arcy-radar-overview-card')].find(c=>!c.hidden);
      const vis=[...card.querySelectorAll('.arcy-radar-overview-token')].filter(r=>getComputedStyle(r).display!=='none').map(r=>r.querySelector('.arcy-radar-overview-token-ticker')?.textContent+'@'+(r.getAttribute('href')||'').split('/').slice(-2).join('/'));
      return {net:card.dataset.overview,status:document.querySelector('.arcy-radar-search-status')?.textContent,empty:card.querySelector('.arcy-radar-search-empty')?.textContent||null,visible:vis};})()`);
    if(w===390&&q==='fobo')await shotEl('.arcy-radar-panel','radar-search-'+w);
    if(w===390&&q==='zzzz-not-there')await shotEl('.arcy-radar-search','radar-search-empty-'+w);
   }
   // clear restores the original ten, order and expansion
   r.radarClear=await evalJs(`(async()=>{const i=document.querySelector('.arcy-radar-search-input');i.value='';i.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,400));
     const card=[...document.querySelectorAll('.arcy-radar-overview-card')].find(c=>!c.hidden);return {expanded:card.classList.contains('is-expanded'),hidden:[...card.querySelectorAll('.arcy-radar-overview-token')].filter(r=>r.hidden).length,rows:card.querySelectorAll('.arcy-radar-overview-token').length};})()`);
  }
  if(w===390||w===1440)await shotEl('.arcy-radar-panel','radar-'+w);
  // Token report cards
  await go('/search/token/ethereum/'+ADDR);await sleep(1500);
  await evalJs(`(()=>{const d=document.getElementById('deepResearch');if(d)d.open=true;return 1})()`);await sleep(800);
  r.cards=await evalJs(`(()=>{const h=document.querySelector('#cards [data-card-id="holders"]'),m=document.querySelector('#cards [data-card-id="mechanics"]');
   return {holders:!!h,mechanics:!!m,holdersPanel:!!h?.querySelector('.arcy-rc-panel'),mechPanel:!!m?.querySelector('.arcy-rc-panel'),metrics:document.querySelectorAll('#cards .metric').length,
    holdersText:h?.querySelector('.arcy-rc-panel')?.innerText.replace(/\\s+/g,' ').slice(0,1200)||null,mechText:m?.querySelector('.arcy-rc-panel')?.innerText.replace(/\\s+/g,' ').slice(0,1800)||null,page:${overflow}};})()`);
  if([320,390,1440].includes(w)){await shotEl('#cards [data-card-id="holders"]','holders-'+w);await shotEl('#cards [data-card-id="mechanics"]','mechanics-'+w);}
  results.widths[w]=r;
 }
 results.errors=[...new Set(errors)].slice(0,10);results.externalBlocked=[...new Set(external.map(u=>new URL(u).hostname))];
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,1));
 ws.close();chrome.kill();server.kill();
 console.log('done',label);
})().catch(e=>{console.error(e);process.exit(1);});
