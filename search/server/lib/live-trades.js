'use strict';
// Live Trading: recent DEX swaps of ONE exact token contract on ONE chain, from verified on-chain events only.
//
// Evidence chain (no symbol matching, no synthetic rows):
//  1. Pool candidates come from the existing cached GeckoTerminal token-pool response (provider-reported, never trusted).
//  2. Each candidate pool's identity is proven on-chain with the REVIEWED protocol registries already used by
//     Liquidity & Exit (lib/liquidity-exit-v2/v3/v4):
//       V2: pool.factory() is a reviewed factory AND factory.getPair(token0,token1) == pool
//       V3: pool.factory() is a reviewed factory AND factory.getPool(token0,token1,fee) == pool
//       V4: reviewed PositionManager.poolKeys(bytes25) -> PoolKey; keccak256(abi.encode(PoolKey)) == PoolId
//     and the searched token must be one side of the pool. Unreviewed factories/managers are excluded, not guessed.
//  3. Swaps are the pool's own Swap events (V2/V3: emitted by the pool; V4: emitted by the reviewed PoolManager with
//     topic1 == PoolId) in a bounded, confirmed block window. A plain token Transfer is never classified.
//  4. Side comes from the signed pool deltas of THIS token versus the counter asset:
//       BUY  = the pool paid the token out and received the counter asset;
//       SELL = the pool received the token and paid the counter asset out;
//       SWAP = anything else (mixed or ambiguous deltas).
//  5. Each displayed row is deduplicated by txHash:logIndex, carries block number + hash, and is bound to the block
//     header (timestamp) whose hash must equal the log's blockHash (a mismatch = reorged/unstable -> dropped).
//     The wallet is the transaction sender (eth_getTransactionByHash).
//  6. USD is shown only when the counter asset is a reviewed USD stablecoin (Arc native/ERC-20 USDC, Ethereum USDC/
//     USDT/DAI), or Ethereum WETH/ETH priced by the existing pinned Chainlink ETH/USD reader. Otherwise USD is
//     NOT VERIFIED and the counter amount is shown in its own units.
//  7. LIVE only when the chain head is fresh; otherwise the payload says DELAYED. Nothing here is investment advice.
const keccak=require('../../../lib/keccak');
const {chain}=require('./chains');
const v2=require('../../../lib/liquidity-exit-v2'),v3=require('../../../lib/liquidity-exit-v3'),v4=require('../../../lib/liquidity-exit-v4');
const ADDRESS=/^0x[0-9a-f]{40}$/,POOL20=/^0x[0-9a-f]{40}$/,POOL32=/^0x[0-9a-f]{64}$/,WORD=/^0x[0-9a-f]{64}$/i;
const sel=s=>keccak(Buffer.from(s)).slice(0,10);
const TOPIC=Object.freeze({
 V2:keccak(Buffer.from('Swap(address,uint256,uint256,uint256,uint256,address)')).toLowerCase(),
 V3:keccak(Buffer.from('Swap(address,address,int256,int256,uint160,uint128,int24)')).toLowerCase(),
 V4:keccak(Buffer.from('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')).toLowerCase()
});
const S=Object.freeze({token0:sel('token0()'),token1:sel('token1()'),fee:sel('fee()'),factory:sel('factory()'),
 getPair:sel('getPair(address,address)'),getPool:sel('getPool(address,address,uint24)'),getPoolTs:sel('getPool(address,address,int24)'),tickSpacing:sel('tickSpacing()'),decimals:sel('decimals()'),symbol:sel('symbol()')});
const ZERO='0x0000000000000000000000000000000000000000';
// Live-Trading-only reviewed venues (swap identity and Swap-event semantics; never used for exit quotes). Evidence:
// scripts/probe-trade-venues.cjs (Sourcify-verified factory + pool sources, canonical Swap topics observed in live logs).
const TRADE_VENUES=Object.freeze({
 ethereum:Object.freeze([{id:'shibaswap',kind:'V2',factory:'0x115934131916c8b277dd010ee02de363c09d037c',
  review:'Sourcify UniswapV2Factory digest 0f727799… / UniswapV2Pair digest 8423d79c… (0.6.12); standard Swap(amount0In,amount1In,amount0Out,amount1Out) and getPair(token0,token1).'}]),
 robinhood:Object.freeze([{id:'ramses-v3',kind:'V3',registration:'tickSpacing',factory:'0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8',
  review:'Sourcify RamsesV3Factory digest 97bf045b… / RamsesV3Pool digest adabafbf…; Swap identical to Uniswap V3 (pool-perspective int256 amounts); getPool keyed by tickSpacing.'}]),
 arc:Object.freeze([])
});
// Pools of an unreviewed factory are accepted only when their runtime equals the Sourcify-verified CANONICAL Uniswap V3
// pool (same source digest as the reviewed Ethereum/Robinhood deployments) with compiler-declared immutables masked.
const CANONICAL_V3=Object.freeze({digest:'745996826d21f5ee9981d97c82956ce7b94c99bbe0ce9007c0255bc139dc0bea',
 reference:Object.freeze({arc:'0x162df51c504e7b8321e07387932f333d9be16a72'})});
const canonicalRef=new Map();
// Reviewed USD-denominated counter assets (exact chain + contract). Arc's native gas token IS USDC (18 decimals natively;
// its ERC-20 interface at 0x3600… uses 6). Values are labelled "USDC/USDT/DAI-quoted", i.e. 1 unit treated as $1.
const USD_STABLES=Object.freeze({
 arc:Object.freeze({[ZERO]:{symbol:'USDC',decimals:18,native:true},'0x3600000000000000000000000000000000000000':{symbol:'USDC',decimals:6}}),
 ethereum:Object.freeze({'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':{symbol:'USDC',decimals:6},'0xdac17f958d2ee523a2206206994597c13d831ec7':{symbol:'USDT',decimals:6},
  '0x6b175474e89094c44da98b954eedeac495271d0f':{symbol:'DAI',decimals:18}}),
 robinhood:Object.freeze({})
});
// ETH-denominated counter assets priced by the pinned Chainlink ETH/USD reader on Ethereum. On Robinhood Chain the
// native gas token is ETH and 0x0bd7… is the reviewed WETH (same contract the Risk Engine tax producer quotes against);
// those values are labelled as an Ethereum-mainnet reference price, not a same-chain USD anchor.
const ETH_PRICED=Object.freeze({ethereum:Object.freeze({[ZERO]:{symbol:'ETH',decimals:18},'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':{symbol:'WETH',decimals:18}}),
 robinhood:Object.freeze({[ZERO]:{symbol:'ETH',decimals:18},'0x0bd7d308f8e1639fab988df18a8011f41eacad73':{symbol:'WETH',decimals:18}})});
const NATIVE=Object.freeze({arc:{symbol:'USDC',decimals:18},ethereum:{symbol:'ETH',decimals:18},robinhood:{symbol:'ETH',decimals:18}});
const NET=Object.freeze({
 // window: first span per log query (grows x2 on empty answers up to maxSpan, halves on provider range/size errors);
 // lookback: max blocks examined (~24 h of blocks); confirmations: blocks withheld from the head.
 ethereum:{rpc:()=>require('./eth').rpc,window:600,maxSpan:2000,lookback:7200,confirmations:2,paceMs:0,maxHeadAgeS:90},
 arc:{rpc:()=>require('./arc-rpc').rpc,window:1500,maxSpan:60000,lookback:520000,confirmations:0,paceMs:220,maxHeadAgeS:30},
 robinhood:{rpc:()=>require('./robinhood-rpc').rpc,window:3000,maxSpan:100000,lookback:860000,confirmations:0,paceMs:120,maxHeadAgeS:30}
});
const ROW_CONCURRENCY=4,MAX_POOLS=3,MAX_ROWS=20,MAX_LOG_CALLS=10,MAX_ROW_READS=40,KEEP_LOGS=60,CACHE_MS=20000,IDENTITY_CACHE=500,MAX_INFLIGHT=3;
const cache=new Map(),inflight=new Map(),incremental=new Map(),identityCache=new Map(),metaCache=new Map(),txCache=new Map(),blockCache=new Map();
let running=0;
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
const pad=a=>a.slice(2).toLowerCase().padStart(64,'0');
const addr=w=>WORD.test(w||'')&&/^0x0{24}/i.test(w)?('0x'+w.slice(26)).toLowerCase():null;
const signed=(hex,bits=256)=>{const v=BigInt('0x'+hex),m=1n<<BigInt(bits),t=v&(m-1n);return t>=m/2n?t-m:t;};
function remember(map,key,value,max=IDENTITY_CACHE){map.set(key,value);if(map.size>max)map.delete(map.keys().next().value);return value;}
function units(raw,decimals){
 const neg=raw<0n,abs=neg?-raw:raw,s=abs.toString().padStart(decimals+1,'0');
 const whole=s.slice(0,s.length-decimals)||'0',frac=decimals?s.slice(-decimals).replace(/0+$/,''):'';
 return (neg?'-':'')+whole+(frac?'.'+frac:'');
}
function toNumber(raw,decimals){const n=Number(units(raw,decimals));return Number.isFinite(n)?n:null;}
function budget(network,rpcFn){
 const cfg=NET[network],calls={n:0};let last=0;
 const call=async(method,params)=>{
  calls.n++;
  if(cfg.paceMs){const wait=last+cfg.paceMs-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();}
  // V3: bounded retry (2 attempts, 0.8 s / 1.6 s backoff) ONLY for provider rate limits; any other error surfaces unchanged.
  for(let attempt=0;;attempt++){
   try{return await rpcFn(method,params);}
   catch(e){if(attempt>=2||!/429|rate.?limit|too many requests/i.test(String(e?.message||'')+' '+String(e?.code||'')))throw e;
    calls.retries=(calls.retries||0)+1;await new Promise(r=>setTimeout(r,800*(attempt+1)));}
  }
 };
 return {call,calls};
}
async function ethCall(rpc,to,data,block){const r=await rpc.call('eth_call',[{to,data},block]);return typeof r==='string'?r.toLowerCase():r;}
async function tokenMeta(network,rpc,token,block){
 const key=network+':'+token;if(metaCache.has(key))return metaCache.get(key);
 if(token===ZERO)return remember(metaCache,key,{...NATIVE[network]});
 const [d,s]=await Promise.all([ethCall(rpc,token,S.decimals,block).catch(()=>null),ethCall(rpc,token,S.symbol,block).catch(()=>null)]);
 const decimals=WORD.test(d||'')?Number(BigInt(d)):null;
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw fail('TOKEN_DECIMALS_UNAVAILABLE');
 return remember(metaCache,key,{symbol:require('./eth').abiString(s)?.slice(0,16)||null,decimals});
}
// ---- 2. pool identity -------------------------------------------------------------------------------------------
async function identifyPool(network,rpc,token,candidate,block){
 const key=network+':'+candidate.pool;
 if(identityCache.has(key)){const hit=identityCache.get(key);return hit.token===token?hit:{excluded:'POOL_DOES_NOT_CONTAIN_TOKEN'};}
 const id=chain(network).id;let out;
 if(POOL32.test(candidate.pool)){
  const protocol=v4.protocols(id)[0];
  if(!protocol)return {excluded:'NO_REVIEWED_V4_POOL_MANAGER'};
  const raw=await ethCall(rpc,protocol.positionManager,v4.poolKeyData(candidate.pool),block);
  let k;try{k=v4.decodePoolKey(raw,candidate.pool);}catch(e){return {excluded:e.code||'V4_POOL_KEY_UNAVAILABLE'};}
  if(![k.currency0,k.currency1].includes(token))return {excluded:'POOL_DOES_NOT_CONTAIN_TOKEN'};
  out={kind:'V4',pool:candidate.pool,emitter:protocol.poolManager,protocol:protocol.id,token0:k.currency0,token1:k.currency1,fee:k.fee,hooks:k.hooks,
   method:'Reviewed PositionManager.poolKeys(bytes25) + keccak256(PoolKey) == PoolId'};
 }else if(POOL20.test(candidate.pool)){
  const [t0,t1,f,factoryWord]=await Promise.all([S.token0,S.token1,S.fee,S.factory].map(d=>ethCall(rpc,candidate.pool,d,block).catch(()=>null)));
  const token0=addr(t0),token1=addr(t1),factory=addr(factoryWord);
  if(!token0||!token1||!factory)return {excluded:'POOL_INTERFACE_UNRECOGNIZED'};
  if(![token0,token1].includes(token))return {excluded:'POOL_DOES_NOT_CONTAIN_TOKEN'};
  const fee=WORD.test(f||'')?BigInt(f):null;
  const r3=fee!==null&&fee<1000000n?v3.protocols(id).find(p=>p.factory===factory):null,r2=v2.protocols(id).find(p=>p.factory===factory);
  if(r3){
   const registered=addr(await ethCall(rpc,factory,S.getPool+pad(token0)+pad(token1)+fee.toString(16).padStart(64,'0'),block));
   if(registered!==candidate.pool)return {excluded:'FACTORY_DOES_NOT_REGISTER_POOL'};
   out={kind:'V3',pool:candidate.pool,emitter:candidate.pool,protocol:r3.id,token0,token1,fee:Number(fee),factory,method:'pool.factory() is reviewed AND factory.getPool(token0,token1,fee) == pool'};
  }else if(r2){
   const registered=addr(await ethCall(rpc,factory,S.getPair+pad(token0)+pad(token1),block));
   if(registered!==candidate.pool)return {excluded:'FACTORY_DOES_NOT_REGISTER_POOL'};
   out={kind:'V2',pool:candidate.pool,emitter:candidate.pool,protocol:r2.id,token0,token1,factory,method:'pool.factory() is reviewed AND factory.getPair(token0,token1) == pool'};
  }else{
   const venue=(TRADE_VENUES[network]||[]).find(v=>v.factory===factory);
   if(venue&&venue.kind==='V2'){
    const registered=addr(await ethCall(rpc,factory,S.getPair+pad(token0)+pad(token1),block));
    if(registered!==candidate.pool)return {excluded:'FACTORY_DOES_NOT_REGISTER_POOL'};
    out={kind:'V2',pool:candidate.pool,emitter:candidate.pool,protocol:venue.id,token0,token1,factory,method:'Reviewed '+venue.id+' factory: getPair(token0,token1) == pool'};
   }else if(venue&&venue.kind==='V3'&&venue.registration==='tickSpacing'){
    const ts=await ethCall(rpc,candidate.pool,S.tickSpacing,block);if(!WORD.test(ts||''))return {excluded:'POOL_INTERFACE_UNRECOGNIZED'};
    const registered=addr(await ethCall(rpc,factory,S.getPoolTs+pad(token0)+pad(token1)+ts.slice(2),block));
    if(registered!==candidate.pool)return {excluded:'FACTORY_DOES_NOT_REGISTER_POOL'};
    out={kind:'V3',pool:candidate.pool,emitter:candidate.pool,protocol:venue.id,token0,token1,factory,method:'Reviewed '+venue.id+' factory: getPool(token0,token1,tickSpacing) == pool'};
   }else if(CANONICAL_V3.reference[network]&&await canonicalV3Runtime(network,rpc,candidate.pool,block)){
    out={kind:'V3',pool:candidate.pool,emitter:candidate.pool,protocol:'uniswap-v3-canonical-runtime',token0,token1,factory,
     method:'Pool runtime equals the Sourcify-verified canonical UniswapV3Pool (immutables masked); its factory is not reviewed'};
   }else if(fee!==null&&fee<1000000n&&addr(await ethCall(rpc,factory,S.getPool+pad(token0)+pad(token1)+fee.toString(16).padStart(64,'0'),block).catch(()=>null))===candidate.pool){
    // V3: an unreviewed V3-interface DEX (e.g. Synthra on Arc). Its factory's on-chain registry proves the pool, but its source is
    // unpublished, so the Swap sign convention is NOT trusted: every displayed row must reconcile EXACTLY with the two tokens' own
    // ERC-20 Transfer events into/out of the pool in the same transaction. Unreconciled rows are never shown.
    out={kind:'V3',pool:candidate.pool,emitter:candidate.pool,protocol:'v3-interface-transfer-reconciled',token0,token1,fee:Number(fee),factory,reconcile:true,
     method:'factory.getPool(token0,token1,fee) == pool (unreviewed source); every row reconciled with token Transfer events'};
   }else return {excluded:'UNREVIEWED_FACTORY',factory};
  }
 }else return {excluded:'POOL_ID_INVALID'};
 out.token=token;out.counter=out.token0===token?out.token1:out.token0;out.dex=candidate.dex||null;
 return remember(identityCache,key,out);
}
async function canonicalV3Runtime(network,rpc,pool,block){
 let ref=canonicalRef.get(network);
 if(!ref){
  ref=(async()=>{
   const address=CANONICAL_V3.reference[network],code=await rpc.call('eth_getCode',[address,block]);
   const url='https://sourcify.dev/server/v2/contract/'+chain(network).chainId+'/'+address+'?fields=abi,sources,compilation,runtimeBytecode';
   const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});if(!r.ok)throw fail('CANONICAL_REFERENCE_UNAVAILABLE');
   const v=require('./mechanics-deep').validateSource(await r.json(),{chainId:chain(network).chainId,address,code});
   if(v.digest!==CANONICAL_V3.digest)throw fail('CANONICAL_REFERENCE_MISMATCH');
   const regions=Object.values(v.immutableReferences||{}).flat();
   if(!regions.length||!regions.every(x=>Number.isInteger(x.start)&&x.length===32))throw fail('CANONICAL_REFERENCE_MISMATCH');
   return {masked:maskCode(code,regions),regions};
  })();
  canonicalRef.set(network,ref);ref.catch(()=>canonicalRef.delete(network));
 }
 let reference;try{reference=await ref;}catch{return false;}
 const code=await rpc.call('eth_getCode',[pool,block]).catch(()=>null);
 return typeof code==='string'&&maskCode(code,reference.regions)===reference.masked;
}
function maskCode(code,regions){
 if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))return null;
 const b=Buffer.from(code.slice(2),'hex');for(const {start,length} of regions){if(start+length>b.length)return null;b.fill(0,start,start+length);}
 return b.toString('hex');
}
// ---- 3/4. swap events -------------------------------------------------------------------------------------------
function decodeSwap(pool,log){
 const data=String(log.data||'').slice(2),w=i=>data.slice(i*64,(i+1)*64);
 const tokenIs0=pool.token0===pool.token;let tokenPool,counterPool;
 if(pool.kind==='V2'){
  if(data.length!==256)return null;
  const [in0,in1,out0,out1]=[0,1,2,3].map(i=>BigInt('0x'+w(i)));
  // pool-perspective net deltas: received minus paid
  const d0=in0-out0,d1=in1-out1;tokenPool=tokenIs0?d0:d1;counterPool=tokenIs0?d1:d0;
  if((tokenIs0?(in0>0n&&out0>0n):(in1>0n&&out1>0n)))return {side:'SWAP',tokenPool,counterPool};
 }else if(pool.kind==='V3'){
  if(data.length!==320)return null;
  const a0=signed(w(0)),a1=signed(w(1));tokenPool=tokenIs0?a0:a1;counterPool=tokenIs0?a1:a0;
 }else{
  if(data.length!==384)return null;
  // v4 PoolManager emits the CALLER's balance delta (negative = the swapper paid that currency INTO the pool).
  const a0=signed(w(0),128),a1=signed(w(1),128);tokenPool=-(tokenIs0?a0:a1);counterPool=-(tokenIs0?a1:a0);
 }
 const side=tokenPool<0n&&counterPool>0n?'BUY':tokenPool>0n&&counterPool<0n?'SELL':'SWAP';
 return {side,tokenPool,counterPool};
}
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicAddr=a=>'0x'+'0'.repeat(24)+a.slice(2);
async function reconcileTransfers(rpc,rows,state){
 const pools=[...new Map(rows.map(r=>[r.p.pool,r.p])).values()],tokens=[...new Set(pools.flatMap(p=>[p.token0,p.token1]))];
 let lo=rows[0].block,hi=rows[0].block;for(const r of rows){if(r.block<lo)lo=r.block;if(r.block>hi)hi=r.block;}
 const range={fromBlock:'0x'+lo.toString(16),toBlock:'0x'+hi.toString(16)},net=new Map(),ok=new Set();let calls=0;
 try{
  for(const dir of ['out','in']){
   calls++;state.logCalls++;
   const topics=dir==='out'?[TRANSFER,pools.map(p=>topicAddr(p.pool))]:[TRANSFER,null,pools.map(p=>topicAddr(p.pool))];
   const logs=await rpc.call('eth_getLogs',[{address:tokens,topics,...range}]);
   for(const l of Array.isArray(logs)?logs:[]){
    if(l?.removed===true||(l.topics||[]).length!==3||String(l.data||'').length!==66)continue;
    const pool='0x'+String(l.topics[dir==='out'?1:2]).slice(26).toLowerCase(),key=String(l.transactionHash).toLowerCase()+':'+pool+':'+String(l.address).toLowerCase();
    const v=BigInt(l.data);net.set(key,(net.get(key)||0n)+(dir==='in'?v:-v));
   }
  }
 }catch{return {ok,calls,status:'TRANSFER_LOGS_UNAVAILABLE'};}
 // Sum the decoded pool deltas per tx+pool, then require BOTH token legs to match the Transfer ledger exactly.
 const want=new Map();
 for(const r of rows){const k=String(r.l.transactionHash).toLowerCase()+':'+r.p.pool;const w=want.get(k)||{p:r.p,d0:0n,d1:0n};
  const tokenIs0=r.p.token0===r.p.token;w.d0+=tokenIs0?r.d.tokenPool:r.d.counterPool;w.d1+=tokenIs0?r.d.counterPool:r.d.tokenPool;want.set(k,w);}
 for(const [k,w] of want){
  if(w.d0!==0n&&w.d1!==0n&&(net.get(k+':'+w.p.token0)||0n)===w.d0&&(net.get(k+':'+w.p.token1)||0n)===w.d1)ok.add(k);
 }
 return {ok,calls,status:'OK',checked:want.size,matched:ok.size};
}
// V3: verified pools are scanned in GROUPS — all V2/V3 pools in one filter (address array, OR-ed Swap topics) and V4 pools per
// PoolManager (poolIds OR-ed in topic1). Same events, same per-log checks, a fraction of the eth_getLogs calls.
function groupsOf(pools){
 const plain=pools.filter(p=>p.kind!=='V4'),out=[];
 if(plain.length)out.push({pools:plain,filter:{address:plain.map(p=>p.emitter),topics:[[...new Set(plain.map(p=>TOPIC[p.kind]))]]}});
 const byMgr=new Map();for(const p of pools.filter(p=>p.kind==='V4')){if(!byMgr.has(p.emitter))byMgr.set(p.emitter,[]);byMgr.get(p.emitter).push(p);}
 for(const [mgr,list] of byMgr)out.push({pools:list,filter:{address:mgr,topics:[TOPIC.V4,list.map(p=>p.pool)]}});
 return out;
}
function poolOfLog(group,l){
 const emitter=String(l?.address||'').toLowerCase(),t=(l?.topics||[]).map(x=>String(x).toLowerCase());
 return group.pools.find(p=>p.emitter===emitter&&t[0]===TOPIC[p.kind]&&(p.kind!=='V4'||t[1]===p.pool))||null;
}
async function logsForGroup(rpc,group,from,to,state,maxSpan){
 const out=[];let hi=to;
 while(hi>=from&&state.logCalls<MAX_LOG_CALLS&&out.length<MAX_ROWS){
  let span=state.span,lo=hi-BigInt(span-1)<from?from:hi-BigInt(span-1);
  try{
   state.logCalls++;
   const logs=await rpc.call('eth_getLogs',[{...group.filter,fromBlock:'0x'+lo.toString(16),toBlock:'0x'+hi.toString(16)}]);
   if(!Array.isArray(logs))throw fail('RPC_MALFORMED_RESPONSE');
   for(const l of logs){if(l?.removed===true)continue;const p=poolOfLog(group,l);if(p)out.push({p,l});}
   hi=lo-1n;state.lowest=state.lowest===undefined||lo<state.lowest?lo:state.lowest;
   if(!logs.length)state.span=Math.min(maxSpan,state.span*2);
  }catch(e){
   if(state.span<=64)throw e;state.span=Math.max(64,Math.floor(state.span/2));
  }
 }
 return out;
}
async function logsFor(rpc,pool,from,to,state,maxSpan){
 const filter=pool.kind==='V4'?{address:pool.emitter,topics:[TOPIC.V4,pool.pool]}:{address:pool.pool,topics:[TOPIC[pool.kind]]};
 const out=[];let hi=to;
 while(hi>=from&&state.logCalls<MAX_LOG_CALLS&&out.length<MAX_ROWS){
  let span=state.span,lo=hi-BigInt(span-1)<from?from:hi-BigInt(span-1);
  try{
   state.logCalls++;
   const logs=await rpc.call('eth_getLogs',[{...filter,fromBlock:'0x'+lo.toString(16),toBlock:'0x'+hi.toString(16)}]);
   if(!Array.isArray(logs))throw fail('RPC_MALFORMED_RESPONSE');
   for(const l of logs){
    if(l?.removed===true)continue;  // reorged
    const emitter=String(l?.address||'').toLowerCase(),t=(l?.topics||[]).map(x=>String(x).toLowerCase());
    if(emitter!==pool.emitter||t[0]!==TOPIC[pool.kind]||(pool.kind==='V4'&&t[1]!==pool.pool))continue;
    out.push(l);
   }
   hi=lo-1n;state.lowest=state.lowest===undefined||lo<state.lowest?lo:state.lowest;
   if(!logs.length)state.span=Math.min(maxSpan,state.span*2);   // quiet market: widen the next (older) chunk
  }catch(e){
   if(state.span<=64)throw e;state.span=Math.max(64,Math.floor(state.span/2));   // provider range/size limits: narrow
  }
 }
 return out;
}
// ---- 6. USD -----------------------------------------------------------------------------------------------------
async function ethUsd(network,rpc,block,ethRpcFn=null){
 if(!ETH_PRICED[network])return null;
 const key='ethusd';const hit=metaCache.get(key);if(hit&&hit.at>Date.now()-60000)return hit.value?{...hit.value,crossChain:network!=='ethereum'}:null;
 try{
  // Same-chain pinned read on Ethereum; for Robinhood a separately pinned Ethereum block (bounded, 60 s cached).
  const call=network==='ethereum'?(m,p)=>rpc.call(m,p):(ethRpcFn||require('./eth').rpc);
  const at=network==='ethereum'?block:await call('eth_blockNumber',[]);
  const f=await require('./oracle-market').inspect('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',at,{rpcCall:call});
  const q=f?.priceUsd;const value=q?.dataState==='DATA_FOUND'&&Number.isFinite(q.value)?{price:q.value,source:'Chainlink ETH/USD on Ethereum (pinned block)',block:at,chainId:1,updatedAt:q.evidence?.[0]?.updatedAt||null}:null;
  remember(metaCache,key,{at:Date.now(),value});return value?{...value,crossChain:network!=='ethereum'}:null;
 }catch{return null;}
}
function usdOf(network,counter,counterAbs,ethPrice){
 const stable=USD_STABLES[network]?.[counter];
 if(stable)return {usd:toNumber(counterAbs,stable.decimals),usdStatus:'STABLECOIN_QUOTED',usdBasis:stable.symbol+' = $1 (counter asset)'};
 const eth=ETH_PRICED[network]?.[counter];
 // The label follows the chain, never a caller flag: any non-Ethereum ETH price is an Ethereum-mainnet reference.
 if(eth&&ethPrice){const cross=network!=='ethereum',n=toNumber(counterAbs,eth.decimals);return n===null?null:{usd:Number((n*ethPrice.price).toFixed(2)),usdStatus:cross?'ORACLE_PRICED_ETH_REFERENCE':'ORACLE_PRICED',
  usdBasis:cross?eth.symbol+' × Chainlink ETH/USD on Ethereum (cross-chain reference price)':ethPrice.source};}
 return {usd:null,usdStatus:'USD_NOT_VERIFIED',usdBasis:'No reviewed USD anchor for the counter asset on this chain'};
}
// ---- main -------------------------------------------------------------------------------------------------------
async function analyze({network,address,rpcFn=null,ethRpcFn=null,pools:poolsOverride=null,now=Date.now}={}){
 if(!Object.hasOwn(NET,network))throw fail('UNSUPPORTED_CHAIN');
 const token=String(address||'').toLowerCase();if(!ADDRESS.test(token))throw fail('VALID_TOKEN_REQUIRED');
 const cfg=chain(network),net=NET[network],rpc=budget(network,rpcFn||net.rpc());
 const head=await rpc.call('eth_getBlockByNumber',['latest',false]);
 const headNumber=BigInt(head?.number||'0x0'),headTs=Number(BigInt(head?.timestamp||'0x0'));
 if(headNumber<=0n||!headTs)throw fail('RPC_HEAD_UNAVAILABLE');
 const toBlock=headNumber-BigInt(net.confirmations),pinned='0x'+toBlock.toString(16);
 const headAgeS=Math.max(0,Math.floor(now()/1000)-headTs);
 // 1. candidates (provider-reported; cached/single-flight GeckoTerminal client shared with the Liquidity card)
 let candidates=poolsOverride;
 if(!candidates){
  const gecko=require('./gecko-market');
  const body=await gecko.json('https://api.geckoterminal.com/api/v2/networks/'+gecko.NETWORK_IDS[network]+'/tokens/'+token+'/pools?page=1&include=base_token,quote_token,dex');
  candidates=gecko.normalizePools(body,network,token).map(p=>{const t=p.attributes?.transactions?.h24||{};return {pool:p.pool,dex:p.dex,reserveUsd:Number(p.attributes?.reserve_in_usd)||0,
   volume24hUsd:Number(p.attributes?.volume_usd?.h24)||0,trades24h:(Number(t.buys)||0)+(Number(t.sells)||0)};});
 }
 // Live Trading shows recent swaps, so the most ACTIVE pools (provider-reported 24h trades) are verified first; reserve breaks ties.
 // Ordering only: every pool still has to pass the same on-chain identity checks.
 candidates=[...candidates].sort((a,b)=>(b.trades24h||0)-(a.trades24h||0)||(b.reserveUsd||0)-(a.reserveUsd||0)).slice(0,8);
 // 2. identity (bounded: stop after MAX_POOLS verified pools)
 const pools=[],excluded=[];
 for(const c of candidates){
  if(pools.length>=MAX_POOLS)break;
  let r;try{r=await identifyPool(network,rpc,token,c,pinned);}catch(e){r={excluded:e.code||'RPC_READ_FAILED'};}
  if(r.excluded)excluded.push({pool:c.pool,dex:c.dex||null,reasonCode:r.excluded,providerTrades24h:c.trades24h??null,providerVolume24hUsd:c.volume24hUsd??null});else pools.push({...r,providerTrades24h:c.trades24h??null});
 }
 const meta=await tokenMeta(network,rpc,token,pinned);
 const base={ok:true,readOnly:true,network:cfg.id,chainId:cfg.chainId,token,tokenSymbol:meta.symbol,headBlock:headNumber.toString(),toBlock:toBlock.toString(),
  headTimestamp:new Date(headTs*1000).toISOString(),headAgeSeconds:headAgeS,confirmations:net.confirmations,observedAt:new Date(now()).toISOString(),
  pools:pools.map(p=>({pool:p.pool,kind:p.kind,protocol:p.protocol,dex:p.dex,counter:p.counter,identity:p.reconcile?'REGISTRY_PROVEN_TRANSFER_RECONCILED':'ONCHAIN_VERIFIED',method:p.method,providerTrades24h:p.providerTrades24h??null})),excludedPools:excluded,
  scope:'Swaps emitted by on-chain-verified pools of this exact contract in a bounded recent block window. Not every venue or aggregator route; not investment advice.'};
 // Provider-reported activity on pools we cannot verify: never silently treated as "no swaps".
 const activeExcluded=excluded.filter(x=>(x.providerTrades24h||0)>0);
 const coverage={verifiedPools:pools.length,excludedPools:excluded.length,excludedActivePools:activeExcluded.length,
  providerTrades24hExcluded:activeExcluded.reduce((n,x)=>n+(x.providerTrades24h||0),0),providerTrades24hVerified:pools.reduce((n,p)=>n+(p.providerTrades24h||0),0),
  complete:activeExcluded.length===0,note:activeExcluded.length?'Some active pools use DEX contracts that are not yet reviewed; their swaps are not shown.':null};
 if(!pools.length)return {...base,coverage,status:activeExcluded.length?'COVERAGE_INCOMPLETE':'UNSUPPORTED',reasonCode:activeExcluded.length?'ACTIVE_POOLS_UNSUPPORTED':candidates.length?'NO_VERIFIED_POOL':'NO_POOL_CANDIDATES',trades:[],cost:{rpcCalls:rpc.calls.n}};
 // 3. logs
 const state={span:net.window,logCalls:0},from=toBlock-BigInt(net.lookback)>0n?toBlock-BigInt(net.lookback):0n;
 // Incremental refresh: with the same verified pool set, only blocks after the previous confirmed window are read.
 const incKey=network+':'+token,poolsKey=pools.map(p=>p.pool).join(','),prev=incremental.get(incKey);
 let found=[],mode='FULL_WINDOW',scanFrom=from;
 if(prev&&prev.poolsKey===poolsKey&&toBlock>=prev.toBlock&&toBlock-prev.toBlock<=BigInt(net.maxSpan)){
  mode='INCREMENTAL';scanFrom=prev.toBlock+1n;
  const byPool=new Map(pools.map(p=>[p.pool,p]));
  found=prev.logs.filter(x=>byPool.has(x.pool)&&BigInt(x.l.blockNumber)>=from).map(x=>({p:byPool.get(x.pool),l:x.l}));
  if(scanFrom<=toBlock)for(const g of groupsOf(pools)){state.span=net.maxSpan;found.push(...await logsForGroup(rpc,g,scanFrom,toBlock,state,net.maxSpan));}
 }else for(const g of groupsOf(pools)){state.span=net.window;found.push(...await logsForGroup(rpc,g,from,toBlock,state,net.maxSpan));}
 const seen=new Set(),rows=[];
 for(const {p,l} of found){
  const key=String(l.transactionHash).toLowerCase()+':'+String(l.logIndex);if(seen.has(key))continue;seen.add(key);
  const d=decodeSwap(p,l);if(!d)continue;
  rows.push({p,l,d,block:BigInt(l.blockNumber),logIndex:Number(BigInt(l.logIndex))});
 }
 rows.sort((a,b)=>a.block===b.block?b.logIndex-a.logIndex:(b.block>a.block?1:-1));
 remember(incremental,incKey,{toBlock,poolsKey,logs:rows.slice(0,KEEP_LOGS).map(r=>({pool:r.p.pool,l:r.l}))},200);
 let top=rows.slice(0,MAX_ROWS);
 // Transfer reconciliation for unreviewed V3-interface pools (two eth_getLogs calls cover every such row).
 const rec=top.filter(r=>r.p.reconcile);let reconciled=null;
 if(rec.length){
  reconciled=await reconcileTransfers(rpc,rec,state);
  top=top.filter(r=>!r.p.reconcile||reconciled.ok.has(String(r.l.transactionHash).toLowerCase()+':'+r.p.pool));
 }
 // 5. per-row block binding and sender (bounded, cached; reorg = hash mismatch -> dropped)
 let reads=0;const counterMeta=new Map(),txCount=new Map();
 for(const r of rows)txCount.set(r.l.transactionHash,(txCount.get(r.l.transactionHash)||0)+1);
 const ethPrice=pools.some(p=>ETH_PRICED[network]?.[p.counter])?await ethUsd(network,rpc,pinned,ethRpcFn):null;
 // Per-row block binding and sender, bounded concurrency (4); results kept in event order.
 const rowsOut=new Array(top.length).fill(null);let cursor=0;
 const blockRead=async n=>{const bkey=network+':'+n;let blk=blockCache.get(bkey);if(blk)return blk;if(reads>=MAX_ROW_READS)return null;reads++;
  const b=await rpc.call('eth_getBlockByNumber',[n,false]).catch(()=>null);return b?.hash?remember(blockCache,bkey,{hash:String(b.hash).toLowerCase(),timestamp:Number(BigInt(b.timestamp))},4000):null;};
 const pendingBlocks=new Map(),blockOnce=n=>{if(!pendingBlocks.has(n))pendingBlocks.set(n,blockRead(n));return pendingBlocks.get(n);};
 async function one(i){
  const r=top[i],logHash=String(r.l.blockHash||'').toLowerCase();
  // V3 binding: the node's own transaction record must place the tx in the SAME block hash as the log (reorg -> dropped).
  // A separate block read is only needed when the log does not carry its block timestamp.
  const tkey=network+':'+String(r.l.transactionHash).toLowerCase();let tx=txCache.get(tkey);
  if(!tx){if(reads>=MAX_ROW_READS)return;reads++;const t=await rpc.call('eth_getTransactionByHash',[r.l.transactionHash]).catch(()=>null);
   if(t?.from&&t.blockHash)tx=remember(txCache,tkey,{from:String(t.from).toLowerCase(),to:String(t.to||'').toLowerCase(),blockHash:String(t.blockHash).toLowerCase()},4000);}
  if(!tx||tx.blockHash!==logHash)return;   // unbound or reorged: never displayed
  const lts=/^0x[0-9a-f]{1,16}$/i.test(r.l.blockTimestamp||'')?Number(BigInt(r.l.blockTimestamp)):null;
  const blk=lts?{hash:logHash,timestamp:lts}:await blockOnce(r.l.blockNumber);
  if(!blk||blk.hash!==logHash)return;
  if(!counterMeta.has(r.p.counter))counterMeta.set(r.p.counter,tokenMeta(network,rpc,r.p.counter,pinned).catch(()=>null));
  const cm=await counterMeta.get(r.p.counter);if(!cm)return;
  const tokenAbs=r.d.tokenPool<0n?-r.d.tokenPool:r.d.tokenPool,counterAbs=r.d.counterPool<0n?-r.d.counterPool:r.d.counterPool;
  const usd=usdOf(network,r.p.counter,counterAbs,ethPrice);
  const route=(txCount.get(r.l.transactionHash)||0)>1?'MULTI_HOP':(tx.to&&tx.to!==r.p.emitter)?'ROUTER':'DIRECT';
  rowsOut[i]={side:r.d.side,tokenAmount:units(tokenAbs,meta.decimals),counterAmount:units(counterAbs,cm.decimals),counterSymbol:cm.symbol,counter:r.p.counter,
   usd:usd.usd,usdStatus:usd.usdStatus,usdBasis:usd.usdBasis,wallet:tx.from,route,txHash:String(r.l.transactionHash).toLowerCase(),logIndex:r.logIndex,
   block:r.block.toString(),blockHash:blk.hash,timestamp:new Date(blk.timestamp*1000).toISOString(),pool:r.p.pool,poolKind:r.p.kind,protocol:r.p.protocol,
   explorerUrl:cfg.explorer+'/tx/'+String(r.l.transactionHash).toLowerCase(),verification:r.p.reconcile?'ONCHAIN_TRANSFER_RECONCILED':'ONCHAIN_VERIFIED'};
 }
 await Promise.all(Array.from({length:Math.min(ROW_CONCURRENCY,top.length)},async()=>{while(cursor<top.length)await one(cursor++);}));
 const trades=rowsOut.filter(Boolean);
 // Honest window: the oldest block actually scanned (the log budget can stop before the intended lookback).
 const scannedFrom=mode==='INCREMENTAL'?(prev.scannedFrom??scanFrom):state.lowest!==undefined?state.lowest:toBlock;
 {const e=incremental.get(incKey);if(e)e.scannedFrom=scannedFrom;}
 let scannedSince=null;if(!trades.length&&scannedFrom<=toBlock){const b=await blockRead('0x'+scannedFrom.toString(16));if(b)scannedSince=new Date(b.timestamp*1000).toISOString();}
 const live=headAgeS<=net.maxHeadAgeS;
 const status=trades.length?(live?'LIVE':'DELAYED'):activeExcluded.length?'COVERAGE_INCOMPLETE':'NO_RECENT_SWAPS';
 if(reconciled)base.reconciliation={status:reconciled.status,checked:reconciled.checked??0,matched:reconciled.matched??0,method:'Swap deltas must equal the tokens\' own Transfer events into/out of the pool in the same tx'};
 return {...base,coverage,status,reasonCode:trades.length?null:activeExcluded.length?'ACTIVE_POOLS_UNSUPPORTED':'NO_SWAPS_IN_WINDOW',lastTradeAt:trades[0]?.timestamp||null,
  window:{fromBlock:from.toString(),scanFrom:scanFrom.toString(),scannedFromBlock:scannedFrom.toString(),scannedSince,toBlock:toBlock.toString(),mode,logCalls:state.logCalls,finalSpan:state.span,lookbackComplete:scannedFrom<=from},ethUsd:ethPrice,trades,cost:{rpcCalls:rpc.calls.n}};
}
function classify(e){
 const code=/^[A-Z][A-Z0-9_]{2,63}$/.test(e?.code||'')?e.code:/429/.test(String(e?.message))?'RPC_RATE_LIMITED':/GeckoTerminal/.test(String(e?.message))?'POOL_SOURCE_UNAVAILABLE':'PROVIDER_UNAVAILABLE';
 return {ok:false,readOnly:true,status:'UNAVAILABLE',reasonCode:code,trades:[]};
}
// Single-flight + short cache per chain:token; bounded concurrent builds across tokens.
async function cached({network,address},run=analyze,now=Date.now){
 const key=network+':'+String(address).toLowerCase(),hit=cache.get(key);
 if(hit&&now()-hit.at<CACHE_MS)return {...hit.value,cacheAgeSeconds:Math.floor((now()-hit.at)/1000)};
 if(inflight.has(key))return inflight.get(key);
 if(running>=MAX_INFLIGHT)return {ok:false,readOnly:true,status:'BUSY',reasonCode:'LIVE_TRADES_BUSY',trades:[]};
 running++;
 const task=(async()=>{try{const value=await run({network,address});remember(cache,key,{at:now(),value},200);return {...value,cacheAgeSeconds:0};}
  catch(e){return classify(e);}finally{running--;inflight.delete(key);}})();
 inflight.set(key,task);return task;
}
module.exports={analyze,KEEP_LOGS,TRADE_VENUES,CANONICAL_V3,maskCode,cached,classify,decodeSwap,identifyPool,usdOf,units,TOPIC,NET,USD_STABLES,MAX_ROWS,
 _groupsOf:groupsOf,_reset:()=>{for(const m of [cache,inflight,incremental,identityCache,metaCache,txCache,blockCache,canonicalRef])m.clear();running=0;}};
