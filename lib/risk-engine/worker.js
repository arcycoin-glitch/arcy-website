'use strict';
// Autonomous risk verification on the persistent Railway worker (flag ARC_AUTONOMY_RISK_WORKER_ENABLED=1, default OFF).
//
// Called once per holder-worker loop from lib/holder-refresh.js (the fingerprint-protected scripts/holder-worker.cjs is
// unchanged). Each tick, at most once per TICK_MS:
//  * takes at most MAX_JOBS due tokens from the durable queue (lib/risk-engine/store.js; Search only enqueues);
//  * pins one block (head - CONFIRMATIONS from the first registered operator) and runs the reviewed producers through
//    shadow.analyze: two operators, same block hash, MetricEvidence records, Evidence Ledger on the /data volume;
//  * stores the full records as the token's latest snapshot (readers re-evaluate freshness, so it ages into STALE);
//  * reschedules: COMPLETE -> now + REFRESH_MS; recoverable failure (provider errors, cooldown, budget) -> exponential
//    backoff capped at 1 h; a permanently invalid job is removed from the queue and recorded as REJECTED;
//  * enforces a per-network hourly RPC budget and the Provider Watchdog cooldown (inside the producers);
//  * publishes worker metrics (durable) for /api/search?action=status.
const shadow=require('./shadow');
const storeModule=require('./store');
const observer=require('../verification/onchain-observer');
const evidence=require('../verification/metric-evidence');
const FLAG='ARC_AUTONOMY_RISK_WORKER_ENABLED';
const DEFAULTS=Object.freeze({tickMs:60000,maxJobs:2,refreshMs:6*3600000,maxBackoffMs:3600000,confirmations:6,rpcPerNetworkHour:2400,estimateCallsPerJob:220,maxAttempts:12});
const enabled=(env=process.env)=>env[FLAG]==='1';
const PERMANENT=new Set(['RISK_PRODUCER_INVALID_TOKEN','RISK_SHADOW_REPORT_INVALID','RISK_STORE_INVALID_KEY','RISK_PRODUCER_UNSUPPORTED_NETWORK']);
const state={lastTickAt:-Infinity,usage:new Map(),totals:{ticks:0,jobs:0,complete:0,retried:0,rejected:0,failed:0,skippedBudget:0,rpcCalls:0},
 statuses:{},unknownCauses:{},lastJob:null,durations:[]};
function budgetLeft(network,now,limit){
 const w=state.usage.get(network);if(!w||now-w.start>=3600000){state.usage.set(network,{start:now,calls:0});return limit;}
 return limit-w.calls;
}
const spend=(network,calls)=>{const w=state.usage.get(network);if(w)w.calls+=calls;};
async function pinnedBlock(network,{env,fetcher,confirmations}){
 const e=observer.endpoints(network,env).endpoints[0];
 const r=await fetcher(e.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}),signal:AbortSignal.timeout(4000)});
 if(!r.ok)throw Object.assign(Error('head'),{code:r.status===429?'RPC_RATE_LIMITED':'RPC_UNAVAILABLE'});
 const b=await r.json();if(!/^0x[0-9a-f]+$/i.test(b?.result||''))throw Object.assign(Error('head'),{code:'RPC_MALFORMED_RESPONSE'});
 const n=BigInt(b.result)-BigInt(confirmations);if(n<=0n)throw Object.assign(Error('head'),{code:'RPC_MALFORMED_RESPONSE'});
 return '0x'+n.toString(16);
}
const percentile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)];};
function metrics(now,depth){
 return {schemaVersion:1,at:new Date(now).toISOString(),lastTickAt:Number.isFinite(state.lastTickAt)?new Date(state.lastTickAt).toISOString():null,totals:{...state.totals},
  findingStatuses:{...state.statuses},unknownCauses:Object.fromEntries(Object.entries(state.unknownCauses).sort((a,b)=>b[1]-a[1]).slice(0,16)),
  queue:depth,lastJob:state.lastJob,jobMs:{p50:percentile(state.durations,.5),p95:percentile(state.durations,.95),samples:state.durations.length},
  rpcLastHour:Object.fromEntries([...state.usage].map(([n,w])=>[n,w.calls]))};
}
// Recoverable = the producers ran but no operator produced usable reads (provider outage, 429, cooldown, deadline).
function recoverable(result){
 const ops=Object.values(result.operators||{}).flat();
 return ops.length>0&&ops.every(o=>o.state!=='OK');
}
async function tick({env=process.env,fetcher=fetch,now=Date.now,deadlineAt,options={},analyze=shadow.analyze,store}={}){
 if(!enabled(env))return null;
 const cfg={...DEFAULTS,...options},t0=now();
 if(t0-state.lastTickAt<cfg.tickMs)return {state:'NOT_DUE'};
 state.lastTickAt=t0;state.totals.ticks++;
 let s;try{s=store||storeModule.open({env,fetcher});}catch(e){return {state:'STORE_UNAVAILABLE',reasonCode:e.code};}
 const results=[];
 let due=[];try{due=await s.due(t0,cfg.maxJobs);}catch(e){return {state:'STORE_UNAVAILABLE',reasonCode:e.code};}
 for(const {network,token} of due){
  if(deadlineAt&&deadlineAt-now()<15000)break;               // producers need up to ~12 s; never start what cannot finish
  const job=(await s.getJob(network,token).catch(()=>null))||{attempts:0};
  if(budgetLeft(network,now(),cfg.rpcPerNetworkHour)<cfg.estimateCallsPerJob){
   state.totals.skippedBudget++;await s.enqueue(network,token,now()+10*60000,{replace:true}).catch(()=>{});
   results.push({network,token,state:'BUDGET_DEFERRED'});continue;
  }
  const started=now();let next,record;
  try{
   const block=await pinnedBlock(network,{env,fetcher,confirmations:cfg.confirmations});
   const result=await analyze({network,token,block,env,fetcher,now,log:()=>{}});
   spend(network,result.cost.rpcCalls);state.totals.rpcCalls+=result.cost.rpcCalls;state.totals.jobs++;
   if(recoverable(result)){
    const attempts=(job.attempts||0)+1;next=now()+Math.min(cfg.maxBackoffMs,60000*2**Math.min(attempts,10));
    record={state:'RETRY',reasonCode:'NO_OPERATOR_USABLE',attempts,lastRunAt:new Date(started).toISOString(),nextAt:new Date(next).toISOString()};state.totals.retried++;
   }else{
    await s.putSnapshot(network,token,{schemaVersion:2,network,chainId:evidence.NETWORKS[network],token,scope:result.scope,block:result.block,generatedAt:result.generatedAt,
     records:result.records,evidenceGaps:result.evidenceGaps,producers:result.producers,cost:result.cost,ledger:{state:result.ledger.state,history:result.ledger.history}});
    next=now()+cfg.refreshMs;state.totals.complete++;
    for(const f of result.findings)state.statuses[f.status]=(state.statuses[f.status]||0)+1;
    for(const g of Object.values(result.evidenceGaps))state.unknownCauses[g]=(state.unknownCauses[g]||0)+1;
    record={state:'COMPLETE',attempts:0,lastRunAt:new Date(started).toISOString(),nextAt:new Date(next).toISOString(),block:result.block.number,
     statuses:result.findings.map(f=>f.status[0]).join(''),rpcCalls:result.cost.rpcCalls,ms:result.cost.totalMs};
   }
  }catch(e){
   const code=/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'RISK_JOB_FAILED',attempts=(job.attempts||0)+1;
   if(PERMANENT.has(code)||attempts>cfg.maxAttempts){
    await s.remove(network,token).catch(()=>{});state.totals.rejected++;
    record={state:'REJECTED',reasonCode:code,attempts,lastRunAt:new Date(started).toISOString(),nextAt:null};
   }else{
    next=now()+Math.min(cfg.maxBackoffMs,60000*2**Math.min(attempts,10));state.totals.failed++;
    record={state:'RETRY',reasonCode:code,attempts,lastRunAt:new Date(started).toISOString(),nextAt:new Date(next).toISOString()};
   }
  }
  state.durations.push(now()-started);if(state.durations.length>200)state.durations.shift();
  if(next)await s.enqueue(network,token,next,{replace:true}).catch(()=>{});
  await s.setJob(network,token,record).catch(()=>{});
  state.lastJob={network,state:record.state,reasonCode:record.reasonCode||null,at:record.lastRunAt};
  results.push({network,token,...record});
 }
 let depth=null;try{depth=await s.depth(now());}catch{}
 await s.putMetrics(metrics(now(),depth)).catch(()=>{});
 return {state:'RAN',results,ms:now()-t0};
}
module.exports={FLAG,DEFAULTS,enabled,tick,metrics:(now=Date.now())=>metrics(now,null),_reset:()=>{state.lastTickAt=-Infinity;state.usage.clear();state.statuses={};state.unknownCauses={};state.durations=[];state.lastJob=null;for(const k of Object.keys(state.totals))state.totals[k]=0;}};
