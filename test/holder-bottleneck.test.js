'use strict';
// Worker throughput regression + acceptance tests (PR #94, "Holder bottleneck" follow-up).
// Root causes covered: (1) provider pacing/concurrency penalties only recovered through successes, which an inflated
// interval made too rare to ever earn back -> slices of 1-2 requests and budget yields; (2) strict FIFO gave a token that
// needed two more slices the same wait as one needing fifty.
const test=require('node:test'),assert=require('node:assert/strict');
const sim=require('./helpers/holder-sim.cjs'),{create}=require('../lib/holder-rpc'),P=require('../lib/holder-progress'),refresh=require('../lib/holder-refresh'),budget=require('../lib/holder-budget');
const lcg=seed=>()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const R429=()=>({ok:false,status:429,headers:new Headers({'retry-after':'2'})});
const many=(first,rest,n=34)=>[{address:sim.addr(1),remaining:first},...Array.from({length:n},(_,i)=>({address:sim.addr(i+2),remaining:rest-i*20000}))];
const quiet=async fn=>{const log=console.error;console.error=()=>{};try{return await fn();}finally{console.error=log;}};

// ── 1. pacing ratchet ────────────────────────────────────────────────────────────────────────────────────
function client(handler){let clock=1_000_000;const c=create({endpoints:['p'],now:()=>clock,sleep:async ms=>{clock+=ms;},interval:500,fetcher:async(u,o)=>handler(JSON.parse(o.body),clock)});return {c,tick:ms=>{clock+=ms;},clock:()=>clock};}
test('provider penalties decay with quiet time and never below the configured base interval',async()=>{
 let faulty=true;const h=client(p=>faulty&&p.method!=='eth_chainId'?{ok:false,status:503,headers:new Headers()}:{ok:true,json:async()=>({id:p.id,result:p.method==='eth_chainId'?'0x13b2':'0x1'})});
 for(let i=0;i<4;i++){await h.c.rpc('eth_blockNumber',[]).catch(()=>{});h.tick(200000);}
 const hit=h.c.health()[0];assert.ok(hit.interval>500&&hit.limit===1,JSON.stringify(hit));
 faulty=false;
 // no relief while still inside the quiet window
 h.tick(5000);await h.c.rpc('eth_blockNumber',[]);assert.ok(h.c.health()[0].interval>=hit.interval/2);
 // quiet time relaxes it step by step (15 s per halving), floor = base
 let last=Infinity;for(let i=0;i<8;i++){h.tick(16000);await h.c.rpc('eth_blockNumber',[]);const now=h.c.health()[0].interval;assert.ok(now<=last&&now>=500);last=now;}
 const done=h.c.health()[0];assert.equal(done.interval,500);assert.equal(done.limit,2);assert.equal(done.baseInterval,500);
});
test('continued faults keep the penalty (no premature relief) and Retry-After cooldown still applies',async()=>{
 const h=client(p=>p.method==='eth_chainId'?{ok:true,json:async()=>({id:p.id,result:'0x13b2'})}:{ok:false,status:429,headers:new Headers({'retry-after':'30'})});
 await h.c.rpc('eth_blockNumber',[]).catch(()=>{});assert.ok(h.c.health()[0].cooldownMs>=29000);
 h.tick(31000);await h.c.rpc('eth_blockNumber',[]).catch(()=>{});assert.ok(h.c.health()[0].interval>=1000);
});

// ── 2. waiting does not eat the 12 s slice ───────────────────────────────────────────────────────────────
test('after a 429 burst the worker recovers its throughput; wait time stays a small share of the slice budget',async()=>{
 let burstUntil=0;const rnd=lcg(11);
 const s=await sim.create({tokens:many(1_000_000,1_000_000),faults:(u,i,t)=>t<burstUntil&&rnd()<0.5?R429():null});
 try{await quiet(async()=>{
  // healthy reference
  const base=await s.iteration();const baseProgress=Object.values(base.deltas).reduce((a,b)=>a+b,0);
  burstUntil=s.now()+120000;for(let i=0;i<3;i++)await s.iteration();
  for(let i=0;i<8;i++)await s.iteration();   // quiet again
  const tail=s.log.slice(-3),avg=tail.reduce((a,e)=>a+Object.values(e.deltas).reduce((x,y)=>x+y,0),0)/3;
  assert.ok(avg>=baseProgress*0.7,`throughput recovered: ${avg} vs healthy ${baseProgress}`);
  const waitShare=tail.reduce((a,e)=>a+e.cooldownWaitMs,0)/tail.reduce((a,e)=>a+e.elapsed,0);assert.ok(waitShare<0.1,'cooldown waiting share '+waitShare);
  const h=s.client.health();for(const p of h){assert.equal(p.interval,500);assert.equal(p.limit,2);}
 });}finally{s.cleanup();}
});
test('a wait that cannot fit the slice yields immediately: virtual time does not advance and no request starts',async()=>{
 const s=await sim.create({tokens:[],faults:()=>({ok:false,status:429,headers:new Headers({'retry-after':'60'})})});
 try{const t0=s.now();
  await budget.run(12000,()=>s.client.rpc('eth_blockNumber',[])).then(()=>assert.fail(),e=>assert.equal(e.code,'HOLDER_WORKER_BUDGET_EXHAUSTED'));
  const n=s.stats.requests;assert.ok(s.now()-t0<=12000,'no sleeping past the slice: '+(s.now()-t0));
  await budget.run(12000,()=>s.client.rpc('eth_blockNumber',[])).then(()=>assert.fail(),e=>assert.ok(e.eligibleInMs>0));
  assert.equal(s.stats.requests,n);
 }finally{s.cleanup();}
});

// ── 3. fair scheduling ───────────────────────────────────────────────────────────────────────────────────
test('rank(): longest-waiting tokens keep a reserved share, the rest go to the least remaining work',()=>{
 P._reset();const now=10_000_000,L=refresh.limits({limit:5}),a=i=>sim.addr(i);
 const st=(i,calls,served)=>{P.note(a(i),{phase:'TAIL',block:'0x'+(1_000_000).toString(16),tailCursor:1_000_000-calls*1000+1,tailRange:1000,addresses:[]},now);if(served!==null)P.sliceDone(a(i),{state:'BUILDING',reason:null,elapsedMs:1,advancedBefore:0,now:served});};
 st(1,900,now-700000);st(2,5,now-1000);st(3,40,now-2000);st(4,700,now-650000);st(5,2,now-10);st(6,3,now-20);
 const picked=refresh.rank([1,2,3,4,5,6].map(a),5,L,now);
 assert.equal(picked.length,6);
 assert.deepEqual(picked.slice(0,2).map(x=>x.a),[a(1),a(4)],'oldest waiting first (reserved share, starved)');assert.equal(picked[0].kind,'starved');
 assert.deepEqual(picked.slice(2).map(x=>x.a),[a(5),a(6),a(2),a(3)],'then least remaining work');
 P._reset();
});
test('fairness: every token is served repeatedly while near-complete tokens finish first', async()=>{
 const rnd=lcg(3),s=await sim.create({tokens:many(33732,1_000_000).reverse(),faults:()=>rnd()<0.02?R429():null});
 try{await quiet(async()=>{
  for(let i=0;i<40;i++)await s.iteration();
  const snap=P.snapshot(s.now());
  assert.ok(snap.tokens.every(t=>t.slices>=2),'no token starved: '+JSON.stringify(snap.tokens.map(t=>t.slices)));
  assert.ok(Math.max(...snap.tokens.map(t=>t.idleMs||0))<=refresh.limits().starveMs*1.5,'idle bound');
  const pg=await s.progress();assert.ok(pg[sim.addr(1)].done,'near-complete token finished');
  assert.ok(snap.totals.complete>=3);
 });}finally{s.cleanup();}
});

// ── 4. checkpoint correctness and resume ─────────────────────────────────────────────────────────────────
test('checkpoints advance monotonically; a restarted process resumes at the persisted cursor without rescanning',async()=>{
 const s=await sim.create({tokens:[{address:sim.addr(1),remaining:200000}]});
 try{await quiet(async()=>{
  const seen=[];for(let i=0;i<3;i++){await s.iteration();seen.push((await s.progress())[sim.addr(1)].cursor);}
  assert.ok(seen.every((c,i)=>i===0||c>seen[i-1]),'monotonic '+seen);
  const persisted=seen.at(-1);
  // simulated restart: all in-memory state (progress registry, RPC client, provider penalties) is lost
  P._reset();const fromBlocks=[];
  const o=s.client;let first=null;
  const orig=require('../lib/core').rpc;require('../lib/core').rpc=(m,p)=>{if(m==='eth_getLogs'&&first===null)first=Number(BigInt(p[0].fromBlock));return orig(m,p);};
  await s.iteration();require('../lib/core').rpc=orig;
  assert.equal(first,persisted,'first range after restart starts exactly at the persisted cursor');
  assert.ok((await s.progress())[sim.addr(1)].cursor>persisted);
 });}finally{s.cleanup();}
});
test('a mid-slice provider failure keeps every completed range and resumes from the next one',async()=>{
 let fail=false,ranges=0;const s=await sim.create({tokens:[{address:sim.addr(1),remaining:100000}],faults:(u,items)=>{if(!fail)return null;if(items[0].method==='eth_getLogs'&&++ranges>6)return {ok:false,status:503,headers:new Headers()};return null;}});
 try{await quiet(async()=>{
  fail=true;await s.iteration();
  const mid=(await s.progress())[sim.addr(1)].cursor;assert.ok(mid>=s.head-100000+1+1000,'completed ranges were checkpointed: '+mid);
  fail=false;s.advance(300000);ranges=0;await s.iteration();
  assert.ok((await s.progress())[sim.addr(1)].cursor>mid);
 });}finally{s.cleanup();}
});

// ── 5. synthetic acceptance: 33,732 blocks remaining reaches COMPLETE in repeated bounded runs ───────────
test('ACCEPTANCE: a token with 33,732 blocks left COMPLETEs across bounded worker runs while 34 large backlogs compete',async()=>{
 const rnd=lcg(21);
 // worst realistic shape: one working provider (no second endpoint), 2 % random 429s, near-complete token queued LAST
 const s=await sim.create({tokens:many(33732,1_000_000).reverse(),endpoints:['primary'],faults:()=>rnd()<0.02?R429():null});
 try{await quiet(async()=>{
  const cursors=[],t0=s.now();let n=0,complete=false;
  while(n<30&&!complete){await s.iteration();n++;const p=(await s.progress())[sim.addr(1)];cursors.push(p.cursor);complete=p.done;
   for(const e of s.log.slice(-1))assert.ok(e.elapsed<=45000,'each worker run stays inside its bounded budget: '+e.elapsed);}
  assert.ok(complete,'COMPLETE reached within 30 bounded runs; cursors '+cursors);
  assert.ok(cursors.every((c,i)=>i===0||c>=cursors[i-1]),'cursor never regresses');
  const fs=require('node:fs');
  // the persisted snapshot is a real pinned COMPLETE reconciliation (block + supply), not a shortcut
  const st=await require('../lib/holder-index').load(sim.addr(1)+'-candidates');
  assert.equal(st.phase,'COMPLETE');assert.equal(st.result.coverage.complete,true);assert.equal(st.result.block,'0x'+s.head.toString(16));
  assert.equal(String(st.total),'300');assert.equal(st.balanceCursor,st.addresses.length);
  assert.ok(s.now()-t0<=15*60*1000,'finished within 15 virtual minutes: '+(s.now()-t0)/1000+'s');
 });}finally{s.cleanup();}
});

// ── 6. authenticated diagnostics expose real counters, secret-free ───────────────────────────────────────
test('rpc-diagnostics?probe=0 reports RPC, pacing, cooldown, budget and per-token cursor counters without secrets or live probes',async()=>{
 const http=require('node:http');
 const saved={PORT:process.env.PORT,T:process.env.ARC_HOLDER_QUEUE_TOKEN,U:process.env.ARC_RPC_URL};
 const token='t'.repeat(32),port=30000+Math.floor(Math.random()*20000);
 process.env.PORT=String(port);process.env.ARC_HOLDER_QUEUE_TOKEN=token;process.env.ARC_RPC_URL='https://node.example/SECRETKEY0123456789abcdefghijklmnop';
 P._reset();P.note(sim.addr(9),{phase:'TAIL',block:'0x10',tailCursor:5,tailRange:4,addresses:[]});
 const server=require('../lib/holder-worker-http').start();
 try{
  await new Promise(r=>server.once('listening',r));
  const get=(path,auth)=>fetch(`http://127.0.0.1:${port}${path}`,{headers:auth?{authorization:'Bearer '+token}:{}});
  assert.equal((await get('/holder/rpc-diagnostics?probe=0',false)).status,401);
  const res=await get('/holder/rpc-diagnostics?probe=0',true),text=await res.text(),body=JSON.parse(text);
  assert.equal(res.status,200);assert.equal(body.providers,undefined,'no live probes when probe=0');
  assert.ok(!text.includes('SECRETKEY'));
  for(const k of ['requests','successful','http429','errors','fallbacks','backoffMs','pacingMs','cooldownWaitMs'])assert.ok(k in body.worker.rpc.metrics,k);
  assert.ok(body.worker.rpc.providers.every(p=>'interval' in p&&'cooldownMs' in p&&'http429' in p&&'baseInterval' in p));
  assert.ok('invocationMs' in body.worker.limits&&'sliceMs' in body.worker.limits);
  for(const k of ['slices','yielded','complete','cooldownYields','starvationPicks'])assert.ok(k in body.worker.scheduler.totals,k);
  const t=body.worker.tokens.find(x=>x.address===sim.addr(9));assert.equal(t.cursor,5);assert.equal(t.remainingBlocks,12);assert.equal(t.remainingCalls,3);
 }finally{server.close();P._reset();for(const [k,v] of [['PORT',saved.PORT],['ARC_HOLDER_QUEUE_TOKEN',saved.T],['ARC_RPC_URL',saved.U]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
