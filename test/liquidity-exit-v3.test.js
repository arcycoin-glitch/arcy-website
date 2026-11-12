'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const v3=require('../lib/liquidity-exit-v3'),v2=require('../lib/liquidity-exit-v2'),router=require('../lib/liquidity-exit');
const {math}=v3;
const UNI=v3.PROTOCOLS.ethereum[0],UNI2=v2.PROTOCOLS.ethereum[0];
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),POOL='0x'+'c'.repeat(40),OTHER='0x'+'d'.repeat(40);
const word=v=>(v<0n?(1n<<256n)+v:BigInt(v)).toString(16).padStart(64,'0');
const PRIMARY='ethereum-rpc.publicnode.com',SECONDARY='eth.drpc.org',HASH='0x'+'11'.repeat(32);
const Q96=1n<<96n;
function isqrt(x){if(x<2n)return x;let r=1n<<BigInt(Math.ceil(x.toString(2).length/2));for(;;){const y=(r+x/r)>>1n;if(y>=r)break;r=y;}return r;}
const encodePriceSqrt=(one,zero)=>isqrt((one<<192n)/zero);

test('TickMath: boundary values and every multiplier constant',()=>{
 assert.equal(math.getSqrtRatioAtTick(0),Q96);
 assert.equal(math.getSqrtRatioAtTick(math.MIN_TICK),math.MIN_SQRT_RATIO);
 assert.equal(math.getSqrtRatioAtTick(math.MAX_TICK),math.MAX_SQRT_RATIO);
 for(let i=0;i<20;i++)for(const tick of [1<<i,-(1<<i)]){
  if(Math.abs(tick)>math.MAX_TICK)continue;
  const got=Number(math.getSqrtRatioAtTick(tick))/2**96,expected=Math.pow(1.0001,tick/2);
  assert.ok(Math.abs(got/expected-1)<1e-9,'tick '+tick);
 }
 assert.throws(()=>math.getSqrtRatioAtTick(887273),/V3_TICK_OUT_OF_RANGE/);
});

test('SwapMath.computeSwapStep reproduces the Uniswap v3-core reference vectors',()=>{
 // "exact amount in that gets capped at price target in one for zero"
 const capped=math.computeSwapStep(Q96,encodePriceSqrt(101n,100n),2n*10n**18n,10n**18n,600n);
 assert.deepEqual(capped,{next:79623317895830914510639640423n,amountIn:9975124224178055n,amountOut:9925619580021728n,feeAmount:5988667735148n});
 assert.ok(capped.amountIn+capped.feeAmount<10n**18n);
 // "exact amount in that is fully spent in one for zero"
 const spent=math.computeSwapStep(Q96,encodePriceSqrt(1000n,100n),2n*10n**18n,10n**18n,600n);
 assert.equal(spent.amountIn,999400000000000000n);assert.equal(spent.feeAmount,600000000000000n);assert.equal(spent.amountOut,666399946655997866n);
 assert.equal(spent.amountIn+spent.feeAmount,10n**18n);assert.ok(spent.next<encodePriceSqrt(1000n,100n));
});

test('TickBitmap search handles negative ticks, word boundaries and empty words',async()=>{
 const bits=new Map([[0,(1n<<5n)|(1n<<200n)],[-1,1n<<255n]]),bitmap=async w=>bits.get(w)||0n;
 assert.deepEqual(await math.nextInitializedTick(bitmap,70,10,true),{tick:50,initialized:true});      // compressed 7 -> bit 5
 assert.deepEqual(await math.nextInitializedTick(bitmap,40,10,true),{tick:0,initialized:false});       // nothing at or below bit 4 in word 0
 assert.deepEqual(await math.nextInitializedTick(bitmap,-1,10,true),{tick:-10,initialized:true});      // floor(-1/10)=-1 -> word -1 bit 255
 assert.deepEqual(await math.nextInitializedTick(bitmap,70,10,false),{tick:2000,initialized:true});    // next above: bit 200
 assert.deepEqual(await math.nextInitializedTick(bitmap,2000,10,false),{tick:2550,initialized:false}); // end of the word, not initialized
 assert.deepEqual(await math.nextInitializedTick(bitmap,-25,10,false),{tick:-10,initialized:true});
});

// Synthetic concentrated-liquidity pool. The fake QuoterV2 replays the same state, so these tests cover the plumbing,
// identity and failure handling; arithmetic correctness is covered above and by the live QuoterV2 probe.
function world(o={}){
 const L=10n**22n;
 const w={chainId:'0x1',head:0x2002,timestamp:1800000000,hash:HASH,token0:A,token1:B,fee:3000,spacing:60,tick:0,sqrtPriceX96:Q96,liquidity:L,
  ticks:new Map([[-600,L/2n],[600,-L/2n],[-6000,L/2n],[6000,-L/2n]]),poolFactory:UNI.factory,registered:POOL,quoterSkew:0n,calls:[],secondary:{},...o};
 const bitmapWord=pos=>{let v=0n;for(const t of w.ticks.keys()){const c=Math.floor(t/w.spacing);if(c>>8===pos)v|=1n<<BigInt(((c%256)+256)%256);}return v;};
 const reply=(q,result)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 const error=(q,code,message)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code,message}}));
 w.fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),view=host===SECONDARY?{...w,...w.secondary}:w;
  w.calls.push({host,method:q.method,params:q.params});
  if(view.down)return new Response('bad gateway',{status:502});
  if(q.method==='eth_chainId')return reply(q,view.chainId);
  if(q.method==='eth_blockNumber')return reply(q,'0x'+view.head.toString(16));
  if(q.method==='eth_getBlockByNumber')return reply(q,{number:q.params[0],hash:view.hash,timestamp:'0x'+view.timestamp.toString(16)});
  if(q.method==='eth_getCode')return reply(q,'0x6080');
  if(q.method==='eth_call'){
   const {to,data}=q.params[0],s=v3.SELECTORS;
   if(to===POOL){
    if(data===s.token0)return reply(q,'0x'+word(view.token0));
    if(data===s.token1)return reply(q,'0x'+word(view.token1));
    if(data===s.factory)return reply(q,'0x'+word(view.poolFactory));
    if(view.v2shape)return error(q,3,'execution reverted');
    if(data===s.fee)return reply(q,'0x'+word(BigInt(view.fee)));
    if(data===s.tickSpacing)return reply(q,'0x'+word(BigInt(view.spacing)));
    if(data===s.slot0)return reply(q,'0x'+word(view.sqrtPriceX96)+word(BigInt(view.tick))+word(0n).repeat(4)+word(1n));
    if(data===s.liquidity)return reply(q,'0x'+word(view.liquidity));
    if(data.startsWith(s.tickBitmap)){const v=BigInt('0x'+data.slice(10)),pos=Number(v>=1n<<255n?v-(1n<<256n):v);return reply(q,'0x'+word(bitmapWord(pos)));}
    if(data.startsWith(s.ticks)){const v=BigInt('0x'+data.slice(10)),t=Number(v>=1n<<255n?v-(1n<<256n):v);return reply(q,'0x'+word(1n)+word(view.ticks.get(t)||0n)+word(0n).repeat(6));}
   }
   if(data.startsWith(s.getPool))return to===UNI.factory?reply(q,'0x'+word(view.registered)):error(q,3,'execution reverted');
   if(to===UNI.quoter&&data.startsWith(s.quoteExactInputSingle)){
    const tokenIn='0x'+data.slice(10+24,10+64),amountIn=BigInt('0x'+data.slice(10+128,10+192)),zeroForOne=tokenIn===view.token0;
    const r=await math.simulate({state:{sqrtPriceX96:view.sqrtPriceX96,tick:view.tick,liquidity:view.liquidity},amountIn,zeroForOne,feePips:BigInt(view.fee),tickSpacing:view.spacing,
     reads:{bitmap:async p=>bitmapWord(p),liquidityNet:async t=>view.ticks.get(t)||0n}});
    return reply(q,'0x'+word(r.amountOut+view.quoterSkew)+word(r.sqrtPriceX96After)+word(BigInt(r.initializedTicksCrossed))+word(100000n));
   }
   return error(q,3,'execution reverted');
  }
  return error(q,-32601,'method not found');
 };
 const base=extra=>({network:'ethereum',pool:POOL,tokenIn:A,fetcher:w.fetcher,env:{},now:()=>(w.timestamp+30)*1000,sleep:async()=>{},...extra});
 w.run=(extra={})=>v3.analyze(base(extra));w.route=(extra={})=>router.analyze(base(extra));
 return w;
}
const code=async promise=>{try{await promise;}catch(e){return v2.classifyFailure(e);}throw Error('expected a failure');};

test('verified V3 pool: factory-confirmed fee tier, tick replay equal to the quoter, second provider agreement',async()=>{
 const w=world(),r=await w.run();
 assert.equal(r.status,'VERIFIED_POOL_MODEL');assert.equal(r.model,'UNISWAP_V3_EXACT_INPUT_TICK_REPLAY');
 assert.equal(r.pool.protocol,'uniswap-v3');assert.equal(r.pool.feePips,3000);assert.equal(r.pool.feeBps,30);
 assert.equal(r.pool.feeEvidence,'ONCHAIN_POOL_IMMUTABLE_CONFIRMED_BY_FACTORY');assert.equal(r.pool.identity.factoryGetPool,POOL);
 assert.equal(r.block.number,0x2000);assert.equal(r.evidence.class,'INDEPENDENTLY_CROSS_CHECKED');
 assert.equal(r.quotes.length,3);
 for(const q of r.quotes){assert.equal(q.state,'VERIFIED');assert.equal(q.quoterMatch,true);assert.equal(q.quoterAmountOut,q.amountOut);assert.equal(q.feePpm,3000);assert.ok(q.totalVsMidPpm>=q.priceImpactPpm);}
 assert.ok(r.quotes[0].priceImpactPpm<r.quotes[1].priceImpactPpm&&r.quotes[1].priceImpactPpm<r.quotes[2].priceImpactPpm);
 // The 5 % step leaves the first range (tick -600 is ~2.96 % of price): an initialized tick is crossed and liquidity changes.
 assert.equal(r.quotes[0].initializedTicksCrossed,0);assert.equal(r.quotes[2].initializedTicksCrossed,1);
 assert.equal(r.state.ticksRead,1);assert.ok(r.state.bitmapWordsRead>=1&&r.state.bitmapWordsRead<=v3.MAX_WORDS);
 for(const c of w.calls.filter(c=>c.method==='eth_call'||c.method==='eth_getCode'))assert.equal(c.params[1],'0x2000');
 assert.ok(r.cost.primaryCalls<=80&&r.cost.crossCheckCalls===4);
 assert.ok(!JSON.stringify(r).includes('http'));
});

test('crossing a tick changes the result: the replay is not a single-range approximation',async()=>{
 const w=world(),amount=(10n**22n*8n/100n).toString();
 const crossed=(await w.run({amountsIn:[amount]})).quotes[0];
 const flat=(await world({ticks:new Map([[-6000,10n**22n],[6000,-(10n**22n)]])}).run({amountsIn:[amount]})).quotes[0];
 assert.equal(crossed.initializedTicksCrossed,1);assert.equal(flat.initializedTicksCrossed,0);
 assert.ok(BigInt(crossed.amountOut)<BigInt(flat.amountOut));          // half the liquidity below tick -600 -> worse exit
 assert.ok(crossed.priceImpactPpm>flat.priceImpactPpm);
 const reverse=(await w.run({tokenIn:B,amountsIn:[amount]})).quotes[0];
 assert.equal(reverse.initializedTicksCrossed,1);
});

test('V3 refusals: identity, model mismatch, depth budget, exhausted liquidity and provider disagreement',async()=>{
 assert.deepEqual(await code(world({poolFactory:OTHER}).run()),{state:'UNSUPPORTED',reasonCode:'FACTORY_NOT_REVIEWED',observedFactory:OTHER});
 assert.equal((await code(world({registered:OTHER}).run())).reasonCode,'POOL_NOT_REGISTERED_BY_FACTORY');
 assert.deepEqual(await code(world({v2shape:true}).run()),{state:'UNSUPPORTED',reasonCode:'NOT_V3_COMPATIBLE_POOL'});
 assert.deepEqual(await code(world({quoterSkew:1n}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'QUOTE_MODEL_MISMATCH'});
 assert.deepEqual(await code(world({liquidity:0n}).run()),{state:'UNSUPPORTED',reasonCode:'V3_NO_ACTIVE_LIQUIDITY'});
 assert.equal((await code(world().run({tokenIn:OTHER}))).reasonCode,'TOKEN_NOT_IN_POOL');
 // Selling far more than every range holds: refused, never a partial quote.
 const huge=await code(world().run({amountsIn:[(10n**40n).toString()]}));
 assert.equal(huge.state,'UNSUPPORTED');assert.ok(['V3_INSUFFICIENT_LIQUIDITY','V3_DEPTH_BUDGET_EXCEEDED'].includes(huge.reasonCode));
 // More initialized ticks on the path than the read budget allows.
 const dense=new Map();for(let i=1;i<=40;i++){dense.set(-60*i,1n);dense.set(60*i,-1n);}
 assert.deepEqual(await code(world({ticks:dense}).run({amountsIn:[(10n**21n*5n).toString()]})),{state:'UNSUPPORTED',reasonCode:'V3_DEPTH_BUDGET_EXCEEDED'});
 // In a ladder, only the sizes beyond the bounded depth are refused; smaller sizes stay verified and carry no estimate for the rest.
 const ladder=await world({ticks:dense}).run({amountsIn:[(10n**21n*5n).toString(),(10n**18n).toString(),(10n**21n*6n).toString()]});
 assert.deepEqual(ladder.quotes.map(q=>q.state),['VERIFIED','REFUSED','REFUSED']);
 assert.equal(ladder.quotes[0].amountIn,(10n**18n).toString());assert.equal(ladder.quotes[0].quoterMatch,true);
 for(const q of ladder.quotes.slice(1)){assert.equal(q.amountOut,null);assert.equal(q.reasonCode,'V3_DEPTH_BUDGET_EXCEEDED');assert.ok(!('priceImpactPpm' in q));}
 assert.ok(ladder.state.ticksRead<=v3.MAX_TICKS);
 assert.deepEqual(await code(world({secondary:{liquidity:5n}}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'RPC_DISAGREEMENT'});
 assert.deepEqual(await code(world({secondary:{sqrtPriceX96:Q96+1n}}).run()),{state:'CONFLICTING_EVIDENCE',reasonCode:'RPC_DISAGREEMENT'});
 assert.equal((await world({secondary:{down:true}}).run()).evidence.class,'SINGLE_SOURCE_ONCHAIN');
 for(const network of ['arc']){const w=world();assert.equal((await code(w.run({network}))).reasonCode,'NO_REVIEWED_PROTOCOL');assert.equal(w.calls.length,0);}
});

test('dispatcher routes by reviewed factory and still refuses an unknown one',async()=>{
 const w=world(),r=await w.route();
 assert.equal(r.model,'UNISWAP_V3_EXACT_INPUT_TICK_REPLAY');assert.equal(r.cost.routingCalls,1);
 assert.deepEqual(await code(world({poolFactory:OTHER}).route()),{state:'UNSUPPORTED',reasonCode:'FACTORY_NOT_REVIEWED',observedFactory:OTHER});
 // A pool that claims the V2 factory is sent to the V2 engine, whose own checks then reject this V3-shaped contract.
 assert.equal((await code(world({poolFactory:UNI2.factory}).route())).reasonCode,'NOT_V2_COMPATIBLE_POOL');
 assert.deepEqual(router.supported('ethereum'),{v2:['uniswap-v2','sushiswap-v2'],v3:['uniswap-v3'],v4:[]});
 assert.deepEqual(router.supported('robinhood'),{v2:['uniswap-v2'],v3:['uniswap-v3'],v4:['uniswap-v4']});
 assert.deepEqual(router.supported('arc'),{v2:[],v3:[],v4:['uniswap-v4']});
 // Arc has no address-based (V2/V3) protocol: a 20-byte pool is refused as an unreviewed factory, never quoted.
 const none=world({poolFactory:OTHER});assert.equal((await code(none.route({network:'arc'}))).state,'UNSUPPORTED');
});
