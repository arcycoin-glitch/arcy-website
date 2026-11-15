'use strict';
// Read-only live probe of search/server/lib/live-trades.js on real tokens (three chains). Prints evidence summaries.
const lt=require('../search/server/lib/live-trades');
const SAMPLES=[['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b','ARCY'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c','ARGUS-TAX'],['arc','0xbc43ce8dec648ea298c4275559b81d6261c90b67','TOLLY'],
 ['ethereum','0x6982508145454Ce325dDbE47a25d4ec3d2311933','PEPE'],['ethereum','0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984','UNI'],['ethereum','0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE','SHIB'],
 ['robinhood','0x6dbe95076584f869dd09a44131e9a3c13f34d7d6','PONS-V2'],['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','UERC20'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571','PONS-L']];
(async()=>{
 for(const [network,address,label] of SAMPLES){
  const t=Date.now();let r;try{r=await lt.analyze({network,address});}catch(e){r=lt.classify(e);r.err=String(e.message).slice(0,120);}
  const sides={};for(const x of r.trades||[])sides[x.side]=(sides[x.side]||0)+1;
  console.log('LT '+JSON.stringify({label,network,ms:Date.now()-t,status:r.status,reason:r.reasonCode,err:r.err,headAge:r.headAgeSeconds,pools:(r.pools||[]).map(p=>p.kind+':'+p.protocol+':'+p.pool.slice(0,10)),
   excluded:(r.excludedPools||[]).map(p=>(p.dex||'')+':'+p.reasonCode),n:(r.trades||[]).length,sides,window:r.window,cost:r.cost,
   sample:(r.trades||[]).slice(0,3).map(x=>[x.side,x.tokenAmount.slice(0,12),x.counterAmount.slice(0,10)+' '+x.counterSymbol,x.usd,x.usdStatus,x.route,x.wallet.slice(0,8),x.timestamp,x.txHash.slice(0,10)])}));
  await new Promise(r=>setTimeout(r,7000));
 }
})();
