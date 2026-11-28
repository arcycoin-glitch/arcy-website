'use strict';
// On-chain pool DISCOVERY fallback (no DEX Screener / GeckoTerminal). When the market provider is unavailable, or does not list the
// token, pools are found from the chain itself through REVIEWED factories and the REVIEWED quote registry, then read with the same
// pinned-block pool readers and Chainlink quote USD as market-onchain.js.
//   V3: factory.getPool(token, quote, fee)  for the 4 standard fee tiers     (the factory registry binds token/quote/fee -> pool)
//   V2: factory.getPair(token, quote)
// Scope is stated, never exhaustive: pools against other quote assets, other factories and hook-gated V4 pools are NOT discovered
// here, so liquidity is a lower bound of the token's chain-wide liquidity and dexPairCount counts discovered pools only.
// Fail closed: any pool that cannot be identified/read is skipped with a reason; no value is estimated. Price comes from the
// deepest pool measured by its QUOTE-side USD value (independent of the token's own price), liquidity sums every readable pool.
const O=require('./market-onchain');
const VERSION='arcy-market-discovery-1';
const FEES=Object.freeze([100,500,3000,10000]);
const REGISTRY=Object.freeze({
 ethereum:{v3:['0x1f98431c8ad98523631ae4a59f267346ea31f984'],v2:['0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f','0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac']},
 robinhood:{v3:['0x1f7d7550b1b028f7571e69a784071f0205fd2efa'],v2:[]},
 arc:{v3:[],v2:[]}});
const SEL=Object.freeze({getPool:'0x1698ee82',getPair:'0xe6a43905'});
const MAX_CALLS=140,TIMEOUT_MS=6000,CACHE_MS=30000,MAX_POOLS=12;
const cache=new Map();
const ADDR=/^0x[0-9a-f]{40}$/,ZERO=/^0x0{40}$/;
const pad=a=>a.toLowerCase().replace(/^0x/,'').padStart(64,'0');
const fail=(c,x)=>Object.assign(Error(c),{code:c},x||{});
function enabled(env=process.env){return O.enabled(env)&&String(env?.SEARCH_MARKET_DISCOVERY||'on').toLowerCase()!=='off';}
const supported=network=>Boolean(REGISTRY[network]&&(REGISTRY[network].v3.length||REGISTRY[network].v2.length));
function quotesOf(network){return Object.keys(O.QUOTES[network]||{}).filter(a=>a!==O.NATIVE&&O.QUOTES[network][a].asset);}
async function discover(network,token,call){
 const reg=REGISTRY[network],found=new Map(),skipped={};
 const add=(pool,via)=>{if(ADDR.test(pool)&&!ZERO.test(pool)&&!found.has(pool))found.set(pool,via);};
 for(const q of quotesOf(network)){
  for(const f of reg.v3)for(const fee of FEES){
   try{const r=await call(f,SEL.getPool+pad(token)+pad(q)+fee.toString(16).padStart(64,'0'));add('0x'+String(r).slice(-40).toLowerCase(),{protocol:'uniswap-v3',factory:f,quote:q,fee});}
   catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;skipped['v3:'+(e.code||'CALL_FAILED')]=(skipped['v3:'+(e.code||'CALL_FAILED')]||0)+1;}
  }
  for(const f of reg.v2){
   try{const r=await call(f,SEL.getPair+pad(token)+pad(q));add('0x'+String(r).slice(-40).toLowerCase(),{protocol:'v2',factory:f,quote:q});}
   catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;skipped['v2:'+(e.code||'CALL_FAILED')]=(skipped['v2:'+(e.code||'CALL_FAILED')]||0)+1;}
  }
 }
 return {pools:[...found].slice(0,MAX_POOLS).map(([pool,via])=>({pool,...via})),skipped};
}
async function inspect(network,address,{rpc=O.rpcFor(network),ethRpc=O.rpcFor('ethereum'),now=Date.now(),maxCalls=MAX_CALLS,timeoutMs=TIMEOUT_MS,env=process.env}={}){
 const token=String(address||'').toLowerCase(),profile={version:VERSION,calls:0,ms:0,reasons:{},scope:null};
 if(!enabled(env)||!rpc||!ADDR.test(token)){profile.reasons.all=!enabled(env)?'DISCOVERY_DISABLED':'NETWORK_UNSUPPORTED';return {fields:{},profile};}
 if(!supported(network)){profile.reasons.all='NO_REVIEWED_FACTORY_FOR_NETWORK';return {fields:{},profile};}
 const key=network+'|'+token,hit=cache.get(key);if(hit&&now-hit.at<CACHE_MS)return {fields:structuredClone(hit.fields),profile:{...hit.profile,cached:true}};
 const t0=Date.now(),state={calls:0,deadline:t0+timeoutMs},fields={};
 const budget=r=>async(m,p)=>{if(state.calls>=maxCalls)throw fail('ONCHAIN_BUDGET_EXHAUSTED');if(Date.now()>state.deadline)throw fail('ONCHAIN_TIMEOUT');state.calls++;return r(m,p);};
 const r=budget(rpc),er=budget(ethRpc);
 try{
  const block=await r('eth_blockNumber',[]),call=(to,data)=>r('eth_call',[{to,data},block]),ctx={network,token,rpc:r,call,block};
  const {pools,skipped}=await discover(network,token,call);
  if(Object.keys(skipped).length)profile.reasons.skipped=skipped;
  if(!pools.length){profile.reasons.all='NO_POOL_AGAINST_REVIEWED_QUOTES';return {fields,profile};}
  const usd={},usdOf=async a=>usd[a]||=await O.quoteUsd(a,{ethRpc:er,now});
  const read=[];
  for(const p of pools){
   try{const x=await O.readPool(p.pool,ctx);if(x.kind==='UNISWAP_V4'||!x.quoteAsset||!x.amounts)throw fail('POOL_UNSUPPORTED');
    const q=await usdOf(x.quoteAsset);read.push({...p,x,q,quoteSideUsd:x.amounts[x.quote]*q.usd});}
   catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;(profile.reasons.pool||={})[p.pool]=e.code||'POOL_READ_FAILED';}
  }
  const live=read.filter(p=>Number.isFinite(p.quoteSideUsd)&&p.quoteSideUsd>0&&p.x.amounts[token]>0);
  if(!live.length){profile.reasons.all='NO_READABLE_POOL_WITH_RESERVES';return {fields,profile};}
  live.sort((a,b)=>b.quoteSideUsd-a.quoteSideUsd);
  const best=live[0],tokenUsd=best.x.price*best.q.usd,at=new Date(now).toISOString();
  if(!(tokenUsd>0)||!Number.isFinite(tokenUsd))throw fail('TOKEN_USD_INVALID');
  const scope='Pools found on-chain through reviewed factories ('+(REGISTRY[network].v3.length?'Uniswap V3':'')+(REGISTRY[network].v2.length?(REGISTRY[network].v3.length?', ':'')+'V2-compatible':'')+') against the reviewed quote assets only. Not an exhaustive pool census: other venues, quote assets and hook-gated V4 pools are not included.';
  const ev=(extra)=>[{provider:O.SOURCE[network],source:O.SOURCE[network],network,chainId:{ethereum:1,robinhood:4663,arc:5042}[network],address:token,block,checkedAt:at,method:VERSION,discovery:'factory registry (getPool/getPair)',scope,...extra}];
  const fresh={retrievedAt:at,ageMs:0,basis:'pinned-block chain read at '+block};
  const chainId={ethereum:1,robinhood:4663,arc:5042}[network],base={status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:O.SOURCE[network],network,chainId,freshness:fresh};
  fields.priceUsd={...base,value:tokenUsd,evidence:ev({pairs:[best.pool],kind:best.x.kind,protocol:best.protocol,factory:best.factory,quote:best.quote,quoteAsset:best.x.quoteAsset,priceInQuote:best.x.price,quoteUsd:best.q.usd,quoteUsdEvidence:best.q.evidence,selection:'deepest discovered pool by quote-side USD'})};
  let total=0;const parts=[];
  for(const p of live){const v=p.x.amounts[token]*tokenUsd+p.x.amounts[p.x.quote]*p.q.usd;if(!Number.isFinite(v)||v<0)continue;total+=v;parts.push({pool:p.pool,kind:p.x.kind,protocol:p.protocol,usd:v});}
  fields.liquidityUsd={...base,value:total,evidence:ev({pairs:parts.map(p=>p.pool),pools:parts,basis:'pool token balances x on-chain token price (deepest pool) x Chainlink quote USD',scope:scope+' Lower bound of chain-wide liquidity.'})};
  fields.dexPairCount={...base,status:'ON_CHAIN_POOL_COUNT_LOWER_BOUND',value:parts.length+' discovered pool'+(parts.length===1?'':'s')+' (on-chain, reviewed factories)',evidence:ev({pairs:parts.map(p=>p.pool),method:VERSION+' pool count'})};
 }catch(e){profile.reasons.all=e.code||'DISCOVERY_FAILED';}
 profile.calls=state.calls;profile.ms=Date.now()-t0;profile.scope='reviewed-factory pools';
 if(cache.size>300)cache.delete(cache.keys().next().value);
 cache.set(key,{at:now,fields:structuredClone(fields),profile});
 return {fields,profile};
}
function _reset(){cache.clear();}
module.exports={inspect,discover,enabled,supported,REGISTRY,FEES,VERSION,_reset};
