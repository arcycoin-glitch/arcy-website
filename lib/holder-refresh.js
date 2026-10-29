const storage=require('./holder-storage'),worker=require('./holder-candidates'),health=require('./search-health'),budget=require('./holder-budget');
// One invocation has a shared budget, not a fresh full budget per contract. Every limit is tunable through the
// environment but clamped to a safe range, so a typo can neither starve checkpoint/cleanup time nor run unbounded.
const envSet=name=>Number.isFinite(Math.floor(Number(process.env[name])))&&Number(process.env[name])>0;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
// Operator env var wins; otherwise the caller's value (the worker script passes its historical 5 / 40 s / 5 s); otherwise default.
const pick=(name,arg,fallback,min,max,argMin=min)=>envSet(name)?clamp(Math.floor(Number(process.env[name])),min,max):Number(arg)>0?clamp(Math.floor(Number(arg)),argMin,max):fallback;
const limits=(o={})=>({invocationMs:pick('ARC_HOLDER_INVOCATION_BUDGET_MS',o.budgetMs,40000,10000,120000,1),sliceMs:pick('ARC_HOLDER_TOKEN_SLICE_MS',0,12000,3000,60000),
 batchLimit:pick('ARC_HOLDER_BATCH_LIMIT',o.limit,20,1,20),incompleteDelayMs:pick('ARC_HOLDER_INCOMPLETE_DELAY_MS',o.incompleteDelayMs,60000,1000,300000),
 reserveMs:pick('ARC_HOLDER_CHECKPOINT_RESERVE_MS',0,2000,500,10000),maxRetryDelayMs:pick('ARC_HOLDER_MAX_REQUEUE_DELAY_MS',0,120000,5000,600000)});
const jitter=ms=>Math.round(ms*(1+Math.random()*0.2)); // stagger upward only: never earlier than the computed eligibility
function readyInMs(){try{return process.env.ARC_HOLDER_WORKER_RPC==='1'?require('./holder-rpc').current().readyInMs():0;}catch{return 0;}}
async function run({limit,budgetMs,addresses,incompleteDelayMs}={}){
 const L=limits({limit,budgetMs,incompleteDelayMs}),reserve=L.reserveMs;
 const end=Date.now()+Math.max(1,L.invocationMs),max=Math.max(1,Math.min(20,L.batchLimit)),results=[],seen=new Set();
 let explicit=addresses?.slice(0,max);
 while(results.length<max&&end-Date.now()>reserve){
  const tokens=explicit?.splice(0,5)||await budget.run(Math.min(2000,end-Date.now()),()=>storage.due(5));
  const candidates=tokens.filter(a=>!seen.has(a));if(!candidates.length)break;
  for(const a of candidates){
   if(results.length>=max||end-Date.now()<=reserve)break;storage.identity(a);seen.add(a);
   let result,complete=false,requeueMs=0;
   // Quota-aware yield: when every provider is cooling longer than this slice could wait, requeue the token
   // for the moment a provider becomes eligible instead of burning the slice on a wait that cannot finish.
   const ready=module.exports.readyInMs(),sliceBudget=Math.min(L.sliceMs,end-Date.now()-reserve);
   if(ready>=sliceBudget&&Number.isFinite(ready)){
    health.record('HOLDER_WORKER_YIELDED',{contract:a,reasonCode:'RPC_COOLDOWN_YIELD'});
    result={contract:a,state:'BUILDING',block:null,reasonCode:'RPC_COOLDOWN_YIELD',httpStatus:null,eligibleInMs:Math.round(ready)};
    try{await budget.run(Math.min(1500,Math.max(1,end-Date.now())),()=>storage.enqueue(a,Date.now()+jitter(Math.min(L.maxRetryDelayMs,Math.max(1000,ready))),true));}catch{}
    results.push(result);continue;
   }
   try{
    await storage.setJob(a,{state:'INDEXING'});
    const slice=Math.max(1,sliceBudget);
    // The scan loops stop `reserve` ms before the hard slice deadline so checkpoints and lease cleanup always fit.
    const r=await budget.run(slice,()=>budget.operation(()=>worker.advance(a,{budgetMs:Math.max(1,slice-Math.min(reserve,Math.floor(slice/2))),maxPages:50,maxBatches:150})));
    complete=Boolean(r.value)&&r.value.snapshot?.freshness==='FRESH';
    result={contract:a,state:complete?'COMPLETE':r.value?'STALE':'BUILDING',block:r.value?.block||null,reasonCode:r.reasonCode||r.value?.snapshot?.refresh?.reasonCode||null,httpStatus:r.httpStatus||r.value?.snapshot?.refresh?.httpStatus||null,refreshFailed:r.value?.snapshot?.refresh?.state==='FAILED'};
    if(complete)await storage.setJob(a,{state:'READY'});
    else if(result.reasonCode==='HOLDER_PINNED_RECONCILIATION_IN_PROGRESS'||result.reasonCode==='HOLDER_SUPPLY_RECONCILIATION_FAILED')await storage.setJob(a,{state:'VERIFYING'});
   }catch(e){
    const bounded=e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED';if(bounded&&Number.isFinite(e.eligibleInMs))requeueMs=Math.min(L.maxRetryDelayMs,Math.max(0,e.eligibleInMs));
    health.record(bounded?'HOLDER_WORKER_YIELDED':'HOLDER_REFRESH_FAILED',{contract:a,reasonCode:e.code,httpStatus:e.httpStatus});
    if(!bounded&&Array.isArray(e.attempts))console.error(JSON.stringify({event:'HOLDER_RPC_ATTEMPTS',contract:a,reasonCode:e.code,attempts:e.attempts.slice(-6)}));
    result={contract:a,state:bounded?'BUILDING':e.code==='HOLDER_WORKER_CAPACITY_LIMIT'?'UNSUPPORTED':'FAILED',block:null,reasonCode:e.code||'UPSTREAM_UNAVAILABLE',httpStatus:e.httpStatus||null,...(Array.isArray(e.attempts)&&e.attempts.length?{rpcAttempts:e.attempts.slice(-6)}:{})};
    if(!bounded)try{await storage.setJob(a,{state:result.state==='UNSUPPORTED'?'UNSUPPORTED':'FAILED',reasonCode:result.reasonCode,retryAt:result.state==='UNSUPPORTED'?undefined:Date.now()+60000});}catch{}
   }
   // Move processed work behind untouched jobs. On failure the existing due member is retained.
   const delay=complete?600000:result.state==='UNSUPPORTED'?86400000:result.state==='FAILED'||result.refreshFailed||result.httpStatus===429?60000:Math.max(1000,L.incompleteDelayMs,requeueMs);
   try{await budget.run(Math.min(1500,Math.max(1,end-Date.now())),()=>storage.enqueue(a,Date.now()+(requeueMs>0?jitter(delay):delay),true));}
   catch(e){health.record(e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED'?'HOLDER_WORKER_YIELDED':'STORAGE_UNAVAILABLE',{contract:a,reasonCode:e.code});}
   results.push(result);
  }
 }
 return results;
}
module.exports={run,limits,readyInMs};
