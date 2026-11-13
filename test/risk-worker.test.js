'use strict';
const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const storeModule=require('../lib/risk-engine/store');
const worker=require('../lib/risk-engine/worker');
const status=require('../search/server/lib/operational-status');
const T1='0x'+'a1'.repeat(20),T2='0x'+'b2'.repeat(20),T3='0x'+'c3'.repeat(20),NOW=Date.parse('2026-11-14T00:00:00Z');
let dir,env;
beforeEach(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-risk-store-'));env={ARC_RISK_STORAGE:'local',ARC_RISK_STORE_DIR:dir,ARC_AUTONOMY_RISK_WORKER_ENABLED:'1'};worker._reset();});
afterEach(()=>fs.rm(dir,{recursive:true,force:true}));
const head=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x100'}));
const result=(over={})=>({scope:null,block:{number:'250'},generatedAt:new Date(NOW).toISOString(),records:[],findings:[{ruleId:'privileged-minting',status:'UNKNOWN'}],evidenceGaps:{'privileged-minting':'NO_REVIEWED_EXECUTION_ROUTE'},
 producers:{},operators:{authority:[{state:'OK'}]},cost:{rpcCalls:40,totalMs:900},ledger:{state:'RECORDED',history:'PRESERVED'},...over});

test('store: deduplicated durable queue, ordering, removal, snapshots and fail-closed configuration',async()=>{
 const s=storeModule.open({env});
 assert.equal(await s.enqueue('ethereum',T1,NOW+10),true);assert.equal(await s.enqueue('ethereum',T1,NOW),true); // NX: due time kept
 await s.enqueue('arc',T2,NOW-5);
 assert.deepEqual(await s.due(NOW+5,10),[{network:'arc',token:T2}]);
 assert.deepEqual(await s.due(NOW+20,10),[{network:'arc',token:T2},{network:'ethereum',token:T1}]);
 await s.enqueue('ethereum',T1,NOW-100,{replace:true});assert.deepEqual((await s.due(NOW,1))[0],{network:'ethereum',token:T1});
 assert.deepEqual(await s.depth(NOW),{total:2,due:2});
 await s.remove('arc',T2);assert.deepEqual(await s.depth(NOW),{total:1,due:1});
 await s.putSnapshot('ethereum',T1,{a:1});assert.deepEqual(await storeModule.open({env}).getSnapshot('ethereum',T1),{a:1}); // survives a new process handle
 await assert.rejects(s.enqueue('polygon',T1,NOW),{code:'RISK_STORE_INVALID_KEY'});await assert.rejects(s.enqueue('ethereum','0x12',NOW),{code:'RISK_STORE_INVALID_KEY'});
 // No durable location => unavailable (never the ephemeral tmp directory).
 assert.throws(()=>storeModule.open({env:{ARC_RISK_STORAGE:'local'}}),{code:'RISK_STORE_UNAVAILABLE'});
 assert.throws(()=>storeModule.open({env:{UPSTASH_REDIS_REST_URL:'https://x'}}),{code:'RISK_STORE_CONFIGURATION_INCOMPLETE'});
 // Corrupt document: reported, never silently reset.
 await fs.writeFile(path.join(dir,'risk-store.v1.json'),'{nope');
 await assert.rejects(storeModule.open({env}).due(NOW,1),{code:'RISK_STORE_CORRUPT'});
 // Redis errors map to coded failures.
 const r=storeModule.open({env:{UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'t'},fetcher:async()=>new Response('x',{status:429})});
 await assert.rejects(r.due(NOW,1),{code:'RISK_STORE_RATE_LIMITED'});
});

test('store: the queue is bounded',async()=>{
 const s=storeModule.open({env});
 for(let i=0;i<storeModule.MAX_QUEUE;i++)assert.equal(await s.enqueue('ethereum','0x'+i.toString(16).padStart(40,'0'),NOW),true);
 assert.equal(await s.enqueue('ethereum',T1,NOW),false);
});

test('worker: OFF does nothing; ON completes a due job, stores the snapshot and reschedules; restart keeps the schedule',async()=>{
 const calls=[];
 assert.equal(await worker.tick({env:{...env,ARC_AUTONOMY_RISK_WORKER_ENABLED:'0'},fetcher:async()=>{calls.push(1);},now:()=>NOW}),null);assert.equal(calls.length,0);
 const s=storeModule.open({env});await s.enqueue('ethereum',T1,NOW-1);
 const seen=[];
 const out=await worker.tick({env,fetcher:head,now:()=>NOW,analyze:async a=>{seen.push(a);return result();}});
 assert.equal(out.state,'RAN');assert.equal(out.results[0].state,'COMPLETE');
 assert.equal(seen[0].block,'0x'+(0x100-6).toString(16));assert.equal(seen[0].token,T1);
 const snap=await s.getSnapshot('ethereum',T1);assert.equal(snap.block.number,'250');assert.equal(snap.ledger.history,'PRESERVED');
 assert.equal((await s.getJob('ethereum',T1)).state,'COMPLETE');
 assert.deepEqual(await s.due(NOW+worker.DEFAULTS.refreshMs-1,5),[]);assert.equal((await s.due(NOW+worker.DEFAULTS.refreshMs,5)).length,1);
 // Throttle: a second tick inside a minute does nothing.
 assert.deepEqual(await worker.tick({env,fetcher:head,now:()=>NOW+1000,analyze:async()=>{throw Error('must not run');}}),{state:'NOT_DUE'});
 // Process restart: in-memory state is gone, the durable schedule is not.
 worker._reset();
 const again=await worker.tick({env,fetcher:head,now:()=>NOW+5000,analyze:async()=>{throw Error('must not run');}});
 assert.deepEqual(again.results,[]);
 const m=await s.getMetrics();assert.equal(m.queue.total,1);assert.doesNotMatch(JSON.stringify(m),/0x[0-9a-f]{40}/i);
});

test('worker: recoverable failures back off, permanent ones are removed, budgets defer, deadlines are respected',async()=>{
 const s=storeModule.open({env});
 // All operators failed (429 / outage / cooldown) => RETRY with exponential backoff, no snapshot.
 await s.enqueue('ethereum',T1,NOW-1);
 const outage=async()=>result({operators:{authority:[{state:'FAILED'},{state:'SKIPPED'}],pool:[{state:'FAILED'}]}});
 let r=await worker.tick({env,fetcher:head,now:()=>NOW,analyze:outage});
 assert.equal(r.results[0].state,'RETRY');assert.equal(r.results[0].attempts,1);assert.equal(await s.getSnapshot('ethereum',T1),null);
 worker._reset();r=await worker.tick({env,fetcher:head,now:()=>NOW+125000,analyze:outage});
 assert.equal(r.results[0].attempts,2);assert.equal(Date.parse(r.results[0].nextAt)-(NOW+125000),4*60000);
 // RPC head unavailable => coded retry.
 worker._reset();await s.enqueue('ethereum',T1,NOW,{replace:true});
 r=await worker.tick({env,fetcher:async()=>new Response('x',{status:503}),now:()=>NOW+200000,analyze:outage});
 assert.equal(r.results[0].state,'RETRY');assert.equal(r.results[0].reasonCode,'RPC_UNAVAILABLE');
 // Permanently invalid => removed and recorded as REJECTED.
 worker._reset();await s.enqueue('arc',T2,NOW);
 r=await worker.tick({env,fetcher:head,now:()=>NOW+10**7,analyze:async()=>{throw Object.assign(Error('x'),{code:'RISK_PRODUCER_INVALID_TOKEN'});},options:{maxJobs:5}});
 const rejected=r.results.find(x=>x.network==='arc');assert.equal(rejected.state,'REJECTED');
 assert.ok(!(await s.due(NOW+10**9,10)).some(x=>x.token===T2));
 // Hourly RPC budget exhausted => deferred, analysis not run.
 worker._reset();await s.enqueue('robinhood',T3,NOW);
 r=await worker.tick({env,fetcher:head,now:()=>NOW+2*10**7,options:{rpcPerNetworkHour:100,maxJobs:5},analyze:async()=>{throw Error('must not run');}});
 assert.equal(r.results.find(x=>x.network==='robinhood').state,'BUDGET_DEFERRED');
 // Too little time left in the worker slice => nothing started.
 worker._reset();
 r=await worker.tick({env,fetcher:head,now:()=>NOW+3*10**7,deadlineAt:NOW+3*10**7+1000,analyze:async()=>{throw Error('must not run');}});
 assert.deepEqual(r.results,[]);
 // A corrupt store never crashes the worker loop.
 worker._reset();await fs.writeFile(path.join(dir,'risk-store.v1.json'),'{bad');
 assert.deepEqual(await worker.tick({env,fetcher:head,now:()=>NOW}),{state:'STORE_UNAVAILABLE',reasonCode:'RISK_STORE_CORRUPT'});
});

test('status: risk worker metrics are counts and reason codes only',()=>{
 const w=status.holderWorker({ok:true,worker:{runtime:{commit:'1234567',startedAt:new Date(NOW).toISOString()},rpc:{metrics:{requests:1,http429:0},providers:[]},
  scheduler:{totals:{},lastInvocation:{at:NOW,elapsedMs:1,served:[],states:{}}},tokens:[],
  risk:{enabled:true,lastTickAt:new Date(NOW-30000).toISOString(),totals:{ticks:3,complete:2},findingStatuses:{UNKNOWN:10,CONFIRMED:2},unknownCauses:{PRICE_ANCHOR_NOT_REVIEWED:2},
   queue:{total:4,due:1},jobMs:{p50:900,p95:2100,samples:2},rpcLastHour:{ethereum:120},lastJob:{network:'ethereum',state:'COMPLETE'},extra:'0x'+'ab'.repeat(20)}}},NOW);
 assert.deepEqual(w.risk,{enabled:true,lastTickAgeSeconds:30,totals:{ticks:3,complete:2},findingStatuses:{UNKNOWN:10,CONFIRMED:2},unknownCauses:{PRICE_ANCHOR_NOT_REVIEWED:2},
  queue:{total:4,due:1},jobMs:{p50:900,p95:2100,samples:2},rpcLastHour:{ethereum:120}});
 assert.deepEqual(status.holderWorker({ok:true,worker:{runtime:{},rpc:{metrics:{},providers:[]},scheduler:{totals:{},lastInvocation:null},tokens:[]}},NOW).risk,{enabled:false,reasonCode:'NOT_REPORTED'});
});
