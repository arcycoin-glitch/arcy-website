'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const monitor=require('../lib/pulse-onchain/monitor'),storage=require('../lib/pulse-onchain/checkpoint-storage'),watchlist=require('../lib/pulse-onchain/watchlist');
const NOW=Date.parse('2026-11-11T12:00:00Z'),HASH='0x'+'a'.repeat(64);
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-pulse-lag-'));try{await fn({ARC_PULSE_ONCHAIN_DIR:dir});}finally{await fs.rm(dir,{recursive:true,force:true});}}
// A fake chain producing `rate` blocks per second. The scan honours the engine contract: a range scan stops at the
// confirmed head, a bootstrap scan covers the newest capacity window.
function chainOf(chain,{rate,genesisAt=NOW-86400000,startHead=5000000}){
 const cfg=watchlist.network(chain),calls=[];
 const headAt=now=>startHead+Math.floor((now-NOW)/1000*rate),timeOf=block=>new Date(NOW+(block-startHead)/rate*1000).toISOString();
 const scan=async({now,range})=>{
  const head=headAt(now),confirmedHead=head-cfg.confirmationDepth;calls.push({now,range});
  const from=range?range.fromBlock:head-monitor.scanCapacity(cfg)+1,to=range?Math.min(range.toBlock,confirmedHead):head;
  return {chain,chainId:cfg.chainId,status:'NO_QUALIFYING_EVENTS',complete:true,reasonCode:null,events:[],counts:{filtered:{overflow:0}},cost:{rpcCalls:9,httpRequests:9},
   head:{number:head},confirmation:{policy:'DEPTH_FALLBACK',confirmedHead},
   window:{fromBlock:from,toBlock:to,blocksCovered:to-from+1,blocksPlanned:to-from+1,toBlockHash:HASH,fromTimestamp:timeOf(from),toTimestamp:timeOf(to)}};
 };
 return {cfg,scan,calls,headAt};
}

test('a checkpoint that reaches the confirmed head is CAUGHT_UP; legacy checkpoints without a head are UNKNOWN, not complete-by-assumption',()=>fixture(async env=>{
 const {scan}=chainOf('ethereum',{rate:1/12});
 const first=await monitor.refreshChain('ethereum',{now:NOW,env,scan});
 assert.equal(first.complete,true);assert.equal(first.lag.state,'CAUGHT_UP');assert.equal(first.lag.blocks,0);assert.equal(first.lag.seconds,0);
 const second=await monitor.refreshChain('ethereum',{now:NOW+monitor.INTERVAL_MS,env,scan});
 assert.equal(second.status,'NO_QUALIFYING_EVENTS');assert.equal(second.complete,true);assert.equal(second.lag.state,'CAUGHT_UP');
 // A checkpoint written before this change has no head observation.
 const disk=await storage.read('ethereum',{env});delete disk.head;
 const legacy=monitor.publicStatus('ethereum',disk,NOW+monitor.INTERVAL_MS);
 assert.equal(legacy.lag.state,'UNKNOWN');assert.equal(legacy.lag.reasonCode,'HEAD_NOT_OBSERVED');assert.equal(legacy.complete,true);
 assert.equal(monitor.publicStatus('ethereum',null).lag.state,'UNKNOWN');
}));

test('a run that is complete for its range but short of the confirmed head reports LAGGING, never complete',()=>fixture(async env=>{
 const cfg=watchlist.network('robinhood'),capacity=monitor.scanCapacity(cfg),overlap=Math.max(monitor.MIN_REORG_OVERLAP,cfg.confirmationDepth*2);
 // 20 blocks/s: 18,000 blocks per 15 minutes against a capacity of 12,000 per run.
 const {scan,headAt}=chainOf('robinhood',{rate:20});
 await monitor.refreshChain('robinhood',{now:NOW,env,scan});
 const t1=NOW+monitor.ROBINHOOD_INTERVAL_MS,behind=await monitor.refreshChain('robinhood',{now:t1,env,scan});
 assert.equal(behind.lastAttempt.complete,true);                       // the scanned range itself was complete
 assert.equal(behind.status,'LAGGING');assert.equal(behind.complete,false);assert.equal(behind.reasonCode,'PULSE_MONITOR_BEHIND_HEAD');
 assert.equal(behind.lag.blocks,headAt(t1)-cfg.confirmationDepth-behind.coverage.lastSuccessfulBlock);
 assert.ok(behind.lag.blocks>0&&behind.lag.seconds>0);
 assert.equal(behind.lag.capacityBlocksPerRun,capacity-overlap);
 assert.equal(behind.lag.minimumRunsToCatchUp,Math.ceil(behind.lag.blocks/(capacity-overlap)));
 // The worker summary carries the same verdict.
 const summary=require('../lib/pulse-worker-refresh').monitorSummary({robinhood:behind}).robinhood;
 assert.equal(summary.status,'LAGGING');assert.equal(summary.complete,false);assert.equal(summary.lag.state,'LAGGING');assert.equal(summary.lag.blocks,behind.lag.blocks);
}));

test('a lagging checkpoint catches up at the retry cadence with the same bounded scan, then returns to the normal interval',()=>fixture(async env=>{
 // 12 blocks/s: 10,800 blocks per 15 minutes — below one run's capacity, so steady state keeps up.
 const {scan,calls,cfg}=chainOf('robinhood',{rate:12});
 let now=NOW;await monitor.refreshChain('robinhood',{now,env,scan});
 // The worker misses an hour (43,200 blocks): three and a bit runs behind.
 now+=3600000;let state=await monitor.refreshChain('robinhood',{now,env,scan});
 assert.equal(state.status,'LAGGING');const firstLag=state.lag.blocks;
 const early=await monitor.refreshChain('robinhood',{now:now+monitor.RETRY_MS-1,env,scan});
 assert.equal(early.skipped,true);assert.equal(early.reasonCode,'CATCH_UP_INTERVAL_NOT_REACHED');assert.equal(early.status,'LAGGING');
 let runs=0;
 while(state.lag.state==='LAGGING'&&runs<20){now+=monitor.RETRY_MS;state=await monitor.refreshChain('robinhood',{now,env,scan});runs++;assert.ok(!state.skipped);}
 assert.equal(state.lag.state,'CAUGHT_UP');assert.equal(state.complete,true);assert.ok(runs>=3&&runs<20,'runs '+runs);
 assert.ok(firstLag>monitor.scanCapacity(cfg));
 // Every catch-up scan stayed inside the fixed per-run capacity.
 for(const c of calls.filter(c=>c.range))assert.ok(c.range.toBlock-c.range.fromBlock+1<=monitor.scanCapacity(cfg)+Math.max(monitor.MIN_REORG_OVERLAP,cfg.confirmationDepth*2));
 // Caught up again: the normal interval applies.
 const wait=await monitor.refreshChain('robinhood',{now:now+monitor.RETRY_MS,env,scan});
 assert.equal(wait.skipped,true);assert.equal(wait.reasonCode,'REFRESH_INTERVAL_NOT_REACHED');
}));

test('an old head observation means the monitor is not running: STALE, with the last known distance',()=>fixture(async env=>{
 const {scan}=chainOf('ethereum',{rate:1/12});
 await monitor.refreshChain('ethereum',{now:NOW,env,scan});
 const fresh=await monitor.latest('ethereum',{env,now:NOW+monitor.INTERVAL_MS});
 assert.equal(fresh.lag.state,'CAUGHT_UP');assert.equal(fresh.complete,true);
 const stale=await monitor.latest('ethereum',{env,now:NOW+3*monitor.INTERVAL_MS+1000});
 assert.equal(stale.status,'STALE');assert.equal(stale.complete,false);assert.equal(stale.reasonCode,'PULSE_MONITOR_NOT_RUNNING');
 assert.equal(stale.lag.state,'STALE_OBSERVATION');assert.ok(stale.lag.observationAgeSeconds>3*monitor.INTERVAL_MS/1000);
 assert.equal(stale.lastAttempt.complete,true);                        // history is not rewritten
}));

test('a failed attempt keeps the cursor, records the newest head it saw and stays a provider failure',()=>fixture(async env=>{
 const {scan,cfg}=chainOf('arc',{rate:2});
 const ok=await monitor.refreshChain('arc',{now:NOW,env,scan}),cursor=ok.coverage.nextBlock;
 const failed=await monitor.refreshChain('arc',{now:NOW+monitor.INTERVAL_MS,env,scan:async()=>({status:'PARTIAL_COVERAGE',complete:false,reasonCode:'ONCHAIN_BUDGET_EXHAUSTED',events:[],cost:{rpcCalls:48,httpRequests:48},
  head:{number:cursor+9000},confirmation:{policy:'DEPTH_FALLBACK',confirmedHead:cursor+9000-cfg.confirmationDepth}})});
 assert.equal(failed.status,'PARTIAL_COVERAGE');assert.equal(failed.complete,false);assert.equal(failed.reasonCode,'ONCHAIN_BUDGET_EXHAUSTED');
 assert.equal(failed.coverage.nextBlock,cursor);
 assert.equal(failed.lag.state,'LAGGING');assert.equal(failed.lag.blocks,cursor+9000-cfg.confirmationDepth-(cursor-1));
 // Persisted state still passes the unchanged checkpoint validation.
 const disk=await storage.read('arc',{env});assert.equal(disk.head.confirmedHead,cursor+9000-cfg.confirmationDepth);
}));

test('steady-state capacity versus the configured cadence is explicit for every network',()=>{
 for(const chain of Object.keys(watchlist.NETWORKS)){
  const cfg=watchlist.network(chain),lag=monitor.lagOf(chain,null);
  assert.equal(lag.capacityBlocksPerRun,monitor.scanCapacity(cfg)-Math.max(monitor.MIN_REORG_OVERLAP,cfg.confirmationDepth*2));
  assert.ok(lag.capacityBlocksPerRun>0);
 }
});
