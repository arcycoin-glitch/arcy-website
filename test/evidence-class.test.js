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

test('source-ranked RPC candidate metrics are not classified as exhaustive on-chain rankings',()=>{
 const field={value:6.1444,status:'SOURCE_REPORTED_RPC_RECONCILED',dataState:'DATA_FOUND',
  source:'Blockscout candidate addresses + Ethereum RPC',
  evidence:[{block:'0x1929925',method:'balanceOf(address) for 21 candidates',limitation:'Candidate membership is explorer-reported; an unlisted wallet may rank higher.'}]};
 const result=ec.classify(field,{card:'holders',now:NOW});
 assert.equal(result.evidenceClass,'SINGLE_SOURCE');
 assert.match(result.evidenceClassBasis,/candidate-list completeness and the chain-wide ranking are not verified/);
 assert.equal(field.status,'SOURCE_REPORTED_RPC_RECONCILED','raw API verification status is unchanged');
});
test('annotate is additive: values/status untouched; summary counts and unlabeled failures are reported',()=>{
 const report={cards:{holders:{fields:{holderCount:{value:3,status:'SIGNED_ONCHAIN_SNAPSHOT',dataState:'DATA_FOUND'},top10Pct:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED'}}}}};
 const before=JSON.stringify(report.cards.holders.fields.holderCount.value);
 ec.annotate(report,{now:NOW});
 assert.equal(JSON.stringify(report.cards.holders.fields.holderCount.value),before);assert.equal(report.cards.holders.fields.holderCount.status,'SIGNED_ONCHAIN_SNAPSHOT');
 assert.deepEqual(report.evidenceSummary.byCard.holders,{ON_CHAIN_VERIFIED:1,CROSS_VERIFIED:0,SINGLE_SOURCE:0,STALE:0,NOT_VERIFIED:1});
 assert.equal(report.evidenceSummary.unlabeledFailures,1);
});
test('Data Engine V2 unified evidence states; same-origin providers are not independent',()=>{
 const st=f=>{const r=ec.classify(f,{card:'supply'});return ec.evidenceState(f,r)[0];};
 assert.equal(st({value:1,status:'ON_CHAIN'}),'VERIFIED');
 assert.equal(st({value:1,status:'SOURCE_REPORTED',crossCheck:{state:'AGREE',providers:['GeckoTerminal','DEX Screener']}}),'VERIFIED');
 assert.equal(st({value:1,status:'SOURCE_REPORTED',crossCheck:{state:'AGREE',providers:['GeckoTerminal','CoinGecko']}}),'PARTIAL_EVIDENCE','one company, one dataset');
 assert.equal(st({value:1,status:'SOURCE_REPORTED',source:'Blockscout'}),'PARTIAL_EVIDENCE');
 assert.equal(st({value:1,status:'SOURCE_REPORTED',crossCheck:{state:'DISAGREE',providers:['A','B']}}),'SOURCE_DISAGREEMENT');
 assert.equal(st({value:null,status:'NOT_VERIFIED',reasonCode:'SOURCES_DISAGREE'}),'SOURCE_DISAGREEMENT');
 assert.equal(st({value:1,status:'ON_CHAIN',snapshot:{blockAgeSeconds:3*86400}}),'STALE');
 assert.equal(st({value:null,status:'NOT_VERIFIED',reasonCode:'CHAIN_UNSUPPORTED'}),'NOT_SUPPORTED');
 assert.equal(st({value:null,status:'NOT_VERIFIED',reasonCode:'RPC_TIMEOUT'}),'NOT_VERIFIED');
 const rep={cards:{supply:{fields:{a:{value:1,status:'ON_CHAIN'},b:{value:null,status:'NOT_VERIFIED',reasonCode:'X'}}}}};
 ec.annotate(rep);
 assert.equal(rep.cards.supply.fields.a.evidenceState,'VERIFIED');assert.equal(rep.cards.supply.fields.a.evidenceClass,'ON_CHAIN_VERIFIED','existing class unchanged');
 assert.deepEqual(rep.evidenceSummary.stateTotal,{VERIFIED:1,PARTIAL_EVIDENCE:0,SOURCE_DISAGREEMENT:0,STALE:0,NOT_VERIFIED:1,NOT_SUPPORTED:0});
});
