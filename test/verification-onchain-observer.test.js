'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const observer=require('../lib/verification/onchain-observer');
const TOKEN='0x'+'ab'.repeat(20),OWNER='0x'+'cd'.repeat(20),IMPL='0x'+'ef'.repeat(20),HASH='0x'+'11'.repeat(32);
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const addr=a=>'0x'+a.slice(2).padStart(64,'0');
const CHAIN={ethereum:'0x1',arc:'0x13b2',robinhood:'0x1237'};
beforeEach(()=>observer._resetHealth());

// Fake RPC network: per-host behaviour, records every request and the peak concurrency per host.
function net(behaviour={},network='ethereum'){
 const calls=[],active={},peak={};
 const fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),b={chainId:CHAIN[network],supply:1000n,decimals:18,burn0:5n,burn1:7n,hash:HASH,...(behaviour[host]||{})};
  calls.push({host,method:q.method,params:q.params});
  active[host]=(active[host]||0)+1;peak[host]=Math.max(peak[host]||0,active[host]);
  try{
   await new Promise(r=>setTimeout(r,b.delayMs||1));
   if(init.signal?.aborted)throw Object.assign(Error('aborted'),{name:'AbortError'});
   if(b.http)return new Response('x',{status:b.http,headers:b.retryAfter?{'retry-after':String(b.retryAfter)}:{}});
   if(b.down)throw TypeError('fetch failed');
   const ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
   const err=(code,message)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code,message}}));
   if(b.malformed)return new Response('<html>');
   if(q.method==='eth_chainId')return ok(b.chainId);
   if(q.method==='eth_blockNumber')return ok('0x65');
   if(q.method==='eth_getBlockByNumber')return ok({number:q.params[0],hash:b.hash,timestamp:'0x'+(1800000000).toString(16)});
   if(q.method==='eth_getStorageAt')return ok(addr(IMPL));
   const data=q.params[0].data;
   if(data==='0x18160ddd')return ok(word(b.supply));
   if(data==='0x313ce567')return ok(word(b.decimals));
   if(data==='0x8da5cb5b')return b.noOwner?err(3,'execution reverted'):ok(addr(OWNER));
   if(data.startsWith('0x70a08231'))return ok(word(data.endsWith('dead')?b.burn1:b.burn0));
   return err(-32601,'nope');
  }finally{active[host]--;}
 };
 return {fetcher,calls,peak};
}
const run=(n,extra={})=>observer.observe({network:'ethereum',address:TOKEN,block:'0x64',env:{},fetcher:n.fetcher,...extra});

test('default endpoints are different registered operators on every network; URLs never leave the module',()=>{
 for(const network of ['ethereum','arc','robinhood']){
  const {endpoints,independence}=observer.endpoints(network,{});
  assert.equal(endpoints.length,2,network);assert.deepEqual(independence,{independent:true,reasonCode:null},network);
  assert.notEqual(endpoints[0].operator,endpoints[1].operator);
 }
 const same=observer.endpoints('arc',{ARC_RPC_URL:'https://rpc.quicknode.mainnet.arc.io'});
 assert.equal(same.independence.reasonCode,'SAME_OPERATOR');assert.equal(same.endpoints.length,1);
 assert.equal(observer.endpoints('ethereum',{ARC_VERIFICATION_RPC_URL_ETHEREUM:'off'}).independence.reasonCode,'NO_INDEPENDENT_ENDPOINT');
 assert.equal(observer.endpoints('ethereum',{ARC_VERIFICATION_RPC_URL_ETHEREUM:'http://insecure.example'}).endpoints.length,1);
});

test('both operators read the same pinned block: raw supply, decimals, burn custody, owner and implementation',async()=>{
 const n=net(),r=await run(n,{wants:{owner:true,implementation:true}});
 assert.deepEqual(r.block,{hex:'0x64',number:'100'});assert.equal(r.independence.independent,true);
 assert.deepEqual(r.endpoints.map(e=>[e.role,e.operator,e.state]),[['primary','allnodes','OK'],['independent','drpc','OK']]);
 for(const e of r.endpoints){
  assert.deepEqual({s:e.readings.totalSupply,d:e.readings.decimals,b:e.readings.burnBalance,o:e.readings.owner,i:e.readings.implementation,h:e.readings.header.hash},
   {s:'1000',d:18,b:'12',o:OWNER,i:IMPL,h:HASH});
 }
 assert.equal(r.endpoints[0].readings.head,'101');assert.equal(r.endpoints[1].readings.head,undefined);
 // Every state read is pinned to the report block; only read-only methods are used.
 for(const c of n.calls.filter(c=>['eth_call','eth_getStorageAt'].includes(c.method)))assert.equal(c.params.at(-1),'0x64');
 assert.ok(n.calls.every(c=>['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_call','eth_getStorageAt'].includes(c.method)));
 assert.equal(r.cost.rpcCalls,17);assert.ok(r.cost.rpcCalls<=2*observer.LIMITS.callsPerEndpoint);
 for(const host of Object.keys(n.peak))assert.ok(n.peak[host]<=observer.LIMITS.concurrencyPerEndpoint,host);
 // Endpoint URLs (which may carry API keys) never appear; only the operator's public reference page may.
 const text=JSON.stringify(r);
 for(const host of ['ethereum-rpc.publicnode.com','eth.drpc.org'])assert.ok(!text.includes(host),host);
 assert.equal(r.healthPersistence,'PROCESS_LOCAL');
});

test('a reverting owner() is a contract property, not a provider failure',async()=>{
 const r=await run(net({'ethereum-rpc.publicnode.com':{noOwner:true},'eth.drpc.org':{noOwner:true}}),{wants:{owner:true}});
 for(const e of r.endpoints){assert.equal(e.state,'OK');assert.equal(e.errors.owner,'CALL_REVERTED');assert.equal(e.readings.owner,undefined);assert.equal(e.watchdogState,'HEALTHY');}
});

test('HTTP 429 puts the provider in cooldown; the next observation skips it instead of retrying',async()=>{
 const n=net({'eth.drpc.org':{http:429,retryAfter:30}});
 const first=await run(n);
 const ind=first.endpoints.find(e=>e.role==='independent');
 assert.equal(ind.state,'FAILED');assert.equal(ind.reasonCode,'RPC_RATE_LIMITED');assert.equal(ind.watchdogState,'COOLDOWN');
 assert.equal(n.calls.filter(c=>c.host==='eth.drpc.org').length,1,'stops at the first 429, no retry');
 const before=n.calls.length,second=await run(n);
 const skipped=second.endpoints.find(e=>e.role==='independent');
 assert.equal(skipped.state,'SKIPPED');assert.equal(skipped.reasonCode,'PROVIDER_COOLDOWN');assert.ok(skipped.nextProbeAt);
 assert.equal(n.calls.slice(before).filter(c=>c.host==='eth.drpc.org').length,0);
 assert.equal(second.endpoints[0].state,'OK');
 // After the cooldown the provider gets a recovery probe, not ordinary traffic.
 const later=await run(net(),{now:()=>Date.now()+31*60*1000});
 const probe=later.endpoints.find(e=>e.role==='independent');assert.equal(probe.probe,true);assert.equal(probe.watchdogState,'PROBING');
});

test('timeouts, transport errors, malformed bodies and a wrong chain are classified, bounded and isolated',async()=>{
 const slow=await run(net({'eth.drpc.org':{delayMs:200}}),{timeoutMs:50,deadlineMs:400});
 const s=slow.endpoints.find(e=>e.role==='independent');
 assert.equal(s.state,'FAILED');assert.equal(s.reasonCode,'RPC_TIMEOUT');assert.equal(s.watchdogState,'DEGRADED');
 assert.equal(slow.endpoints[0].state,'OK','a slow second provider never breaks the primary');
 observer._resetHealth();
 const down=await run(net({'eth.drpc.org':{down:true}}));assert.equal(down.endpoints[1].reasonCode,'RPC_TRANSPORT_ERROR');
 observer._resetHealth();
 const bad=await run(net({'eth.drpc.org':{malformed:true}}));
 assert.equal(bad.endpoints[1].reasonCode,'RPC_MALFORMED_RESPONSE');assert.equal(bad.endpoints[1].watchdogState,'UNAVAILABLE');
 observer._resetHealth();
 const wrong=await run(net({'eth.drpc.org':{chainId:'0x89'}}));
 assert.equal(wrong.endpoints[1].reasonCode,'RPC_WRONG_CHAIN');assert.deepEqual(wrong.endpoints[1].readings,{});
 assert.equal(wrong.endpoints[1].watchdogState,'UNAVAILABLE');
 // A whole observation can never exceed its deadline by more than one timeout.
 observer._resetHealth();
 const t0=Date.now();await run(net({'ethereum-rpc.publicnode.com':{delayMs:300},'eth.drpc.org':{delayMs:300}}),{timeoutMs:100,deadlineMs:250});
 assert.ok(Date.now()-t0<1000);
});

test('input validation happens before any request',async()=>{
 const n=net();
 await assert.rejects(observer.observe({network:'ethereum',address:'0x12',block:'0x64',fetcher:n.fetcher}),/VERIFICATION_INVALID_ADDRESS/);
 await assert.rejects(observer.observe({network:'ethereum',address:TOKEN,block:'latest',fetcher:n.fetcher}),/VERIFICATION_INVALID_BLOCK/);
 await assert.rejects(observer.observe({network:'bsc',address:TOKEN,block:'0x64',fetcher:n.fetcher}));
 assert.equal(n.calls.length,0);
});

test('with durable storage the cooldown survives a process restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-observer-'));
 try{
  const env={ARC_VERIFICATION_LEDGER_DIR:dir};
  const first=await run(net({'eth.drpc.org':{http:429}}),{env});
  assert.equal(first.healthPersistence,'DURABLE_LEDGER');assert.equal(first.endpoints[1].watchdogState,'COOLDOWN');
  observer._resetHealth(); // simulated restart: process memory is gone
  const n=net(),second=await run(n,{env});
  assert.equal(second.endpoints[1].state,'SKIPPED');
  assert.equal(n.calls.filter(c=>c.host==='eth.drpc.org').length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('network isolation: an Arc observation only ever talks to Arc endpoints and checks chain 5042',async()=>{
 const n=net({},'arc'),r=await observer.observe({network:'arc',address:TOKEN,block:'0x64',env:{},fetcher:n.fetcher});
 assert.deepEqual([...new Set(n.calls.map(c=>c.host))].sort(),['rpc.mainnet.arc.io','rpc.quicknode.mainnet.arc.io']);
 assert.equal(r.chainId,5042);assert.deepEqual(r.endpoints.map(e=>e.operator),['circle','quicknode']);
 const cross=await observer.observe({network:'robinhood',address:TOKEN,block:'0x64',env:{},fetcher:net({},'arc').fetcher});
 assert.ok(cross.endpoints.every(e=>e.reasonCode==='RPC_WRONG_CHAIN'));
});
