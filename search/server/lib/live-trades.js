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
 getPair:sel('getPair(address,address)'),getPool:sel('getPool(address,address,uint24)'),decimals:sel('decimals()'),symbol:sel('symbol()')});
const ZERO='0x0000000000000000000000000000000000000000';
// Reviewed USD-denominated counter assets (exact chain + contract). Arc's native gas token IS USDC (18 decimals natively;
// its ERC-20 interface at 0x3600… uses 6). Values are labelled "USDC/USDT/DAI-quoted", i.e. 1 unit treated as $1.
const USD_STABLES=Object.freeze({
 arc:Object.freeze({[ZERO]:{symbol:'USDC',decimals:18,native:true},'0x3600000000000000000000000000000000000000':{symbol:'USDC',decimals:6}}),
 ethereum:Object.freeze({'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':{symbol:'USDC',decimals:6},'0xdac17f958d2ee523a2206206994597c13d831ec7':{symbol:'USDT',decimals:6},
  '0x6b175474e89094c44da98b954eedeac495271d0f':{symbol:'DAI',decimals:18}}),
 robinhood:Object.freeze({})
});
const ETH_PRICED=Object.freeze({ethereum:Object.freeze({[ZERO]:{symbol:'ETH',decimals:18},'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':{symbol:'WETH',decimals:18}})});
const NATIVE=Object.freeze({arc:{symbol:'USDC',decimals:18},ethereum:{symbol:'ETH',decimals:18},robinhood:{symbol:'ETH',decimals:18}});
const NET=Object.freeze({
 // window: first span per log query (grows x2 on empty answers up to maxSpan, halves on provider range/size errors);
 // lookback: max blocks examined (~24 h of blocks); confirmations: blocks withheld from the head.
 ethereum:{rpc:()=>require('./eth').rpc,window:600,maxSpan:2000,lookback:7200,confirmations:2,paceMs:0,maxHeadAgeS:90},
 arc:{rpc:()=>require('./arc-rpc').rpc,window:1500,maxSpan:60000,lookback:520000,confirmations:0,paceMs:220,maxHeadAgeS:30},
 robinhood:{rpc:()=>require('./robinhood-rpc').rpc,window:3000,maxSpan:100000,lookback:860000,confirmations:0,paceMs:120,maxHeadAgeS:30}
});
const MAX_POOLS=3,MAX_ROWS=20,MAX_LOG_CALLS=10,MAX_ROW_READS=40,KEEP_LOGS=60,CACHE_MS=20000,IDENTITY_CACHE=500,MAX_INFLIGHT=3;
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
  return rpcFn(method,params);
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
  }else return {excluded:'UNREVIEWED_FACTORY',factory};
 }else return {excluded:'POOL_ID_INVALID'};
 out.token=token;out.counter=out.token0===token?out.token1:out.token0;out.dex=candidate.dex||null;
 return remember(identityCache,key,out);
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
   hi=lo-1n;
   if(!logs.length)state.span=Math.min(maxSpan,state.span*2);   // quiet market: widen the next (older) chunk
  }catch(e){
   if(state.span<=64)throw e;state.span=Math.max(64,Math.floor(state.span/2));   // provider range/size limits: narrow
  }
 }
 return out;
}
// ---- 6. USD -----------------------------------------------------------------------------------------------------
async function ethUsd(network,rpc,block){
 if(network!=='ethereum')return null;
 const key='ethusd';const hit=metaCache.get(key);if(hit&&hit.at>Date.now()-60000)return hit.value;
 try{
  const f=await require('./oracle-market').inspect('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',block,{rpcCall:(m,p)=>rpc.call(m,p)});
  const q=f?.priceUsd;const value=q?.dataState==='DATA_FOUND'&&Number.isFinite(q.value)?{price:q.value,source:'Chainlink ETH/USD (pinned block)',block,updatedAt:q.evidence?.[0]?.updatedAt||null}:null;
  remember(metaCache,key,{at:Date.now(),value});return value;
 }catch{return null;}
}
function usdOf(network,counter,counterAbs,ethPrice){
 const stable=USD_STABLES[network]?.[counter];
 if(stable)return {usd:toNumber(counterAbs,stable.decimals),usdStatus:'STABLECOIN_QUOTED',usdBasis:stable.symbol+' = $1 (counter asset)'};
 const eth=ETH_PRICED[network]?.[counter];
 if(eth&&ethPrice){const n=toNumber(counterAbs,eth.decimals);return n===null?null:{usd:Number((n*ethPrice.price).toFixed(2)),usdStatus:'ORACLE_PRICED',usdBasis:ethPrice.source};}
 return {usd:null,usdStatus:'USD_NOT_VERIFIED',usdBasis:'No reviewed USD anchor for the counter asset on this chain'};
}
// ---- main -------------------------------------------------------------------------------------------------------
async function analyze({network,address,rpcFn=null,pools:poolsOverride=null,now=Date.now}={}){
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
  candidates=gecko.normalizePools(body,network,token).map(p=>({pool:p.pool,dex:p.dex,reserveUsd:Number(p.attributes?.reserve_in_usd)||0}));
 }
 candidates=[...candidates].sort((a,b)=>(b.reserveUsd||0)-(a.reserveUsd||0)).slice(0,8);
 // 2. identity (bounded: stop after MAX_POOLS verified pools)
 const pools=[],excluded=[];
 for(const c of candidates){
  if(pools.length>=MAX_POOLS)break;
  let r;try{r=await identifyPool(network,rpc,token,c,pinned);}catch(e){r={excluded:e.code||'RPC_READ_FAILED'};}
  if(r.excluded)excluded.push({pool:c.pool,dex:c.dex||null,reasonCode:r.excluded});else pools.push(r);
 }
 const meta=await tokenMeta(network,rpc,token,pinned);
 const base={ok:true,readOnly:true,network:cfg.id,chainId:cfg.chainId,token,tokenSymbol:meta.symbol,headBlock:headNumber.toString(),toBlock:toBlock.toString(),
  headTimestamp:new Date(headTs*1000).toISOString(),headAgeSeconds:headAgeS,confirmations:net.confirmations,observedAt:new Date(now()).toISOString(),
  pools:pools.map(p=>({pool:p.pool,kind:p.kind,protocol:p.protocol,dex:p.dex,counter:p.counter,identity:'ONCHAIN_VERIFIED',method:p.method})),excludedPools:excluded,
  scope:'Swaps emitted by on-chain-verified pools of this exact contract in a bounded recent block window. Not every venue or aggregator route; not investment advice.'};
 if(!pools.length)return {...base,status:'UNSUPPORTED',reasonCode:candidates.length?'NO_VERIFIED_POOL':'NO_POOL_CANDIDATES',trades:[],cost:{rpcCalls:rpc.calls.n}};
 // 3. logs
 const state={span:net.window,logCalls:0},from=toBlock-BigInt(net.lookback)>0n?toBlock-BigInt(net.lookback):0n;
 // Incremental refresh: with the same verified pool set, only blocks after the previous confirmed window are read.
 const incKey=network+':'+token,poolsKey=pools.map(p=>p.pool).join(','),prev=incremental.get(incKey);
 let found=[],mode='FULL_WINDOW',scanFrom=from;
 if(prev&&prev.poolsKey===poolsKey&&toBlock>=prev.toBlock&&toBlock-prev.toBlock<=BigInt(net.maxSpan)){
  mode='INCREMENTAL';scanFrom=prev.toBlock+1n;
  const byPool=new Map(pools.map(p=>[p.pool,p]));
  found=prev.logs.filter(x=>byPool.has(x.pool)&&BigInt(x.l.blockNumber)>=from).map(x=>({p:byPool.get(x.pool),l:x.l}));
  if(scanFrom<=toBlock)for(const p of pools){state.span=net.maxSpan;for(const l of await logsFor(rpc,p,scanFrom,toBlock,state,net.maxSpan))found.push({p,l});}
 }else for(const p of pools){state.span=net.window;for(const l of await logsFor(rpc,p,from,toBlock,state,net.maxSpan))found.push({p,l});}
 const seen=new Set(),rows=[];
 for(const {p,l} of found){
  const key=String(l.transactionHash).toLowerCase()+':'+String(l.logIndex);if(seen.has(key))continue;seen.add(key);
  const d=decodeSwap(p,l);if(!d)continue;
  rows.push({p,l,d,block:BigInt(l.blockNumber),logIndex:Number(BigInt(l.logIndex))});
 }
 rows.sort((a,b)=>a.block===b.block?b.logIndex-a.logIndex:(b.block>a.block?1:-1));
 remember(incremental,incKey,{toBlock,poolsKey,logs:rows.slice(0,KEEP_LOGS).map(r=>({pool:r.p.pool,l:r.l}))},200);
 const top=rows.slice(0,MAX_ROWS);
 // 5. per-row block binding and sender (bounded, cached; reorg = hash mismatch -> dropped)
 let reads=0;const counterMeta=new Map(),txCount=new Map();
 for(const r of rows)txCount.set(r.l.transactionHash,(txCount.get(r.l.transactionHash)||0)+1);
 const ethPrice=pools.some(p=>ETH_PRICED[network]?.[p.counter])?await ethUsd(network,rpc,pinned):null;
 const trades=[];
 for(const r of top){
  const bkey=network+':'+r.l.blockNumber;let blk=blockCache.get(bkey);
  if(!blk){if(reads>=MAX_ROW_READS)break;reads++;const b=await rpc.call('eth_getBlockByNumber',[r.l.blockNumber,false]).catch(()=>null);
   if(b?.hash)blk=remember(blockCache,bkey,{hash:String(b.hash).toLowerCase(),timestamp:Number(BigInt(b.timestamp))},4000);}
  if(!blk||blk.hash!==String(r.l.blockHash).toLowerCase())continue;   // unbound or reorged: never displayed
  const tkey=network+':'+String(r.l.transactionHash).toLowerCase();let tx=txCache.get(tkey);
  if(!tx){if(reads>=MAX_ROW_READS)break;reads++;const t=await rpc.call('eth_getTransactionByHash',[r.l.transactionHash]).catch(()=>null);
   if(t?.from&&String(t.blockHash||'').toLowerCase()===blk.hash)tx=remember(txCache,tkey,{from:String(t.from).toLowerCase(),to:String(t.to||'').toLowerCase()},4000);}
  if(!tx)continue;
  if(!counterMeta.has(r.p.counter))counterMeta.set(r.p.counter,await tokenMeta(network,rpc,r.p.counter,pinned).catch(()=>null));
  const cm=counterMeta.get(r.p.counter);if(!cm)continue;
  const tokenAbs=r.d.tokenPool<0n?-r.d.tokenPool:r.d.tokenPool,counterAbs=r.d.counterPool<0n?-r.d.counterPool:r.d.counterPool;
  const usd=usdOf(network,r.p.counter,counterAbs,ethPrice);
  const route=(txCount.get(r.l.transactionHash)||0)>1?'MULTI_HOP':(tx.to&&tx.to!==r.p.emitter)?'ROUTER':'DIRECT';
  trades.push({side:r.d.side,tokenAmount:units(tokenAbs,meta.decimals),counterAmount:units(counterAbs,cm.decimals),counterSymbol:cm.symbol,counter:r.p.counter,
   usd:usd.usd,usdStatus:usd.usdStatus,usdBasis:usd.usdBasis,wallet:tx.from,route,txHash:String(r.l.transactionHash).toLowerCase(),logIndex:r.logIndex,
   block:r.block.toString(),blockHash:blk.hash,timestamp:new Date(blk.timestamp*1000).toISOString(),pool:r.p.pool,poolKind:r.p.kind,protocol:r.p.protocol,
   explorerUrl:cfg.explorer+'/tx/'+String(r.l.transactionHash).toLowerCase(),verification:'ONCHAIN_VERIFIED'});
 }
 const live=headAgeS<=net.maxHeadAgeS;
 return {...base,status:trades.length?(live?'LIVE':'DELAYED'):'NO_RECENT_SWAPS',reasonCode:trades.length?null:'NO_SWAPS_IN_WINDOW',
  window:{fromBlock:from.toString(),scanFrom:scanFrom.toString(),toBlock:toBlock.toString(),mode,logCalls:state.logCalls,finalSpan:state.span},ethUsd:ethPrice,trades,cost:{rpcCalls:rpc.calls.n}};
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
module.exports={analyze,KEEP_LOGS,cached,classify,decodeSwap,identifyPool,usdOf,units,TOPIC,NET,USD_STABLES,MAX_ROWS,
 _reset:()=>{for(const m of [cache,inflight,incremental,identityCache,metaCache,txCache,blockCache])m.clear();running=0;}};
