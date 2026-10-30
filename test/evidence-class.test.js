'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),ec=require('../search/server/lib/evidence-class');
const NOW=Date.parse('2026-10-30T20:00:00Z');
test('five classes: on-chain, cross-verified, single-source, stale, not verified',()=>{
 const c=(f,card)=>ec.classify(f,{card,now:NOW});
 assert.equal(c({value:1,status:'ON_CHAIN',dataState:'DATA_FOUND',source:'RPC'}).evidenceClass,'ON_CHAIN_VERIFIED');
 assert.equal(c({value:1,status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND',snapshot:{block:'0x1',completedAt:'2026-10-30T19:00:00Z',blockAgeSeconds:60}}).evidenceClass,'ON_CHAIN_VERIFIED');
 assert.equal(c({value:5,status:'MARKET_API_VERIFIED',confidence:'HIGH',dataState:'DATA_FOUND',source:'GeckoTerminal'}).evidenceClass,'SINGLE_SOURCE','one market API, even HIGH confidence, is single-source');
 assert.equal(c({value:5,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'DEX Screener',crossCheck:{state:'AGREE',providers:['DEX Screener','GeckoTerminal']}}).evidenceClass,'CROSS_VERIFIED');
 assert.equal(c({value:5,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'DEX Screener',crossCheck:{state:'DISAGREE',providers:['DEX Screener','GeckoTerminal']}}).evidenceClass,'SINGLE_SOURCE','disagreement is never promoted');
 const stale=c({value:5,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'X',freshness:{ageMs:3*3600e3,retrievedAt:'2026-10-30T17:00:00Z'}},'liquidity');
 assert.equal(stale.evidenceClass,'STALE');assert.equal(stale.provenance.underlyingClass,'SINGLE_SOURCE');
 const oldPin=c({value:37,status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND',snapshot:{block:'0x17bf136',completedAt:'2026-10-29T22:09:36Z',freshness:'LAST_VERIFIED',blockAgeSeconds:22*86400}},'holders');
 assert.equal(oldPin.evidenceClass,'STALE','a snapshot completed yesterday but pinned 22 days ago is STALE');
 assert.match(oldPin.evidenceClassBasis,/pinned block is 528 h old/);
 const nv=c({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'NO_CANDIDATE_HOLDERS',reason:'x'});
 assert.equal(nv.evidenceClass,'NOT_VERIFIED');assert.equal(nv.provenance.failureReason,'NO_CANDIDATE_HOLDERS');
 assert.equal(c({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED'}).provenance.failureReason,'UNSPECIFIED_NOT_VERIFIED','unlabelled failures are flagged, not hidden');
 assert.equal(c(undefined).provenance.failureReason,'FIELD_ABSENT');
});
test('annotate is additive: values/status untouched; summary counts and unlabeled failures are reported',()=>{
 const report={cards:{holders:{fields:{holderCount:{value:3,status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND'},top10Pct:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED'}}}}};
 const before=JSON.stringify(report.cards.holders.fields.holderCount.value);
 ec.annotate(report,{now:NOW});
 assert.equal(JSON.stringify(report.cards.holders.fields.holderCount.value),before);assert.equal(report.cards.holders.fields.holderCount.status,'SIGNED_ONCHAIN_SNAPSHOT');
 assert.deepEqual(report.evidenceSummary.byCard.holders,{ON_CHAIN_VERIFIED:1,CROSS_VERIFIED:0,SINGLE_SOURCE:0,STALE:0,NOT_VERIFIED:1});
 assert.equal(report.evidenceSummary.unlabeledFailures,1);
});
