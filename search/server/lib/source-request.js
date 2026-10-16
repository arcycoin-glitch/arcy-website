'use strict';
// Search-only bounded public reads. Failures are never cached as evidence.
const {readJson}=require('./http');
function createReader({ttlMs=15000,maxEntries=128,now=Date.now}={}){
 const cache=new Map(),pending=new Map(),cooldowns=new Map();
 async function json(raw,{fetcher=global.fetch,timeoutMs=6500,maxBytes=1024*1024,validate=()=>true}={}){
  const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password)throw Error('Unsafe source URL');
  const key=url.href,t=now(),hit=cache.get(key),cooldown=cooldowns.get(url.origin);
  if(hit&&t<hit.expires)return structuredClone(hit.body);
  if(pending.has(key))return structuredClone(await pending.get(key));
  if(cooldown&&t<cooldown)throw Object.assign(Error('Source cooling down'),{code:'SOURCE_RATE_LIMIT',httpStatus:429});
  const task=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(12000,Math.max(1,timeoutMs)));
   try{
    const response=await fetcher(key,{headers:{accept:'application/json'},signal:controller.signal});
    if(!response.ok){
     if(response.status===429){const raw=response.headers?.get?.('retry-after'),seconds=Number(raw),delay=raw&&Number.isFinite(seconds)?seconds*1000:30000;cooldowns.set(url.origin,now()+Math.min(120000,Math.max(1000,delay)));while(cooldowns.size>32)cooldowns.delete(cooldowns.keys().next().value);}
     throw Object.assign(Error('Source HTTP '+response.status),{code:'SOURCE_HTTP_ERROR',httpStatus:response.status});
    }
    const body=await readJson(response,maxBytes);if(!validate(body))throw Error('Source schema invalid');
    if(controller.signal.aborted)throw Error('Source request timed out');
    cache.delete(key);cache.set(key,{body:structuredClone(body),observedAt:now(),expires:now()+ttlMs});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
    return body;
   }finally{clearTimeout(timer);}
  })();pending.set(key,task);
  try{return structuredClone(await task);}finally{if(pending.get(key)===task)pending.delete(key);}
 }
 return {json,observedAt:url=>cache.get(String(url))?.observedAt};
}
module.exports={createReader};
