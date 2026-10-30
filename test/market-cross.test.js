'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),mc=require('../search/server/lib/market-cross'),ec=require('../search/server/lib/evidence-class');
const A='0x'+'a'.repeat(40),ENV={SEARCH_MARKET_CROSSCHECK_APPROVED:'true'};
const f=(v,source)=>({value:v,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source,evidence:[{provider:source,pools:[A]}]});
const miss=(code)=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:code,source:null,evidence:[]});
const fields=(src,liq,vol,price)=>({liquidityUsd:f(liq,src),volume24h:f(vol,src),priceUsd:f(price,src),dexPairCount:f('2 DEX · 3 pools',src),change24h:f(1.5,src)});
test('off by default: exactly one provider call and an untouched result',async()=>{
 mc._reset();let g=0,d=0;const r=await mc.inspect('ethereum',A,{env:{},dexInspect:async()=>{d++;return fields('DEX Screener',100,10,1);},geckoInspect:async()=>{g++;return {fields:{}};}});
 assert.equal(d,1);assert.equal(g,0);assert.equal(r.liquidityUsd.crossCheck,undefined);
});
test('agreement within tolerance -> crossCheck AGREE -> CROSS_VERIFIED; value/status of the primary are unchanged',async()=>{
 mc._reset();const r=await mc.inspect('robinhood',A,{env:ENV,dexInspect:async()=>fields('DEX Screener',1000000,50000,2.00),geckoInspect:async()=>({fields:fields('GeckoTerminal',1020000,52000,2.01)})});
 assert.equal(r.liquidityUsd.value,1000000);assert.equal(r.liquidityUsd.status,'SOURCE_REPORTED');assert.equal(r.liquidityUsd.crossCheck.state,'AGREE');
 assert.equal(ec.classify(r.liquidityUsd,{card:'liquidity'}).evidenceClass,'CROSS_VERIFIED');assert.equal(ec.classify(r.priceUsd,{card:'activity'}).evidenceClass,'CROSS_VERIFIED');
});
test('disagreement is recorded, never promoted, and the primary number is kept',async()=>{
 mc._reset();const r=await mc.inspect('ethereum',A,{env:ENV,dexInspect:async()=>fields('DEX Screener',1000000,50000,2),geckoInspect:async()=>({fields:fields('GeckoTerminal',480000,50000,2)})});
 assert.equal(r.liquidityUsd.value,1000000);assert.equal(r.liquidityUsd.crossCheck.state,'DISAGREE');assert.equal(r.liquidityUsd.crossCheck.reasonCode,'PROVIDER_DISAGREEMENT');
 assert.equal(ec.classify(r.liquidityUsd,{card:'liquidity'}).evidenceClass,'SINGLE_SOURCE');assert.equal(r.volume24h.crossCheck.state,'AGREE');
});
test('secondary only fills a gap as SINGLE source; both missing stays NOT_VERIFIED with the primary reason',async()=>{
 mc._reset();const prim={liquidityUsd:miss('DEXSCREENER_SOURCE_UNAVAILABLE'),volume24h:miss('DEXSCREENER_SOURCE_UNAVAILABLE'),priceUsd:miss('DEXSCREENER_SOURCE_UNAVAILABLE')};
 const r=await mc.inspect('ethereum',A,{env:ENV,dexInspect:async()=>prim,geckoInspect:async()=>({fields:{liquidityUsd:f(5,'GeckoTerminal'),volume24h:miss('X'),priceUsd:miss('X')}})});
 assert.equal(r.liquidityUsd.crossCheck.state,'SINGLE_PROVIDER_FALLBACK');assert.equal(ec.classify(r.liquidityUsd,{card:'liquidity'}).evidenceClass,'SINGLE_SOURCE');
 assert.equal(r.volume24h.dataState,'NOT_VERIFIED');assert.equal(r.volume24h.reasonCode,'DEXSCREENER_SOURCE_UNAVAILABLE');
});
test('secondary 429 starts a cooldown: later reports make no secondary call; primary data still served',async()=>{
 mc._reset();let g=0;const opts={env:ENV,dexInspect:async()=>fields('DEX Screener',100,10,1),geckoInspect:async()=>{g++;throw Error('GeckoTerminal HTTP 429');}};
 let t=1e12;const now=()=>t;
 const r1=await mc.inspect('ethereum',A,{...opts,now});assert.equal(r1.liquidityUsd.crossCheck.state,'UNAVAILABLE');assert.equal(r1.liquidityUsd.crossCheck.reasonCode,'SECONDARY_RATE_LIMITED');assert.equal(r1.liquidityUsd.value,100);
 t+=1000;const r2=await mc.inspect('ethereum',A,{...opts,now});assert.equal(g,1,'no second call inside the cooldown');assert.equal(r2.liquidityUsd.crossCheck.reasonCode,'SECONDARY_COOLDOWN');
 t+=61000;await mc.inspect('ethereum',A,{...opts,now});assert.equal(g,2,'probing resumes after the cooldown');
});
test('primary outage with healthy secondary: report keeps working (single-source), total outage throws as before',async()=>{
 mc._reset();const r=await mc.inspect('robinhood',A,{env:ENV,dexInspect:async()=>{throw Error('down');},geckoInspect:async()=>({fields:fields('GeckoTerminal',7,1,1)})});
 assert.equal(r.liquidityUsd.value,7);assert.equal(r.liquidityUsd.crossCheck.state,'SINGLE_PROVIDER_FALLBACK');
 await assert.rejects(()=>mc.inspect('robinhood',A,{env:ENV,dexInspect:async()=>{throw Error('down');},geckoInspect:async()=>{throw Error('down2');}}));
});

test('equal amounts from different pool sets never become cross-verified',()=>{
 const a=f(100,'DEX Screener'),b=f(100,'GeckoTerminal');b.evidence[0].pools=['0x'+'b'.repeat(40)];
 const r=mc.merge({liquidityUsd:a},{liquidityUsd:b},{now:Date.now()});
 assert.equal(r.liquidityUsd.crossCheck.state,'SCOPE_MISMATCH');assert.equal(ec.classify(r.liquidityUsd).evidenceClass,'SINGLE_SOURCE');
});
