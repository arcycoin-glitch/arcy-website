'use strict';
// Evidence-based negative states must not spin paid RPC loops or claim COMPLETE.
// Does not alter durable snapshots, queue admission, supply reconciliation or source proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const refresh=require('../lib/holder-refresh'),worker=require('../lib/holder-candidates'),storage=require('../lib/holder-storage'),core=require('../lib/core');
const a=n=>'0x'+n.toString(16).padStart(40,'0');
test('stable retry policy keeps deterministic RPC contract blockers separate from transient failures',()=>{
 assert.equal(refresh.stableFailureDelay('GETTER_REVERTED'),6*3600000);
 assert.equal(refresh.stableFailureDelay('HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED'),12*3600000);
 for(const c of ['RPC_RATE_LIMIT','UPSTREAM_TIMEOUT','HOLDER_WORKER_BUDGET_EXHAUSTED','EXPLORER_COOLDOWN','HOLDER_SUPPLY_RECONCILIATION_FAILED'])assert.equal(refresh.stableFailureDelay(c),0);
});
test('getter revert remains FAILED, is recorded and requeued after six hours instead of hot-looping',async()=>{
 const orig=[worker.advance,storage.enqueue,storage.setJob,core.rpc];
 // Not a pool: every interface getter reverts too, so the generic GETTER_REVERTED classification must stay.
 core.rpc=async method=>{if(method==='eth_blockNumber')return '0x10';throw Object.assign(Error('execution reverted'),{code:'GETTER_REVERTED'});};
 const contract=a(60001),queue=[],jobs=[];
 worker.advance=async()=>{throw Object.assign(Error('balanceOf reverted'),{code:'GETTER_REVERTED'})};
 storage.enqueue=async(address,at,replace)=>{queue.push({address,at,replace});return true};
 storage.setJob=async(address,payload)=>{jobs.push({address,payload});return true};
 try{
  const start=Date.now(),rows=await refresh.run({addresses:[contract],budgetMs:10000});
  assert.equal(rows.length,1);assert.equal(rows[0].state,'FAILED');assert.equal(rows[0].reasonCode,'GETTER_REVERTED');
  assert.equal(queue.length,1);assert.equal(queue[0].replace,true);
  assert.ok(queue[0].at-start>=6*3600000-1000&&queue[0].at-start<=6*3600000+1000);
  assert.equal(jobs.at(-1).payload.state,'FAILED');assert.equal(jobs.at(-1).payload.reasonCode,'GETTER_REVERTED');
  assert.ok(Math.abs(queue[0].at-jobs.at(-1).payload.retryAt)<1500,'Durable job retryAt and queue agree');
 }finally{[worker.advance,storage.enqueue,storage.setJob,core.rpc]=orig;}
});
test('exceeded discovery span preserves guard and schedules long bounded recheck',async()=>{
 const orig=[worker.advance,storage.enqueue,storage.setJob],q=[],jobs=[];
 worker.advance=async()=>{throw Object.assign(Error('10m-block scan cap exceeded'),{code:'HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED'})};
 storage.enqueue=async(address,at)=>{q.push(at);return true};
 storage.setJob=async(address,payload)=>{jobs.push(payload);return true};
 try{
  const now=Date.now(),r=await refresh.run({addresses:[a(60002)],budgetMs:10000});
  assert.equal(r.length,1);assert.equal(r[0].state,'FAILED');
  assert.equal(r[0].reasonCode,'HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED');
  assert.ok(q[0]-now>=12*3600000-1000&&q[0]-now<=12*3600000+1000);
  assert.ok(Math.abs(q[0]-jobs.at(-1).retryAt)<1500);
 }finally{[worker.advance,storage.enqueue,storage.setJob]=orig;}
});
