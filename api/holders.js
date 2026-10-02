const c=require('../lib/core'),f=require('../lib/fields'),index=require('../lib/holder-index'),worker=require('../lib/holder-candidates'),storage=require('../lib/holder-storage'),health=require('../lib/search-health');
const unknown=result=>({status:'NOT_VERIFIED',source:null,holderCount:null,largestWalletPct:null,top10Pct:null,top20Pct:null,dataState:result.attempts?.every(x=>x.dataState==='SOURCE_API_FAILED')?'SOURCE_API_FAILED':'NOT_VERIFIED',reasonCode:result.reasonCode,reason:result.reason,attempts:result.attempts||[],coverage:result.coverage,fields:Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(k=>[k,{...result}]))});
module.exports=c.route(async a=>f.cached('holders:'+a,60000,async()=>{
 // Queue cold contracts before discovery, including source failures with no checkpoint yet.
 try{await storage.enqueue(a);}catch{health.record('STORAGE_UNAVAILABLE',{contract:a});}
 let primary;try{primary=await worker.advance(a);}catch(e){primary={value:null,status:'NOT_VERIFIED',...c.failure(e)};}
 // An active job on another instance must not trigger a competing enumeration.
 if(primary.reasonCode==='HOLDER_JOB_COALESCED')return unknown(primary);
 const result=await f.resolve([
  {name:'Resumable pinned-block candidate snapshot',tier:'ONCHAIN_VERIFIED',read:()=>primary},
  {name:'A/X Explorer + pinned Arc RPC balance reconciliation',tier:'ONCHAIN_VERIFIED',read:()=>index.explorer(a)},
  {name:'GoPlus candidate wallets + pinned Arc RPC',tier:'ONCHAIN_VERIFIED',read:()=>require('../lib/goplus').holders(a)},
  {name:'Resumable Arc Transfer history',tier:'ONCHAIN_VERIFIED',read:()=>index.advance(a,{budgetMs:7000,maxRanges:8})}
 ]);
 if(result.value)return {...result.value,attempts:result.attempts};return unknown(result);
}));
