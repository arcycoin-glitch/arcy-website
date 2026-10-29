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
