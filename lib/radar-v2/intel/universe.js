'use strict';
// ARCY Radar V5 — ESTABLISHED / GROWTH DISCOVERY UNIVERSE (issue #279).
// The V3 provider window (top-volume / trending / new pools) is dominated by fresh launches. This module adds a SEPARATE,
// bounded, contract-aware intake that runs ONLY inside the out-of-request snapshot builder:
//   1. a maintainer-listed registry of canonical established contracts (exact chainId + address; symbols are labels only);
//   2. the network explorer's own ERC-20 token index (Blockscout /api/v2/tokens, first page) — contract-aware, not a symbol search;
//   3. market evidence for the union from ONE batched DEX Screener request per 30 contracts (existing adapter);
//   4. identity: the explorer's token record and DEX Screener's base token must report the SAME symbol for the exact contract
//      (and, for registry rows, the registry's expected symbol). Any mismatch is rejected, never "corrected".
//   5. price corroboration: explorer exchange rate vs DEX Screener price for the same contract (MATCHED / CONFLICT / none).
// Rows are then handed to the unchanged V4 engine (category, risk holds, critical risks, contradictions) and the V5 selection.
// Never: imports a contract from another chain, identifies by symbol, scans RPC, runs during a visitor request, or treats
// a listing / popularity / a logo as safety or identity proof.
const F=require('./fetch'),EX=require('./explorer'),D=require('../discovery'),{NETWORKS}=require('../sources');
const REGISTRY=require('./established-universe.json');
const ADDRESS=/^0x[0-9a-f]{40}$/;
const HOSTS=Object.freeze({...EX.HOST,arc:'https://explorer.arc.io'});
const DAY=86400000,MIN_TRADES=10,PRICE_MATCH=0.10,PRICE_CONFLICT=0.25;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>{const n=typeof v==='string'&&v.trim()!==''?Number(v):v;return finite(n)?n:null;};
const sym=v=>typeof v==='string'?v.normalize('NFKC').trim().replace(/^\$/,'').toUpperCase():'';
function registryFor(chainId){
 const list=REGISTRY?.networks?.[String(chainId)];
 return Array.isArray(list)?list.filter(e=>ADDRESS.test(String(e?.address||''))&&typeof e.symbol==='string'):[];
}
const REGISTERED=new Map(Object.entries(REGISTRY.networks||{}).flatMap(([cid,list])=>(Array.isArray(list)?list:[]).filter(e=>ADDRESS.test(String(e?.address||'')))
 .map(e=>[cid+':'+e.address,e])));
function registered(chainId,address){return REGISTERED.get(String(chainId)+':'+String(address||'').toLowerCase())||null;}
function explorerToken(x){
 const address=String(x?.address_hash||x?.address||'').toLowerCase();
 if(!ADDRESS.test(address)||(x?.type&&x.type!=='ERC-20'))return null;
 return {address,symbol:typeof x.symbol==='string'?x.symbol.slice(0,40):null,name:typeof x.name==='string'?x.name.slice(0,80):null,
  holders:num(x.holders_count??x.holders),exchangeRate:num(x.exchange_rate),marketCap:num(x.circulating_market_cap)};
}
// Lower-bound sum over this contract's base pools: pools that do not report a value are left out (never estimated), so the
// total can only UNDER-state liquidity/volume. Null when no pool reports the field.
const sum=(rows,f)=>{const v=rows.map(f).filter(finite);return v.length?v.reduce((a,b)=>a+b,0):null;};
async function discover({network,fetcher=global.fetch,now=Date.now(),o={},existing=new Set(),exclude=new Set(),maxCandidates=40,maxLookups=30,dexTokens,dexTokenPairs=null,maxPairLookups=30}={}){
 const report={network,explorer:null,registryListed:0,explorerListed:0,identityLookups:0,dexCalls:0,considered:0,accepted:0,rejected:{},sample:[]};
 const reject=(why,t)=>{report.rejected[why]=(report.rejected[why]||0)+1;if(report.sample.length<40)report.sample.push([t.symbol||t.expected||'?',t.address.slice(0,10),why]);};
 if(network==='pons'||!NETWORKS[network])return {rows:[],report:{...report,explorer:'NOT_APPLICABLE'},enrich:new Map()};
 const chainId=NETWORKS[network].chainId,host=HOSTS[network];
 const reg=registryFor(chainId);report.registryListed=reg.length;
 // 2. explorer token index (one request; failure is reported, never fatal)
 const fromExplorer=new Map();
 if(host){
  try{const page=await F.json(host+'/api/v2/tokens?type=ERC-20',{...o,fetcher,timeoutMs:20000});
   for(const x of Array.isArray(page?.items)?page.items.slice(0,50):[]){const t=explorerToken(x);if(t)fromExplorer.set(t.address,t);}
   report.explorer=fromExplorer.size?'OK':'EMPTY';report.explorerListed=fromExplorer.size;
  }catch(e){report.explorer=e.code||'UNAVAILABLE';}
 }else report.explorer='NOT_CONFIGURED';
 // union: registry first (exact contracts), then explorer index order; contracts already in the V3 window are evaluated there
 const queue=[];const seen=new Set();
 for(const e of reg){const a=e.address.toLowerCase();if(!seen.has(a)){seen.add(a);queue.push({address:a,expected:e.symbol,registry:e});}}
 for(const t of fromExplorer.values())if(!seen.has(t.address)){seen.add(t.address);queue.push({address:t.address,expected:null,registry:null});}
 const work=[];
 for(const q of queue){
  // A registry contract already in the V3 window is evaluated there; the universe only adds its identity evidence (enrichment).
  if(existing.has(q.address)&&!q.registry){reject('ALREADY_IN_RADAR_WINDOW',q);continue;}
  if(existing.has(q.address))q.enrichOnly=true;
  if(exclude.has(q.address)){reject('PONS_LAUNCH_ROUTED',q);continue;}
  if(work.length>=maxCandidates){reject('UNIVERSE_CAP',q);continue;}
  work.push(q);
 }
 report.considered=work.length;
 // registry contracts absent from the index page: one bounded exact-contract record lookup each
 for(const q of work){
  if(fromExplorer.has(q.address)||!host)continue;
  if(report.identityLookups>=maxLookups)break;
  report.identityLookups++;
  try{const t=explorerToken({...(await F.json(host+'/api/v2/tokens/'+q.address,{...o,fetcher})),address_hash:q.address});if(t)fromExplorer.set(q.address,t);}catch{}
 }
 // 3. market evidence: batched DEX Screener requests (<=30 contracts each)
 const pairs=new Map();
 // Registry contracts: one complete per-token pool listing each (bounded); index-only contracts: batched requests.
 const perToken=typeof dexTokenPairs==='function'?work.filter(q=>q.registry).slice(0,maxPairLookups):[];
 for(const q of perToken){
  try{report.dexCalls++;const m=await dexTokenPairs(network,q.address,{fetcher,now});pairs.set(q.address,m.get(q.address)||[]);}
  catch(e){pairs.set(q.address,{error:e.code||'DEX_UNAVAILABLE'});}
 }
 const batched=work.filter(q=>!pairs.has(q.address));
 for(let i=0;i<batched.length;i+=30){
  const batch=batched.slice(i,i+30).map(q=>q.address);
  try{report.dexCalls++;const m=await dexTokens(network,batch,{fetcher,now});for(const [k,v] of m)pairs.set(k,v);}
  catch(e){for(const a of batch)pairs.set(a,{error:e.code||'DEX_UNAVAILABLE'});}
 }
 const p=D.PROFILES[network],rows=[],enrich=new Map();
 for(const q of work){
  const all=pairs.get(q.address);
  if(all?.error){reject('MARKET_SOURCE_UNAVAILABLE',q);continue;}
  const base=(Array.isArray(all)?all:[]).filter(x=>x.side==='base'&&x.token===q.address);
  if(!base.length){reject('NO_DEX_MARKET',q);continue;}
  const best=base.reduce((a,x)=>(!a||(x.liquidityUsd||0)>(a.liquidityUsd||0))?x:a,null);
  const ex=fromExplorer.get(q.address)||null;
  // 4. identity: explorer symbol == DEX Screener base symbol (== registry symbol for registry rows), exact contract
  const exSym=sym(ex?.symbol),dexSym=sym(best.baseSymbol),want=sym(q.expected);
  if(!exSym){reject('IDENTITY_SECOND_SOURCE_MISSING',{...q,symbol:best.baseSymbol});continue;}
  if(exSym!==dexSym||(want&&exSym!==want)){reject('IDENTITY_MISMATCH',{...q,symbol:best.baseSymbol||ex?.symbol});continue;}
  // 5. price corroboration
  const dexPrice=best.priceUsd,exPrice=ex?.exchangeRate;
  let crossCheck=null,deltaPct=null;
  if(finite(dexPrice)&&dexPrice>0&&finite(exPrice)&&exPrice>0){deltaPct=Math.abs(dexPrice/exPrice-1);crossCheck=deltaPct<=PRICE_MATCH?'MATCHED':deltaPct>=PRICE_CONFLICT?'CONFLICT':'UNCORROBORATED';}
  const liquidity=sum(base,x=>x.liquidityUsd),volume=sum(base,x=>x.volume24hUsd);
  const trades=sum(base,x=>finite(x.txnWindows?.h24?.buys)&&finite(x.txnWindows?.h24?.sells)?x.txnWindows.h24.buys+x.txnWindows.h24.sells:null);
  const buys=sum(base,x=>x.txnWindows?.h24?.buys),sells=sum(base,x=>x.txnWindows?.h24?.sells);
  const vw=w=>sum(base,x=>x.volumeWindows?.[w]),tw=w=>sum(base,x=>finite(x.txnWindows?.[w]?.buys)&&finite(x.txnWindows?.[w]?.sells)?x.txnWindows[w].buys+x.txnWindows[w].sells:null);
  // Pool age: the deepest pool's creation time, else the OLDEST pool of this contract with a reported creation time.
  const known=base.map(x=>x.pairCreatedAt).filter(x=>Number.isFinite(Date.parse(x||''))).sort((a,b)=>Date.parse(a)-Date.parse(b));
  const created=best.pairCreatedAt||known[0]||null;const age=Number.isFinite(Date.parse(created||''))?(now-Date.parse(created))/DAY:null;
  const gates=[];
  if(!finite(dexPrice)||dexPrice<=0)gates.push('PRICE_NOT_VERIFIED');
  if(!finite(volume))gates.push('VOLUME_NOT_VERIFIED');else if(volume<p.minVol)gates.push('VOLUME_BELOW_NETWORK_FLOOR');
  if(!finite(liquidity))gates.push('LIQUIDITY_NOT_VERIFIED');else if(liquidity<p.minLiq)gates.push('LIQUIDITY_BELOW_NETWORK_FLOOR');
  if(!finite(trades)||trades<MIN_TRADES)gates.push('TOO_FEW_TRADES');
  if(age===null)gates.push('POOL_AGE_NOT_VERIFIED');else if(age<1)gates.push('POOL_UNDER_24H');
  if(q.registry&&report.sample.length<40)report.sample.push([best.baseSymbol||q.expected,q.address.slice(0,10),'PRICE_'+(crossCheck||'UNCORROBORATED')+(deltaPct===null?'':'_'+(deltaPct*100).toFixed(1)+'%')+(gates.length?'_GATES:'+gates.join('+'):'')]);
  const row={address:q.address,chainId,network,symbol:best.baseSymbol||ex.symbol,name:best.baseName||ex.name||best.baseSymbol,
   pool:best.pair,dex:best.dexId,quote:best.quoteAddress?{address:best.quoteAddress}:null,dexUrl:best.url,
   priceUsd:finite(dexPrice)?dexPrice:null,liquidityUsd:liquidity,volume24hUsd:volume,change24hPct:best.change24hPct,
   fdvUsd:best.fdvUsd??null,marketCapUsd:best.marketCapUsd??ex.marketCap??null,poolCreatedAt:created||null,buys24h:buys,sells24h:sells,
   poolCount:base.length,logo:best.logo?{url:best.logo,source:'DEX Screener'}:(base.find(x=>x.logo)?{url:base.find(x=>x.logo).logo,source:'DEX Screener'}:null),
   activity:{source:'DEX Screener pair windows (summed over this contract’s base pairs)',volumeUsd:{h1:vw('h1'),h6:vw('h6'),h24:vw('h24')},
    trades:{h1:tw('h1'),h6:tw('h6'),h24:tw('h24')},buyers:{h24:null},sellers:{h24:null}},
   radarAsOf:new Date(now).toISOString(),radarFreshness:'FRESH',
   v3:{stage:'BUILDER_CROSS_CHECKED',originalStage:'ESTABLISHED_UNIVERSE',gates,
    verification:{crossCheck,fields:{priceUsd:crossCheck==='MATCHED'?'CROSS_VERIFIED':finite(dexPrice)?'SOURCE_REPORTED':'NOT_VERIFIED',
     volume24hUsd:finite(volume)?'SOURCE_REPORTED':'NOT_VERIFIED',liquidityUsd:finite(liquidity)?'SOURCE_REPORTED':'NOT_VERIFIED',
     poolCreatedAt:created?'SOURCE_REPORTED':'NOT_VERIFIED',change24hPct:finite(best.change24hPct)?'SOURCE_REPORTED':'NOT_VERIFIED'},
     sourcesDisagree:crossCheck==='CONFLICT',pairCount:base.length}},
   universe:{source:q.registry?'ESTABLISHED_REGISTRY':'EXPLORER_TOKEN_INDEX',registry:q.registry?{project:q.registry.project,kind:q.registry.kind,version:REGISTRY.version}:null,
    identity:{status:'TWO_SOURCE_SYMBOL_MATCH',explorerSymbol:ex.symbol,dexSymbol:best.baseSymbol,explorerUrl:host?host+'/token/'+q.address:null},
    holdersCount:ex.holders,priceCrossCheck:{explorerUsd:exPrice??null,dexUsd:dexPrice??null,deltaPct:deltaPct===null?null:+(deltaPct*100).toFixed(2),status:crossCheck||'UNCORROBORATED'},
    liquidityScope:'TOKEN_BASE_PAIRS_LOWER_BOUND_SUM_SINGLE_SOURCE',poolsReportingVolume:base.filter(x=>finite(x.volume24hUsd)).length,poolsReportingLiquidity:base.filter(x=>finite(x.liquidityUsd)).length},
   provenance:[q.registry?'ESTABLISHED_UNIVERSE':'EXPLORER_TOKEN_INDEX']};
  if(q.enrichOnly){enrich.set(q.address,row.universe);report.enriched=(report.enriched||0)+1;continue;}
  rows.push(row);report.accepted++;
 }
 return {rows,report,enrich};
}
module.exports={discover,registered,registryFor,REGISTRY,HOSTS};
