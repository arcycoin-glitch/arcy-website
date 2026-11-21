'use strict';
// Durable census slices for non-Arc holder chains (today: 4663 = Robinhood Chain, which also hosts every Pons token).
// It reuses the existing architecture end to end - nothing is indexed twice and nothing is a parallel store:
//   queue + leases + checkpoints   lib/holder-storage.js   (keys holders:v2:<chainId>:..., files <cache>/chain-<chainId>/)
//   resumable Transfer ledger       lib/holder-index.js advance()  (cursor, block-hash anchor => reorg rebuild, adaptive windows)
//   pinned-block reconciliation     lib/holder-index.js reconcile() + lib/balance-reader.js (Multicall3 runtime hash checked)
//   signed publication              lib/holder-publication.js (Ed25519, chainId inside the signed payload)
//   throttled RPC                   lib/holder-chains.js rpcClient (pacing, bounded concurrency, 429/5xx backoff, chainId check)
// A snapshot is published only when the ledger, the pinned on-chain balances and totalSupply() agree exactly. Explorer data is never used.
const chains=require('./holder-chains');
const REFRESH_MS=10*60*1000,INCOMPLETE_MS=1000,FAIL_MS=60*1000;
async function slice(chainId,{limit=3,sliceMs=15000,maxRanges=200,maxWallets=100000,rpc,now=Date.now,log=()=>{}}={}){
 return chains.run(chainId,async()=>{
  const storage=require('./holder-storage'),index=require('./holder-index'),publication=require('./holder-publication');
  const due=await storage.due(limit),results=[];
  for(const a of due){
   const t0=now(),before=chains.client()?.metrics?{...chains.client().metrics}:null;let out;
   try{
    const r=await index.advance(a,{budgetMs:sliceMs,maxRanges,maxWallets});
    if(r.status==='ONCHAIN_VERIFIED'&&r.value){
     let published=false;if(process.env.ARC_HOLDER_PUBLISHED_DIR){await publication.publish(a,r.value);published=true;}
     await storage.enqueue(a,now()+REFRESH_MS,true);
     out={contract:a,state:'COMPLETE',block:r.value.block,holderCount:r.value.holderCount,top10Pct:r.value.top10Pct,published};
    }else{
     const retry=r.reasonCode==='TRANSFER_BACKFILL_IN_PROGRESS'?INCOMPLETE_MS:FAIL_MS;await storage.enqueue(a,now()+retry,true);
     out={contract:a,state:r.reasonCode==='TRANSFER_BACKFILL_IN_PROGRESS'?'BUILDING':'NOT_VERIFIED',reasonCode:r.reasonCode||null,cursor:r.coverage?.toBlock??null,target:r.coverage?.targetBlock??null};
    }
   }catch(e){await storage.enqueue(a,now()+FAIL_MS,true).catch(()=>{});out={contract:a,state:'FAILED',reasonCode:e.code||'HOLDER_CENSUS_FAILED'};}
   const m=chains.client()?.metrics;out.ms=now()-t0;if(m&&before)out.rpc=Object.fromEntries(Object.keys(m).map(k=>[k,m[k]-(before[k]||0)]));
   results.push(out);log(out);
  }
  return results;
 },{rpc});
}
async function enqueue(chainId,addresses,{rpc}={}){return chains.run(chainId,async()=>{const storage=require('./holder-storage');const ok=[];for(const a of addresses)ok.push(await storage.enqueue(a.toLowerCase(),Date.now(),true));return ok;},{rpc});}
module.exports={slice,enqueue,REFRESH_MS};
