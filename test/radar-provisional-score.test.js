'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../lib/radar-v2/discovery');
const NOW=Date.UTC(2026,10,5,12,0,0);
function candidate(days,extra={}){
 return {volume24hUsd:20e6,liquidityUsd:10e6,priceUsd:1,buys24h:20000,sells24h:20000,
  poolCreatedAt:new Date(NOW-days*86400000).toISOString(),scopeVolume:'TOKEN',
  poolVolume24hUsd:5e6,crossShare:1,change24hPct:50,...extra};
}
test('under-24h pools cannot receive a near-perfect discovery score regardless of token name',()=>{
 for(const network of ['robinhood','arc','ethereum','pons']){
  const r=D.score(candidate(0.5),network,NOW,{pons:network==='pons'});
  assert.ok(r.score<=65,`${network}: ${r.score}`);
  assert.ok(r.flags.includes('PROVISIONAL_POOL_UNDER_24H'));
 }
});
test('pools aged 1-7 days remain provisional; established candidates are not age-capped',()=>{
 const recent=D.score(candidate(3),'robinhood',NOW);
 assert.ok(recent.score<=85);
 assert.ok(recent.flags.includes('LIMITED_POOL_HISTORY_UNDER_7D'));
 const established=D.score(candidate(8),'robinhood',NOW);
 assert.ok(!established.flags.includes('LIMITED_POOL_HISTORY_UNDER_7D'));
});
test('missing evidence never redistributes its weight into an inflated score',()=>{
 const full=D.score(candidate(8),'robinhood',NOW);
 const sparse=D.score(candidate(8,{buys24h:null,sells24h:null,crossShare:null,change24hPct:null,scopeVolume:'POOL'}),'robinhood',NOW);
 assert.ok(sparse.score<full.score,`sparse ${sparse.score}, full ${full.score}`);
 assert.ok(sparse.weightCoverage<full.weightCoverage);
});
test('score does not classify contract safety or accuse high-volume candidates of fraud',()=>{
 const s=D.score(candidate(0.5),'robinhood',NOW);
 assert.ok(s.score>=0&&s.score<=100);
 assert.ok(!s.flags.includes('SCAM')&&!s.flags.includes('HONEYPOT'));
});

const CONTRACT='0x'+'1'.repeat(40);
test('unverified company and AI brand names are not eligible for promoted discovery on any chain',()=>{
 for(const network of ['robinhood','arc','ethereum','pons']){
  const row={address:CONTRACT,name:'AnTHrOpic',symbol:'AI',priceUsd:1};
  const r=D.classify(row,network);
  assert.equal(r?.reason,'ISSUER_AFFILIATION_NOT_VERIFIED',network);
  assert.equal(D.unverifiedIssuerBrand(row)?.reason,'ISSUER_AFFILIATION_NOT_VERIFIED');
 }
 const symbolClaim=D.classify({address:CONTRACT,name:'Unrelated',symbol:'OpenAI',priceUsd:1},'robinhood');
 assert.equal(symbolClaim.reason,'ISSUER_AFFILIATION_NOT_VERIFIED');
 assert.equal(D.unverifiedIssuerBrand({name:'Anthropic Research',symbol:'ARI'}),null,'unrelated names are not overblocked');
 assert.equal(D.classify({address:CONTRACT,name:'Independent Research',symbol:'IND',priceUsd:1},'robinhood'),null);
});
test('maturity gate is conservative about partial periods, missing evidence, and contradictory timestamps',()=>{
 assert.equal(D.rankingMaturityIssue(candidate(0.3),NOW)?.reason,'POOL_UNDER_24H');
 assert.equal(D.rankingMaturityIssue(candidate(0),NOW)?.reason,'POOL_UNDER_24H');
 assert.equal(D.rankingMaturityIssue(candidate(1.01),NOW),null);
 assert.equal(D.rankingMaturityIssue({poolCreatedAt:null},NOW)?.reason,'POOL_AGE_NOT_VERIFIED');
 assert.equal(D.rankingMaturityIssue({...candidate(10),poolAgeBasis:'SOURCES_DISAGREE_OLDER_USED'},NOW,{strict:true})?.reason,'POOL_AGE_SOURCES_DISAGREE');
});
test('reported component points use the fixed 100-point denominator',()=>{
 const s=D.score(candidate(8),'robinhood',NOW);
 const sum=s.components.reduce((a,b)=>a+b.points,0);
 assert.ok(Math.abs(sum-s.score)<=0.12,`components=${sum}, score=${s.score}`);
 const sparse=D.score(candidate(8,{buys24h:null,sells24h:null,crossShare:null,change24hPct:null,scopeVolume:'POOL'}),'robinhood',NOW);
 const sparseSum=sparse.components.reduce((a,b)=>a+b.points,0);
 assert.ok(Math.abs(sparseSum-sparse.score)<=0.12,`sparse components=${sparseSum}, score=${sparse.score}`);
});
