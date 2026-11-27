'use strict';
// Independent ON-CHAIN market check for priceUsd / liquidityUsd (free, permitted: the chain's own public RPC + Chainlink on Ethereum).
// It never replaces a provider value. It produces a secondary observation for the SAME pool(s) the provider used, so that
// market-cross.merge() can mark the provider field CROSS_VERIFIED only when both agree within the documented tolerance.
//
// Evidence rules (fail closed; any doubt => no secondary value, with a reasonCode):
//  * one pinned block per chain for every pool read; Chainlink read at one pinned Ethereum block; both recorded
//  * pool identity is read from the chain, never taken from the provider:
//      V2  token0()/token1()/getReserves()            (pair must contain the token)
//      V3  token0()/token1()/slot0()/balanceOf(pool)  (pool must contain the token)
//      V4  Uniswap StateView.getSlot0(poolId) + PoolKey from the PoolManager Initialize log, proven by
//          keccak256(abi.encode(PoolKey)) === poolId (cryptographic binding; currencies/decimals come from that key)
//  * quote assets are an explicit per-chain registry; their USD value comes ONLY from Chainlink feeds whose description() is
//    checked at read time and whose answer is fresher than heartbeat + 10 min. Anything else => QUOTE_USD_UNVERIFIED
//  * liquidity is checked only when EVERY pool in the provider's summed scope is reproducible (V2 reserves / V3 balances);
//    V4 per-pool TVL needs tick-range accounting and is reported as POOL_TVL_UNSUPPORTED_V4 (never estimated)
//  * 24h volume needs swap-log aggregation and is out of scope here (stays single-source)
// Cost bounds: <= MAX_CALLS RPC calls and <= TIMEOUT_MS per inspection, 30 s cache per (network, pool set), immutable PoolKey cache.
const keccak=require('../../../lib/keccak');
const VERSION='arcy-market-onchain-1';
const SEL=Object.freeze({token0:'0x0dfe1681',token1:'0xd21220a7',reserves:'0x0902f1ac',slot0:'0x3850c7bd',balanceOf:'0x70a08231',decimals:'0x313ce567',
 getSlot0:'0xc815641c',poolManager:'0xdc4c90d3',poolKeys:'0x86b6be7d',latestRoundData:'0xfeaf968c',description:'0x7284e416'});
const INITIALIZE='0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const NATIVE='0x0000000000000000000000000000000000000000';
// Official Uniswap v4 deployments (developers.uniswap.org/docs/protocols/v4/deployments). StateView.poolManager() is checked at runtime.
const V4=Object.freeze({
 ethereum:{poolManager:'0x000000000004444c5dc75cb358380d2e3de08a90',stateView:'0x7ffe42c4a5deea5b0fec41c94c136cf115597227',positionManager:'0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e'},
 robinhood:{poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',stateView:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',positionManager:'0x58daec3116aae6d93017baaea7749052e8a04fa7'},
 arc:{poolManager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',stateView:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',positionManager:'0x6049c9a0e26405c0985f9e3685c87d0ae917f82b'}});
// Chainlink USD reference feeds on Ethereum mainnet; description() must match exactly or the feed is not used.
const FEEDS=Object.freeze({
 ETH:{address:'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',description:'ETH / USD',maxAgeS:3600+600},
 USDC:{address:'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6',description:'USDC / USD',maxAgeS:86400+600},
 USDT:{address:'0x3e7d1eab13ad0104d2750b8863b489d65364e32d',description:'USDT / USD',maxAgeS:86400+600},
 DAI:{address:'0xaed0c38402a5d19df6e4c03f4e2dced6e29c1ee9',description:'DAI / USD',maxAgeS:3600+600},
 // No address is hard-coded here: Chainlink publishes this feed only as the ENS name usds-usd.data.eth (data.chain.link). The name is
 // resolved on-chain through the ENS registry at the pinned Ethereum block, then description() must still equal 'USDS / USD'.
 USDS:{ens:'usds-usd.data.eth',description:'USDS / USD',maxAgeS:86400+600}});
const ENS_REGISTRY='0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
function namehash(name){let node=Buffer.alloc(32);for(const label of name.split('.').reverse()){const h=Buffer.from(keccak(Buffer.from(label)).slice(2),'hex');node=Buffer.from(keccak(Buffer.concat([node,h])).slice(2),'hex');}return '0x'+node.toString('hex');}
const ensCache=new Map();
// Quote registry: exact addresses only. `decimals` for the native currency is fixed by the chain; ERC-20 decimals are read on-chain.
const QUOTES=Object.freeze({
 ethereum:{[NATIVE]:{asset:'ETH',decimals:18,basis:'native ETH (Uniswap v4 currency 0)'},
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':{asset:'ETH',basis:'canonical WETH9'},
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':{asset:'USDC',basis:'Circle USDC'},
  '0xdac17f958d2ee523a2206206994597c13d831ec7':{asset:'USDT',basis:'Tether USDT'},
  '0x6b175474e89094c44da98b954eedeac495271d0f':{asset:'DAI',basis:'MakerDAO DAI'},
  '0xdc035d45d973e3ec169d2276ddab16f1e407384f':{asset:'USDS',basis:'Sky USDS (Sky Protocol stablecoin contract)'}},
 robinhood:{[NATIVE]:{asset:'ETH',decimals:18,basis:'native ETH gas token (Arbitrum Orbit, Uniswap v4 currency 0)'},
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73':{asset:'ETH',basis:'Robinhood Chain WETH (pool quote asset; 1:1 ETH wrapper)'}},
 arc:{[NATIVE]:{asset:'USDC',decimals:18,basis:'Arc native USDC gas token (18-decimal native accounting, Uniswap v4 currency 0)'},
  '0x3600000000000000000000000000000000000000':{asset:'USDC',basis:'Arc USDC ERC-20 interface of the native token'}}});
const TOLERANCE=Object.freeze({priceUsd:0.03,liquidityUsd:0.10});
const MAX_CALLS=24,TIMEOUT_MS=2500,CACHE_MS=30000,MAX_LIQ_POOLS=6;
// Liquidity coverage path budget (separate from the price budget so price evidence is never starved).
const COVERAGE_MIN=0.95,COVERAGE_MAX_POOLS=8,COVERAGE_MAX_CALLS=96,COVERAGE_TIMEOUT_MS=6000;
const SOURCE={ethereum:'Ethereum RPC pool state',robinhood:'Robinhood Chain RPC pool state',arc:'Arc RPC pool state'};
const cache=new Map(),poolKeys=new Map();
const ADDR=/^0x[0-9a-f]{40}$/,ID=/^0x[0-9a-f]{64}$/;
const word=a=>a.toLowerCase().replace(/^0x/,'').padStart(64,'0');
const addrOf=h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h)?'0x'+h.slice(-40).toLowerCase():null;
const big=h=>{if(typeof h!=='string'||!/^0x[0-9a-f]*$/i.test(h)||h.length<3)throw code('MALFORMED_ABI');return BigInt(h.length>66?h.slice(0,66):h);};
const words=h=>{if(typeof h!=='string'||!/^0x([0-9a-f]{64})+$/i.test(h))throw code('MALFORMED_ABI');return h.slice(2).match(/.{64}/g).map(w=>BigInt('0x'+w));};
const signed=(x,bits)=>{const m=1n<<BigInt(bits);x&=m-1n;return x>=m>>1n?x-m:x;};
function code(c,extra){return Object.assign(Error(c),{code:c},extra||{});}
// Opt-in (default OFF): keeps the existing 'exactly one provider request' contract until the operator sets SEARCH_MARKET_ONCHAIN_CHECK=on.
function enabled(env=process.env){return String(env?.SEARCH_MARKET_ONCHAIN_CHECK||'').toLowerCase()==='on';}
function rpcFor(network){return {ethereum:()=>require('./eth').rpc,robinhood:()=>require('./robinhood-rpc').rpc,arc:()=>require('./arc-rpc').rpc}[network]?.();}
function budgeted(rpc,state){return async(m,p)=>{if(state.calls>=state.maxCalls)throw code('ONCHAIN_BUDGET_EXHAUSTED');if(Date.now()>state.deadline)throw code('ONCHAIN_TIMEOUT');state.calls++;return rpc(m,p);};}
const human=(raw,d)=>Number(raw)/10**d;
// price of currency `token` in units of the other currency, from a V3/V4 sqrtPriceX96 (price1/0 raw = (sqrtP/2^96)^2)
function fromSqrt(sqrtP,d0,d1,tokenIsToken0){if(sqrtP<=0n)throw code('POOL_PRICE_ZERO');const r=(Number(sqrtP)/2**96)**2*10**(d0-d1);if(!(r>0)||!Number.isFinite(r))throw code('POOL_PRICE_INVALID');return tokenIsToken0?r:1/r;}
function poolId(k){
 const enc='0x'+word(k.currency0)+word(k.currency1)+k.fee.toString(16).padStart(64,'0')+(BigInt.asUintN(256,BigInt(k.tickSpacing))).toString(16).padStart(64,'0')+word(k.hooks);
 return keccak(Buffer.from(enc.slice(2),'hex'));
}
async function decimalsOf(call,network,a){const q=QUOTES[network]?.[a];if(a===NATIVE)return q?q.decimals:null;const d=Number(big(await call(a,SEL.decimals)));if(!Number.isInteger(d)||d<0||d>36)throw code('TOKEN_DECIMALS_INVALID');return d;}
// Chainlink USD reference (Ethereum mainnet, pinned block, description + freshness checked)
async function quoteUsd(asset,{ethRpc,now}){
 const f=FEEDS[asset];if(!f)throw code('QUOTE_USD_UNVERIFIED');
 const block=await ethRpc('eth_blockNumber',[]);
 const call=(to,data)=>ethRpc('eth_call',[{to,data},block]);
 let feed=f.address;
 if(!feed&&f.ens){const c=ensCache.get(f.ens);if(c&&now-c.at<3600000)feed=c.address;else{const node=namehash(f.ens);
  const resolver='0x'+String(await call(ENS_REGISTRY,'0x0178b8bf'+node.slice(2))).slice(-40);if(/^0x0{40}$/.test(resolver))throw code('QUOTE_FEED_ENS_UNRESOLVED');
  feed='0x'+String(await call(resolver,'0x3b3b57de'+node.slice(2))).slice(-40).toLowerCase();if(/^0x0{40}$/.test(feed))throw code('QUOTE_FEED_ENS_UNRESOLVED');ensCache.set(f.ens,{address:feed,at:now});}}
 const desc=require('./eth').abiString?.(await call(feed,SEL.description));
 if(desc!==f.description)throw code('QUOTE_FEED_IDENTITY_MISMATCH');
 const w=words(await call(feed,SEL.latestRoundData));const answer=signed(w[1],256),updatedAt=Number(w[3]);
 if(answer<=0n)throw code('QUOTE_FEED_INVALID');
 const age=Math.floor(now/1000)-updatedAt;if(!(age>=-60&&age<=f.maxAgeS))throw code('QUOTE_FEED_STALE',{age});
 return {usd:Number(answer)/1e8,evidence:{feed,...(f.ens?{ens:f.ens}:{}),description:f.description,ethereumBlock:block,updatedAt:new Date(updatedAt*1000).toISOString(),ageSeconds:age}};
}
// PoolKey resolution, cheapest first; every candidate must hash to the poolId (so the source of the candidate is irrelevant):
//  1) PositionManager.poolKeys(bytes25(poolId)) - one eth_call; PositionManager.poolManager() must equal the official PoolManager
//  2) PoolManager Initialize log (topic1 = poolId) - only where the RPC accepts the full-range filtered query
async function v4Key(id,{network,rpc,call,block}){
 if(poolKeys.has(network+id))return poolKeys.get(network+id);
 const v=V4[network];let k=null,via=null;
 try{
  if(addrOf(await call(v.positionManager,SEL.poolManager))===v.poolManager){
   const w=words(await call(v.positionManager,SEL.poolKeys+id.slice(2,52).padEnd(64,'0')));
   const c={currency0:'0x'+(w[0]&((1n<<160n)-1n)).toString(16).padStart(40,'0'),currency1:'0x'+(w[1]&((1n<<160n)-1n)).toString(16).padStart(40,'0'),fee:Number(w[2]&0xffffffn),tickSpacing:Number(signed(w[3],24)),hooks:'0x'+(w[4]&((1n<<160n)-1n)).toString(16).padStart(40,'0')};
   if(poolId(c)===id){k=c;via='PositionManager.poolKeys(bytes25)';}
  }
 }catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;}
 if(!k){
  let logs;try{logs=await rpc('eth_getLogs',[{address:v.poolManager,topics:[INITIALIZE,id],fromBlock:'0x0',toBlock:block}]);}catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;throw code('V4_POOL_KEY_UNAVAILABLE');}
  if(!Array.isArray(logs)||logs.length!==1)throw code('V4_POOL_KEY_UNAVAILABLE',{logs:Array.isArray(logs)?logs.length:null});
  const l=logs[0],d=words(l.data);
  if(String(l.address).toLowerCase()!==v.poolManager||l.removed||String(l.topics?.[1]).toLowerCase()!==id)throw code('V4_POOL_KEY_UNAVAILABLE');
  k={currency0:addrOf(l.topics[2]),currency1:addrOf(l.topics[3]),fee:Number(d[0]&0xffffffn),tickSpacing:Number(signed(d[1],24)),hooks:'0x'+(d[2]&((1n<<160n)-1n)).toString(16).padStart(40,'0')};
  if(poolId(k)!==id)throw code('V4_POOL_KEY_HASH_MISMATCH');
  via='PoolManager Initialize log';
 }
 k={...k,resolvedVia:via};poolKeys.set(network+id,k);return k;
}
// One pool -> {kind, token side amounts, price of `token` in quote currency, quote}
async function readPool(pool,{network,token,rpc,call,block}){
 if(ID.test(pool)){
  const v=V4[network];if(!v)throw code('V4_NOT_DEPLOYED');
  if(addrOf(await call(v.stateView,SEL.poolManager))!==v.poolManager)throw code('V4_STATEVIEW_MISMATCH');
  const k=await v4Key(pool,{network,rpc,call,block});
  if(![k.currency0,k.currency1].includes(token))throw code('POOL_DOES_NOT_CONTAIN_TOKEN');
  const other=k.currency0===token?k.currency1:k.currency0,q=QUOTES[network]?.[other];if(!q)throw code('QUOTE_ASSET_UNSUPPORTED',{quote:other});
  const s0=words(await call(v.stateView,SEL.getSlot0+pool.slice(2))),sqrtP=s0[0]&((1n<<160n)-1n),tick=Number(signed(s0[1],24));
  const [d0,d1]=[await decimalsOf(call,network,k.currency0),await decimalsOf(call,network,k.currency1)];
  return {pool,kind:'UNISWAP_V4',quote:other,quoteAsset:q.asset,price:fromSqrt(sqrtP,d0,d1,k.currency0===token),tvl:null,tvlReason:'POOL_TVL_UNSUPPORTED_V4',poolKey:k,
   sqrtPriceX96:sqrtP,tick,decimals:{[k.currency0]:d0,[k.currency1]:d1}};
 }
 if(!ADDR.test(pool))throw code('POOL_ID_INVALID');
 const t0=addrOf(await call(pool,SEL.token0).catch(e=>{if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;return null;})),t1=t0?addrOf(await call(pool,SEL.token1)):null;
 if(!t0||!t1){const c=await curvePool(pool,{network,token,call});if(c)return c;throw code('POOL_KIND_UNSUPPORTED');}
 if(![t0,t1].includes(token))throw code('POOL_DOES_NOT_CONTAIN_TOKEN');
 const other=t0===token?t1:t0,q=QUOTES[network]?.[other];
 const [d0,d1]=[await decimalsOf(call,network,t0),await decimalsOf(call,network,t1)];
 let reserves=null;try{const w=words(await call(pool,SEL.reserves));if(w.length>=2)reserves=[w[0],w[1]];}catch{}
 if(reserves){
  if(reserves[0]<=0n||reserves[1]<=0n)throw code('POOL_EMPTY');
  const p0=human(reserves[1],d1)/human(reserves[0],d0);
  return {pool,kind:'V2_RESERVES',quote:other,quoteAsset:q?.asset||null,price:t0===token?p0:1/p0,amounts:{[t0]:human(reserves[0],d0),[t1]:human(reserves[1],d1)}};
 }
 const s=await call(pool,SEL.slot0);const sqrtP=words(s)[0]&((1n<<160n)-1n);
 const b0=big(await call(t0,SEL.balanceOf+word(pool))),b1=big(await call(t1,SEL.balanceOf+word(pool)));
 return {pool,kind:'V3_SLOT0',quote:other,quoteAsset:q?.asset||null,price:fromSqrt(sqrtP,d0,d1,t0===token),amounts:{[t0]:human(b0,d0),[t1]:human(b1,d1)}};
}
// Curve 2-coin pools (#357): identity = the token is coins(0) or coins(1) of the pool contract and coins(2) does not exist;
// price = get_dy(token -> quote, 1 token) at the pinned block (includes the pool fee, well inside the 3% cross-check tolerance);
// amounts = balances(i). Native ETH placeholder 0xeeee… maps to the chain's native quote. Anything else fails closed.
const EEE='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const n64=i=>BigInt(i).toString(16).padStart(64,'0');
async function curvePool(pool,{network,token,call}){
 const tryCall=async(sels,args)=>{for(const s of sels){try{const r=await call(pool,s+args);if(typeof r==='string'&&/^0x[0-9a-f]{64}/i.test(r))return r;}catch(e){if(e.code==='ONCHAIN_BUDGET_EXHAUSTED'||e.code==='ONCHAIN_TIMEOUT')throw e;}}return null;};
 const coin=async i=>{const r=await tryCall(['0xc6610657','0x23746eb8'],n64(i));const a=r?addrOf(r.slice(0,66)):null;return a===EEE?NATIVE:a;};
 const c0=await coin(0),c1=await coin(1);if(!c0||!c1||c0===c1)return null;
 if(![c0,c1].includes(token))throw code('POOL_DOES_NOT_CONTAIN_TOKEN');
 if(await coin(2))throw code('CURVE_POOL_NOT_TWO_COIN');
 const i=c0===token?0:1,j=1-i,other=j===0?c0:c1,q=QUOTES[network]?.[other];
 const [dt,dq]=[await decimalsOf(call,network,token),await decimalsOf(call,network,other)];
 const dyRaw=await tryCall(['0x556d6e9f','0x5e0d443f'],n64(i)+n64(j)+n64(10n**BigInt(dt)));if(!dyRaw)throw code('CURVE_GET_DY_UNAVAILABLE');
 const dy=big(dyRaw);if(dy<=0n)throw code('POOL_PRICE_ZERO');
 const bal=async k=>{const r=await tryCall(['0x4903b0d1','0x065a80d8'],n64(k));if(!r)throw code('CURVE_BALANCES_UNAVAILABLE');return big(r);};
 const [b0,b1]=[await bal(0),await bal(1)];if(b0<=0n||b1<=0n)throw code('POOL_EMPTY');
 const amounts={[c0]:human(b0,c0===token?dt:dq),[c1]:human(b1,c1===token?dt:dq)};
 return {pool,kind:'CURVE_2COIN',quote:other,quoteAsset:q?.asset||null,price:human(dy,dq),amounts};
}
// Secondary fields for the provider's own pools. Returns {fields, profile}; never throws.
async function inspect(network,address,primary,{rpc=rpcFor(network),ethRpc=rpcFor('ethereum'),now=Date.now(),maxCalls=MAX_CALLS,timeoutMs=TIMEOUT_MS,env=process.env}={}){
 const token=String(address||'').toLowerCase(),profile={version:VERSION,calls:0,ms:0,reasons:{}};
 const t0=Date.now(),fields={};
 if(!enabled(env)||!rpc||!ADDR.test(token)){profile.reasons.all=!enabled(env)?'ONCHAIN_CHECK_DISABLED':'NETWORK_UNSUPPORTED';return {fields,profile};}
 const pricePools=(primary?.priceUsd?.evidence||[]).flatMap(e=>Array.isArray(e?.pairs)?e.pairs:[]).map(x=>String(x).toLowerCase());
 const liqPools=[...new Set((primary?.liquidityUsd?.evidence||[]).flatMap(e=>Array.isArray(e?.pairs)?e.pairs:[]).map(x=>String(x).toLowerCase()))].sort();
 const key=network+'|'+token+'|'+pricePools.join(',')+'|'+liqPools.join(',');
 const hit=cache.get(key);if(hit&&now-hit.at<CACHE_MS)return {fields:structuredClone(hit.fields),profile:{...hit.profile,cached:true}};
 const state={calls:0,maxCalls,deadline:Date.now()+timeoutMs};
 const r=budgeted(rpc,state),er=budgeted(ethRpc,state);
 try{
  const block=await r('eth_blockNumber',[]);
  const call=(to,data)=>r('eth_call',[{to,data},block]);
  const ctx={network,token,rpc:r,call,block},usd={};
  const usdOf=async asset=>usd[asset]||=await quoteUsd(asset,{ethRpc:er,now});const usdCache=usd;
  const at=new Date(now).toISOString();
  const ev=(pools,extra)=>[{provider:SOURCE[network],source:SOURCE[network],network,block,pairs:pools,method:VERSION,checkedAt:at,...extra}];
  let tokenUsd=null,best=null;
  if(pricePools.length===1){
   try{best=await readPool(pricePools[0],ctx);
    if(!best.quoteAsset)throw code('QUOTE_ASSET_UNSUPPORTED');
    const q=await usdOf(best.quoteAsset);tokenUsd=best.price*q.usd;
    fields.priceUsd={value:tokenUsd,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:SOURCE[network],network,
     evidence:ev(pricePools,{kind:best.kind,quote:best.quote,quoteAsset:best.quoteAsset,priceInQuote:best.price,quoteUsd:q.usd,quoteUsdEvidence:q.evidence,...(best.poolKey?{poolKey:best.poolKey,poolKeyProof:'keccak256(abi.encode(PoolKey)) == poolId; PoolKey via '+best.poolKey.resolvedVia}:{})}),
     freshness:{retrievedAt:at,ageMs:0,basis:'pinned-block chain read at '+block}};
   }catch(e){profile.reasons.priceUsd=e.code||'ONCHAIN_READ_FAILED';}
  }else profile.reasons.priceUsd=pricePools.length?'PROVIDER_PRICE_SCOPE_NOT_ONE_POOL':'PROVIDER_PRICE_POOL_UNKNOWN';
  if(!liqPools.length)profile.reasons.liquidityUsd='PROVIDER_LIQUIDITY_POOLS_UNKNOWN';
  else if(liqPools.length>MAX_LIQ_POOLS)await coverage('LIQUIDITY_SCOPE_EXCEEDS_BUDGET ('+liqPools.length+' pools)');
  else if(tokenUsd===null)await coverage('TOKEN_USD_UNVERIFIED');
  else try{
   let total=0;const parts=[];
   for(const p of liqPools){const x=p===best?.pool?best:await readPool(p,ctx);
    if(x.kind==='UNISWAP_V4')throw code(x.tvlReason);
    if(!x.quoteAsset)throw code('QUOTE_ASSET_UNSUPPORTED');
    const q=await usdOf(x.quoteAsset),value=x.amounts[token]*tokenUsd+x.amounts[x.quote]*q.usd;
    if(!Number.isFinite(value)||value<0)throw code('POOL_TVL_INVALID');total+=value;parts.push({pool:p,kind:x.kind,usd:value});}
   fields.liquidityUsd={value:total,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:SOURCE[network],network,
    evidence:ev(liqPools,{pools:parts,basis:'sum of pool token balances x on-chain token price x Chainlink quote USD'}),
    freshness:{retrievedAt:at,ageMs:0,basis:'pinned-block chain read at '+block}};
  }catch(e){profile.reasons.liquidityUsd=e.code||'ONCHAIN_READ_FAILED';if(!fields.liquidityUsd)await coverage(profile.reasons.liquidityUsd);}
  // Coverage path (#352): when the provider's whole scope cannot be reproduced (too many pools, unsupported quote/venue/hook), the
  // largest provider pools are re-read on-chain one by one (v2 reserves / v3 balances / v4 tick-state principal). Each pool must
  // agree with the provider's own per-pool value within tolerance, and the reproduced pools must cover >= 95% of the provider's
  // summed liquidity. The on-chain value is the covered sum (a lower bound of the provider scope), with the coverage stated.
  async function coverage(prior){
   // Without per-pool provider values the coverage path cannot start: the original reason is kept unchanged.
   const reason=r=>{profile.reasons.liquidityUsd=r==='PROVIDER_POOL_VALUES_UNKNOWN'&&prior?prior:(prior?prior+' | coverage: ':'')+r;};
   const ev0=(primary?.liquidityUsd?.evidence||[]).find(e=>Array.isArray(e?.pairs)&&Array.isArray(e?.pairLiquidityUsd)&&e.pairs.length===e.pairLiquidityUsd.length);
   const dsTotal=Number(primary?.liquidityUsd?.value);
   if(!ev0||!(dsTotal>0))return reason('PROVIDER_POOL_VALUES_UNKNOWN');
   const ranked=ev0.pairs.map((p,i)=>({pool:String(p).toLowerCase(),ds:Number(ev0.pairLiquidityUsd[i])})).filter(x=>x.ds>0).sort((a,b)=>b.ds-a.ds);
   let need=0,acc=0;for(const x of ranked){need++;acc+=x.ds;if(acc/dsTotal>=COVERAGE_MIN)break;}
   if(acc/dsTotal<COVERAGE_MIN||need>COVERAGE_MAX_POOLS)return reason('LIQUIDITY_COVERAGE_EXCEEDS_BUDGET ('+need+' pools for '+Math.round(1000*acc/dsTotal)/10+'%)');
   const lstate={calls:0,maxCalls:COVERAGE_MAX_CALLS,deadline:Date.now()+COVERAGE_TIMEOUT_MS},lr=budgeted(rpc,lstate),ler=budgeted(ethRpc,lstate);
   const lcall=(to,data)=>lr('eth_call',[{to,data},block]),lctx={network,token,rpc:lr,call:lcall,block};
   const lusd={...usd},lusdOf=async a=>lusd[a]||=await quoteUsd(a,{ethRpc:ler,now});
   try{
    let sum=0;const parts=[];
    for(const x of ranked.slice(0,need)){
     const p=await readPool(x.pool,lctx);if(!p.quoteAsset)throw code('QUOTE_ASSET_UNSUPPORTED');
     const q=await lusdOf(p.quoteAsset);let tokAmt,quoteAmt,extra={};
     if(p.kind==='UNISWAP_V4'){
      const pr=await require('./v4-tvl').poolPrincipal({call:lcall,getCode:a=>lr('eth_getCode',[a,block]),stateView:V4[network].stateView,poolId:x.pool,key:p.poolKey,tick:p.tick,sqrtPriceX96:p.sqrtPriceX96});
      const k=p.poolKey,tokIs0=k.currency0===token;
      tokAmt=(tokIs0?pr.amount0Raw:pr.amount1Raw)/10**p.decimals[token];quoteAmt=(tokIs0?pr.amount1Raw:pr.amount0Raw)/10**p.decimals[p.quote];
      extra={initializedTicks:pr.initializedTicks,activeLiquidity:pr.activeLiquidity,proof:pr.proof,hooks:k.hooks};
     }else{tokAmt=p.amounts[token];quoteAmt=p.amounts[p.quote];}
     const poolTokenUsd=p.price*q.usd,value=tokAmt*poolTokenUsd+quoteAmt*q.usd;
     if(!Number.isFinite(value)||value<0)throw code('POOL_TVL_INVALID');
     const rel=Math.abs(value-x.ds)/x.ds;if(rel>TOLERANCE.liquidityUsd)throw code('POOL_LIQUIDITY_DISAGREES',{pool:x.pool,rel});
     sum+=value;parts.push({pool:x.pool,kind:p.kind,usd:value,providerUsd:x.ds,relativeDifference:Math.round(rel*1e4)/1e4,...extra});
    }
    fields.liquidityUsd={value:sum,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:SOURCE[network],network,
     evidence:ev(parts.map(x=>x.pool),{pools:parts,providerPools:ranked.length,coverageOfProviderLiquidity:Math.round(1e4*acc/dsTotal)/1e4,
      basis:'largest provider pools re-read on-chain (v2 reserves, v3 balances, v4 tick-state principal) x each pool\'s own on-chain price x Chainlink quote USD; covered pools hold >= '+Math.round(COVERAGE_MIN*100)+'% of the provider total; remaining pools not reproduced',
      scope:'Lower bound of the provider-scoped liquidity: excludes uncollected fees, hook-held balances and the uncovered provider pools.'}),
     freshness:{retrievedAt:at,ageMs:0,basis:'pinned-block chain read at '+block}};
    delete profile.reasons.liquidityUsd;
   }catch(e){reason(e.code||'ONCHAIN_READ_FAILED');}
   finally{profile.coverageCalls=lstate.calls;}
  }
  // 24h volume needs tens of eth_getLogs per token. Run inside the report it competed with Mechanics for the same public RPC and
  // degraded reviewed tax/mint/owner evidence (CI A/B 2026-11-22: TAO 2/2 repeats). It therefore never runs in the request path:
  // a paced background job (one per chain, opt-in SEARCH_MARKET_ONCHAIN_VOLUME=on) fills a 5-minute cache that later reports read.
  // Durable snapshot first (#356): computed outside the request path; scope/freshness checked in market-verify-snapshot.js.
  try{const doc=await require('./market-verify-snapshot').load({now,env});const sv=require('./market-verify-snapshot').volumeField(doc,network,token,primary,{now});
   if(sv.field)fields.volume24h=sv.field;else profile.reasons.volumeSnapshot=sv.reason;}catch{profile.reasons.volumeSnapshot='VOLUME_SNAPSHOT_READ_FAILED';}
  if(!fields.volume24h)try{const r=volumeFromCache(network,token,primary,{now,env});if(r.field)fields.volume24h=r.field;else{profile.reasons.volume24h=r.reason;
   if(r.reason==='VOLUME_PENDING_BACKGROUND')startVolume(network,token,primary,{rpc,usdOf:async a=>usdCache[a]?usdCache[a]:quoteUsd(a,{ethRpc,now:Date.now()})});}}
  catch(e){profile.reasons.volume24h=e.code||'VOLUME_READ_FAILED';}
 }catch(e){profile.reasons.all=e.code||'ONCHAIN_READ_FAILED';}
 profile.calls=state.calls;profile.ms=Date.now()-t0;
 if(cache.size>500)cache.delete(cache.keys().next().value);
 cache.set(key,{at:now,fields:structuredClone(fields),profile});
 return {fields,profile};
}

// ── background 24h volume (never awaited by a report) ──────────────────────────────────────────────────────────────────
const volCache=new Map(),volRunning=new Map(),VOL_TTL_MS=5*60*1000,VOL_PACE_MS=300;
const volKey=(network,token,primary)=>network+'|'+token+'|'+[...new Set((primary?.volume24h?.evidence||[]).flatMap(e=>Array.isArray(e?.pairs)?e.pairs:[]).map(x=>String(x).toLowerCase()))].sort().join(',');
function volumeEnabled(env=process.env){return String(env?.SEARCH_MARKET_ONCHAIN_VOLUME||'').toLowerCase()==='on';}
function volumeFromCache(network,token,primary,{now=Date.now(),env=process.env}={}){
 if(!volumeEnabled(env))return {reason:'VOLUME_CHECK_DISABLED'};
 const hit=volCache.get(volKey(network,token,primary));
 if(hit&&now-hit.at<VOL_TTL_MS)return hit.field?{field:structuredClone(hit.field)}:{reason:hit.reason};
 return {reason:'VOLUME_PENDING_BACKGROUND'};
}
function paced(rpc){let chain=Promise.resolve();return (m,p)=>{const run=chain.then(()=>rpc(m,p));chain=run.catch(()=>{}).then(()=>new Promise(r=>setTimeout(r,VOL_PACE_MS)));return run;};}
// One sequential job queue per chain (<= 50 pending, duplicates collapsed): bounded, paced extra load on the shared public RPC.
const volQueues=new Map();
function startVolume(network,token,primary,{rpc,usdOf}){
 if(!rpc)return null;const key=volKey(network,token,primary);
 if(volRunning.has(key))return volRunning.get(key);
 const q=volQueues.get(network)||Promise.resolve();
 if([...volRunning.keys()].filter(k=>k.startsWith(network+'|')).length>=50)return null;
 const job=q.then(()=>require('./market-volume').inspect(network,token,primary,{rpc:paced(rpc),usdOf,now:Date.now()}))
  .then(r=>{volCache.set(key,{at:Date.now(),field:r.field||null,reason:r.field?null:r.profile.reason,profile:r.profile});if(volCache.size>300)volCache.delete(volCache.keys().next().value);return r;})
  .catch(()=>null).finally(()=>volRunning.delete(key));
 volRunning.set(key,job);volQueues.set(network,job.then(()=>{},()=>{}));return job;
}
function _volume(){return {cache:volCache,running:volRunning};}
function _reset(){cache.clear();poolKeys.clear();volCache.clear();volRunning.clear();volQueues.clear();}
module.exports={_volume,volumeEnabled,VERSION,V4,FEEDS,QUOTES,NATIVE,SOURCE,TOLERANCE,MAX_CALLS,inspect,v4Key,rpcFor,namehash,readPool,poolId,fromSqrt,quoteUsd,enabled,_reset};
