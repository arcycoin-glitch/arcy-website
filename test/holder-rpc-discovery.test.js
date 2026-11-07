'use strict';
// RPC Transfer-log discovery fallback for Arc holder DISCOVER when the explorer index is unavailable.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const core=require('../lib/core'),reader=require('../lib/balance-reader'),F=require('../lib/holder-failure'),RD=require('../lib/holder-rpc-discovery');
const worker=require('../lib/holder-candidates'),storage=require('../lib/holder-storage');
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex=n=>'0x'+BigInt(n).toString(16),pad=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),word=a=>'0x'+'0'.repeat(24)+a.slice(2);
const ZERO='0x'+'0'.repeat(40),W1='0x'+'a1'.repeat(20),W2='0x'+'b2'.repeat(20),W3='0x'+'c3'.repeat(20);
function chain({a,head=10000,deploy=7321,transfers,supply,extra={},chainId='0x13b2'}){
 const balances=new Map();for(const t of transfers){if(t.from!==ZERO)balances.set(t.from,(balances.get(t.from)||0n)-t.value);balances.set(t.to,(balances.get(t.to)||0n)+t.value);}
 for(const [k,v] of Object.entries(extra))balances.set(k,(balances.get(k)||0n)+v);
 const total=supply??[...balances.entries()].filter(([k])=>k!==ZERO).reduce((n,[,v])=>n+v,0n);
 const calls={getCode:0,getLogs:[],json:0};
 const rpc=async(method,params)=>{
  if(method==='eth_chainId')return chainId;
  if(method==='eth_blockNumber')return hex(head);
  if(method==='eth_getBlockByNumber')return {hash:'0x'+'ab'.repeat(32)};
  if(method==='eth_getCode'){calls.getCode++;assert.equal(params[0],a);const b=Number(BigInt(params[1]));return b>=deploy?'0x363d3d37':'0x';}
  if(method==='eth_getLogs'){const q=params[0],from=Number(BigInt(q.fromBlock)),to=Number(BigInt(q.toBlock));assert.equal(q.address,a);assert.ok(to-from+1<=2000,'bounded window');calls.getLogs.push([from,to]);
   return transfers.map((t,i)=>({...t,i})).filter(t=>t.block>=from&&t.block<=to).map(t=>({address:a,topics:[TRANSFER,word(t.from),word(t.to)],data:pad(t.value),blockHash:'0x'+'cd'.repeat(32),logIndex:hex(t.i),blockNumber:hex(t.block),removed:false}));}
  throw new Error('unexpected '+method);
 };
 return {rpc,calls,total,balances,head};
}
async function harness(sim,fn,env={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-rpcdisc-')),before={...process.env},saved={json:core.json,rpc:core.rpc,call:core.call,context:core.context,balances:reader.balances};
 Object.assign(process.env,{ARC_INDEX_CACHE_DIR:dir,ARC_HOLDER_STORAGE:'local',...env});delete process.env.ARC_HOLDER_WORKER_RPC;
 core.json=async()=>{sim.calls.json++;throw Object.assign(new Error('HTTP 522'),{httpStatus:522});};
 core.rpc=sim.rpc;core.call=async(to,data)=>{assert.equal(data,'0x18160ddd');return pad(sim.total);};core.context=async()=>({block:hex(sim.head)});
 reader.balances=async(t,addresses)=>({method:'fixture',values:addresses.map(x=>pad(sim.balances.get(x)>0n?sim.balances.get(x):0n))});
 F.explorerOk();
 try{return await fn();}finally{Object.assign(core,{json:saved.json,rpc:saved.rpc,call:saved.call,context:saved.context});reader.balances=saved.balances;F.explorerOk();for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await fs.rm(dir,{recursive:true,force:true});}
}
async function drive(a,max=40){const seen=[];for(let i=0;i<max;i++){try{const r=await worker.advance(a,{budgetMs:5000});seen.push(r.reasonCode||r.status);if(r.value)return {r,seen};}catch(e){seen.push(F.reasonCode(e));if(!['DISCOVER_STATS_HTTP_5XX'].includes(F.reasonCode(e)))return {error:e,seen};}}return {seen};}
const A='0x'+'4c'.repeat(20);
const transfers=[{block:7400,from:ZERO,to:W1,value:1000n},{block:8000,from:W1,to:W2,value:300n},{block:9500,from:W2,to:W3,value:100n}];

test('explorer outage: primary tried once, then RPC Transfer-log discovery from the deployment block reaches a reconciled COMPLETE',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  const {r,seen}=await drive(A);
  assert.equal(seen[0],'DISCOVER_STATS_HTTP_5XX','primary explorer is attempted first');
  assert.equal(sim.calls.json,1,'no further explorer requests once the breaker is open');
  assert.ok(r?.value,'COMPLETE snapshot published: '+JSON.stringify(seen));
  assert.equal(r.value.holderCount,3);assert.equal(r.value.largestWalletPct,70);assert.equal(r.value.top10Pct,100);
  const ev=r.value.evidence[0];
  assert.match(ev.source,/Arc RPC Transfer logs/);assert.equal(ev.candidateDiscovery.fromBlock,7321);assert.equal(ev.candidateDiscovery.fallbackReason,'EXPLORER_COOLDOWN');
  assert.equal(ev.totalSupplyRaw,'1000');
  // Contiguous, gap-free scan from deployBlock-1 to the pinned head.
  const ranges=sim.calls.getLogs.sort((x,y)=>x[0]-y[0]);assert.equal(ranges[0][0],7320);assert.equal(ranges.at(-1)[1],sim.head);
  for(let i=1;i<ranges.length;i++)assert.equal(ranges[i][0],ranges[i-1][1]+1);
  assert.ok(sim.calls.getLogs.every(([f])=>f>=7320),'no blocks before deployment are scanned');
  assert.ok(sim.calls.getCode<=20,'deployment search is logarithmic: '+sim.calls.getCode);
  const doc=await storage.snapshot(A+'-candidates');assert.equal(doc.holderCount,3,'snapshot persisted and re-verified from storage');
 });
});

test('deployment search is checkpointed and resumes after a budget stop or restart without repeating steps',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  const s={};let n=0;
  assert.equal(await RD.locate(A,s,{deadline:()=>++n>4}),false);
  assert.equal(s.deploySearch.steps,4);const persisted=JSON.parse(JSON.stringify(s)),before=sim.calls.getCode;
  assert.equal(await RD.locate(A,persisted),true);assert.equal(persisted.deployBlock,7321);
  assert.ok(sim.calls.getCode-before<=12,'resumed from the persisted bracket');
 });
});

test('cost bound: a deployment span above ARC_HOLDER_RPC_DISCOVERY_MAX_BLOCKS is an explicit blocker, never a partial snapshot',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  const {error,seen,r}=await drive(A);assert.equal(r,undefined);
  assert.equal(error?.code,'HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED',JSON.stringify(seen));assert.equal(sim.calls.getLogs.length,0,'no log scan started');
  assert.equal(await storage.snapshot(A+'-candidates'),null);
 },{ARC_HOLDER_RPC_DISCOVERY_MAX_BLOCKS:'1000'});
});

test('an address without contract code at head is rejected before any scan',async()=>{
 const sim=chain({a:A,transfers,deploy:20000});
 await harness(sim,async()=>{const {error}=await drive(A);assert.equal(error?.code,'HOLDER_RPC_DISCOVERY_NO_CONTRACT_CODE');assert.equal(sim.calls.getLogs.length,0);});
});

test('balances that Transfer logs cannot explain never publish COMPLETE and stop after a bounded number of full passes',async()=>{
 const sim=chain({a:A,transfers,extra:{['0x'+'d4'.repeat(20)]:50n}});
 await harness(sim,async()=>{
  const {error,seen,r}=await drive(A,60);assert.equal(r,undefined,'no COMPLETE without exact supply reconciliation');
  assert.equal(seen.filter(x=>x==='HOLDER_SUPPLY_RECONCILIATION_FAILED').length,RD.MAX_PASSES,JSON.stringify(seen));
  assert.equal(error?.code,'HOLDER_RPC_DISCOVERY_RECONCILIATION_EXHAUSTED');
  assert.equal(await storage.snapshot(A+'-candidates'),null);
 });
});

test('ARC_HOLDER_RPC_DISCOVERY=off keeps the explorer-only behaviour (quiet EXPLORER_COOLDOWN yield, no RPC scan)',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  await assert.rejects(()=>worker.advance(A,{budgetMs:5000}),e=>F.reasonCode(e)==='DISCOVER_STATS_HTTP_5XX');
  await assert.rejects(()=>worker.advance(A,{budgetMs:5000}),{code:'EXPLORER_COOLDOWN'});
  assert.equal(sim.calls.getCode+sim.calls.getLogs.length,0);
 },{ARC_HOLDER_RPC_DISCOVERY:'off'});
});

test('stalled primary DISCOVER with no verified page automatically resumes via bounded RPC without lowering trust',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  const old={version:1,address:A,chainId:5042,startedAt:Date.now()-700000,phase:'DISCOVER',offset:0,addresses:[],balances:[],balanceCursor:0};
  await storage.save(A+'-candidates',old);
  const r=await worker.advance(A,{budgetMs:5000});
  assert.equal(sim.calls.json,0,'do not repeat the unavailable explorer after ten minutes of zero progress');
  assert.ok(r.value&&r.value.coverage.complete===true,'only a fully reconciled snapshot is allowed');
  assert.equal(r.value.evidence[0].candidateDiscovery.fallbackReason,'EXPLORER_DISCOVER_NO_PROGRESS');
  assert.equal(r.value.holderCount,3);
  assert.ok(sim.calls.getLogs.length>0,'Transfer logs are actually scanned');
  const latest=await storage.snapshot(A+'-candidates');
  assert.equal(latest?.holderCount,3,'new COMPLETE snapshot is signed/verified through durable storage');
 });
});
test('a fresh primary DISCOVER checkpoint is persisted before an index timeout so age cannot reset',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  await assert.rejects(()=>worker.advance(A,{budgetMs:5000}),e=>F.reasonCode(e)==='DISCOVER_STATS_HTTP_5XX');
  const s=await storage.load(A+'-candidates');
  assert.equal(s.phase,'DISCOVER');
  assert.equal(s.offset,0);
  assert.ok(Number.isFinite(s.startedAt)&&s.startedAt<=Date.now());
  assert.equal(sim.calls.json,1);
 });
});
test('a primary index that advanced at least one page never silently switches to RPC solely due to age',async()=>{
 const sim=chain({a:A,transfers});
 await harness(sim,async()=>{
  const old={version:1,address:A,chainId:5042,startedAt:Date.now()-700000,phase:'DISCOVER',offset:1000,addresses:[W1],balances:[],balanceCursor:0};
  await storage.save(A+'-candidates',old);
  await assert.rejects(()=>worker.advance(A,{budgetMs:5000}),e=>F.reasonCode(e)==='DISCOVER_STATS_HTTP_5XX');
  assert.equal(sim.calls.json,1,'preserve valid advancing explorer checkpoint until a distinct failure policy applies');
  const saved=await storage.load(A+'-candidates');
  assert.notEqual(saved.discoverySource,'RPC_LOGS');
 });
});
test('checkpoint validation rejects malformed RPC discovery state',()=>{
 const base={version:1,address:A,chainId:5042,startedAt:Date.now()-1,phase:'DISCOVER',offset:0,addresses:[],balances:[],balanceCursor:0};
 assert.equal(storage.validCheckpoint({...base,discoverySource:'RPC_LOGS',deploySearch:{lo:0,hi:10,head:10,steps:1}},A),true);
 assert.equal(storage.validCheckpoint({...base,discoverySource:'GUESS'},A),false);
 assert.equal(storage.validCheckpoint({...base,deploySearch:{lo:10,hi:10,head:10,steps:1}},A),false);
 assert.equal(storage.validCheckpoint({...base,deploySearch:{lo:0,hi:11,head:10,steps:1}},A),false);
 assert.equal(storage.validCheckpoint({...base,deployBlock:-1},A),false);
});

test('RPC discovery module ships inside the worker image closure',()=>{
 const docker=require('node:fs').readFileSync(path.join(__dirname,'..','Dockerfile.holder-worker'),'utf8');assert.match(docker,/^COPY lib \.\/lib$/m);
 assert.ok(RD.maxSpan()===RD.DEFAULT_MAX_SPAN&&RD.DEFAULT_MAX_SPAN<=RD.HARD_MAX_SPAN);
});
