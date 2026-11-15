'use strict';
// Read-only live probe of search/server/lib/live-trades.js on real tokens (three chains): status, coverage, cost and
// latency for a cold build and an immediate incremental rebuild (cache bypassed). Prints evidence summaries only.
const lt=require(process.env.LT_ROOT?require('node:path').join(process.env.LT_ROOT,'search/server/lib/live-trades'):'../search/server/lib/live-trades');const TAG=process.env.LT_TAG||'after';
const SAMPLES=[['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d','POLL'],['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b','ARCY'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c','ARGUS-TAX'],['arc','0xbc43ce8dec648ea298c4275559b81d6261c90b67','TOLLY'],
 ['ethereum','0x6982508145454Ce325dDbE47a25d4ec3d2311933','PEPE'],['ethereum','0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984','UNI'],['ethereum','0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE','SHIB'],
 ['robinhood','0x6dbe95076584f869dd09a44131e9a3c13f34d7d6','PONS-V2'],['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','UERC20'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571','PONS-L']];
(async()=>{
 for(const [network,address,label] of SAMPLES){
  const runs=[];
  for(const pass of ['cold','incremental']){
   const t=Date.now();let r;try{r=await lt.analyze({network,address});}catch(e){r=lt.classify(e);r.err=String(e.message).slice(0,120);}
   const sides={};for(const x of r.trades||[])sides[x.side]=(sides[x.side]||0)+1;
   runs.push({pass,ms:Date.now()-t,status:r.status,reason:r.reasonCode,err:r.err,n:(r.trades||[]).length,sides,rpc:r.cost?.rpcCalls,mode:r.window?.mode,logCalls:r.window?.logCalls,
    lookbackComplete:r.window?.lookbackComplete,scannedSince:r.window?.scannedSince,lastTradeAt:r.lastTradeAt,
    pools:(r.pools||[]).map(p=>p.protocol+':'+p.pool.slice(0,10)),excluded:(r.excludedPools||[]).map(p=>(p.dex||'')+':'+p.reasonCode+':'+(p.providerTrades24h??'')),coverage:r.coverage&&{complete:r.coverage.complete,excludedActive:r.coverage.excludedActivePools},
    usd:[...new Set((r.trades||[]).map(x=>x.usdStatus))]});
   await new Promise(s=>setTimeout(s,1500));
  }
  console.log('LT '+JSON.stringify({tag:TAG,label,network,runs}));
  await new Promise(s=>setTimeout(s,5000));
 }
})();
