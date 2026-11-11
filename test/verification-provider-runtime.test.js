'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const transport=require('../lib/pulse-onchain/rpc');
const ledger=require('../lib/verification/provider-watchdog-ledger');
const watchdog=require('../lib/verification/provider-watchdog');

const CHAIN={arc:5042,ethereum:1,robinhood:4663};
const BASE=Date.parse('2026-11-11T09:00:00.000Z');
const PRIMARY='https://primary.test/private-api-token-example';
const FALLBACK='https://fallback.test/api-key-example';
const query=[{method:'eth_blockNumber',params:[]}];
const hex=n=>'0x'+n.toString(16);
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-watchdog-routing-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 return {ARC_AUTONOMY_WATCHDOG_RPC_ENABLED:'1',ARC_VERIFICATION_LEDGER_DIR:dir};
}
function responder({chainId=5042,wrongPrimary=false,primaryFault=null,fallbackFault=null,seen=[]}={}){
 return async (url,options)=>{
  const request=JSON.parse(options.body),items=Array.isArray(request)?request:[request];
  const primary=url===PRIMARY,method=items[0].method;
  seen.push({slot:primary?'primary':'fallback',method});
  const fault=primary?primaryFault:fallbackFault;
  if(fault&&method==='eth_chainId'&&fault==='timeout')return new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true});
  });
  if(fault&&method==='eth_chainId'&&fault==='429')return new Response('{}',{status:429});
  if(fault&&method==='eth_chainId'&&fault==='offline')throw Object.assign(Error('offline'),{name:'TypeError'});
  if(fault&&method==='eth_chainId'&&fault==='malformed')return new Response('{bad',{status:200});
  if(fault&&method==='eth_chainId'&&fault==='invalid-envelope')
   return new Response(JSON.stringify({jsonrpc:'2.0',id:999,result:'0x1'}),{status:200});
  const value=item=>({jsonrpc:'2.0',id:item.id,result:item.method==='eth_chainId'?
   hex(primary&&wrongPrimary?1:chainId):'0x10'});
  return new Response(JSON.stringify(Array.isArray(request)?items.map(value):value(request)),{status:200});
 };
}
function create({network='arc',env,fetcher,clock,urls=[PRIMARY,FALLBACK],maxCalls=40,timeoutMs=80}){
 return transport.create({chainId:CHAIN[network],urls,fetcher,env,maxCalls,timeoutMs,
  now:()=>clock.value,deadlineAt:clock.value+3600000});
}
const state=async(network,env,url=PRIMARY,index=0)=>(await ledger.read(network,transport.providerId(url,index),{env})).state;

test('flag OFF keeps the original transport and requires no watchdog persistence',async()=>{
 const clock={value:BASE},seen=[],env={};
 const client=create({env,fetcher:responder({seen}),clock});
 assert.deepEqual(await client.batch(query),[{ok:true,result:'0x10'}]);
 assert.deepEqual(seen.map(x=>x.slot),['primary','primary']);
 assert.equal(client.cost.failovers,0);
});

test('Arc: 429 on primary records cooldown and deterministic verified fallback; next read skips primary',async t=>{
 const env=await fixture(t),clock={value:BASE},seen=[];
 const client=create({env,fetcher:responder({primaryFault:'429',seen}),clock});
 assert.deepEqual(await client.batch(query),[{ok:true,result:'0x10'}]);
 assert.equal((await state('arc',env)).state,watchdog.STATES.COOLDOWN);
 assert.equal((await state('arc',env)).http429,1);
 const used=seen.filter(x=>x.slot==='primary').length;
 await client.batch(query);
 assert.equal(seen.filter(x=>x.slot==='primary').length,used);
 assert.equal(client.cost.failovers,2);
 const record=await ledger.read('arc',transport.providerId(FALLBACK,1),{env});
 assert.ok(record.events.some(x=>x.reason==='FALLBACK_USED'));
 assert.ok(!JSON.stringify(record).includes(FALLBACK));
 assert.ok(!JSON.stringify(record).includes('api-key-example'));
});

test('Ethereum: timeout is classified, and fallback only succeeds after fresh chain validation',async t=>{
 const env=await fixture(t),clock={value:BASE};
 const client=create({network:'ethereum',env,clock,timeoutMs:15,
  fetcher:responder({chainId:1,primaryFault:'timeout'})});
 assert.deepEqual(await client.batch(query),[{ok:true,result:'0x10'}]);
 const s=await state('ethereum',env);
 assert.equal(s.state,watchdog.STATES.DEGRADED);
 assert.equal(s.timeouts,1);
});

test('Robinhood: wrong-chain is rejected as unavailable before independent fallback',async t=>{
 const env=await fixture(t),clock={value:BASE};
 const client=create({network:'robinhood',env,clock,
  fetcher:responder({chainId:4663,wrongPrimary:true})});
 assert.deepEqual(await client.batch(query),[{ok:true,result:'0x10'}]);
 assert.equal((await state('robinhood',env)).state,watchdog.STATES.UNAVAILABLE);
});

test('malformed, connection and HTTP errors preserve provider evidence without fabricated data',async t=>{
 for(const kind of ['malformed','invalid-envelope','offline','429']){
  const env=await fixture(t),clock={value:BASE};
  const client=create({env,clock,fetcher:responder({primaryFault:kind,fallbackFault:'offline'})});
  await assert.rejects(client.batch(query),{code:'ONCHAIN_PROVIDER_UNAVAILABLE'});
  assert.equal((await state('arc',env)).failures,1);
  assert.equal((await state('arc',env,FALLBACK,1)).failures,1);
 }
});

test('cooldown expires into two independent probes; ordinary traffic resumes only afterward',async t=>{
 const env=await fixture(t),clock={value:BASE},seen=[];
 let fault='429';
 const fetcher=async(url,options)=>responder({primaryFault:fault,seen})(url,options);
 const first=create({env,clock,fetcher});
 assert.deepEqual(await first.batch(query),[{ok:true,result:'0x10'}]);
 const cooled=await state('arc',env);
 assert.equal(cooled.state,watchdog.STATES.COOLDOWN);
 clock.value=Date.parse(cooled.cooldownUntil)+1;fault=null;
 const restarted=create({env,clock,fetcher}); // Simulates a new worker instance reading persisted state.
 await restarted.batch(query);
 let s=await state('arc',env);
 assert.equal(s.state,watchdog.STATES.PROBING);
 assert.equal(s.recoverySuccesses,1);
 assert.equal(seen.filter(x=>x.slot==='primary'&&x.method==='eth_blockNumber').length,0);
 await restarted.batch(query);
 s=await state('arc',env);
 assert.equal(s.state,watchdog.STATES.HEALTHY);
 assert.equal(s.recoverySuccesses,0);
 assert.equal(seen.filter(x=>x.slot==='primary'&&x.method==='eth_blockNumber').length,0);
 await restarted.batch(query);
 assert.equal(seen.filter(x=>x.slot==='primary'&&x.method==='eth_blockNumber').length,1);
});

test('bad durable watchdog state fails closed even with a working fallback',async t=>{
 const env=await fixture(t),clock={value:BASE};
 const file=ledger.fileFor('arc',transport.providerId(PRIMARY,0),env);
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,'{bad json');
 const seen=[];
 const client=create({env,clock,fetcher:responder({seen})});
 await assert.rejects(client.batch(query),{code:'PROVIDER_WATCHDOG_LEDGER_CORRUPT'});
 assert.equal(seen.length,0);
 assert.equal(await fs.readFile(file,'utf8'),'{bad json');
});

test('enabled flag requires durable storage rather than silently using volatile state',async()=>{
 assert.throws(()=>create({env:{ARC_AUTONOMY_WATCHDOG_RPC_ENABLED:'1'},clock:{value:BASE},fetcher:responder()}),
  {code:'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED'});
});

test('single-provider exhaustion does not produce a synthetic successful result',async t=>{
 const env=await fixture(t),clock={value:BASE};
 const client=create({env,clock,urls:[PRIMARY],fetcher:responder({primaryFault:'429'})});
 await assert.rejects(client.batch(query),{code:'ONCHAIN_PROVIDER_UNAVAILABLE'});
});
