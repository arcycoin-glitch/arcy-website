const storage=require('./holder-storage'),worker=require('./holder-candidates'),health=require('./search-health'),budget=require('./holder-budget');
// One invocation has a shared budget, not a fresh full budget per contract.
async function run({limit=20,budgetMs=40000,addresses,incompleteDelayMs=60000}={}){
 const end=Date.now()+Math.max(1,Math.min(40000,Number(budgetMs)||40000)),max=Math.max(1,Math.min(20,Number(limit)||20)),results=[],seen=new Set();
 let explicit=addresses?.slice(0,max);
 while(results.length<max&&end-Date.now()>2000){
  const tokens=explicit?.splice(0,5)||await budget.run(Math.min(2000,end-Date.now()),()=>storage.due(5));
  const candidates=tokens.filter(a=>!seen.has(a));if(!candidates.length)break;
  for(const a of candidates){
   if(results.length>=max||end-Date.now()<=2000)break;storage.identity(a);seen.add(a);
   let result,complete=false;
   try{
    await storage.setJob(a,{state:'INDEXING'});
    const slice=Math.min(12000,end-Date.now()-2000);
    const r=await budget.run(slice,()=>budget.operation(()=>worker.advance(a,{budgetMs:slice,maxPages:50,maxBatches:150})));
    complete=Boolean(r.value)&&r.value.snapshot?.freshness==='FRESH';
    result={contract:a,state:complete?'COMPLETE':r.value?'STALE':'BUILDING',block:r.value?.block||null,reasonCode:r.reasonCode||r.value?.snapshot?.refresh?.reasonCode||null,httpStatus:r.httpStatus||r.value?.snapshot?.refresh?.httpStatus||null,refreshFailed:r.value?.snapshot?.refresh?.state==='FAILED'};
    if(complete)await storage.setJob(a,{state:'READY'});
    else if(result.reasonCode==='HOLDER_PINNED_RECONCILIATION_IN_PROGRESS'||result.reasonCode==='HOLDER_SUPPLY_RECONCILIATION_FAILED')await storage.setJob(a,{state:'VERIFYING'});
   }catch(e){
    const bounded=e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED';health.record(bounded?'HOLDER_WORKER_YIELDED':'HOLDER_REFRESH_FAILED',{contract:a,reasonCode:e.code,httpStatus:e.httpStatus});
    result={contract:a,state:bounded?'BUILDING':e.code==='HOLDER_WORKER_CAPACITY_LIMIT'?'UNSUPPORTED':'FAILED',block:null,reasonCode:e.code||'UPSTREAM_UNAVAILABLE',httpStatus:e.httpStatus||null};
    if(!bounded)try{await storage.setJob(a,{state:result.state==='UNSUPPORTED'?'UNSUPPORTED':'FAILED',reasonCode:result.reasonCode,retryAt:result.state==='UNSUPPORTED'?undefined:Date.now()+60000});}catch{}
   }
   // Move processed work behind untouched jobs. On failure the existing due member is retained.
   const delay=complete?600000:result.state==='UNSUPPORTED'?86400000:result.state==='FAILED'||result.refreshFailed||result.httpStatus===429?60000:Math.max(1000,Number(incompleteDelayMs)||60000);
   try{await budget.run(Math.min(1500,Math.max(1,end-Date.now())),()=>storage.enqueue(a,Date.now()+delay,true));}
   catch(e){health.record(e.code==='HOLDER_WORKER_BUDGET_EXHAUSTED'?'HOLDER_WORKER_YIELDED':'STORAGE_UNAVAILABLE',{contract:a,reasonCode:e.code});}
   results.push(result);
  }
 }
 return results;
}
module.exports={run};
