'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const CF=require('../lib/radar-v2/intel/custom-filter');
const info=require('../search/radar-info-readable');
const token=(over={})=>({
 network:'robinhood',chainId:4663,address:'0x'+'9'.repeat(40),key:'4663:'+'0x'+'9'.repeat(40),
 symbol:'RESEARCH',name:'Research Candidate',marketObserved:true,eligibility:'REVIEW',
 identity:{level:'OFFICIAL_CONTRACT_VERIFIED'},
 category:{category:'EARLY_STAGE_CANDIDATE'},
 volume24hUsd:336771.81,liquidityUsd:3323059.47,trades24h:1262,
 buys24h:800,sells24h:462,change24hPct:-8.7,
 marketCapUsd:3400000,fdvUsd:4700000,
 history:{observations:3,flags:[],drawdownFromPeakPct:-32},
 sourceEvidence:{crossCheck:'MATCHED'},
 profileCompleteness:{score:65},
 ...over
});
test('high volume with unknown unique participants is not verified organic demand',()=>{
 const x=CF.compute(token());
 assert(x.warnings.includes('UNIQUE_PARTICIPANTS_NOT_OBSERVED'));
 assert(x.warnings.includes('ORGANIC_DEMAND_NOT_VERIFIED'));
 assert(x.unmeasured.includes('organicVolume'));
 assert(x.components.organicVolume<=0.45);
 assert(x.components.buyerParticipation<=0.25);
 assert(!x.signals.includes('HEALTHY_ORGANIC_VOLUME'));
 assert(!x.signals.includes('BUYER_PARTICIPATION_RISING'));
 assert.notEqual(x.band,'STRONG_RESEARCH_SIGNAL');
 assert.equal(CF.veto(token()),null,'unknown demand is not a scam or security veto');
});
test('per-side reported wallet counts do not prove independent organic activity',()=>{
 const x=CF.compute(token({activity:{buyers:{h24:90},sellers:{h24:80}}}));
 assert(x.warnings.includes('ORGANIC_DEMAND_NOT_VERIFIED'));
 assert(!x.unmeasured.includes('buyerParticipation'));
 assert(x.unmeasured.includes('organicVolume'));
 assert(x.components.organicVolume<=0.45);
 assert(x.components.buyerParticipation<=0.55);
 assert(!x.signals.includes('HEALTHY_ORGANIC_VOLUME'));
 assert.notEqual(x.band,'STRONG_RESEARCH_SIGNAL');
});
test('overlapping buyer/seller counts are never added as distinct wallets',()=>{
 // Lower bound max(2,2) is only 2 despite a naive buyer+seller sum of 4.
 const x=CF.compute(token({trades24h:30,activity:{buyers:{h24:2},sellers:{h24:2}}}));
 assert(x.unmeasured.includes('buyerParticipation'));
 assert(!x.signals.includes('HEALTHY_ORGANIC_VOLUME'));
 assert(x.warnings.includes('ORGANIC_DEMAND_NOT_VERIFIED'));
});
test('even optimistic union bound can flag concentration, not infer manipulation',()=>{
 const x=CF.compute(token({activity:{buyers:{h24:1},sellers:{h24:1}}}));
 assert(x.warnings.includes('CONCENTRATED_TRADING_ACTIVITY'));
 assert(!x.signals.includes('HEALTHY_ORGANIC_VOLUME'));
 assert.equal(CF.veto(token({activity:{buyers:{h24:1},sellers:{h24:1}}})),null);
 assert.match(info.translateReason('CONCENTRATED_TRADING_ACTIVITY').full,/manipülasyon kanıtı değildir/);
});
test('reviewed independent participation supports the positive organic signal',()=>{
 const x=CF.compute(token({evidenceSummary:{demand:{
  distinctBuyers:100,cluster:'REVIEWED_NO_CONCENTRATION',wash:'REVIEWED_NO_SELF_TRADE'
 }}}));
 assert(!x.warnings.includes('ORGANIC_DEMAND_NOT_VERIFIED'));
 assert(!x.unmeasured.includes('organicVolume'));
 assert(x.components.organicVolume>=0.6);
 assert(x.signals.includes('HEALTHY_ORGANIC_VOLUME'));
 const unreviewed=CF.compute(token({evidenceSummary:{demand:{
  distinctBuyers:100,cluster:'NOT_REVIEWED',wash:'UNKNOWN'
 }}}));
 assert(unreviewed.warnings.includes('ORGANIC_DEMAND_NOT_VERIFIED'));
 assert(!unreviewed.signals.includes('HEALTHY_ORGANIC_VOLUME'));
});
