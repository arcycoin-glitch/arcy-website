'use strict';
// Issue #117 (A): a derived value is never stronger than its weakest essential input. FDV = totalSupply (on-chain) x price (market API).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {classify,annotate}=require('../search/server/lib/evidence-class');
const {lineage}=require('../search/server/lib/evidence-lineage');
const fx=require('./fixtures/fdv-live-shapes-20261031.json');
const NOW=Date.parse('2026-10-31T08:20:00Z');
const withFresh=f=>({...f,freshness:{retrievedAt:'2026-10-31T08:19:00Z',ageMs:60000,basis:'provider response retrieval time'}});

test('reproduction: the three recorded Production FDV shapes (Arc/DexScreener, Arc/GeckoTerminal, Ethereum/DEX Screener) are SINGLE_SOURCE, status key unchanged',()=>{
 for(const k of ['arcoon','arcy','fwa']){
  const f=withFresh(fx[k].field),r=classify(f,{card:'activity',now:NOW});
  assert.equal(r.evidenceClass,'SINGLE_SOURCE',k);
  assert.equal(f.status,'ON_CHAIN_DERIVED','status key is preserved for existing consumers');
  assert.equal(r.provenance.lineage.weakest,'MARKET_API');assert.equal(r.provenance.lineage.onchainOnly,false);
  assert.match(r.evidenceClassBasis,/weakest essential input/);
  assert.ok(r.provenance.lineage.inputs.some(i=>i.origin==='ONCHAIN'&&i.role==='supply'),'the supply input is still recorded as on-chain');
  assert.ok(r.provenance.lineage.inputs.some(i=>i.origin==='MARKET_API'));
 }
});
test('FDV whose inputs are all on-chain keeps ON_CHAIN_VERIFIED (genuine derivations are not downgraded)',()=>{
 const f={value:123,kind:'FDV',status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:'Arc RPC totalSupply() × pool slot0 price',
  evidence:[{block:'0x10',address:'0xa',method:'totalSupply()'},{block:'0x10',address:'0xpool',method:'slot0 price read via eth_call'}]};
 const r=classify(f,{card:'activity',now:NOW});
 assert.equal(r.evidenceClass,'ON_CHAIN_VERIFIED');assert.equal(r.provenance.lineage.onchainOnly,true);
});
test('burn share / non-burn supply (balanceOf / totalSupply, RPC only) stay ON_CHAIN_VERIFIED',()=>{
 const f={value:0.4,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:'Arc RPC',evidence:[{chainId:5042,block:'0x1',address:'0xt',method:'burn balance / totalSupply()'}]};
 assert.equal(classify(f,{card:'supply'}).evidenceClass,'ON_CHAIN_VERIFIED');
});
test('missing input: FDV without an identifiable price (or supply) input cannot be claimed as on-chain',()=>{
 const onlySupply={value:1,kind:'FDV',status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:'RPC',evidence:[{block:'0x1',address:'0xt',method:'totalSupply()'}]};
 const r=classify(onlySupply,{card:'activity',now:NOW});
 assert.equal(r.evidenceClass,'SINGLE_SOURCE');assert.equal(r.provenance.lineage.weakest,'UNKNOWN');assert.match(r.provenance.lineage.reason,/both a supply input and a price input/);
 assert.equal(classify({...onlySupply,evidence:[]},{card:'activity',now:NOW}).evidenceClass,'SINGLE_SOURCE');
});
test('conflicting evidence is recorded and never promoted; stale upstream market input becomes STALE with the underlying class kept',()=>{
 const f=withFresh(fx.arcoon.field);
 const c=classify({...f,crossCheck:{state:'DISAGREE',providers:['DEX Screener','GeckoTerminal'],relativeDifference:0.4}},{card:'activity',now:NOW});
 assert.equal(c.evidenceClass,'SINGLE_SOURCE');assert.deepEqual(c.provenance.conflict.providers,['DEX Screener','GeckoTerminal']);
 const st=classify({...fx.arcoon.field,freshness:{retrievedAt:'2026-10-31T06:00:00Z',ageMs:3*3600e3,basis:'x'}},{card:'activity',now:NOW});
 assert.equal(st.evidenceClass,'STALE');assert.equal(st.provenance.underlyingClass,'SINGLE_SOURCE');
});
test('two independent providers agreeing on the FDV input is still CROSS_VERIFIED (explicit crossCheck only)',()=>{
 const f=withFresh({...fx.arcoon.field,crossCheck:{state:'AGREE',providers:['DEX Screener','GeckoTerminal']}});
 assert.equal(classify(f,{card:'activity',now:NOW}).evidenceClass,'CROSS_VERIFIED');
});
test('reported market cap and non-derived statuses are untouched by lineage; lineage() is null for them',()=>{
 assert.equal(lineage({status:'SOURCE_REPORTED',kind:'MARKET_CAP',value:5}),null);
 assert.equal(classify({status:'SOURCE_REPORTED',value:5,source:'DEX Screener'},{card:'activity'}).evidenceClass,'SINGLE_SOURCE');
 assert.equal(classify({status:'ON_CHAIN',value:5,source:'RPC'},{card:'supply'}).evidenceClass,'ON_CHAIN_VERIFIED');
});
test('report-level: the same 3-chain + Pons-subset report keeps every key; summary counts lineage-capped fields; zero FDV is ON_CHAIN_VERIFIED',()=>{
 const mk=(chain,k)=>({chain,cards:{activity:{fields:{valuation:withFresh(fx[k].field),priceUsd:{value:1,status:'SOURCE_REPORTED',source:'DEX Screener'}}},supply:{fields:{burn:{value:0.1,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:'Arc RPC',evidence:[{block:'0x1',address:'0xt',method:'balanceOf / totalSupply()'}]}}}}});
 for(const [chain,k] of [['arc','arcoon'],['ethereum','fwa'],['robinhood','arcy'],['pons','arcoon']]){
  const rep=annotate(mk(chain,k),{now:NOW});
  const v=rep.cards.activity.fields.valuation;
  assert.notEqual(v.evidenceClass,'ON_CHAIN_VERIFIED',chain);assert.equal(v.status,'ON_CHAIN_DERIVED');assert.equal(v.value,fx[k].field.value);
  assert.equal(rep.cards.supply.fields.burn.evidenceClass,'ON_CHAIN_VERIFIED','genuine on-chain derivation preserved');
  assert.equal(rep.evidenceSummary.lineageCapped,1);
  for(const key of ['evidenceClass','evidenceClassBasis','provenance'])assert.ok(key in v);
 }
});
