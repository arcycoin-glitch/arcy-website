'use strict';
// Liquidity & Exit V2 — verified single-pool Uniswap-V3 concentrated-liquidity exit model.
//
// Replays UniswapV3Pool.swap (exact input, no price limit) off-chain with the pool's own integer mathematics
// (TickMath, SqrtPriceMath, SwapMath, TickBitmap) against state read at ONE pinned block:
//   slot0 (current price and tick), active liquidity, the tick bitmap words on the swap path and liquidityNet of
//   every initialized tick that is crossed.
// Verification, all at the same block:
//   1. Pool identity: pool.factory() is a reviewed factory AND factory.getPool(token0,token1,fee) == pool.
//      The fee is the pool's own immutable, confirmed by that factory lookup.
//   2. Model review: amountOut AND the post-swap sqrt price must equal the reviewed QuoterV2 (which executes the
//      real pool code). Any difference fails closed (QUOTE_MODEL_MISMATCH).
//   3. Independent provider: a second RPC must return the same block hash, slot0 price/tick and liquidity.
// Bounded: at most MAX_WORDS bitmap words and MAX_TICKS tick reads per analysis. A size that needs more is
// refused individually (V3_DEPTH_BUDGET_EXCEEDED) while smaller sizes of the same ladder stay verified — a partial
// walk is never reported as a quote. If no size can be verified the whole analysis fails with that reason.
// Read-only, fail closed, single pool. A quote is a model at one block, not executable exit liquidity.
const {chain,rpcUrl}=require('../search/server/lib/chains');
const {addressWord}=require('./liquidity-v2-reserves');
const v2=require('./liquidity-exit-v2');
const {transport,fail,pad,sel}=v2.internals;

const ADDRESS=/^0x[0-9a-f]{40}$/i,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,HASH=/^0x[0-9a-f]{64}$/i;
const Q96=1n<<96n,Q128=1n<<128n,Q160=1n<<160n,Q256=1n<<256n,MAX_UINT256=Q256-1n,PIPS=1000000n,PPM=1000000n;
const MIN_TICK=-887272,MAX_TICK=887272,MIN_SQRT_RATIO=4295128739n,MAX_SQRT_RATIO=1461446703485210103287273052203988822378723970342n;
const MAX_WORDS=8,MAX_TICKS=32,MAX_QUOTES=4,DEFAULT_LADDER_BPS=Object.freeze([10,100,500]);
const SELECTORS=Object.freeze({token0:sel('token0()'),token1:sel('token1()'),fee:sel('fee()'),tickSpacing:sel('tickSpacing()'),
 slot0:sel('slot0()'),liquidity:sel('liquidity()'),factory:sel('factory()'),tickBitmap:sel('tickBitmap(int16)'),ticks:sel('ticks(int24)'),
 getPool:sel('getPool(address,address,uint24)'),quoteExactInputSingle:sel('quoteExactInputSingle((address,address,uint256,uint24,uint160))')});

// Reviewed protocol registry (see scripts/probe-liquidity-exit-v3.cjs for the live evidence behind each entry).
// Robinhood pools report factories 0x1f7d7550… (listed as "uniswap v3") and 0xe0c4ceb9… (listed as "ramses v3");
// neither has been confirmed from a primary source, so Robinhood stays unsupported. Arc liquidity is Uniswap v4.
const PROTOCOLS=Object.freeze({
 ethereum:Object.freeze([Object.freeze({id:'uniswap-v3',label:'Uniswap V3',factory:'0x1f98431c8ad98523631ae4a59f267346ea31f984',
  quoter:'0x61ffe014ba17989e743c5f6cb21bf9697530b21e',
  review:'Canonical UniswapV3Factory and QuoterV2 mainnet deployments (protocol documentation).'})]),
 arc:Object.freeze([]),robinhood:Object.freeze([])
});
const protocols=network=>PROTOCOLS[chain(network).id]||[];

// ---- Uniswap V3 integer mathematics (exact ports; BigInt, with uint256 overflow branches reproduced) ----
const mulDiv=(a,b,d)=>a*b/d;
const mulDivUp=(a,b,d)=>{const p=a*b;return p/d+(p%d===0n?0n:1n);};
const divUp=(a,d)=>a/d+(a%d===0n?0n:1n);
const TICK_FACTORS=[0xfff97272373d413259a46990580e213an,0xfff2e50f5f656932ef12357cf3c7fdccn,0xffe5caca7e10e4e61c3624eaa0941cd0n,
 0xffcb9843d60f6159c9db58835c926644n,0xff973b41fa98c081472e6896dfb254c0n,0xff2ea16466c96a3843ec78b326b52861n,0xfe5dee046a99a2a811c461f1969c3053n,
 0xfcbe86c7900a88aedcffc83b479aa3a4n,0xf987a7253ac413176f2b074cf7815e54n,0xf3392b0822b70005940c7a398e4b70f3n,0xe7159475a2c29b7443b29c7fa6e889d9n,
 0xd097f3bdfd2022b8845ad8f792aa5825n,0xa9f746462d870fdf8a65dc1f90e061e5n,0x70d869a156d2a1b890bb3df62baf32f7n,0x31be135f97d08fd981231505542fcfa6n,
 0x9aa508b5b7a84e1c677de54f3e99bc9n,0x5d6af8dedb81196699c329225ee604n,0x2216e584f5fa1ea926041bedfe98n,0x48a170391f7dc42444e8fa2n];
function getSqrtRatioAtTick(tick){
 if(!Number.isInteger(tick)||tick<MIN_TICK||tick>MAX_TICK)throw fail('V3_TICK_OUT_OF_RANGE');
 const abs=Math.abs(tick);
 let ratio=abs&1?0xfffcb933bd6fad37aa2d162d1a594001n:Q128;
 for(let i=0;i<TICK_FACTORS.length;i++)if(abs&(2<<i))ratio=(ratio*TICK_FACTORS[i])>>128n;
 if(tick>0)ratio=MAX_UINT256/ratio;
 return (ratio>>32n)+(ratio%(1n<<32n)===0n?0n:1n);
}
function getAmount0Delta(a,b,liquidity,roundUp){
 if(a>b)[a,b]=[b,a];
 if(a<=0n)throw fail('V3_INVALID_PRICE');
 const numerator1=liquidity<<96n,numerator2=b-a;
 return roundUp?divUp(mulDivUp(numerator1,numerator2,b),a):mulDiv(numerator1,numerator2,b)/a;
}
function getAmount1Delta(a,b,liquidity,roundUp){
 if(a>b)[a,b]=[b,a];
 return roundUp?mulDivUp(liquidity,b-a,Q96):mulDiv(liquidity,b-a,Q96);
}
function getNextSqrtPriceFromInput(sqrtP,liquidity,amountIn,zeroForOne){
 if(sqrtP<=0n||liquidity<=0n)throw fail('V3_NO_ACTIVE_LIQUIDITY');
 if(zeroForOne){
  if(amountIn===0n)return sqrtP;
  const numerator1=liquidity<<96n,product=amountIn*sqrtP;
  // Solidity: use the precise form unless amount*sqrtP or the denominator overflows uint256.
  if(product<Q256&&numerator1+product<Q256)return mulDivUp(numerator1,sqrtP,numerator1+product);
  return divUp(numerator1,numerator1/sqrtP+amountIn);
 }
 const next=sqrtP+(amountIn<<96n)/liquidity;
 if(next>=Q160)throw fail('V3_INVALID_PRICE');
 return next;
}
function computeSwapStep(current,target,liquidity,amountRemaining,feePips){
 const zeroForOne=current>=target,lessFee=mulDiv(amountRemaining,PIPS-feePips,PIPS);
 let amountIn=zeroForOne?getAmount0Delta(target,current,liquidity,true):getAmount1Delta(current,target,liquidity,true);
 const next=lessFee>=amountIn?target:getNextSqrtPriceFromInput(current,liquidity,lessFee,zeroForOne),max=next===target;
 let amountOut;
 if(zeroForOne){if(!max)amountIn=getAmount0Delta(next,current,liquidity,true);amountOut=getAmount1Delta(next,current,liquidity,false);}
 else{if(!max)amountIn=getAmount1Delta(current,next,liquidity,true);amountOut=getAmount0Delta(current,next,liquidity,false);}
 const feeAmount=next!==target?amountRemaining-amountIn:mulDivUp(amountIn,feePips,PIPS-feePips);
 return {next,amountIn,amountOut,feeAmount};
}
const floorDiv=(a,b)=>Math.floor(a/b);
function msb(x){let r=0n;while(x>1n){x>>=1n;r++;}return Number(r);}
function lsb(x){let r=0;while((x&1n)===0n){x>>=1n;r++;}return r;}
// TickBitmap.nextInitializedTickWithinOneWord. bitmap(wordPos) -> uint256 as BigInt.
async function nextInitializedTick(bitmap,tick,spacing,lte){
 let compressed=floorDiv(tick,spacing);
 if(lte){
  const wordPos=compressed>>8,bitPos=((compressed%256)+256)%256;
  const masked=(await bitmap(wordPos))&((1n<<BigInt(bitPos))-1n+(1n<<BigInt(bitPos)));
  return masked!==0n?{tick:(compressed-(bitPos-msb(masked)))*spacing,initialized:true}:{tick:(compressed-bitPos)*spacing,initialized:false};
 }
 compressed+=1;
 const wordPos=compressed>>8,bitPos=((compressed%256)+256)%256;
 const masked=(await bitmap(wordPos))&(MAX_UINT256^((1n<<BigInt(bitPos))-1n));
 return masked!==0n?{tick:(compressed+(lsb(masked)-bitPos))*spacing,initialized:true}:{tick:(compressed+(255-bitPos))*spacing,initialized:false};
}
// Exact-input swap replay. state: {sqrtPriceX96,tick,liquidity}; reads: {bitmap(wordPos),liquidityNet(tick)}.
async function simulate({state,amountIn,zeroForOne,feePips,tickSpacing,reads}){
 const limit=zeroForOne?MIN_SQRT_RATIO+1n:MAX_SQRT_RATIO-1n;
 let remaining=amountIn,out=0n,sqrtPrice=state.sqrtPriceX96,tick=state.tick,liquidity=state.liquidity,crossed=0,steps=0,feePaid=0n;
 while(remaining!==0n&&sqrtPrice!==limit){
  if(++steps>MAX_WORDS+MAX_TICKS)throw fail('V3_DEPTH_BUDGET_EXCEEDED');
  const found=await nextInitializedTick(reads.bitmap,tick,tickSpacing,zeroForOne);
  const tickNext=Math.max(MIN_TICK,Math.min(MAX_TICK,found.tick)),sqrtNext=getSqrtRatioAtTick(tickNext);
  const target=(zeroForOne?sqrtNext<limit:sqrtNext>limit)?limit:sqrtNext;
  const step=computeSwapStep(sqrtPrice,target,liquidity,remaining,feePips);
  sqrtPrice=step.next;remaining-=step.amountIn+step.feeAmount;out+=step.amountOut;feePaid+=step.feeAmount;
  if(sqrtPrice===sqrtNext){
   if(found.initialized){
    let net=await reads.liquidityNet(tickNext);
    if(zeroForOne)net=-net;
    liquidity+=net;crossed++;
    if(liquidity<0n)throw fail('V3_STATE_INCONSISTENT');
   }
   tick=zeroForOne?tickNext-1:tickNext;
  }
 }
 // The price limit was reached before the whole input was absorbed: the pool cannot take this size.
 if(remaining!==0n)throw fail('V3_INSUFFICIENT_LIQUIDITY');
 return {amountOut:out,sqrtPriceX96After:sqrtPrice,initializedTicksCrossed:crossed,feePaid,liquidityAfter:liquidity};
}

const int=(hex,bits)=>{const v=BigInt('0x'+hex),m=1n<<BigInt(bits),t=v&(m-1n);return t>=m>>1n?t-m:t;};
const words=raw=>{if(typeof raw!=='string'||!/^0x(?:[0-9a-f]{64})+$/i.test(raw))throw fail('RPC_MALFORMED_RESPONSE');const out=[];for(let i=2;i<raw.length;i+=64)out.push(raw.slice(i,i+64));return out;};
const encodeInt=(value,bits)=>(value<0?(1n<<256n)+BigInt(value):BigInt(value)).toString(16).padStart(64,'0');
function decodeSlot0(raw){const w=words(raw);if(w.length<7)throw fail('RPC_MALFORMED_RESPONSE');const sqrtPriceX96=BigInt('0x'+w[0]);if(sqrtPriceX96>=Q160)throw fail('RPC_MALFORMED_RESPONSE');return {sqrtPriceX96,tick:Number(int(w[1],24))};}
const quoterData=(tokenIn,tokenOut,amountIn,fee)=>SELECTORS.quoteExactInputSingle+pad(tokenIn)+pad(tokenOut)+amountIn.toString(16).padStart(64,'0')+fee.toString(16).padStart(64,'0')+'0'.repeat(64);

// Ratios in parts per million, rounded against the seller. mid price from sqrtPriceX96 (token1 per token0 = P = s^2/2^192).
function metrics({amountIn,amountOut,sqrtPriceX96,zeroForOne,feePips}){
 const s2=sqrtPriceX96*sqrtPriceX96,Q192=1n<<192n;
 // idealOut = amountIn * num / den
 const [num,den]=zeroForOne?[s2,Q192]:[Q192,s2];
 const idealNum=amountIn*num; // idealOut = idealNum/den
 const ceil=(n,d)=>n<=0n?0n:(n+d-1n)/d;
 const total=ceil((idealNum-amountOut*den)*PPM,idealNum);
 const feeOnlyNum=idealNum*(PIPS-BigInt(feePips)); // feeOnlyOut = feeOnlyNum/(den*PIPS)
 const impact=ceil((feeOnlyNum-amountOut*den*PIPS)*PPM,feeOnlyNum);
 return {totalVsMidPpm:Number(total),priceImpactPpm:Number(impact),feePpm:feePips};
}

const sharePpm=(amountIn,virtualIn)=>{const v=(amountIn*PPM+virtualIn-1n)/virtualIn;return v>BigInt(Number.MAX_SAFE_INTEGER)?Number.MAX_SAFE_INTEGER:Number(v);};

async function analyze({network,pool,tokenIn,amountsIn,fetcher=fetch,env=process.env,now=Date.now,timeoutMs=4000,deadlineMs=15000,confirmations=2,maxHeadAgeSeconds=900,pinnedBlock,sleep}={}){
 const cfg=chain(network);
 if(!ADDRESS.test(pool||'')||!ADDRESS.test(tokenIn||''))throw fail('INVALID_ADDRESS');
 let requested=null;
 if(amountsIn!==undefined&&amountsIn!==null){
  if(!Array.isArray(amountsIn)||!amountsIn.length||amountsIn.length>MAX_QUOTES)throw fail('INVALID_AMOUNT_IN');
  requested=amountsIn.map(v=>{if(typeof v!=='string'||!/^[1-9][0-9]*$/.test(v)||v.length>78)throw fail('INVALID_AMOUNT_IN');return BigInt(v);});
 }
 const reviewed=protocols(cfg.id);
 if(!reviewed.length)throw fail('NO_REVIEWED_PROTOCOL');
 const started=now(),deadlineAt=started+deadlineMs,address=pool.toLowerCase(),input=tokenIn.toLowerCase();
 const primary=transport({url:rpcUrl(cfg.id,env),fetcher,timeoutMs,budget:{used:0,max:80},deadlineAt,now,sleep});

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
 const code=await primary.rpc('eth_getCode',[address,block]);
 if(typeof code!=='string'||!/^0x[0-9a-f]*$/i.test(code))throw fail('RPC_MALFORMED_RESPONSE');
 if(code==='0x')throw fail('POOL_HAS_NO_CODE');
 const call=(to,data)=>primary.rpc('eth_call',[{to,data},block]);

 let token0,token1,feePips,tickSpacing,slot0,liquidity,poolFactory;
 try{
  token0=addressWord(await call(address,SELECTORS.token0));token1=addressWord(await call(address,SELECTORS.token1));
  poolFactory=addressWord(await call(address,SELECTORS.factory));
  feePips=Number(BigInt('0x'+words(await call(address,SELECTORS.fee))[0]));
  tickSpacing=Number(int(words(await call(address,SELECTORS.tickSpacing))[0],24));
  slot0=decodeSlot0(await call(address,SELECTORS.slot0));
  liquidity=BigInt('0x'+words(await call(address,SELECTORS.liquidity))[0]);
 }catch(e){throw e.code&&e.code!=='CALL_REVERTED'&&e.code!=='RPC_MALFORMED_RESPONSE'?e:fail('NOT_V3_COMPATIBLE_POOL');}
 if(token0===token1)throw fail('INVALID_POOL_TOKEN_PAIR');
 if(!Number.isInteger(feePips)||feePips<0||feePips>=1000000||!Number.isInteger(tickSpacing)||tickSpacing<=0||tickSpacing>16384||liquidity>=Q128)throw fail('NOT_V3_COMPATIBLE_POOL');
 if(slot0.sqrtPriceX96<MIN_SQRT_RATIO||slot0.sqrtPriceX96>=MAX_SQRT_RATIO||slot0.tick<MIN_TICK||slot0.tick>MAX_TICK)throw fail('NOT_V3_COMPATIBLE_POOL');
 if(input!==token0&&input!==token1)throw fail('TOKEN_NOT_IN_POOL');
 const protocol=reviewed.find(p=>p.factory===poolFactory);
 if(!protocol)throw fail('FACTORY_NOT_REVIEWED',{observedFactory:poolFactory});
 let registered;
 try{registered=addressWord(await call(protocol.factory,SELECTORS.getPool+pad(token0)+pad(token1)+feePips.toString(16).padStart(64,'0')));}
 catch(e){throw e.code==='CALL_REVERTED'||!e.code?fail('POOL_NOT_REGISTERED_BY_FACTORY'):e;}
 if(registered!==address)throw fail('POOL_NOT_REGISTERED_BY_FACTORY',{observedFactory:poolFactory});
 if(liquidity===0n)throw fail('V3_NO_ACTIVE_LIQUIDITY');

 const zeroForOne=input===token0,tokenOut=zeroForOne?token1:token0;
 // Bounded, memoised state reads shared by every quote of this analysis.
 const bitmapCache=new Map(),tickCache=new Map();
 const reads={
  bitmap:async wordPos=>{
   if(wordPos<-32768||wordPos>32767)return 0n;
   if(!bitmapCache.has(wordPos)){
    if(bitmapCache.size>=MAX_WORDS)throw fail('V3_DEPTH_BUDGET_EXCEEDED');
    bitmapCache.set(wordPos,BigInt('0x'+words(await call(address,SELECTORS.tickBitmap+encodeInt(wordPos)))[0]));
   }
   return bitmapCache.get(wordPos);
  },
  liquidityNet:async tick=>{
   if(!tickCache.has(tick)){
    if(tickCache.size>=MAX_TICKS)throw fail('V3_DEPTH_BUDGET_EXCEEDED');
    const w=words(await call(address,SELECTORS.ticks+encodeInt(tick)));
    if(w.length<2)throw fail('RPC_MALFORMED_RESPONSE');
    tickCache.set(tick,int(w[1],128));
   }
   return tickCache.get(tick);
  }
 };
 // Virtual reserves of the active range: the ladder reference when the caller gives no amount.
 const virtualIn=zeroForOne?(liquidity<<96n)/slot0.sqrtPriceX96:liquidity*slot0.sqrtPriceX96/Q96;
 const amounts=requested||DEFAULT_LADDER_BPS.map(bps=>virtualIn*BigInt(bps)/10000n).filter(v=>v>0n);
 if(!amounts.length)throw fail('V3_NO_ACTIVE_LIQUIDITY');
 const quotes=[],REFUSABLE=new Set(['V3_DEPTH_BUDGET_EXCEEDED','V3_INSUFFICIENT_LIQUIDITY']);let refusedBy=null;
 // Smallest first: the state read for a small size is reused by every larger one, and once the bounded depth is
 // exhausted every larger size is refused without further reads.
 for(const amountIn of [...amounts].sort((a,b)=>a<b?-1:a>b?1:0)){
  if(refusedBy){quotes.push({amountIn:amountIn.toString(),state:'REFUSED',reasonCode:refusedBy,amountOut:null});continue;}
  let result;
  try{result=await simulate({state:{...slot0,liquidity},amountIn,zeroForOne,feePips:BigInt(feePips),tickSpacing,reads});}
  catch(e){if(!REFUSABLE.has(e.code))throw e;refusedBy=e.code;quotes.push({amountIn:amountIn.toString(),state:'REFUSED',reasonCode:e.code,amountOut:null});continue;}
  if(result.amountOut<=0n)throw fail('QUOTE_UNAVAILABLE');
  let quoted;
  try{const w=words(await call(protocol.quoter,quoterData(input,tokenOut,amountIn,feePips)));if(w.length<4)throw fail('QUOTER_RESPONSE_INVALID');
   quoted={amountOut:BigInt('0x'+w[0]),sqrtPriceX96After:BigInt('0x'+w[1]),ticksCrossed:Number(BigInt('0x'+w[2]))};}
  catch(e){throw e.code==='CALL_REVERTED'?fail('QUOTE_MODEL_MISMATCH',{detail:'QUOTER_REVERTED'}):e;}
  if(quoted.amountOut!==result.amountOut||quoted.sqrtPriceX96After!==result.sqrtPriceX96After)throw fail('QUOTE_MODEL_MISMATCH');
  quotes.push({amountIn:amountIn.toString(),state:'VERIFIED',amountOut:result.amountOut.toString(),feePips,
   ...metrics({amountIn,amountOut:result.amountOut,sqrtPriceX96:slot0.sqrtPriceX96,zeroForOne,feePips}),
   shareOfActiveVirtualReservePpm:sharePpm(amountIn,virtualIn),
   sqrtPriceX96After:result.sqrtPriceX96After.toString(),initializedTicksCrossed:result.initializedTicksCrossed,
   // quoterTicksCrossed is informational: QuoterV2 counts bitmap positions and can differ by one from the liquidity
   // changes actually applied; amount out and post-swap price are the values that must match.
   quoterAmountOut:quoted.amountOut.toString(),quoterTicksCrossed:quoted.ticksCrossed,quoterMatch:true});
 }
 if(!quotes.some(q=>q.state==='VERIFIED'))throw fail(refusedBy||'QUOTE_UNAVAILABLE');
 const recheck=await primary.rpc('eth_getBlockByNumber',[block,false]);
 if(recheck?.hash!==header.hash)throw fail('PINNED_BLOCK_CHANGED');

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
   observed={hash:otherHeader.hash.toLowerCase(),slot0:decodeSlot0(await secondary.rpc('eth_call',[{to:address,data:SELECTORS.slot0},block])),
    liquidity:BigInt('0x'+words(await secondary.rpc('eth_call',[{to:address,data:SELECTORS.liquidity},block]))[0])};
  }catch(e){crossCheck={state:'UNAVAILABLE',reasonCode:e.code||'CROSSCHECK_FAILED'};}
  if(observed){
   if(observed.hash!==header.hash.toLowerCase()||observed.slot0.sqrtPriceX96!==slot0.sqrtPriceX96||observed.slot0.tick!==slot0.tick||observed.liquidity!==liquidity)throw fail('RPC_DISAGREEMENT');
   crossCheck={state:'AGREED',reasonCode:null,compared:['blockHash','sqrtPriceX96','tick','liquidity']};
  }
 }
 const headAgeSeconds=Math.max(0,Math.floor(now()/1000)-blockTimestamp);
 return {
  status:'VERIFIED_POOL_MODEL',model:'UNISWAP_V3_EXACT_INPUT_TICK_REPLAY',network:cfg.id,chainId:cfg.chainId,
  pool:{address,protocol:protocol.id,protocolLabel:protocol.label,factory:protocol.factory,quoter:protocol.quoter,
   feePips,feeBps:feePips/100,feeEvidence:'ONCHAIN_POOL_IMMUTABLE_CONFIRMED_BY_FACTORY',tickSpacing,token0,token1,
   identity:{poolFactory,factoryGetPool:registered,verified:true,method:'pool.factory() and reviewedFactory.getPool(token0,token1,fee) at the pinned block'}},
  block:{number:Number(pinned),hex:block,hash:header.hash.toLowerCase(),timestamp:blockTimestamp,ageSeconds:headAgeSeconds,confirmations,
   freshness:headAgeSeconds>maxHeadAgeSeconds?'STALE_HEAD':'CURRENT'},
  state:{sqrtPriceX96:slot0.sqrtPriceX96.toString(),tick:slot0.tick,activeLiquidity:liquidity.toString(),
   activeVirtualReserveIn:virtualIn.toString(),bitmapWordsRead:bitmapCache.size,ticksRead:tickCache.size},
  tokenIn:input,tokenOut,ladder:requested?'CALLER_SUPPLIED':'DEFAULT_SHARE_OF_ACTIVE_VIRTUAL_RESERVE_BPS_'+DEFAULT_LADDER_BPS.join('_'),quotes,
  evidence:{class:crossCheck.state==='AGREED'?'INDEPENDENTLY_CROSS_CHECKED':'SINGLE_SOURCE_ONCHAIN',crossCheck,
   modelReview:'Every VERIFIED quote (amount out and post-swap price) equals the reviewed QuoterV2 at the same pinned block. REFUSED sizes carry no estimate.',
   scope:'One pool, one block. Price, active liquidity, tick bitmap and crossed ticks are on-chain reads.'},
  cost:{rpcCalls:primary.cost.rpcCalls+secondaryCost.rpcCalls,primaryCalls:primary.cost.rpcCalls,crossCheckCalls:secondaryCost.rpcCalls,
   retries:primary.cost.retries+secondaryCost.retries,ms:now()-started},
  limitations:Object.freeze([
   'MODEL_ONLY: an exact-input replay of one concentrated-liquidity pool at one block; not executable exit liquidity and not a trade guarantee.',
   'TOKEN_TRANSFER_TAX_NOT_MODELLED: fee-on-transfer, blacklist, pause or trading restrictions of either token are not included.',
   'GAS_AND_MEV_NOT_MODELLED: transaction cost, sandwiching and ordering are not included.',
   'SINGLE_POOL: other fee tiers, other pools and multi-hop routes are not combined; pool balances are not exit liquidity.',
   'STATE_MOVES: price and in-range liquidity change every block; the quote is valid only for the recorded block.'])
 };
}
module.exports={analyze,protocols,PROTOCOLS,SELECTORS,MAX_WORDS,MAX_TICKS,
 math:{getSqrtRatioAtTick,getAmount0Delta,getAmount1Delta,getNextSqrtPriceFromInput,computeSwapStep,nextInitializedTick,simulate,metrics,MIN_SQRT_RATIO,MAX_SQRT_RATIO,MIN_TICK,MAX_TICK}};
