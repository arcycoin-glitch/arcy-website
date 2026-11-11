'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const exit=require('../lib/liquidity-exit-v2');
const {quoteExactIn}=require('../lib/liquidity-v2-reserves');

const UNI=exit.PROTOCOLS.ethereum.find(p=>p.id==='uniswap-v2');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),POOL='0x'+'c'.repeat(40),OTHER='0x'+'d'.repeat(40);
const word=v=>BigInt(v).toString(16).padStart(64,'0');
const PRIMARY='ethereum-rpc.publicnode.com',SECONDARY='eth.drpc.org';
const HASH='0x'+'11'.repeat(32);

// A deterministic fake chain: one V2 pool, the reviewed factory and the reviewed router (which runs the real formula).
function world(o={}){
 const w={chainId:'0x1',head:0x1002,timestamp:1800000000,hash:HASH,token0:A,token1:B,reserve0:5000000n*10n**6n,reserve1:2500n*10n**18n,
  tsLast:1799999400,poolFactory:UNI.factory,registered:POOL,balance0:null,balance1:null,routerFeeBps:30,calls:[],secondary:{},...o};
 const reply=(q,result)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 const error=(q,code,message)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code,message}}));
 w.fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),second=host===SECONDARY,view=second?{...w,...w.secondary}:w;
  w.calls.push({host,method:q.method,params:q.params});
  if(view.down)return new Response('bad gateway',{status:502});
  if(view.failOnce&&view.failOnce[q.method]){view.failOnce[q.method]--;return new Response('slow down',{status:429});}
  if(q.method==='eth_chainId')return reply(q,view.chainId);
  if(q.method==='eth_blockNumber')return reply(q,'0x'+view.head.toString(16));
  if(q.method==='eth_getBlockByNumber'){
   const n=w.calls.filter(c=>c.host===host&&c.method==='eth_getBlockByNumber').length;
   return reply(q,{number:q.params[0],hash:view.reorgAfterFirst&&n>1?'0x'+'22'.repeat(32):view.hash,timestamp:'0x'+view.timestamp.toString(16)});
  }
  if(q.method==='eth_getCode')return reply(q,view.noCode?'0x':'0x6080');
  if(q.method==='eth_call'){
   const {to,data}=q.params[0],s=exit.SELECTORS;
   if(to===POOL){
    if(data===s.token0)return reply(q,'0x'+word(view.token0));
    if(data===s.token1)return reply(q,'0x'+word(view.token1));
    if(data===s.getReserves)return view.v3?error(q,3,'execution reverted'):reply(q,'0x'+word(view.reserve0)+word(view.reserve1)+word(view.tsLast));
    if(data===s.factory)return reply(q,'0x'+word(view.poolFactory));
   }
   if(data.startsWith(s.getPair))return to===UNI.factory?reply(q,'0x'+word(view.registered)):error(q,3,'execution reverted');
   if(data.startsWith(s.balanceOf)){
    const reserve=to===view.token0?view.reserve0:view.reserve1,override=to===view.token0?view.balance0:view.balance1;
    return reply(q,'0x'+word(override??reserve));
   }
   if(to===UNI.router&&data.startsWith(s.getAmountsOut)){
    const amountIn=BigInt('0x'+data.slice(10,74)),tokenIn='0x'+data.slice(10+64*3+24,10+64*4);
    const [rIn,rOut]=tokenIn===view.token0?[view.reserve0,view.reserve1]:[view.reserve1,view.reserve0];
    const out=quoteExactIn({amountIn,reserveIn:rIn,reserveOut:rOut,feeBps:view.routerFeeBps}).amountOut;
    return reply(q,'0x'+word(32)+word(2)+word(amountIn)+word(out));
   }
   return error(q,3,'execution reverted');
  }
  return error(q,-32601,'method not found');
 };
 w.run=(extra={})=>exit.analyze({network:'ethereum',pool:POOL,tokenIn:A,fetcher:w.fetcher,env:{},now:()=>(w.timestamp+30)*1000,sleep:async()=>{},...extra});
 return w;
}
const code=async promise=>{try{await promise;}catch(e){return exit.classifyFailure(e);}throw Error('expected a failure');};

test('selectors are derived from the canonical signatures',()=>{
 assert.deepEqual({...exit.SELECTORS},{token0:'0x0dfe1681',token1:'0xd21220a7',getReserves:'0x0902f1ac',factory:'0xc45a0155',
  getPair:'0xe6a43905',balanceOf:'0x70a08231',getAmountsOut:'0xd06ca61f'});
});

test('decompose separates price impact from the fee and rounds against the seller',()=>{
 const q=exit.decompose({amountIn:1000n,reserveIn:100000n,reserveOut:200000n,feeBps:30});
 assert.equal(q.amountOut,'1974');           // same integer result as the PR #207 foundation
 assert.equal(q.feePpm,3000);
 assert.equal(q.shareOfReserveInPpm,10000);
 assert.equal(q.priceImpactPpm,9872);         // ceil(997/(100000+997) * 1e6)
 assert.equal(q.totalVsMidPpm,13000);         // ceil((2000-1974)/2000 * 1e6): fee + impact (+ integer rounding)
 assert.ok(q.totalVsMidPpm>=q.priceImpactPpm&&q.totalVsMidPpm>=q.feePpm);
 // Price impact grows with size, the fee share does not.
 const big=exit.decompose({amountIn:50000n,reserveIn:100000n,reserveOut:200000n,feeBps:30});
 assert.ok(big.priceImpactPpm>q.priceImpactPpm*20);assert.equal(big.feePpm,q.feePpm);
 // A zero-fee pool still has price impact; the two are different quantities.
 const noFee=exit.decompose({amountIn:1000n,reserveIn:100000n,reserveOut:200000n,feeBps:0});
 assert.equal(noFee.feePpm,0);assert.equal(noFee.priceImpactPpm,9901);
});

test('verified pool: reviewed factory, pinned block, router-equal quotes and an agreeing second provider',async()=>{
 const w=world(),r=await w.run();
 assert.equal(r.status,'VERIFIED_POOL_MODEL');
 assert.equal(r.pool.protocol,'uniswap-v2');assert.equal(r.pool.feeBps,30);assert.equal(r.pool.feeEvidence,'REVIEWED_PROTOCOL_CONSTANT');
 assert.deepEqual(r.pool.identity,{poolFactory:UNI.factory,factoryGetPair:POOL,verified:true,method:r.pool.identity.method});
 assert.equal(r.block.number,0x1000);assert.equal(r.block.hash,HASH);assert.equal(r.block.freshness,'CURRENT');assert.equal(r.block.ageSeconds,30);
 assert.equal(r.reserves.lastUpdateAgeSeconds,600);
 assert.equal(r.tokenOut,B);assert.equal(r.ladder,'DEFAULT_SHARE_OF_RESERVE_BPS_10_100_500');
 assert.equal(r.quotes.length,3);
 for(const q of r.quotes){assert.equal(q.routerMatch,true);assert.equal(q.routerAmountOut,q.amountOut);}
 assert.deepEqual(r.quotes.map(q=>q.shareOfReserveInPpm),[1000,10000,50000]);
 assert.ok(r.quotes[0].priceImpactPpm<r.quotes[1].priceImpactPpm&&r.quotes[1].priceImpactPpm<r.quotes[2].priceImpactPpm);
 assert.equal(r.evidence.class,'INDEPENDENTLY_CROSS_CHECKED');assert.equal(r.evidence.crossCheck.state,'AGREED');
 assert.ok(r.limitations.some(x=>x.startsWith('MODEL_ONLY'))&&r.limitations.some(x=>x.startsWith('TOKEN_TRANSFER_TAX_NOT_MODELLED')));
 // Bounded and read-only: every state read is pinned to the same block on both providers.
 assert.equal(r.cost.primaryCalls,15);assert.equal(r.cost.crossCheckCalls,3);
 const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call']);
 assert.ok(w.calls.every(c=>allowed.has(c.method)));
 for(const c of w.calls.filter(c=>c.method==='eth_call'||c.method==='eth_getCode'))assert.equal(c.params[1],'0x1000');
 assert.deepEqual([...new Set(w.calls.map(c=>c.host))].sort(),[SECONDARY,PRIMARY].sort());
 // No secret or endpoint leaves the module.
 assert.ok(!JSON.stringify(r).includes('http'));
});

test('caller amount, reverse direction and exact reproduction of the formula',async()=>{
 const w=world(),r=await w.run({tokenIn:B,amountsIn:['1000000000000000000']});
 assert.equal(r.tokenOut,A);assert.equal(r.ladder,'CALLER_SUPPLIED');
 const expected=(10n**18n*9970n*w.reserve0)/(w.reserve1*10000n+10n**18n*9970n);
 assert.equal(r.quotes[0].amountOut,expected.toString());
});

test('a second provider that cannot answer leaves the result single-source, never upgraded',async()=>{
 const w=world({secondary:{down:true}}),r=await w.run();
 assert.equal(r.evidence.class,'SINGLE_SOURCE_ONCHAIN');assert.equal(r.evidence.crossCheck.state,'UNAVAILABLE');
 assert.equal(r.evidence.crossCheck.reasonCode,'RPC_HTTP_ERROR');assert.equal(r.quotes.length,3);
 const off=await world().run({env:{LIQUIDITY_CROSSCHECK_RPC_ETHEREUM:'off'}});
 assert.equal(off.evidence.crossCheck.state,'NOT_CONFIGURED');assert.equal(off.evidence.class,'SINGLE_SOURCE_ONCHAIN');
 // The same host as the primary endpoint is not an independent provider.
 assert.equal(exit.crossCheckUrl('ethereum',{LIQUIDITY_CROSSCHECK_RPC_ETHEREUM:'https://'+PRIMARY+'/x'}),null);
 assert.equal(exit.crossCheckUrl('ethereum',{LIQUIDITY_CROSSCHECK_RPC_ETHEREUM:'http://insecure.example'}),null);
});

test('providers that disagree on reserves or on the block fail closed',async()=>{
 assert.deepEqual(await code(world({secondary:{reserve0:1n}}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'RPC_DISAGREEMENT'});
 assert.deepEqual(await code(world({secondary:{hash:'0x'+'33'.repeat(32)}}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'RPC_DISAGREEMENT'});
 assert.equal((await world({secondary:{chainId:'0x5'}}).run()).evidence.crossCheck.reasonCode,'RPC_CHAIN_ID_MISMATCH');
 assert.deepEqual(await code(world({reorgAfterFirst:true}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'PINNED_BLOCK_CHANGED'});
});

test('pool identity: unreviewed factory, forged factory() and unregistered pools are refused',async()=>{
 assert.deepEqual(await code(world({poolFactory:OTHER}).run()),{state:'UNSUPPORTED',reasonCode:'FACTORY_NOT_REVIEWED',observedFactory:OTHER});
 // A contract can claim any factory(); only the reviewed factory's own registry counts.
 assert.deepEqual(await code(world({registered:OTHER}).run()),{state:'UNSUPPORTED',reasonCode:'POOL_NOT_REGISTERED_BY_FACTORY',observedFactory:UNI.factory});
 assert.equal((await code(world({registered:'0x'+'0'.repeat(40)}).run())).reasonCode,'POOL_NOT_REGISTERED_BY_FACTORY');
});

test('unsupported shapes fail closed with distinct reasons and no quote',async()=>{
 assert.deepEqual(await code(world({v3:true}).run()),{state:'UNSUPPORTED',reasonCode:'NOT_V2_COMPATIBLE_POOL'});
 assert.equal((await code(world({noCode:true}).run())).reasonCode,'POOL_HAS_NO_CODE');
 assert.equal((await code(world().run({tokenIn:OTHER}))).reasonCode,'TOKEN_NOT_IN_POOL');
 assert.equal((await code(world({reserve1:0n}).run())).reasonCode,'ZERO_POOL_RESERVE');
 assert.equal((await code(world({balance0:1n}).run())).reasonCode,'RESERVE_EXCEEDS_BALANCE');
 assert.equal((await code(world({token1:A}).run())).reasonCode,'INVALID_POOL_TOKEN_PAIR');
 // A fork with a different real fee cannot pass with the reviewed constant.
 assert.deepEqual(await code(world({routerFeeBps:25}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'QUOTE_MODEL_MISMATCH'});
 assert.equal((await code(world({chainId:'0x89'}).run())).reasonCode,'RPC_CHAIN_ID_MISMATCH');
});

test('Arc and Robinhood have no reviewed V2 protocol: refused before any network read',async()=>{
 for(const network of ['arc','robinhood']){
  const w=world();
  assert.deepEqual(await code(w.run({network})),{state:'UNSUPPORTED',reasonCode:'NO_REVIEWED_V2_PROTOCOL'});
  assert.equal(w.calls.length,0);
 }
 const w=world();
 assert.equal((await code(w.run({amountsIn:['0']}))).state,'INVALID_REQUEST');
 assert.equal((await code(w.run({amountsIn:['1','2','3','4','5']}))).reasonCode,'INVALID_AMOUNT_IN');
 assert.equal((await code(w.run({pool:'0x12'}))).reasonCode,'INVALID_ADDRESS');
 assert.equal(w.calls.length,0);
});

test('provider failures are bounded, retried once and reported as provider failures',async()=>{
 const retried=world({failOnce:{eth_blockNumber:1}}),r=await retried.run();
 assert.equal(r.cost.retries,1);assert.equal(r.cost.primaryCalls,16);
 assert.deepEqual(await code(world({failOnce:{eth_blockNumber:5}}).run()),{state:'PROVIDER_UNAVAILABLE',reasonCode:'RPC_RATE_LIMITED'});
 assert.deepEqual(await code(world({down:true,secondary:{down:false}}).run()),{state:'PROVIDER_UNAVAILABLE',reasonCode:'RPC_HTTP_ERROR'});
 // A head that is too old is labelled, not presented as current.
 const stale=world();assert.equal((await stale.run({now:()=>(stale.timestamp+5000)*1000})).block.freshness,'STALE_HEAD');
});

test('cache shares one analysis between concurrent callers and never stores a failure',async()=>{
 exit._reset();let runs=0;
 const run=async()=>{runs++;await new Promise(r=>setTimeout(r,5));return {n:runs};};
 const args={network:'ethereum',pool:POOL,tokenIn:A};
 const [a,b]=await Promise.all([exit.cached(args,run),exit.cached(args,run)]);
 assert.equal(runs,1);assert.equal(a,b);
 await exit.cached(args,run);assert.equal(runs,1);
 exit._reset();let attempts=0;
 const failing=async()=>{attempts++;throw Object.assign(Error('RPC_TIMEOUT'),{code:'RPC_TIMEOUT'});};
 await assert.rejects(exit.cached(args,failing));await assert.rejects(exit.cached(args,failing));
 assert.equal(attempts,2);exit._reset();
});

test('GET /api/search?action=exitquote is default-off, validated and additive',async()=>{
 const handler=require('../api/search/index.js');
 const call=async(url,method='GET')=>{
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  await handler({method,url,query:{},headers:{},socket:{remoteAddress:'203.0.113.9'}},res);return res;
 };
 const q='/api/search?action=exitquote&chain=ethereum&pool='+POOL+'&token='+A;
 const before=process.env.LIQUIDITY_EXIT_QUOTE_ENABLED;
 try{
  delete process.env.LIQUIDITY_EXIT_QUOTE_ENABLED;
  const off=await call(q);assert.equal(off.code,404);assert.equal(off.body.error,'EXIT_QUOTE_NOT_ENABLED');
  process.env.LIQUIDITY_EXIT_QUOTE_ENABLED='1';
  assert.equal((await call(q,'POST')).code,405);
  assert.equal((await call(q.replace('ethereum','bsc'))).body.error,'UNSUPPORTED_CHAIN');
  assert.equal((await call('/api/search?action=exitquote&chain=ethereum&pool=0x12&token='+A)).body.error,'VALID_POOL_REQUIRED');
  assert.equal((await call('/api/search?action=exitquote&chain=ethereum&pool='+POOL+'&token=nope')).body.error,'VALID_TOKEN_REQUIRED');
  assert.equal((await call(q+'&amount=-5')).body.error,'VALID_AMOUNT_REQUIRED');
  // Unsupported network: explicit state, HTTP 200, no quote, no RPC needed.
  const arc=await call(q.replace('ethereum','arc'));
  assert.equal(arc.code,200);
  assert.deepEqual(arc.body,{ok:false,readOnly:true,quotes:null,state:'UNSUPPORTED',reasonCode:'FACTORY_NOT_REVIEWED'});
  assert.equal(arc.headers['Cache-Control'],'no-store');
 }finally{if(before===undefined)delete process.env.LIQUIDITY_EXIT_QUOTE_ENABLED;else process.env.LIQUIDITY_EXIT_QUOTE_ENABLED=before;require('../lib/liquidity-exit')._reset();}
});

test('the Liquidity card API and the PR #207 foundation are not modified by this engine',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
 const liquidity=fs.readFileSync(path.join(root,'api/liquidity.js'),'utf8');
 assert.ok(!liquidity.includes('liquidity-exit-v2')&&!liquidity.includes('liquidity-v2-reserves'));
 const engine=fs.readFileSync(path.join(root,'lib/liquidity-exit-v2.js'),'utf8');
 assert.ok(!/eth_send|eth_sign|personal_|privateKey/i.test(engine));
});
