const c=require('../lib/core'),storage=require('../lib/holder-storage'),display=require('../lib/holder-display'),budget=require('../lib/holder-budget'),health=require('../lib/search-health');
module.exports=c.route(async a=>{
 let previous,queued=false,failed=false;
 try{previous=await budget.run(2500,()=>budget.operation(()=>display.cached(a)));}
 catch{failed=true;health.record('STORAGE_UNAVAILABLE',{contract:a});}
 if(previous)return previous;
 if(!failed)try{queued=await budget.run(1500,()=>budget.operation(()=>storage.enqueue(a)));}
 catch{failed=true;health.record('STORAGE_UNAVAILABLE',{contract:a});}
 const result={value:null,status:'NOT_VERIFIED',dataState:failed||!queued?'SOURCE_API_FAILED':'NOT_VERIFIED',reasonCode:failed?'STORAGE_UNAVAILABLE':queued?'HOLDER_SNAPSHOT_BUILDING':'HOLDER_QUEUE_FULL',reason:failed?'Durable holder storage unavailable.':queued?'Building a complete reconciled holder snapshot in the background worker.':'Holder queue is full; retry later.',coverage:queued?{complete:false,refreshQueued:true}:{refreshQueued:false}};
 return {status:'NOT_VERIFIED',source:null,holderCount:null,largestWalletPct:null,top10Pct:null,top20Pct:null,...result,fields:Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(k=>[k,{...result}]))};
});
