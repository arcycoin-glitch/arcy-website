'use strict';
// Durable on-chain market verification (#356): expensive 24h Swap-log reconstruction runs OUTSIDE the request path
// (scripts/market-verify-snapshot.cjs, scheduled GitHub Actions job) and is published to the data-only branch
// `market-verify-snapshots`. Reports read ONE cached, size/time-bounded document through an immutable commit URL.
// A record is used only when it is fresh (<= 3 h), for the exact chain + token, and when its covered pools are a SUBSET of the
// provider pools the current report summed. Missing/invalid/stale snapshot => no field (existing behaviour unchanged).
const HOST='raw.githubusercontent.com',REPO_PATH='/arcycoin-glitch/arcy-website/',FILE='/market-verify/snapshot.json',REF='market-verify-snapshots';
const REF_API='https://api.github.com/repos/arcycoin-glitch/arcy-website/git/ref/heads/';
const SCHEMA='arcy-market-verify-snapshot/1',FRESH_MS=3*3600000,CACHE_MS=5*60000,MAX_BYTES=2000000,TIMEOUT_MS=1500,COVERAGE_MIN=0.95;
const ADDRESS=/^0x[0-9a-f]{40}$/,POOL=/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
let cached=null,pending=null;
function valid(doc,now){
 if(!doc||doc.schema!==SCHEMA||typeof doc.generatedAt!=='string')return false;
 const t=Date.parse(doc.generatedAt);if(!Number.isFinite(t)||t>now+60000)return false;
 return doc.entries&&typeof doc.entries==='object'&&!Array.isArray(doc.entries);
}
async function load({fetcher=globalThis.fetch,now=Date.now(),env=process.env}={}){
 if(env.SEARCH_MARKET_VERIFY_SNAPSHOT==='off')return null;
 if(cached&&now-cached.at<CACHE_MS)return cached.doc;
 if(pending)return pending;
 pending=(async()=>{
  try{
   const ref=await fetcher(REF_API+REF,{headers:{accept:'application/vnd.github+json','user-agent':'ARCY-Market-Verify-ReadOnly'},redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS)});
   if(!ref.ok)throw Error('ref');const sha=(await ref.json())?.object?.sha;if(!/^[0-9a-f]{40}$/.test(sha||''))throw Error('sha');
   const r=await fetcher('https://'+HOST+REPO_PATH+sha+FILE,{redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS)});
   const len=Number(r.headers?.get?.('content-length'));if(!r.ok||len>MAX_BYTES)throw Error('doc');
   const text=await r.text();if(text.length>MAX_BYTES)throw Error('size');
   const doc=JSON.parse(text);if(!valid(doc,now))throw Error('schema');
   cached={at:now,doc};return doc;
  }catch{cached={at:now,doc:cached?.doc||null};return cached.doc;}
  finally{pending=null;}
 })();
 return pending;
}
// Returns a secondary volume24h field from a fresh, scope-compatible snapshot record, or {reason}.
function volumeField(doc,network,token,primary,{now=Date.now()}={}){
 if(!doc)return {reason:'VOLUME_SNAPSHOT_UNAVAILABLE'};
 const age=now-Date.parse(doc.generatedAt);if(!(age>=-60000&&age<=FRESH_MS))return {reason:'VOLUME_SNAPSHOT_STALE'};
 const e=doc.entries[network+':'+String(token).toLowerCase()];const f=e?.volume24h;
 if(!f)return {reason:e?.volumeReason||'VOLUME_SNAPSHOT_NO_RECORD'};
 const ev=f.evidence?.[0],cov=Number(ev?.coverageOfProviderVolume);
 if(f.dataState!=='DATA_FOUND'||!(Number(f.value)>=0)||!Number.isFinite(cov)||cov<COVERAGE_MIN||cov>1||!Array.isArray(ev?.pairs)||!ev.pairs.length||!ev.pairs.every(p=>POOL.test(p)))return {reason:'VOLUME_SNAPSHOT_RECORD_INVALID'};
 const provider=new Set((primary?.volume24h?.evidence||[]).flatMap(x=>Array.isArray(x?.pairs)?x.pairs:[]).map(x=>String(x).toLowerCase()));
 if(!ev.pairs.every(p=>provider.has(p)))return {reason:'VOLUME_SNAPSHOT_SCOPE_CHANGED'};
 return {field:{...f,freshness:{...(f.freshness||{}),state:'SNAPSHOT',snapshotGeneratedAt:doc.generatedAt,ageMs:Math.max(0,age)}}};
}
// Persisted, hash-proven V4 PoolKeys (#365/#367). A PoolKey is immutable, so a stored key never goes stale; the CALLER re-proves
// keccak256(abi.encode(PoolKey)) == poolId before use, so the document is trusted for nothing.
const A40=/^0x[0-9a-f]{40}$/;
function v4KeyFor(doc,network,id){
 const k=doc?.v4Keys?.[network+':'+String(id).toLowerCase()];
 if(!k||![k.currency0,k.currency1,k.hooks].every(a=>typeof a==='string'&&A40.test(a))||!Number.isInteger(k.fee)||!Number.isInteger(k.tickSpacing))return null;
 return {currency0:k.currency0,currency1:k.currency1,fee:k.fee,tickSpacing:k.tickSpacing,hooks:k.hooks};
}
function _reset(){cached=null;pending=null;}
module.exports={load,v4KeyFor,volumeField,valid,SCHEMA,FRESH_MS,COVERAGE_MIN,REF,FILE,_reset};
