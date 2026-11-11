'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const router=require('../search/server/lib/search-provider-watchdog');
const watchdog=require('../lib/verification/provider-watchdog');
const ledger=require('../lib/verification/provider-watchdog-ledger');
const PRIMARY='https://primary.example/rpc/private-token';
const BACKUP='https://backup.example/rpc/private-token';
const PROVIDERS=[PRIMARY,BACKUP];
const T=Date.parse('2026-11-11T12:00:00Z');
const CHAIN={arc:'0x13b2',robinhood:'0x1237'};
const ADDRESS='0x'+'ab'.repeat(20);

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-search-watchdog-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 return {ARC_AUTONOMY_WATCHDOG_SEARCH_ENABLED:'1',ARC_VERIFICATION_LEDGER_DIR:dir};
}
async function record(network,endpoint,index,env){
 return ledger.read(network,router.slug(endpoint,index),{env});
}
function readFor(network){
 return async (_endpoint,method)=>{
  if(method==='eth_chainId')return CHAIN[network];
  if(method==='eth_blockNumber')return '0xabc';
  throw Error('Unexpected probe method');
 };
}
function routeFor({env,network='arc',inspect=async endpoint=>({endpoint}),read,clock={value:T},endpoints=PROVIDERS}){
 return router.route({env,network,endpoints,inspect,read:read||readFor(network),now:()=>clock.value});
}
function fault(code,{httpStatus,retryable=true,name='Error',rpcCode}={}){
 return Object.assign(Error(code),{code,httpStatus,retryable,name,rpcCode});
}

test('flag OFF is default, flagged Search needs durable storage',async t=>{
 const env=await fixture(t);
 assert.equal(router.enabled({}),false);
 assert.equal(router.enabled(env),true);
 await assert.rejects(routeFor({env:{ARC_AUTONOMY_WATCHDOG_SEARCH_ENABLED:'1'}}),{code:'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED'});
 await assert.rejects(routeFor({env:{}}),{code:'SEARCH_WATCHDOG_FLAG_OFF'});
});

test('normal provider success preserves response and records secret-free state',async t=>{
 const env=await fixture(t);
 const calls=[];
 const output=await routeFor({env,inspect:async endpoint=>{calls.push(endpoint);return{endpoint,block:'0xabc'}}});
 assert.deepEqual(output,{endpoint:PRIMARY,block:'0xabc'});
 assert.deepEqual(calls,[PRIMARY]);
 const state=await record('arc',PRIMARY,0,env);
 assert.equal(state.state.state,watchdog.STATES.HEALTHY);
 assert.equal(state.state.successes,1);
 assert.ok(!JSON.stringify(state).includes(PRIMARY));
 assert.ok(!JSON.stringify(state).includes('private-token'));
});

test('HTTP 429 primary enters COOLDOWN and fallback handles the entire request',async t=>{
 const env=await fixture(t),calls=[];
 const inspect=async endpoint=>{
  calls.push(endpoint);
  if(endpoint===PRIMARY)throw fault('RATE_LIMIT',{httpStatus:429});
  return {endpoint,block:'0x123'};
 };
 assert.deepEqual(await routeFor({env,inspect}),{endpoint:BACKUP,block:'0x123'});
 assert.deepEqual(calls,[PRIMARY,BACKUP]);
 assert.equal((await record('arc',PRIMARY,0,env)).state.state,watchdog.STATES.COOLDOWN);
 assert.equal((await record('arc',BACKUP,1,env)).events.at(-1).reason,'FALLBACK_USED');
 await routeFor({env,inspect});
 assert.deepEqual(calls,[PRIMARY,BACKUP,BACKUP],'cooled primary must not receive traffic');
});

test('wrong chain and malformed provider are rejected and fallback stays independent',async t=>{
 for(const failure of [
  Object.assign(Error('RPC chain ID mismatch'),{code:'SEARCH_PROVIDER_WRONG_CHAIN'}),
  Object.assign(Error('bad payload'),{code:'SEARCH_PROVIDER_MALFORMED'}),
 ]){
  const env=await fixture(t);
  const output=await routeFor({env,network:'robinhood',inspect:async endpoint=>{
   if(endpoint===PRIMARY)throw failure;
   return{endpoint,block:'0x123'};
  }});
  assert.equal(output.endpoint,BACKUP);
  assert.equal((await record('robinhood',PRIMARY,0,env)).state.state,watchdog.STATES.UNAVAILABLE);
 }
});

test('timeout, HTTP 503 and transport errors fail over with their true failure classes',async t=>{
 for(const failure of [
  fault('TimeoutError',{name:'TimeoutError'}),
  fault('Service unavailable',{httpStatus:503}),
  fault('network error',{name:'TypeError'})
 ]){
  const env=await fixture(t);
  await routeFor({env,inspect:async endpoint=>{
   if(endpoint===PRIMARY)throw failure;
   return{endpoint};
  }});
  assert.equal((await record('arc',PRIMARY,0,env)).state.state,watchdog.STATES.DEGRADED);
 }
});

test('contract revert is not blamed on provider and is never retried on fallback',async t=>{
 const env=await fixture(t),calls=[];
 const inspect=async endpoint=>{
  calls.push(endpoint);
  throw Object.assign(Error('execution reverted'),{retryable:false,rpcCode:3});
 };
 await assert.rejects(routeFor({env,inspect}),/execution reverted/);
 assert.deepEqual(calls,[PRIMARY]);
 assert.equal((await record('arc',PRIMARY,0,env)).revision,0);
});

test('all providers fail: return explicit failure; never manufacture token data',async t=>{
 const env=await fixture(t);
 await assert.rejects(routeFor({env,inspect:async()=>{throw fault('RATE_LIMIT',{httpStatus:429});}}),
  {code:'SEARCH_WATCHDOG_PROVIDER_UNAVAILABLE'});
 assert.equal((await record('arc',PRIMARY,0,env)).state.state,watchdog.STATES.COOLDOWN);
 assert.equal((await record('arc',BACKUP,1,env)).state.state,watchdog.STATES.COOLDOWN);
});

test('recovery uses two fresh chain+head probes; no primary token inspection until a later request',async t=>{
 const env=await fixture(t),clock={value:T};
 const inspected=[],probed=[];
 await routeFor({env,clock,inspect:async endpoint=>{
  inspected.push(endpoint);
  if(endpoint===PRIMARY)throw fault('LIMIT',{httpStatus:429});
  return{endpoint};
 }});
 const cooled=(await record('arc',PRIMARY,0,env)).state;
 clock.value=Date.parse(cooled.cooldownUntil)+1;
 const inspect=async endpoint=>{inspected.push(endpoint);return{endpoint}};
 const read=async(endpoint,method)=>{
  probed.push([endpoint,method]);
  if(method==='eth_chainId')return CHAIN.arc;
  if(method==='eth_blockNumber')return '0xabc';
  throw Error('Unexpected probe');
 };
 await routeFor({env,clock,inspect,read});
 assert.equal((await record('arc',PRIMARY,0,env)).state.state,watchdog.STATES.PROBING);
 await routeFor({env,clock,inspect,read});
 assert.equal((await record('arc',PRIMARY,0,env)).state.state,watchdog.STATES.HEALTHY);
 assert.equal(inspected.filter(x=>x===PRIMARY).length,1,'recovery probes must not inspect a token');
 assert.deepEqual(probed,[
  [PRIMARY,'eth_chainId'],[PRIMARY,'eth_blockNumber'],
  [PRIMARY,'eth_chainId'],[PRIMARY,'eth_blockNumber']
 ]);
 await routeFor({env,clock,inspect,read});
 assert.equal(inspected.filter(x=>x===PRIMARY).length,2);
});

test('wrong-chain recovery probe remains quarantined without serving that provider',async t=>{
 const env=await fixture(t),clock={value:T};
 await routeFor({env,inspect:async endpoint=>{
  if(endpoint===PRIMARY)throw fault('LIMIT',{httpStatus:429});
  return{endpoint};
 },clock});
 clock.value=Date.parse((await record('arc',PRIMARY,0,env)).state.cooldownUntil)+1;
 const inspected=[];
 await routeFor({env,clock,read:async(_endpoint,method)=>method==='eth_chainId'?'0x1':'0xabc',
  inspect:async endpoint=>{inspected.push(endpoint);return{endpoint};}});
 const s=(await record('arc',PRIMARY,0,env)).state;
 assert.equal(s.state,watchdog.STATES.UNAVAILABLE);
 assert.deepEqual(inspected,[BACKUP]);
});

test('invalid/corrupt persistent health fails closed before any token call',async t=>{
 const env=await fixture(t),id=router.slug(PRIMARY,0),file=ledger.fileFor('arc',id,env);
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,'{broken');
 let calls=0;
 await assert.rejects(routeFor({env,inspect:async()=>{calls++;return{};}}),{code:'PROVIDER_WATCHDOG_LEDGER_CORRUPT'});
 assert.equal(calls,0);
});

test('stale concurrent outcome cannot erase newer provider state',async t=>{
 const env=await fixture(t),id=router.slug(PRIMARY,0);
 await ledger.transition('arc',id,{kind:'RATE_LIMIT',httpStatus:429,at:T},{env});
 await assert.rejects(ledger.transition('arc',id,{kind:'SUCCESS',at:T+1,latencyMs:1,expectedRevision:0},{env}),
  {code:'PROVIDER_WATCHDOG_LEDGER_STALE_OBSERVATION'});
 assert.equal((await record('arc',PRIMARY,0,env)).state.state,watchdog.STATES.COOLDOWN);
});

test('real Arc and Robinhood inspectToken entrypoints keep all snapshot reads pinned to fallback',async t=>{
 const env=await fixture(t);
 const originalFetch=global.fetch;
 const saved={...process.env};
 const words=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
 try{
  for(const network of ['arc','robinhood']){
   Object.assign(process.env,env,{
    [network==='arc'?'ARC_RPC_URL':'ROBINHOOD_RPC_URL']:PRIMARY,
    [network==='arc'?'ARC_RPC_FALLBACK_URL':'ROBINHOOD_RPC_FALLBACK_URL']:BACKUP
   });
   const requests=[];
   global.fetch=async(url,init)=>{
    const request=JSON.parse(init.body);
    requests.push({endpoint:url,method:request.method,params:request.params});
    if(url===PRIMARY)return new Response('{}',{status:429});
    const data=request.params?.[0]?.data||'';
    const result=request.method==='eth_chainId'?CHAIN[network]:
     request.method==='eth_blockNumber'?'0xabc':
     request.method==='eth_getCode'?'0x6001600055':
     request.method==='eth_call'?data==='0x18160ddd'?words(1000):data==='0x313ce567'?words(18):words(0):
     '0xabc';
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'content-type':'application/json'}});
   };
   const client=require('../search/server/lib/'+(network==='arc'?'arc-rpc':'robinhood-rpc'));
   const output=await client.inspectToken({address:ADDRESS});
   assert.equal(output.network,network);
   assert.equal(output.block,'0xabc');
   assert.equal(output.totalSupplyRaw,'1000');
   assert.equal(requests.filter(x=>x.endpoint===PRIMARY).length,1,'primary fails on chain probe only');
   assert.ok(requests.filter(x=>x.endpoint===BACKUP).length>=5,'backup supplies entire token snapshot');
   assert.ok(requests.filter(x=>x.endpoint===BACKUP&&x.method==='eth_call').every(x=>x.params[1]==='0xabc'),
    'every contract getter is pinned to one block');
   assert.equal((await record(network,PRIMARY,0,env)).state.state,watchdog.STATES.COOLDOWN);
   // A later network must not reuse a previous chain's state.
  }
 }finally{
  global.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});
