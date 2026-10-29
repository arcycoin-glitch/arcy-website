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
  explorer:'https://explorer.arc.io',confirmations:2,initialChunk:20000,uniswapSlug:null,
  // Arc docs: pools must use the 6-decimal ERC-20 USDC interface; the zero address is NOT USDC.
  anchors:[{address:'0x3600000000000000000000000000000000000000',symbol:'USDC',decimals:6,ref:'USDC'}]}),
 ethereum:Object.freeze({chainId:1,label:'Ethereum',poolManager:'0x000000000004444c5dc75cb358380d2e3de08a90',
  positionManager:'0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e',fallbackRpc:null,
  explorer:'https://eth.blockscout.com',confirmations:12,initialChunk:400,uniswapSlug:'ethereum',
  anchors:[{address:ZERO,symbol:'ETH',decimals:18,ref:'ETH',native:true},
   {address:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',symbol:'WETH',decimals:18,ref:'ETH'},
   {address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',symbol:'USDC',decimals:6,ref:'USDC'}]}),
 robinhood:Object.freeze({chainId:4663,label:'Robinhood Chain',poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',
  positionManager:'0x58daec3116aae6d93017baaea7749052e8a04fa7',fallbackRpc:'https://robinhood.drpc.org',
  explorer:'https://robinhoodchain.blockscout.com',confirmations:40,initialChunk:20000,uniswapSlug:null,
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
// maxLogCalls is a runaway guard only; the real budget is time (deadlineMs < Vercel's 60s).
const LIMITS=Object.freeze({maxLogCalls:600,keyCap:200,metaCap:24,minSwaps:2,deadlineMs:50000,concurrency:8,scanConcurrency:4,rateTries:4,transientTries:2,maxPools:250000});
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

const URL_RE=/https?:\/\/[^\s"']+/gi,SECRET_RE=/\b(?!0x)[A-Za-z0-9_-]{32,}\b/g;
// Diagnostics must never carry credentials or provider URLs.
function sanitize(text,max=140){return String(text??'').replace(URL_RE,'[url]').replace(SECRET_RE,'[redacted]').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);}
const RANGE_RE=/range|block.{0,14}(limit|window|span|too)|more than \d|too many (results|logs|events)|exceed|response size|result.{0,12}(limit|size|too)|limit.{0,24}(block|result|log|response)|query timeout|payload too large/i;
const RATE_RE=/rate|too many requests|capacity|throttl|quota|slow down|try again later|compute units/i;
function classify(e){
 const msg=String(e?.message||''),body=String(e?.body||''),http=/^RPC_HTTP_(\d{3})$/.exec(msg);
 if(http){const c=Number(http[1]);
  if(c===429)return 'RATE_LIMITED';
  if(c===401||c===403)return 'FORBIDDEN';
  if(c===413||RANGE_RE.test(body))return 'RANGE_OR_RESULT_LIMIT';
  if(c===408||c===504)return 'TIMEOUT';
  if(c>=500)return 'TRANSPORT';
  return RATE_RE.test(body)?'RATE_LIMITED':'RPC_ERROR';}
 if(e?.malformed)return 'MALFORMED';
 if(e?.name==='AbortError'||e?.name==='TimeoutError'||/timed? ?out|aborted/i.test(msg))return 'TIMEOUT';
 if(e instanceof TypeError||/fetch failed|ECONN|ENOTFOUND|socket|network/i.test(msg))return 'TRANSPORT';
 if(RANGE_RE.test(msg))return 'RANGE_OR_RESULT_LIMIT';
 if(RATE_RE.test(msg))return 'RATE_LIMITED';
 return 'RPC_ERROR';
}
// Providers often state their cap ("up to a 10,000 block range"); use it only if plausible.
function rangeHint(e){
 const m=/(?:range|limit|max(?:imum)?|up to|exceeds?|below)[^0-9]{0,40}(\d[\d,]{2,8})/i.exec(String(e?.message||'')+' '+String(e?.body||''));
 const n=m?Number(m[1].replace(/,/g,'')):0;return Number.isSafeInteger(n)&&n>=10?n:0;
}
function makeRpc(network,{fetcher=fetch,env=process.env}={}){
 const cfg=CHAINS[network];
 const urls=[rpcUrl(network,env)];
 const extra=network==='ethereum'?env.ETH_RPC_FALLBACK_URL:null;
 for(const u of [extra,cfg.fallbackRpc]){if(u&&!urls.includes(u))urls.push(u);}
 let id=0,calls=0;
 async function once(url,method,params,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:controller.signal,redirect:'error'});
   if(!r.ok){let body='';try{body=sanitize(await r.text(),200);}catch{}throw Object.assign(Error('RPC_HTTP_'+r.status),{transport:true,body});}
   const json=await r.json();
   if(json?.error)throw Object.assign(Error(sanitize(json.error.message||'RPC_ERROR',160)),{rpcCode:json.error.code});
   if(!json||!('result' in json))throw Error('RPC_MALFORMED');
   return json.result;
  }catch(e){if(e?.name==='AbortError'){e.transport=true;e.message='RPC_TIMEOUT';}if(e instanceof TypeError)e.transport=true;throw e;}
  finally{clearTimeout(timer);}
 }
 async function call(method,params,{timeoutMs=12000}={}){
  calls++;let last;
  for(let i=0;i<urls.length;i++){try{return await once(urls[i],method,params,timeoutMs);}catch(e){e.provider=i===0?'primary':'fallback';last=e;if(!e.transport)throw e;}}
  throw last;
 }
 return {call,get calls(){return calls;},providers:urls.length};
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
async function blocksPerSecond(rpc,head){
 const sample=Math.min(1000,head.number-1);if(sample<10)return null;
 const old=await block(rpc,head.number-sample),dt=head.timestamp-old.timestamp;
 return dt>0?sample/dt:null;
}
// Smallest block whose timestamp is >= target. The span is estimated from the measured
// block rate and widened if needed, so no block time is hard-coded for any chain.
async function firstBlockAtOrAfter(rpc,head,target,{bps=null}={}){
 let span=Math.max(50,Math.ceil((head.timestamp-target)*(bps||1)*1.25)+10),lo,low;
 for(let i=0;i<8;i++){
  lo=Math.max(0,head.number-span);low=await block(rpc,lo);
  if(low.timestamp<target||lo===0)break;
  span*=2;
 }
 if(low.timestamp>=target){if(lo===0)return low;throw fail('RADAR_WINDOW_SPAN_EXCEEDED');}
 let hi=head.number,best=head;
 for(let i=0;i<48&&lo<hi;i++){
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
const emptyStats=()=>({calls:0,ok:0,retries:0,rateLimited:0,splits:0,maxChunk:0,maxLogsPerCall:0,latencySumMs:0,latencyMaxMs:0,startedAt:Date.now(),byClass:{},failures:[],learnedCap:null});
function summarize(st){return {calls:st.calls,ok:st.ok,retries:st.retries,rateLimited:st.rateLimited,splits:st.splits,maxChunkBlocks:st.maxChunk,maxLogsPerCall:st.maxLogsPerCall,
 avgLatencyMs:st.ok?Math.round(st.latencySumMs/st.ok):null,maxLatencyMs:st.latencyMaxMs,elapsedMs:Date.now()-st.startedAt,learnedBlockCap:st.learnedCap,failuresByClass:{...st.byClass},recentFailures:st.failures.slice(-8)};}
function addSwap(pools,s){
 let p=pools.get(s.id);
 if(!p){if(pools.size>=LIMITS.maxPools)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'pool budget'});pools.set(s.id,p={id:s.id,swaps:0,abs0:0n,abs1:0n,first:s,last:s});}
 p.swaps++;p.abs0+=abs(s.amount0);p.abs1+=abs(s.amount1);
 const first={blockNumber:p.first.blockNumber,logIndex:p.first.logIndex};
 if(s.blockNumber<first.blockNumber||(s.blockNumber===first.blockNumber&&s.logIndex<first.logIndex))p.first=s;
 if(s.blockNumber>p.last.blockNumber||(s.blockNumber===p.last.blockNumber&&s.logIndex>p.last.logIndex))p.last=s;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Adaptive, parallel, classified getLogs scan of [from,to]. It publishes nothing itself:
// any budget/provider failure throws RADAR_ONCHAIN_SCAN_INCOMPLETE with a precise reason.
//  - range/result-limit errors  -> split the range and LEARN a per-provider block cap (never regrow past it)
//  - rate limits               -> back off, drop to one request at a time, give up after a few tries
//  - timeouts/transport        -> retry, then split
//  - 401/403, unknown RPC errors, malformed results -> stop immediately with that reason (no range-halving storm)
async function scanRange(rpc,cfg,from,to,{deadline,stats=emptyStats(),pools=new Map(),concurrency=LIMITS.scanConcurrency,maxCalls=LIMITS.maxLogCalls,sleep=pause}={}){
 const total=to-from+1;let cursor=from,chunk=Math.max(1,Math.min(cfg.initialChunk,total)),cap=Infinity,done=0,swaps=0,active=0,maxActive=concurrency,fatal=null;
 const redo=[];
 const stop=(reason,extra={})=>{if(!fatal)fatal=fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason,...extra,blocksDone:done,blocksTotal:total,scan:summarize(stats)});};
 const take=()=>{
  if(redo.length)return redo.shift();
  if(cursor>to)return null;
  const s=cursor,e=Math.min(to,cursor+Math.max(1,Math.min(chunk,cap))-1);cursor=e+1;return {s,e,tries:0};
 };
 async function attempt(r){
  const size=r.e-r.s+1,t0=Date.now();
  try{
   const logs=await rpc.call('eth_getLogs',[{address:cfg.poolManager,topics:[SWAP_TOPIC],fromBlock:hex(r.s),toBlock:hex(r.e)}],{timeoutMs:Math.min(15000,Math.max(1500,deadline-Date.now()))});
   if(!Array.isArray(logs))throw Object.assign(Error('malformed getLogs result'),{malformed:true});
   const seen=new Set();
   for(const log of logs){
    const sw=validSwap(log,cfg,r.s,r.e);if(!sw)continue;
    const key=sw.tx+':'+sw.logIndex+':'+sw.blockNumber;if(seen.has(key))continue;seen.add(key);
    addSwap(pools,sw);swaps++;
   }
   const ms=Date.now()-t0;
   stats.ok++;stats.latencySumMs+=ms;stats.latencyMaxMs=Math.max(stats.latencyMaxMs,ms);stats.maxChunk=Math.max(stats.maxChunk,size);stats.maxLogsPerCall=Math.max(stats.maxLogsPerCall,logs.length);
   done+=size;
   if(cap===Infinity&&logs.length<1000&&ms<4000)chunk=Math.min(chunk*2,cfg.initialChunk*8);
   else if(logs.length>=5000)chunk=Math.max(1,Math.min(chunk,Math.floor(size/2)));
  }catch(e){
   if(e?.code==='RADAR_ONCHAIN_SCAN_INCOMPLETE'){if(!fatal)fatal=e;return;}
   const kind=classify(e);
   stats.byClass[kind]=(stats.byClass[kind]||0)+1;
   stats.failures.push({atMs:Date.now()-stats.startedAt,blocks:size,class:kind,provider:e?.provider||'primary',message:sanitize(e?.body||e?.message,120)});
   if(stats.failures.length>24)stats.failures.shift();
   const retryLater=()=>{r.tries++;stats.retries++;redo.unshift(r);};
   const split=(learn)=>{
    if(size===1)return stop('getLogs failed at single block',{lastClass:kind,lastMessage:sanitize(e?.body||e?.message,120)});
    const mid=r.s+Math.floor(size/2)-1;stats.splits++;
    if(learn){const hint=rangeHint(e),next=hint&&hint<size?hint:Math.max(1,Math.floor(size/2));cap=Math.min(cap,next);stats.learnedCap=cap;}
    chunk=Math.max(1,Math.min(chunk,Math.floor(size/2)));
    redo.unshift({s:r.s,e:mid,tries:0},{s:mid+1,e:r.e,tries:0});
   };
   if(kind==='FORBIDDEN')return stop('provider refused eth_getLogs (HTTP 401/403)',{lastClass:kind});
   if(kind==='RATE_LIMITED'){
    stats.rateLimited++;maxActive=1;
    if(r.tries>=LIMITS.rateTries)return stop('rate limited by RPC provider',{lastClass:kind});
    await sleep(300*2**r.tries);return retryLater();
   }
   if(kind==='RANGE_OR_RESULT_LIMIT')return split(true);
   if(kind==='TIMEOUT'||kind==='TRANSPORT'){if(r.tries<LIMITS.transientTries)return retryLater();return split(false);}
   if(r.tries<1)return retryLater();
   return stop(kind==='MALFORMED'?'malformed getLogs result':'RPC error on getLogs',{lastClass:kind,lastMessage:sanitize(e?.body||e?.message,120)});
  }
 }
 async function worker(){
  for(;;){
   if(fatal)return;
   if(Date.now()>deadline)return stop('time budget');
   if(active>=maxActive){await sleep(10);continue;}
   const r=take();
   if(!r){if(active===0)return;await sleep(10);continue;}
   if(stats.calls>=maxCalls)return stop('call budget');
   active++;stats.calls++;
   try{await attempt(r);}finally{active--;}
  }
 }
 await Promise.all(Array.from({length:Math.max(1,concurrency)},worker));
 if(fatal)throw fatal;
 if(done!==total)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'coverage mismatch',blocksDone:done,blocksTotal:total,scan:summarize(stats)});
 return {pools,swaps,stats};
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
function evaluate(network,{swaps,pools:agg,keys,anchors,refPrices}){
 const byAnchor=new Map(anchors.map(a=>[a.address,a])),pools=agg||new Map();
 if(!agg)for(const s of swaps||[])addSwap(pools,s);
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
// Shared by the live scan (inspect) and the Railway indexer snapshot (composeFromPools).
async function buildResult(network,rpc,{agg,swapCount,start,head,anchors,refPrices,tag,deadline,logCalls,diag={},mark=()=>{},source={}}){
 const cfg=CHAINS[network];
 mark('poolKeys');
 const ids=[...agg.values()].sort((a,b)=>b.swaps-a.swaps||a.id.localeCompare(b.id)).slice(0,LIMITS.keyCap).map(x=>x.id);
 const keys=new Map();keys.evaluated=new Set(ids);
 await pool(ids,LIMITS.concurrency,async id=>{if(Date.now()>deadline)return;try{const k=await poolKey(rpc,cfg,id,tag);if(k)keys.set(id,k);}catch{}});
 diag.poolKeys={requested:ids.length,resolved:keys.size};
 const w={fromBlock:start.number,toBlock:head.number,from:new Date(start.timestamp*1000).toISOString(),toIso:new Date(head.timestamp*1000).toISOString()};
 const base={pools:agg,keys,anchors,refPrices};
 mark('metadata');
 const meta=new Map();
 await pool(evaluate(network,base).ordered.slice(0,LIMITS.metaCap),LIMITS.concurrency,async c=>{meta.set(c.token,await erc20Meta(rpc,c.token,tag));});
 const result=rankTokens(network,{...base,meta,window:w});
 const seconds=Math.max(0,head.timestamp-start.timestamp);
 return {ok:true,network,chainId:cfg.chainId,asOf:w.toIso,
  source:'Onchain · Uniswap v4 PoolManager ('+cfg.label+' RPC)',sourceType:'FIRST_PARTY_ONCHAIN',
  publicDisplay:true,
  license:'Public blockchain event and contract data read directly from chain RPC. No third-party market-data licence is used; USD reference prices are Chainlink feeds read onchain.',
  attribution:{text:'Source: Uniswap v4 PoolManager events on '+cfg.label+' · Chainlink USD reference',url:cfg.explorer+'/address/'+cfg.poolManager},
  selection:'Up to 10 tokens ranked by 24h USD volume of their single highest-volume Uniswap v4 pool paired with '+[...new Set(anchors.map(a=>a.symbol))].join('/')+'. Uniswap v4 only — not whole-chain, not all DEXs, not token-wide aggregate volume.',
  window:{fromBlock:w.fromBlock,toBlock:w.toBlock,from:w.from,to:w.toIso,seconds:source.windowSeconds??seconds},
  referencePrices:refPrices,anchors:anchors.map(a=>({address:a.address,symbol:a.symbol,decimals:a.decimals,bridged:!!a.bridged})),
  coverage:{dex:'Uniswap v4',swapsIndexed:swapCount,logCalls,keyResolutionCap:LIMITS.keyCap,keyCapReached:agg.size>ids.length,
   minSwapsPerPool:LIMITS.minSwaps,complete:false,windowScanComplete:true,blocksScanned:head.number-start.number+1,...result.counts,
   unsupportedFields:{liquidityUsd:'Uniswap v4 keeps all pool balances in one PoolManager; per-pool USD liquidity is not computed.'}},
  poolsInspected:result.counts.poolsResolved,uniqueBaseTokens:result.candidates,tokens:result.tokens,...(source.extra||{})};
}
async function inspect(network,{fetcher=fetch,env=process.env,now=Date.now(),ethRpc}={}){
 const cfg=CHAINS[network];if(!cfg)throw fail('RADAR_INVALID_NETWORK');
 const t0=Date.now(),deadline=now+LIMITS.deadlineMs,rpc=makeRpc(network,{fetcher,env}),stats=emptyStats();
 const diag={network,chainId:cfg.chainId,phase:'chain',providers:rpc.providers,timings:{}};
 const mark=name=>{diag.phase=name;diag.timings[name+'Start']=Date.now()-t0;};
 try{
  mark('chain');
  const chainId=Number(BigInt(await rpc.call('eth_chainId',[])));
  diag.rpcChainId=chainId;
  if(chainId!==cfg.chainId)throw fail('RADAR_RPC_CHAIN_MISMATCH',{expected:cfg.chainId,got:chainId});
  mark('head');
  const latest=await block(rpc,'latest'),nowSec=Math.floor(now/1000);
  diag.headBlock=latest.number;diag.headAgeSec=nowSec-latest.timestamp;
  if(latest.timestamp>nowSec+300||nowSec-latest.timestamp>900)throw fail('RADAR_RPC_HEAD_STALE',{headAgeSec:diag.headAgeSec});
  // Stop a few blocks behind the tip so a reorg cannot change what we publish.
  const head=latest.number>cfg.confirmations+10?await block(rpc,latest.number-cfg.confirmations):latest;
  mark('window');
  const bps=await blocksPerSecond(rpc,head).catch(()=>null);diag.blocksPerSecond=bps?Number(bps.toFixed(4)):null;
  const start=await firstBlockAtOrAfter(rpc,head,head.timestamp-WINDOW_SECONDS,{bps});
  diag.window={fromBlock:start.number,toBlock:head.number,blocks:head.number-start.number+1};
  const tag=hex(head.number);
  mark('references');
  const eth=network==='ethereum'?rpc:(ethRpc||makeRpc('ethereum',{fetcher,env}));
  const [anchors,refETH,refUSDC]=await Promise.all([anchorsFor(rpc,network,tag),
   chainlink(eth,'ETH',nowSec).catch(e=>{diag.chainlinkEthError=e.code||sanitize(e.message,60);return null;}),
   chainlink(eth,'USDC',nowSec).catch(e=>{diag.chainlinkUsdcError=e.code||sanitize(e.message,60);return null;})]);
  const refPrices={};if(refETH)refPrices.ETH=refETH;if(refUSDC)refPrices.USDC=refUSDC;
  diag.anchors=anchors.map(a=>a.symbol);diag.refPrices=Object.keys(refPrices);
  if(!anchors.some(a=>refPrices[a.ref]))throw fail('RADAR_REFERENCE_PRICE_UNAVAILABLE');
  mark('scan');
  const scanned=await scanRange(rpc,cfg,start.number,head.number,{deadline,stats});
  diag.scan=summarize(stats);
  const out=await buildResult(network,rpc,{agg:scanned.pools,swapCount:scanned.swaps,start,head,anchors,refPrices,tag,deadline,logCalls:stats.calls,diag,mark});
  diag.phase='done';diag.elapsedMs=Date.now()-t0;diag.rpcCalls=rpc.calls;
  return {...out,_diagnostics:diag};
 }catch(error){
  diag.elapsedMs=Date.now()-t0;diag.rpcCalls=rpc.calls;if(!diag.scan&&stats.calls)diag.scan=summarize(stats);
  const e=error instanceof Error?error:new Error(String(error));
  if(!e.code)e.code='RADAR_SOURCE_UNAVAILABLE';
  e.diagnostics={...diag,errorCode:e.code,reason:e.detail?.reason||sanitize(e.message,100),failedClass:classify(e)};
  throw e;
 }
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
module.exports={CHAINS,FEEDS,LIMITS,SWAP_TOPIC,SEL,inspect,load,evaluate,rankTokens,validSwap,poolKey,priceOf,firstBlockAtOrAfter,scanRange,buildResult,addSwap,makeRpc,block,classify,sanitize,blocksPerSecond,chainlink,anchorsFor,_cache:cache};
