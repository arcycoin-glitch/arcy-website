'use strict';
function createCache(loader,{ttlMs=120000,maxEntries=64,now=Date.now}={}){
 if(typeof loader!=='function'||ttlMs<=0||maxEntries<=0)throw Error('Invalid discovery cache');
 const entries=new Map(),inflight=new Map();
 async function find(query){
  const key=query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const t=now(),cached=entries.get(key);
  if(cached&&t-cached.fetchedAt<ttlMs)return {...cached,cacheAgeMs:Math.max(0,t-cached.fetchedAt)};
  if(cached)entries.delete(key);
  if(inflight.has(key))return inflight.get(key);
  const operation=(async()=>{
   const matches=await loader(query);
   if(!Array.isArray(matches))throw Error('Invalid discovery result');
   const value={matches,fetchedAt:now()};
   if(matches.length){
    entries.delete(key);
    entries.set(key,value);
    while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
   }
   return {...value,cacheAgeMs:0};
  })();
  inflight.set(key,operation);
  try{return await operation}finally{inflight.delete(key)}
 }
 return {find,size:()=>entries.size};
}
module.exports={createCache};
