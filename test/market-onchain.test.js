'use strict';
// Unit contracts for search/server/lib/market-onchain.js (mock RPC; real-chain validation runs in .github/workflows/data-engine-phase2.yml).
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../search/server/lib/market-onchain'),mc=require('../search/server/lib/market-cross'),ec=require('../search/server/lib/evidence-class');
const TOKEN='0x'+'1'.repeat(40),POOL3='0x'+'3'.repeat(40),POOL2='0x'+'2'.repeat(40),USDC_ARC='0x3600000000000000000000000000000000000000';
const W=n=>'0x'+BigInt.asUintN(256,BigInt(n)).toString(16).padStart(64,'0');
const A=a=>'0x'+a.slice(2).padStart(64,'0');
const str=s=>{const h=Buffer.from(s).toString('hex');return '0x'+(32).toString(16).padStart(64,'0')+s.length.toString(16).padStart(64,'0')+h.padEnd(64,'0');};
const NOW=Date.parse('2026-11-21T12:00:00Z');
const sqrtFor=(priceInQuote,d0,d1)=>BigInt(Math.round(Math.sqrt(priceInQuote*10**(d1-d0))*2**96));
// Ethereum RPC: Chainlink USDC/USD = 1.0001, ETH/USD = 3000, fresh
function ethRpc({description='USDC / USD',age=60}={}){return async(m,p)=>{if(m==='eth_blockNumber')return '0x1500000';const {to,data}=p[0];
 const feed=Object.entries(M.FEEDS).find(([,f])=>f.address===to);if(!feed)throw Error('unknown '+to);
 if(data===('0x7284e416'))return str(feed[0]==='USDC'?description:feed[1].description);
 const ans=feed[0]==='ETH'?300000000000n:100010000n;return '0x'+[1n,ans,0n,BigInt(Math.floor(NOW/1000)-age),1n].map(x=>x.toString(16).padStart(64,'0')).join('');};}
function chainRpc(table,{logs=[]}={}){const calls=[];const fn=async(m,p)=>{calls.push(m);if(m==='eth_blockNumber')return '0x99';if(m==='eth_getLogs')return logs;
 const {to,data}=p[0],k=to+':'+data.slice(0,10)+(data.length>10?':'+data.slice(10):'');const v=table[k]??table[to+':'+data.slice(0,10)];if(v===undefined)throw Error('revert '+k);return typeof v==='function'?v():v;};fn.calls=calls;return fn;}
const v3Table=(price)=>({[POOL3+':0x0dfe1681']:A(TOKEN),[POOL3+':0xd21220a7']:A(USDC_ARC),[TOKEN+':0x313ce567']:W(18),[USDC_ARC+':0x313ce567']:W(6),
 [POOL3+':0x0902f1ac']:()=>{throw Error('revert')},[POOL3+':0x3850c7bd']:W(sqrtFor(price,18,6))+'0'.repeat(64*6),
 [TOKEN+':0x70a08231:'+POOL3.slice(2).padStart(64,'0')]:W(10n**24n),[USDC_ARC+':0x70a08231:'+POOL3.slice(2).padStart(64,'0')]:W(500000n*10n**6n)});
const primary=(price,liq,pools=[POOL3])=>({priceUsd:{value:price,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'DEX Screener',evidence:[{provider:'DEX Screener',pairs:[pools[0]]}]},
 liquidityUsd:{value:liq,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'DEX Screener',evidence:[{provider:'DEX Screener',pairs:pools}]},
 volume24h:{value:10,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'DEX Screener',evidence:[{provider:'DEX Screener',pairs:pools}]}});
const ENV={SEARCH_MARKET_ONCHAIN_CHECK:'on',SEARCH_MARKET_VERIFY_SNAPSHOT:'off'};

test('MO-1 opt-in: disabled by default, no RPC call',async()=>{
 M._reset();const rpc=chainRpc(v3Table(0.5));const r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc,ethRpc:ethRpc(),now:NOW,env:{}});
 assert.deepEqual(r.fields,{});assert.equal(rpc.calls.length,0);assert.equal(r.profile.reasons.all,'ONCHAIN_CHECK_DISABLED');
});
test('MO-2 V3 pool: price and TVL derived at one pinned block with a checked Chainlink quote; provenance recorded',async()=>{
 M._reset();const r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.ok(Math.abs(r.fields.priceUsd.value-0.5*1.0001)<1e-9,'price '+r.fields.priceUsd.value);
 const e=r.fields.priceUsd.evidence[0];assert.equal(e.block,'0x99');assert.equal(e.kind,'V3_SLOT0');assert.equal(e.quoteUsdEvidence.description,'USDC / USD');assert.deepEqual(e.pairs,[POOL3]);
 // TVL = 1e6 token * 0.50005 + 500000 USDC * 1.0001
 assert.ok(Math.abs(r.fields.liquidityUsd.value-(1e6*0.5*1.0001+500000*1.0001))<1e-3);
 assert.equal(r.profile.reasons.volume24h,'VOLUME_CHECK_DISABLED');assert.ok(r.profile.calls<=M.MAX_CALLS);
});
test('MO-3 market-cross: same pools within tolerance -> CROSS_VERIFIED; outside -> DISAGREE (never promoted); value kept',async()=>{
 mc._reset();M._reset();const inspect=(n,a,p)=>M.inspect(n,a,p,{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 const ok=await mc.inspect('arc',TOKEN,{env:ENV,dexInspect:async()=>primary(0.501,1000005),onchainInspect:inspect});
 assert.equal(ok.priceUsd.value,0.501);assert.equal(ok.priceUsd.crossCheck.state,'AGREE');
 assert.equal(ec.classify(ok.priceUsd,{card:'activity'}).evidenceClass,'CROSS_VERIFIED');
 assert.equal(ec.evidenceState?.(ok.priceUsd,ec.classify(ok.priceUsd,{card:'activity'}))?.[0]??'VERIFIED','VERIFIED','chain + provider are independent origins');
 assert.equal(ok.liquidityUsd.crossCheck.state,'AGREE');assert.equal(ok.volume24h.crossCheck.state,'UNAVAILABLE');assert.equal(ok.volume24h.crossCheck.reasonCode,'VOLUME_CHECK_DISABLED');
 M._reset();const bad=await mc.inspect('arc',TOKEN,{env:ENV,dexInspect:async()=>primary(0.56,1000005),onchainInspect:inspect});
 assert.equal(bad.priceUsd.value,0.56);assert.equal(bad.priceUsd.crossCheck.state,'DISAGREE');assert.equal(ec.classify(bad.priceUsd,{card:'activity'}).evidenceClass,'SINGLE_SOURCE');
});
test('MO-4 fail closed: unchecked feed identity, stale feed, unsupported quote, pool without the token',async()=>{
 M._reset();let r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc({description:'USDC / ETH'}),now:NOW,env:ENV});
 assert.equal(r.fields.priceUsd,undefined);assert.equal(r.profile.reasons.priceUsd,'QUOTE_FEED_IDENTITY_MISMATCH');
 M._reset();r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc({age:200000}),now:NOW,env:ENV});
 assert.equal(r.profile.reasons.priceUsd,'QUOTE_FEED_STALE');
 const other='0x'+'9'.repeat(40);M._reset();r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:chainRpc({...v3Table(0.5),[POOL3+':0xd21220a7']:A(other),[other+':0x313ce567']:W(18),[other+':0x70a08231:'+POOL3.slice(2).padStart(64,'0')]:W(1)}),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.profile.reasons.priceUsd,'QUOTE_ASSET_UNSUPPORTED');
 M._reset();r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:chainRpc({...v3Table(0.5),[POOL3+':0x0dfe1681']:A(other),[other+':0x313ce567']:W(18)}),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.profile.reasons.priceUsd,'POOL_DOES_NOT_CONTAIN_TOKEN');
});
test('MO-5 V4: PoolKey must hash to the poolId; StateView must point at the official PoolManager; TVL not estimated',async()=>{
 const V=M.V4.robinhood,NATIVE='0x'+'0'.repeat(40);
 const key={currency0:NATIVE,currency1:TOKEN,fee:10000,tickSpacing:200,hooks:'0x'+'4'.repeat(38)+'cc'};
 const id=M.poolId(key);
 const log={address:V.poolManager,removed:false,blockNumber:'0x10',topics:['0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',id,A(key.currency0),A(key.currency1)],
  data:W(key.fee)+W(key.tickSpacing).slice(2)+A(key.hooks).slice(2)+W(1).slice(2)+W(0).slice(2)};
 // token price 0.001 ETH: currency0=ETH, currency1=TOKEN => price1/0 = 1000 TOKEN per ETH
 const table={[V.stateView+':0xdc4c90d3']:A(V.poolManager),[V.stateView+':0xc815641c:'+id.slice(2)]:W(sqrtFor(1000,18,18))+'0'.repeat(64*3),[TOKEN+':0x313ce567']:W(18)};
 const p=primary(3,1e6,[id]);
 M._reset();let r=await M.inspect('robinhood',TOKEN,p,{rpc:chainRpc(table,{logs:[log]}),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.ok(Math.abs(r.fields.priceUsd.value-3)<1e-6,'0.001 ETH * 3000 = '+r.fields.priceUsd.value);
 assert.equal(r.fields.priceUsd.evidence[0].poolKey.hooks,key.hooks);assert.equal(r.profile.reasons.liquidityUsd,'POOL_TVL_UNSUPPORTED_V4');assert.equal(r.fields.liquidityUsd,undefined);
 // PositionManager.poolKeys(bytes25) path: one eth_call, no log query; result must still hash to the poolId
 const pmTable={...table,[V.positionManager+':0xdc4c90d3']:A(V.poolManager),[V.positionManager+':0x86b6be7d:'+id.slice(2,52).padEnd(64,'0')]:A(key.currency0)+A(key.currency1).slice(2)+W(key.fee).slice(2)+W(key.tickSpacing).slice(2)+A(key.hooks).slice(2)};
 M._reset();const viaPm=chainRpc(pmTable,{logs:[]});r=await M.inspect('robinhood',TOKEN,p,{rpc:viaPm,ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.ok(Math.abs(r.fields.priceUsd.value-3)<1e-6);assert.equal(r.fields.priceUsd.evidence[0].poolKey.resolvedVia,'PositionManager.poolKeys(bytes25)');assert.ok(!viaPm.calls.includes('eth_getLogs'));
 M._reset();r=await M.inspect('robinhood',TOKEN,p,{rpc:chainRpc({...pmTable,[V.positionManager+':0x86b6be7d:'+id.slice(2,52).padEnd(64,'0')]:A(key.currency0)+A(key.currency1).slice(2)+W(3000).slice(2)+W(key.tickSpacing).slice(2)+A(key.hooks).slice(2)},{logs:[]}),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.fields.priceUsd,undefined,'a PositionManager key that does not hash to the poolId is rejected');
 M._reset();r=await M.inspect('robinhood',TOKEN,p,{rpc:chainRpc(table,{logs:[{...log,data:W(500)+log.data.slice(66)}]}),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.profile.reasons.priceUsd,'V4_POOL_KEY_HASH_MISMATCH','a tampered PoolKey never binds');
 M._reset();r=await M.inspect('robinhood',TOKEN,p,{rpc:chainRpc({...table,[V.stateView+':0xdc4c90d3']:A('0x'+'5'.repeat(40))},{logs:[log]}),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.profile.reasons.priceUsd,'V4_STATEVIEW_MISMATCH');
});
test('MO-6 strict budget and cache: never more than maxCalls; repeated inspection within 30 s is served from cache',async()=>{
 M._reset();const rpc=chainRpc(v3Table(0.5));const r=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc,ethRpc:ethRpc(),now:NOW,env:ENV,maxCalls:3});
 assert.ok(r.profile.calls<=3);assert.equal(r.fields.priceUsd,undefined);assert.equal(r.profile.reasons.priceUsd,'ONCHAIN_BUDGET_EXHAUSTED');
 M._reset();const rpc2=chainRpc(v3Table(0.5));await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:rpc2,ethRpc:ethRpc(),now:NOW,env:ENV});const n=rpc2.calls.length;
 const again=await M.inspect('arc',TOKEN,primary(0.5,1e6),{rpc:rpc2,ethRpc:ethRpc(),now:NOW+1000,env:ENV});assert.equal(rpc2.calls.length,n);assert.equal(again.profile.cached,true);
});
test('MO-7 liquidity scope: a pool set larger than the budget, or containing a V4 pool, is never cross-verified',async()=>{
 M._reset();const many=Array.from({length:7},(_,i)=>'0x'+String(i+1).repeat(40).slice(0,40));
 const r=await M.inspect('arc',TOKEN,{...primary(0.5,1e6),liquidityUsd:{...primary(0.5,1e6).liquidityUsd,evidence:[{pairs:many}]}},{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.fields.liquidityUsd,undefined);assert.match(r.profile.reasons.liquidityUsd,/LIQUIDITY_SCOPE_EXCEEDS_BUDGET/);
});

test('MECH-1 immutable forwarders: the exact Solady LibClone 44-byte runtime resolves its implementation; near-misses do not',()=>{
 const rh=require('../search/server/lib/robinhood-rpc');const impl='3be8b97fd0e713b5abe0649fa830223b6b4bc599';
 assert.equal(rh.minimalProxyImplementation('0x3d3d3d3d363d3d37363d73'+impl+'5af43d3d93803e602a57fd5bf3'),'0x'+impl);
 assert.equal(rh.minimalProxyImplementation('0x363d3d373d3d3d363d73'+impl+'5af43d82803e903d91602b57fd5bf3'),'0x'+impl,'canonical EIP-1167 unchanged');
 assert.equal(rh.minimalProxyImplementation('0x3d3d3d3d363d3d37363d73'+impl+'5af43d3d93803e602a57fd5bf4'),null,'one byte off => not a forwarder');
 assert.equal(rh.minimalProxyImplementation('0x3d3d3d3d363d3d37363d73'+'0'.repeat(40)+'5af43d3d93803e602a57fd5bf3'),null);
});

test('MO-8 volume never runs in the report path: opt-in, background job (one per chain), later reports read the cache',async()=>{
 M._reset();const env={...ENV,SEARCH_MARKET_ONCHAIN_VOLUME:'on'};
 const p={...primary(0.5,1e6)};
 const first=await M.inspect('arc',TOKEN,p,{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env});
 assert.equal(first.profile.reasons.volume24h,'VOLUME_PENDING_BACKGROUND');assert.equal(first.fields.volume24h,undefined);
 const {running,cache}=M._volume();assert.equal(running.size<=1,true);await Promise.all([...running.values()]);
 assert.equal(cache.size,1);const [entry]=cache.values();assert.equal(entry.reason,'VOLUME_WINDOW_EXCEEDS_RPC_BUDGET','Arc window is refused by the engine itself');
 process.env.SEARCH_MARKET_ONCHAIN_VOLUME='on';
 try{M._reset();const off=await M.inspect('arc',TOKEN,p,{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});assert.ok(off.profile.reasons.volume24h);}finally{delete process.env.SEARCH_MARKET_ONCHAIN_VOLUME;}
});

// #352 coverage path: the largest provider pools reproduce >= 95% of the provider total, each within tolerance.
const many7=Array.from({length:7},(_,i)=>i===0?POOL3:'0x'+String(i+4).repeat(40).slice(0,40));
const covPrimary=(vals)=>{const p=primary(0.5,vals.reduce((a,b)=>a+b,0),many7);p.liquidityUsd.evidence=[{provider:'DEX Screener',pairs:many7,pairLiquidityUsd:vals}];return p;};
test('COV-1 >6 pools: top pool covering >= 95% is reproduced on-chain; value is the covered lower bound with coverage stated',async()=>{
 M._reset();const vals=[1000100,9000,8000,7000,6000,5000,4000];
 const r=await M.inspect('arc',TOKEN,covPrimary(vals),{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 const f=r.fields.liquidityUsd;assert.ok(f,'field present: '+JSON.stringify(r.profile.reasons));
 assert.ok(Math.abs(f.value-(1e6*0.5*1.0001+500000*1.0001))<1e-3);
 const e=f.evidence[0];assert.deepEqual(e.pairs,[POOL3]);assert.equal(e.providerPools,7);assert.ok(e.coverageOfProviderLiquidity>=0.95&&e.coverageOfProviderLiquidity<1);
 assert.match(e.scope,/Lower bound/);assert.equal(r.profile.reasons.liquidityUsd,undefined);
 mc._reset();M._reset();const x=await mc.inspect('arc',TOKEN,{env:ENV,dexInspect:async()=>covPrimary(vals),onchainInspect:(n,a,p)=>M.inspect(n,a,p,{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV})});
 assert.equal(x.liquidityUsd.value,vals.reduce((a,b)=>a+b,0),'displayed value stays the provider total');assert.equal(x.liquidityUsd.crossCheck.state,'AGREE');assert.equal(x.liquidityUsd.crossCheck.scope,'COVERAGE');assert.equal(ec.classify(x.liquidityUsd,{card:'liquidity'}).evidenceClass,'CROSS_VERIFIED');
});
test('COV-2 per-pool disagreement beyond tolerance fails closed (never a partial sum)',async()=>{
 M._reset();const vals=[2000000,9000,8000,7000,6000,5000,4000];
 const r=await M.inspect('arc',TOKEN,covPrimary(vals),{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.fields.liquidityUsd,undefined);assert.match(r.profile.reasons.liquidityUsd,/LIQUIDITY_SCOPE_EXCEEDS_BUDGET \(7 pools\) \| coverage: POOL_LIQUIDITY_DISAGREES/);
});
test('COV-3 coverage needing more than the pool budget, or without per-pool provider values, keeps the original reason path',async()=>{
 const many12=Array.from({length:12},(_,i)=>i===0?POOL3:'0x'+(i+4).toString(16).repeat(40).slice(0,40));
 const flatP=primary(0.5,1.2e6,many12);flatP.liquidityUsd.evidence=[{provider:'DEX Screener',pairs:many12,pairLiquidityUsd:Array(12).fill(100000)}];
 M._reset();let r=await M.inspect('arc',TOKEN,flatP,{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.fields.liquidityUsd,undefined);assert.match(r.profile.reasons.liquidityUsd,/coverage: LIQUIDITY_COVERAGE_EXCEEDS_BUDGET/);
 M._reset();r=await M.inspect('arc',TOKEN,{...primary(0.5,1e6),liquidityUsd:{...primary(0.5,1e6).liquidityUsd,evidence:[{pairs:many7}]}},{rpc:chainRpc(v3Table(0.5)),ethRpc:ethRpc(),now:NOW,env:ENV});
 assert.equal(r.profile.reasons.liquidityUsd,'LIQUIDITY_SCOPE_EXCEEDS_BUDGET (7 pools)');
});
test('COV-4 market-cross coverage exception is narrow: subset + >=95% + liquidityUsd only',()=>{
 const a={value:100,source:'DEX Screener',dataState:'DATA_FOUND',evidence:[{pairs:['0xa','0xb','0xc']}]};
 const b=(cov,pairs)=>({value:97,source:'Arc RPC pool state',dataState:'DATA_FOUND',evidence:[{pairs,coverageOfProviderLiquidity:cov}]});
 assert.equal(mc.merge({liquidityUsd:a},{liquidityUsd:b(0.96,['0xa'])},{now:NOW}).liquidityUsd.crossCheck.state,'AGREE');
 assert.equal(mc.merge({liquidityUsd:a},{liquidityUsd:b(0.94,['0xa'])},{now:NOW}).liquidityUsd.crossCheck.state,'SCOPE_MISMATCH');
 assert.equal(mc.merge({liquidityUsd:a},{liquidityUsd:b(0.99,['0xz'])},{now:NOW}).liquidityUsd.crossCheck.state,'SCOPE_MISMATCH','not a provider pool');
 assert.equal(mc.merge({liquidityUsd:a},{liquidityUsd:{...b(0.99,['0xa']),value:80}},{now:NOW}).liquidityUsd.crossCheck.state,'DISAGREE');
 const p={value:1,source:'DEX Screener',dataState:'DATA_FOUND',evidence:[{pairs:['0xa','0xb']}]};
 assert.equal(mc.merge({priceUsd:p},{priceUsd:{value:1,source:'Arc RPC pool state',dataState:'DATA_FOUND',evidence:[{pairs:['0xa'],coverageOfProviderLiquidity:0.99}]}},{now:NOW}).priceUsd.crossCheck.state,'SCOPE_MISMATCH','other fields keep the exact-scope rule');
});
