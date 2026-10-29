'use strict';
// ARCY Market Radar — first-party onchain source (no third-party market-data
// licence involved). Reads public Uniswap v4 PoolManager Swap events directly
// from each chain's RPC for the last 24h, resolves every pool key with the
// official PositionManager and proves it by recomputing the pool id, and values
// volume only through exact-contract USD anchors (USDC, ETH/WETH) priced by the
// Ethereum Chainlink USDC/USD and ETH/USD feeds. Nothing is estimated: missing
// facts stay null and an incomplete scan publishes no ranking.
const keccak=require('./keccak');
const {rpcUrl}=require('../search/server/lib/chains');
const {abiString}=require('../search/server/lib/eth');
const {localLogo}=require('../search/server/lib/search-logo');

const ZERO='0x0000000000000000000000000000000000000000';
const SWAP_TOPIC='0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const SEL=Object.freeze({poolKeys:'0x86b6be7d',decimals:'0x313ce567',symbol:'0x95d89b41',name:'0x06fdde03',latestRoundData:'0xfeaf968c',calculateL2TokenAddress:'0xa7e28d48'});
const WINDOW_SECONDS=86400;
// Official deployments: developers.uniswap.org/docs/protocols/v4/deployments,
// github.com/Uniswap/contracts/blob/main/deployments/4663.md, docs.robinhood.com/chain/protocol-contracts.
const CHAINS=Object.freeze({
 arc:Object.freeze({chainId:5042,label:'Arc',poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',
  positionManager:'0x6049c9a0e26405c0985f9e3685c87d0ae917f82b',fallbackRpc:'https://rpc.quicknode.mainnet.arc.io',
  explorer:'https://explorer.arc.io',maxSpan:2000000,initialChunk:20000,uniswapSlug:null,
  // Arc docs: pools must use the 6-decimal ERC-20 USDC interface; the zero address is NOT USDC.
  anchors:[{address:'0x3600000000000000000000000000000000000000',symbol:'USDC',decimals:6,ref:'USDC'}]}),
 ethereum:Object.freeze({chainId:1,label:'Ethereum',poolManager:'0x000000000004444c5dc75cb358380d2e3de08a90',
  positionManager:'0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e',fallbackRpc:null,
  explorer:'https://eth.blockscout.com',maxSpan:8000,initialChunk:400,uniswapSlug:'ethereum',
  anchors:[{address:ZERO,symbol:'ETH',decimals:18,ref:'ETH',native:true},
   {address:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',symbol:'WETH',decimals:18,ref:'ETH'},
   {address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',symbol:'USDC',decimals:6,ref:'USDC'}]}),
 robinhood:Object.freeze({chainId:4663,label:'Robinhood Chain',poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',
  positionManager:'0x58daec3116aae6d93017baaea7749052e8a04fa7',fallbackRpc:'https://robinhood.drpc.org',
  explorer:'https://robinhoodchain.blockscout.com',maxSpan:2000000,initialChunk:20000,uniswapSlug:null,
  anchors:[{address:ZERO,symbol:'ETH',decimals:18,ref:'ETH',native:true},
   {address:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',symbol:'WETH',decimals:18,ref:'ETH'}],
  // Bridged USDC is never hard-coded: it is derived at run time from the
  // official L2 Gateway Router for Ethereum USDC, then checked (symbol/decimals).
  bridgedUsdc:{router:'0x1e324b9316138ca9a73f960213621ad1aaf01b89',l1Token:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'}})
});
// Ethereum mainnet Chainlink feeds (same feeds already used by oracle-market.js).
const FEEDS=Object.freeze({
 ETH:{feed:'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',maxAge:2*3600,label:'Chainlink ETH/USD (Ethereum)'},
 USDC:{feed:'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6',maxAge:26*3600,label:'Chainlink USDC/USD (Ethereum)'}
});
const LIMITS=Object.freeze({maxLogCalls:90,maxLogs:60000,keyCap:200,metaCap:24,minSwaps:2,deadlineMs:48000,concurrency:8});
const ADDRESS=/^0x[0-9a-f]{40}$/;

const hex=n=>'0x'+BigInt(n).toString(16);
const word=(data,i)=>data.slice(2+i*64,2+(i+1)*64);
const signed=(w,bits)=>{const v=BigInt('0x'+w),m=1n<<256n;const x=v>=(1n<<255n)?v-m:v;
 const lim=1n<<BigInt(bits-1);if(x>=lim||x<-lim)throw Error('ABI_RANGE');return x;};
const unsigned=(w,bits)=>{const v=BigInt('0x'+w);if(v>>BigInt(bits))throw Error('ABI_RANGE');return v;};
const addr=w=>{if(!/^0{24}[0-9a-f]{40}$/i.test(w))throw Error('ABI_ADDRESS');return '0x'+w.slice(24).toLowerCase();};
const abs=x=>x<0n?-x:x;
const toUnits=(raw,decimals)=>Number(raw)/10**decimals;
function fail(code,detail){return Object.assign(Error(code),{code,detail});}

function makeRpc(network,{fetcher=fetch,env=process.env}={}){
 const cfg=CHAINS[network];
 const urls=[rpcUrl(network,env)];
 if(cfg.fallbackRpc&&!urls.includes(cfg.fallbackRpc))urls.push(cfg.fallbackRpc);
 let id=0,calls=0;
 async function once(url,method,params,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:controller.signal,redirect:'error'});
   if(!r.ok)throw Object.assign(Error('RPC_HTTP_'+r.status),{transport:true});
   const body=await r.json();
   if(body?.error)throw Object.assign(Error(String(body.error.message||'RPC_ERROR').slice(0,160)),{rpcCode:body.error.code});
   if(!('result' in (body||{})))throw Error('RPC_MALFORMED');
   return body.result;
  }catch(e){if(e?.name==='AbortError')e.transport=true;if(e instanceof TypeError)e.transport=true;throw e;}
  finally{clearTimeout(timer);}
 }
 async function call(method,params,{timeoutMs=12000}={}){
  calls++;let last;
  for(const url of urls){try{return await once(url,method,params,timeoutMs);}catch(e){last=e;if(!e.transport)throw e;}}
  throw last;
 }
 return {call,get calls(){return calls;}};
}
async function pool(items,limit,fn){
 const out=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}}));
 return out;
}
async function block(rpc,tag){
 const b=await rpc.call('eth_getBlockByNumber',[typeof tag==='string'?tag:hex(tag),false]);
 const number=Number(BigInt(b?.number)),timestamp=Number(BigInt(b?.timestamp));
 if(!Number.isSafeInteger(number)||!Number.isSafeInteger(timestamp))throw fail('RADAR_BLOCK_MALFORMED');
 return {number,timestamp};
}
// Smallest block whose timestamp is >= target (binary search, bounded).
async function firstBlockAtOrAfter(rpc,head,target,maxSpan){
 let lo=Math.max(0,head.number-maxSpan),hi=head.number;
 const low=await block(rpc,lo);
 if(low.timestamp>=target){if(lo===0)return low;throw fail('RADAR_WINDOW_SPAN_EXCEEDED');}
 let best=head;
 for(let i=0;i<40&&lo<hi;i++){
  const mid=Math.floor((lo+hi)/2),b=await block(rpc,mid);
  if(b.timestamp>=target){best=b;hi=mid;}else lo=mid+1;
 }
 return best.number===hi?best:await block(rpc,hi);
}
function validSwap(log,cfg,from,to){
 if(!log||log.removed)return null;
 if(String(log.address).toLowerCase()!==cfg.poolManager)return null;
 const t=log.topics;
 if(!Array.isArray(t)||t.length!==3||String(t[0]).toLowerCase()!==SWAP_TOPIC||!/^0x[0-9a-f]{64}$/i.test(t[1]))return null;
 if(typeof log.data!=='string'||!/^0x[0-9a-f]{384}$/i.test(log.data))return null;
 const blockNumber=Number(BigInt(log.blockNumber)),logIndex=Number(BigInt(log.logIndex));
 if(!Number.isSafeInteger(blockNumber)||blockNumber<from||blockNumber>to||!Number.isSafeInteger(logIndex))return null;
 try{
  const d=log.data;
  return {id:t[1].toLowerCase(),blockNumber,logIndex,tx:String(log.transactionHash||'').toLowerCase(),
   amount0:signed(word(d,0),128),amount1:signed(word(d,1),128),sqrtPriceX96:unsigned(word(d,2),160)};
 }catch{return null;}
}
async function scanSwaps(rpc,cfg,from,to,{deadline}){
 const seen=new Set(),swaps=[];let start=from,span=cfg.initialChunk,logCalls=0;
 while(start<=to){
  if(Date.now()>deadline)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'time budget',scannedTo:start-1});
  if(logCalls>=LIMITS.maxLogCalls)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'call budget',scannedTo:start-1});
  const end=Math.min(to,start+span-1);logCalls++;
  let logs;
  try{logs=await rpc.call('eth_getLogs',[{address:cfg.poolManager,topics:[SWAP_TOPIC],fromBlock:hex(start),toBlock:hex(end)}],{timeoutMs:15000});}
  catch(e){if(span>1){span=Math.max(1,Math.floor(span/2));continue;}throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'getLogs failed at single block',scannedTo:start-1});}
  if(!Array.isArray(logs))throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'malformed getLogs result'});
  for(const log of logs){
   const s=validSwap(log,cfg,start,end);if(!s)continue;
   const key=s.tx+':'+s.logIndex+':'+s.blockNumber;if(seen.has(key))continue;seen.add(key);swaps.push(s);
   if(swaps.length>LIMITS.maxLogs)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'log budget',scannedTo:end});
  }
  start=end+1;if(logs.length<2000&&span<cfg.initialChunk*8)span*=2;
 }
 return {swaps,logCalls};
}
async function chainlink(ethRpc,ref,nowSec){
 const f=FEEDS[ref];
 const [dec,raw]=await Promise.all([ethRpc.call('eth_call',[{to:f.feed,data:SEL.decimals},'latest']),ethRpc.call('eth_call',[{to:f.feed,data:SEL.latestRoundData},'latest'])]);
 if(typeof raw!=='string'||!/^0x[0-9a-f]{320}$/i.test(raw)||typeof dec!=='string'||!/^0x[0-9a-f]{64}$/i.test(dec))throw fail('RADAR_REFERENCE_PRICE_UNAVAILABLE');
 const decimals=Number(BigInt(dec)),roundId=BigInt('0x'+word(raw,0)),answer=signed(word(raw,1),256),updatedAt=Number(BigInt('0x'+word(raw,3))),answeredIn=BigInt('0x'+word(raw,4));
 if(decimals!==8||answer<=0n||answeredIn<roundId||!(updatedAt>0)||nowSec-updatedAt>f.maxAge||updatedAt>nowSec+300)throw fail('RADAR_REFERENCE_PRICE_UNAVAILABLE',{ref});
 return {value:Number(answer)/1e8,updatedAt:new Date(updatedAt*1000).toISOString(),feed:f.feed,label:f.label};
}
async function erc20Meta(rpc,address,tag){
 const [d,s,n]=await Promise.allSettled([SEL.decimals,SEL.symbol,SEL.name].map(data=>rpc.call('eth_call',[{to:address,data},tag])));
 const decimals=d.status==='fulfilled'&&/^0x[0-9a-f]{64}$/i.test(d.value)?Number(BigInt(d.value)):null;
 const clean=v=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,70)||null:null;
 return {decimals:Number.isInteger(decimals)&&decimals>=0&&decimals<=36?decimals:null,
  symbol:s.status==='fulfilled'?clean(abiString(s.value))?.slice(0,20)||null:null,
  name:n.status==='fulfilled'?clean(abiString(n.value)):null};
}
async function anchorsFor(rpc,network,tag){
 const cfg=CHAINS[network],list=cfg.anchors.map(a=>({...a}));
 const checked=[];
 for(const a of list){
  if(a.native){checked.push(a);continue;}
  const meta=await erc20Meta(rpc,a.address,tag);
  if(meta.decimals===a.decimals)checked.push({...a,verified:'decimals() matched'});
 }
 if(cfg.bridgedUsdc){
  try{
   const out=await rpc.call('eth_call',[{to:cfg.bridgedUsdc.router,data:SEL.calculateL2TokenAddress+cfg.bridgedUsdc.l1Token.slice(2).padStart(64,'0')},tag]);
   const address=addr(String(out).slice(2,66));
   const meta=address!==ZERO?await erc20Meta(rpc,address,tag):null;
   if(meta&&meta.decimals===6&&/^USDC(\.e)?$/i.test(meta.symbol||''))
    checked.push({address,symbol:meta.symbol,decimals:6,ref:'USDC',bridged:true,verified:'derived from official L2 Gateway Router for Ethereum USDC; symbol/decimals matched'});
  }catch{} // fails closed: no bridged-USDC anchor
 }
 return checked;
}
// Pool key from the official PositionManager, proven by recomputing the pool id.
async function poolKey(rpc,cfg,id,tag){
 const out=await rpc.call('eth_call',[{to:cfg.positionManager,data:SEL.poolKeys+id.slice(2,52)+'0'.repeat(14)},tag]);
 if(typeof out!=='string'||!/^0x[0-9a-f]{320}$/i.test(out))return null;
 if(keccak(Buffer.from(out.slice(2),'hex')).toLowerCase()!==id)return null;
 return {currency0:addr(word(out,0)),currency1:addr(word(out,1)),fee:Number(unsigned(word(out,2),24)),tickSpacing:Number(signed(word(out,3),24)),hooks:addr(word(out,4))};
}
function priceOf(sqrtPriceX96,d0,d1){ // human price of currency0 in currency1
 const s=Number(sqrtPriceX96)/2**96,p=s*s*10**(d0-d1);
 return Number.isFinite(p)&&p>0?p:null;
}
function evaluate(network,{swaps,keys,anchors,refPrices}){
 const byAnchor=new Map(anchors.map(a=>[a.address,a])),pools=new Map();
 for(const s of swaps){
  let p=pools.get(s.id);if(!p)pools.set(s.id,p={id:s.id,swaps:0,abs0:0n,abs1:0n,first:s,last:s});
  p.swaps++;p.abs0+=abs(s.amount0);p.abs1+=abs(s.amount1);
  if(s.blockNumber<p.first.blockNumber||(s.blockNumber===p.first.blockNumber&&s.logIndex<p.first.logIndex))p.first=s;
  if(s.blockNumber>p.last.blockNumber||(s.blockNumber===p.last.blockNumber&&s.logIndex>p.last.logIndex))p.last=s;
 }
 const counts={poolsSeen:pools.size,poolsResolved:0,poolsUnresolved:0,poolsNotEvaluated:0,poolsUnpriced:0,referencePoolsExcluded:0,poolsBelowMinSwaps:0,tokensWithoutMetadata:0};
 const best=new Map();
 for(const p of pools.values()){
  if(!keys.has(p.id)){counts[keys.evaluated?.has(p.id)?'poolsUnresolved':'poolsNotEvaluated']++;continue;}
  const k=keys.get(p.id);counts.poolsResolved++;
  const a0=byAnchor.get(k.currency0),a1=byAnchor.get(k.currency1);
  if(a0&&a1){counts.referencePoolsExcluded++;continue;}
  if(!a0&&!a1){counts.poolsUnpriced++;continue;}
  if(p.swaps<LIMITS.minSwaps){counts.poolsBelowMinSwaps++;continue;}
  const anchor=a0||a1,anchorIs0=!!a0,token=anchorIs0?k.currency1:k.currency0,ref=refPrices[anchor.ref];
  if(!ref||!ADDRESS.test(token)||token===ZERO){counts.poolsUnpriced++;continue;}
  const volume=toUnits(anchorIs0?p.abs0:p.abs1,anchor.decimals)*ref.value;
  if(!Number.isFinite(volume)||volume<=0)continue;
  // One pool per token (its highest-volume one): same-token pools are never added together.
  const prior=best.get(token);
  if(!prior||volume>prior.volume)best.set(token,{token,pool:p,key:k,anchor,anchorIs0,ref,volume});
 }
 const ordered=[...best.values()].sort((a,b)=>b.volume-a.volume||a.token.localeCompare(b.token));
 return {ordered,counts};
}
function rankTokens(network,ctx){
 const cfg=CHAINS[network],{ordered,counts}=evaluate(network,ctx),meta=ctx.meta||new Map(),w=ctx.window;
 const tokens=[];
 for(const c of ordered){
  if(tokens.length>=10)break;
  const m=meta.get(c.token);
  if(!m||m.decimals===null||!m.symbol){counts.tokensWithoutMetadata++;continue;}
  const d0=c.anchorIs0?c.anchor.decimals:m.decimals,d1=c.anchorIs0?m.decimals:c.anchor.decimals;
  const tokenPrice=s=>{const p=priceOf(s,d0,d1);if(p===null)return null;const inAnchor=c.anchorIs0?1/p:p;return Number.isFinite(inAnchor)&&inAnchor>0?inAnchor*c.ref.value:null;};
  const last=tokenPrice(c.pool.last.sqrtPriceX96),first=tokenPrice(c.pool.first.sqrtPriceX96);
  const change=last!==null&&first!==null?(last/first-1)*100:null;
  tokens.push({rank:tokens.length+1,network,chainId:cfg.chainId,address:c.token,symbol:m.symbol,name:m.name||m.symbol,
   logo:localLogo(network,c.token),
   priceUsd:last,volume24hUsd:c.volume,liquidityUsd:null,liquidityStatus:'NOT_COMPUTED',
   change24hPct:change!==null&&Number.isFinite(change)&&Math.abs(change)<1e9?change:null,
   changeMethod:'First-to-last observed swap price in this pool inside the 24h window',
   swaps24h:c.pool.swaps,dex:'Uniswap v4',pool:c.pool.id,poolFee:c.key.fee,hooks:c.key.hooks===ZERO?null:c.key.hooks,
   quote:{address:c.anchor.address,symbol:c.anchor.symbol},
   poolUrl:cfg.uniswapSlug?'https://app.uniswap.org/explore/pools/'+cfg.uniswapSlug+'/'+c.pool.id:null,
   lastSwapTx:/^0x[0-9a-f]{64}$/.test(c.pool.last.tx)?cfg.explorer+'/tx/'+c.pool.last.tx:null,
   lastSwapBlock:c.pool.last.blockNumber,provider:'Onchain · Uniswap v4 PoolManager',asOf:w?.toIso??null});
 }
 return {tokens,counts,candidates:ordered.length};
}
async function inspect(network,{fetcher=fetch,env=process.env,now=Date.now(),ethRpc}={}){
 const cfg=CHAINS[network];if(!cfg)throw fail('RADAR_INVALID_NETWORK');
 const deadline=now+LIMITS.deadlineMs,rpc=makeRpc(network,{fetcher,env});
 const chainId=Number(BigInt(await rpc.call('eth_chainId',[])));
 if(chainId!==cfg.chainId)throw fail('RADAR_RPC_CHAIN_MISMATCH');
 const head=await block(rpc,'latest'),nowSec=Math.floor(now/1000);
 if(head.timestamp>nowSec+300||nowSec-head.timestamp>900)throw fail('RADAR_RPC_HEAD_STALE');
 const start=await firstBlockAtOrAfter(rpc,head,head.timestamp-WINDOW_SECONDS,cfg.maxSpan);
 const tag=hex(head.number);
 const eth=network==='ethereum'?rpc:(ethRpc||makeRpc('ethereum',{fetcher,env}));
 const [anchors,refETH,refUSDC]=await Promise.all([anchorsFor(rpc,network,tag),
  chainlink(eth,'ETH',nowSec).catch(()=>null),chainlink(eth,'USDC',nowSec).catch(()=>null)]);
 const refPrices={};if(refETH)refPrices.ETH=refETH;if(refUSDC)refPrices.USDC=refUSDC;
 if(!anchors.some(a=>refPrices[a.ref]))throw fail('RADAR_REFERENCE_PRICE_UNAVAILABLE');
 const {swaps,logCalls}=await scanSwaps(rpc,cfg,start.number,head.number,{deadline});
 // Resolve pool keys for the most active pools only (bounded); others are reported as not evaluated.
 const activity=new Map();for(const s of swaps)activity.set(s.id,(activity.get(s.id)||0)+1);
 const ids=[...activity.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,LIMITS.keyCap).map(x=>x[0]);
 const keys=new Map();keys.evaluated=new Set(ids);
 await pool(ids,LIMITS.concurrency,async id=>{if(Date.now()>deadline)return;try{const k=await poolKey(rpc,cfg,id,tag);if(k)keys.set(id,k);}catch{}});
 const w={fromBlock:start.number,toBlock:head.number,from:new Date(start.timestamp*1000).toISOString(),toIso:new Date(head.timestamp*1000).toISOString()};
 const base={swaps,keys,anchors,refPrices};
 // Metadata only for the leading candidates (bounded). A token without readable
 // decimals/symbol is skipped and counted, never given invented metadata.
 const meta=new Map();
 await pool(evaluate(network,base).ordered.slice(0,LIMITS.metaCap),LIMITS.concurrency,async c=>{meta.set(c.token,await erc20Meta(rpc,c.token,tag));});
 const result=rankTokens(network,{...base,meta,window:w});
 return {ok:true,network,chainId:cfg.chainId,asOf:w.toIso,
  source:'Onchain · Uniswap v4 PoolManager ('+cfg.label+' RPC)',sourceType:'FIRST_PARTY_ONCHAIN',
  publicDisplay:true,
  license:'Public blockchain event and contract data read directly from chain RPC. No third-party market-data licence is used; USD reference prices are Chainlink feeds read onchain.',
  attribution:{text:'Source: Uniswap v4 PoolManager events on '+cfg.label+' · Chainlink USD reference',url:cfg.explorer+'/address/'+cfg.poolManager},
  selection:'Up to 10 tokens ranked by 24h USD volume of their single highest-volume Uniswap v4 pool paired with '+[...new Set(anchors.map(a=>a.symbol))].join('/')+'. Uniswap v4 only — not whole-chain, not all DEXs, not token-wide aggregate volume.',
  window:{fromBlock:w.fromBlock,toBlock:w.toBlock,from:w.from,to:w.toIso,seconds:WINDOW_SECONDS},
  referencePrices:refPrices,anchors:anchors.map(a=>({address:a.address,symbol:a.symbol,decimals:a.decimals,bridged:!!a.bridged})),
  coverage:{dex:'Uniswap v4',swapsIndexed:swaps.length,logCalls,keyResolutionCap:LIMITS.keyCap,keyCapReached:activity.size>ids.length,
   minSwapsPerPool:LIMITS.minSwaps,complete:false,...result.counts,
   unsupportedFields:{liquidityUsd:'Uniswap v4 keeps all pool balances in one PoolManager; per-pool USD liquidity is not computed.'}},
  poolsInspected:result.counts.poolsResolved,uniqueBaseTokens:result.candidates,tokens:result.tokens};
}
const cache=new Map(),inflight=new Map(),TTL=600000,NEGATIVE_TTL=60000;
async function load(network,options={}){
 if(!CHAINS[network])throw fail('RADAR_INVALID_NETWORK');
 const now=options.now??Date.now(),hit=cache.get(network);
 if(!options.disableCache&&hit&&hit.expires>now){if(hit.error)throw hit.error;return structuredClone(hit.data);}
 if(!options.disableCache&&inflight.has(network))return structuredClone(await inflight.get(network));
 const task=inspect(network,options);
 if(options.disableCache)return task;
 inflight.set(network,task);
 try{const data=await task;cache.set(network,{data,expires:now+TTL});return structuredClone(data);}
 catch(error){cache.set(network,{error,expires:now+NEGATIVE_TTL});throw error;}
 finally{inflight.delete(network);}
}
module.exports={CHAINS,FEEDS,LIMITS,SWAP_TOPIC,SEL,inspect,load,evaluate,rankTokens,validSwap,poolKey,priceOf,firstBlockAtOrAfter,scanSwaps,chainlink,anchorsFor,_cache:cache};
