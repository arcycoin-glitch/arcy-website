'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const scope=require('../search/server/lib/analysis-scope');
test('analysis shares exact pinned reads but isolates chain, endpoint, block and next analysis',async()=>{
 let calls=0;
 const read=(network='arc',endpoint='https://one',block='0x1')=>scope.read(network,endpoint,'eth_call',[{to:'0xabc',data:'0x1'},block],{},async()=>++calls);
 await scope.run(async()=>{
  assert.deepEqual(await Promise.all([read(),read()]),[1,1]);assert.equal(await read(),1);
  assert.equal(await read('ethereum'),2);assert.equal(await read('arc','https://two'),3);
  assert.equal(await read('arc','https://one','0x2'),4);
 });
 await scope.run(async()=>assert.equal(await read(),5));
});
test('concurrent reports coalesce, return independent copies, and never cache a completed current snapshot',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const operation=async()=>{calls++;await gate;return {token:{symbol:'ARCY'}}};
 const a=scope.report('arc:exact:policy',operation),b=scope.report('arc:exact:policy',operation);
 release();const [one,two]=await Promise.all([a,b]);assert.equal(calls,1);
 one.token.symbol='changed';assert.equal(two.token.symbol,'ARCY');
 await scope.report('arc:exact:policy',operation);assert.equal(calls,2);
});
test('failed analyses and failed provider reads are retried on the next analysis',async()=>{
 let calls=0;
 const operation=()=>scope.read('arc','https://one','eth_getCode',['0xabc','0x1'],{},async()=>{calls++;throw Error('provider outage')});
 await assert.rejects(scope.report('failure',operation));await assert.rejects(scope.report('failure',operation));assert.equal(calls,2);
});
test('different production permission profiles cannot share a report',async()=>{
 let calls=0;await Promise.all(['approved','gated'].map(policy=>scope.report('ethereum:exact:'+policy,async()=>++calls)));assert.equal(calls,2);
});
test('RPC parallelism remains bounded while independent calls progress',async()=>{
 let active=0,peak=0;
 await scope.run(()=>Promise.all(Array.from({length:24},(_,i)=>scope.read('arc','https://one','eth_call',[i,'0x1'],{},async()=>{
  active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return i;
 }))));
 assert.equal(peak,8);assert.equal(active,0);
});
test('a successful pinned result can serve a later stricter deadline without another RPC request',async()=>{
 let calls=0;
 await scope.run(async()=>{
  const read=timeoutMs=>scope.read('arc','https://one','eth_getCode',['0xabc','0x1'],{timeoutMs},async()=>{calls++;return '0x1234'});
  await read(11000);assert.equal(await read(4000),'0x1234');assert.equal(calls,1);
 });
});
test('expired source cache fails closed on an outage and never returns stale data as current',async()=>{
 let now=1000,calls=0;
 const reader=require('../search/server/lib/source-request').createReader({ttlMs:10,now:()=>now});
 const url='https://public.example/1/0xabc';
 const fetcher=async()=>{calls++;if(calls>1)return new Response('{}',{status:503});return Response.json({value:42})};
 const first=await reader.json(url,{fetcher});first.value=0;
 assert.equal((await reader.json(url,{fetcher})).value,42);assert.equal(calls,1);
 now+=11;await assert.rejects(reader.json(url,{fetcher}));assert.equal(calls,2);
});
test('slow optional Arc census falls back without fabricating current concentration and a live count wins',async()=>{
 const adapter=require('../search/server/lib/arc-adapter'),index=require('../lib/holder-index');
 const count=require('../search/server/lib/arc-holder-count'),publication=require('../search/server/lib/arc-holder-publication');
 const legacy=require('../search/server/lib/arc-legacy-evidence'),timeout=require('../search/server/lib/timeout');
 const saved=[index.explorer,count.fetchCount,publication.load,legacy.callOriginal,legacy.holders,timeout.withTimeout];
 const address='0x'+'9'.repeat(40);let release;
 const historical=Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(key=>[key,{value:1,dataState:'DATA_FOUND',status:'HISTORICAL_ONCHAIN_VERIFIED',freshness:{state:'LAST_VERIFIED'}}]));
 try{
  index.explorer=()=>new Promise(r=>release=r);
  timeout.withTimeout=async(_task,ms)=>{assert.equal(ms,6000);throw Error('Optional provider deadline')};
  publication.load=async()=>({fields:{}});legacy.callOriginal=async()=>({snapshot:{completedAt:'2026-10-01T00:00:00Z'}});
  legacy.holders=()=>historical;count.fetchCount=async()=>({value:123,dataState:'DATA_FOUND',status:'SOURCE_REPORTED'});
  const result=await adapter.holders({address});assert.equal(result.fields.holderCount.value,123);
  for(const key of ['largestWalletPct','top10Pct','top20Pct'])assert.equal(result.fields[key].status,'HISTORICAL_ONCHAIN_VERIFIED');
 }finally{
  release?.(null);[index.explorer,count.fetchCount,publication.load,legacy.callOriginal,legacy.holders,timeout.withTimeout]=saved;
 }
});
