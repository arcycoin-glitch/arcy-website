'use strict';
// Central, durable admission budget for first-time Arc Holder work requested by public Search.
// The existing authenticated /queue endpoint and Radar quota are unchanged.
const quotaVolume=require('./quota-volume');
const redisConfig=require('./redis-config');
const DAILY_LIMIT=8,MINUTE_LIMIT=1;
const SCRIPT=[
 "local daily=tonumber(redis.call('GET',KEYS[1]) or '0')",
 "local minute=tonumber(redis.call('GET',KEYS[2]) or '0')",
 "if daily>=tonumber(ARGV[1]) then return {0,daily} end",
 "if minute>=tonumber(ARGV[2]) then return {2,redis.call('PTTL',KEYS[2])} end",
 "local d=redis.call('INCR',KEYS[1])",
 "if redis.call('TTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],172800) end",
 "redis.call('INCR',KEYS[2])",
 "if redis.call('TTL',KEYS[2])<0 then redis.call('EXPIRE',KEYS[2],60) end",
 "return {1,d}"
].join(' ');
function shape(code,value,cap,store){
 if(code===1)return {ok:true,granted:true,store,used:Number(value),cap};
 if(code===0)return {ok:true,granted:false,reasonCode:'SEARCH_HOLDER_DAILY_CAP',store,used:Number(value),cap};
 return {ok:true,granted:false,reasonCode:'SEARCH_HOLDER_MINUTE_CAP',store,retryInMs:Math.max(1000,Number(value)||60000),cap};
}
async function reserve({now=Date.now,fetchImpl=fetch,config=redisConfig(),storageMode=process.env.ARC_HOLDER_STORAGE,durableDir=process.env.ARC_INDEX_CACHE_DIR}={}){
 const t=now(),day=new Date(t).toISOString().slice(0,10);
 if(config.url||config.token){
  if(!config.url||!config.token)return {ok:false,reasonCode:'SEARCH_HOLDER_ADMISSION_UNAVAILABLE'};
  try{
   const body=['EVAL',SCRIPT,'2','arcy:holder:search:day:'+day,'arcy:holder:search:minute:'+Math.floor(t/60000),String(DAILY_LIMIT),String(MINUTE_LIMIT)];
   const r=await fetchImpl(config.url.replace(/\/$/,''),{method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
   const d=await r.json();
   if(!r.ok||!Array.isArray(d?.result))throw Error('Redis admission unavailable');
   return shape(Number(d.result[0]),d.result[1],DAILY_LIMIT,'redis');
  }catch{return {ok:false,reasonCode:'SEARCH_HOLDER_ADMISSION_UNAVAILABLE'};}
 }
 // Fail closed: public Search must not fall back to a process-local rate limiter.
 if(storageMode!=='local'||!durableDir)return {ok:false,reasonCode:'SEARCH_HOLDER_DURABLE_STORAGE_REQUIRED'};
 return quotaVolume.apply({mode:'reserve',month:day,credits:1,cap:DAILY_LIMIT,perMinute:MINUTE_LIMIT},
  {dir:durableDir,now,shape,fileName:'holder-search-admissions.v1.json'});
}
module.exports={reserve,DAILY_LIMIT,MINUTE_LIMIT};
