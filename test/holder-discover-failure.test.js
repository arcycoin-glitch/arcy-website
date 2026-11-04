'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../lib/holder-failure'),refresh=require('../lib/holder-refresh'),storage=require('../lib/holder-storage'),worker=require('../lib/holder-candidates'),P=require('../lib/holder-progress');
const A='0x'+'4c'.repeat(20),B='0x'+'5d'.repeat(20);
const timeout=()=>new DOMException('The operation was aborted due to timeout','TimeoutError');
test('opaque numeric DOMException code 23 becomes a stable, stage-aware classification',()=>{
 const e=timeout();assert.equal(e.code,23);
 assert.equal(F.reasonCode(e),'UPSTREAM_TIMEOUT');
 assert.equal(F.reasonCode(F.tag(timeout(),'discover_holders')),'DISCOVER_HOLDERS_TIMEOUT');
 assert.equal(F.reasonCode(F.tag(Object.assign(Error('HTTP 429'),{httpStatus:429}),'discover_stats')),'DISCOVER_STATS_RATE_LIMITED');
 assert.equal(F.reasonCode(F.tag(Object.assign(Error('HTTP 503'),{httpStatus:503}),'discover_token')),'DISCOVER_TOKEN_HTTP_5XX');
 assert.equal(F.reasonCode(F.tag(Object.assign(Error('HTTP 404'),{httpStatus:404}),'discover_token')),'DISCOVER_TOKEN_NOT_FOUND');
 assert.equal(F.reasonCode(Object.assign(Error(),{code:'MALFORMED_HOLDER_INDEX'})),'MALFORMED_HOLDER_INDEX');
 assert.equal(F.reasonCode(Object.assign(Error(),{code:'RPC_RATE_LIMIT'})),'RPC_RATE_LIMIT','existing string codes are preserved');
 assert.equal(F.reasonCode(new Error('x')),'UPSTREAM_UNCLASSIFIED');
 const budget=Object.assign(Error(),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});assert.equal(F.tag(budget,'discover_stats').holderStage,undefined,'budget exhaustion is never attributed to a dependency');
});
test('stall back-off: first failure keeps 60 s, then doubles to a 30 min cap; progress resets it',()=>{
 assert.equal(F.stalledDelay(60000,1),60000);assert.equal(F.stalledDelay(60000,2),120000);assert.equal(F.stalledDelay(60000,3),240000);
 assert.equal(F.stalledDelay(60000,50),F.MAX_STALL_DELAY_MS);
 P._reset();assert.equal(P.stall(A,true),1);assert.equal(P.stall(A,true),2);assert.equal(P.stall(A,false),0);assert.equal(P.stall(A,true),1);
});
test('a contract that times out in DISCOVER without progress backs off, never starves a healthy job, and keeps a stable reason',async()=>{
 const saved=[worker.advance,storage.enqueue,storage.setJob];P._reset();
 const queued=[],jobs=[];storage.enqueue=async(a,at)=>{queued.push({a,at});return true;};storage.setJob=async(a,u)=>{jobs.push({a,...u});return {};};
 worker.advance=async a=>{if(a===A)throw F.tag(timeout(),'discover_holders');return {value:{block:'0xa',snapshot:{freshness:'FRESH'}}};};
 try{
  const delays=[];
  for(let i=0;i<4;i++){const start=Date.now();const r=await refresh.run({addresses:[A,B],budgetMs:20000});
   const bad=r.find(x=>x.contract===A),good=r.find(x=>x.contract===B);
   assert.equal(bad.state,'FAILED');assert.equal(bad.reasonCode,'DISCOVER_HOLDERS_TIMEOUT');assert.equal(good.state,'COMPLETE','healthy job completes in the same invocation');
   delays.push(queued.filter(q=>q.a===A).at(-1).at-start);}
  assert.ok(delays[0]>=60000&&delays[0]<70000,String(delays[0]));
  assert.ok(delays[1]>=120000&&delays[2]>=240000&&delays[3]>=480000,JSON.stringify(delays));
  assert.ok(jobs.filter(j=>j.a===A&&j.state==='FAILED').every(j=>j.reasonCode==='DISCOVER_HOLDERS_TIMEOUT'));
  assert.ok(queued.filter(q=>q.a===B).every(q=>q.at>=Date.now()+500000-5000),'healthy contract keeps its 10 min refresh cadence');
 }finally{[worker.advance,storage.enqueue,storage.setJob]=saved;}
});
test('a budget yield caused by a provider cooldown is not a stall; progress resets the streak',async()=>{
 const saved=[worker.advance,storage.enqueue,storage.setJob];P._reset();storage.enqueue=async()=>true;storage.setJob=async()=>({});
 try{
  worker.advance=async()=>{throw Object.assign(Error(),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED',eligibleInMs:3000});};
  await refresh.run({addresses:[A],budgetMs:20000});await refresh.run({addresses:[A],budgetMs:20000});assert.equal(P.get(A).stallStreak,0);
  worker.advance=async()=>{throw F.tag(timeout(),'discover_stats');};
  await refresh.run({addresses:[A],budgetMs:20000});assert.equal(P.get(A).stallStreak,1);
  worker.advance=async()=>({value:{block:'0xa',snapshot:{freshness:'FRESH'}}});
  await refresh.run({addresses:[A],budgetMs:20000});assert.equal(P.get(A).stallStreak,0);
 }finally{[worker.advance,storage.enqueue,storage.setJob]=saved;}
});
test('explorer outage opens a shared breaker: one failing /stats call, then DISCOVER yields without any network call; recovery resets it',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),core=require('../lib/core');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-discover-')),before={...process.env};
 process.env.ARC_INDEX_CACHE_DIR=dir;process.env.ARC_HOLDER_STORAGE='local';
 const savedJson=core.json;let calls=[],mode='down';F.explorerOk();
 core.json=async url=>{calls.push(url);if(mode==='down')throw Object.assign(new Error('HTTP 522'),{httpStatus:522});if(url.endsWith('/stats'))return {chainId:5042,latestIndexedBlock:1};throw Object.assign(new Error('HTTP 404'),{httpStatus:404});};
 try{
  const a1='0x'+'11'.repeat(20),a2='0x'+'22'.repeat(20);
  await assert.rejects(()=>worker.advance(a1,{budgetMs:5000}),e=>F.reasonCode(e)==='DISCOVER_STATS_HTTP_5XX');
  assert.equal(calls.length,1);
  await assert.rejects(()=>worker.advance(a2,{budgetMs:5000}),{code:'EXPLORER_COOLDOWN'});
  assert.equal(calls.length,1,'no further explorer request while the breaker is open');
  assert.ok(F.explorerState().until>Date.now());
  F.explorerOk();mode='up';
  await assert.rejects(()=>worker.advance(a2,{budgetMs:5000}),e=>F.reasonCode(e)==='DISCOVER_TOKEN_NOT_FOUND');
  assert.equal(F.explorerState().streak,0,'a successful /stats closes the breaker; a token-level 404 never opens it');
 }finally{core.json=savedJson;F.explorerOk();for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await fs.rm(dir,{recursive:true,force:true});}
});
test('EXPLORER_COOLDOWN is a quiet yield: BUILDING, no FAILED job, no stall penalty, requeued at the breaker expiry',async()=>{
 const saved=[worker.advance,storage.enqueue,storage.setJob];P._reset();const q=[],jobs=[];
 storage.enqueue=async(a,at)=>{q.push(at);return true;};storage.setJob=async(a,u)=>{jobs.push(u);return {};};
 worker.advance=async()=>{throw Object.assign(new Error(),{code:'EXPLORER_COOLDOWN',eligibleInMs:90000});};
 try{const start=Date.now(),r=await refresh.run({addresses:[A],budgetMs:20000});
  assert.equal(r[0].state,'BUILDING');assert.equal(r[0].reasonCode,'EXPLORER_COOLDOWN');
  assert.ok(!jobs.some(j=>j.state==='FAILED'));assert.equal(P.get(A).stallStreak,0);assert.ok(q[0]>=start+90000&&q[0]<start+120000);
 }finally{[worker.advance,storage.enqueue,storage.setJob]=saved;}
});
