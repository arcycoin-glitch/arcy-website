'use strict';
// Issue #95 — scanner robustness: provider caps, rate limits, time/call budgets,
// partial windows, duplicates, wrong chain, and sanitized diagnostics.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const onchain=require('../lib/market-radar-onchain');
const {CHAINS,SWAP_TOPIC,scanRange,classify,sanitize}=onchain;
const cfg={...CHAINS.arc,initialChunk:400};
const w=n=>(BigInt(n)<0n?(1n<<256n)+BigInt(n):BigInt(n)).toString(16).padStart(64,'0');
const POOL='0x'+'11'.repeat(32);
function logAt(block,i=0){
 return {address:cfg.poolManager,topics:[SWAP_TOPIC,POOL,'0x'+'ab'.repeat(32)],
  data:'0x'+w(-5)+w(10)+w(1n<<96n)+w(1000)+w(0)+w(3000),blockNumber:'0x'+block.toString(16),
  logIndex:'0x'+i.toString(16),transactionHash:'0x'+(block*10+i).toString(16).padStart(64,'0'),removed:false};
}
const bounds=p=>[Number(BigInt(p[0].fromBlock)),Number(BigInt(p[0].toBlock))];
const rpcOf=handler=>({calls:0,async call(method,params){this.calls++;return handler(params,this.calls);}});
const noSleep=()=>Promise.resolve();
const far=()=>Date.now()+60000;
const logsIn=(all,from,to)=>all.filter(l=>{const b=Number(BigInt(l.blockNumber));return b>=from&&b<=to;});

test('provider block-range cap is learned; whole window is covered once with no duplicates', async()=>{
 const all=[];for(let b=1000;b<=9000;b+=7)all.push(logAt(b));
 let maxAsked=0;
 const rpc=rpcOf(p=>{const [f,t]=bounds(p);maxAsked=Math.max(maxAsked,t-f+1);
  if(t-f+1>500)throw Object.assign(Error('RPC_HTTP_400'),{transport:true,body:'block range too large, max 500 blocks'});
  return logsIn(all,f,t);});
 const r=await scanRange(rpc,cfg,1000,9000,{deadline:far(),sleep:noSleep});
 assert.equal(r.swaps,all.length);
 assert.equal(r.pools.get(POOL).swaps,all.length);
 assert.ok(r.stats.learnedCap<=500&&r.stats.learnedCap>=1);
 assert.ok(r.stats.splits>0);
});

test('"more than 10000 results" splits the range instead of failing', async()=>{
 const all=[];for(let b=0;b<2000;b++)all.push(logAt(b));
 const rpc=rpcOf(p=>{const [f,t]=bounds(p),got=logsIn(all,f,t);
  if(got.length>300)throw Object.assign(Error('query returned more than 10000 results'),{rpcCode:-32005});return got;});
 const r=await scanRange(rpc,cfg,0,1999,{deadline:far(),sleep:noSleep});
 assert.equal(r.swaps,2000);
});

test('transient 429 is retried with backoff and the scan completes', async()=>{
 const all=[logAt(10),logAt(20)];
 const rpc=rpcOf((p,n)=>{if(n<=3)throw Object.assign(Error('RPC_HTTP_429'),{transport:true,body:'rate limit'});return logsIn(all,...bounds(p));});
 const r=await scanRange(rpc,cfg,0,100,{deadline:far(),sleep:noSleep});
 assert.equal(r.swaps,2);assert.ok(r.stats.rateLimited>=1);
});

test('persistent 429 fails closed with a rate-limit reason', async()=>{
 const rpc=rpcOf(()=>{throw Object.assign(Error('RPC_HTTP_429'),{transport:true,body:''});});
 await assert.rejects(scanRange(rpc,cfg,0,100,{deadline:far(),sleep:noSleep}),
  e=>e.code==='RADAR_ONCHAIN_SCAN_INCOMPLETE'&&/rate limited/.test(e.detail.reason)&&e.detail.blocksDone<e.detail.blocksTotal);
});

test('401/403 stops immediately and is not mistaken for a range problem', async()=>{
 const rpc=rpcOf(()=>{throw Object.assign(Error('RPC_HTTP_403'),{transport:true,body:'forbidden'});});
 await assert.rejects(scanRange(rpc,cfg,0,100000,{deadline:far(),sleep:noSleep}),e=>/401\/403/.test(e.detail.reason));
 assert.ok(rpc.calls<=cfg.initialChunk);
});

test('time budget exhaustion reports the reason and coverage', async()=>{
 const rpc=rpcOf(()=>[]);
 await assert.rejects(scanRange(rpc,cfg,0,100000,{deadline:Date.now()-1,sleep:noSleep}),
  e=>e.detail.reason==='time budget'&&e.detail.blocksDone===0&&e.detail.blocksTotal===100001);
});

test('call budget is enforced', async()=>{
 const rpc=rpcOf(()=>[]);
 await assert.rejects(scanRange(rpc,{...cfg,initialChunk:1},0,5000,{deadline:far(),maxCalls:5,concurrency:1,sleep:noSleep}),
  e=>e.detail.reason==='call budget');
});

test('a block that cannot be fetched at all yields a partial-window failure, never a result', async()=>{
 const rpc=rpcOf(p=>{const [f,t]=bounds(p);if(f<=50&&t>=50)throw Object.assign(Error('RPC_HTTP_500'),{transport:true,body:''});return [];});
 await assert.rejects(scanRange(rpc,cfg,0,100,{deadline:far(),sleep:noSleep}),
  e=>e.detail.reason==='getLogs failed at single block'&&e.detail.blocksDone<e.detail.blocksTotal);
});

test('duplicate log entries inside a response are counted once', async()=>{
 const l=logAt(5);
 const rpc=rpcOf(()=>[l,{...l},{...l}]);
 const r=await scanRange(rpc,cfg,0,10,{deadline:far(),sleep:noSleep});
 assert.equal(r.swaps,1);
});

test('removed, wrong-address and out-of-range logs are ignored', async()=>{
 const good=logAt(5),other={...logAt(6),address:'0x'+'22'.repeat(20)},removed={...logAt(7),removed:true},outside=logAt(500);
 const rpc=rpcOf(()=>[good,other,removed,outside]);
 const r=await scanRange(rpc,cfg,0,10,{deadline:far(),sleep:noSleep});
 assert.equal(r.swaps,1);
});

test('malformed getLogs result fails closed', async()=>{
 const rpc=rpcOf(()=>({not:'an array'}));
 await assert.rejects(scanRange(rpc,cfg,0,10,{deadline:far(),sleep:noSleep}),e=>/malformed/.test(e.detail.reason));
});

test('parallel workers never exceed the configured concurrency', async()=>{
 let active=0,peak=0;
 const rpc=rpcOf(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return [];});
 await scanRange(rpc,{...cfg,initialChunk:10},0,999,{deadline:far(),concurrency:3});
 assert.ok(peak>1&&peak<=3,'peak '+peak);
});

test('error classification and diagnostics sanitisation', () => {
 assert.equal(classify(Object.assign(Error('RPC_HTTP_429'),{})),'RATE_LIMITED');
 assert.equal(classify(Object.assign(Error('RPC_HTTP_403'),{})),'FORBIDDEN');
 assert.equal(classify(Object.assign(Error('RPC_HTTP_400'),{body:'exceed maximum block range: 2000'})),'RANGE_OR_RESULT_LIMIT');
 assert.equal(classify(Error('query returned more than 10000 results')),'RANGE_OR_RESULT_LIMIT');
 assert.equal(classify(Object.assign(Error('x'),{name:'AbortError'})),'TIMEOUT');
 const dirty='failed https://eth-mainnet.g.alchemy.com/v2/SECRETKEYSECRETKEYSECRETKEY12345 token abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
 const clean=sanitize(dirty,400);
 assert.ok(!/https?:|SECRETKEY|abcdefghijklmnop/.test(clean),clean);
});

test('wrong chain id fails closed and reports expected/got without secrets', async()=>{
 const fetcher=async(url,init)=>({ok:true,json:async()=>({jsonrpc:'2.0',id:JSON.parse(init.body).id,result:'0x1'})});
 await assert.rejects(onchain.inspect('arc',{fetcher,env:{ARC_RPC_URL:'https://rpc.example/v2/SUPERSECRETKEY1234567890ABCDEFGH'}}),e=>{
  assert.equal(e.code,'RADAR_RPC_CHAIN_MISMATCH');
  assert.equal(e.diagnostics.phase,'chain');
  assert.ok(!JSON.stringify(e.diagnostics).includes('SUPERSECRET'));
  return true;});
});

test('API exposes sanitized diagnostics only outside production', async()=>{
 const handler=require('../search/server/api/radar');
 const run=async env=>{
  const saved={...process.env},savedFetch=global.fetch;
  Object.assign(process.env,{MARKET_RADAR_ONCHAIN_ENABLED:'true',ARC_RPC_URL:'https://rpc.example/v2/SUPERSECRETKEY1234567890ABCDEFGH'},env);
  delete process.env.MARKET_RADAR_PROVIDER;
  global.fetch=async()=>{throw new TypeError('fetch failed');};
  onchain._cache.clear();
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  const logs=[],orig=console.warn;console.warn=(...a)=>logs.push(a.join(' '));
  try{await handler({method:'GET',query:{chain:'arc'}},res);}
  finally{console.warn=orig;global.fetch=savedFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
  return {res,logs};
 };
 const prod=await run({VERCEL_ENV:'production',NODE_ENV:'production'});
 assert.equal(prod.res.code,503);assert.equal(prod.res.body.diagnostics,undefined);assert.equal(prod.logs.length,0);
 assert.equal(prod.res.body.ok,false);
 onchain._cache.clear();
 const prev=await run({VERCEL_ENV:'preview',NODE_ENV:'development'});
 assert.equal(prev.res.code,503);
 assert.equal(prev.res.body.diagnostics.phase,'chain');
 assert.ok(!JSON.stringify(prev.res.body).includes('SUPERSECRET'));
 assert.ok(!prev.logs.join(' ').includes('SUPERSECRET')&&!/https?:\/\//.test(prev.logs.join(' ')));
 assert.equal(prev.logs.length,1);
});

// ---- issue #96: Robinhood range-error storm and pool-key coverage -------------------------------
const {makeChain,usdcPool,tokenMeta,tokenAddr}=require('./radar-helpers');

test('rate-limit wording is never mistaken for a block-range cap (no range-halving storm)', () => {
 const http=(status,body)=>Object.assign(Error('RPC_HTTP_'+status),{body});
 for(const body of ['rate limit exceeded','Request exceeded compute units per second','capacity exceeded, try again later','exceeded your plan usage - upgrade tier'])
  assert.notEqual(classify(http(400,body)),'RANGE_OR_RESULT_LIMIT',body);
 for(const msg of ['Request exceeded rate limit for this plan','rate-limit exceeded','You have exceeded your quota'])
  assert.equal(classify(Error(msg)),'RATE_LIMITED',msg);
 for(const body of ['exceed maximum block range: 2000','eth_getLogs is limited to a 10,000 range','query returned more than 10000 results','block range too large','Log response size exceeded'])
  assert.equal(classify(http(400,body)),'RANGE_OR_RESULT_LIMIT',body);
 assert.equal(classify(Error('Request timeout on the free tier')),'TIMEOUT');
});

test('queued pieces are re-cut to the learned cap so known-bad sizes are not retried', async()=>{
 let bad=0;
 const all=[];for(let b=0;b<30000;b+=50)all.push(logAt(b));
 const rpc=rpcOf(p=>{const [f,t]=bounds(p);if(t-f+1>1000){bad++;throw Object.assign(Error('RPC_HTTP_400'),{transport:true,body:'block range too large'});}return logsIn(all,f,t);});
 const r=await scanRange(rpc,{...cfg,initialChunk:20000},0,29999,{deadline:far(),sleep:noSleep,concurrency:4});
 assert.equal(r.swaps,all.length);
 assert.ok(bad<=16,'range errors '+bad);
});

test('live scan stops early with a precise reason when the provider cap makes the window infeasible', async()=>{
 const rpc=rpcOf(async p=>{const [f,t]=bounds(p);if(t-f+1>100)throw Object.assign(Error('RPC_HTTP_400'),{transport:true,body:'block range too large, max 100'});await new Promise(r=>setTimeout(r,20));return [];});
 await assert.rejects(scanRange(rpc,{...cfg,initialChunk:1000},0,830000,{deadline:Date.now()+3000,live:true,concurrency:4}),
  e=>/window too large for a live scan/.test(e.detail.reason)&&e.detail.learnedBlockCap<=100&&e.detail.callsNeeded>1000);
});

test('Arc-style case: most swaps in pools PositionManager does not know fail closed instead of returning 0 tokens', async()=>{
 const ps=Array.from({length:10},(_,k)=>usdcPool(k+1,1000+k));
 const chain=makeChain('ethereum',{pools:ps,tokens:tokenMeta(10),brokenKeys:new Set(ps.map(()=> 'none'))});
 const fetcher=async(url,init)=>{const r=JSON.parse(init.body);
  if(r.method==='eth_call'&&r.params[0].data.startsWith(onchain.SEL.poolKeys))return {ok:true,json:async()=>({id:r.id,result:'0x'})};
  return chain(url,init);};
 await assert.rejects(onchain.inspect('ethereum',{fetcher}),e=>e.code==='RADAR_POOL_KEY_COVERAGE_LOW'&&e.detail.swapsResolved===0&&e.diagnostics.phase==='poolKeys');
});

test('live scan resolves pools unknown to PositionManager from verified Initialize events', async()=>{
 const ps=Array.from({length:6},(_,k)=>({...usdcPool(k+1,(7-k)*1000),initBlock:999000-k}));
 const chain=makeChain('ethereum',{pools:ps,tokens:tokenMeta(6)});
 const fetcher=async(url,init)=>{const r=JSON.parse(init.body);
  if(r.method==='eth_call'&&r.params[0].data.startsWith(onchain.SEL.poolKeys))return {ok:true,json:async()=>({id:r.id,result:'0x'})};
  return chain(url,init);};
 const out=await onchain.inspect('ethereum',{fetcher});
 assert.equal(out.tokens.length,6);assert.equal(out.coverage.keySources.initializeEvents,6);assert.equal(out.coverage.swapsResolvedShare,1);
 assert.match(out.coverage.scopeNote,/6 of 6/);
});

test('an Initialize event whose key does not hash to the pool id is ignored', () => {
 const k={currency0:'0x'+'1'.repeat(40),currency1:'0x'+'2'.repeat(40),fee:3000,tickSpacing:60,hooks:'0x'+'0'.repeat(40)};
 assert.equal(onchain.verifyKey('0x'+'ab'.repeat(32),k),false);
 void tokenAddr;
});

// ---- real Preview finding (issue #96, Robinhood): primary times out on wide ranges, free-plan fallback rejects everything ----
test('Robinhood case: fallback "ranges over 10000 blocks" error does not drive range halving; primary limit decides',async()=>{
 const calls={primary:0,fallback:0};
 const fetcher=async(url,init)=>{
  const req=JSON.parse(init.body);
  if(String(url).startsWith('https://primary.test')){
   calls.primary++;
   const [f,t]=[Number(BigInt(req.params[0].fromBlock)),Number(BigInt(req.params[0].toBlock))];
   if(t-f+1>1500){const e=new Error('aborted');e.name='AbortError';throw e;}
   return {ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,result:[]})};
  }
  calls.fallback++;
  return {ok:false,status:400,text:async()=>'ranges over 10000 blocks are not supported on free plan',json:async()=>({})};
 };
 const rpc=onchain.makeRpc('robinhood',{fetcher,env:{ROBINHOOD_RPC_URL:'https://primary.test'}});
 const r=await scanRange(rpc,{...CHAINS.robinhood,initialChunk:20000},0,60000,{deadline:Date.now()+20000,live:false,sleep:noSleep,concurrency:4});
 assert.ok(r.stats.splits>0&&r.stats.byClass.RANGE_OR_RESULT_LIMIT===undefined,JSON.stringify(r.stats.byClass));
 assert.equal(calls.fallback,0,'getLogs must not use the free-plan fallback');
});
test('a provider that states limit L but rejects a range of size <= L is reported as inconsistent, not halved to single blocks',async()=>{
 const rpc=rpcOf(()=>{throw Object.assign(Error('RPC_HTTP_400'),{transport:true,body:'ranges over 10000 blocks are not supported on free plan'});});
 await assert.rejects(scanRange(rpc,{...cfg,initialChunk:10000},0,50000,{deadline:far(),sleep:noSleep}),
  e=>/inconsistent with its stated limit/.test(e.detail.reason)&&e.detail.statedLimit===10000&&rpc.calls<=12);
});
test('tiny-range errors stop the scan with an actionable reason (no 600-call storm)',async()=>{
 const rpc=rpcOf(p=>{const [f,t]=bounds(p);if(t-f+1>0)throw Object.assign(Error('RPC_HTTP_400'),{transport:true,body:'block range too large'});});
 await assert.rejects(scanRange(rpc,cfg,0,100000,{deadline:far(),sleep:noSleep}),e=>/persist at tiny ranges/.test(e.detail.reason));
 assert.ok(rpc.calls<80,'calls '+rpc.calls);
});
test('timeouts on wide ranges halve immediately instead of retrying the same range',async()=>{
 let widest=0,timeouts=0;
 const rpc=rpcOf(p=>{const [f,t]=bounds(p),size=t-f+1;if(size>2000){timeouts++;throw Object.assign(Error('aborted'),{name:'AbortError'});}widest=Math.max(widest,size);return [];});
 const r=await scanRange(rpc,{...cfg,initialChunk:16000},0,31999,{deadline:far(),sleep:noSleep});
 assert.ok(timeouts<=10,'timeouts '+timeouts);assert.ok(widest<=2000);void r;
});
