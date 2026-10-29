#!/usr/bin/env node
'use strict';
// One-off bootstrap for the Radar indexer (run on the Railway worker, NEVER inside Vercel):
//   node scripts/radar-warm.cjs ethereum [--rounds=40]
//   node scripts/radar-warm.cjs pons
// Repeats incremental indexer steps (each bounded by a time budget, paced to protect RPC quota) until a signed
// snapshot is published, printing sanitized progress. Safe to stop and resume: cursors are persisted.
const indexer=require('../lib/market-radar-indexer'),pons=require('../lib/pons-launch-indexer');
const storage=require('../lib/market-radar-storage');
const target=process.argv[2],rounds=Number((process.argv.find(a=>a.startsWith('--rounds='))||'').split('=')[1])||40;
if(!storage.KINDS.includes(target)){console.error('usage: radar-warm.cjs <'+storage.KINDS.join('|')+'> [--rounds=N]');process.exit(2);}
(async()=>{
 for(let i=1;i<=rounds;i++){
  try{
   const r=target==='pons'?await pons.run({budgetMs:90000}):await indexer.run(target,{budgetMs:90000});
   console.log(JSON.stringify({round:i,status:r.status,headBlock:r.headBlock,blocksBehind:r.blocksBehind??null,launchBlocksBehind:r.launchBlocksBehind??null,swapBlocksBehind:r.swapBlocksBehind??null,
    registry:r.registry||null,tokens:r.tokens??null,calls:r.run?.rpcCalls,pace:r.run?.pace||null}));
   if(r.status==='published')return;
  }catch(e){console.log(JSON.stringify({round:i,error:e.code||'FAILED',reason:require('../lib/market-radar-onchain').sanitize(e.detail?.reason||e.message,140)}));await new Promise(r=>setTimeout(r,5000));}
 }
 process.exitCode=1;
})();
