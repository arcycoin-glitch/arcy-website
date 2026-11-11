'use strict';
// Liquidity & Exit V4 — verified Uniswap v4 single-pool exact-input quote model.
//
// V4 pools have no pool contract address. The caller supplies the provider-reported bytes32 PoolId.
// This module reconstructs the PoolKey from PoolManager.Initialize, recomputes keccak256(abi.encode(PoolKey)),
// reads pool state through the reviewed StateView, and quotes the exact pool through the reviewed V4Quoter.
// Every read is pinned to one confirmed block. An independently operated RPC re-reads the same block/state
// and replays every quote when available. Disagreement fails closed.
//
// Hooks matter in v4. We intentionally quote with empty hookData only. If a hook requires application-specific
// hookData the pool is REFUSED, never approximated. Dynamic-fee pools with a hook may override the stored fee;
// those quotes may still be verified by V4Quoter, but fee-vs-price-impact decomposition is withheld.
const keccak=require('./keccak');
const {chain,rpcUrl}=require('../search/server/lib/chains');
const {addressWord}=require('./liquidity-v2-reserves');
const v2=require('./liquidity-exit-v2');
const {transport,fail,sel}=v2.internals;

const ADDRESS=/^0x[0-9a-f]{40}$/i,BYTES32=/^0x[0-9a-f]{64}$/i,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,HASH=/^0x[0-9a-f]{64}$/i;
const PPM=1000000n,Q96=1n<<96n,Q192=1n<<192n,MAX_UINT128=(1n<<128n)-1n,DYNAMIC_FEE_FLAG=0x800000;
const MAX_QUOTES=4,DEFAULT_LADDER_BPS=Object.freeze([10,100,500]);
const ZERO='0x0000000000000000000000000000000000000000';
const INIT_TOPIC=keccak(Buffer.from('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'));
const SELECTORS=Object.freeze({
 poolManager:sel('poolManager()'),
 getSlot0:sel('getSlot0(bytes32)'),
 getLiquidity:sel('getLiquidity(bytes32)'),
 quoteExactInputSingle:sel('quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))')
});

// Reviewed official Uniswap deployments. Addresses and deployment txs come from Uniswap/contracts deployments/json.
const PROTOCOLS=Object.freeze({
 arc:Object.freeze([Object.freeze({
  id:'uniswap-v4',label:'Uniswap V4',
  poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',
  stateView:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  quoter:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  poolManagerDeploymentTx:'0x2a3f2686d0dfc0e8bea88ec2dd006d0cb788410a5d24a946c8d638a32868341e',
  review:'Official Uniswap contracts deployment record for Arc chain 5042 (commit 534603a).'
 })]),
 robinhood:Object.freeze([Object.freeze({
  id:'uniswap-v4',label:'Uniswap V4',
  poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',
  stateView:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  quoter:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  poolManagerDeploymentTx:'0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41',
  review:'Official Uniswap contracts deployment record for Robinhood Chain 4663 (commit 56928a9).'
 })]),
 ethereum:Object.freeze([])
});
const protocols=network=>PROTOCOLS[chain(network).id]||[];

const word=v=>BigInt(v).toString(16).padStart(64,'0');
const addressWordHex=a=>a.slice(2).toLowerCase().padStart(64,'0');
const intWord=v=>(BigInt(v)<0n?(1n<<256n)+BigInt(v):BigInt(v)).toString(16).padStart(64,'0');
const signed=(hex,bits)=>{const v=BigInt('0x'+hex),m=1n<<BigInt(bits),t=v&(m-1n);return t>=m/2n?t-m:t;};
function words(raw){
 if(typeof raw!=='string'||!/^0x(?:[0-9a-f]{64})+$/i.test(raw))throw fail('RPC_MALFORMED_RESPONSE');
 const out=[];for(let i=2;i<raw.length;i+=64)out.push(raw.slice(i,i+64));return out;
}
function poolIdForKey(key){
 const encoded=addressWordHex(key.currency0)+addressWordHex(key.currency1)+word(key.fee)+intWord(key.tickSpacing)+addressWordHex(key.hooks);
 return keccak(Buffer.from(encoded,'hex')).toLowerCase();
}
function parseInitialize(log,expectedPoolId){
 if(!log||log.removed===true||String(log.address||'').toLowerCase()!==PROTOCOLS.arc[0].poolManager&&String(log.address||'').toLowerCase()!==PROTOCOLS.robinhood[0].poolManager)
  throw fail('V4_INITIALIZE_LOG_INVALID');
 if(!Array.isArray(log.topics)||log.topics.length!==4||String(log.topics[0]).toLowerCase()!==INIT_TOPIC||String(log.topics[1]).toLowerCase()!==expectedPoolId)
  throw fail('V4_INITIALIZE_LOG_INVALID');
 const topicAddress=t=>{if(!BYTES32.test(t||''))throw fail('V4_INITIALIZE_LOG_INVALID');return '0x'+t.slice(-40).toLowerCase();};
 const w=words(log.data);if(w.length!==5)throw fail('V4_INITIALIZE_LOG_INVALID');
 const key={currency0:topicAddress(log.topics[2]),currency1:topicAddress(log.topics[3]),fee:Number(BigInt('0x'+w[0])),
  tickSpacing:Number(signed(w[1],24)),hooks:'0x'+w[2].slice(-40).toLowerCase()};
 const initial={sqrtPriceX96:BigInt('0x'+w[3]),tick:Number(signed(w[4],24))};
 if(BigInt(key.currency0)>=BigInt(key.currency1)||!Number.isInteger(key.fee)||key.fee<0||key.fee>0xffffff||
    !Number.isInteger(key.tickSpacing)||key.tickSpacing<=0||key.tickSpacing>0x7fffff||!ADDRESS.test(key.hooks))
  throw fail('V4_POOL_KEY_INVALID');
 if(poolIdForKey(key)!==expectedPoolId)throw fail('V4_POOL_ID_MISMATCH');
 return {key,initial,blockNumber:log.blockNumber,transactionHash:log.transactionHash};
}
function decodeSlot0(raw){
 const w=words(raw);if(w.length!==4)throw fail('RPC_MALFORMED_RESPONSE');
 const sqrtPriceX96=BigInt('0x'+w[0]),tick=Number(signed(w[1],24)),protocolFee=Number(BigInt('0x'+w[2])&0xffffffn),lpFee=Number(BigInt('0x'+w[3])&0xffffffn);
 if(sqrtPriceX96<=0n||sqrtPriceX96>=1n<<160n||!Number.isInteger(tick)||lpFee<0||lpFee>1000000)throw fail('V4_STATE_INVALID');
 return {sqrtPriceX96,tick,protocolFee,lpFee};
}
function quoterData(key,zeroForOne,amountIn){
 if(amountIn<=0n||amountIn>MAX_UINT128)throw fail('INVALID_AMOUNT_IN');
 // One dynamic tuple arg. Tuple head = PoolKey(5 words) + bool + uint128 + bytes offset = 8 words.
 return SELECTORS.quoteExactInputSingle+
  word(32)+addressWordHex(key.currency0)+addressWordHex(key.currency1)+word(key.fee)+intWord(key.tickSpacing)+addressWordHex(key.hooks)+
  word(zeroForOne?1:0)+word(amountIn)+word(256)+word(0);
}
const stateData=(selector,poolId)=>selector+poolId.slice(2);
function decodeQuote(raw){
 const w=words(raw);if(w.length!==2)throw fail('V4_QUOTER_RESPONSE_INVALID');
 const amountOut=BigInt('0x'+w[0]),gasEstimate=BigInt('0x'+w[1]);
 if(amountOut<=0n)throw fail('QUOTE_UNAVAILABLE');
 return {amountOut,gasEstimate};
}
function directionalProtocolFee(packed,zeroForOne){return zeroForOne?(packed&0xfff):(packed>>12)&0xfff;}
function effectiveFeePpm(state,key,zeroForOne){
 const protocol=directionalProtocolFee(state.protocolFee,zeroForOne);
 if(protocol>1000)throw fail('V4_STATE_INVALID');
 const dynamic=key.fee===DYNAMIC_FEE_FLAG;
 if(!dynamic&&state.lpFee!==key.fee)throw fail('V4_FEE_STATE_MISMATCH');
 const canHookOverride=dynamic&&key.hooks!==ZERO;
 if(canHookOverride)return {known:false,protocolFeePpm:protocol,lpFeePpm:state.lpFee,effectiveFeePpm:null,dynamic:true};
 const effective=protocol+state.lpFee-Math.floor(protocol*state.lpFee/1000000);
 return {known:true,protocolFeePpm:protocol,lpFeePpm:state.lpFee,effectiveFeePpm:effective,dynamic};
}
function metrics({amountIn,amountOut,sqrtPriceX96,zeroForOne,fee}){
 const s2=sqrtPriceX96*sqrtPriceX96;
 const [num,den]=zeroForOne?[s2,Q192]:[Q192,s2];
 const idealNum=amountIn*num,actualNum=amountOut*den;
 const ceil=(n,d)=>n<=0n?0n:(n+d-1n)/d;
 const total=actualNum>=idealNum?0:Number(ceil((idealNum-actualNum)*PPM,idealNum));
 if(!fee.known)return {totalVsMidPpm:total,priceImpactPpm:null,feePpm:null};
 const feeOnlyNum=idealNum*(PPM-BigInt(fee.effectiveFeePpm));
 const actualScaled=actualNum*PPM;
 const impact=actualScaled>=feeOnlyNum?0:Number(ceil((feeOnlyNum-actualScaled)*PPM,feeOnlyNum));
 return {totalVsMidPpm:total,priceImpactPpm:impact,feePpm:fee.effectiveFeePpm};
}
function plan(amountsIn,virtualIn){
 if(amountsIn!==undefined&&amountsIn!==null){
  if(!Array.isArray(amountsIn)||!amountsIn.length||amountsIn.length>MAX_QUOTES)throw fail('INVALID_AMOUNT_IN');
  return amountsIn.map(v=>{if(typeof v!=='string'||!/^[1-9][0-9]*$/.test(v)||v.length>39)throw fail('INVALID_AMOUNT_IN');const n=BigInt(v);if(n>MAX_UINT128)throw fail('INVALID_AMOUNT_IN');return n;});
 }
 const out=DEFAULT_LADDER_BPS.map(bps=>virtualIn*BigInt(bps)/10000n).filter(v=>v>0n&&v<=MAX_UINT128);
 if(!out.length)throw fail('V4_NO_ACTIVE_LIQUIDITY');return out;
}
async function verifyReviewedContracts(call,protocol){
 for(const a of [protocol.poolManager,protocol.stateView,protocol.quoter]){
  const code=await call.rpc('eth_getCode',[a,call.block]);if(typeof code!=='string'||!/^0x[0-9a-f]+$/i.test(code)||code==='0x')throw fail('V4_REVIEWED_CONTRACT_MISSING');
 }
 for(const a of [protocol.stateView,protocol.quoter]){
  const got=addressWord(await call.rpc('eth_call',[{to:a,data:SELECTORS.poolManager},call.block]));
  if(got!==protocol.poolManager)throw fail('V4_REVIEWED_CONTRACT_MISMATCH');
 }
}
async function analyze({network,pool,tokenIn,amountsIn,fetcher=fetch,env=process.env,now=Date.now,timeoutMs=5000,deadlineMs=18000,confirmations=2,maxHeadAgeSeconds=900,pinnedBlock,sleep}={}){
 const cfg=chain(network);const reviewed=protocols(cfg.id);
 if(!reviewed.length)throw fail('NO_REVIEWED_V4_PROTOCOL');
 if(!BYTES32.test(pool||'')||!ADDRESS.test(tokenIn||''))throw fail('INVALID_ADDRESS');
 const poolId=pool.toLowerCase(),input=tokenIn.toLowerCase(),protocol=reviewed[0];
 const started=now(),deadlineAt=started+deadlineMs;
 const primary=transport({url:rpcUrl(cfg.id,env),fetcher,timeoutMs,budget:{used:0,max:28},deadlineAt,now,sleep});
 const chainId=await primary.rpc('eth_chainId',[]);if(!QUANTITY.test(chainId||'')||Number(BigInt(chainId))!==cfg.chainId)throw fail('RPC_CHAIN_ID_MISMATCH');
 const head=await primary.rpc('eth_blockNumber',[]);if(!QUANTITY.test(head||''))throw fail('RPC_MALFORMED_RESPONSE');
 if(pinnedBlock!==undefined&&(!Number.isSafeInteger(pinnedBlock)||pinnedBlock<=0||BigInt(pinnedBlock)>BigInt(head)))throw fail('INVALID_PINNED_BLOCK');
 const pinned=pinnedBlock!==undefined?BigInt(pinnedBlock):BigInt(head)-BigInt(confirmations);if(pinned<=0n)throw fail('RPC_MALFORMED_RESPONSE');
 const block='0x'+pinned.toString(16),header=await primary.rpc('eth_getBlockByNumber',[block,false]);
 if(!header||!HASH.test(header.hash||'')||!QUANTITY.test(header.timestamp||'')||String(header.number).toLowerCase()!==block)throw fail('RPC_MALFORMED_RESPONSE');
 primary.block=block;await verifyReviewedContracts(primary,protocol);

 const receipt=await primary.rpc('eth_getTransactionReceipt',[protocol.poolManagerDeploymentTx]);
 // Official Uniswap deployment transactions may be batch/deployer calls, so receipt.contractAddress can be null.
 // Bind the published deployment tx to chain history instead: it must succeed, and the reviewed PoolManager bytecode
 // must appear at that block while being absent immediately before it.
 if(!receipt||!QUANTITY.test(receipt.blockNumber||'')||receipt.status!=='0x1')throw fail('V4_DEPLOYMENT_PROVENANCE_FAILED');
 const deploymentBlock=receipt.blockNumber.toLowerCase();
 if(BigInt(deploymentBlock)>pinned||BigInt(deploymentBlock)<=0n)throw fail('V4_DEPLOYMENT_PROVENANCE_FAILED');
 const previousBlock='0x'+(BigInt(deploymentBlock)-1n).toString(16);
 const [codeAtDeployment,codeBeforeDeployment]=await Promise.all([
  primary.rpc('eth_getCode',[protocol.poolManager,deploymentBlock]),
  primary.rpc('eth_getCode',[protocol.poolManager,previousBlock])
 ]);
 if(typeof codeAtDeployment!=='string'||!/^0x[0-9a-f]+$/i.test(codeAtDeployment)||codeAtDeployment==='0x'||codeBeforeDeployment!=='0x')
  throw fail('V4_DEPLOYMENT_PROVENANCE_FAILED');
 const logs=await primary.rpc('eth_getLogs',[{address:protocol.poolManager,fromBlock:deploymentBlock,toBlock:block,topics:[INIT_TOPIC,poolId]}]);
 if(!Array.isArray(logs))throw fail('RPC_MALFORMED_RESPONSE');
 if(logs.length!==1)throw fail(logs.length?'V4_POOL_KEY_CONFLICT':'V4_POOL_NOT_INITIALIZED');
 const discovered=parseInitialize(logs[0],poolId),key=discovered.key;
 if(input!==key.currency0&&input!==key.currency1)throw fail('TOKEN_NOT_IN_POOL');

 const slot0=decodeSlot0(await primary.rpc('eth_call',[{to:protocol.stateView,data:stateData(SELECTORS.getSlot0,poolId)},block]));
 const liqWords=words(await primary.rpc('eth_call',[{to:protocol.stateView,data:stateData(SELECTORS.getLiquidity,poolId)},block]));
 if(liqWords.length!==1)throw fail('RPC_MALFORMED_RESPONSE');
 const liquidity=BigInt('0x'+liqWords[0]);if(liquidity<=0n||liquidity>=1n<<128n)throw fail('V4_NO_ACTIVE_LIQUIDITY');
 const zeroForOne=input===key.currency0,tokenOut=zeroForOne?key.currency1:key.currency0;
 const fee=effectiveFeePpm(slot0,key,zeroForOne);
 const virtualIn=zeroForOne?(liquidity<<96n)/slot0.sqrtPriceX96:liquidity*slot0.sqrtPriceX96/Q96;
 const amounts=plan(amountsIn,virtualIn),quotes=[];
 for(const amountIn of [...amounts].sort((a,b)=>a<b?-1:a>b?1:0)){
  try{
   const q=decodeQuote(await primary.rpc('eth_call',[{to:protocol.quoter,data:quoterData(key,zeroForOne,amountIn)},block]));
   quotes.push({amountIn:amountIn.toString(),state:'VERIFIED',amountOut:q.amountOut.toString(),gasEstimate:q.gasEstimate.toString(),
    ...metrics({amountIn,amountOut:q.amountOut,sqrtPriceX96:slot0.sqrtPriceX96,zeroForOne,fee})});
  }catch(e){
   if(e.code==='CALL_REVERTED'){quotes.push({amountIn:amountIn.toString(),state:'REFUSED',reasonCode:'V4_QUOTE_REVERTED',amountOut:null});continue;}
   throw e;
  }
 }
 if(!quotes.some(q=>q.state==='VERIFIED'))throw fail('V4_QUOTE_REVERTED');
 const recheck=await primary.rpc('eth_getBlockByNumber',[block,false]);if(recheck?.hash!==header.hash)throw fail('PINNED_BLOCK_CHANGED');

 let crossCheck={state:'NOT_CONFIGURED',reasonCode:'NO_INDEPENDENT_ENDPOINT'},secondaryCost={rpcCalls:0,retries:0};
 const secondUrl=v2.crossCheckUrl(cfg.id,env);
 if(secondUrl){
  const secondary=transport({url:secondUrl,fetcher,timeoutMs,budget:{used:0,max:10},deadlineAt,now,retries:0,sleep});secondaryCost=secondary.cost;
  try{
   const otherChain=await secondary.rpc('eth_chainId',[]);if(!QUANTITY.test(otherChain||'')||Number(BigInt(otherChain))!==cfg.chainId)throw fail('RPC_CHAIN_ID_MISMATCH');
   const otherHeader=await secondary.rpc('eth_getBlockByNumber',[block,false]);if(!otherHeader||String(otherHeader.hash||'').toLowerCase()!==String(header.hash).toLowerCase())throw fail('RPC_DISAGREEMENT');
   const otherSlot=decodeSlot0(await secondary.rpc('eth_call',[{to:protocol.stateView,data:stateData(SELECTORS.getSlot0,poolId)},block]));
   const otherLiq=BigInt('0x'+words(await secondary.rpc('eth_call',[{to:protocol.stateView,data:stateData(SELECTORS.getLiquidity,poolId)},block]))[0]);
   if(otherSlot.sqrtPriceX96!==slot0.sqrtPriceX96||otherSlot.tick!==slot0.tick||otherSlot.protocolFee!==slot0.protocolFee||otherSlot.lpFee!==slot0.lpFee||otherLiq!==liquidity)throw fail('RPC_DISAGREEMENT');
   for(const q of quotes.filter(x=>x.state==='VERIFIED')){
    const other=decodeQuote(await secondary.rpc('eth_call',[{to:protocol.quoter,data:quoterData(key,zeroForOne,BigInt(q.amountIn))},block]));
    if(other.amountOut.toString()!==q.amountOut)throw fail('RPC_DISAGREEMENT');
   }
   crossCheck={state:'AGREED',reasonCode:null,compared:['blockHash','sqrtPriceX96','tick','protocolFee','lpFee','liquidity','amountOut']};
  }catch(e){
   if(e.code==='RPC_DISAGREEMENT')throw e;
   crossCheck={state:'UNAVAILABLE',reasonCode:e.code||'CROSSCHECK_FAILED'};
  }
 }
 const blockTimestamp=Number(BigInt(header.timestamp)),headAgeSeconds=Math.max(0,Math.floor(now()/1000)-blockTimestamp);
 return {status:'VERIFIED_POOL_MODEL',model:'UNISWAP_V4_OFFICIAL_QUOTER_PINNED_STATE',network:cfg.id,chainId:cfg.chainId,
  pool:{id:poolId,protocol:protocol.id,protocolLabel:protocol.label,poolManager:protocol.poolManager,stateView:protocol.stateView,quoter:protocol.quoter,
   currency0:key.currency0,currency1:key.currency1,fee:key.fee,tickSpacing:key.tickSpacing,hooks:key.hooks,
   identity:{verified:true,method:'PoolManager.Initialize PoolKey recomputed to the provider PoolId; reviewed StateView and V4Quoter both bind to the reviewed PoolManager.',initializeBlock:discovered.blockNumber,initializeTx:discovered.transactionHash}},
  block:{number:Number(pinned),hex:block,hash:String(header.hash).toLowerCase(),timestamp:blockTimestamp,ageSeconds:headAgeSeconds,confirmations,freshness:headAgeSeconds>maxHeadAgeSeconds?'STALE_HEAD':'CURRENT'},
  state:{sqrtPriceX96:slot0.sqrtPriceX96.toString(),tick:slot0.tick,activeLiquidity:liquidity.toString(),protocolFeePacked:slot0.protocolFee,lpFeePpm:slot0.lpFee},
  tokenIn:input,tokenOut,quotes,fee:{...fee,evidence:fee.known?'STATEVIEW_PROTOCOL_AND_LP_FEE':'DYNAMIC_HOOK_MAY_OVERRIDE_STORED_LP_FEE'},
  evidence:{class:crossCheck.state==='AGREED'?'INDEPENDENTLY_CROSS_CHECKED':'SINGLE_SOURCE_ONCHAIN',crossCheck,
   modelReview:'Every verified amountOut is returned by the reviewed official Uniswap V4Quoter for the reconstructed PoolKey at the pinned block.',
   scope:'One PoolId, one pinned block, empty hookData. Pool identity is reconstructed from the canonical PoolManager Initialize event.'},
  cost:{rpcCalls:primary.cost.rpcCalls+secondaryCost.rpcCalls,primaryCalls:primary.cost.rpcCalls,crossCheckCalls:secondaryCost.rpcCalls,retries:primary.cost.retries+secondaryCost.retries,ms:now()-started},
  limitations:[
   'MODEL_ONLY: an official V4Quoter result for one PoolId at one block; not a transaction guarantee.',
   'EMPTY_HOOK_DATA_ONLY: pools whose hooks require application-specific hookData are refused.',
   'DYNAMIC_HOOK_FEE: when a dynamic-fee hook can override the stored LP fee, fee/price-impact decomposition is intentionally withheld.',
   'TOKEN_TRANSFER_RESTRICTIONS_NOT_MODELLED: token taxes, blacklist and pause behaviour are not included unless enforced by the quoted pool/hook itself.',
   'GAS_AND_MEV_NOT_MODELLED: gas price, ordering and sandwiching are not included.',
   'SINGLE_POOL: multi-hop and cross-pool routing are not combined.',
   'STATE_MOVES: the quote is valid only for the recorded block.']
 };
}
module.exports={analyze,protocols,PROTOCOLS,SELECTORS,INIT_TOPIC,poolIdForKey,parseInitialize,quoterData,decodeSlot0,effectiveFeePpm,metrics};
