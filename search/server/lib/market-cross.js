'use strict';
// Independent two-provider market check (DEX Screener primary, GeckoTerminal secondary) for the liquidity/activity fields.
// Fail-closed, opt-in everywhere: the secondary provider (extra request per report, GeckoTerminal terms for this use not yet reviewed)
// is used only when the operator sets SEARCH_MARKET_CROSSCHECK_APPROVED=true. Default = exactly one provider request, as before.
// RULES (never relaxed to raise coverage):
//  * the primary field's value/status is never replaced by a different number; a cross-check only ADDS `crossCheck`
//  * AGREE needs both providers' pool-level values within the documented tolerance; anything else stays single-source
//  * if the primary has no value and the secondary does, the secondary's field is used AS SINGLE SOURCE (never cross-verified)
//  * a 429/5xx from the secondary starts a cooldown; during it no secondary call is made (reasonCode says so)
const dex=require('./dex-market'),gecko=require('./gecko-market');
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
   const ap=pools(a),bp=pools(b),same=ap.length>0&&JSON.stringify(ap)===JSON.stringify(bp);
   const diff=rel(a.value,b.value),tol=TOLERANCE[key],agree=same&&a.source!==b.source&&diff<=tol;
   out[key]={...a,crossCheck:{state:!same?'SCOPE_MISMATCH':agree?'AGREE':'DISAGREE',providers:[a.source,b.source],values:{[a.source]:a.value,[b.source]:b.value},relativeDifference:+diff.toFixed(4),tolerance:tol,checkedAt:at,
    ...(agree?{}:{reasonCode:!same?'POOL_SCOPE_MISMATCH':'PROVIDER_DISAGREEMENT'})},evidence:[...(a.evidence||[]),...(b.evidence||[]).map(e=>({...e,role:'cross-check'}))]};
  }else if(found(a)){
   out[key]={...a,crossCheck:{state:'UNAVAILABLE',providers:[a.source],reasonCode:secondaryReason||(b?.reasonCode)||'SECONDARY_SOURCE_NO_DATA',checkedAt:at}};
  }else if(found(b)){
   out[key]={...b,crossCheck:{state:'SINGLE_PROVIDER_FALLBACK',providers:[b.source],reasonCode:a?.reasonCode||'PRIMARY_SOURCE_NO_DATA',checkedAt:at}};
  }
 }
 for(const key of Object.keys(secondary||{})){if(KEYS.includes(key))continue;if(!found(out[key])&&found(secondary[key])&&out[key]?.dataState!=='DATA_FOUND')out[key]=secondary[key];}
 return out;
}
async function inspect(network,address,{dexInspect=dex.inspect,geckoInspect=gecko.inspect,now=Date.now,env=process.env}={}){
 const t=now();
 if(!enabled(env))return dexInspect(network,address);
 const useSecondary=t>=coolUntil;
 const [d,g]=await Promise.allSettled([dexInspect(network,address),useSecondary?geckoInspect(network,address):Promise.reject(Object.assign(Error('skipped'),{code:'SECONDARY_COOLDOWN'}))]);
 const primary=d.status==='fulfilled'?d.value:null;
 let secondary=null,secondaryReason=null;
 if(g.status==='fulfilled')secondary=stamp(g.value?.fields,t);
 else{
  const e=g.reason||{};secondaryReason=e.code||'SECONDARY_SOURCE_UNAVAILABLE';
  if(/HTTP (429|5\d\d)/.test(String(e.message))){coolUntil=t+COOLDOWN_MS;secondaryReason=/429/.test(e.message)?'SECONDARY_RATE_LIMITED':'SECONDARY_SERVER_ERROR';}
 }
 if(!primary&&!secondary)throw d.reason||g.reason||Error('No market provider');
 return merge(primary,secondary,{now:t,secondaryReason});
}
function _reset(){coolUntil=0;coolReason=null;}
module.exports={inspect,merge,enabled,TOLERANCE,_reset};
