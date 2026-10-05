const c=require('../lib/core'),publication=require('../lib/holder-publication'),display=require('../lib/holder-display');
// Queue and CDN reads are separate background requests, never initial Search work.
module.exports=c.route(async(a,req)=>{
 if(req.query.action==='queue')return require('../lib/holder-queue-client').enqueue(a);
 const snapshot=await (req.query.action==='published'?publication.remote(a):publication.read(a));
 if(snapshot)return display.historical(snapshot,{state:'BACKGROUND'});
 const result=c.unknown('No published COMPLETE verified holder snapshot is available. Background work is separate.','HOLDER_SNAPSHOT_NOT_PUBLISHED');
 return {status:'NOT_VERIFIED',source:null,holderCount:null,largestWalletPct:null,top10Pct:null,top20Pct:null,...result,coverage:{complete:false,refreshQueued:false},fields:Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(k=>[k,{...result}]))};
});
