'use strict';
// Radar Intelligence — bounded on-chain evidence (issue #279). Read-only JSON-RPC through an injected rpc(method,params)
// (production: the existing Arc / Ethereum / Robinhood read-only RPC clients with failover). No archive state, no indexer,
// no new storage. Four evidence kinds:
//   1. history  : daily closing price + liquidity witness per exact pool, sampled from the pool's own Swap/Sync events
//                 at UTC day boundaries (V2 Sync reserves, V3/V4 sqrtPriceX96 + active liquidity). Pool identity is proven
//                 against REVIEWED factories / PoolManager first. Only USD-stable or ETH quotes (ETH priced from the reviewed
//                 Ethereum USDC/WETH pool at the same timestamps) produce USD candles; anything else stays NOT_VERIFIED.
//   2. demand   : distinct final buyers, top-buyer share and buy/sell overlap from the token's own Transfer logs in a
//                 recent bounded window, following each transaction's transfer chain out of the pool / PoolManager.
//   3. contract : bytecode facts (code present, EIP-1967 proxy slots, PUSH4 selector scan, DELEGATECALL/SELFDESTRUCT).
//   4. sell     : eth_call of transfer(pool, smallAmount) FROM a real recent buyer — proves a sell transfer is not blocked
//                 for that holder at that block (fee-on-transfer is NOT modelled).
// Every function returns plain data; the engine seals what it trusts. Missing/partial reads are reported, never zero-filled.
const keccak=require('../../keccak');
const v2x=require('../../liquidity-exit-v2'),v3x=require('../../liquidity-exit-v3'),v4x=require('../../liquidity-exit-v4');
const topic=s=>keccak(Buffer.from(s)).toLowerCase();
const sel=s=>topic(s).slice(0,10);
const T=Object.freeze({
 TRANSFER:topic('Transfer(address,address,uint256)'),SYNC:topic('Sync(uint112,uint112)'),
 V3_SWAP:topic('Swap(address,address,int256,int256,uint160,uint128,int24)'),
 V4_SWAP:topic('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')
});
const S=Object.freeze({factory:sel('factory()'),token0:sel('token0()'),token1:sel('token1()'),decimals:sel('decimals()'),balanceOf:sel('balanceOf(address)'),
 transfer:sel('transfer(address,uint256)'),owner:sel('owner()'),getReserves:sel('getReserves()')});
const ZERO='0x0000000000000000000000000000000000000000',DEAD='0x000000000000000000000000000000000000dead';
const DAY=86400000,ADDRESS=/^0x[0-9a-f]{40}$/,POOL_ID=/^0x[0-9a-f]{64}$/;
// Reviewed venues come from the existing, separately reviewed Liquidity & Exit engines (no new addresses introduced here).
const REVIEWED=Object.freeze({
 v2:Object.freeze(Object.fromEntries(['arc','ethereum','robinhood'].map(n=>[n,(v2x.PROTOCOLS[n]||[]).map(p=>p.factory)]))),
 v3:Object.freeze(Object.fromEntries(['arc','ethereum','robinhood'].map(n=>[n,(v3x.PROTOCOLS[n]||[]).map(p=>p.factory)]))),
 v4:Object.freeze(Object.fromEntries(['arc','ethereum','robinhood'].map(n=>[n,(v4x.PROTOCOLS[n]||[]).map(p=>({poolManager:p.poolManager,positionManager:p.positionManager}))])))
});
// USD-stable quote assets (exact contracts). Arc's native gas token is USDC (18 decimals); 0x3600… is its 6-decimal ERC-20 interface.
const STABLES=Object.freeze({
 arc:Object.freeze([ZERO,'0x3600000000000000000000000000000000000000']),
 ethereum:Object.freeze(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','0xdac17f958d2ee523a2206206994597c13d831ec7','0x6b175474e89094c44da98b954eedeac495271d0f']),
 robinhood:Object.freeze(['0x5fc5360d0400a0fd4f2af552add042d716f1d168'])
});
const ETH_QUOTES=Object.freeze({ethereum:Object.freeze([ZERO,'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']),robinhood:Object.freeze([ZERO,'0x0bd7d308f8e1639fab988df18a8011f41eacad73']),arc:Object.freeze([])});
// ETH/USD reference: Uniswap V3 USDC/WETH 0.05% on Ethereum (factory 0x1f98… is reviewed in liquidity-exit-v3).
const ETH_REFERENCE=Object.freeze({network:'ethereum',pool:'0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',token0:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',token1:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',dec0:6,dec1:18});
const EXPLORER=Object.freeze({arc:'https://explorer.arc.io',ethereum:'https://eth.blockscout.com',robinhood:'https://robinhoodchain.blockscout.com'});
// Blocks per hour (approximate, only used to size log windows; the window end is always located by real block timestamps).
const BLOCKS_PER_HOUR=Object.freeze({arc:21000,ethereum:300,robinhood:36000});
const MAX_SPAN=Object.freeze({arc:20000,ethereum:2000,robinhood:100000});
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
const hexN=v=>'0x'+BigInt(v).toString(16);
const word=w=>BigInt('0x'+(w||'0'));
const addrOf=w=>'0x'+String(w).slice(-40).toLowerCase();
const signedWord=(hex,bits=256)=>{const v=BigInt('0x'+hex),m=1n<<BigInt(bits);const t=v&(m-1n);return t>=m/2n?t-m:t;};
const isBlocked=(e)=>/RATE|429|BUDGET|TIMEOUT|UNREACHABLE|LIMIT|5\d\d/i.test(String(e?.code||e?.message||''));
// A metered rpc wrapper: per-run call budget, call counting. Never retries writes (there are none: read-only methods only).
const READ=new Set(['eth_blockNumber','eth_getBlockByNumber','eth_getLogs','eth_call','eth_getCode','eth_getStorageAt','eth_chainId']);
function metered(rpc,budget){
 return async(method,params)=>{
  if(!READ.has(method))throw fail('INTEL_RPC_METHOD_NOT_ALLOWED');
  if(budget.used>=budget.max)throw fail('INTEL_RPC_BUDGET_EXHAUSTED');
  budget.used++;return rpc(method,params);
 };
}
const parseBlock=b=>{if(!b||!/^0x[0-9a-f]+$/i.test(b.number||'')||!/^0x[0-9a-f]+$/i.test(b.timestamp||''))throw fail('INTEL_RPC_MALFORMED_BLOCK');return {number:Number(BigInt(b.number)),timestamp:Number(BigInt(b.timestamp))};};
// Finds the highest block with timestamp <= targetSec (within tolerance) using secant steps on real block headers.
async function blockAt(call,network,targetSec,cache,head){
 const key=network+':'+targetSec;if(cache.has(key))return cache.get(key);
 if(targetSec>=head.timestamp){cache.set(key,head);return head;}
 const rate=head.rate;let guess=Math.max(1,Math.floor(head.number-(head.timestamp-targetSec)/rate)),best=null;
 for(let i=0;i<5;i++){
  const b=parseBlock(await call('eth_getBlockByNumber',[hexN(guess),false]));
  if(b.timestamp<=targetSec&&(!best||b.number>best.number))best=b;
  const diff=targetSec-b.timestamp;
  if(diff>=0&&diff<=900)break;
  guess=Math.max(1,Math.floor(b.number+diff/rate)-(diff<0?2:0));
 }
 if(!best)throw fail('INTEL_BLOCK_AT_TIME_NOT_FOUND');
 cache.set(key,best);return best;
}
async function headOf(call,network){
 const h=parseBlock(await call('eth_getBlockByNumber',['latest',false]));
 const back=Math.max(1,Math.min(h.number-1,BLOCKS_PER_HOUR[network]*24));
 const p=parseBlock(await call('eth_getBlockByNumber',[hexN(h.number-back),false]));
 const rate=(h.number-p.number)/Math.max(1,h.timestamp-p.timestamp);
 if(!(rate>0))throw fail('INTEL_BLOCK_RATE_INVALID');
 return {...h,rate};
}
async function ethCall(call,to,data,block='latest'){const r=await call('eth_call',[{to,data},block]);if(typeof r!=='string'||!/^0x[0-9a-f]*$/i.test(r))throw fail('INTEL_RPC_MALFORMED_CALL');return r;}
async function decimalsOf(call,token,memo){
 if(token===ZERO)return 18;
 if(memo.has(token))return memo.get(token);
 const r=await ethCall(call,token,S.decimals);const d=Number(word(r.slice(2,66)));
 if(!Number.isInteger(d)||d<0||d>36)throw fail('INTEL_DECIMALS_INVALID');
 memo.set(token,d);return d;
}
// ── Pool identity ──────────────────────────────────────────────────────────────────────────────────────────
async function identify(call,network,pool,token,quote){
 const t=String(token).toLowerCase(),q=String(quote||'').toLowerCase();
 if(!ADDRESS.test(t)||!ADDRESS.test(q))return {ok:false,reason:'POOL_TOKEN_OR_QUOTE_INVALID'};
 const [token0,token1]=t<q?[t,q]:[q,t];
 if(POOL_ID.test(String(pool).toLowerCase())){
  const id=String(pool).toLowerCase();
  for(const m of REVIEWED.v4[network]||[]){
   try{
    const raw=await ethCall(call,m.positionManager,v4x.poolKeyData(id));
    const key=v4x.decodePoolKey(raw,id);
    if(String(key.currency0).toLowerCase()===token0&&String(key.currency1).toLowerCase()===token1)
     return {ok:true,kind:'V4',pool:id,emitter:m.poolManager,token0,token1,venue:'REVIEWED_UNISWAP_V4',identity:'PositionManager.poolKeys(bytes25) recomputes the PoolId and binds the exact currencies'};
    return {ok:false,reason:'POOL_CURRENCIES_MISMATCH'};
   }catch(e){if(isBlocked(e))throw e;}
  }
  return {ok:false,reason:'POOL_MANAGER_NOT_REVIEWED'};
 }
 const p=String(pool).toLowerCase();
 if(!ADDRESS.test(p))return {ok:false,reason:'POOL_ADDRESS_INVALID'};
 let factory,c0,c1;
 try{factory=addrOf((await ethCall(call,p,S.factory)).slice(2,66));c0=addrOf((await ethCall(call,p,S.token0)).slice(2,66));c1=addrOf((await ethCall(call,p,S.token1)).slice(2,66));}
 catch(e){if(isBlocked(e))throw e;return {ok:false,reason:'POOL_INTERFACE_NOT_READABLE'};}
 if(c0!==token0||c1!==token1)return {ok:false,reason:'POOL_TOKENS_MISMATCH'};
 if((REVIEWED.v2[network]||[]).includes(factory))return {ok:true,kind:'V2',pool:p,emitter:p,token0,token1,factory,venue:'REVIEWED_V2_FACTORY',identity:'pool.factory() is a reviewed V2 factory; token0/token1 match'};
 if((REVIEWED.v3[network]||[]).includes(factory))return {ok:true,kind:'V3',pool:p,emitter:p,token0,token1,factory,venue:'REVIEWED_V3_FACTORY',identity:'pool.factory() is a reviewed V3 factory; token0/token1 match'};
 return {ok:false,reason:'POOL_FACTORY_NOT_REVIEWED',factory};
}
// Decodes one price observation from a pool event. price = token0 in token1 (human units); depth = virtual reserves (human).
function decodeObservation(kind,log,dec0,dec1){
 const d=String(log.data||'').slice(2);
 if(kind==='V2'){if(d.length<128)return null;const r0=Number(word(d.slice(0,64)))/10**dec0,r1=Number(word(d.slice(64,128)))/10**dec1;if(!(r0>0&&r1>0))return null;return {price:r1/r0,res0:r0,res1:r1};}
 const off=kind==='V3'?128:128;// V3: amount0,amount1,sqrtP,L ; V4: amount0,amount1,sqrtP,L (int128 values are 32-byte words)
 if(d.length<off+128)return null;
 const sqrt=Number(word(d.slice(off,off+64)))/2**96,L=Number(word(d.slice(off+64,off+128)));
 if(!(sqrt>0))return null;
 const raw=sqrt*sqrt,price=raw*10**(dec0-dec1);
 const res0=L>0?L/sqrt/10**dec0:0,res1=L>0?L*sqrt/10**dec1:0;
 return {price,res0,res1};
}
function logFilter(id,from,to){
 const base={fromBlock:hexN(from),toBlock:hexN(to)};
 if(id.kind==='V2')return {...base,address:id.emitter,topics:[T.SYNC]};
 if(id.kind==='V3')return {...base,address:id.emitter,topics:[T.V3_SWAP]};
 return {...base,address:id.emitter,topics:[T.V4_SWAP,id.pool]};
}
const order=(a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex||'0x0')-BigInt(b.logIndex||'0x0'));
// Last observation at or before `block`, searching back 1h, then 6h, then 24h of blocks (bounded: <=3 getLogs per sample).
async function lastObservation(call,network,id,block,floorBlock){
 const span=Math.min(MAX_SPAN[network],BLOCKS_PER_HOUR[network]);
 let hi=block;
 for(const hours of [1,6,24]){
  const lo=Math.max(floorBlock,block-Math.min(MAX_SPAN[network]*(hours===1?1:4),span*hours)+1);
  if(lo>hi)break;
  const logs=(await call('eth_getLogs',[logFilter(id,lo,hi)]))||[];
  const good=(Array.isArray(logs)?logs:[]).filter(l=>l&&l.removed!==true&&String(l.address).toLowerCase()===id.emitter.toLowerCase());
  if(good.length)return good.sort(order).at(-1);
  hi=lo-1;if(hi<floorBlock)break;
 }
 return null;
}
// Daily close series for one pool. memo caches immutable past samples across runs (bounded).
const sampleMemo=new Map();
async function poolSeries(call,network,id,{days,now,head,blockCache,decMemo}){
 const dec0=await decimalsOf(call,id.token0,decMemo),dec1=await decimalsOf(call,id.token1,decMemo);
 const lastMidnight=Math.floor(now/DAY)*DAY,out=[];let missing=0;
 const floor=Math.max(1,head.number-Math.ceil(head.rate*86400*(days+2)));
 for(let d=days;d>=0;d--){
  const at=lastMidnight-d*DAY,sec=Math.floor(at/1000),key=network+':'+id.pool+':'+sec;
  if(sampleMemo.has(key)){out.push(sampleMemo.get(key));continue;}
  const b=await blockAt(call,network,sec,blockCache,head);
  const log=await lastObservation(call,network,id,b.number,floor);
  if(!log){missing++;continue;}
  const obs=decodeObservation(id.kind,log,dec0,dec1);if(!obs){missing++;continue;}
  const s={at,sec,block:Number(BigInt(log.blockNumber)),boundaryBlock:b.number,...obs};
  if(d>0&&head.number-b.number>64){sampleMemo.set(key,s);if(sampleMemo.size>4000)sampleMemo.delete(sampleMemo.keys().next().value);}
  out.push(s);
 }
 return {samples:out,missing,dec0,dec1};
}
// ETH/USD at the same UTC boundaries (shared by every ETH-quoted candidate in a run).
async function ethUsdSeries(call,opts){
 const id={kind:'V3',pool:ETH_REFERENCE.pool,emitter:ETH_REFERENCE.pool,token0:ETH_REFERENCE.token0,token1:ETH_REFERENCE.token1};
 const memo=new Map([[ETH_REFERENCE.token0,6],[ETH_REFERENCE.token1,18]]);
 const r=await poolSeries(call,'ethereum',id,{...opts,decMemo:memo});
 // price = USDC(token0) in WETH(token1) -> ETH/USD = 1/price
 return new Map(r.samples.map(s=>[s.sec,1/s.price]));
}
// Builds the history object consumed by pre-catalyst.inspectHistory (source ONCHAIN_RESERVE_SAMPLES).
async function history({rpc,network,candidate,now,budget,days=30,blockCache=new Map(),ethUsd=null,ethRpc=null}){
 const call=metered(rpc,budget),c=candidate,token=String(c.address).toLowerCase(),quote=String(c.quote?.address||'').toLowerCase();
 const stable=(STABLES[network]||[]).includes(quote),ethQuoted=(ETH_QUOTES[network]||[]).includes(quote);
 if(!stable&&!ethQuoted)return {ok:false,reason:'QUOTE_NOT_USD_STABLE_OR_ETH'};
 const id=await identify(call,network,c.pool,token,quote);
 if(!id.ok)return {ok:false,reason:id.reason};
 const head=await headOf(call,network);
 const series=await poolSeries(call,network,id,{days,now,head,blockCache,decMemo:new Map()});
 let usd=null;
 if(ethQuoted){
  if(!ethUsd){
   if(!ethRpc)return {ok:false,reason:'ETH_USD_REFERENCE_UNAVAILABLE'};
   const ec=metered(ethRpc,budget),eh=await headOf(ec,'ethereum');
   ethUsd=await ethUsdSeries(ec,{days,now,head:eh,blockCache});
  }
  usd=ethUsd;
 }
 const tokenIs0=id.token0===token,candles=[],witnesses=[];
 for(const s of series.samples){
  const quoteUsd=stable?1:usd.get(s.sec);
  if(!Number.isFinite(quoteUsd)||quoteUsd<=0)continue;
  const tokenInQuote=tokenIs0?s.price:1/s.price,quoteDepth=tokenIs0?s.res1:s.res0;
  const p=tokenInQuote*quoteUsd;if(!(p>0&&Number.isFinite(p)))continue;
  candles.push([s.sec,p,p,p,p,null]);
  witnesses.push({timestamp:s.sec,liquidityUsd:2*quoteDepth*quoteUsd,status:'ONCHAIN_VERIFIED',method:'HISTORICAL_RESERVE_AT_BLOCK',
   blockNumber:s.block,boundaryBlock:s.boundaryBlock,chainId:c.chainId,pool:id.pool,tokenAddress:token,
   sourceUrl:EXPLORER[network]+'/block/'+s.block,observedAt:new Date(now).toISOString(),sampleAt:new Date(s.sec*1000).toISOString()});
 }
 return {ok:true,ethUsd,pool:{network:c.network,chainId:c.chainId,address:id.pool,tokenAddress:token,quoteAddress:quote,tokenSide:'base',
  source:'ONCHAIN_RESERVE_SAMPLES',venue:id.venue,poolKind:id.kind,identity:id.identity,sampler:'UTC-day-boundary last pool event (Sync/Swap) at or before the boundary block',
  quoteBasis:stable?'USD_STABLE':'ETH_VIA_REVIEWED_ETHEREUM_USDC_WETH_POOL',sourceUrl:EXPLORER[network]+'/address/'+(id.kind==='V4'?id.emitter:id.pool),
  asOf:new Date(now).toISOString(),candles,historicalLiquidity:witnesses,missingSamples:series.missing}};
}
// ── Demand ────────────────────────────────────────────────────────────────────────────────────────────────
async function demand({rpc,network,candidate,now,budget,hours=3,poolIdentity=null}){
 const call=metered(rpc,budget),token=String(candidate.address).toLowerCase(),quote=String(candidate.quote?.address||'').toLowerCase();
 const id=poolIdentity||await identify(call,network,candidate.pool,token,quote);
 if(!id.ok)return {ok:false,reason:id.reason};
 const head=await headOf(call,network),blocks=Math.ceil(head.rate*3600*hours),span=MAX_SPAN[network],source=id.emitter.toLowerCase();
 const logs=[];let lo=Math.max(1,head.number-blocks+1),complete=true,calls=0;
 for(let from=lo;from<=head.number;from+=span){
  if(calls>=6){complete=false;break;}
  const to=Math.min(head.number,from+span-1);calls++;
  try{const r=await call('eth_getLogs',[{address:token,topics:[T.TRANSFER],fromBlock:hexN(from),toBlock:hexN(to)}]);for(const l of Array.isArray(r)?r:[])if(l&&l.removed!==true&&String(l.address).toLowerCase()===token)logs.push(l);}
  catch(e){if(isBlocked(e))throw e;complete=false;break;}
 }
 const byTx=new Map();
 for(const l of logs){const t=(l.topics||[]).map(x=>String(x).toLowerCase());if(t.length!==3)continue;
  const amt=word(String(l.data||'').slice(2,66));const e={from:addrOf(t[1]),to:addrOf(t[2]),amt,idx:Number(BigInt(l.logIndex||'0x0')),block:Number(BigInt(l.blockNumber))};
  const k=String(l.transactionHash).toLowerCase();if(!byTx.has(k))byTx.set(k,[]);byTx.get(k).push(e);}
 const bought=new Map(),sold=new Map();let buyTx=0,sellTx=0,lastBuyer=null;
 for(const list of byTx.values()){
  list.sort((a,b)=>a.idx-b.idx);
  for(const e of list){
   if(e.from===source){ // follow the chain to the final holder within the same transaction
    let holder=e.to,cur=e;for(const n of list)if(n.idx>cur.idx&&n.from===holder&&n.to!==source){holder=n.to;cur=n;}
    if(holder===source||holder===ZERO||holder===DEAD)continue;
    bought.set(holder,(bought.get(holder)||0n)+e.amt);buyTx++;lastBuyer={address:holder,amount:e.amt,block:e.block};
   }else if(e.to===source){
    let origin=e.from,cur=e;for(let i=list.length-1;i>=0;i--){const n=list[i];if(n.idx<cur.idx&&n.to===origin){origin=n.from;cur=n;}}
    sold.set(origin,(sold.get(origin)||0n)+e.amt);sellTx++;
   }
  }
 }
 const total=[...bought.values()].reduce((a,b)=>a+b,0n);
 const top=[...bought.values()].reduce((a,b)=>b>a?b:a,0n);
 const overlap=[...bought].filter(([a])=>sold.has(a)).reduce((s,[,v])=>s+v,0n);
 const share=(x)=>total>0n?Number(x*10000n/total)/10000:null;
 return {ok:true,window:{hours,fromBlock:lo,toBlock:head.number,complete,logCalls:calls},scope:id.kind==='V4'?'ALL_POOLS_OF_TOKEN_ON_REVIEWED_POOLMANAGER':'EXACT_POOL',
  distinctBuyers:bought.size,buyTransfers:buyTx,sellTransfers:sellTx,distinctSellers:sold.size,topBuyerShare:share(top),buySellOverlapShare:share(overlap),lastBuyer,
  explorerUrl:EXPLORER[network]+'/token/'+token};
}
// ── Contract facts ────────────────────────────────────────────────────────────────────────────────────────
const SLOTS=Object.freeze({implementation:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',admin:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'});
const RISKY_SELECTORS=Object.freeze({mint:[sel('mint(address,uint256)'),sel('mint(uint256)'),sel('mintTo(address,uint256)')].map(x=>x.slice(2)),
 pause:[sel('pause()')].map(x=>x.slice(2)),blacklist:[sel('blacklist(address)'),sel('addToBlacklist(address)'),sel('setBlacklist(address,bool)'),sel('blockAccount(address)')].map(x=>x.slice(2)),
 fee:[sel('setFee(uint256)'),sel('setTaxFee(uint256)'),sel('setFees(uint256,uint256)'),sel('setBuyFee(uint256)'),sel('setSellFee(uint256)')].map(x=>x.slice(2)),
 trading:[sel('enableTrading()'),sel('setTradingEnabled(bool)'),sel('openTrading()')].map(x=>x.slice(2))});
function scanBytecode(code){
 const hex=String(code).slice(2).toLowerCase(),selectors=new Set();let delegatecall=false,selfdestruct=false;
 for(let i=0;i<hex.length;i+=2){
  const op=parseInt(hex.slice(i,i+2),16);
  if(op===0x63){selectors.add(hex.slice(i+2,i+10));i+=8;continue;}
  if(op>=0x60&&op<=0x7f){i+=(op-0x5f)*2;continue;}
  if(op===0xf4)delegatecall=true;if(op===0xff)selfdestruct=true;
 }
 const has=k=>RISKY_SELECTORS[k].some(s=>selectors.has(s));
 return {bytes:hex.length/2,delegatecall,selfdestruct,mintSelector:has('mint'),pauseSelector:has('pause'),blacklistSelector:has('blacklist'),feeSetter:has('fee'),tradingToggle:has('trading'),ownerSelector:selectors.has(S.owner.slice(2))};
}
async function contract({rpc,network,candidate,budget}){
 const call=metered(rpc,budget),a=String(candidate.address).toLowerCase();
 const code=await call('eth_getCode',[a,'latest']);
 if(typeof code!=='string'||!/^0x[0-9a-f]*$/i.test(code))throw fail('INTEL_RPC_MALFORMED_CODE');
 if(code==='0x')return {ok:true,hasCode:false};
 const slots={};for(const [k,s] of Object.entries(SLOTS)){const v=await call('eth_getStorageAt',[a,s,'latest']);slots[k]=typeof v==='string'&&/^0x0*$/.test(v)?null:addrOf(v);}
 let owner=null;const scan=scanBytecode(code);
 if(scan.ownerSelector){try{owner=addrOf((await ethCall(call,a,S.owner)).slice(2,66));}catch(e){if(isBlocked(e))throw e;}}
 return {ok:true,hasCode:true,codeHash:keccak(Buffer.from(code.slice(2),'hex')),proxy:Boolean(slots.implementation||slots.beacon),slots,owner,
  ownerRenounced:owner===ZERO||owner===DEAD,...scan,explorerUrl:EXPLORER[network]+'/address/'+a};
}
// Sell-transfer simulation from a real recent buyer (eth_call with `from`, no signature, no state change).
async function sellSimulation({rpc,network,candidate,holder,poolIdentity,budget}){
 const call=metered(rpc,budget),a=String(candidate.address).toLowerCase(),to=poolIdentity.emitter;
 if(!holder||!ADDRESS.test(holder))return {ok:false,reason:'NO_RECENT_BUYER'};
 const bal=word((await ethCall(call,a,S.balanceOf+holder.slice(2).padStart(64,'0'))).slice(2,66));
 if(bal<=0n)return {ok:false,reason:'RECENT_BUYER_HAS_NO_BALANCE'};
 const amt=bal/100n>0n?bal/100n:1n;
 const data=S.transfer+to.slice(2).padStart(64,'0')+amt.toString(16).padStart(64,'0');
 try{const r=await call('eth_call',[{from:holder,to:a,data},'latest']);
  const okFlag=r==='0x'||/^0x0*1$/.test(r)||(r.length>=66&&word(r.slice(2,66))===1n);
  return {ok:true,status:okFlag?'TRANSFER_TO_POOL_SUCCEEDED':'TRANSFER_RETURNED_FALSE',holder,amount:amt.toString(),to,explorerUrl:EXPLORER[network]+'/address/'+holder};}
 catch(e){if(isBlocked(e))throw e;return {ok:true,status:'TRANSFER_TO_POOL_REVERTED',holder,amount:amt.toString(),to,detail:String(e?.message||'').slice(0,80),explorerUrl:EXPLORER[network]+'/address/'+holder};}
}
module.exports={history,demand,contract,sellSimulation,identify,scanBytecode,decodeObservation,blockAt,headOf,metered,
 REVIEWED,STABLES,ETH_QUOTES,ETH_REFERENCE,EXPLORER,TOPICS:T,SELECTORS:S,_resetMemo:()=>sampleMemo.clear()};
