'use strict';
// Independent two-provider market check (DEX Screener primary, GeckoTerminal secondary) for the liquidity/activity fields.
// Fail-closed, opt-in everywhere: the secondary provider (extra request per report, GeckoTerminal terms for this use not yet reviewed)
// is used only when the operator sets SEARCH_MARKET_CROSSCHECK_APPROVED=true. Default = exactly one provider request, as before.
// RULES (never relaxed to raise coverage):
//  * the primary field's value/status is never replaced by a different number; a cross-check only ADDS `crossCheck`
//  * AGREE needs both providers' pool-level values within the documented tolerance; anything else stays single-source
//  * if the primary has no value and the secondary does, the secondary's field is used AS SINGLE SOURCE (never cross-verified)
//  * a 429/5xx from the secondary starts a cooldown; during it no secondary call is made (reasonCode says so)
const dex=require('./dex-market'),gecko=require('./gecko-market'),onchain=require('./market-onchain');
// Pool-level evidence (Radar probe): DEX Screener vs GeckoTerminal liquidity ratio 0.99-1.03 on shared pools. Volume windows differ slightly.
const TOLERANCE=Object.freeze({liquidityUsd:0.10,volume24h:0.30,priceUsd:0.03});
const KEYS=Object.keys(TOLERANCE);
const COOLDOWN_MS=60000;
let coolUntil=0,coolReason=null;
function enabled(env=process.env){return env.SEARCH_MARKET_CROSSCHECK_APPROVED==='true';}
const found=f=>f&&f.dataState==='DATA_FOUND'&&typeof f.value==='number'&&Number.isFinite(f.value);
function rel(a,b){const m=Math.max(Math.abs(a),Math.abs(b));return m===0?0:Math.abs(a-b)/m;}
function stamp(fields,now){
 const at=new Date(now).toISOString();
 for(const f of Object.values(fields||{}))if(f?.dataState==='DATA_FOUND'&&!f.freshness){f.freshness={retrievedAt:at,ageMs:0,basis:'Provider response retrieval time; upstream publication time unavailable.'};f.evidence=(f.evidence||[]).map(e=>({...e,checkedAt:at}));}
 return fields;
}
function merge(primary,secondary,{now,secondaryReason}){
 const out={...(primary||{})};
 const at=new Date(now).toISOString();
 for(const key of KEYS){
  const a=primary?.[key],b=secondary?.[key];
  if(found(a)&&found(b)){
   const pools=f=>[...new Set((f.evidence||[]).flatMap(e=>e.pairs||e.pools||[]).map(x=>String(x).toLowerCase()))].sort();
   const ap=pools(a),bp=pools(b);
   // #352 narrow exception (liquidityUsd only): an on-chain secondary that reproduced a SUBSET of the provider's own pools
   // holding >= 95% of the provider total (market-onchain coverage path) is the same scope up to a stated coverage share.
   const cov=key==='liquidityUsd'?Number(b.evidence?.[0]?.coverageOfProviderLiquidity):key==='volume24h'?Number(b.evidence?.[0]?.coverageOfProviderVolume):NaN;
   const subset=bp.length>0&&bp.every(x=>ap.includes(x));
   const covered=Number.isFinite(cov)&&cov>=0.95&&cov<=1&&subset;
   const same=ap.length>0&&(JSON.stringify(ap)===JSON.stringify(bp)||covered);
   const diff=rel(a.value,b.value),tol=TOLERANCE[key],agree=same&&a.source!==b.source&&diff<=tol;
   out[key]={...a,crossCheck:{state:!same?'SCOPE_MISMATCH':agree?'AGREE':'DISAGREE',...(covered?{scope:'COVERAGE',[key==='volume24h'?'coverageOfProviderVolume':'coverageOfProviderLiquidity']:cov,coveredPools:bp.length,providerPools:ap.length}:{}),providers:[a.source,b.source],values:{[a.source]:a.value,[b.source]:b.value},relativeDifference:+diff.toFixed(4),tolerance:tol,checkedAt:at,
    ...(agree?{}:{reasonCode:!same?'POOL_SCOPE_MISMATCH':'PROVIDER_DISAGREEMENT'})},evidence:[...(a.evidence||[]),...(b.evidence||[]).map(e=>({...e,role:'cross-check'}))]};
  }else if(found(a)){
   out[key]={...a,crossCheck:{state:'UNAVAILABLE',providers:[a.source],reasonCode:(secondaryReason&&typeof secondaryReason==='object'?secondaryReason[key]||secondaryReason.all:secondaryReason)||(b?.reasonCode)||'SECONDARY_SOURCE_NO_DATA',checkedAt:at}};
  }else if(found(b)){
   out[key]={...b,crossCheck:{state:'SINGLE_PROVIDER_FALLBACK',providers:[b.source],reasonCode:a?.reasonCode||'PRIMARY_SOURCE_NO_DATA',checkedAt:at}};
  }
 }
 for(const key of Object.keys(secondary||{})){if(KEYS.includes(key))continue;if(!found(out[key])&&found(secondary[key])&&out[key]?.dataState!=='DATA_FOUND')out[key]=secondary[key];}
 return out;
}
function attachProfile(fields,profile){if(profile)Object.defineProperty(fields,'onchainProfile',{value:profile,enumerable:false});return fields;}
const FILL=['priceUsd','liquidityUsd','dexPairCount'];
const usable=f=>f&&f.dataState==='DATA_FOUND'&&f.value!==null&&f.value!==undefined;
// Provider-independent fill (market-discovery.js): pools discovered from reviewed on-chain factories. It only fills fields the provider
// path did not deliver (provider down, token not listed) and never replaces a provider value, so a healthy provider changes nothing.
async function fillFromChain(network,address,fields,{discoveryInspect,env,now,snapshotLoad=(o)=>require('./market-verify-snapshot').load(o)}){
 const out={...(fields||{})},filled=[];let profile;
 if(discoveryInspect&&!FILL.every(k=>usable(out[k]))){
  let r=null;try{r=await discoveryInspect(network,address,{env,now:now()});}catch{}
  for(const k of FILL)if(!usable(out[k])&&usable(r?.fields?.[k])){out[k]=r.fields[k];filled.push(k);}
  profile=r?.profile;
 }
 // Provider-independent 24h volume (+ same-block TVL for turnover) from the durable snapshot's persisted pool registry.
 if(!usable(out.volume24h)){
  try{const S=require('./market-verify-snapshot'),doc=await snapshotLoad({now:now(),env}),v=S.discoveredVolumeField(doc,network,address,{now:now()});
   if(v.field){out.volume24h=v.field;filled.push('volume24h');}}catch{}
 }
 return filled.length?{fields:out,filled,profile}:{fields,filled:[]};
}
async function inspect(network,address,{dexInspect=dex.inspect,geckoInspect=gecko.inspect,onchainInspect=onchain.inspect,discoveryInspect=require('./market-discovery').inspect,now=Date.now,env=process.env}={}){
 const t=now();
 // GeckoTerminal stays opt-in (terms review). Optional secondary (SEARCH_MARKET_ONCHAIN_CHECK=on) = the chain itself (market-onchain.js): the provider's own pools
 // re-read at a pinned block; free, permitted, budgeted (<=24 calls, 2.5 s) and isolated (a failure only adds a reasonCode).
 if(!enabled(env)){
  let primary=null,providerError=null;
  try{primary=await dexInspect(network,address);}catch(e){providerError=e;}
  if(!primary){
   // Provider outage: independent on-chain discovery or the original failure (unchanged behaviour when discovery is off/empty).
   const unavailable=dex.unavailable('The market provider was unavailable.',providerError?.code||'MARKET_PROVIDER_UNAVAILABLE');
   const f=await fillFromChain(network,address,unavailable,{discoveryInspect,env,now});
   if(!f.filled.length)throw providerError||Error('No market provider');
   return attachProfile(f.fields,f.profile);
  }
  if(!onchainInspect||!onchain.enabled(env)){const f=await fillFromChain(network,address,primary,{discoveryInspect,env,now});return f.filled.length?attachProfile(f.fields,f.profile):primary;}
  let r;try{r=await onchainInspect(network,address,primary);}catch{return primary;}
  let merged;
  if(!r||!r.fields||!Object.keys(r.fields).length)merged=attachProfile(merge(primary,null,{now:t,secondaryReason:r?.profile?.reasons||{all:'ONCHAIN_NO_DATA'}}),r?.profile);
  else merged=attachProfile(merge(primary,r.fields,{now:t,secondaryReason:r.profile?.reasons||{}}),r.profile);
  const f=await fillFromChain(network,address,merged,{discoveryInspect,env,now});
  return f.filled.length?attachProfile(f.fields,r?.profile||f.profile):merged;
 }
 const useSecondary=t>=coolUntil;
 const [d,g]=await Promise.allSettled([dexInspect(network,address),useSecondary?geckoInspect(network,address):Promise.reject(Object.assign(Error('skipped'),{code:'SECONDARY_COOLDOWN'}))]);
 const primary=d.status==='fulfilled'?d.value:null;
 let secondary=null,secondaryReason=null;
 if(g.status==='fulfilled')secondary=stamp(g.value?.fields,t);
 else{
  const e=g.reason||{};secondaryReason=e.code||'SECONDARY_SOURCE_UNAVAILABLE';
  if(/HTTP (429|5\d\d)/.test(String(e.message))){coolUntil=t+COOLDOWN_MS;secondaryReason=/429/.test(e.message)?'SECONDARY_RATE_LIMITED':'SECONDARY_SERVER_ERROR';}
 }
 if(!primary&&!secondary){
  const f=await fillFromChain(network,address,dex.unavailable('Both market providers were unavailable.',d.reason?.code||'MARKET_PROVIDER_UNAVAILABLE'),{discoveryInspect,env,now});
  if(!f.filled.length)throw d.reason||g.reason||Error('No market provider');
  return attachProfile(f.fields,f.profile);
 }
 const merged=merge(primary,secondary,{now:t,secondaryReason});
 const f=await fillFromChain(network,address,merged,{discoveryInspect,env,now});
 return f.filled.length?f.fields:merged;
}
function _reset(){coolUntil=0;coolReason=null;}
module.exports={inspect,merge,enabled,TOLERANCE,_reset,fillFromChain};
