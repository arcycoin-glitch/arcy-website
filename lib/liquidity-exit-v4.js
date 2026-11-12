'use strict';
// Liquidity & Exit V2 — verified single-pool Uniswap v4 exit model (Arc and Robinhood Chain).
//
// v4 pools live inside one PoolManager and are identified by PoolId = keccak256(abi.encode(PoolKey)).
// Verification, all at ONE pinned block:
//   1. Deployment: PoolManager, StateView, Quoter and PositionManager come from the official Uniswap v4 deployment
//      record for the chain; StateView.poolManager() and Quoter.poolManager() must both return that PoolManager.
//   2. Pool identity: the PoolKey is read from PositionManager.poolKeys(bytes25(poolId)) and
//      keccak256(abi.encode(key)) must equal the requested PoolId. This is a hash identity: no registry or provider
//      can make a wrong key pass. The requested token must be currency0 or currency1 of that key.
//   3. State: slot0 (price, tick, protocol fee, LP fee), active liquidity, tick bitmap and liquidityNet are read
//      through StateView and replayed with the same integer mathematics as v3 (v4 keeps TickMath/SwapMath/TickBitmap).
//      Swap fee = protocolFee + lpFee - protocolFee*lpFee/1e6 for the swap direction, as in ProtocolFeeLibrary.
//   4. Model review: amountOut must equal the official v4 Quoter, which executes the real PoolManager swap INCLUDING
//      the pool's hooks. A hook that changes swap amounts or fees therefore cannot pass: with swap-affecting hook
//      permissions the refusal is V4_HOOK_ALTERS_SWAP (unsupported), otherwise QUOTE_MODEL_MISMATCH.
//   5. Independent provider: same block hash, slot0 and liquidity, or the result stays single-source.
// Bounded like v3 (bitmap words / tick reads); sizes beyond the bound are REFUSED with no estimate. Read-only.
const keccak=require('./keccak');
const {chain,rpcUrl}=require('../search/server/lib/chains');
const {addressWord}=require('./liquidity-v2-reserves');
const v2=require('./liquidity-exit-v2'),v3=require('./liquidity-exit-v3');
const {transport,fail,pad,sel}=v2.internals,{words,int,encodeInt,sharePpm}=v3.internals,{math}=v3;

const ADDRESS=/^0x[0-9a-f]{40}$/i,POOL_ID=/^0x[0-9a-f]{64}$/i,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,HASH=/^0x[0-9a-f]{64}$/i;
const Q96=1n<<96n,Q128=1n<<128n,PIPS=1000000n,DYNAMIC_FEE_FLAG=0x800000,REFERENCE='https://developers.uniswap.org/docs/protocols/v4/deployments';
const SELECTORS=Object.freeze({poolKeys:sel('poolKeys(bytes25)'),getSlot0:sel('getSlot0(bytes32)'),getLiquidity:sel('getLiquidity(bytes32)'),
 getTickBitmap:sel('getTickBitmap(bytes32,int16)'),getTickLiquidity:sel('getTickLiquidity(bytes32,int24)'),poolManager:sel('poolManager()'),
 quoteExactInputSingle:sel('quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))')});
// Official Uniswap v4 deployments (developers.uniswap.org/docs/protocols/v4/deployments; chain 4663 also in
// github.com/Uniswap/contracts deployments/4663.md). Arc PoolManager / PositionManager match lib/lp-positions.js.
const DEPLOYMENTS=Object.freeze({
 arc:Object.freeze({id:'uniswap-v4',label:'Uniswap v4',poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',stateView:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  quoter:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',positionManager:'0x6049c9a0e26405c0985f9e3685c87d0ae917f82b',paceMs:120,reference:REFERENCE}),
 robinhood:Object.freeze({id:'uniswap-v4',label:'Uniswap v4',poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',stateView:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  quoter:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',positionManager:'0x58daec3116aae6d93017baaea7749052e8a04fa7',paceMs:0,reference:REFERENCE})
});
const deployment=network=>DEPLOYMENTS[chain(network).id]||null;

// Hook permissions are the low 14 bits of the hook address (Hooks.sol).
const HOOK_FLAGS=Object.freeze({beforeSwap:1<<7,afterSwap:1<<6,beforeSwapReturnsDelta:1<<3,afterSwapReturnsDelta:1<<2});
function hookInfo(hooks){
 const bits=Number(BigInt(hooks)&0x3fffn),swap=Object.entries(HOOK_FLAGS).filter(([,bit])=>bits&bit).map(([name])=>name);
 return {address:hooks,present:!/^0x0{40}$/.test(hooks),permissionBits:bits,swapPermissions:swap};
}
function poolId(keyWords){return keccak(Buffer.from(keyWords.join(''),'hex'));}
// ProtocolFeeLibrary: direction-specific 12-bit protocol fee, combined with the LP fee and rounded up.
function swapFee(protocolFee,lpFee,zeroForOne){
 const pf=BigInt(zeroForOne?protocolFee&0xfff:(protocolFee>>12)&0xfff),lp=BigInt(lpFee);
 return {protocolFeePips:Number(pf),swapFeePips:Number(pf+lp-pf*lp/PIPS)};
}
const quoterData=(keyWords,zeroForOne,amountIn)=>SELECTORS.quoteExactInputSingle+(32).toString(16).padStart(64,'0')+keyWords.join('')+
 (zeroForOne?1:0).toString(16).padStart(64,'0')+amountIn.toString(16).padStart(64,'0')+(256).toString(16).padStart(64,'0')+'0'.repeat(64);
function decodeSlot0(raw){
 const w=words(raw);if(w.length<4)throw fail('RPC_MALFORMED_RESPONSE');
 return {sqrtPriceX96:BigInt('0x'+w[0]),tick:Number(int(w[1],24)),protocolFee:Number(BigInt('0x'+w[2])&0xffffffn),lpFee:Number(BigInt('0x'+w[3])&0xffffffn)};
}

async function analyze({network,pool,tokenIn,amountsIn,fetcher=fetch,env=process.env,now=Date.now,timeoutMs=4000,deadlineMs=20000,confirmations=2,maxHeadAgeSeconds=900,pinnedBlock,sleep}={}){
 const cfg=chain(network);
 if(!POOL_ID.test(pool||'')||!ADDRESS.test(tokenIn||''))throw fail('INVALID_ADDRESS');
 let requested=null;
 if(amountsIn!==undefined&&amountsIn!==null){
  if(!Array.isArray(amountsIn)||!amountsIn.length||amountsIn.length>v3.MAX_QUOTES)throw fail('INVALID_AMOUNT_IN');
  requested=amountsIn.map(v=>{if(typeof v!=='string'||!/^[1-9][0-9]*$/.test(v)||v.length>78)throw fail('INVALID_AMOUNT_IN');return BigInt(v);});
 }
 const dep=deployment(cfg.id);
 if(!dep)throw fail('NO_REVIEWED_PROTOCOL');
 const started=now(),deadlineAt=started+deadlineMs,id=pool.toLowerCase(),input=tokenIn.toLowerCase();
 const primary=transport({url:rpcUrl(cfg.id,env),fetcher,timeoutMs,budget:{used:0,max:84},deadlineAt,now,paceMs:dep.paceMs,retries:2,sleep});

 const chainId=await primary.rpc('eth_chainId',[]);
 if(!QUANTITY.test(chainId||'')||Number(BigInt(chainId))!==cfg.chainId)throw fail('RPC_CHAIN_ID_MISMATCH');
 const head=await primary.rpc('eth_blockNumber',[]);
 if(!QUANTITY.test(head||''))throw fail('RPC_MALFORMED_RESPONSE');
 if(pinnedBlock!==undefined&&(!Number.isSafeInteger(pinnedBlock)||pinnedBlock<=0||BigInt(pinnedBlock)>BigInt(head)))throw fail('INVALID_PINNED_BLOCK');
 const pinned=pinnedBlock!==undefined?BigInt(pinnedBlock):BigInt(head)-BigInt(confirmations);
 if(pinned<=0n)throw fail('RPC_MALFORMED_RESPONSE');
 const block='0x'+pinned.toString(16);
 const header=await primary.rpc('eth_getBlockByNumber',[block,false]);
 if(!header||!HASH.test(header.hash||'')||!QUANTITY.test(header.timestamp||'')||header.number?.toLowerCase()!==block)throw fail('RPC_MALFORMED_RESPONSE');
 const blockTimestamp=Number(BigInt(header.timestamp));
 const call=(to,data)=>primary.rpc('eth_call',[{to,data},block]);

 // 1. Deployment consistency: the lens and the quoter must be bound to the reviewed PoolManager.
 for(const contract of [dep.poolManager,dep.stateView,dep.quoter,dep.positionManager]){
  const code=await primary.rpc('eth_getCode',[contract,block]);
  if(typeof code!=='string'||!/^0x[0-9a-f]*$/i.test(code))throw fail('RPC_MALFORMED_RESPONSE');
  if(code==='0x')throw fail('V4_DEPLOYMENT_INCONSISTENT');
 }
 for(const contract of [dep.stateView,dep.quoter]){
  let bound;try{bound=addressWord(await call(contract,SELECTORS.poolManager));}catch(e){throw e.code&&e.code!=='CALL_REVERTED'?e:fail('V4_DEPLOYMENT_INCONSISTENT');}
  if(bound!==dep.poolManager)throw fail('V4_DEPLOYMENT_INCONSISTENT');
 }
 // 2. Pool identity by hash.
 let keyWords;
 try{keyWords=words(await call(dep.positionManager,SELECTORS.poolKeys+id.slice(2,52).padEnd(64,'0')));}
 catch(e){throw e.code&&e.code!=='CALL_REVERTED'&&e.code!=='RPC_MALFORMED_RESPONSE'?e:fail('V4_POOL_KEY_UNAVAILABLE');}
 if(keyWords.length!==5)throw fail('V4_POOL_KEY_UNAVAILABLE');
 if(keyWords.every(w=>/^0+$/.test(w)))throw fail('V4_POOL_KEY_UNAVAILABLE');
 let currency0,currency1,hooks;
 try{currency0=addressWord('0x'+keyWords[0]);currency1=addressWord('0x'+keyWords[1]);hooks=addressWord('0x'+keyWords[4]);}catch{throw fail('V4_POOL_KEY_UNAVAILABLE');}
 const keyFee=Number(BigInt('0x'+keyWords[2])),tickSpacing=Number(int(keyWords[3],24));
 if(poolId(keyWords)!==id)throw fail('V4_POOL_ID_MISMATCH');
 if(BigInt(currency0)>=BigInt(currency1)||tickSpacing<=0||tickSpacing>32767)throw fail('V4_POOL_KEY_UNAVAILABLE');
 if(input!==currency0&&input!==currency1)throw fail('TOKEN_NOT_IN_POOL');
 const zeroForOne=input===currency0,tokenOut=zeroForOne?currency1:currency0,hook=hookInfo(hooks);

 // 3. State.
 const slot0=decodeSlot0(await call(dep.stateView,SELECTORS.getSlot0+id.slice(2)));
 if(slot0.sqrtPriceX96===0n)throw fail('V4_POOL_NOT_INITIALIZED');
 if(slot0.sqrtPriceX96<math.MIN_SQRT_RATIO||slot0.sqrtPriceX96>=math.MAX_SQRT_RATIO||slot0.tick<math.MIN_TICK||slot0.tick>math.MAX_TICK)throw fail('RPC_MALFORMED_RESPONSE');
 const liquidity=BigInt('0x'+words(await call(dep.stateView,SELECTORS.getLiquidity+id.slice(2)))[0]);
 if(liquidity>=Q128)throw fail('RPC_MALFORMED_RESPONSE');
 if(liquidity===0n)throw fail('V3_NO_ACTIVE_LIQUIDITY');
 const fee=swapFee(slot0.protocolFee,slot0.lpFee,zeroForOne);
 if(fee.swapFeePips>=1000000)throw fail('QUOTE_UNAVAILABLE');

 const bitmapCache=new Map(),tickCache=new Map();
 const reads={
  bitmap:async wordPos=>{
   if(wordPos<-32768||wordPos>32767)return 0n;
   if(!bitmapCache.has(wordPos)){
    if(bitmapCache.size>=v3.MAX_WORDS)throw fail('V3_DEPTH_BUDGET_EXCEEDED');
    bitmapCache.set(wordPos,BigInt('0x'+words(await call(dep.stateView,SELECTORS.getTickBitmap+id.slice(2)+encodeInt(wordPos)))[0]));
   }
   return bitmapCache.get(wordPos);
  },
  liquidityNet:async tick=>{
   if(!tickCache.has(tick)){
    if(tickCache.size>=v3.MAX_TICKS)throw fail('V3_DEPTH_BUDGET_EXCEEDED');
    const w=words(await call(dep.stateView,SELECTORS.getTickLiquidity+id.slice(2)+encodeInt(tick)));
    if(w.length<2)throw fail('RPC_MALFORMED_RESPONSE');
    tickCache.set(tick,int(w[1],128));
   }
   return tickCache.get(tick);
  }
 };
 const virtualIn=zeroForOne?(liquidity<<96n)/slot0.sqrtPriceX96:liquidity*slot0.sqrtPriceX96/Q96;
 const amounts=requested||v3.DEFAULT_LADDER_BPS.map(bps=>virtualIn*BigInt(bps)/10000n).filter(v=>v>0n);
 if(!amounts.length)throw fail('V3_NO_ACTIVE_LIQUIDITY');
 const quotes=[],REFUSABLE=new Set(['V3_DEPTH_BUDGET_EXCEEDED','V3_INSUFFICIENT_LIQUIDITY','V4_AMOUNT_TOO_LARGE']);let refusedBy=null;
 for(const amountIn of [...amounts].sort((a,b)=>a<b?-1:a>b?1:0)){
  if(refusedBy){quotes.push({amountIn:amountIn.toString(),state:'REFUSED',reasonCode:refusedBy,amountOut:null});continue;}
  let result;
  try{
   if(amountIn>=Q128)throw fail('V4_AMOUNT_TOO_LARGE');
   result=await math.simulate({state:{sqrtPriceX96:slot0.sqrtPriceX96,tick:slot0.tick,liquidity},amountIn,zeroForOne,feePips:BigInt(fee.swapFeePips),tickSpacing,reads});
  }catch(e){if(!REFUSABLE.has(e.code))throw e;refusedBy=e.code;quotes.push({amountIn:amountIn.toString(),state:'REFUSED',reasonCode:e.code,amountOut:null});continue;}
  if(result.amountOut<=0n)throw fail('QUOTE_UNAVAILABLE');
  // 4. The official Quoter runs the real swap, hooks included. Equality is the only accepted outcome.
  let quoted;
  try{const w=words(await call(dep.quoter,quoterData(keyWords,zeroForOne,amountIn)));if(w.length<2)throw fail('QUOTER_RESPONSE_INVALID');quoted=BigInt('0x'+w[0]);}
  catch(e){if(e.code!=='CALL_REVERTED')throw e;throw hook.swapPermissions.length?fail('V4_HOOK_ALTERS_SWAP',{detail:'QUOTER_REVERTED'}):fail('QUOTE_MODEL_MISMATCH',{detail:'QUOTER_REVERTED'});}
  if(quoted!==result.amountOut)throw hook.swapPermissions.length?fail('V4_HOOK_ALTERS_SWAP'):fail('QUOTE_MODEL_MISMATCH');
  quotes.push({amountIn:amountIn.toString(),state:'VERIFIED',amountOut:result.amountOut.toString(),feePips:fee.swapFeePips,
   ...math.metrics({amountIn,amountOut:result.amountOut,sqrtPriceX96:slot0.sqrtPriceX96,zeroForOne,feePips:fee.swapFeePips}),
   shareOfActiveVirtualReservePpm:sharePpm(amountIn,virtualIn),sqrtPriceX96After:result.sqrtPriceX96After.toString(),
   initializedTicksCrossed:result.initializedTicksCrossed,quoterAmountOut:quoted.toString(),quoterMatch:true});
 }
 if(!quotes.some(q=>q.state==='VERIFIED'))throw fail(refusedBy||'QUOTE_UNAVAILABLE');
 const recheck=await primary.rpc('eth_getBlockByNumber',[block,false]);
 if(recheck?.hash!==header.hash)throw fail('PINNED_BLOCK_CHANGED');

 // 5. Independent provider.
 let crossCheck={state:'NOT_CONFIGURED',reasonCode:'NO_INDEPENDENT_ENDPOINT'},secondaryCost={rpcCalls:0,retries:0};
 const secondUrl=v2.crossCheckUrl(cfg.id,env);
 if(secondUrl){
  const secondary=transport({url:secondUrl,fetcher,timeoutMs,budget:{used:0,max:5},deadlineAt,now,retries:0,sleep});
  secondaryCost=secondary.cost;let observed;
  try{
   const otherChain=await secondary.rpc('eth_chainId',[]);
   if(!QUANTITY.test(otherChain||'')||Number(BigInt(otherChain))!==cfg.chainId)throw fail('RPC_CHAIN_ID_MISMATCH');
   const otherHeader=await secondary.rpc('eth_getBlockByNumber',[block,false]);
   if(!otherHeader||!HASH.test(otherHeader.hash||''))throw fail('CROSSCHECK_BLOCK_UNAVAILABLE');
   observed={hash:otherHeader.hash.toLowerCase(),slot0:decodeSlot0(await secondary.rpc('eth_call',[{to:dep.stateView,data:SELECTORS.getSlot0+id.slice(2)},block])),
    liquidity:BigInt('0x'+words(await secondary.rpc('eth_call',[{to:dep.stateView,data:SELECTORS.getLiquidity+id.slice(2)},block]))[0])};
  }catch(e){crossCheck={state:'UNAVAILABLE',reasonCode:e.code||'CROSSCHECK_FAILED'};}
  if(observed){
   if(observed.hash!==header.hash.toLowerCase()||observed.slot0.sqrtPriceX96!==slot0.sqrtPriceX96||observed.slot0.tick!==slot0.tick||observed.slot0.lpFee!==slot0.lpFee||
    observed.slot0.protocolFee!==slot0.protocolFee||observed.liquidity!==liquidity)throw fail('RPC_DISAGREEMENT');
   crossCheck={state:'AGREED',reasonCode:null,compared:['blockHash','sqrtPriceX96','tick','lpFee','protocolFee','liquidity']};
  }
 }
 const headAgeSeconds=Math.max(0,Math.floor(now()/1000)-blockTimestamp);
 return {
  status:'VERIFIED_POOL_MODEL',model:'UNISWAP_V4_EXACT_INPUT_TICK_REPLAY',network:cfg.id,chainId:cfg.chainId,
  pool:{poolId:id,protocol:dep.id,protocolLabel:dep.label,poolManager:dep.poolManager,stateView:dep.stateView,quoter:dep.quoter,positionManager:dep.positionManager,
   deploymentReference:dep.reference,currency0,currency1,keyFee,dynamicFee:keyFee===DYNAMIC_FEE_FLAG,tickSpacing,hooks:hook,
   lpFeePips:slot0.lpFee,protocolFeePips:fee.protocolFeePips,feePips:fee.swapFeePips,feeBps:fee.swapFeePips/100,feeEvidence:'ONCHAIN_SLOT0_AT_PINNED_BLOCK',
   identity:{verified:true,method:'keccak256(abi.encode(PoolKey from PositionManager.poolKeys)) equals the requested PoolId; StateView and Quoter are bound to the reviewed PoolManager'}},
  block:{number:Number(pinned),hex:block,hash:header.hash.toLowerCase(),timestamp:blockTimestamp,ageSeconds:headAgeSeconds,confirmations,
   freshness:headAgeSeconds>maxHeadAgeSeconds?'STALE_HEAD':'CURRENT'},
  state:{sqrtPriceX96:slot0.sqrtPriceX96.toString(),tick:slot0.tick,activeLiquidity:liquidity.toString(),
   activeVirtualReserveIn:virtualIn.toString(),bitmapWordsRead:bitmapCache.size,ticksRead:tickCache.size},
  tokenIn:input,tokenOut,ladder:requested?'CALLER_SUPPLIED':'DEFAULT_SHARE_OF_ACTIVE_VIRTUAL_RESERVE_BPS_'+v3.DEFAULT_LADDER_BPS.join('_'),quotes,
  evidence:{class:crossCheck.state==='AGREED'?'INDEPENDENTLY_CROSS_CHECKED':'SINGLE_SOURCE_ONCHAIN',crossCheck,
   modelReview:'Every VERIFIED quote equals the official v4 Quoter (real PoolManager swap, hooks included) at the same pinned block. REFUSED sizes carry no estimate.',
   scope:'One pool, one block. Pool identity is a hash check; price, fees, active liquidity, tick bitmap and crossed ticks are on-chain reads.'},
  cost:{rpcCalls:primary.cost.rpcCalls+secondaryCost.rpcCalls,primaryCalls:primary.cost.rpcCalls,crossCheckCalls:secondaryCost.rpcCalls,
   retries:primary.cost.retries+secondaryCost.retries,ms:now()-started},
  limitations:Object.freeze([
   'MODEL_ONLY: an exact-input replay of one v4 pool at one block; not executable exit liquidity and not a trade guarantee.',
   'HOOKS: a quote exists only because the hooked swap equalled the hook-free model at this block; a hook can behave differently for another size, sender or block.',
   'TOKEN_TRANSFER_TAX_NOT_MODELLED: fee-on-transfer, blacklist, pause or trading restrictions of either token are not included.',
   'GAS_AND_MEV_NOT_MODELLED: transaction cost, sandwiching and ordering are not included.',
   'SINGLE_POOL: other pools and multi-hop or cross-pool routes are not combined; pool balances are not exit liquidity.',
   'STATE_MOVES: price, fees and in-range liquidity change every block; the quote is valid only for the recorded block.'])
 };
}
module.exports={analyze,deployment,DEPLOYMENTS,SELECTORS,poolId,swapFee,hookInfo,quoterData};
