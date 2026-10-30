'use strict';
// Shared provider budget for Radar: monthly credits + per-minute call gate + shared 429 cooldown. Atomic in Redis (Upstash REST EVAL)
// when the worker has credentials; process memory otherwise. Runs ONLY inside the Railway worker (Redis is private to it).
// Invariants (tested against a real redis-server):
//   * the monthly counter only INCREASES through 'reserve' (refused atomically at cap); 'settle' can only REFUND (negative)
//   * a reserve is also refused while a shared cooldown is active or when the per-minute window is full (nothing is counted then)
//   * 'cooldown' only sets a TTL key (1..600 s); it never changes counters
const redisConfig=require('./redis-config');
const SCRIPT=[
 "local mode=ARGV[3] local n=tonumber(ARGV[1]) local cap=tonumber(ARGV[2]) local perMin=tonumber(ARGV[4] or '0')",
 "if mode=='cooldown' then local ms=tonumber(ARGV[1]) local old=redis.call('PTTL',KEYS[3]) if old>ms then ms=old end redis.call('SET',KEYS[3],'1','PX',ms) return {1,ms} end",
 "if mode=='reserve' then",
 " local cd=redis.call('PTTL',KEYS[3]) if cd>0 then return {3,cd} end",
 " local c=tonumber(redis.call('GET',KEYS[1]) or '0') if c+n>cap then return {0,c} end",
 " if perMin>0 then local m=tonumber(redis.call('GET',KEYS[2]) or '0') if m+n>perMin then local t=redis.call('PTTL',KEYS[2]) return {2,t} end redis.call('INCRBY',KEYS[2],n) if redis.call('PTTL',KEYS[2])<0 then redis.call('PEXPIRE',KEYS[2],60000) end end",
 "end",
 "local v=redis.call('INCRBY',KEYS[1],n) if v<0 then redis.call('SET',KEYS[1],0) v=0 end redis.call('EXPIRE',KEYS[1],3456000) return {1,v}"
].join(' ');
const mem=new Map(),memMinute=new Map();let memCool=0;
const HARD_CEILING=8000,MAX_PER_MINUTE=60;
function valid(b){
 if(!b||!['reserve','settle','cooldown'].includes(b.mode))return false;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month||''))return false;
 if(b.mode==='cooldown')return Number.isInteger(b.ms)&&b.ms>=1000&&b.ms<=600000;
 if(!Number.isInteger(b.cap)||b.cap<=0||b.cap>HARD_CEILING)return false;
 if(b.perMinute!==undefined&&!(Number.isInteger(b.perMinute)&&b.perMinute>=1&&b.perMinute<=MAX_PER_MINUTE))return false;
 return Number.isInteger(b.credits)&&(b.mode==='reserve'?b.credits>=1&&b.credits<=64:b.credits>=-64&&b.credits<=-1);
}
function shape(code,x,cap,store,b){
 if(code===1)return {ok:true,granted:true,spent:Number(x),cap,store};
 if(code===0)return {ok:true,granted:false,reason:'MONTHLY_CAP',spent:Number(x),cap,store};
 if(code===2)return {ok:true,granted:false,reason:'MINUTE_CAP',retryInMs:Math.max(1000,Number(x)||60000),cap,store};
 return {ok:true,granted:false,reason:'COOLDOWN',retryInMs:Math.max(1000,Number(x)||60000),cap,store};
}
async function apply(b,{fetchImpl=fetch,config=redisConfig(),now=Date.now,durableDir=(process.env.ARC_HOLDER_STORAGE==='local'?process.env.ARC_INDEX_CACHE_DIR:null)}={}){
 if(!valid(b))return {ok:false,reasonCode:'QUOTA_REQUEST_INVALID'};
 const base='arcy:radar:',monthKey=base+'credits:'+b.month,minuteKey=base+'rate:'+Math.floor(now()/60000),coolKey=base+'cooldown';
 if(config.url&&config.token){
  try{
   const args=b.mode==='cooldown'?[String(b.ms),'0','cooldown','0']:[String(b.credits),String(b.cap),b.mode,String(b.perMinute||0)];
   const r=await fetchImpl(config.url.replace(/\/$/,''),{method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},body:JSON.stringify(['EVAL',SCRIPT,'3',monthKey,minuteKey,coolKey,...args]),signal:AbortSignal.timeout(2000)});
   const d=await r.json();if(!r.ok||!Array.isArray(d?.result))throw new Error('redis');
   return shape(Number(d.result[0]),d.result[1],b.cap,'redis',b);
  }catch{return {ok:false,reasonCode:'QUOTA_STORE_UNAVAILABLE'};}
 }
 if(durableDir)return require('./quota-volume').apply(b,{dir:durableDir,now,shape});
 // Worker-memory fallback for tests/development without durable storage.
 const t=now();
 if(b.mode==='cooldown'){memCool=t+b.ms;return {ok:true,granted:true,store:'worker-memory',cap:b.cap};}
 if(b.mode==='reserve'&&memCool>t)return shape(3,memCool-t,b.cap,'worker-memory',b);
 const c=mem.get(monthKey)||0;
 if(b.mode==='reserve'&&c+b.credits>b.cap)return shape(0,c,b.cap,'worker-memory',b);
 if(b.mode==='reserve'&&b.perMinute){const mk=Math.floor(t/60000),m=memMinute.get(mk)||0;if(m+b.credits>b.perMinute)return shape(2,(mk+1)*60000-t,b.cap,'worker-memory',b);memMinute.clear();memMinute.set(mk,m+b.credits);}
 const v=Math.max(0,c+b.credits);mem.set(monthKey,v);return shape(1,v,b.cap,'worker-memory',b);
}
function _reset(){mem.clear();memMinute.clear();memCool=0;}
module.exports={apply,valid,_reset,HARD_CEILING,MAX_PER_MINUTE,SCRIPT};
