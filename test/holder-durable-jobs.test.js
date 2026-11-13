'use strict';
// Regression: a holder job that FAILED with a long retry delay (GETTER_REVERTED 6 h, DISCOVERY_SPAN_EXCEEDED 12 h) used
// to disappear from /api/search?action=status after every worker restart, because the failing count came only from
// in-process counters. Production showed it: 51 tracked / 1 failing / DEGRADED before the Railway redeploy, then
// 50 tracked / 0 failing / HEALTHY right after it, with the job still FAILED in durable storage.
const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const storage=require('../lib/holder-storage'),P=require('../lib/holder-progress'),refresh=require('../lib/holder-refresh');
const status=require('../search/server/lib/operational-status');
const A='0x'+'a1'.repeat(20),B='0x'+'b2'.repeat(20),C='0x'+'c3'.repeat(20);
let dir,env;
beforeEach(async()=>{
 env={dir:process.env.ARC_INDEX_CACHE_DIR,mode:process.env.ARC_HOLDER_STORAGE};
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-durable-jobs-'));process.env.ARC_INDEX_CACHE_DIR=dir;process.env.ARC_HOLDER_STORAGE='local';
 P._reset();refresh._resetDurableSync();
});
afterEach(async()=>{
 if(env.dir===undefined)delete process.env.ARC_INDEX_CACHE_DIR;else process.env.ARC_INDEX_CACHE_DIR=env.dir;
 if(env.mode===undefined)delete process.env.ARC_HOLDER_STORAGE;else process.env.ARC_HOLDER_STORAGE=env.mode;
 await fs.rm(dir,{recursive:true,force:true});
});
const diag=()=>{const s=P.snapshot();return {ok:true,worker:{runtime:{commit:'1234567',startedAt:new Date().toISOString()},rpc:{metrics:{requests:10,http429:0},providers:[{cooldownMs:0}]},
 scheduler:{totals:s.totals,lastInvocation:{at:Date.now(),elapsedMs:10,served:[],states:{}}},tokens:s.tokens.map(t=>({address:t.address,phase:t.phase,lastState:t.lastState,lastReason:t.lastReason,lastAdvanced:t.lastAdvanced,slices:t.slices,idleMs:t.idleMs}))}};};
const later=()=>Date.now()+12*3600000;
const run=()=>refresh.run({limit:1,budgetMs:20000});

test('a durably FAILED job survives a worker restart and keeps the status DEGRADED until it is really retried',async()=>{
 for(const a of [A,B])assert.equal(await storage.enqueue(a,later()),true);
 await storage.setJob(A,{state:'FAILED',reasonCode:'HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED',retryAt:later()});
 await storage.setJob(B,{state:'READY'});
 assert.deepEqual(Object.keys(await storage.jobIndex()).sort(),[A,B]);
 // Restart: empty in-process counters, nothing due.
 P._reset();refresh._resetDurableSync();
 assert.equal(status.holderWorker(diag(),Date.now()).backlog.failing,0); // the old behaviour
 await run();
 const w=status.holderWorker(diag(),Date.now());
 assert.equal(w.state,'DEGRADED');assert.equal(w.reasonCode,'HOLDER_JOBS_FAILED');assert.equal(w.backlog.failing,1);
 assert.deepEqual(w.jobs.failingReasons,{HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED:1});
 assert.doesNotMatch(JSON.stringify(w),/0x[0-9a-f]{40}/i);
 // A READY job is never imported as a failure, and nothing is counted as a served slice.
 assert.equal(P.get(B)?.lastState??null,null);assert.equal(P.get(A).slices,0);assert.equal(P.snapshot().totals.failed,0);
});

test('jobs written before the index existed are back-filled from their own record, a few per invocation',async()=>{
 const tokens=[A,B,C];
 for(const a of tokens)await storage.enqueue(a,later());
 await storage.setJob(A,{state:'FAILED',reasonCode:'GETTER_REVERTED',retryAt:later()});
 await storage.setJob(C,{state:'UNSUPPORTED',reasonCode:'NOT_AN_ERC20'});
 await fs.rm(path.join(dir,'job-index.v2.json')); // pre-deploy state: durable jobs, no index
 P._reset();refresh._resetDurableSync();
 await run();
 const w=status.holderWorker(diag(),Date.now());
 assert.equal(w.backlog.failing,1);assert.equal(w.backlog.unsupported,1);
 const index=await storage.jobIndex();
 assert.equal(index[A].state,'FAILED');assert.equal(index[C].state,'UNSUPPORTED');assert.equal(index[B],undefined); // QUEUED jobs are not written
});

test('in-process observations win; a later READY record clears an imported failure; slices reset the durable flag',async()=>{
 await storage.enqueue(A,later());await storage.setJob(A,{state:'FAILED',reasonCode:'GETTER_REVERTED',retryAt:later()});
 P._reset();refresh._resetDurableSync();await run();
 assert.equal(P.get(A).lastState,'FAILED');assert.equal(P.get(A).durable,true);
 // The job completes elsewhere (or on retry) and the index says READY: the imported failure is withdrawn.
 assert.equal(P.durable(A,{state:'READY',updatedAt:Date.now()}),false);assert.equal(P.get(A).lastState,null);
 // A real slice in this process is authoritative and is never overwritten by the index.
 P.sliceDone(A,{state:'COMPLETE',elapsedMs:5,now:Date.now()});
 assert.equal(P.durable(A,{state:'FAILED',reasonCode:'GETTER_REVERTED',updatedAt:Date.now()}),false);assert.equal(P.get(A).lastState,'COMPLETE');assert.equal(P.get(A).durable,false);
});

test('corrupt or unavailable index never hides a failure as healthy and never breaks the worker loop',async()=>{
 await storage.enqueue(A,later());await storage.setJob(A,{state:'FAILED',reasonCode:'GETTER_REVERTED',retryAt:later()});
 await fs.writeFile(path.join(dir,'job-index.v2.json'),'{not json');
 P._reset();refresh._resetDurableSync();
 await assert.doesNotReject(run());
 // The corrupt index is treated as empty, the member is back-filled from its own record and re-indexed.
 assert.equal(status.holderWorker(diag(),Date.now()).backlog.failing,1);
 assert.equal((await storage.jobIndex())[A].state,'FAILED');
 // Malformed entries are dropped, not trusted.
 await fs.writeFile(path.join(dir,'job-index.v2.json'),JSON.stringify({[A+'-candidates']:{state:'BOGUS',updatedAt:1},['0x12-candidates']:{state:'FAILED',updatedAt:1}}));
 assert.deepEqual(await storage.jobIndex(),{});
 // A storage outage during the sync is recorded and the invocation still completes.
 const old=storage.jobIndex;storage.jobIndex=async()=>{throw Object.assign(Error('down'),{code:'STORAGE_UNAVAILABLE'});};
 try{P._reset();refresh._resetDurableSync();await assert.doesNotReject(run());}finally{storage.jobIndex=old;}
 const events=require('../lib/search-health').read().counts;assert.ok(events.HOLDER_JOB_INDEX_UNAVAILABLE>=1);
});

test('the index is re-read at most every 10 minutes and explicit-address runs never touch it',async()=>{
 let reads=0;const old=storage.jobIndex;storage.jobIndex=async()=>{reads++;return {};};
 try{await run();await run();assert.equal(reads,1);
  refresh._resetDurableSync();await refresh.run({limit:1,budgetMs:2000,addresses:[]}).catch(()=>{});assert.equal(reads,1);}
 finally{storage.jobIndex=old;}
});
