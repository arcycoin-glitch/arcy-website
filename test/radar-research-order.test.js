'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../lib/radar-v2/intel/research-order');
const mk=(id,p={})=>({
 key:'1:0x'+id.toString(16).padStart(40,'0'),researchTier:'RESEARCH_QUALIFIED',
 discoveryTier:'EARLY',discoveryClass:'QUALIFIED',change24hPct:8,
 identity:{level:'METADATA_CROSS_CORROBORATED'},
 researchProfile:{level:'PARTIAL',completeness:0.5},
 sourceEvidence:{crossCheck:'MATCHED'},
 qualityRank:{score:62,organicBasis:'ONCHAIN_DEMAND_REVIEWED'},
 history:{flags:[]},opportunity:{score:28},evidenceConfidence:{score:42},discoveryScore:50,
 ...p
});
test('research-rank-2 prioritizes a verified early activity signal over higher-price established market size',()=>{
 const early=mk(1),mature=mk(2,{discoveryTier:'ESTABLISHED',qualityRank:{score:94,organicBasis:'ONCHAIN_DEMAND_REVIEWED'}});
 assert.equal(O.VERSION,'arcy-research-rank-2');
 assert.equal(O.band(early),'EVIDENCED_EARLY_SIGNAL');
 assert.equal(O.band(mature),'RESEARCH_QUALIFIED');
 assert.deepEqual([mature,early].sort(O.compare).map(x=>x.key),[early.key,mature.key]);
});
test('price-only pump, transaction count and missing identity can never pass special evidence filter',()=>{
 for(const bad of [
  mk(3,{change24hPct:500}),
  mk(4,{qualityRank:{score:90,organicBasis:'TRANSACTION_COUNT_PROXY'}}),
  mk(5,{identity:{level:'OFFICIAL_IDENTITY_UNESTABLISHED'}}),
  mk(6,{sourceEvidence:{crossCheck:'NONE',crossVerifiedFields:0}}),
  mk(7,{qualityRank:{score:49.9,organicBasis:'ONCHAIN_DEMAND_REVIEWED'}}),
  mk(8,{history:{flags:['HISTORICAL_EXTREME_MOVE']}}),
  mk(9,{change24hPct:-40})
 ])assert.equal(O.earlySignal(bad),false,bad.key);
});
test('measured multi-day activity growth may qualify, but pool age alone cannot',()=>{
 const signal=mk(10,{discoveryTier:'GROWTH',qualityRank:{score:58,organicBasis:'TRANSACTION_COUNT_PROXY'},history:{flags:['ACTIVITY_GROWTH_OBSERVED']}});
 const oldPool=mk(11,{discoveryTier:'GROWTH',qualityRank:{score:58,organicBasis:'TRANSACTION_COUNT_PROXY'},history:{flags:[]}});
 assert.equal(O.earlySignal(signal),true);
 assert.equal(O.earlySignal(oldPool),false);
});
test('material market-source contradiction cannot be called a special pre-momentum signal',()=>{
 const x=mk(12,{marketSpread:{liquidityUsd:{min:100000,max:800000,ratio:8,partialCoverage:false}}});
 assert.equal(O.earlySignal(x),false);
});
test('fallback tiers rank qualified established projects above unqualified or preliminary candidates',()=>{
 const verified=mk(13,{discoveryTier:'ESTABLISHED',qualityRank:{score:40,organicBasis:'TRANSACTION_COUNT_PROXY'}});
 const reviewed=mk(14,{researchTier:'RESEARCH_CANDIDATE',qualityRank:{score:98,organicBasis:'ONCHAIN_DEMAND_REVIEWED'}});
 const preliminary=mk(15,{researchTier:'WATCH_ONLY',qualityRank:{score:100,organicBasis:'ONCHAIN_DEMAND_REVIEWED'}});
 assert.deepEqual([preliminary,reviewed,verified].sort(O.compare).map(x=>O.band(x)),['RESEARCH_QUALIFIED','RESEARCH_CANDIDATE','WATCH_ONLY']);
});
test('within an evidence band, quality score outranks V3 discovery hype and deterministically resolves ties',()=>{
 const good=mk(16,{discoveryTier:'ESTABLISHED',qualityRank:{score:71,organicBasis:'TRANSACTION_COUNT_PROXY'},discoveryScore:30});
 const hype=mk(17,{discoveryTier:'ESTABLISHED',qualityRank:{score:43,organicBasis:'TRANSACTION_COUNT_PROXY'},discoveryScore:96});
 assert.deepEqual([hype,good].sort(O.compare).map(x=>x.key),[good.key,hype.key]);
 const a=mk(18,{discoveryTier:'ESTABLISHED',change24hPct:1}),b=mk(19,{discoveryTier:'ESTABLISHED',change24hPct:1});
 assert.deepEqual([b,a].sort(O.compare).map(x=>x.key),[a.key,b.key]);
});
