const c=require('./core');
const priorities={ONCHAIN_VERIFIED:0,CONTRACT_SOURCE_VERIFIED:1,INDEXER_VERIFIED:2,MARKET_API_VERIFIED:3,OFFICIAL_DOCUMENTATION:4,NOT_VERIFIED:5};
function field(value,status,source,evidence=[],confidence='HIGH',reason=null){return {value,status:value===null?'NOT_VERIFIED':status,source,evidence,confidence,reason:value===null?reason||'Reliable value not established.':reason,dataState:value===null?'NOT_VERIFIED':'DATA_FOUND'};}
async function resolve(adapters){const attempts=[];for(const adapter of [...adapters].sort((a,b)=>(priorities[a.tier]??5)-(priorities[b.tier]??5))){try{const result=await adapter.read();attempts.push({source:adapter.name,status:result.status,reasonCode:result.reasonCode,dataState:result.dataState,reason:result.reason,httpStatus:result.httpStatus,evidence:result.evidence,coverage:result.coverage,apiCode:result.apiCode});if(result.value!==null&&result.value!==undefined&&result.status!=='NOT_VERIFIED')return {...result,attempts};}catch(e){attempts.push({source:adapter.name,...c.failure(e)});}}return {...field(null,'NOT_VERIFIED',null,[],'NONE','All configured reliable adapters were exhausted.'),reasonCode:'FALLBACKS_EXHAUSTED',attempts};}
// Start independent exact-contract readers together, but retain the same evidence
// preference as resolve(). This bounds an unsupported field by the slowest reader
// rather than the sum of every fallback, without promoting a lower-tier answer.
async function resolveParallel(adapters){
 const ordered=[...adapters].sort((a,b)=>(priorities[a.tier]??5)-(priorities[b.tier]??5)),attempts=[];
 const reads=ordered.map(adapter=>Promise.resolve().then(adapter.read).then(result=>({result,attempt:{source:adapter.name,status:result.status,reasonCode:result.reasonCode,dataState:result.dataState,reason:result.reason,httpStatus:result.httpStatus,evidence:result.evidence,coverage:result.coverage,apiCode:result.apiCode}}),error=>({result:null,attempt:{source:adapter.name,...c.failure(error)}})));
 for(const read of reads){const completed=await read;attempts.push(completed.attempt);const result=completed.result;if(result?.value!==null&&result?.value!==undefined&&result.status!=='NOT_VERIFIED')return {...result,attempts};}
 return {...field(null,'NOT_VERIFIED',null,[],'NONE','All configured reliable adapters were exhausted.'),reasonCode:'FALLBACKS_EXHAUSTED',attempts};
}
const cache=new Map();
async function cached(key,ttl,fn){
 const refresh=require('./search-request'),defaultTtl=ttl;ttl=refresh.ttl(key,ttl);const cacheKey=refresh.key(key),old=cache.get(cacheKey),previous=old?.value?old:cache.get(key);
 if(old&&(old.pending||(ttl>0&&old.until>Date.now())))return old.promise;
 const entry={pending:true,until:0,startedAt:refresh.startedAt()};
 entry.promise=Promise.resolve().then(fn).then(value=>refresh.stale(key,previous,value)||value,error=>{const last=refresh.stale(key,previous,null,error);if(last)return last;throw error;});cache.set(cacheKey,entry);
 try{const value=await entry.promise;entry.value=value;entry.observedAt=value?.freshness?.state==='LAST_VERIFIED'?value.freshness.observedAt:new Date().toISOString();entry.until=Date.now()+(value?.dataState&&value.dataState!=='DATA_FOUND'?Math.min(ttl,10000):ttl);if(cacheKey!==key&&(!cache.get(key)||cache.get(key).startedAt<=entry.startedAt))cache.set(key,{...entry,pending:false,until:Date.now()+(value?.dataState&&value.dataState!=='DATA_FOUND'?Math.min(defaultTtl,10000):defaultTtl)});return value;}
 catch(e){entry.until=Date.now()+Math.min(ttl,10000);throw e;}
 finally{entry.pending=false;if(cache.size>250){for(const [k,v]of cache)if(!v.pending&&v.until<=Date.now())cache.delete(k);if(cache.size>250){const idle=[...cache].find(([,v])=>!v.pending);if(idle)cache.delete(idle[0]);}}}
}
module.exports={field,resolve,resolveParallel,cached,priorities,clearCache:()=>cache.clear()};
