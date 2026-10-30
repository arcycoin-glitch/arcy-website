'use strict';
// Shared monthly provider-credit counter. Atomic in Redis (Upstash REST EVAL) when the worker has credentials; process memory otherwise.
// Runs ONLY inside the Railway worker (Redis is private to it). Never throws secrets; returns {ok,spent,cap,store} or {ok:false,...}.
const redisConfig=require('./redis-config');
const SCRIPT="local c=tonumber(redis.call('GET',KEYS[1]) or '0') local n=tonumber(ARGV[1]) local cap=tonumber(ARGV[2]) if ARGV[3]=='reserve' and c+n>cap then return {0,c} end local v=redis.call('INCRBY',KEYS[1],n) if v<0 then redis.call('SET',KEYS[1],0) v=0 end redis.call('EXPIRE',KEYS[1],3456000) return {1,v}";
const mem=new Map();
const HARD_CEILING=8000;
function valid(b){return b&&/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month||'')&&Number.isInteger(b.credits)&&b.credits>=-64&&b.credits<=64&&Number.isInteger(b.cap)&&b.cap>0&&b.cap<=HARD_CEILING&&(b.mode==='reserve'||b.mode==='settle');}
async function apply(b,{fetchImpl=fetch,config=redisConfig()}={}){
 if(!valid(b))return {ok:false,reasonCode:'QUOTA_REQUEST_INVALID'};
 const key='arcy:radar:credits:'+b.month;
 if(config.url&&config.token){
  try{const r=await fetchImpl(config.url.replace(/\/$/,''),{method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},body:JSON.stringify(['EVAL',SCRIPT,'1',key,String(b.credits),String(b.cap),b.mode]),signal:AbortSignal.timeout(2000)});
   const d=await r.json();if(!r.ok||!Array.isArray(d?.result))throw new Error('redis');
   return {ok:true,granted:d.result[0]===1,spent:Number(d.result[1]),cap:b.cap,store:'redis'};
  }catch{return {ok:false,reasonCode:'QUOTA_STORE_UNAVAILABLE'};}
 }
 const c=mem.get(key)||0;
 if(b.mode==='reserve'&&c+b.credits>b.cap)return {ok:true,granted:false,spent:c,cap:b.cap,store:'worker-memory'};
 const v=Math.max(0,c+b.credits);mem.set(key,v);return {ok:true,granted:true,spent:v,cap:b.cap,store:'worker-memory'};
}
function _reset(){mem.clear();}
module.exports={apply,valid,_reset,HARD_CEILING,SCRIPT};
