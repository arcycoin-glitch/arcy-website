#!/usr/bin/env node
'use strict';
// Runs the durable chain census (lib/holder-chain-worker.js) for exact contracts until every one is COMPLETE or the time budget ends.
// Same code path the Railway worker runs when ARC_HOLDER_CHAINS includes the chain. Read-only on chain; writes only local checkpoints
// (ARC_INDEX_CACHE_DIR) and signed publications (ARC_HOLDER_PUBLISHED_DIR).
// Usage: HOLDER_CHAIN=4663 node scripts/holder-chain-census.cjs [address ...]   (default: the fixed cohort's chain-4663 tokens)
const fs=require('node:fs'),path=require('node:path');
if(process.env.ARC_HOLDER_STORAGE!=='local'||!process.env.ARC_INDEX_CACHE_DIR)throw Error('Explicit local storage required (ARC_HOLDER_STORAGE=local, ARC_INDEX_CACHE_DIR)');
const chainId=Number(process.env.HOLDER_CHAIN||4663),budgetMs=Number(process.env.CENSUS_BUDGET_MS||25*60*1000);
const worker=require('../lib/holder-chain-worker'),chains=require('../lib/holder-chains');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8'));
const args=process.argv.slice(2).map(a=>a.toLowerCase());
const tokens=args.length?args.map(address=>({address})):cohort.tokens.filter(t=>t.chainId===chainId);
(async()=>{
 const t0=Date.now(),state=new Map(tokens.map(t=>[t.address,{symbol:t.symbol||null,section:t.section||null,slices:0,ms:0,rpc:{}}]));
 await worker.enqueue(chainId,tokens.map(t=>t.address));
 while(Date.now()-t0<budgetMs&&[...state.values()].some(s=>s.state!=='COMPLETE')){
  const results=await worker.slice(chainId,{limit:5,sliceMs:20000,maxRanges:400});
  for(const r of results){const s=state.get(r.contract);if(!s)continue;s.slices++;s.ms+=r.ms||0;for(const [k,v] of Object.entries(r.rpc||{}))s.rpc[k]=(s.rpc[k]||0)+v;Object.assign(s,{state:r.state,reasonCode:r.reasonCode||null,block:r.block||s.block||null,holderCount:r.holderCount??s.holderCount??null,top10Pct:r.top10Pct??s.top10Pct??null,published:r.published||s.published||false,balanceReadMethods:r.balanceReadMethods||s.balanceReadMethods||null,transferLogs:r.transferLogs??s.transferLogs??null,logWindows:r.logWindows??s.logWindows??null});}
  if(!results.length)await new Promise(r=>setTimeout(r,500));
 }
 for(const [address,s] of state)console.log('CENSUS '+JSON.stringify({address,...s}));
 const all=[...state.values()],done=all.filter(s=>s.state==='COMPLETE');
 const rpc=all.reduce((m,s)=>{for(const [k,v] of Object.entries(s.rpc))m[k]=(m[k]||0)+v;return m;},{});
 console.log('CENSUS_TOTAL '+JSON.stringify({chainId,tokens:all.length,complete:done.length,published:all.filter(s=>s.published).length,failed:all.filter(s=>s.state==='FAILED'||s.state==='NOT_VERIFIED').length,
  elapsedMs:Date.now()-t0,rpc,byReason:all.filter(s=>s.state!=='COMPLETE').reduce((m,s)=>{const k=s.state+':'+(s.reasonCode||'');m[k]=(m[k]||0)+1;return m;},{})}));
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
