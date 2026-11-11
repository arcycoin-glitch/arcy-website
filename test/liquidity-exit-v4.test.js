'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const v4=require('../lib/liquidity-exit-v4'),router=require('../lib/liquidity-exit'),v2=require('../lib/liquidity-exit-v2');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),ZERO='0x'+'0'.repeat(40),Q96=1n<<96n,HASH='0x'+'ab'.repeat(32);
const word=v=>(BigInt(v)<0n?(1n<<256n)+BigInt(v):BigInt(v)).toString(16).padStart(64,'0');
const addr=a=>a.slice(2).padStart(64,'0');
const topic=a=>'0x'+addr(a);
const raw=(...xs)=>'0x'+xs.join('');
const ARC=v4.PROTOCOLS.arc[0];
function world(o={}){
 const key={currency0:A,currency1:B,fee:3000,tickSpacing:60,hooks:ZERO,...o.key};
 const poolId=v4.poolIdForKey(key),calls=[];
 const state={sqrtPriceX96:Q96,tick:0,protocolFee:0,lpFee:key.fee===0x800000?500:key.fee,liquidity:10n**24n,...o.state};
 const log={address:ARC.poolManager,removed:false,topics:[v4.INIT_TOPIC,poolId,topic(key.currency0),topic(key.currency1)],
  data:raw(word(key.fee),word(key.tickSpacing),addr(key.hooks),word(Q96),word(0)),blockNumber:'0x180',transactionHash:'0x'+'cd'.repeat(32)};
 const reply=(q,result)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 const error=(q,code,message)=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code,message}}));
 const fetcher=async(url,init)=>{
  const q=JSON.parse(init.body),host=new URL(url).hostname;calls.push({host,method:q.method,params:q.params});
  if(o.secondaryDown&&host==='rpc.quicknode.mainnet.arc.io')return new Response('down',{status:502});
  if(q.method==='eth_chainId')return reply(q,'0x13b2');
  if(q.method==='eth_blockNumber')return reply(q,'0x2002');
  if(q.method==='eth_getBlockByNumber')return reply(q,{number:q.params[0],hash:HASH,timestamp:'0x6b49d200'});
  if(q.method==='eth_getCode')return reply(q,'0x60006000');
  if(q.method==='eth_getTransactionReceipt')return reply(q,{contractAddress:ARC.poolManager,blockNumber:'0x100',status:'0x1'});
  if(q.method==='eth_getLogs')return reply(q,o.noLog?[]:[{...log,...(o.log||{})}]);
  if(q.method==='eth_call'){
   const {to,data}=q.params[0];
   if((to===ARC.stateView||to===ARC.quoter)&&data===v4.SELECTORS.poolManager)return reply(q,raw(addr(ARC.poolManager)));
   if(to===ARC.stateView&&data.startsWith(v4.SELECTORS.getSlot0))return reply(q,raw(word(state.sqrtPriceX96),word(state.tick),word(state.protocolFee),word(state.lpFee)));
   if(to===ARC.stateView&&data.startsWith(v4.SELECTORS.getLiquidity))return reply(q,raw(word(state.liquidity)));
   if(to===ARC.quoter&&data.startsWith(v4.SELECTORS.quoteExactInputSingle)){
    const amount=BigInt('0x'+data.slice(10+64*7,10+64*8));
    if(o.quoteRevert)return error(q,3,'execution reverted');
    const out=amount*997n/1000n;
    return reply(q,raw(word(out),word(123456)));
   }
   return error(q,3,'execution reverted');
  }
  return error(q,-32601,'method not found');
 };
 const args={network:'arc',pool:poolId,tokenIn:A,fetcher,env:{},now:()=>1800000000*1000,sleep:async()=>{}};
 return {key,poolId,calls,fetcher,args,run:(extra={})=>v4.analyze({...args,...extra})};
}
const failure=async p=>{try{await p;}catch(e){return v2.classifyFailure(e);}throw Error('expected failure');};

test('PoolId uses the full five-word PoolKey and Initialize round-trips to the same identity',()=>{
 const w=world(),log={address:ARC.poolManager,removed:false,topics:[v4.INIT_TOPIC,w.poolId,topic(w.key.currency0),topic(w.key.currency1)],
  data:raw(word(w.key.fee),word(w.key.tickSpacing),addr(w.key.hooks),word(Q96),word(0)),blockNumber:'0x180',transactionHash:'0x'+'ef'.repeat(32)};
 const parsed=v4.parseInitialize(log,w.poolId);
 assert.deepEqual(parsed.key,w.key);assert.equal(v4.poolIdForKey(parsed.key),w.poolId);
 const changed={...w.key,fee:500};assert.notEqual(v4.poolIdForKey(changed),w.poolId);
});

test('Arc V4 quote verifies reviewed deployment, PoolKey identity, StateView, Quoter and independent RPC',async()=>{
 const w=world(),r=await w.run({amountsIn:['1000000000000000000']});
 assert.equal(r.status,'VERIFIED_POOL_MODEL');assert.equal(r.model,'UNISWAP_V4_OFFICIAL_QUOTER_PINNED_STATE');
 assert.equal(r.pool.id,w.poolId);assert.equal(r.pool.currency0,A);assert.equal(r.pool.currency1,B);
 assert.equal(r.pool.poolManager,ARC.poolManager);assert.equal(r.pool.stateView,ARC.stateView);assert.equal(r.pool.quoter,ARC.quoter);
 assert.equal(r.evidence.class,'INDEPENDENTLY_CROSS_CHECKED');assert.equal(r.evidence.crossCheck.state,'AGREED');
 assert.equal(r.quotes.length,1);assert.equal(r.quotes[0].state,'VERIFIED');assert.equal(r.quotes[0].amountOut,'997000000000000000');
 assert.equal(r.quotes[0].feePpm,3000);assert.equal(r.fee.effectiveFeePpm,3000);
 assert.ok(w.calls.some(x=>x.method==='eth_getLogs'));assert.ok(w.calls.some(x=>x.method==='eth_getTransactionReceipt'));
 assert.ok(w.calls.filter(x=>x.method==='eth_call').every(x=>x.params[1]==='0x2000'));
});

test('V4 fails closed on missing Initialize evidence and refuses a hook quote revert',async()=>{
 assert.deepEqual(await failure(world({noLog:true}).run()),{state:'UNSUPPORTED',reasonCode:'V4_POOL_NOT_INITIALIZED'});
 const w=world({quoteRevert:true});
 assert.deepEqual(await failure(w.run({amountsIn:['1000000']})),{state:'UNSUPPORTED',reasonCode:'V4_QUOTE_REVERTED'});
});

test('dynamic-fee hook quote can be verified while fee/impact decomposition is withheld',()=>{
 const key={currency0:A,currency1:B,fee:0x800000,tickSpacing:60,hooks:'0x'+'3'.repeat(40)};
 const f=v4.effectiveFeePpm({protocolFee:0,lpFee:700},key,true);
 assert.equal(f.known,false);assert.equal(f.effectiveFeePpm,null);assert.equal(f.dynamic,true);
 const m=v4.metrics({amountIn:1000000n,amountOut:990000n,sqrtPriceX96:Q96,zeroForOne:true,fee:f});
 assert.equal(m.feePpm,null);assert.equal(m.priceImpactPpm,null);assert.equal(m.totalVsMidPpm,10000);
});

test('dispatcher advertises V4 and routes bytes32 PoolIds without touching V2/V3 address routing',async()=>{
 assert.deepEqual(router.supported('arc'),{v2:[],v3:[],v4:['uniswap-v4']});
 assert.deepEqual(router.supported('robinhood'),{v2:[],v3:['uniswap-v3'],v4:['uniswap-v4']});
 const w=world(),r=await router.analyze({...w.args,amountsIn:['1000000']});
 assert.equal(r.model,'UNISWAP_V4_OFFICIAL_QUOTER_PINNED_STATE');
});
