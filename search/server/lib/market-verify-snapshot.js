'use strict';
// Durable on-chain market verification (#356): expensive 24h Swap-log reconstruction runs OUTSIDE the request path
// (scripts/market-verify-snapshot.cjs, scheduled GitHub Actions job) and is published to the data-only branch
// `market-verify-snapshots`. Reports read ONE cached, size/time-bounded document through an immutable commit URL.
// A record is used only when it is fresh (<= 3 h), for the exact chain + token, and when its covered pools are a SUBSET of the
// provider pools the current report summed. Missing/invalid/stale snapshot => no field (existing behaviour unchanged).
const HOST='raw.githubusercontent.com',REPO_PATH='/arcycoin-glitch/arcy-website/',FILE='/market-verify/snapshot.json',REF='market-verify-snapshots';
const REF_API='https://api.github.com/repos/arcycoin-glitch/arcy-website/git/ref/heads/';
const SCHEMA='arcy-market-verify-snapshot/1',FRESH_MS=3*3600000,CACHE_MS=5*60000,MAX_BYTES=2000000,TIMEOUT_MS=1500,COVERAGE_MIN=0.95,REGISTRY_MAX_AGE_MS=14*86400000;
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
// Provider-independent record (#367): 24h volume + same-block TVL over the token's persisted REGISTRY pool list (factory-discovered and
// previously provider-observed pools, every one re-proved on-chain by the volume engine). No provider value is needed to read it.
function discoveredVolumeField(doc,network,token,{now=Date.now()}={}){
 if(!doc)return {reason:'VOLUME_SNAPSHOT_UNAVAILABLE'};
 const age=now-Date.parse(doc.generatedAt);if(!(age>=-60000&&age<=FRESH_MS))return {reason:'VOLUME_SNAPSHOT_STALE'};
 const e=doc.entries[network+':'+String(token).toLowerCase()],f=e?.volumeDiscovered;
 if(!f)return {reason:e?.volumeDiscoveredReason||'VOLUME_REGISTRY_NO_RECORD'};
 const ev=f.evidence?.[0];
 if(f.dataState!=='DATA_FOUND'||!(Number(f.value)>=0)||ev?.method!=='arcy-market-volume-1'||!Array.isArray(ev.pairs)||!ev.pairs.length||!ev.pairs.every(p=>POOL.test(p))||!Array.isArray(ev.pools)||ev.pools.length!==ev.pairs.length)return {reason:'VOLUME_REGISTRY_RECORD_INVALID'};
 return {field:{...f,freshness:{...(f.freshness||{}),state:'SNAPSHOT',snapshotGeneratedAt:doc.generatedAt,ageMs:Math.max(0,age)}}};
}
function registryPools(doc,network,token,{now=Date.now()}={}){
 const r=doc?.registry?.[network+':'+String(token).toLowerCase()];if(!r||!Array.isArray(r.pools))return [];
 return r.pools.filter(x=>x&&POOL.test(String(x.pool))&&Number.isFinite(Date.parse(x.lastSeen))&&now-Date.parse(x.lastSeen)<=REGISTRY_MAX_AGE_MS).map(x=>String(x.pool).toLowerCase());
}
function _reset(){cached=null;pending=null;}
module.exports={load,volumeField,discoveredVolumeField,registryPools,REGISTRY_MAX_AGE_MS,valid,SCHEMA,FRESH_MS,COVERAGE_MIN,REF,FILE,_reset};
