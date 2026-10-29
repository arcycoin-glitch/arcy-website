const storage=require('./holder-storage'),worker=require('./holder-candidates'),health=require('./search-health'),budget=require('./holder-budget'),P=require('./holder-progress');
// One invocation has a shared budget, not a fresh full budget per contract. Every limit is tunable through the
// environment but clamped to a safe range, so a typo can neither starve checkpoint/cleanup time nor run unbounded.
const envSet=name=>Number.isFinite(Math.floor(Number(process.env[name])))&&Number(process.env[name])>0;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
// Operator env var wins; otherwise the caller's value (the worker script passes its historical 5 / 40 s / 5 s); otherwise default.
const pick=(name,arg,fallback,min,max,argMin=min)=>envSet(name)?clamp(Math.floor(Number(process.env[name])),min,max):Number(arg)>0?clamp(Math.floor(Number(arg)),argMin,max):fallback;
const limits=(o={})=>({invocationMs:pick('ARC_HOLDER_INVOCATION_BUDGET_MS',o.budgetMs,40000,10000,120000,1),sliceMs:pick('ARC_HOLDER_TOKEN_SLICE_MS',0,12000,3000,60000),
 batchLimit:pick('ARC_HOLDER_BATCH_LIMIT',o.limit,20,1,20),incompleteDelayMs:pick('ARC_HOLDER_INCOMPLETE_DELAY_MS',o.incompleteDelayMs,60000,1000,300000),
 reserveMs:pick('ARC_HOLDER_CHECKPOINT_RESERVE_MS',0,2000,500,10000),poolSize:pick('ARC_HOLDER_SCHEDULER_POOL',0,50,1,50),fifoShare:envSet('ARC_HOLDER_FIFO_SHARE_PCT')?clamp(Number(process.env.ARC_HOLDER_FIFO_SHARE_PCT),10,100)/100:0.4,starveMs:pick('ARC_HOLDER_STARVE_MS',0,600000,60000,3600000),maxRetryDelayMs:pick('ARC_HOLDER_MAX_REQUEUE_DELAY_MS',0,120000,5000,600000)});
const jitter=ms=>Math.round(ms*(1+Math.random()*0.2)); // stagger upward only: never earlier than the computed eligibility
function readyInMs(){try{return process.env.ARC_HOLDER_WORKER_RPC==='1'?require('./holder-rpc').current().readyInMs():0;}catch{return 0;}}
// Fair scheduling. Pure FIFO gives a token that needs two more slices the same wait as one that needs fifty, so work close
// to COMPLETE queued behind long scans and, once pacing degraded, never finished. Each invocation therefore (a) reserves a
// share of its slots for the longest-waiting tokens (aging: nobody waits more than a bounded number of invocations) and
// (b) gives the remaining slots to the tokens with the least remaining work, which turns checkpoints into COMPLETE
// snapshots sooner. Unknown remaining work (not yet seen by this process) ranks after known work but is covered by (a).
function rank(pool,max,L,now){
 const waited=a=>{const e=P.get(a);return e&&e.lastServedAt!==null?now-e.lastServedAt:Infinity;};
 const work=a=>{const e=P.get(a);return e&&Number.isFinite(e.remainingCalls)?e.remainingCalls:Infinity;};
 const order=pool.map((a,i)=>({a,i})),picked=[],take=(o,kind)=>{if(picked.some(x=>x.a===o.a))return;picked.push({a:o.a,kind});};
 const fifoSlots=Math.min(pool.length,Math.max(1,Math.ceil(max*L.fifoShare)));
 // longest-waiting first; ties keep queue (due) order
 for(const o of [...order].sort((x,y)=>(waited(y.a)===waited(x.a)?x.i-y.i:waited(y.a)-waited(x.a))).slice(0,fifoSlots))take(o,waited(o.a)>=L.starveMs?'starved':'oldest');
 for(const o of [...order].sort((x,y)=>(work(x.a)===work(y.a)?x.i-y.i:work(x.a)-work(y.a))))take(o,'smallest');
 return picked;
}
async function run({limit,budgetMs,addresses,incompleteDelayMs}={}){
 const L=limits({limit,budgetMs,incompleteDelayMs}),reserve=L.reserveMs;
 const end=budget.now()+Math.max(1,L.invocationMs),max=Math.max(1,Math.min(20,L.batchLimit)),results=[],seen=new Set();
 let explicit=addresses?.slice(0,max);
 while(results.length<max&&end-budget.now()>reserve){
  const tokens=explicit?.splice(0,5)||await budget.run(Math.min(2000,end-budget.now()),()=>storage.due(L.poolSize));
  const pool=tokens.filter(a=>!seen.has(a));if(!pool.length)break;
  // One-time (per process) read of a token's checkpoint so the scheduler knows how much work is left; later updates
  // come for free from the builder's saves. A failed read just leaves the estimate unknown (ranked after known work).
  if(!explicit)await Promise.all(pool.filter(a=>!P.get(a)?.primed).map(async a=>{try{const st=await budget.run(Math.min(1500,Math.max(1,end-budget.now())),()=>require('./holder-index').load(a+'-candidates'));if(st&&st.phase&&st.phase!=='COMPLETE')P.note(a,st,budget.now());P.markPrimed(a);}catch{}}));
  const ranked=explicit?pool.map(a=>({a,kind:'explicit'})):rank(pool,max-results.length,L,budget.now()),kinds=new Map(ranked.map(x=>[x.a,x.kind])),candidates=ranked.map(x=>x.a);
  for(const a of candidates){
   if(results.length>=max||end-budget.now()<=reserve)break;storage.identity(a);seen.add(a);P.pick(kinds.get(a));
   let result,complete=false,requeueMs=0;const sliceStart=budget.now(),before=P.get(a)?.advancedTotal||0;
   // Quota-aware yield: when every provider is cooling longer than this slice could wait, requeue the token
   // for the moment a provider becomes eligible instead of burning the slice on a wait that cannot finish.
   const ready=module.exports.readyInMs(),sliceBudget=Math.min(L.sliceMs,end-budget.now()-reserve);
   if(ready>=sliceBudget&&Number.isFinite(ready)){
    health.record('HOLDER_WORKER_YIELDED',{contract:a,reasonCode:'RPC_COOLDOWN_YIELD'});
    result={contract:a,state:'BUILDING',block:null,reasonCode:'RPC_COOLDOWN_YIELD',httpStatus:null,eligibleInMs:Math.round(ready)};
    try{await budget.run(Math.min(1500,Math.max(1,end-budget.now())),()=>storage.enqueue(a,budget.now()+jitter(Math.min(L.maxRetryDelayMs,Math.max(1000,ready))),true));}catch{}
    P.sliceDone(a,{state:'BUILDING',reason:'RPC_COOLDOWN_YIELD',elapsedMs:0,advancedBefore:before,now:budget.now(),served:false});
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
    if(!bounded)try{await storage.setJob(a,{state:result.state==='UNSUPPORTED'?'UNSUPPORTED':'FAILED',reasonCode:result.reasonCode,retryAt:result.state==='UNSUPPORTED'?undefined:budget.now()+60000});}catch{}
   }
   // Move processed work behind untouched jobs. On failure the existing due member is retained.
   const delay=complete?600000:result.state==='UNSUPPORTED'?86400000:result.state==='FAILED'||result.refreshFailed||result.httpStatus===429?60000:Math.max(1000,L.incompleteDelayMs,requeueMs);
   try{await budget.run(Math.min(1500,Math.max(1,end-budget.now())),()=>storage.enqueue(a,budget.now()+(requeueMs>0?jitter(delay):delay),true));}
   catch(e){health.record(e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED'?'HOLDER_WORKER_YIELDED':'STORAGE_UNAVAILABLE',{contract:a,reasonCode:e.code});}
   P.sliceDone(a,{state:result.state,reason:result.reasonCode,elapsedMs:budget.now()-sliceStart,advancedBefore:before,now:budget.now()});
   const pr=P.get(a);if(pr)result.progress={phase:pr.phase,cursor:pr.cursor,remainingBlocks:pr.remainingBlocks,remainingBalances:pr.remainingBalances,advanced:pr.lastAdvanced};
   results.push(result);
  }
 }
 P.invocation({at:Date.now(),elapsedMs:budget.now()-(end-L.invocationMs),served:results.map(r=>r.contract),states:results.reduce((m,r)=>(m[r.reasonCode||r.state]=(m[r.reasonCode||r.state]||0)+1,m),{})});
 return results;
}
module.exports={run,limits,readyInMs,rank};
