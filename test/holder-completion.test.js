'use strict';
// Acceptance tests for the Holder completion report (PR #94 comment 6506741965).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const core=require('../lib/core'),budget=require('../lib/holder-budget'),logRange=require('../lib/holder-log-range'),{create}=require('../lib/holder-rpc');
const TOKEN='0x'+'a'.repeat(40),TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex=n=>'0x'+n.toString(16),pad=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const log=(block,i)=>({address:TOKEN,topics:[TRANSFER,pad(0x1000+i),pad(0x2000+i)],data:pad(1),blockHash:'0x'+'b'.repeat(64),logIndex:hex(i),blockNumber:hex(block),removed:false});
function withCore(patch,fn){const saved={};for(const k of Object.keys(patch)){saved[k]=core[k];core[k]=patch[k];}return Promise.resolve().then(fn).finally(()=>{for(const k of Object.keys(saved))core[k]=saved[k];});}
const sparse=(from,to,density)=>Array.from({length:density},(_,i)=>log(from+(i%(to-from+1)),i));

// ── 1. width collapse recovery ───────────────────────────────────────────────────────────────────────────
test('persisted width=1 recovers geometrically after sparse successes and covers a 1,056,012-block backlog contiguously',async()=>{
 const start=1_000_000,head=start+1_056_012,calls=[];
 await withCore({rpc:async(m,params)=>{assert.equal(m,'eth_getLogs');calls.push([Number(BigInt(params[0].fromBlock)),Number(BigInt(params[0].toBlock))]);return [];}},async()=>{
  let cursor=start,width=1,reads=0;const widths=[];
  while(cursor<=head){const r=await logRange.read(TOKEN,cursor,head,width);assert.equal(r.to,cursor+r.scanned-1);cursor=r.to+1;width=r.width;widths.push(width);reads++;}
  assert.deepEqual(widths.slice(0,11),[2,4,8,16,32,64,128,256,512,1000,1000]);
  assert.ok(reads<=1070,'reads='+reads);
  // strictly contiguous, no gap, no overlap, nothing past the pinned head
  assert.equal(calls[0][0],start);for(let i=1;i<calls.length;i++)assert.equal(calls[i][0],calls[i-1][1]+1);
  assert.equal(calls.at(-1)[1],head);assert.ok(calls.every(([f,t])=>t-f+1<=1000));
 });
});
test('window growth is bounded by the cap and never follows dense, shrunk, or failed reads',async()=>{
 const prev=process.env.ARC_HOLDER_LOG_WINDOW_MAX;
 try{
  await withCore({rpc:async()=>[]},async()=>{
   process.env.ARC_HOLDER_LOG_WINDOW_MAX='300';assert.equal((await logRange.read(TOKEN,1,1e6,200)).width,300);assert.equal((await logRange.read(TOKEN,1,1e6,300)).width,300);
   process.env.ARC_HOLDER_LOG_WINDOW_MAX='999999';assert.equal((await logRange.read(TOKEN,1,1e6,2000)).width,2000,'hard ceiling 2000');
   delete process.env.ARC_HOLDER_LOG_WINDOW_MAX;assert.equal((await logRange.read(TOKEN,1,1e6,1000)).width,1000);
   // a window clipped by the pinned head keeps the learned width
   assert.equal((await logRange.read(TOKEN,999_990,1_000_000,400)).width,400);
  });
  await withCore({rpc:async(m,p)=>sparse(Number(BigInt(p[0].fromBlock)),Number(BigInt(p[0].toBlock)),300)},async()=>{
   assert.equal((await logRange.read(TOKEN,1,1e6,100)).width,100,'dense window (>=250 logs) must not grow');});
  let n=0;
  await withCore({rpc:async(m,p)=>{const w=Number(BigInt(p[0].toBlock))-Number(BigInt(p[0].fromBlock))+1;if(w>100)throw Object.assign(Error(),{code:'RPC_RANGE_LIMIT'});n++;return [];}},async()=>{
   const r=await logRange.read(TOKEN,1,1e6,1000);assert.equal(r.scanned,62);assert.equal(r.width,62,'after a range-limit error the width stays shrunk');});
  for(const code of ['RPC_CALL_FAILED','RPC_RATE_LIMIT','HOLDER_WORKER_BUDGET_EXHAUSTED','INVALID_TRANSFER_LOG'])
   await withCore({rpc:async()=>{throw Object.assign(Error(),{code});}},async()=>{await assert.rejects(logRange.read(TOKEN,1,1e6,10),{code});});
  // strict log validation is unchanged: a log outside the window still aborts the read
  await withCore({rpc:async()=>[log(5_000_000,1)]},async()=>{await assert.rejects(logRange.read(TOKEN,1,1e6,10),{code:'INVALID_TRANSFER_LOG'});});
  await withCore({rpc:async()=>Array.from({length:1000},(_,i)=>log(1,i))},async()=>{await assert.rejects(logRange.read(TOKEN,1,1e6,1),{code:'LOG_RESPONSE_POSSIBLY_TRUNCATED'});});
 }finally{if(prev===undefined)delete process.env.ARC_HOLDER_LOG_WINDOW_MAX;else process.env.ARC_HOLDER_LOG_WINDOW_MAX=prev;}
});

// ── 2. pruned history is remembered per provider+method+range ──────────────────────────────────────────────
function harness(handler,opts={}){let clock=0;const calls=[];const client=create({endpoints:['blockdaemon','quicknode'],now:()=>clock,sleep:async ms=>{clock+=ms;},interval:0,fetcher:async(url,options)=>{const p=JSON.parse(options.body);calls.push({url,p});return handler(url,p);},...opts});return {client,calls,tick:ms=>{clock+=ms;}};}
const ok=p=>({ok:true,json:async()=>Array.isArray(p)?p.map(x=>({id:x.id,result:'0x01'})):{id:p.id,result:p.method==='eth_chainId'?'0x13b2':[]}});
const pruned=p=>({ok:true,json:async()=>({id:p.id,error:{code:4444,message:'pruned history unavailable'}})});
const getLogs=(from,to)=>['eth_getLogs',[{address:TOKEN,topics:[TRANSFER],fromBlock:hex(from),toBlock:hex(to)}]];
test('a provider answering 4444/pruned for old ranges is not retried for every old range, but still serves latest reads',async()=>{
 const fail={quicknode:false};
 const h=harness((url,p)=>url==='blockdaemon'&&p.method==='eth_getLogs'?pruned(p):url==='quicknode'&&(fail.quicknode&&p.method==='eth_blockNumber'||fail.qnLogs&&p.method==='eth_getLogs')?{ok:false,status:503,headers:new Headers()}:ok(p));
 for(let i=0;i<30;i++)assert.deepEqual(await h.client.rpc(...getLogs(1000+i*1000,1999+i*1000)),[]);
 const wasted=h.calls.filter(x=>x.url==='blockdaemon'&&x.p.method==='eth_getLogs').length;
 assert.ok(wasted<=3,'blockdaemon getLogs attempts='+wasted);
 assert.equal(h.client.health()[0].cooldownMs,0,'pruned history is a capability limit, not a provider outage');
 assert.equal(h.client.health()[0].historyUnavailable,wasted);
 // latest-state reads are NOT globally disabled for this provider
 // (when the preferred provider is down, the pruned one is still a valid latest-state fallback)
 fail.quicknode=true;const seen=h.calls.length;assert.deepEqual(await h.client.rpc('eth_blockNumber',[]),[]);
 assert.ok(h.calls.slice(seen).some(x=>x.url==='blockdaemon'&&x.p.method==='eth_blockNumber'));fail.quicknode=false;
 // after expiry exactly one request re-probes the provider
 h.tick(11*60*1000);fail.qnLogs=true;const before=h.calls.filter(x=>x.url==='blockdaemon'&&x.p.method==='eth_getLogs').length;
 await h.client.rpc(...getLogs(99_000_000,99_000_999)).catch(e=>assert.equal(e.code,'RPC_CALL_FAILED'));
 assert.equal(h.calls.filter(x=>x.url==='blockdaemon'&&x.p.method==='eth_getLogs').length,before+1);
});
test('when only pruned providers remain the cache is ignored (re-probe) and the error stays honest',async()=>{
 const h=harness((url,p)=>p.method==='eth_getLogs'?pruned(p):ok(p));
 for(let i=0;i<4;i++)await assert.rejects(h.client.rpc(...getLogs(10+i,20+i)),{code:'RPC_CALL_FAILED',historyUnavailable:true});
 assert.ok(h.calls.filter(x=>x.p.method==='eth_getLogs').length>=8,'no provider is skipped when none is capable');
});
test('pruned history in one provider is cached by method: eth_call on the same provider still works',async()=>{
 const fail={on:false};
 const h=harness((url,p)=>url==='blockdaemon'&&p.method==='eth_getLogs'?pruned(p):url==='quicknode'&&fail.on&&p.method==='eth_call'?{ok:false,status:503,headers:new Headers()}:ok(p));
 for(let i=0;i<4;i++)await h.client.rpc(...getLogs(10+i,20+i));
 fail.on=true;const seen=h.calls.length;await h.client.rpc('eth_call',[{to:TOKEN,data:'0x'},hex(5)]);
 assert.ok(h.calls.slice(seen).some(x=>x.url==='blockdaemon'&&x.p.method==='eth_call'));
});

// ── 3. 429 quota: honour Retry-After, no fallback storm, no wasted slice ────────────────────────────────────
test('429 with Retry-After yields the token slice immediately with an eligibility time instead of sleeping through it',async()=>{
 let sleptMs=0;
 const h=harness(()=>({ok:false,status:429,headers:new Headers({'retry-after':'60'})}),{sleep:async ms=>{sleptMs+=ms;}});
 const started=Date.now();
 const r=await budget.run(12000,()=>h.client.rpc('eth_blockNumber',[])).then(()=>null,e=>e);
 assert.equal(r.code,'HOLDER_WORKER_BUDGET_EXHAUSTED');assert.ok(r.eligibleInMs>=50000,'eligibleInMs='+r.eligibleInMs);
 assert.ok(Date.now()-started<1000);assert.ok(sleptMs<12000,'slept '+sleptMs);
 assert.ok(h.calls.filter(x=>x.p.method==='eth_blockNumber'||x.p.method==='eth_chainId').length<=4,'each provider is hit at most once (no storm)');
 assert.ok(h.client.readyInMs()>=50000);
 // cooldown persists across slices: a second slice starts no request at all
 const n=h.calls.length;await budget.run(12000,()=>h.client.rpc('eth_blockNumber',[])).then(()=>assert.fail(),e=>assert.equal(e.code,'HOLDER_WORKER_BUDGET_EXHAUSTED'));
 assert.equal(h.calls.length,n);
 assert.equal(h.client.health()[0].http429,1);
});
test('refresh requeues a token for the provider eligibility time instead of starting a slice that cannot make progress',async()=>{
 const refresh=require('../lib/holder-refresh'),storage=require('../lib/holder-storage'),worker=require('../lib/holder-candidates');
 const orig=[storage.due,storage.enqueue,storage.setJob,worker.advance,refresh.readyInMs],queued=[];let advanced=0;
 const jobs=[addr(1),addr(2)];
 storage.due=async()=>jobs.splice(0,5);storage.enqueue=async(a,at)=>{queued.push({a,at});return true;};storage.setJob=async()=>{};worker.advance=async()=>{advanced++;return {value:null};};refresh.readyInMs=()=>90000;
 try{const t0=Date.now(),r=await refresh.run({limit:5,budgetMs:40000,incompleteDelayMs:5000});
  assert.equal(advanced,0);assert.equal(r.length,2);assert.ok(r.every(x=>x.reasonCode==='RPC_COOLDOWN_YIELD'&&x.eligibleInMs>=90000));
  assert.ok(queued.every(q=>q.at>=t0+90000&&q.at<=t0+90000*1.25+2000));assert.notEqual(queued[0].at,queued[1].at,'retries are staggered');
 }finally{[storage.due,storage.enqueue,storage.setJob,worker.advance,refresh.readyInMs]=orig;}
});

// ── 4. configurable, bounded budgets ───────────────────────────────────────────────────────────────────────
test('worker budgets are env-tunable inside safe bounds and keep legacy defaults',()=>{
 const {limits}=require('../lib/holder-refresh'),names=['ARC_HOLDER_INVOCATION_BUDGET_MS','ARC_HOLDER_TOKEN_SLICE_MS','ARC_HOLDER_BATCH_LIMIT','ARC_HOLDER_INCOMPLETE_DELAY_MS','ARC_HOLDER_CHECKPOINT_RESERVE_MS'],saved=names.map(n=>process.env[n]);
 try{
  names.forEach(n=>delete process.env[n]);
  assert.deepEqual(limits({limit:5,budgetMs:40000,incompleteDelayMs:5000}),{invocationMs:40000,sliceMs:12000,batchLimit:5,incompleteDelayMs:5000,reserveMs:2000,maxRetryDelayMs:120000});
  Object.assign(process.env,{ARC_HOLDER_INVOCATION_BUDGET_MS:'90000',ARC_HOLDER_TOKEN_SLICE_MS:'25000',ARC_HOLDER_BATCH_LIMIT:'8',ARC_HOLDER_INCOMPLETE_DELAY_MS:'2000',ARC_HOLDER_CHECKPOINT_RESERVE_MS:'3000'});
  const l=limits({limit:5,budgetMs:40000,incompleteDelayMs:5000});assert.deepEqual([l.invocationMs,l.sliceMs,l.batchLimit,l.incompleteDelayMs,l.reserveMs],[90000,25000,8,2000,3000]);
  Object.assign(process.env,{ARC_HOLDER_INVOCATION_BUDGET_MS:'99999999',ARC_HOLDER_TOKEN_SLICE_MS:'1',ARC_HOLDER_BATCH_LIMIT:'9999',ARC_HOLDER_INCOMPLETE_DELAY_MS:'1',ARC_HOLDER_CHECKPOINT_RESERVE_MS:'999999'});
  const c=limits();assert.deepEqual([c.invocationMs,c.sliceMs,c.batchLimit,c.incompleteDelayMs,c.reserveMs],[120000,3000,20,1000,10000]);
  Object.assign(process.env,{ARC_HOLDER_INVOCATION_BUDGET_MS:'abc',ARC_HOLDER_TOKEN_SLICE_MS:'-5'});assert.equal(limits().invocationMs,40000);assert.equal(limits().sliceMs,12000);
 }finally{names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i];});}
});

// ── 5. 200-address individual fallback across bounded slices ───────────────────────────────────────────────
test('a 200-address individual balance fallback completes across bounded slices with no lost or reordered cursor',async()=>{
 const reader=require('../lib/balance-reader'),prev=process.env.ARC_HOLDER_CHECKPOINT_RESERVE_MS;process.env.ARC_HOLDER_CHECKPOINT_RESERVE_MS='500';
 const addresses=Array.from({length:200},(_,i)=>addr(i+1)),batches=[];
 try{await withCore({rpc:async m=>m==='eth_chainId'?'0x13b2':'0x00',batch:async calls=>{await new Promise(r=>setTimeout(r,25));batches.push(calls.length);return calls.map(c=>hex(BigInt('0x'+c.params[0].data.slice(-40))*10n));}},async()=>{
  let cursor=0,slices=0;
  while(cursor<addresses.length){
   const wanted=addresses.slice(cursor,cursor+200);
   const res=await budget.run(800,()=>reader.balances(TOKEN,wanted,hex(77)));
   assert.match(res.method,/Individual/);
   assert.ok(res.values.length>0&&res.values.length<=wanted.length);
   res.values.forEach((v,i)=>assert.equal(BigInt(v),BigInt(cursor+i+1)*10n,'value belongs to its own address'));
   cursor+=res.values.length;slices++;assert.ok(slices<60);
  }
  assert.equal(cursor,200);assert.ok(slices>1,'work was split across slices: '+slices);assert.ok(batches.every(n=>n<=5));
 });}finally{if(prev===undefined)delete process.env.ARC_HOLDER_CHECKPOINT_RESERVE_MS;else process.env.ARC_HOLDER_CHECKPOINT_RESERVE_MS=prev;}
});
test('budget cancellation never triggers the long individual fallback and never invents values',async()=>{
 const reader=require('../lib/balance-reader');let individual=0,multicall=0;
 await withCore({rpc:async m=>{if(m==='eth_chainId')return '0x13b2';await new Promise(r=>setTimeout(r,200));return '0x00';},call:async()=>{multicall++;return '0x';},batch:async()=>{individual++;return [];}},async()=>{
  await assert.rejects(budget.run(60,()=>reader.balances(TOKEN,[addr(1),addr(2)],hex(5))),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});
  await new Promise(r=>setTimeout(r,300));assert.equal(individual,0);
 });
 // no room before the first chunk: yield, do not start work that cannot be checkpointed
 await withCore({rpc:async m=>m==='eth_chainId'?'0x13b2':'0x00',batch:async()=>{individual++;return ['0x01'];}},async()=>{
  await assert.rejects(budget.run(300,()=>reader.balances(TOKEN,[addr(1)],hex(5))),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});assert.equal(individual,0);});
});

// ── 6. cancellation cannot write after the lease is released ───────────────────────────────────────────────
test('a cancelled or late task cannot write a checkpoint after budget expiry or lease release',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-late-')),old={s:process.env.ARC_HOLDER_STORAGE,d:process.env.ARC_INDEX_CACHE_DIR,r:process.env.ARC_INDEX_REDIS_URL};
 process.env.ARC_HOLDER_STORAGE='local';process.env.ARC_INDEX_CACHE_DIR=dir;delete process.env.ARC_INDEX_REDIS_URL;
 try{
  const storage=require('../lib/holder-storage'),a=addr(0xabc),name=a+'-candidates',cp={version:1,address:a,chainId:5042,startedAt:Date.now(),phase:'DISCOVER',offset:0,addresses:[],balances:[],balanceCursor:0};
  // (a) deadline passes while the task is still working
  await assert.rejects(budget.run(40,()=>storage.withLease(name,async()=>{await new Promise(r=>setTimeout(r,120));await storage.save(name,cp);})),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});
  assert.equal(fs.readdirSync(dir).filter(f=>f.includes(name)).length,0);
  // (b) a lingering continuation fires after the lease was released
  let late;await storage.withLease(name,async()=>{late=new Promise(r=>setTimeout(r,60)).then(()=>storage.save(name,cp));});
  await assert.rejects(late,{code:'HOLDER_LEASE_LOST'});assert.equal(fs.readdirSync(dir).filter(f=>f.includes(name)).length,0);
  // (c) the lease holder itself may still write
  await storage.withLease(name,()=>storage.save(name,cp));assert.ok(fs.readdirSync(dir).some(f=>f.includes(name)));
 }finally{for(const [k,v] of [['ARC_HOLDER_STORAGE',old.s],['ARC_INDEX_CACHE_DIR',old.d],['ARC_INDEX_REDIS_URL',old.r]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(dir,{recursive:true,force:true});}
});

// ── 7. partial individual reads checkpoint per chunk and still require exact supply reconciliation ──────────
async function runBuild(totalSupply){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-build-')),old={s:process.env.ARC_HOLDER_STORAGE,d:process.env.ARC_INDEX_CACHE_DIR,r:process.env.ARC_INDEX_REDIS_URL};
 process.env.ARC_HOLDER_STORAGE='local';process.env.ARC_INDEX_CACHE_DIR=dir;delete process.env.ARC_INDEX_REDIS_URL;
 const reader=require('../lib/balance-reader'),worker=require('../lib/holder-candidates'),orig=reader.balances,a=addr(0x5150),wallets=Array.from({length:12},(_,i)=>addr(0x9000+i)),seen=[];
 reader.balances=async(token,addresses)=>{const n=Math.min(addresses.length,5);seen.push(n);return {method:'Individual pinned Arc RPC balanceOf calls',partial:true,values:addresses.slice(0,n).map(()=>pad(100)),multicallFailure:null};};
 try{
  return await withCore({
   json:async u=>u.endsWith('/stats')?{chainId:5042,indexedBlocks:10}:u.includes('holders?')?{items:wallets.map(address=>({address})),nextOffset:null}:{address:a},
   context:async()=>({block:'0xa'}),call:async()=>pad(totalSupply),rpc:async m=>m==='eth_chainId'?'0x13b2':m==='eth_getLogs'?[]:{hash:'0x'+'a'.repeat(64)}},
   async()=>{const steps=[];let r;for(let i=0;i<14;i++){r=await worker.advance(a,{budgetMs:5000,maxBatches:1});const s=JSON.parse(fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(f=>f.endsWith('.v2.json'))),'utf8'));steps.push(s.checkpoint?.balanceCursor??null);if(r?.value?.snapshot)break;}return {r,steps,seen};});
 }finally{reader.balances=orig;for(const [k,v] of [['ARC_HOLDER_STORAGE',old.s],['ARC_INDEX_CACHE_DIR',old.d],['ARC_INDEX_REDIS_URL',old.r]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(dir,{recursive:true,force:true});}
}
test('partial balance chunks advance the durable cursor monotonically and complete only on exact supply reconciliation',async()=>{
 const {r,steps}=await runBuild(1400); // 14 candidate addresses x 100
 assert.ok(r.value?.snapshot,'completes once every candidate was read at the pinned block: '+JSON.stringify(r));
 const cursors=steps.filter(x=>x!==null);assert.ok(cursors.every((x,i)=>i===0||x>=cursors[i-1]),'cursor never moves backwards: '+cursors);assert.ok(cursors.includes(5)&&cursors.includes(10)&&cursors.includes(14),'progress persisted per chunk: '+cursors);
});
test('supply mismatch after partial reads never publishes a COMPLETE snapshot',async()=>{
 const {r}=await runBuild(1401);
 assert.ok(!r.value?.snapshot||r.value.snapshot.freshness!=='FRESH'||r.value.holderCount===undefined,'must not complete: '+JSON.stringify(r).slice(0,300));
 assert.ok(r.reasonCode||r.value===null||r.value?.snapshot?.refresh?.reasonCode,'a reconciliation reason is reported');
});
