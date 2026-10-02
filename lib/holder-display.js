const storage=require('./holder-storage'),budget=require('./holder-budget'),health=require('./search-health');
// Historical evidence remains evidence at its recorded block, never a live balance claim.
function historical(snapshot,refresh={state:'QUEUED'}){
 const value=structuredClone(snapshot),ageSeconds=Math.max(0,Math.floor((Date.now()-Date.parse(value.snapshot.completedAt))/1000));
 value.snapshot={...value.snapshot,freshness:'LAST_VERIFIED',ageSeconds,refresh};
 value.scannedAt=value.snapshot.completedAt;
 value.reason='Last complete reconciled holder snapshot at the recorded block; refresh is separate.';
 for(const field of Object.values(value.fields))field.snapshot={block:value.block,completedAt:value.snapshot.completedAt,freshness:'LAST_VERIFIED'};
 return value;
}
async function cached(a){
 const snapshot=await storage.snapshot(a+'-candidates');
 if(!snapshot)return null;
 let refresh={state:'QUEUED'};
 try{await budget.run(1500,()=>budget.operation(()=>storage.enqueue(a)));}
 catch(e){health.record('HOLDER_REFRESH_QUEUE_FAILED',{contract:a,reasonCode:e.code});refresh={state:'FAILED',reasonCode:e.code||'STORAGE_UNAVAILABLE'};}
 return historical(snapshot,refresh);
}
module.exports={cached,historical};
