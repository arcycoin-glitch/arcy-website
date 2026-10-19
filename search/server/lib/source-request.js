'use strict';
// Search-only bounded public reads. Failures are never cached as evidence.
const {readJson}=require('./http');
const diagnostics=require('./diagnostics');
function createReader({ttlMs=15000,maxEntries=128,now=Date.now}={}){
 const cache=new Map(),pending=new Map(),cooldowns=new Map(),failures=new Map();let active=0;
 function checked(body,validate,maxBytes=Infinity){if(Buffer.byteLength(JSON.stringify(body))>maxBytes)throw Object.assign(Error('Source exceeds consumer size limit'),{code:'SOURCE_SCHEMA_INVALID'});if(!validate(body))throw Object.assign(Error('Source schema invalid'),{code:'SOURCE_SCHEMA_INVALID'});return structuredClone(body)}
 async function json(raw,{fetcher=global.fetch,timeoutMs=6500,maxBytes=1024*1024,validate=()=>true}={}){
  const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password)throw Error('Unsafe source URL');
  const key=url.href,requestKey=JSON.stringify([key,timeoutMs,maxBytes]),t=now(),hit=cache.get(key),cooldown=cooldowns.get(url.origin);
  const label=diagnostics.provider(key),observe=(outcome,ms)=>diagnostics.record('source',label,outcome,ms);
  if(hit&&t<hit.expires){observe('cache_hit');return checked(hit.body,validate,maxBytes)}
  if(pending.has(requestKey)){observe('coalesced');return checked(await pending.get(requestKey),validate,maxBytes)}
  if(cooldown&&t<cooldown){observe('circuit_open');throw Object.assign(Error('Source cooling down'),{code:'SOURCE_RATE_LIMIT',httpStatus:429})}
  const breaker=failures.get(url.origin);
  if(breaker?.until>t){observe('circuit_open');throw Object.assign(Error('Source temporarily unavailable'),{code:'SOURCE_CIRCUIT_OPEN'})}
  if(active>=8){observe('overloaded');throw Object.assign(Error('Source concurrency limit'),{code:'SOURCE_CAPACITY_LIMIT'})}
  observe('cache_miss');active++;
  const task=(async()=>{
   const controller=new AbortController();
   // A true wall-clock deadline covers both fetch and body parsing, even when
   // a custom fetcher or response stream ignores AbortSignal.
   let timer;
   const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
     controller.abort();
     reject(Object.assign(Error('Source deadline exceeded'),{code:'SOURCE_TIMEOUT'}));
    },Math.min(12000,Math.max(1,timeoutMs)));
   });
   try{
    const response=await Promise.race([fetcher(key,{headers:{accept:'application/json'},signal:controller.signal}),deadline]);
    if(!response.ok){
     if(response.status===429){const raw=response.headers?.get?.('retry-after'),seconds=Number(raw),delay=raw?(Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-now()):30000;cooldowns.set(url.origin,now()+Math.min(120000,Math.max(1000,Number.isFinite(delay)?delay:30000)));while(cooldowns.size>32)cooldowns.delete(cooldowns.keys().next().value);}
     // Cancellation is best-effort; a broken stream must not hold the error path open.
     Promise.resolve().then(()=>response.body?.cancel?.()).catch(()=>{});
     throw Object.assign(Error('Source HTTP '+response.status),{code:'SOURCE_HTTP_ERROR',httpStatus:response.status});
    }
    const body=await Promise.race([readJson(response,maxBytes),deadline]);checked(body,validate);
    if(controller.signal.aborted)throw Object.assign(Error('Source request timed out'),{code:'SOURCE_TIMEOUT'});
    failures.delete(url.origin);observe('ok',now()-t);
    cache.delete(key);cache.set(key,{body:structuredClone(body),observedAt:now(),expires:now()+ttlMs});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
    return body;
   }catch(error){
    observe(diagnostics.category(error),now()-t);
    if(error.httpStatus>=500||['AbortError','TimeoutError','TypeError'].includes(error.name)||error.code==='SOURCE_TIMEOUT'){
     const prior=failures.get(url.origin),count=(prior?.count||0)+1;
     failures.set(url.origin,{count,until:count>=3?now()+30000:0});while(failures.size>32)failures.delete(failures.keys().next().value);
    }
    throw error;
   }finally{active--;clearTimeout(timer);}
  })();pending.set(requestKey,task);
  try{return checked(await task,validate,maxBytes);}finally{if(pending.get(requestKey)===task)pending.delete(requestKey);}
 }
 return {json,observedAt:url=>cache.get(String(url))?.observedAt};
}
module.exports={createReader};
