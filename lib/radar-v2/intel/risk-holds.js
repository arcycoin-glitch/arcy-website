'use strict';
// Radar V4 critical negative-evidence ledger. Exact chain+contract, not a ticker blacklist.
// Read from the trusted data branch at the START of every scheduled run. Never auto-expire a verified
// critical exit failure just because a later provider fails, a pool isn't selected, or RPC budget runs out.
// Data-branch schema validation is NOT a cryptographic signature; branch write access is the trust boundary.
const CHAINS=Object.freeze({arc:5042,ethereum:1,robinhood:4663,pons:4663});
const ADDR=/^0x[0-9a-f]{40}$/;
const POOL=/^0x[0-9a-f]{40}$|^0x[0-9a-f]{64}$/;
const SEEDS=Object.freeze([Object.freeze({
 key:'5042:0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e',
 network:'arc',chainId:5042,address:'0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e',
 state:'HELD',reason:'LOW_EXIT_LIQUIDITY',alsoObserved:['SOURCE_CONTRADICTION'],
 firstObservedAt:'2026-11-17T22:13:54.493Z',lastNegativeAt:'2026-11-17T22:13:54.493Z',
 pool:null,poolEvidence:'NOT_RECORDED_IN_HISTORICAL_AUDIT',
 sourceUrl:'https://github.com/arcycoin-glitch/arcy-website/actions/runs/44187516676/job/134407888322',
 evidence:'REAL_SOURCE_EXIT_FAILED_VERIFIED_1000_USD',recovery:null
})]);
const timestamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const url=s=>typeof s==='string'&&s.startsWith('https://')&&s.length<=400;
function valid(x){
 if(!x||typeof x!=='object'||!Object.hasOwn(CHAINS,x.network)||x.chainId!==CHAINS[x.network]||
  !ADDR.test(x.address)||x.key!==x.chainId+':'+x.address||
  !['HELD','CLEARED'].includes(x.state)||x.reason!=='LOW_EXIT_LIQUIDITY'||
  !timestamp(x.firstObservedAt)||!timestamp(x.lastNegativeAt)||!url(x.sourceUrl)||
  !(x.pool===null||POOL.test(x.pool))||!['REAL_SOURCE_EXIT_FAILED_VERIFIED_1000_USD','VERIFIED_REVIEWED_POOL_EXIT_FAILED'].includes(x.evidence)||
  !Array.isArray(x.alsoObserved)||x.alsoObserved.length>5)return false;
 if(x.state==='CLEARED'){
  const r=x.recovery;
  return r&&timestamp(r.at)&&Date.parse(r.at)>Date.parse(x.lastNegativeAt)&&
   r.pool&&POOL.test(r.pool)&&Number.isSafeInteger(r.block)&&r.block>0&&
   Number.isInteger(r.verifiedSizes)&&r.verifiedSizes>0&&r.executableUsd>= (x.chainId===1?5000:1000)&&
   Number.isFinite(r.costLimitPpm)&&r.costLimitPpm===50000&&
   r.sourceConsistency==='CONSISTENT'&&url(r.sourceUrl)&&typeof r.model==='string'&&r.model.length>0;
 }
 return x.recovery===null;
}
function validate(ledger){
 if(!Array.isArray(ledger)||ledger.length>500)return {ok:false,reason:'INVALID_CRITICAL_LEDGER'};
 const keys=new Set();
 for(const e of ledger){if(!valid(e)||keys.has(e.key))return {ok:false,reason:'INVALID_OR_DUPLICATE_CRITICAL_ENTRY'};keys.add(e.key);}
 if(SEEDS.some(s=>!keys.has(s.key)))return {ok:false,reason:'AUDITED_CRITICAL_HOLD_MISSING'};
 return {ok:true};
}
function initial(previous){
 const out=new Map(SEEDS.map(x=>[x.key,{...x,alsoObserved:[...x.alsoObserved]}]));
 if(validate(previous).ok)for(const x of previous)out.set(x.key,structuredClone(x));
 return out;
}
// Only sealed adapter output from the current in-process run may call observe. Failure proof is
// a verified reviewed-pool $1k/$5k exit quote; clearance additionally needs fresh price-source
// agreement, factory-verified exact pool, identified block and a newer successful quote.
function observe(ledger,c,{exit,sourceConsistency,poolVerified,now}={}){
 const key=c.chainId+':'+String(c.address||'').toLowerCase(),prior=ledger.get(key)||null;
 const pool=typeof c.pool==='string'?c.pool.toLowerCase():null;
 const same=poolVerified&&POOL.test(pool||'')&&
  (prior?.pool===null||!prior||prior.pool===pool);
 const verified=poolVerified&&pool&&exit&&url(exit.sourceUrl)&&
  Number.isInteger(exit.verifiedSizes)&&exit.verifiedSizes>0&&
  typeof exit.model==='string'&&exit.model.length>0;
 const observedAt=new Date(now).toISOString();
 if(verified&&exit.status==='EXIT_FAILED_VERIFIED'&&exit.executableUsd===0){
  const entry={
   key,network:c.network,chainId:c.chainId,address:c.address.toLowerCase(),
   state:'HELD',reason:'LOW_EXIT_LIQUIDITY',
   alsoObserved:sourceConsistency==='CONTRADICTED'?['SOURCE_CONTRADICTION']:[],
   firstObservedAt:prior?.firstObservedAt||observedAt,lastNegativeAt:observedAt,
   pool:pool,poolEvidence:'REVIEWED_POOL_IDENTIFIED_ONCHAIN',sourceUrl:exit.sourceUrl,
   evidence:'VERIFIED_REVIEWED_POOL_EXIT_FAILED',recovery:null
  };
  if(valid(entry)){ledger.set(key,entry);return entry;}
 }
 if(prior?.state==='HELD'&&verified&&same&&
   exit.status==='EXIT_SIMULATED'&&exit.executableUsd>=(c.chainId===1?5000:1000)&&
   Number.isSafeInteger(exit.block)&&exit.block>0&&sourceConsistency==='CONSISTENT'&&
   Date.parse(observedAt)>Date.parse(prior.lastNegativeAt)){
  const entry={...prior,state:'CLEARED',recovery:{
   at:observedAt,pool,block:exit.block,verifiedSizes:exit.verifiedSizes,
   executableUsd:exit.executableUsd,costLimitPpm:50000,model:exit.model,
   sourceUrl:exit.sourceUrl,sourceConsistency:'CONSISTENT'}};
  if(valid(entry)){ledger.set(key,entry);return entry;}
 }
 return prior;
}
function list(ledger){return [...ledger.values()].sort((a,b)=>a.key.localeCompare(b.key));}
module.exports={SEEDS,initial,observe,validate,list};
