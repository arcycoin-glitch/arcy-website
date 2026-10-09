const c=require('../lib/core'),publication=require('../lib/holder-publication'),display=require('../lib/holder-display');
// Only signed COMPLETE publications are read here; queue/indexing remain separate.
module.exports=c.route(async(a,req)=>{
 if(req.query.action==='queue')return require('../lib/holder-queue-client').enqueue(a);
 if(req.query.action==='status')return require('../lib/holder-queue-client').status(a);
 const snapshot=req.query.action==='published'?(await publication.remote(a)||await publication.read(a)):(await publication.read(a)||await publication.remote(a));
 if(snapshot)return display.historical(snapshot,{state:'BACKGROUND'});
 const publicationLookup=publication.lookupState(a),failed=publicationLookup.state!=='ABSENT';
 const result=c.unknown(failed?'Signed publication lookup could not establish availability. This is not proof that indexing is incomplete.':'No published COMPLETE verified holder snapshot is available. Background work is separate.',failed?'HOLDER_PUBLICATION_UNAVAILABLE':'HOLDER_SNAPSHOT_NOT_PUBLISHED',failed?'SOURCE_API_FAILED':'NOT_VERIFIED');
 return {status:'NOT_VERIFIED',source:null,holderCount:null,largestWalletPct:null,top10Pct:null,top20Pct:null,...result,publicationLookup,coverage:{complete:false,refreshQueued:false},fields:Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(k=>[k,{...result}]))};
});
