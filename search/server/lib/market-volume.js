'use strict';
// On-chain 24h volume for the EXACT pool set a provider summed (DEX Screener volume24h scope), from real Swap logs.
// Fail closed: any doubt => no value, with a reasonCode. Never estimates, never extrapolates a partial window.
//
//  window      [fromBlock, toBlock]: toBlock = the pinned block, fromBlock = first block with timestamp >= toBlockTime - 86400
//              (binary search on block timestamps); both anchors' hashes are re-read after the logs => a reorg fails closed
//  identity    V2/V3: pool contract emits the Swap (log.address == pool), token0/token1 read from the pool, the token must be one of
//              them. V4: Swap emitted by the official PoolManager with topic1 == poolId; currencies from the hash-proven PoolKey.
//  logs        validated topic/address/range, removed logs rejected, (blockHash, logIndex) de-duplicated, windows split on range
//              limits, the per-query log cap is treated as truncation (split, never accepted)
//  USD         quote-side absolute amount per swap (V2 amountIn+amountOut of the quote token; V3/V4 |amountQuote|) x the quote's
//              CURRENT Chainlink USD reference. Swaps against an unsupported quote fail closed; a pool with ZERO swaps in the window
//              contributes exactly 0 whatever its quote.
//  scope       only when every provider pool is reproducible within budget. Arc's public RPC caps eth_getLogs at a few thousand blocks
//              (24h = ~172,800 blocks) => VOLUME_WINDOW_EXCEEDS_RPC_BUDGET, not a guess.
const M=require('./market-onchain');
const TOPIC=Object.freeze({V2:'0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',V3:'0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
 V4:'0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'});
// Measured public-RPC log limits per chain (span in blocks, max logs per answer).
const LIMITS=Object.freeze({ethereum:{span:50000,logs:10000,confirmations:3},robinhood:{span:9990000,logs:10000,confirmations:20},arc:{span:5000,logs:1000,confirmations:2}});
const MAX_POOLS=12,MAX_CALLS=60,TIMEOUT_MS=5000,DAY=86400;
const windows=new Map();
const code=(c,x)=>Object.assign(Error(c),{code:c},x||{});
const ID=/^0x[0-9a-f]{64}$/,ADDR=/^0x[0-9a-f]{40}$/;
const addrOf=h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h)?'0x'+h.slice(-40).toLowerCase():null;
const words=h=>{if(typeof h!=='string'||!/^0x([0-9a-f]{64})+$/i.test(h))throw code('MALFORMED_SWAP_LOG');return h.slice(2).match(/.{64}/g).map(w=>BigInt('0x'+w));};
const signed=(x,bits)=>{const m=1n<<BigInt(bits);x&=m-1n;return x>=m>>1n?x-m:x;};
const abs=x=>x<0n?-x:x;
async function header(rpc,n){const b=await rpc('eth_getBlockByNumber',['0x'+n.toString(16),false]);if(!b||!/^0x[0-9a-f]{64}$/i.test(b.hash||''))throw code('BLOCK_HEADER_UNAVAILABLE');return {n,hash:b.hash.toLowerCase(),ts:Number(BigInt(b.timestamp))};}
// first block whose timestamp >= target (binary search, bounded)
async function windowFor(network,rpc,toBlock,now){
 const hit=windows.get(network);if(hit&&hit.to===toBlock&&now-hit.at<60000)return hit.w;
 const to=await header(rpc,toBlock),target=to.ts-DAY;
 const probe=await header(rpc,Math.max(0,toBlock-20000));const bt=Math.max(0.01,(to.ts-probe.ts)/Math.max(1,toBlock-probe.n));
 let lo=Math.max(0,toBlock-Math.ceil(DAY/bt*1.15)),hi=Math.max(lo,toBlock-Math.floor(DAY/bt*0.85));
 let L=await header(rpc,lo);if(L.ts>target)throw code('VOLUME_WINDOW_SEARCH_FAILED');
 let H=await header(rpc,hi);if(H.ts<target){lo=hi;hi=toBlock;H=to;}
 for(let i=0;i<24&&hi-lo>1;i++){const mid=Math.floor((lo+hi)/2),x=await header(rpc,mid);if(x.ts>=target){hi=mid;H=x;}else{lo=mid;L=x;}}
 const w={from:H,to};windows.set(network,{to:toBlock,at:now,w});return w;
}
async function logs(rpc,filter,from,to,limits,acc,seen,state){
 const span=to-from+1;
 if(span>limits.span){const mid=from+Math.floor(span/2)-1;await logs(rpc,filter,from,mid,limits,acc,seen,state);return logs(rpc,filter,mid+1,to,limits,acc,seen,state);}
 let out;try{out=await rpc('eth_getLogs',[{...filter,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16)}]);}
 catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT'||span<=1)throw e;state.splits++;const mid=from+Math.floor(span/2)-1;await logs(rpc,filter,from,mid,limits,acc,seen,state);return logs(rpc,filter,mid+1,to,limits,acc,seen,state);}
 if(!Array.isArray(out))throw code('MALFORMED_LOG_RESPONSE');
 if(out.length>=limits.logs){if(span<=1)throw code('LOG_RESPONSE_POSSIBLY_TRUNCATED');state.splits++;const mid=from+Math.floor(span/2)-1;await logs(rpc,filter,from,mid,limits,acc,seen,state);return logs(rpc,filter,mid+1,to,limits,acc,seen,state);}
 for(const l of out){const b=Number(BigInt(l.blockNumber||'0x0'));
  const want=Array.isArray(filter.topics[0])?filter.topics[0]:[filter.topics[0]];
  if(l.removed||String(l.address).toLowerCase()!==filter.address||!want.includes(String(l.topics?.[0]).toLowerCase())||b<from||b>to||!/^0x[0-9a-f]{64}$/i.test(l.blockHash||'')||!/^0x[0-9a-f]+$/i.test(l.logIndex||''))throw code('INVALID_SWAP_LOG');
  if(filter.topics[1]&&String(l.topics?.[1]).toLowerCase()!==filter.topics[1])throw code('INVALID_SWAP_LOG');
  const id=l.blockHash.toLowerCase()+':'+BigInt(l.logIndex);if(seen.has(id))continue;seen.add(id);acc.push(l);}
}
// quote-side absolute raw amount of one swap
function quoteAmount(kind,l,quoteIs0){const w=words(l.data);
 if(kind==='V2'){if(w.length<4)throw code('MALFORMED_SWAP_LOG');return quoteIs0?w[0]+w[2]:w[1]+w[3];}
 if(kind==='V3'){if(w.length<5)throw code('MALFORMED_SWAP_LOG');return abs(signed(quoteIs0?w[0]:w[1],256));}
 if(w.length<6)throw code('MALFORMED_SWAP_LOG');return abs(signed(quoteIs0?w[0]:w[1],128));}
// durable=true (background job only, never a report request): same identity/log/USD rules; the pool-count and Arc window guards
// exist only to bound request latency, so a durable caller lifts them and supplies its own call/time budget.
async function inspect(network,address,primary,{rpc=M.rpcFor?.(network),ethRpc,usdOf,block,now=Date.now(),maxCalls=MAX_CALLS,timeoutMs=TIMEOUT_MS,durable=false,maxPools=MAX_POOLS}={}){
 const token=String(address||'').toLowerCase(),profile={calls:0,ms:0,pools:0,swaps:0,splits:0,reason:null},t0=Date.now();
 const pools=[...new Set((primary?.volume24h?.evidence||[]).flatMap(e=>Array.isArray(e?.pairs)?e.pairs:[]).map(x=>String(x).toLowerCase()))].sort();
 const limits=LIMITS[network];
 const fail=r=>{profile.reason=r;profile.ms=Date.now()-t0;return {field:null,profile};};
 if(!limits)return fail('NETWORK_UNSUPPORTED');
 if(!pools.length)return fail('PROVIDER_VOLUME_POOLS_UNKNOWN');
 if(pools.length>(durable?maxPools:MAX_POOLS))return fail('VOLUME_SCOPE_EXCEEDS_BUDGET ('+pools.length+' pools)');
 if(network==='arc'&&!durable)return fail('VOLUME_WINDOW_EXCEEDS_RPC_BUDGET');
 const state={calls:0,maxCalls,deadline:Date.now()+timeoutMs,splits:0};
 const r=async(m,p)=>{if(state.calls>=state.maxCalls)throw code('ONCHAIN_BUDGET_EXHAUSTED');if(Date.now()>state.deadline)throw code('ONCHAIN_TIMEOUT');state.calls++;return rpc(m,p);};
 try{
  const head=Number(BigInt(block||await r('eth_blockNumber',[])));const toBlock=head-limits.confirmations;
  const w=await windowFor(network,r,toBlock,now);
  const call=(to,data)=>r('eth_call',[{to,data},'0x'+toBlock.toString(16)]);
  const dec=new Map();const decimals=async a=>{if(dec.has(a))return dec.get(a);const d=a===M.NATIVE?M.QUOTES[network]?.[a]?.decimals??18:Number(words(await call(a,'0x313ce567'))[0]);if(!Number.isInteger(d)||d<0||d>36)throw code('TOKEN_DECIMALS_INVALID');dec.set(a,d);return d;};
  let usd=0;const parts=[];
  for(const p of pools){const acc=[],seen=new Set();let kind,quote,quoteIs0;
   if(ID.test(p)){kind='V4';const v=M.V4[network];if(!v)throw code('V4_NOT_DEPLOYED');const k=await M.v4Key(p,{network,rpc:r,call,block:'0x'+toBlock.toString(16)});
    if(![k.currency0,k.currency1].includes(token))throw code('POOL_DOES_NOT_CONTAIN_TOKEN');quote=k.currency0===token?k.currency1:k.currency0;quoteIs0=k.currency0===quote;
    await logs(r,{address:v.poolManager,topics:[TOPIC.V4,p]},w.from.n,toBlock,limits,acc,seen,state);}
   else if(ADDR.test(p)){const t0a=addrOf(await call(p,'0x0dfe1681')),t1a=addrOf(await call(p,'0xd21220a7'));if(!t0a||!t1a)throw code('POOL_KIND_UNSUPPORTED');
    if(![t0a,t1a].includes(token))throw code('POOL_DOES_NOT_CONTAIN_TOKEN');quote=t0a===token?t1a:t0a;quoteIs0=t0a===quote;
    // one query for both Swap signatures (topic OR); each log is classified by its own topic0
    const both=[];await logs(r,{address:p,topics:[[TOPIC.V2,TOPIC.V3]]},w.from.n,toBlock,limits,both,seen,state);
    const a2=both.filter(l=>String(l.topics[0]).toLowerCase()===TOPIC.V2),a3=both.filter(l=>String(l.topics[0]).toLowerCase()===TOPIC.V3);
    if(a2.length&&a3.length)throw code('POOL_KIND_AMBIGUOUS');kind=a3.length?'V3':'V2';acc.push(...a2,...a3);}
   else throw code('POOL_ID_INVALID');
   let raw=0n;for(const l of acc)raw+=quoteAmount(kind,l,quoteIs0);
   profile.swaps+=acc.length;
   if(acc.length===0){parts.push({pool:p,kind,swaps:0,usd:0});continue;}
   const q=M.QUOTES[network]?.[quote];if(!q)throw code('QUOTE_ASSET_UNSUPPORTED',{quote});
   const qd=await decimals(quote),px=await usdOf(q.asset),v=Number(raw)/10**qd*px.usd;
   if(!Number.isFinite(v)||v<0)throw code('VOLUME_INVALID');usd+=v;parts.push({pool:p,kind,swaps:acc.length,quote,quoteAsset:q.asset,usd:v});}
  // reorg guard: both anchors must still be canonical after every log read
  const [a,b]=[await header(r,w.from.n),await header(r,toBlock)];if(a.hash!==w.from.hash||b.hash!==w.to.hash)throw code('VOLUME_WINDOW_REORGED');
  profile.pools=pools.length;profile.calls=state.calls;profile.splits=state.splits;profile.ms=Date.now()-t0;
  const at=new Date(now).toISOString();
  return {field:{value:usd,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:M.SOURCE[network],network,
   evidence:[{provider:M.SOURCE[network],source:M.SOURCE[network],network,pairs:pools,method:'arcy-market-volume-1',fromBlock:w.from.n,toBlock,fromBlockHash:w.from.hash,toBlockHash:w.to.hash,
    windowSeconds:w.to.ts-w.from.ts,swaps:profile.swaps,pools:parts,basis:'Sum over the provider pool set of quote-side swap amounts in the last 24h of blocks x CURRENT Chainlink quote USD (not per-swap historical prices).',checkedAt:at}],
   freshness:{retrievedAt:at,ageMs:0,basis:'pinned-block log window ending at '+toBlock}},profile};
 }catch(e){profile.calls=state.calls;return fail(e.code||'VOLUME_READ_FAILED');}
}
function _reset(){windows.clear();}
module.exports={TOPIC,LIMITS,MAX_POOLS,inspect,quoteAmount,_reset};
