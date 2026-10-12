'use strict';
const net=require('node:net');

// Per-runtime defense in depth only. Vercel instances do not share this Map.
// Before public rollout configure a distributed Vercel WAF per-IP rate limit.
function clientIdentity(req,vercel=process.env.VERCEL==='1'){
 const get=k=>{
  const h=req?.headers||{};
  const v=h[k]??h[k.toLowerCase()];
  return typeof v==='string'?v.trim():null;
 };
 let ip=null;
 if(vercel){
  // Vercel overwrites these canonical headers at its trusted edge.
  // Never trust a caller-controlled XFF list when not behind Vercel.
  const canonical=get('x-vercel-forwarded-for')||get('x-real-ip');
  if(canonical&&net.isIP(canonical))ip=canonical;
 }else{
  const socket=req?.socket?.remoteAddress;
  if(typeof socket==='string'&&net.isIP(socket))ip=socket;
 }
 // Shared unknown bucket is safer than using spoofable user-provided headers.
 return ip||'unknown';
}
function createLimiter({limit=24,windowMs=60000,maxClients=4096,now=Date.now}={}){
 if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(windowMs)||windowMs<1000||!Number.isSafeInteger(maxClients)||maxClients<1)throw Error('Invalid rate-limit configuration');
 const clients=new Map();
 function check(req,{vercel=process.env.VERCEL==='1'}={}){
  const t=now(),identity=clientIdentity(req,vercel);
  if(!Number.isFinite(t))throw Error('Invalid rate-limit clock');
  let entry=clients.get(identity);
  if(entry&&t-entry.start>=windowMs){clients.delete(identity);entry=null}
  if(!entry){
   if(clients.size>=maxClients){
    for(const [key,value] of clients)if(t-value.start>=windowMs)clients.delete(key);
   }
   if(clients.size>=maxClients)return {allowed:false,limit,remaining:0,retryAfter:Math.ceil(windowMs/1000),reason:'CAPACITY'};
   entry={start:t,count:0};
   clients.set(identity,entry);
  }
  const remainingMs=Math.max(1,windowMs-(t-entry.start));
  if(entry.count>=limit)return {allowed:false,limit,remaining:0,retryAfter:Math.ceil(remainingMs/1000),reason:'LIMIT'};
  entry.count+=1;
  return {allowed:true,limit,remaining:limit-entry.count,retryAfter:0,reason:null};
 }
 return {check,size:()=>clients.size};
}
const limiter=createLimiter();
function enforce(req,res){
 const result=limiter.check(req);
 res.setHeader('RateLimit-Limit',String(result.limit));
 res.setHeader('RateLimit-Remaining',String(result.remaining));
 if(result.allowed)return true;
 res.setHeader('Retry-After',String(result.retryAfter));
 res.status(429).json({ok:false,error:'RATE_LIMITED',reason:'Too many requests. Please retry shortly.',retryAfterSeconds:result.retryAfter});
 return false;
}
module.exports={clientIdentity,createLimiter,enforce};
