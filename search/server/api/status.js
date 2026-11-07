'use strict';
// Operational status: Search API availability, durable Holder worker heartbeat, publication freshness and
// runtime versions. Read-only and cheap: at most four authenticated GETs to the existing worker telemetry routes
// (no live provider probes: ?probe=0), coalesced and cached per instance, so public traffic cannot amplify worker
// load. No blockchain RPC, explorer or market request is made. Never returns URLs, credentials, token addresses
// or queue contents.
const {evaluate}=require('../lib/operational-status');
const {readJson}=require('../lib/http');
const CACHE_MS=30000,TIMEOUT_MS=2500;
let cached=null,inflight=null;
function workerBase(){
 const raw=process.env.ARC_HOLDER_QUEUE_URL,token=process.env.ARC_HOLDER_QUEUE_TOKEN;
 if(!raw||!token)return null;
 try{const u=new URL(raw);return u.protocol==='https:'||process.env.ARCY_STATUS_ALLOW_HTTP==='1'?{origin:u.origin,token}:null;}catch{return null;}
}
async function get(base,path,fetcher){
 try{
  const r=await fetcher(new URL(path,base.origin),{headers:{authorization:'Bearer '+base.token,accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
  if(r.status===404)return {unreachable:true,reasonCode:'ROUTE_NOT_PRESENT'};
  if(!r.ok)return {unreachable:true,reasonCode:r.status===401?'WORKER_AUTH_REJECTED':'WORKER_HTTP_'+r.status};
  return await readJson(r,1024*1024);
 }catch(e){return {unreachable:true,reasonCode:e?.name==='TimeoutError'?'WORKER_TIMEOUT':'WORKER_UNREACHABLE'};}
}
async function collect(fetcher=fetch,now=Date.now()){
 const base=workerBase();
 const runtime={commit:process.env.VERCEL_GIT_COMMIT_SHA||null,
  environment:process.env.VERCEL_ENV==='production'&&process.env.VERCEL==='1'?'production':process.env.VERCEL==='1'?'preview-or-build':'local'};
 if(!base)return evaluate({diagnostics:{notConfigured:true},runtime},now);
 const [diagnostics,pulseAudit,networkPulseAudit,unlockAudit]=await Promise.all([
  get(base,'/holder/rpc-diagnostics?probe=0',fetcher),get(base,'/pulse/audit',fetcher),
  get(base,'/pulse/networks/audit',fetcher),get(base,'/unlocks/audit',fetcher)]);
 // An empty audit object means the route exists but nothing was ever recorded.
 const norm=a=>a&&!a.unreachable&&!Object.keys(a).length?null:a;
 return evaluate({diagnostics:diagnostics?.unreachable?diagnostics:diagnostics?.ok===true?diagnostics:{worker:null},
  pulseAudit:norm(pulseAudit),networkPulseAudit:norm(networkPulseAudit),unlockAudit:norm(unlockAudit),runtime},now);
}
async function current(fetcher){
 const now=Date.now();
 if(cached&&cached.expiresAt>now)return cached.value;
 if(!inflight)inflight=collect(fetcher).then(value=>{cached={value,expiresAt:Date.now()+CACHE_MS};return value;}).finally(()=>{inflight=null;});
 return inflight;
}
module.exports=async function status(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 try{return res.status(200).json({ok:true,product:'ARCY SEARCH',readOnly:true,...await current()});}
 catch{return res.status(200).json({ok:true,product:'ARCY SEARCH',readOnly:true,overall:'UNKNOWN',reasonCode:'STATUS_EVALUATION_FAILED'});}
};
module.exports.collect=collect;
module.exports._reset=()=>{cached=null;inflight=null;};
