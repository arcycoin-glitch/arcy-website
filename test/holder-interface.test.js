'use strict';
// Issue #187: the two Arc GETTER_REVERTED contracts are Uniswap-V3-style liquidity pools, not ERC-20 tokens.
// A pool is reclassified only on a complete pinned-block interface match; nothing is ever read as a zero balance.
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../lib/core'),I=require('../lib/holder-interface'),refresh=require('../lib/holder-refresh'),worker=require('../lib/holder-candidates'),storage=require('../lib/holder-storage');
const POOL='0x5bc5ced48bec9260c8d626269f44e22808b8d2c1',T0='0x'+'11'.repeat(20),T1='0x'+'22'.repeat(20);
const w=v=>'0x'+BigInt(v).toString(16).padStart(64,'0'),aw=a=>'0x'+'0'.repeat(24)+a.slice(2);
const revert=()=>{throw Object.assign(Error('execution reverted'),{code:'GETTER_REVERTED'});};
function chain(over={}){const calls=[];const answers={'0x18160ddd':revert,'0x0dfe1681':()=>aw(T0),'0xd21220a7':()=>aw(T1),'0xddca3f43':()=>w(3000),...over};
 return {calls,rpc:async(method,params)=>{calls.push([method,params]);if(method==='eth_blockNumber')return '0x1ca5c00';
  if(method==='eth_getCode')return over.code?over.code(params[0]):'0x6080';
  if(method==='eth_call'){assert.equal(params[1],'0x1ca5c00','every read pinned to one block');const f=answers[params[0].data];if(!f)revert();return f();}
  throw Error('unexpected '+method);}};}
async function withRpc(sim,fn){const o=core.rpc;core.rpc=sim.rpc;try{return await fn();}finally{core.rpc=o;}}
test('pool interface match at one pinned block yields an accurate terminal reason',async()=>{
 const sim=chain(),r=await withRpc(sim,()=>I.classify(POOL));
 assert.deepEqual(r,{reasonCode:'HOLDER_CONTRACT_IS_LIQUIDITY_POOL',block:'0x1ca5c00',token0:T0,token1:T1,fee:3000});
 assert.ok(sim.calls.length<=7,'bounded: at most 7 RPC calls');
});
test('anything short of a full pool match keeps GETTER_REVERTED (null)',async()=>{
 const cases=[{'0x18160ddd':()=>w(5)}, // totalSupply works: not this failure class
  {'0x0dfe1681':revert},{'0xd21220a7':()=>aw(T0)},{'0xd21220a7':()=>w(0)},{'0xddca3f43':()=>w(2n**24n)},{'0xddca3f43':revert},
  {'0x0dfe1681':()=>'0x1234'},{code:a=>a===T1?'0x':'0x60'}];
 for(const c of cases)assert.equal(await withRpc(chain(c),()=>I.classify(POOL)),null,JSON.stringify(Object.keys(c)));
 // provider failure (not a revert) on totalSupply is never treated as evidence
 assert.equal(await withRpc(chain({'0x18160ddd':()=>{throw Object.assign(Error('HTTP 503'),{httpStatus:503});}}),()=>I.classify(POOL)),null);
});
test('worker marks a proven pool UNSUPPORTED (existing state, 24 h recheck) and never COMPLETE or zero',async()=>{
 const orig=[worker.advance,storage.enqueue,storage.setJob],q=[],jobs=[];
 worker.advance=async()=>{throw Object.assign(Error('totalSupply reverted'),{code:'GETTER_REVERTED'})};
 storage.enqueue=async(address,at)=>{q.push(at);return true};storage.setJob=async(address,payload)=>{jobs.push(payload);return true};
 try{const now=Date.now(),r=await withRpc(chain(),()=>refresh.run({addresses:[POOL],budgetMs:10000}));
  assert.equal(r[0].state,'UNSUPPORTED');assert.equal(r[0].reasonCode,'HOLDER_CONTRACT_IS_LIQUIDITY_POOL');assert.equal(r[0].block,null);
  assert.equal(jobs.at(-1).state,'UNSUPPORTED');assert.equal(jobs.at(-1).reasonCode,'HOLDER_CONTRACT_IS_LIQUIDITY_POOL');assert.equal(jobs.at(-1).retryAt,undefined);
  assert.ok(q[0]-now>=86400000-1000,'24 h bounded recheck');
 }finally{[worker.advance,storage.enqueue,storage.setJob]=orig;}
});
test('classification failure leaves the pre-existing GETTER_REVERTED behaviour unchanged',async()=>{
 const orig=[worker.advance,storage.enqueue,storage.setJob],q=[];
 worker.advance=async()=>{throw Object.assign(Error('r'),{code:'GETTER_REVERTED'})};storage.enqueue=async(x,at)=>{q.push(at);return true};storage.setJob=async()=>true;
 try{const now=Date.now(),r=await withRpc({rpc:async()=>{throw Object.assign(Error('down'),{name:'TypeError'});}},()=>refresh.run({addresses:[POOL],budgetMs:10000}));
  assert.equal(r[0].state,'FAILED');assert.equal(r[0].reasonCode,'GETTER_REVERTED');assert.ok(Math.abs(q[0]-now-6*3600000)<1500);
 }finally{[worker.advance,storage.enqueue,storage.setJob]=orig;}
});
