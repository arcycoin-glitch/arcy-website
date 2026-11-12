'use strict';
// Liquidity & Exit V2 — verified single-pool Uniswap-V2-style exit model.
//
// Builds on lib/liquidity-v2-reserves.js (PR #207): the same parsing and constant-product arithmetic, plus the
// verification that file explicitly left open:
//   1. Pool identity: the pool must be registered by a REVIEWED factory (factory.getPair(token0,token1) == pool and
//      pool.factory() == factory). The swap fee comes from that reviewed protocol entry, never from the caller.
//   2. One pinned block for every read; the block hash is recorded.
//   3. Independent cross-check: a second RPC provider must return the same block hash and the same reserves.
//      If it cannot be reached the result stays SINGLE_SOURCE_ONCHAIN; if it disagrees the analysis fails closed.
//   4. Model review: the reviewed protocol router's own getAmountsOut at the same block must equal our integer result.
//   5. Reserve/balance reconciliation: a pool whose token balance is below its stored reserve is refused.
//
// Read-only: only eth_chainId, eth_blockNumber, eth_getBlockByNumber, eth_getCode and eth_call can be sent.
// Bounded: fixed call budget, per-request timeout, one retry per call, overall deadline.
// Fail closed: every unsupported or unverifiable case throws a coded error. No value is estimated or defaulted.
// A quote is a MODEL of one pool at one block. It is not executable exit liquidity and not a trade guarantee.
const keccak=require('./keccak');
const {chain,rpcUrl}=require('../search/server/lib/chains');
const {quoteExactIn,addressWord,reserveWords}=require('./liquidity-v2-reserves');

const ADDRESS=/^0x[0-9a-f]{40}$/i,WORD=/^0x[0-9a-f]{64}$/i,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,HASH=/^0x[0-9a-f]{64}$/i;
const sel=signature=>keccak(Buffer.from(signature)).slice(0,10);
const SELECTORS=Object.freeze({token0:sel('token0()'),token1:sel('token1()'),getReserves:sel('getReserves()'),
 factory:sel('factory()'),getPair:sel('getPair(address,address)'),balanceOf:sel('balanceOf(address)'),
 getAmountsOut:sel('getAmountsOut(uint256,address[])')});
const READ_ONLY=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call']);
const PPM=1000000n,MAX_QUOTES=4,DEFAULT_LADDER_BPS=Object.freeze([10,100,500]);
const fail=(code,extra)=>Object.assign(Error(code),{code,...extra});
// Reason codes that mean "this pool/network is outside the reviewed model" (not a provider outage).
const UNSUPPORTED=new Set(['V4_POOL_KEY_UNAVAILABLE','V4_POOL_NOT_INITIALIZED','V4_HOOK_ALTERS_SWAP','V4_AMOUNT_TOO_LARGE','FACTORY_NOT_REVIEWED','NO_REVIEWED_V2_PROTOCOL','NO_REVIEWED_PROTOCOL','NOT_V3_COMPATIBLE_POOL','V3_DEPTH_BUDGET_EXCEEDED','V3_INSUFFICIENT_LIQUIDITY','V3_NO_ACTIVE_LIQUIDITY','NOT_V2_COMPATIBLE_POOL','POOL_HAS_NO_CODE',
 'POOL_NOT_REGISTERED_BY_FACTORY','TOKEN_NOT_IN_POOL','ZERO_POOL_RESERVE','RESERVE_EXCEEDS_BALANCE','QUOTE_UNAVAILABLE','INVALID_POOL_TOKEN_PAIR']);
const CONFLICT=new Set(['RPC_DISAGREEMENT','QUOTE_MODEL_MISMATCH','PINNED_BLOCK_CHANGED','V4_POOL_ID_MISMATCH','V4_DEPLOYMENT_INCONSISTENT']);

// Reviewed protocol registry. An entry is added only after scripts/probe-liquidity-exit-v2.cjs has shown, on the
// live chain, that getPair resolves real pools and that the router quote equals this model. The fee is a property
// of the reviewed pair implementation (0.30 % is hard-coded in UniswapV2Pair.swap), not an on-chain read.
// Arc and Robinhood have no reviewed V2 factory yet: they fail closed with NO_REVIEWED_V2_PROTOCOL.
const PROTOCOLS=Object.freeze({
 ethereum:Object.freeze([
  Object.freeze({id:'uniswap-v2',label:'Uniswap V2',factory:'0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
   router:'0x7a250d5630b4cf539739df2c5dacb4c659f2488d',feeBps:30,
   review:'Canonical UniswapV2Factory / UniswapV2Router02 mainnet deployments; fee fixed in the pair implementation.'}),
  Object.freeze({id:'sushiswap-v2',label:'SushiSwap V2',factory:'0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac',
   router:'0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f',feeBps:30,
   review:'SushiSwap V2 factory / router mainnet deployments (UniswapV2 fork, same fixed pair fee).'})
 ]),
 arc:Object.freeze([]),
 // Official Uniswap deployment record for chain 4663: github.com/Uniswap/contracts deployments/4663.md.
 robinhood:Object.freeze([
  Object.freeze({id:'uniswap-v2',label:'Uniswap V2',factory:'0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',
   router:'0x89e5db8b5aa49aa85ac63f691524311aeb649eba',feeBps:30,
   review:'UniswapV2Factory / UniswapV2Router02 listed in the official Uniswap contracts deployment record for chain 4663.'})
 ])
});
const protocols=network=>PROTOCOLS[chain(network).id]||[];

// Second, independently operated endpoint per network. Same provider families the repository already uses.
const CROSSCHECK_DEFAULT=Object.freeze({ethereum:'https://eth.drpc.org',arc:'https://rpc.quicknode.mainnet.arc.io',robinhood:'https://robinhood.drpc.org'});
function crossCheckUrl(network,env=process.env){
 const id=chain(network).id,raw=env['LIQUIDITY_CROSSCHECK_RPC_'+id.toUpperCase()]||CROSSCHECK_DEFAULT[id];
 if(!raw||raw==='off')return null;
 let url;try{url=new URL(raw);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.hash)return null;
 // The cross-check is only independent if it is a different host from the primary endpoint.
 return url.hostname.toLowerCase()===new URL(rpcUrl(id,env)).hostname.toLowerCase()?null:url.toString();
}

function transport({url,fetcher,timeoutMs,budget,deadlineAt,now,retries=1,paceMs=0,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 let id=0,lastSentAt=0;const cost={rpcCalls:0,retries:0};
 async function once(method,params){
  if(!READ_ONLY.has(method))throw fail('RPC_METHOD_NOT_ALLOWED');
  if(++budget.used>budget.max)throw fail('RPC_BUDGET_EXCEEDED');
  // Optional pacing for public endpoints that rate-limit bursts; it spends the same deadline, never extends it.
  if(paceMs>0){const wait=lastSentAt+paceMs-now();if(wait>0&&wait<deadlineAt-now())await sleep(wait);}
  lastSentAt=now();
  const remaining=deadlineAt-now();
  if(remaining<=50)throw fail('RPC_DEADLINE_EXCEEDED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,remaining)),requestId=++id;
  cost.rpcCalls++;
  try{
   let response;
   try{response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal});}
   catch(e){throw fail(e?.name==='AbortError'?'RPC_TIMEOUT':'RPC_NETWORK_ERROR',{transient:true});}
   if(!response.ok)throw fail(response.status===429?'RPC_RATE_LIMITED':'RPC_HTTP_ERROR',{transient:response.status===429||response.status>=500});
   let body;try{body=await response.json();}catch{throw fail('RPC_MALFORMED_RESPONSE',{transient:true});}
   if(body?.jsonrpc!=='2.0'||body.id!==requestId)throw fail('RPC_MALFORMED_RESPONSE');
   if(body.error){
    const message=String(body.error.message||''),code=body.error.code;
    if(method==='eth_call'&&(code===3||/revert|invalid opcode|out of gas|execution (?:error|failed)|stack underflow|invalid jump/i.test(message)))throw fail('CALL_REVERTED');
    throw fail(code===-32005||code===429||/rate|limit|too many|capacity/i.test(message)?'RPC_RATE_LIMITED':'RPC_PROVIDER_ERROR',{transient:true});
   }
   return body.result;
  }finally{clearTimeout(timer);}
 }
 async function rpc(method,params){
  for(let attempt=0;;attempt++){
   try{return await once(method,params);}
   catch(e){
    if(!e.transient||attempt>=retries||deadlineAt-now()<=400)throw e;
    cost.retries++;await sleep(200*(attempt+1));
   }
  }
 }
 return {rpc,cost};
}

const pad=address=>address.slice(2).toLowerCase().padStart(64,'0');
const uintWord=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE');return BigInt(raw);};
function decodeAmountsOut(raw){
 // abi.encode(uint256[] amounts) for a two-hop path: offset, length (2), amounts[0], amounts[1].
 if(typeof raw!=='string'||!/^0x[0-9a-f]{256}$/i.test(raw))throw fail('ROUTER_RESPONSE_INVALID');
 const w=i=>BigInt('0x'+raw.slice(2+64*i,66+64*i));
 if(w(0)!==32n||w(1)!==2n)throw fail('ROUTER_RESPONSE_INVALID');
 return {amountIn:w(2),amountOut:w(3)};
}
const amountsOutData=(amountIn,tokenIn,tokenOut)=>SELECTORS.getAmountsOut+amountIn.toString(16).padStart(64,'0')+
 (64).toString(16).padStart(64,'0')+(2).toString(16).padStart(64,'0')+pad(tokenIn)+pad(tokenOut);

// Exact integer decomposition of one quote. All ratios are parts-per-million, rounded against the seller.
//   idealOut      = amountIn * reserveOut / reserveIn                 (mid price, no fee, no impact)
//   feeOnlyOut    = idealOut * (1 - fee)                              (fee, no impact)
//   priceImpact   = 1 - amountOut / feeOnlyOut  = aF / (reserveIn*10000 + aF),  aF = amountIn*(10000-feeBps)
//   totalVsMid    = 1 - amountOut / idealOut    (fee + price impact; excludes token tax, gas, MEV, routing)
function decompose({amountIn,reserveIn,reserveOut,feeBps}){
 const base=quoteExactIn({amountIn,reserveIn,reserveOut,feeBps}),out=BigInt(base.amountOut);
 const aF=amountIn*BigInt(10000-feeBps),denominator=reserveIn*10000n+aF;
 const ceil=(n,d)=>(n+d-1n)/d;
 const idealNumerator=amountIn*reserveOut; // idealOut = idealNumerator / reserveIn
 const shortfall=idealNumerator-out*reserveIn; // >= 0
 return {amountIn:amountIn.toString(),amountOut:base.amountOut,feeBps,
  priceImpactPpm:Number(ceil(aF*PPM,denominator)),
  feePpm:feeBps*100,
  totalVsMidPpm:Number(shortfall<=0n?0n:ceil(shortfall*PPM,idealNumerator)),
  shareOfReserveInPpm:Number(ceil(amountIn*PPM,reserveIn)),
  remainingReserveOut:base.remainingReserveOut};
}

function plan({amountsIn,reserveIn}){
 if(amountsIn===undefined||amountsIn===null){
  const ladder=DEFAULT_LADDER_BPS.map(bps=>reserveIn*BigInt(bps)/10000n).filter(v=>v>0n);
  if(!ladder.length)throw fail('ZERO_POOL_RESERVE');
  return {amounts:ladder,ladder:'DEFAULT_SHARE_OF_RESERVE_BPS_'+DEFAULT_LADDER_BPS.join('_')};
 }
 if(!Array.isArray(amountsIn)||!amountsIn.length||amountsIn.length>MAX_QUOTES)throw fail('INVALID_AMOUNT_IN');
 return {amounts:amountsIn.map(v=>{if(typeof v!=='string'||!/^[1-9][0-9]*$/.test(v)||v.length>78)throw fail('INVALID_AMOUNT_IN');return BigInt(v);}),ladder:'CALLER_SUPPLIED'};
}

async function analyze({network,pool,tokenIn,amountsIn,fetcher=fetch,env=process.env,now=Date.now,timeoutMs=4000,deadlineMs=12000,confirmations=2,maxHeadAgeSeconds=900,pinnedBlock,sleep}={}){
 const cfg=chain(network);
 if(!ADDRESS.test(pool||'')||!ADDRESS.test(tokenIn||''))throw fail('INVALID_ADDRESS');
 if(amountsIn!==undefined&&amountsIn!==null)plan({amountsIn,reserveIn:1n}); // validate before any network read
 const reviewed=protocols(cfg.id);
 if(!reviewed.length)throw fail('NO_REVIEWED_V2_PROTOCOL');
 const started=now(),deadlineAt=started+deadlineMs,address=pool.toLowerCase(),input=tokenIn.toLowerCase();
 const primaryBudget={used:0,max:20},secondaryBudget={used:0,max:4};
 const primary=transport({url:rpcUrl(cfg.id,env),fetcher,timeoutMs,budget:primaryBudget,deadlineAt,now,sleep});

 const chainId=await primary.rpc('eth_chainId',[]);
 if(!QUANTITY.test(chainId||'')||Number(BigInt(chainId))!==cfg.chainId)throw fail('RPC_CHAIN_ID_MISMATCH');
 const head=await primary.rpc('eth_blockNumber',[]);
 if(!QUANTITY.test(head||''))throw fail('RPC_MALFORMED_RESPONSE');
 // pinnedBlock (internal, not exposed by the API) re-runs the analysis at an already recorded block for reproducibility.
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
 const v2=async(to,data)=>{try{return await call(to,data);}catch(e){throw e.code==='CALL_REVERTED'?fail('NOT_V2_COMPATIBLE_POOL'):e;}};
 let token0,token1,reserves,poolFactory;
 try{
  token0=addressWord(await v2(address,SELECTORS.token0));token1=addressWord(await v2(address,SELECTORS.token1));
  reserves=reserveWords(await v2(address,SELECTORS.getReserves));
  poolFactory=addressWord(await v2(address,SELECTORS.factory));
 }catch(e){throw e.code?e:fail('NOT_V2_COMPATIBLE_POOL');}
 if(token0===token1)throw fail('INVALID_POOL_TOKEN_PAIR');
 if(input!==token0&&input!==token1)throw fail('TOKEN_NOT_IN_POOL');

 // Pool identity: only a reviewed factory can vouch for the pool, and the factory itself must name this pool.
 const protocol=reviewed.find(p=>p.factory===poolFactory);
 if(!protocol)throw fail('FACTORY_NOT_REVIEWED',{observedFactory:poolFactory});
 let registered;
 try{registered=addressWord(await call(protocol.factory,SELECTORS.getPair+pad(token0)+pad(token1)));}
 catch(e){throw e.code==='CALL_REVERTED'||!e.code?fail('POOL_NOT_REGISTERED_BY_FACTORY'):e;}
 if(registered!==address)throw fail('POOL_NOT_REGISTERED_BY_FACTORY',{observedFactory:poolFactory});

 const {reserve0,reserve1,blockTimestampLast}=reserves;
 const reserveIn=input===token0?reserve0:reserve1,reserveOut=input===token0?reserve1:reserve0,tokenOut=input===token0?token1:token0;
 if(reserveIn<=0n||reserveOut<=0n)throw fail('ZERO_POOL_RESERVE');
 const balance0=uintWord(await call(token0,SELECTORS.balanceOf+pad(address))),balance1=uintWord(await call(token1,SELECTORS.balanceOf+pad(address)));
 if(balance0<reserve0||balance1<reserve1)throw fail('RESERVE_EXCEEDS_BALANCE');

 const {amounts,ladder}=plan({amountsIn,reserveIn});
 const quotes=[];
 for(const amountIn of amounts){
  const quote=decompose({amountIn,reserveIn,reserveOut,feeBps:protocol.feeBps});
  let routed;
  try{routed=decodeAmountsOut(await call(protocol.router,amountsOutData(amountIn,input,tokenOut)));}
  catch(e){throw e.code==='CALL_REVERTED'?fail('QUOTE_MODEL_MISMATCH',{detail:'ROUTER_REVERTED'}):e;}
  if(routed.amountIn!==amountIn||routed.amountOut.toString()!==quote.amountOut)throw fail('QUOTE_MODEL_MISMATCH');
  quotes.push({...quote,routerAmountOut:routed.amountOut.toString(),routerMatch:true});
 }

 // The pinned block must still be canonical after the reads (a reorg during the analysis invalidates it).
 const recheck=await primary.rpc('eth_getBlockByNumber',[block,false]);
 if(recheck?.hash!==header.hash)throw fail('PINNED_BLOCK_CHANGED');

 // Independent provider: same block hash and same reserves, or the result is not upgraded.
 let crossCheck={state:'NOT_CONFIGURED',reasonCode:'NO_INDEPENDENT_ENDPOINT'},secondaryCost={rpcCalls:0,retries:0};
 const secondUrl=crossCheckUrl(cfg.id,env);
 if(secondUrl){
  const secondary=transport({url:secondUrl,fetcher,timeoutMs,budget:secondaryBudget,deadlineAt,now,retries:0,sleep});
  secondaryCost=secondary.cost;
  let observed;
  try{
   const otherChain=await secondary.rpc('eth_chainId',[]);
   if(!QUANTITY.test(otherChain||'')||Number(BigInt(otherChain))!==cfg.chainId)throw fail('RPC_CHAIN_ID_MISMATCH');
   const otherHeader=await secondary.rpc('eth_getBlockByNumber',[block,false]);
   if(!otherHeader||!HASH.test(otherHeader.hash||''))throw fail('CROSSCHECK_BLOCK_UNAVAILABLE');
   observed={hash:otherHeader.hash.toLowerCase(),reserves:reserveWords(await secondary.rpc('eth_call',[{to:address,data:SELECTORS.getReserves},block]))};
  }catch(e){crossCheck={state:'UNAVAILABLE',reasonCode:e.code||'CROSSCHECK_FAILED'};}
  if(observed){
   if(observed.hash!==header.hash.toLowerCase()||observed.reserves.reserve0!==reserve0||observed.reserves.reserve1!==reserve1||observed.reserves.blockTimestampLast!==blockTimestampLast)
    throw fail('RPC_DISAGREEMENT');
   crossCheck={state:'AGREED',reasonCode:null,compared:['blockHash','reserve0','reserve1','blockTimestampLast']};
  }
 }

 const headAgeSeconds=Math.max(0,Math.floor(now()/1000)-blockTimestamp);
 const lastUpdateAgeSeconds=Number((BigInt(blockTimestamp)-BigInt(blockTimestampLast))&0xffffffffn);
 return {
  status:'VERIFIED_POOL_MODEL',network:cfg.id,chainId:cfg.chainId,
  pool:{address,protocol:protocol.id,protocolLabel:protocol.label,factory:protocol.factory,router:protocol.router,
   feeBps:protocol.feeBps,feeEvidence:'REVIEWED_PROTOCOL_CONSTANT',token0,token1,
   identity:{poolFactory,factoryGetPair:registered,verified:true,method:'pool.factory() and reviewedFactory.getPair(token0,token1) at the pinned block'}},
  block:{number:Number(pinned),hex:block,hash:header.hash.toLowerCase(),timestamp:blockTimestamp,ageSeconds:headAgeSeconds,confirmations,
   freshness:headAgeSeconds>maxHeadAgeSeconds?'STALE_HEAD':'CURRENT'},
  reserves:{reserve0:reserve0.toString(),reserve1:reserve1.toString(),blockTimestampLast,lastUpdateAgeSeconds,
   balance0:balance0.toString(),balance1:balance1.toString(),
   unsyncedSurplus0:(balance0-reserve0).toString(),unsyncedSurplus1:(balance1-reserve1).toString()},
  tokenIn:input,tokenOut,ladder,quotes,
  evidence:{class:crossCheck.state==='AGREED'?'INDEPENDENTLY_CROSS_CHECKED':'SINGLE_SOURCE_ONCHAIN',crossCheck,
   modelReview:'Every quote equals the reviewed router getAmountsOut at the same pinned block.',
   scope:'One pool, one block. Reserves and pool identity are on-chain reads; the fee is a reviewed protocol constant.'},
  cost:{rpcCalls:primary.cost.rpcCalls+secondaryCost.rpcCalls,primaryCalls:primary.cost.rpcCalls,crossCheckCalls:secondaryCost.rpcCalls,
   retries:primary.cost.retries+secondaryCost.retries,ms:now()-started},
  limitations:Object.freeze([
   'MODEL_ONLY: a constant-product quote for one pool at one block; not executable exit liquidity and not a trade guarantee.',
   'TOKEN_TRANSFER_TAX_NOT_MODELLED: fee-on-transfer, blacklist, pause or trading restrictions of either token are not included.',
   'GAS_AND_MEV_NOT_MODELLED: transaction cost, sandwiching and ordering are not included.',
   'SINGLE_POOL: other pools and multi-hop routes are not combined; pool reserves are not total token liquidity.',
   'STATE_MOVES: reserves change every block; the quote is valid only for the recorded block.'])
 };
}

function classifyFailure(error){
 // lib/liquidity-v2-reserves.js throws uncoded errors whose message is the code.
 const code=typeof error?.code==='string'?error.code:/^[A-Z][A-Z0-9_]{2,60}$/.test(error?.message||'')?error.message:'EXIT_ANALYSIS_FAILED';
 const state=UNSUPPORTED.has(code)?'UNSUPPORTED':CONFLICT.has(code)?'CONFLICTING_EVIDENCE':/^INVALID_/.test(code)?'INVALID_REQUEST':'PROVIDER_UNAVAILABLE';
 return {state,reasonCode:code,...(ADDRESS.test(error?.observedFactory||'')?{observedFactory:error.observedFactory}:{})};
}

// Per-instance cache + in-flight sharing so public traffic cannot multiply RPC load. Failures are never cached as data.
const CACHE_MS=15000,MAX_ENTRIES=200,cache=new Map(),inflight=new Map();
function cached(args,run=analyze,now=Date.now){
 const key=[args.network,String(args.pool).toLowerCase(),String(args.tokenIn).toLowerCase(),(args.amountsIn||[]).join(',')].join('|');
 const hit=cache.get(key);
 if(hit&&hit.expiresAt>now())return Promise.resolve(hit.value);
 if(inflight.has(key))return inflight.get(key);
 const pending=run(args).then(value=>{
  if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value);
  cache.set(key,{value,expiresAt:now()+CACHE_MS});return value;
 }).finally(()=>inflight.delete(key));
 inflight.set(key,pending);return pending;
}

module.exports={analyze,cached,classifyFailure,decompose,decodeAmountsOut,crossCheckUrl,protocols,PROTOCOLS,SELECTORS,
 // Shared with lib/liquidity-exit-v3.js and lib/liquidity-exit.js (same bounded read-only transport and failure classes).
 internals:{transport,fail,pad,sel,uintWord,UNSUPPORTED,CONFLICT},
 _reset:()=>{cache.clear();inflight.clear();}};
