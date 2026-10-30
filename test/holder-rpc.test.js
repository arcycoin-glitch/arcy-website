const test=require('node:test'),assert=require('node:assert/strict'),{create}=require('../lib/holder-rpc'),budget=require('../lib/holder-budget');
function harness(handler){let clock=0;const calls=[];const client=create({endpoints:['primary','secondary'],now:()=>clock,sleep:async ms=>{clock+=ms;},interval:500,fetcher:async(url,options)=>{const p=JSON.parse(options.body);calls.push({url,p,at:clock});return handler(url,p,clock);}});return {client,calls,advance:ms=>{clock+=ms;}};}
const good=p=>({ok:true,json:async()=>Array.isArray(p)?p.map(x=>({id:x.id,result:'0x01'})):{id:p.id,result:p.method==='eth_chainId'?'0x13b2':'0x01'}});
test('429 quarantines primary, honors Retry-After, serves fallback without repeated hammering',async()=>{const h=harness((url,p)=>url==='primary'&&p.method!=='eth_chainId'?{ok:false,status:429,headers:new Headers({'retry-after':'60'})}:good(p));assert.equal(await h.client.rpc('eth_blockNumber',[]),'0x01');await h.client.rpc('eth_blockNumber',[]);assert.equal(h.calls.filter(x=>x.url==='primary'&&x.p.method!=='eth_chainId').length,1);assert.equal(h.client.metrics().http429,1);assert.equal(h.client.metrics().fallbacks,1);assert.equal(h.client.health()[0].limit,1);assert.ok(h.client.health()[0].cooldownMs>50000);h.advance(60001);await h.client.rpc('eth_blockNumber',[]);assert.equal(h.client.metrics().http429,2);});
test('HTTP 400 range rejection remains a range error for existing range shrinking',async()=>{const h=harness((url,p)=>p.method==='eth_getLogs'?{ok:false,status:400,headers:new Headers(),json:async()=>({error:{code:35,message:'ranges over 10000 blocks are not supported'}})}:good(p));await assert.rejects(h.client.rpc('eth_getLogs',[]),{code:'RPC_RANGE_LIMIT'});assert.equal(h.client.health()[0].cooldownMs,0);});
test('wrong-chain provider is excluded before any holder call',async()=>{const h=harness((url,p)=>url==='primary'?{ok:true,json:async()=>({id:p.id,result:'0x1'})}:good(p));assert.equal(await h.client.rpc('eth_blockNumber',[]),'0x01');assert.equal(h.calls.filter(x=>x.url==='primary').length,1);assert.equal(h.client.health()[0].cooldownMs,Infinity);});
test('timeout removes provider and a later healthy provider succeeds',async()=>{const h=harness((url,p)=>{if(url==='primary')throw Object.assign(Error(),{name:'TimeoutError'});return good(p);});assert.equal(await h.client.rpc('eth_blockNumber',[]),'0x01');assert.equal(h.client.metrics().errors,1);assert.equal(h.client.metrics().fallbacks,1);});
test('cooling providers yield to the worker deadline without sleeping past it',async()=>{const h=harness(()=>({ok:false,status:429,headers:new Headers({'retry-after':'60'})}));await assert.rejects(h.client.rpc('eth_blockNumber',[]));await assert.rejects(budget.run(20,()=>h.client.rpc('eth_blockNumber',[])),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});assert.equal(h.calls.length,2);});
test('balance batches are bounded and preserve exact item ordering',async()=>{const h=harness((url,p)=>good(p));const values=await h.client.batch(Array.from({length:12},()=>({method:'eth_call',params:[]})));assert.equal(values.length,12);assert.deepEqual(h.calls.filter(x=>Array.isArray(x.p)).map(x=>x.p.length),[5,5,2]);assert.ok(h.client.metrics().backoffMs>0);});
test('a deadline-limited request yields its checkpoint slice without quarantining a healthy provider',async()=>{const client=create({endpoints:['healthy'],interval:0,fetcher:async(url,options)=>{const p=JSON.parse(options.body);if(p.method==='eth_chainId')return good(p);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'TimeoutError'})),{once:true}));}});await assert.rejects(budget.run(30,()=>budget.operation(()=>client.rpc('eth_blockNumber',[]))),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});await new Promise(r=>setTimeout(r,10));assert.equal(client.health()[0].cooldownMs,0);assert.equal(client.health()[0].interval,0);assert.equal(client.metrics().errors,0);assert.equal(client.metrics().http429,0);});

test('generic JSON-RPC provider errors fall back to independently chain-checked RPC',async()=>{
 const h=harness((url,p)=>url==='primary'&&p.method!=='eth_chainId'?
  {ok:true,json:async()=>({id:p.id,error:{code:-32603,message:'internal node failure'}})}:good(p));
 assert.equal(await h.client.rpc('eth_getBlockByNumber',['0x123',false]),'0x01');
 assert.equal(h.client.metrics().fallbacks,1);
 assert.equal(h.calls.filter(x=>x.url==='secondary'&&x.p.method==='eth_chainId').length,1);
});
test('contract execution revert remains a getter outcome and does not fake a value',async()=>{
 const h=harness((url,p)=>p.method==='eth_call'?
  {ok:true,json:async()=>({id:p.id,error:{code:3,message:'execution reverted'}})}:good(p));
 await assert.rejects(h.client.rpc('eth_call',[]),{code:'GETTER_REVERTED'});
 assert.equal(h.calls.filter(x=>x.url==='secondary').length,0);
});

test('issue #96: all-provider JSON-RPC failure keeps a secret-free per-provider cause',async()=>{
 const h=harness((url,p)=>p.method==='eth_chainId'?{ok:true,json:async()=>({id:p.id,result:'0x13B2'})}:
  {ok:true,json:async()=>({id:p.id,error:{code:-32601,message:'method not found at https://x.quiknode.pro/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'}})});
 await assert.rejects(h.client.rpc('eth_getBlockByNumber',['0x1',false]),e=>{
  assert.equal(e.code,'RPC_CALL_FAILED');
  assert.deepEqual(e.attempts.map(a=>a.provider),['primary','secondary'.replace('secondary','fallback1')]);
  assert.ok(e.attempts.every(a=>a.rpcCode===-32601&&a.method==='eth_getBlockByNumber'));
  assert.ok(!/quiknode|ABCDEFGH|https?:/.test(JSON.stringify(e.attempts)));
  return true;});
});
test('issue #96: uppercase/odd-format chain id is accepted; wrong chain still excluded',async()=>{
 const h=harness((url,p)=>p.method==='eth_chainId'?{ok:true,json:async()=>({id:p.id,result:url==='primary'?'0x13B2':'0x1'})}:good(p));
 assert.equal(await h.client.rpc('eth_blockNumber',[]),'0x01');
 assert.equal(h.calls.filter(x=>x.url==='secondary'&&x.p.method!=='eth_chainId').length,0);
});
test('issue #96: differently worded eth_call execution failures are getter outcomes, not provider faults',async()=>{
 for(const [code,message] of [[3,'x'],[-32000,'VM execution error'],[-32015,'invalid opcode: INVALID']]){
  const h=harness((url,p)=>p.method==='eth_call'?{ok:true,json:async()=>({id:p.id,error:{code,message}})}:good(p));
  await assert.rejects(h.client.rpc('eth_call',[]),{code:'GETTER_REVERTED'});
  assert.equal(h.calls.filter(x=>x.url==='secondary').length,0);
 }
});
test('issue #96: diagnose reports per-provider steps without throwing or leaking URLs',async()=>{
 const client=create({endpoints:['https://secret.example/KEY123456789012345678901234567890','b'],fetcher:async(url,o)=>{
  const p=JSON.parse(o.body);if(url.startsWith('b'))throw new TypeError('fetch failed https://b.example/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
  return {ok:true,json:async()=>({id:p.id,result:p.method==='eth_chainId'?'0x13b2':p.method==='eth_blockNumber'?'0x100':'0x'})};}});
 const rows=await client.diagnose();
 assert.equal(rows[0].chainOk,true);assert.equal(rows[0].head,256);assert.equal(rows[1].steps.eth_chainId.class,'TRANSPORT');
 assert.ok(!/secret\.example|KEY12345|b\.example|zzzz/.test(JSON.stringify(rows)));
});

// Root cause of "23/25 RPC_CALL_FAILED although QuickNode historical tests pass 4/4": a well-formed JSON-RPC error
// ANSWER was treated as a provider outage, which quarantined (cooldown, interval x2, concurrency 1) every provider that
// answered it, including the healthy one. Provider health must only react to transport/HTTP/malformed/rate faults.
test('call-level JSON-RPC errors do not quarantine or slow a healthy provider',async()=>{
 const h=harness((url,p)=>p.method==='eth_getBalance'?{ok:true,json:async()=>({id:p.id,error:{code:-32000,message:'unsupported call shape'}})}:good(p));
 for(let i=0;i<6;i++)await assert.rejects(h.client.rpc('eth_getBalance',['0x01','0x10']),{code:'RPC_CALL_FAILED'});
 for(const row of h.client.health()){assert.equal(row.cooldownMs,0);assert.equal(row.limit,2);assert.equal(row.interval,500);}
 // the very next ordinary call is served immediately by the primary, without waiting out a cooldown
 assert.equal(await h.client.rpc('eth_blockNumber',[]),'0x01');
 assert.equal(h.client.metrics().cooldownWaitMs,0);
});
test('primary that cannot serve historical state is bypassed: the working provider answers and is preferred afterwards',async()=>{
 const h=harness((url,p)=>url==='primary'&&p.method==='eth_call'?{ok:true,json:async()=>({id:p.id,error:{code:-32000,message:'missing trie node'}})}:good(p));
 for(let i=0;i<25;i++)assert.equal(await h.client.rpc('eth_call',[{to:'0x'+'1'.repeat(40),data:'0x'},'0x10']),'0x01');
 assert.equal(h.client.metrics().errors<=8,true,'primary must stop being tried first once it keeps losing: '+h.client.metrics().errors);
 assert.equal(h.client.metrics().lastFailure.provider,'primary');
});
test('a batch that one provider answers with an item error is served whole by the provider that can answer it',async()=>{
 const h=harness((url,p)=>url==='primary'&&Array.isArray(p)?{ok:true,json:async()=>p.map(x=>({id:x.id,error:{code:-32000,message:'batch not supported'}}))}:good(p));
 const out=await h.client.batch(Array.from({length:7},()=>({method:'eth_call',params:[]})));
 assert.equal(out.length,7);assert.deepEqual([...new Set(out)],['0x01']);
});
test('real provider faults (HTTP 5xx, timeouts) still quarantine the provider',async()=>{
 const h=harness((url,p)=>url==='primary'&&p.method!=='eth_chainId'?{ok:false,status:503,headers:new Headers()}:good(p));
 assert.equal(await h.client.rpc('eth_blockNumber',[]),'0x01');
 assert.ok(h.client.health()[0].cooldownMs>0);
});
test('diagnostics report historical state and batch capability per provider without leaking URLs',async()=>{
 const client=create({endpoints:['https://user:secret-key-abcdefghijklmnopqrstuvwxyz0123@node.example/key'],interval:0,fetcher:async(url,o)=>{const p=JSON.parse(o.body);const one=x=>({id:x.id,result:x.method==='eth_chainId'?'0x13b2':'0x2710'});return {ok:true,json:async()=>Array.isArray(p)?p.map(one):one(p)};}});
 const rows=await client.diagnose();
 assert.equal(rows[0].steps.historical_getBalance_10k_blocks_back.ok,true);assert.equal(rows[0].steps.batch_of_5.ok,true);
 assert.ok(!JSON.stringify(rows).includes('secret-key'));
});
