#!/usr/bin/env node
'use strict';
// Read-only proof scan for an Arc BENCHMARKED_SPANS entry (lib/holder-rpc-discovery.js), the procedure used for Syrup USDC, GBPA, XAUM:
//   1. production job status (public GET /api/holders?action=status) to record WHY the worker cannot publish
//   2. deployment block by eth_getCode binary search (holder-rpc-discovery.locate, the worker's own code)
//   3. every Transfer log from deployBlock-1 to a pinned head with the worker's log reader (holder-log-range.read: validated, contiguous)
//   4. candidate balances read at the pinned block and reconciled EXACTLY to totalSupply() (holder-index.reconcile)
// Prints one SPAN_PROOF line per contract. Nothing is written, queued or published.
const RD=require('../lib/holder-rpc-discovery'),LR=require('../lib/holder-log-range'),index=require('../lib/holder-index'),core=require('../lib/core');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
async function status(a){try{const r=await fetch(BASE+'/api/holders?address='+a+'&action=status',{headers:{accept:'application/json',referer:BASE+'/'},signal:AbortSignal.timeout(15000)});return {http:r.status,body:await r.json().catch(()=>null)};}catch(e){return {error:String(e.message).slice(0,80)};}}
async function proof(a){
 const out={address:a,t0:Date.now()};out.productionJob=await status(a);
 const s={};await RD.locate(a,s,{});out.deployBlock=s.deployBlock;
 const head=Number(BigInt(await core.rpc('eth_blockNumber',[])));const pin='0x'+head.toString(16);
 const anchor=(await core.rpc('eth_getBlockByNumber',[pin,false]))?.hash;
 out.pinned=head;out.span=head-s.deployBlock;out.defaultMaxSpan=RD.DEFAULT_MAX_SPAN;out.allowedSpanNow=RD.allowedSpan?.(a,s.deployBlock)??null;
 const addresses=new Set();let from=Math.max(0,s.deployBlock-1),width=2000,windows=0,logs=0;
 while(from<=head){const r=await LR.read(a,from,head,width);windows++;for(const x of r.addresses)addresses.add(x);from=r.to+1;width=r.width;
  if(windows%500===0)console.log('progress '+a+' '+windows+' windows, at '+from+' / '+head);}
 out.windows=windows;out.candidates=addresses.size;
 try{const rec=await index.reconcile(a,[...addresses],pin,{source:'Arc RPC proof scan',scanFromBlock:s.deployBlock-1,scanToBlock:head,anchor});
  out.reconciled=true;out.holderCount=rec.holderCount;out.totalSupplyRaw=rec.fields.holderCount.evidence[0].totalSupplyRaw;out.top10Pct=rec.top10Pct;}
 catch(e){out.reconciled=false;out.reconcileError=e.code||e.message;}
 out.anchorStable=(await core.rpc('eth_getBlockByNumber',[pin,false]))?.hash===anchor;out.anchor=anchor;out.ms=Date.now()-out.t0;delete out.t0;
 return out;
}
(async()=>{for(const a of process.argv.slice(2).map(x=>x.toLowerCase())){try{console.log('SPAN_PROOF '+JSON.stringify(await proof(a)));}catch(e){console.log('SPAN_PROOF '+JSON.stringify({address:a,error:e.code||e.message}));}}})();
